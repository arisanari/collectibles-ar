import { NextResponse } from "next/server";
import { decodeWalletAddress } from "../../../lib/auth/base58";
import { boundedString, readSmallJson } from "../../../lib/auth/http";
import { recordAudit } from "../../../lib/link/audit";
import { takeSlot } from "../../../lib/rateLimit";
import { resolveAssetAddress } from "../../../lib/solana/assetRegistry";
import { evaluateBuybackEligibility } from "../../../lib/solana/buybackEligibility";
import { devnetWalletAddressOrNull } from "../../../lib/solana/devnetAuthz";
import { getAsset } from "../../../lib/solana/heliusClient";
import { findOffchainRecord } from "../../../lib/solana/normalize";
import { authorize } from "../../../lib/transferRequests/access";
import { isTwinfoldOperatedWallet } from "../../../lib/redemptions/decide";
import { findOpenByAsset as findOpenRedemption } from "../../../lib/redemptions/store";
import { reconcileRequest } from "../../../lib/transferRequests/reconcile";
import {
  createRequest,
  findOpenByAsset,
  getRequest,
  listForWallet,
  toView,
  type TransferRequestKind,
} from "../../../lib/transferRequests/store";

export const dynamic = "force-dynamic";

const REQUEST_ID = /^[A-Za-z0-9_-]{8,64}$/;
/** Per-wallet cap on request creations: each approved one costs the vault a fee. */
const CREATES_PER_HOUR = 20;

type Outcome = { status: number; body: unknown };
type Inflight = { wallet: string; promise: Promise<Outcome> };
const g = globalThis as unknown as { __twinfoldCreateInflight?: Map<string, Inflight> };
const inflight: Map<string, Inflight> = (g.__twinfoldCreateInflight ??= new Map());

/**
 * POST /api/transfer-requests { requestId, assetId, kind: "buyback"|"send", toWallet? }
 * Device Bearer token (iPhone) or web session (same-origin). Creates an approval
 * request; nothing moves until the owner approves it on the Web with Phantom.
 * The server checks the on-chain owner is the authenticated wallet; for a
 * buyback it re-derives eligibility and resolves the destination to Twinfold's
 * vault wallet (never client-supplied). Idempotent by requestId (including
 * concurrent calls: the id is reserved synchronously, before any await). One open
 * request per asset. TTL 10 minutes. Capped per wallet per hour.
 */
export async function POST(request: Request) {
  const access = await authorize(request, { mutating: true });
  if (!access.ok) return access.response;
  const wallet = access.auth.wallet;
  const origin = access.auth.via === "device" ? "device" : "web";

  const body = await readSmallJson(request);
  const requestId = boundedString(body?.requestId, 64);
  const assetId = boundedString(body?.assetId, 64);
  const kind = body?.kind as TransferRequestKind | undefined;
  if (!requestId || !REQUEST_ID.test(requestId) || !assetId || (kind !== "buyback" && kind !== "send")) {
    return NextResponse.json({ error: "invalid_input: requestId, assetId, kind (buyback|send) are required" }, { status: 400 });
  }

  // Idempotent by requestId. Everything from here to inflight.set() is synchronous (no await), so
  // two concurrent calls with the same requestId cannot both pass.
  const existing = getRequest(requestId);
  if (existing) {
    if (existing.wallet !== wallet) return NextResponse.json({ error: "requestId belongs to another wallet" }, { status: 403 });
    return NextResponse.json(toView(existing));
  }
  const running = inflight.get(requestId);
  if (running) {
    if (running.wallet !== wallet) return NextResponse.json({ error: "requestId belongs to another wallet" }, { status: 403 });
    const outcome = await running.promise;
    return NextResponse.json(outcome.body, { status: outcome.status === 201 ? 200 : outcome.status });
  }

  if (!takeSlot("transfer-create", wallet, CREATES_PER_HOUR)) {
    recordAudit("transfer_refused", { wallet, detail: "request creation cap reached" });
    return NextResponse.json({ error: "rate_limited: Request creation limit reached (per hour). Please try again later." }, { status: 429 });
  }

  const promise = createFlow({ requestId, assetId, kind, wallet, origin, toWalletRaw: boundedString(body?.toWallet, 44) });
  inflight.set(requestId, { wallet, promise });
  try {
    const outcome = await promise;
    return NextResponse.json(outcome.body, { status: outcome.status });
  } finally {
    inflight.delete(requestId);
  }
}

