import type { AcquisitionStatus, AcquisitionView } from "../contract";
import { recordAudit, ref } from "../link/audit";

/**
 * "Twinfoldから取得" requests (Issue #60): an authenticated wallet acquires an
 * Asset that Twinfold's vault wallet holds. Only the vault signs (dev-only
 * server signing); the buyer's key is never needed. No payment happens: the
 * listed price is Twinfold's off-chain interpretation, shown for display only.
 *
 * Status: pending (reserved / sending) -> submitted (signature known) -> confirmed | failed.
 * Once `submitted`, never `failed` on a timeout: reconciled from the chain (see
 * lib/transferRequests/reconcile.ts). `failed` is a chain fact or a pre-send refusal.
 *
 * MVP LIMITATION: process-local in-memory store (lost on restart).
 */

export type { AcquisitionStatus, AcquisitionView };

export const MAX_ACQUISITIONS = 500;
const RETENTION_MS = 60 * 60 * 1000;
const RECENT_MS = 15 * 60 * 1000;

export type Acquisition = {
  id: string; // requestId
  wallet: string; // the buyer: authenticated wallet (never from the body)
  assetId: string;
  assetAddress: string;
  assetTitle: string;
  listedPrice: { amount: number; currency: string };
  status: AcquisitionStatus;
  createdAt: number;
  updatedAt: number;
  signature?: string;
  error?: string;
  lastValidBlockHeight?: number;
  /** Set when the send threw before a signature was known: the transfer may still have landed, so a `failed` record stays reconcilable for a short window. */
  sendUncertain?: boolean;
  reconciledAt?: number;
  reconciling?: boolean;
};

const g = globalThis as unknown as { __twinfoldAcquisitions?: Map<string, Acquisition> };
const acquisitions: Map<string, Acquisition> = (g.__twinfoldAcquisitions ??= new Map());

/** How long a `failed` record with an uncertain send keeps being checked against the chain. */
export const UNCERTAIN_RECONCILE_MS = 5 * 60 * 1000;

export const isOpen = (a: Acquisition) => a.status === "pending" || a.status === "submitted";

/** A `pending` acquisition that never got a signature within this time is dropped as failed (hung RPC), so it cannot block the asset forever. */
export const PENDING_MAX_MS = 2 * 60 * 1000;

function sweep(now: number) {
  acquisitions.forEach((a, id) => {
    if (a.status === "pending" && now - a.createdAt > PENDING_MAX_MS) markAcqFailed(a, "The acquisition did not finish in time. Please try again.", now);
    if (!isOpen(a) && a.updatedAt + RETENTION_MS <= now) acquisitions.delete(id);
  });
}

export function getAcquisition(id: string): Acquisition | undefined {
  return acquisitions.get(id);
}

export function findOpenByAsset(assetId: string): Acquisition | undefined {
  for (const a of Array.from(acquisitions.values())) if (a.assetId === assetId && isOpen(a)) return a;
  return undefined;
}

export function listForWallet(wallet: string, now = Date.now()): Acquisition[] {
  sweep(now);
  return Array.from(acquisitions.values())
    .filter((a) => a.wallet === wallet && (isOpen(a) || now - a.updatedAt < RECENT_MS))
    .sort((x, y) => y.createdAt - x.createdAt);
}

export type ReserveResult =
  | { ok: true; acquisition: Acquisition }
  | { ok: false; reason: "exists"; acquisition: Acquisition }
  | { ok: false; reason: "asset_busy"; acquisition: Acquisition }
  | { ok: false; reason: "store_full" };

/**
 * Synchronous reservation: idempotent by id, one in-flight acquisition per asset.
 * Callers must not await between their own checks and this call.
 */
export function reserveAcquisition(
  input: Pick<Acquisition, "id" | "wallet" | "assetId" | "assetAddress" | "assetTitle" | "listedPrice">,
  now = Date.now(),
): ReserveResult {
  sweep(now);
  const existing = acquisitions.get(input.id);
  if (existing) return { ok: false, reason: "exists", acquisition: existing };
  const busy = findOpenByAsset(input.assetId);
  if (busy) return { ok: false, reason: "asset_busy", acquisition: busy };
  if (acquisitions.size >= MAX_ACQUISITIONS) return { ok: false, reason: "store_full" };
  const acquisition: Acquisition = { ...input, status: "pending", createdAt: now, updatedAt: now };
  acquisitions.set(acquisition.id, acquisition);
  recordAudit("acquisition_created", { wallet: acquisition.wallet, detail: `acq ${ref(acquisition.id)} ${acquisition.assetId}` }, now);
  return { ok: true, acquisition };
}

export function markAcqSubmitted(a: Acquisition, signature: string, now = Date.now()) {
  a.status = "submitted";
  a.signature = signature;
  a.updatedAt = now;
  recordAudit("acquisition_submitted", { wallet: a.wallet, detail: `acq ${ref(a.id)} tx ${ref(signature)}` }, now);
}

export function markAcqConfirmed(a: Acquisition, how: "signature" | "owner" | "send" = "send", now = Date.now()) {
  a.status = "confirmed";
  a.error = undefined;
  a.updatedAt = now;
  recordAudit("acquisition_confirmed", { wallet: a.wallet, detail: `acq ${ref(a.id)} (${how})` }, now);
}

export function markAcqFailed(a: Acquisition, error: string, now = Date.now()) {
  a.status = "failed";
  a.error = error;
  a.updatedAt = now;
  recordAudit("acquisition_failed", { wallet: a.wallet, detail: `acq ${ref(a.id)} ${error.slice(0, 120)}` }, now);
}

/** What clients see. The price is display-only (Twinfold interpretation, off-chain); no payment happens. */
export function toAcquisitionView(a: Acquisition): AcquisitionView {
  return {
    requestId: a.id,
    assetId: a.assetId,
    assetTitle: a.assetTitle,
    status: a.status,
    buyerWallet: a.wallet,
    listedPrice: a.listedPrice,
    paymentMade: false,
    signature: a.signature,
    error: a.error,
    createdAt: new Date(a.createdAt).toISOString(),
    updatedAt: new Date(a.updatedAt).toISOString(),
  };
}
