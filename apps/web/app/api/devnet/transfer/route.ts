import { NextResponse } from "next/server";
import { getAsset } from "../../../../lib/solana/heliusClient";
import { resolveAssetAddress } from "../../../../lib/solana/assetRegistry";
import { findOffchainRecord } from "../../../../lib/solana/normalize";
import { isAssetInRedemption } from "../../../../lib/redemptions/store";
import { evaluateBuybackEligibility } from "../../../../lib/solana/buybackEligibility";
import { assertDevnetServerSigningAllowed } from "../../../../lib/solana/devnetSigningGuard";
import { devnetWalletAddress, sendDevnetTransfer } from "../../../../lib/solana/devnetTransfer";
import { normalizeDevnetWalletLabel } from "../../../../lib/solana/devnetKeys";
import { getTransferRecord, setTransferRecord, type DevnetTransferRecord } from "../../../../lib/solana/devnetTransferStore";
import { hasSameOrigin } from "../../../../lib/auth/http";
import { authenticateRequest } from "../../../../lib/auth/requestAuth";
import { recordAudit } from "../../../../lib/link/audit";
import {
  PHANTOM_SIGNING_REQUIRED_MESSAGE,
  SERVER_SIGNING_DISABLED_MESSAGE,
  testWalletLabelFor,
  unauthenticatedTransferEscapeEnabled,
} from "../../../../lib/solana/devnetAuthz";
import type { DevnetTransferResult } from "../../../../lib/contract";

export const dynamic = "force-dynamic";

/**
 * POST /api/devnet/transfer
 * body: { requestId, assetId, from: "owner-a"|"owner-b", to: "owner-a"|"owner-b"|"vault", quoteId? }
 *
 * DEV-ONLY SHORTCUT (Issue #29; real wallet signing is Issue #19/#45): the
 * Twinfold backend holds the devnet test wallets' secret keys and signs the
 * transfer itself, since apps/ios/apps/web have no wallet-signing UI yet.
 * Refuses unless devnetSigningGuard's three checks all pass (see that
 * file). SERVER SIGNING IS NOT AN OWNER PATH (Issue #45): real owners
 * approve with Phantom through /api/transfer-requests. This route refuses
 * (403) unless the insecure local flag
 * TWINFOLD_DEVNET_ALLOW_UNAUTHENTICATED_TRANSFER=1 is set (never in
 * production), kept only for local regression of the Owner A / Owner B test
 * rooms. With the flag on, a presented credential is still enforced: the
 * authenticated wallet must be the devnet address of the requested `from`
 * test wallet, else 403 (a wallet that is not owner-a/owner-b can never be
 * signed for here). The vault is never accepted as a sender.
 * Idempotent by `requestId` (AGENTS.md section 3): a repeated call
 * with the same requestId returns the stored result without re-sending.
 * `quoteId` is accepted but not looked up — a quote is advisory (UI display
 * only). When `to === "vault"` (a "Twinfoldに売る" buyback), eligibility is
 * re-derived here via `evaluateBuybackEligibility` (the same helper
 * `/api/solana/assets/[assetId]/buyback-quote` uses) right before signing,
 * not trusted from any prior quote; an ineligible request is refused with
 * 409 and nothing is sent.
 */
