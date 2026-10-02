// Server-only. Keeps request status consistent with the chain (Issue #45 review A2).
//
// Rules:
// - A request status is never proof of ownership; clients that care re-read the on-chain owner.
// - Once a transaction has been sent (signature known) a confirm timeout / RPC
//   error must NOT turn the request into `failed`: it stays `submitted` and is
//   reconciled here from getSignatureStatuses.
// - If the on-chain owner already equals the destination, the transfer is done
//   (`confirmed`), whatever the status said (e.g. the response was lost).
// - `failed` is only set from a chain fact: the signature's status carries an
//   error, or the signature is unknown AND its blockhash can no longer land
//   (retryable, a new transaction is needed).

import { getAsset } from "../solana/heliusClient";
import { blockhashIsDead, fetchSignatureState } from "./chain";
import { markConfirmedFromChain, markFailed, type TransferRequest } from "./store";

export const RECONCILE_MIN_INTERVAL_MS = 5000;

export type ReconcileTarget = {
  signature?: string;
  lastValidBlockHeight?: number;
  assetAddress: string;
  destination: string;
  holder: { reconciledAt?: number; reconciling?: boolean };
  onConfirmed: (how: "signature" | "owner") => void;
  onFailed: (error: string, retryable: boolean) => void;
};

/** Best-effort: RPC errors leave the status unchanged. Throttled per target. */
export async function reconcileWithChain(t: ReconcileTarget, now = Date.now()): Promise<void> {
  const h = t.holder;
  if (h.reconciling || (h.reconciledAt && now - h.reconciledAt < RECONCILE_MIN_INTERVAL_MS)) return;
  h.reconciling = true;
  h.reconciledAt = now;
  try {
    if (t.signature) {
      const s = await fetchSignatureState(t.signature);
      if (s.state === "confirmed") return t.onConfirmed("signature");
      if (s.state === "failed") return t.onFailed(s.error ?? "transaction failed on devnet", false);
    }
    const asset = await getAsset(t.assetAddress);
    if (!asset.burnt && asset.ownership.owner === t.destination) return t.onConfirmed("owner");
    if (t.signature && t.lastValidBlockHeight && (await blockhashIsDead(t.lastValidBlockHeight))) {
      // The transaction may have landed between the first status read and the height check: look once more before failing.
      const again = await fetchSignatureState(t.signature);
      if (again.state === "confirmed") return t.onConfirmed("signature");
      if (again.state === "failed") return t.onFailed(again.error ?? "transaction failed on devnet", false);
      t.onFailed("承認の有効期限（ブロックハッシュ）が切れ、送信した取引は確定しませんでした。もう一度承認してください", true);
    }
  } catch {
    // leave the status as it is; the next read tries again
  } finally {
    h.reconciling = false;
  }
}

/** Reconcile a non-terminal transfer request (awaiting_approval, submitted, or retryable failure). */
export async function reconcileRequest(r: TransferRequest): Promise<void> {
  const reconcilable = r.status === "awaiting_approval" || r.status === "submitted" || (r.status === "failed" && r.retryable === true);
  if (!reconcilable || r.submitting) return;
  await reconcileWithChain({
    signature: r.signature,
    lastValidBlockHeight: r.prepared?.lastValidBlockHeight,
    assetAddress: r.assetAddress,
    destination: r.toWallet,
    holder: r,
    onConfirmed: (how) => markConfirmedFromChain(r, how),
    onFailed: (error, retryable) => {
      if (r.status !== "failed") markFailed(r, error, retryable); // no repeated audit entries for an already failed request
    },
  });
}
