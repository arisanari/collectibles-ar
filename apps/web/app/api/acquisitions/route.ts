import { NextResponse } from "next/server";
import { boundedString, readSmallJson } from "../../../lib/auth/http";
import { markAcqConfirmed, markAcqFailed, markAcqSubmitted, getAcquisition, findOpenByAsset, reserveAcquisition, toAcquisitionView, listForWallet } from "../../../lib/acquisitions/store";
import { reconcileAcquisition } from "../../../lib/acquisitions/reconcile";
import { recordAudit } from "../../../lib/link/audit";
import { takeSlot } from "../../../lib/rateLimit";
import { evaluateAcquisitionEligibility, NOT_ACQUIRABLE_MESSAGE } from "../../../lib/solana/acquisitionEligibility";
import { resolveAssetAddress } from "../../../lib/solana/assetRegistry";
import { devnetWalletAddressOrNull } from "../../../lib/solana/devnetAuthz";
import { loadDevnetKeypair } from "../../../lib/solana/devnetKeys";
import { assertDevnetServerSigningAllowed } from "../../../lib/solana/devnetSigningGuard";
import { sendDevnetTransferWithSigner } from "../../../lib/solana/devnetTransfer";
import { getAsset } from "../../../lib/solana/heliusClient";
import { findOffchainRecord } from "../../../lib/solana/normalize";
import { authorize } from "../../../lib/transferRequests/access";
import { isAssetInRedemption } from "../../../lib/redemptions/store";
import { assertVaultFunded, VAULT_LOW_BALANCE_MESSAGE, VaultLowBalanceError } from "../../../lib/transferRequests/chain";

export const dynamic = "force-dynamic";

const REQUEST_ID = /^[A-Za-z0-9_-]{8,64}$/;
/** Per-wallet cap: every acquisition makes the vault pay a fee. */
const ACQUISITIONS_PER_HOUR = 10;

const refuse = (status: number, error: string, extra: object = {}) => NextResponse.json({ error, ...extra }, { status });

/**
 * POST /api/acquisitions { requestId, assetId }   ("Twinfoldから取得", Issue #60)
 * Web session (same-origin) or device Bearer token. The buyer is ALWAYS the authenticated wallet
 * (never read from the body). The on-chain owner is re-read and must be Twinfold's vault wallet;
 * the Asset must carry a listed price and not be redeemed. Only the vault wallet signs
 * (dev-only server signing, guarded by assertDevnetServerSigningAllowed); the buyer's key is not needed.
 * NO payment happens: the response carries the listed price for display only (Twinfold
 * interpretation, off-chain). Idempotent by requestId (reserved synchronously, before any await),
 * one in-flight acquisition per asset, capped per wallet per hour. Responds as soon as the transaction
 * has been sent (`submitted`) or refused; confirmation is finished in the background and reconciled
 * from the chain on later GETs.
 */