export async function POST(request: Request) {
  try {
    assertDevnetServerSigningAllowed();
  } catch (error) {
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "devnet server signing disabled" },
      { status: 403 }
    );
  }

  // Server-side signing is no longer an owner path (Issue #45): real owners
  // approve with Phantom via /api/transfer-requests. This endpoint remains only
  // as an insecure local-regression tool for the Owner A / Owner B test rooms.
  if (!unauthenticatedTransferEscapeEnabled()) {
    recordAudit("transfer_refused", { detail: "server-signed transfer disabled (insecure dev flag off)" });
    return NextResponse.json({ error: SERVER_SIGNING_DISABLED_MESSAGE }, { status: 403 });
  }

  // Even with the flag on, a credential that IS presented is enforced: the
  // authenticated wallet must be the requested sender's test wallet.
  const outcome = await authenticateRequest(request);
  let authWallet: string | null = null;
  let authLabel: "owner-a" | "owner-b" | null = null;
  if (outcome.ok) {
    authWallet = outcome.auth.wallet;
    if (outcome.auth.via === "cookie" && !hasSameOrigin(request)) {
      recordAudit("transfer_refused", { wallet: authWallet, detail: "forbidden origin" });
      return NextResponse.json({ error: "forbidden origin" }, { status: 403 });
    }
    // The dev server-signing shortcut can only sign for the test wallets.
    authLabel = testWalletLabelFor(authWallet);
    if (!authLabel) {
      recordAudit("transfer_refused", { wallet: authWallet, detail: "wallet is not a devnet test wallet" });
      return NextResponse.json({ error: PHANTOM_SIGNING_REQUIRED_MESSAGE }, { status: 403 });
    }
  } else if (outcome.status === 500) {
    return NextResponse.json({ error: outcome.error }, { status: outcome.status });
  } else if (request.headers.get("authorization")) {
    // A bad/expired/revoked token never silently falls through to the unauthenticated hatch.
    recordAudit("transfer_refused", { detail: `bad credential (${outcome.error})` });
    return NextResponse.json({ error: outcome.error }, { status: outcome.status });
  } else {
    console.warn("POST /api/devnet/transfer: UNAUTHENTICATED escape hatch in use (TWINFOLD_DEVNET_ALLOW_UNAUTHENTICATED_TRANSFER=1, dev only)");
  }

  const body = (await request.json().catch(() => null)) as {
    requestId?: string;
    assetId?: string;
    from?: string;
    to?: string;
    quoteId?: string;
  } | null;

  const { requestId, assetId, from, to } = body ?? {};
  if (!requestId || !assetId || !from || !to) {
    return NextResponse.json(
      { error: "missing required body field(s): requestId, assetId, from, to" },
      { status: 400 }
    );
  }

  let fromLabel: ReturnType<typeof normalizeDevnetWalletLabel>;
  let toLabel: ReturnType<typeof normalizeDevnetWalletLabel>;
  try {
    fromLabel = normalizeDevnetWalletLabel(from);
    toLabel = normalizeDevnetWalletLabel(to);
    if (fromLabel === "vault") {
      throw new Error('"vault" cannot be a transfer source in this dev shortcut');
    }
  } catch (error) {
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "invalid from/to" },
      { status: 400 }
    );
  }

  // The authenticated wallet must be the requested sender's wallet.
  if (authWallet && authLabel !== fromLabel) {
    recordAudit("transfer_refused", { wallet: authWallet, detail: `from ${fromLabel} is not the authenticated wallet` });
    return NextResponse.json(
      { error: `The authenticated wallet does not match the sender wallet (${fromLabel}). You can only send from your own wallet.` },
      { status: 403 }
    );
  }

  const existing = getTransferRecord(requestId);
  if (existing) {
    if (authWallet && existing.wallet && existing.wallet !== authWallet) {
      recordAudit("transfer_refused", { wallet: authWallet, detail: "requestId belongs to another wallet" });
      return NextResponse.json({ error: "requestId belongs to another wallet" }, { status: 403 });
    }
    return NextResponse.json(toResult(requestId, existing));
  }

  const save = (record: DevnetTransferRecord) => setTransferRecord(requestId, { ...record, wallet: authWallet ?? undefined });

  recordAudit("transfer_authorized", {
    wallet: authWallet ?? undefined,
    detail: `${outcome.ok ? outcome.auth.via : "UNAUTHENTICATED escape hatch"}: ${fromLabel} -> ${toLabel}`,
  });

  let address: string;
  try {
    address = resolveAssetAddress(assetId);
  } catch (error) {
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "unknown error" },
      { status: 404 }
    );
  }

  // If the on-chain owner already equals the target wallet (e.g. a prior
  // attempt succeeded but the client never saw the response), report
  // confirmed without sending anything new. Also fetches the current owner
  // once, reused below for the buyback eligibility check.
  const toAddress = devnetWalletAddress(toLabel);
  let currentOwner: string | null | undefined;
  let burnt = false;
  try {
    const heliusAsset = await getAsset(address);
    currentOwner = heliusAsset.ownership.owner;
    burnt = heliusAsset.burnt;
    if (currentOwner === toAddress) {
      const record = { assetId, status: "confirmed" as const };
      save(record);
      return NextResponse.json(toResult(requestId, record));
    }
  } catch (error) {
    console.error(`POST /api/devnet/transfer: pre-check failed for ${assetId}`, error);
    // fall through and attempt the transfer anyway
  }

  // An Asset in a redemption must not be sent anywhere (buyback or peer transfer).
  if (isAssetInRedemption(assetId)) {
    recordAudit("transfer_refused", { wallet: authWallet ?? undefined, detail: `${assetId}: asset is in a redemption` });
    const record = { assetId, status: "failed" as const, error: "This work has a redeem procedure in progress, so it cannot be transferred" };
    save(record);
    return NextResponse.json(toResult(requestId, record), { status: 409 });
  }

  // A "Twinfoldに売る" buyback: re-derive eligibility right before signing,
  // never trusting a client-supplied quoteId. `wallet` here is the sender's
  // own devnet wallet address (the one that must currently own the Asset).
  if (toLabel === "vault") {
    const offchainRecord = findOffchainRecord(assetId);
    const fromAddress = devnetWalletAddress(fromLabel);
    const { eligible, reasons } = evaluateBuybackEligibility({
      offchainRecord,
      currentOwner,
      burnt,
      wallet: fromAddress,
      redemptionOpen: isAssetInRedemption(assetId),
    });
    if (!eligible) {
      const message = `devnet: not eligible for OshiPin buyback: ${reasons.join("; ")}`;
      const record = { assetId, status: "failed" as const, error: message };
      save(record);
      return NextResponse.json(toResult(requestId, record), { status: 409 });
    }
  }

  save({ assetId, status: "pending" });

  try {
    const { signature } = await sendDevnetTransfer({ assetAddress: address, from: fromLabel, to: toLabel });
    const record = { assetId, status: "confirmed" as const, signature };
    save(record);
    return NextResponse.json(toResult(requestId, record));
  } catch (error) {
    const message = error instanceof Error ? error.message : "unknown error";
    console.error(`POST /api/devnet/transfer failed for ${assetId}`, error);
    const record = { assetId, status: "failed" as const, error: message };
    save(record);
    return NextResponse.json(toResult(requestId, record), { status: 502 });
  }
}

function toResult(
  requestId: string,
  record: { assetId: string; status: "pending" | "confirmed" | "failed"; signature?: string; error?: string }
): DevnetTransferResult {
  return {
    requestId,
    assetId: record.assetId,
    status: record.status,
    signature: record.signature,
    error: record.error,
  };
}