async function createFlow(p: {
  requestId: string;
  assetId: string;
  kind: TransferRequestKind;
  wallet: string;
  origin: "web" | "device";
  toWalletRaw: string | null;
}): Promise<Outcome> {
  const { requestId, assetId, kind, wallet } = p;
  const err = (status: number, error: string, extra: object = {}): Outcome => ({ status, body: { error, ...extra } });

  let assetAddress: string;
  try {
    assetAddress = resolveAssetAddress(assetId);
  } catch (error) {
    return err(404, error instanceof Error ? error.message : "unknown asset");
  }

  // On-chain owner must be the authenticated wallet.
  let heliusAsset;
  try {
    heliusAsset = await getAsset(assetAddress);
  } catch (error) {
    console.error(`POST /api/transfer-requests: owner lookup failed for ${assetId}`, error);
    return err(502, "could not read the asset's on-chain owner");
  }
  if (heliusAsset.burnt || heliusAsset.ownership.owner !== wallet) {
    recordAudit("transfer_refused", { wallet, detail: `request for ${assetId}: not the on-chain owner` });
    return err(403, "not_owner: This wallet is not the current owner on devnet");
  }

  if (findOpenRedemption(assetId)) {
    recordAudit("transfer_refused", { wallet, detail: `request for ${assetId}: asset is in a redemption` });
    return err(409, "in_redemption", { message: "This work has a redeem procedure in progress, so it cannot be sold or sent" });
  }
  const open = findOpenByAsset(assetId);
  if (open) return err(409, "open_request_exists", { requestId: open.id, message: "This work has a request in progress" });

  const offchainRecord = findOffchainRecord(assetId);
  let toWallet: string;
  let toLabel: string | undefined;
  let quote;
  if (kind === "buyback") {
    const eligibility = evaluateBuybackEligibility({
      offchainRecord,
      currentOwner: heliusAsset.ownership.owner,
      burnt: heliusAsset.burnt,
      wallet,
    });
    if (!eligibility.eligible || !offchainRecord?.commerce) return err(409, "not_eligible", { reasons: eligibility.reasons });
    const vault = devnetWalletAddressOrNull("vault");
    if (!vault) return err(503, "OshiPin vault wallet is not configured on this server");
    const commerce = offchainRecord.commerce;
    toWallet = vault;
    toLabel = "OshiPin Vault";
    quote = {
      basis: { amount: commerce.twinfoldPrice.amount, currency: commerce.twinfoldPrice.currency },
      rate: commerce.buybackRate,
      offerAmount: Math.round(commerce.twinfoldPrice.amount * commerce.buybackRate * 100) / 100,
      currency: commerce.twinfoldPrice.currency,
    };
  } else {
    const to = p.toWalletRaw;
    if (!to || !decodeWalletAddress(to)) return err(400, "invalid_input: toWallet must be a base58 address");
    if (to === wallet) return err(400, "invalid_input: toWallet is the sender");
    // Twinfold's own wallets are reached only through buyback / redeem, never a plain send (an Asset could be stranded in escrow).
    if (isTwinfoldOperatedWallet(to, devnetWalletAddressOrNull("vault"), devnetWalletAddressOrNull("escrow"))) {
      recordAudit("transfer_refused", { wallet, detail: "send to a Twinfold-operated wallet refused" });
      return err(400, "invalid_input: To send to an OshiPin wallet, use Sell to OshiPin or Redeem instead");
    }
    toWallet = to;
  }

  const created = createRequest({
    id: requestId,
    wallet,
    assetId,
    assetAddress,
    assetTitle: offchainRecord?.title ?? assetId,
    kind,
    toWallet,
    toLabel,
    quote,
    origin: p.origin,
  });
  if (!created.ok) return err(429, "too many pending requests, retry later");
  return { status: 201, body: toView(created.request) };
}

/** GET /api/transfer-requests -> { requests } open + recently finished, for the web session's wallet. Non-terminal ones are reconciled with the chain first. */
export async function GET(request: Request) {
  const access = await authorize(request, { webOnly: true });
  if (!access.ok) return access.response;
  const mine = listForWallet(access.auth.wallet);
  await Promise.all(mine.map((r) => reconcileRequest(r)));
  return NextResponse.json({ requests: mine.map(toView) });
}
