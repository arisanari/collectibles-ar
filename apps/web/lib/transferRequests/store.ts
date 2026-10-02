import type { TransferRequestKind, TransferRequestStatus, TransferRequestView } from "../contract";
import { recordAudit, ref } from "../link/audit";

/**
 * Owner-approved transfer requests (Issue #45, design change).
 *
 * The iPhone (device token) or the Web (/collection button) creates a request;
 * the owner approves it on the Web: the browser's Phantom signs a transaction
 * the server prepared (fee payer = Twinfold vault) and the server submits it.
 * The server never signs for the owner.
 *
 * Status: awaiting_approval -> submitted -> confirmed | failed ; or rejected | expired.
 * `failed` with `retryable` (e.g. blockhash expired) may be re-prepared and re-approved
 * until the request itself expires.
 *
 * MVP LIMITATION: process-local in-memory store (like lib/auth/challenge.ts);
 * lost on restart, not shared across instances.
 */

export type { TransferRequestKind, TransferRequestStatus, TransferRequestView };

export const REQUEST_TTL_MS = 10 * 60 * 1000;
export const MAX_REQUESTS = 500;
const RECENT_TERMINAL_MS = 15 * 60 * 1000; // terminal requests stay listed (and retrievable) this long
const RETENTION_MS = 60 * 60 * 1000;

export type TransferRequest = {
  id: string;
  wallet: string; // the owner: authenticated wallet that created it
  assetId: string;
  assetAddress: string;
  assetTitle: string;
  kind: TransferRequestKind;
  toWallet: string;
  /** Where the request was created: the Web session, or an iPhone device token (shown to the approver). */
  origin: "web" | "device";
  toLabel?: string; // "Twinfold Vault" for buyback
  /** Set for kind "redeem_lock": the Redemption this approval locks the Asset for. */
  redemptionId?: string;
  quote?: { basis: { amount: number; currency: string }; rate: number; offerAmount: number; currency: string };
  status: TransferRequestStatus;
  createdAt: number;
  updatedAt: number;
  expiresAt: number;
  signature?: string;
  error?: string;
  retryable?: boolean;
  prepared?: { transactionB64: string; lastValidBlockHeight: number; preparedAt: number };
  /** True while a submit is in flight, so a double click cannot send twice. */
  submitting?: boolean;
  /** Last chain reconciliation (throttle for reads) and in-flight flag. */
  reconciledAt?: number;
  reconciling?: boolean;
};

const g = globalThis as unknown as { __twinfoldTransferRequests?: Map<string, TransferRequest> };
const requests: Map<string, TransferRequest> = (g.__twinfoldTransferRequests ??= new Map());

const isOpen = (r: TransferRequest) => r.status === "awaiting_approval" || r.status === "submitted";

/** Applies lazy expiry and returns the request. */
function touch(r: TransferRequest, now: number): TransferRequest {
  if (r.status === "awaiting_approval" && r.expiresAt <= now) {
    r.status = "expired";
    r.updatedAt = now;
    recordAudit("transfer_request_expired", { wallet: r.wallet, detail: `request ${ref(r.id)}` }, now);
  }
  return r;
}

function sweep(now: number) {
  requests.forEach((r, id) => {
    touch(r, now);
    if (!isOpen(r) && r.updatedAt + RETENTION_MS <= now) requests.delete(id);
  });
}

export function getRequest(id: string, now = Date.now()): TransferRequest | undefined {
  const r = requests.get(id);
  return r ? touch(r, now) : undefined;
}

export function findOpenByAsset(assetId: string, now = Date.now()): TransferRequest | undefined {
  for (const r of Array.from(requests.values())) {
    if (r.assetId === assetId && isOpen(touch(r, now))) return r;
  }
  return undefined;
}

/** Open requests plus recently finished ones, newest first. */
export function listForWallet(wallet: string, now = Date.now()): TransferRequest[] {
  sweep(now);
  return Array.from(requests.values())
    .filter((r) => r.wallet === wallet && (isOpen(r) || now - r.updatedAt < RECENT_TERMINAL_MS))
    .sort((a, b) => b.createdAt - a.createdAt);
}