export async function POST(request: Request) {
  const access = await authorize(request, { mutating: true });
  if (!access.ok) return access.response;
  const wallet = access.auth.wallet;

  const body = await readSmallJson(request);
  const requestId = boundedString(body?.requestId, 64);
  const assetId = boundedString(body?.assetId, 64);
  if (!requestId || !REQUEST_ID.test(requestId) || !assetId) {
    return refuse(400, "invalid_input: requestId and assetId are required");
  }

  // ---- everything up to reserveAcquisition() is synchronous (no await) ----
  const existing = getAcquisition(requestId);
  if (existing) {
    if (existing.wallet !== wallet) return refuse(403, "requestId belongs to another wallet");
    await reconcileAcquisition(existing);
    return NextResponse.json(toAcquisitionView(existing));
  }

  let assetAddress: string;
  try {
    assetAddress = resolveAssetAddress(assetId);
  } catch (error) {
    return refuse(404, error instanceof Error ? error.message : "unknown asset");
  }

  try {
    assertDevnetServerSigningAllowed(); // the vault key signs: same explicit dev-only gate as every server-signing path
  } catch (error) {
    return refuse(403, error instanceof Error ? error.message : "devnet server signing disabled");
  }
  const vaultWallet = devnetWalletAddressOrNull("vault");
  if (!vaultWallet) return refuse(503, "SlabAR vault wallet is not configured on this server");
  if (wallet === vaultWallet) return refuse(400, "invalid_input: the vault wallet cannot acquire from itself");

  const offchainRecord = findOffchainRecord(assetId);
  const pre = evaluateAcquisitionEligibility({ offchainRecord, currentOwner: vaultWallet, vaultWallet });
  if (!pre.eligible || !offchainRecord?.commerce) {
    recordAudit("acquisition_refused", { wallet, detail: `${assetId}: ${pre.reasons.join("; ")}` });
    return refuse(409, NOT_ACQUIRABLE_MESSAGE, { reasons: pre.reasons });
  }
  if (findOpenByAsset(assetId)) return refuse(409, NOT_ACQUIRABLE_MESSAGE, { reasons: ["This work is being processed by another acquisition"] });
  if (isAssetInRedemption(assetId)) {
    recordAudit("acquisition_refused", { wallet, detail: `${assetId}: asset is in a redemption` });
    return refuse(409, NOT_ACQUIRABLE_MESSAGE, { reasons: ["This work has a redeem procedure in progress"] });
  }
  const reserved = reserveAcquisition({
    id: requestId,
    wallet,
    assetId,
    assetAddress,
    assetTitle: offchainRecord.title,
    listedPrice: { amount: offchainRecord.commerce.twinfoldPrice.amount, currency: offchainRecord.commerce.twinfoldPrice.currency },
  });
  if (!reserved.ok) {
    if (reserved.reason === "store_full") return refuse(429, "too many acquisitions, retry later");
    return refuse(409, NOT_ACQUIRABLE_MESSAGE, { reasons: ["This work is being processed by another acquisition"] });
  }
  const acq = reserved.acquisition;
  // The per-wallet cap counts only reservations that actually happened (refusals above never consume a slot).
  if (!takeSlot("acquire", wallet, ACQUISITIONS_PER_HOUR)) {
    markAcqFailed(acq, "rate_limited");
    recordAudit("acquisition_refused", { wallet, detail: "acquisition cap reached" });
    return refuse(429, "rate_limited: Acquisition limit reached (per hour). Please try again later.");
  }

  // ---- asynchronous part: the acquisition is already reserved ----
  try {
    // Re-read the on-chain owner right before signing. A status or a client claim is never proof of ownership.
    const current = await getAsset(assetAddress);
    const eligibility = evaluateAcquisitionEligibility({
      offchainRecord,
      currentOwner: current.ownership.owner,
      burnt: current.burnt,
      vaultWallet,
      redemptionOpen: isAssetInRedemption(assetId),
    });
    if (!eligibility.eligible) {
      markAcqFailed(acq, NOT_ACQUIRABLE_MESSAGE);
      recordAudit("acquisition_refused", { wallet, detail: `${assetId}: ${eligibility.reasons.join("; ")}` });
      return refuse(409, NOT_ACQUIRABLE_MESSAGE, { reasons: eligibility.reasons });
    }
    await assertVaultFunded();
  } catch (error) {
    if (error instanceof VaultLowBalanceError) {
      markAcqFailed(acq, VAULT_LOW_BALANCE_MESSAGE);
      return refuse(503, "vault_low_balance", { message: VAULT_LOW_BALANCE_MESSAGE });
    }
    console.error(`POST /api/acquisitions: pre-send check failed for ${assetId}`, error instanceof Error ? error.message : "unknown error");
    markAcqFailed(acq, "Could not check the state on devnet. Please try again later.");
    return refuse(502, "could not verify the asset on devnet");
  }

  // Send with the vault key. Respond once the signature is known (or the send failed); the confirm continues in the background.
  let signalSubmitted: () => void = () => {};
  const submitted = new Promise<void>((resolve) => (signalSubmitted = resolve));
  const done = sendDevnetTransferWithSigner({
    assetAddress,
    signer: loadDevnetKeypair("vault"),
    newOwner: wallet,
    onSubmitted: (signature, lastValidBlockHeight) => {
      acq.lastValidBlockHeight = lastValidBlockHeight;
      markAcqSubmitted(acq, signature);
      signalSubmitted();
    },
  })
    .then((result) => {
      if (result.error) markAcqFailed(acq, result.error); // a chain fact
      else markAcqConfirmed(acq, "send");
    })
    .catch(async (error) => {
      if (acq.signature) {
        // Already sent: a confirm timeout / RPC error says nothing about whether it lands. Stay `submitted`; GETs reconcile.
        console.error("acquisition confirm uncertain, staying submitted", error instanceof Error ? error.message : "unknown error");
      } else {
        console.error(`acquisition send failed for ${assetId}`, error instanceof Error ? error.message : "unknown error");
        // The send may have landed even though it threw (lost response): the chain owner decides before anything is called failed.
        try {
          const now = await getAsset(assetAddress);
          if (!now.burnt && now.ownership.owner === wallet) return void markAcqConfirmed(acq, "owner");
        } catch {
          // fall through to failed; the record stays reconcilable (sendUncertain)
        }
        acq.sendUncertain = true;
        markAcqFailed(acq, "Sending to devnet failed (check the vault wallet's SOL balance or the RPC)");
      }
    })
    .finally(signalSubmitted);
  await Promise.race([submitted, done]);

  return NextResponse.json(toAcquisitionView(acq), { status: acq.status === "failed" ? 502 : 201 });
}

/** GET /api/acquisitions -> { acquisitions } open + recent ones of the authenticated wallet (session or Bearer). */
export async function GET(request: Request) {
  const access = await authorize(request);
  if (!access.ok) return access.response;
  const mine = listForWallet(access.auth.wallet);
  await Promise.all(mine.map((a) => reconcileAcquisition(a)));
  return NextResponse.json({ acquisitions: mine.map(toAcquisitionView) });
}
