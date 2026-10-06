import { NextResponse } from "next/server";
import { authorize, ownedRequest } from "../../../../../lib/transferRequests/access";
import { takeSlot } from "../../../../../lib/rateLimit";
import { evaluateBuybackEligibility } from "../../../../../lib/solana/buybackEligibility";
import { devnetWalletAddressOrNull } from "../../../../../lib/solana/devnetAuthz";
import { assertDevnetServerSigningAllowed } from "../../../../../lib/solana/devnetSigningGuard";
import { getAsset } from "../../../../../lib/solana/heliusClient";
import { findOffchainRecord } from "../../../../../lib/solana/normalize";
import {
  NotOwnerError,
  prepareOwnerTransfer,
  VAULT_LOW_BALANCE_MESSAGE,
  VaultLowBalanceError,
} from "../../../../../lib/transferRequests/chain";
import { markFailed, markPrepared } from "../../../../../lib/transferRequests/store";
import { isTwinfoldOperatedWallet } from "../../../../../lib/redemptions/decide";
import { escrowAddress } from "../../../../../lib/redemptions/chain";
import { findOpenByAsset as findOpenRedemption, getRedemption } from "../../../../../lib/redemptions/store";
import { refuseMainnet } from "../../../../../lib/network";

export const dynamic = "force-dynamic";

const PREPARE_PER_HOUR = 20;

/**
 * POST /api/transfer-requests/[id]/prepare  (web session, same-origin)
 * Builds the Core TransferV1 transaction: authority = the owner, fee payer =
 * Twinfold's vault wallet (partially signed here, so the owner's Phantom needs
 * no devnet SOL). Returns { transaction } (base64) for Phantom signTransaction.
 * Allowed while awaiting approval, or after a retryable failure (e.g. expired
 * blockhash) until the request itself expires.
 */
export async function POST(request: Request, context: { params: Promise<{ id: string }> }) {
  const mainnet = await refuseMainnet(request);
  if (mainnet) return mainnet;
  const access = await authorize(request, { webOnly: true, mutating: true });
  if (!access.ok) return access.response;
  const { id } = await context.params;
  const found = ownedRequest(id, access.auth.wallet);
  if (!found.ok) return found.response;
  const r = found.request;

  if (r.status === "expired") return NextResponse.json({ error: "expired" }, { status: 410 });
  const reprepare = r.status === "failed" && r.retryable === true && r.expiresAt > Date.now();
  if (r.status !== "awaiting_approval" && !reprepare) {
    return NextResponse.json({ error: `request is ${r.status}`, status: r.status }, { status: 409 });
  }
  if (r.submitting) return NextResponse.json({ error: "a submit is in progress" }, { status: 409 });

  // Per-wallet cap: every prepare makes the vault pay a fee on approval.
  if (!takeSlot("transfer-prepare", r.wallet, PREPARE_PER_HOUR)) {
    return NextResponse.json({ error: "rate_limited: Preparation limit reached (per hour). Please try again later." }, { status: 429 });
  }

  try {
    assertDevnetServerSigningAllowed();
  } catch (error) {
    return NextResponse.json({ error: error instanceof Error ? error.message : "devnet server signing disabled" }, { status: 403 });
  }

  // Re-check at prepare time (not only at creation): eligibility and destination may have changed since the request was made.
  // An Asset in a redemption must not be offered for buyback or sent.
  if ((r.kind === "buyback" || r.kind === "send") && findOpenRedemption(r.assetId)) {
    markFailed(r, "This work has a redeem procedure in progress, so it cannot be sold or sent", false);
    return NextResponse.json({ error: "in_redemption" }, { status: 409 });
  }
  if (r.kind === "send" && isTwinfoldOperatedWallet(r.toWallet, devnetWalletAddressOrNull("vault"), devnetWalletAddressOrNull("escrow"))) {
    markFailed(r, "Cannot send to a Twinfold (legacy demo) wallet (use Sell to Twinfold or Redeem instead)", false);
    return NextResponse.json({ error: "destination_not_allowed" }, { status: 409 });
  }
  if (r.kind === "redeem_lock") {
    // The destination is fixed server-side to the escrow wallet and the redemption must still be waiting for its lock.
    const redemption = r.redemptionId ? getRedemption(r.redemptionId) : undefined;
    const escrow = escrowAddress();
    if (!escrow || escrow !== r.toWallet) {
      markFailed(r, "The redemption escrow has changed, so this request is no longer valid", false);
      return NextResponse.json({ error: "destination_changed" }, { status: 409 });
    }
    if (!redemption || redemption.status !== "requested" || redemption.wallet !== r.wallet || redemption.assetId !== r.assetId) {
      markFailed(r, "The redemption is no longer in the requested state, so this request is no longer valid", false);
      return NextResponse.json({ error: "redemption_not_requested" }, { status: 409 });
    }
  }
  if (r.kind === "buyback") {
    const vault = devnetWalletAddressOrNull("vault");
    if (!vault || vault !== r.toWallet) {
      markFailed(r, "The buyback destination (Twinfold Vault, legacy demo) has changed, so this request is no longer valid", false);
      return NextResponse.json({ error: "destination_changed" }, { status: 409 });
    }
    try {
      const current = await getAsset(r.assetAddress);
      const eligibility = evaluateBuybackEligibility({
        offchainRecord: findOffchainRecord(r.assetId),
        currentOwner: current.ownership.owner,
        burnt: current.burnt,
        wallet: r.wallet,
      });
      if (!eligibility.eligible) {
        markFailed(r, `No longer eligible for buyback: ${eligibility.reasons.join("; ")}`, false);
        return NextResponse.json({ error: "not_eligible", reasons: eligibility.reasons }, { status: 409 });
      }
    } catch {
      return NextResponse.json({ error: "could not re-check eligibility (devnet RPC)" }, { status: 502 });
    }
  }

  try {
    const prepared = await prepareOwnerTransfer({ assetAddress: r.assetAddress, owner: r.wallet, newOwner: r.toWallet });
    markPrepared(r, prepared);
    return NextResponse.json({ requestId: r.id, transaction: prepared.transactionB64, expiresAt: new Date(r.expiresAt).toISOString() });
  } catch (error) {
    if (error instanceof NotOwnerError) {
      markFailed(r, "This wallet is not the current owner on devnet", false);
      return NextResponse.json({ error: "not_owner" }, { status: 409 });
    }
    if (error instanceof VaultLowBalanceError) return NextResponse.json({ error: "vault_low_balance", message: VAULT_LOW_BALANCE_MESSAGE }, { status: 503 });
    console.error("transfer-requests/prepare failed", error instanceof Error ? error.message : "unknown error");
    return NextResponse.json({ error: "could not prepare the transaction (devnet RPC / vault wallet)" }, { status: 502 });
  }
}
