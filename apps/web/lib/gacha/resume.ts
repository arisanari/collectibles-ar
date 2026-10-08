// Pure decision logic for resuming a saved Pull memo (no React, no server imports: used by usePull.ts, the status
// route and the unit tests).
//
// Why: a Pull whose payment never reached the chain (the memo failed before it was paid) used to be resumed on every
// visit to /pull, polling /api/gacha/open forever and hiding the Pull button. Before resuming, the client now asks
// GET /api/gacha/pack/status for the server's own record (`local`) and Collector Crypt's view (`remote`) and lets
// resolveResume() decide.

export type ResumeLocalState = "generated" | "submitted" | "opened" | "failed";

/** The server's pack record, as GET /api/gacha/pack/status returns it. `createdAt` is when the pack was issued. */
export type ResumeLocal = {
  state: ResumeLocalState;
  lastError?: { at?: string; stage: string; code: string; httpStatus: number; message: string } | null;
  createdAt?: string | number;
  /** A submit signature was seen on chain: the payment went through. */
  landed?: boolean;
};

/** What Collector Crypt's /api/pack/status says. `null` (instead of this object) means Collector Crypt did not answer. */
export type RemotePackStatus = { paid: boolean; opened: boolean; refunded: boolean };

/** A pack must be opened within 2 hours of being issued (Collector Crypt); past that an unpaid memo is treated as failed. */
export const UNPAID_WINDOW_MS = 2 * 60 * 60 * 1000;

export type ResumeDecision =
  /** The card was received: fetch it again with /api/gacha/open (same memo, same card). */
  | { action: "open" }
  /** Paid but not opened yet: resume polling /api/gacha/open. */
  | { action: "poll" }
  /** Do not resume: forget the memo. `failed_unpaid`: failed before payment; `expired_unpaid`: unpaid past the 2 hour window; `refunded`: Collector Crypt refunded it. */
  | { action: "drop"; reason: "failed_unpaid" | "expired_unpaid" | "refunded" }
  /** Not paid as far as we can see, but still inside the 2 hour window: keep the memo, offer Pull and "Check again". */
  | { action: "unconfirmed" };

function asObject(value: unknown): Record<string, unknown> | null {
  return value !== null && typeof value === "object" && !Array.isArray(value) ? (value as Record<string, unknown>) : null;
}

/**
 * Collector Crypt's GET /api/pack/status body ({ memo, pack: {status, webhook_received, refunded, refund_transaction_signature, ...} | null,
 * send: {status, nft_address, ...} | null, buyback: [] }) -> paid / opened / refunded. A body that is not an object is `null`.
 *   opened   = a `send` (the card transfer) exists and is confirmed, or names an nft_address
 *   refunded = pack.refunded is set (not null / false) or a refund transaction signature exists
 *   paid     = opened, or pack.status is "confirmed", or the payment webhook was received
 * `pack.status` null (the failed Pull of 2026-10-06) is paid:false.
 */
export function remoteFromCc(body: unknown): RemotePackStatus | null {
  const root = asObject(body);
  if (!root) return null;
  const pack = asObject(root.pack);
  const send = asObject(root.send);
  const opened = Boolean(send && (send.status === "confirmed" || (typeof send.nft_address === "string" && send.nft_address !== "")));
  const refunded = Boolean(
    pack &&
      ((pack.refunded !== null && pack.refunded !== undefined && pack.refunded !== false) ||
        (typeof pack.refund_transaction_signature === "string" && pack.refund_transaction_signature !== ""))
  );
  const paid = opened || Boolean(pack && (pack.status === "confirmed" || pack.webhook_received === true));
  return { paid, opened, refunded };
}

function issuedMs(createdAt: string | number | undefined): number | null {
  if (typeof createdAt === "number") return Number.isFinite(createdAt) ? createdAt : null;
  if (typeof createdAt === "string") {
    const ms = Date.parse(createdAt);
    return Number.isNaN(ms) ? null : ms;
  }
  return null;
}

/**
 * Decides what to do with a saved memo.
 *   1. local opened, or remote opened                    -> open  (fetch the card again)
 *   2. remote refunded                                    -> drop (refunded)
 *   3. remote paid (not opened yet)                       -> poll
 *   4. local landed (signature seen on chain)             -> poll
 *   5. local failed with tx_expired (confirmed unpaid)    -> drop (failed_unpaid)
 *   6. local generated / submitted / failed (other cause), unpaid:
 *        issued more than 2 hours ago                     -> drop (expired_unpaid)
 *        otherwise (or the issue time is unknown)         -> unconfirmed
 * `now` is epoch ms.
 */
export function resolveResume(local: ResumeLocal, remote: RemotePackStatus | null, now: number): ResumeDecision {
  if (local.state === "opened" || remote?.opened) return { action: "open" };
  if (remote?.refunded) return { action: "drop", reason: "refunded" };
  if (remote?.paid || local.landed) return { action: "poll" };
  // Only a confirmed non-payment (tx_expired: upstream said the blockhash ran out, or the chain showed no signature after the
  // blockhash window) drops a failed record at once. Any other failure (HTTP 500, network error) leaves it unconfirmed below.
  if (local.state === "failed" && local.lastError?.code === "tx_expired") return { action: "drop", reason: "failed_unpaid" };
  const issued = issuedMs(local.createdAt);
  if (issued !== null && now - issued > UNPAID_WINDOW_MS) return { action: "drop", reason: "expired_unpaid" };
  return { action: "unconfirmed" };
}
