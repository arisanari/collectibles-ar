// Server-only. Same reconciliation rules as transfer requests (see
// lib/transferRequests/reconcile.ts): a sent acquisition stays `submitted` until the
// chain says otherwise; the on-chain owner equal to the buyer means confirmed.

import { reconcileWithChain } from "../transferRequests/reconcile";
import { markAcqConfirmed, markAcqFailed, UNCERTAIN_RECONCILE_MS, type Acquisition } from "./store";

export async function reconcileAcquisition(a: Acquisition): Promise<void> {
  const uncertainFailed = a.status === "failed" && a.sendUncertain === true && Date.now() - a.updatedAt < UNCERTAIN_RECONCILE_MS;
  if (a.status !== "submitted" && !uncertainFailed) return; // `pending` is still being sent by the POST that reserved it
  await reconcileWithChain({
    signature: a.signature,
    lastValidBlockHeight: a.lastValidBlockHeight,
    assetAddress: a.assetAddress,
    destination: a.wallet,
    holder: a,
    onConfirmed: (how) => {
      a.sendUncertain = undefined;
      markAcqConfirmed(a, how);
    },
    onFailed: (error) => markAcqFailed(a, error),
  });
}
