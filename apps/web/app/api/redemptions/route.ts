import { NextResponse } from "next/server";
import { boundedString, readSmallJson } from "../../../lib/auth/http";
import { recordAudit } from "../../../lib/link/audit";
import { takeSlot } from "../../../lib/rateLimit";
import { escrowAddress, ESCROW_NOT_CONFIGURED_MESSAGE } from "../../../lib/redemptions/chain";
import { ensureLockRequest, reconcileRedemption } from "../../../lib/redemptions/flow";
import { createRedemption, findPersonalDataKey, getRedemption, listForWallet } from "../../../lib/redemptions/store";
import { resolveAssetAddress } from "../../../lib/solana/assetRegistry";
import { assertDevnetServerSigningAllowed } from "../../../lib/solana/devnetSigningGuard";
import { getAsset } from "../../../lib/solana/heliusClient";
import { findOffchainRecord } from "../../../lib/solana/normalize";
import { authorize } from "../../../lib/transferRequests/access";
import { findOpenByAsset as findOpenTransferRequest } from "../../../lib/transferRequests/store";

export const dynamic = "force-dynamic";

const REQUEST_ID = /^[A-Za-z0-9_-]{8,64}$/;
/** Per-wallet cap on redemption requests per hour (each one costs the vault fees). */
const REDEMPTIONS_PER_HOUR = 10;

const refuse = (status: number, error: string, extra: object = {}) => NextResponse.json({ error, ...extra }, { status });

/**
 * POST /api/redemptions { requestId, assetId }   (Redeem Physical, dry run)
 * Web session (same-origin) or device Bearer token. The requester is ALWAYS the authenticated wallet. The
 * on-chain owner is re-read and must be that wallet; the Asset must be Vault-held (custody vaulted) and not
 * already in a redemption (one open redemption per asset, per-wallet cap, idempotent by requestId). Creates a
 * `requested` redemption and the owner-approval request (kind `redeem_lock`) that moves the Asset into
 * Twinfold's redemption escrow (signed by the owner in Phantom on the Web). Nothing moves until then.
 * NO personal data is accepted: a body with name/address/phone/etc. is refused. No real shipping happens.
 */
export async function POST(request: Request) {
  const access = await authorize(request, { mutating: true });
  if (!access.ok) return access.response;
  const wallet = access.auth.wallet;
  const origin = access.auth.via === "device" ? "device" : "web";

  const body = await readSmallJson(request);
  const personal = findPersonalDataKey(body);
  if (personal) {
    recordAudit("redemption_refused", { wallet, detail: `body contained a personal-data field (${personal.slice(0, 20)})` });
    return refuse(400, "personal_data_not_accepted: This dry run does not accept names, addresses, phone numbers or similar");
  }
  const requestId = boundedString(body?.requestId, 64);
  const assetId = boundedString(body?.assetId, 64);
  if (!requestId || !REQUEST_ID.test(requestId) || !assetId) return refuse(400, "invalid_input: requestId and assetId are required");

  // Idempotent by requestId: the same request returns the existing redemption (re-issuing an expired lock approval if needed).
  const existing = getRedemption(requestId);
  if (existing) {
    if (existing.wallet !== wallet) return refuse(403, "requestId belongs to another wallet");
    ensureLockRequest(existing, findOffchainRecord(existing.assetId)?.title ?? existing.assetId, origin);
    await reconcileRedemption(existing);
    return NextResponse.json(existing);
  }

  let assetAddress: string;
  try {
    assetAddress = resolveAssetAddress(assetId);
  } catch (error) {
    return refuse(404, error instanceof Error ? error.message : "unknown asset");
  }
  try {
    assertDevnetServerSigningAllowed(); // the lock approval's fee payer is the vault: same explicit dev-only gate
  } catch (error) {
    return refuse(403, error instanceof Error ? error.message : "devnet server signing disabled");
  }
  if (!escrowAddress()) return refuse(503, "escrow_not_configured", { message: ESCROW_NOT_CONFIGURED_MESSAGE });

  if (!takeSlot("redeem-create", wallet, REDEMPTIONS_PER_HOUR)) {
    recordAudit("redemption_refused", { wallet, detail: "redemption request cap reached" });
    return refuse(429, "rate_limited: Request limit reached (per hour). Please try again later.");
  }

  // The on-chain owner must be the authenticated wallet. A client claim or a status is never proof of ownership.
  let current;
  try {
    current = await getAsset(assetAddress);
  } catch (error) {
    console.error(`POST /api/redemptions: owner lookup failed for ${assetId}`, error instanceof Error ? error.message : "unknown error");
    return refuse(502, "could not read the asset's on-chain owner");
  }
  if (current.burnt || current.ownership.owner !== wallet) {
    recordAudit("redemption_refused", { wallet, detail: `${assetId}: not the on-chain owner` });
    return refuse(403, "not_owner: This wallet is not the current owner on devnet");
  }
  const record = findOffchainRecord(assetId);
  if (record?.physical?.custody.status !== "vaulted") {
    recordAudit("redemption_refused", { wallet, detail: `${assetId}: custody is not vaulted` });
    return refuse(409, "not_eligible", { reasons: ["Only Vaulted works can be redeemed"] });
  }
  if (findOpenTransferRequest(assetId)) {
    return refuse(409, "open_request_exists", { message: "This work has a transfer request in progress. Complete or reject it, then request again" });
  }

  const created = createRedemption({ id: requestId, wallet, assetId, assetAddress, assetTitle: record.title });
  if (!created.ok) {
    if (created.reason === "exists") return NextResponse.json(created.redemption);
    if (created.reason === "asset_busy") return refuse(409, "redemption_in_progress", { redemptionId: created.redemption.id, message: "This work is already in a redemption procedure" });
    if (created.reason === "wallet_cap") return refuse(429, "too_many_open_redemptions: You have reached the limit of redemptions in progress at once");
    return refuse(429, "too many redemptions, retry later");
  }
  ensureLockRequest(created.redemption, record.title, origin);
  return NextResponse.json(created.redemption, { status: 201 });
}

/** GET /api/redemptions -> { redemptions } of the web session's wallet, reconciled with the chain first. */
export async function GET(request: Request) {
  const access = await authorize(request, { webOnly: true });
  if (!access.ok) return access.response;
  const mine = listForWallet(access.auth.wallet);
  await Promise.all(mine.map((r) => reconcileRedemption(r)));
  return NextResponse.json({ redemptions: mine });
}
