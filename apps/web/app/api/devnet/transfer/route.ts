import { NextResponse } from "next/server";
import { getAsset } from "../../../../lib/solana/heliusClient";
import { resolveAssetAddress } from "../../../../lib/solana/assetRegistry";
import { findOffchainRecord } from "../../../../lib/solana/normalize";
import { evaluateBuybackEligibility } from "../../../../lib/solana/buybackEligibility";
import { assertDevnetServerSigningAllowed } from "../../../../lib/solana/devnetSigningGuard";
import { devnetWalletAddress, sendDevnetTransfer } from "../../../../lib/solana/devnetTransfer";
import { normalizeDevnetWalletLabel } from "../../../../lib/solana/devnetKeys";
import { getTransferRecord, setTransferRecord } from "../../../../lib/solana/devnetTransferStore";
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
 * file). Idempotent by `requestId` (AGENTS.md section 3): a repeated call
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

  const existing = getTransferRecord(requestId);
  if (existing) {
    return NextResponse.json(toResult(requestId, existing));
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
      setTransferRecord(requestId, record);
      return NextResponse.json(toResult(requestId, record));
    }
  } catch (error) {
    console.error(`POST /api/devnet/transfer: pre-check failed for ${assetId}`, error);
    // fall through and attempt the transfer anyway
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
    });
    if (!eligible) {
      const message = `devnet: not eligible for Twinfold buyback: ${reasons.join("; ")}`;
      const record = { assetId, status: "failed" as const, error: message };
      setTransferRecord(requestId, record);
      return NextResponse.json(toResult(requestId, record), { status: 409 });
    }
  }

  setTransferRecord(requestId, { assetId, status: "pending" });

  try {
    const { signature } = await sendDevnetTransfer({ assetAddress: address, from: fromLabel, to: toLabel });
    const record = { assetId, status: "confirmed" as const, signature };
    setTransferRecord(requestId, record);
    return NextResponse.json(toResult(requestId, record));
  } catch (error) {
    const message = error instanceof Error ? error.message : "unknown error";
    console.error(`POST /api/devnet/transfer failed for ${assetId}`, error);
    const record = { assetId, status: "failed" as const, error: message };
    setTransferRecord(requestId, record);
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
