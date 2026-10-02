import { randomBytes } from "node:crypto";

/**
 * Audit trail for device linking and owner-only operations (Issue #45).
 *
 * Every event is (1) written as one structured JSON log line and (2) kept in a
 * process-local ring buffer so the Web UI can show a wallet its own recent
 * events (GET /api/link/audit). Codes, tokens and secrets are NEVER recorded in
 * full: only short references (`ref`) that cannot be used to authenticate.
 *
 * MVP LIMITATION: the ring buffer is in-memory (lost on restart, not shared
 * across instances). The log lines are the durable record.
 */

export type AuditEvent =
  | "code_issued"
  | "code_exchanged"
  | "code_exchange_failed"
  | "code_expired"
  | "token_revoked"
  | "token_expired"
  | "transfer_authorized"
  | "transfer_refused"
  | "transfer_request_created"
  | "transfer_request_prepared"
  | "transfer_request_submitted"
  | "transfer_request_confirmed"
  | "transfer_request_failed"
  | "transfer_request_rejected"
  | "transfer_request_expired"
  | "acquisition_created"
  | "acquisition_submitted"
  | "acquisition_confirmed"
  | "acquisition_failed"
  | "acquisition_refused"
  | "redemption_requested"
  | "redemption_lock_requested"
  | "redemption_locked"
  | "redemption_shipped"
  | "redemption_received"
  | "redemption_retired"
  | "redemption_cancelled"
  | "redemption_exception"
  | "redemption_retry"
  | "redemption_refused"
  | "passport_written";

export type AuditEntry = {
  id: string;
  at: string; // ISO 8601 UTC
  event: AuditEvent;
  wallet?: string; // shortened public address
  detail?: string; // reason / short reference, never a secret
};

const MAX_ENTRIES = 500;

const globalForAudit = globalThis as unknown as { __twinfoldAuditRing?: { entries: AuditEntry[]; fullWallets: string[] } };
const ring = (globalForAudit.__twinfoldAuditRing ??= { entries: [], fullWallets: [] });

export function shortWallet(wallet: string): string {
  return wallet.length > 10 ? `${wallet.slice(0, 4)}...${wallet.slice(-4)}` : wallet;
}

/** First chars only; use for jti / code hashes so logs can be correlated but not replayed. */
export function ref(value: string): string {
  return value.slice(0, 6);
}

export function recordAudit(event: AuditEvent, fields: { wallet?: string; detail?: string } = {}, now = Date.now()): void {
  const entry: AuditEntry = {
    id: randomBytes(6).toString("hex"),
    at: new Date(now).toISOString(),
    event,
    wallet: fields.wallet ? shortWallet(fields.wallet) : undefined,
    detail: fields.detail,
  };
  ring.entries.push(entry);
  ring.fullWallets.push(fields.wallet ?? "");
  if (ring.entries.length > MAX_ENTRIES) {
    ring.entries.shift();
    ring.fullWallets.shift();
  }
  console.log(JSON.stringify({ tag: "twinfold.audit", ...entry }));
}

/** Newest first. Only events attributed to `wallet` are returned. */
export function auditFor(wallet: string, limit = 50): AuditEntry[] {
  const out: AuditEntry[] = [];
  for (let i = ring.entries.length - 1; i >= 0 && out.length < limit; i--) {
    if (ring.fullWallets[i] === wallet) out.push(ring.entries[i]);
  }
  return out;
}