export function createRequest(
  input: Pick<TransferRequest, "id" | "wallet" | "assetId" | "assetAddress" | "assetTitle" | "kind" | "toWallet" | "toLabel" | "quote" | "origin" | "redemptionId">,
  now = Date.now(),
): { ok: true; request: TransferRequest } | { ok: false; reason: "store_full" } {
  sweep(now);
  if (requests.size >= MAX_REQUESTS) return { ok: false, reason: "store_full" };
  const request: TransferRequest = {
    ...input,
    status: "awaiting_approval",
    createdAt: now,
    updatedAt: now,
    expiresAt: now + REQUEST_TTL_MS,
  };
  requests.set(request.id, request);
  recordAudit(
    "transfer_request_created",
    { wallet: request.wallet, detail: `request ${ref(request.id)} ${request.kind} ${request.assetId}` },
    now,
  );
  return { ok: true, request };
}

export function markPrepared(r: TransferRequest, prepared: { transactionB64: string; lastValidBlockHeight: number }, now = Date.now()) {
  r.prepared = { ...prepared, preparedAt: now };
  r.signature = undefined; // a new transaction supersedes the earlier (dead) one
  r.status = "awaiting_approval";
  r.error = undefined;
  r.retryable = undefined;
  r.updatedAt = now;
  recordAudit("transfer_request_prepared", { wallet: r.wallet, detail: `request ${ref(r.id)}` }, now);
}

export function markSubmitted(r: TransferRequest, signature: string, now = Date.now()) {
  r.status = "submitted";
  r.signature = signature;
  r.updatedAt = now;
  recordAudit("transfer_request_submitted", { wallet: r.wallet, detail: `request ${ref(r.id)} tx ${ref(signature)}` }, now);
}

export function markConfirmed(r: TransferRequest, now = Date.now()) {
  r.status = "confirmed";
  r.updatedAt = now;
  recordAudit("transfer_request_confirmed", { wallet: r.wallet, detail: `request ${ref(r.id)}` }, now);
}

/** Chain facts override a stale status (signature status or on-chain owner == destination). */
export function markConfirmedFromChain(r: TransferRequest, how: "signature" | "owner", now = Date.now()) {
  r.status = "confirmed";
  r.error = undefined;
  r.retryable = undefined;
  r.updatedAt = now;
  recordAudit("transfer_request_confirmed", { wallet: r.wallet, detail: `request ${ref(r.id)} (reconciled by ${how})` }, now);
}

export function markFailed(r: TransferRequest, error: string, retryable: boolean, now = Date.now()) {
  r.status = "failed";
  r.error = error;
  r.retryable = retryable;
  r.updatedAt = now;
  recordAudit("transfer_request_failed", { wallet: r.wallet, detail: `request ${ref(r.id)} ${retryable ? "(retryable) " : ""}${error.slice(0, 120)}` }, now);
}

export function markRejected(r: TransferRequest, now = Date.now()) {
  r.status = "rejected";
  r.updatedAt = now;
  recordAudit("transfer_request_rejected", { wallet: r.wallet, detail: `request ${ref(r.id)}` }, now);
}

/** What clients see (`TransferRequestView` in contract.ts). Never includes the prepared transaction. */
export function toView(r: TransferRequest): TransferRequestView {
  return {
    requestId: r.id,
    assetId: r.assetId,
    assetTitle: r.assetTitle,
    kind: r.kind,
    status: r.status,
    toWallet: r.toWallet,
    toLabel: r.toLabel,
    redemptionId: r.redemptionId,
    origin: r.origin,
    quote: r.quote,
    signature: r.signature,
    error: r.error,
    retryable: r.retryable,
    createdAt: new Date(r.createdAt).toISOString(),
    expiresAt: new Date(r.expiresAt).toISOString(),
  };
}
