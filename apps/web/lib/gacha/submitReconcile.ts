// Server-only. Answers, from the chain, whether a Pull's submit actually landed. Used when Collector Crypt's submitTransaction
// errored (HTTP 500, network error) so we cannot tell from its answer, and by /api/gacha/open and /api/gacha/pack/status.
//
// "No payment was made" is only said with grounds: (a) upstream's message names an expired blockhash (isTxExpiredFailure), or
// (b) here: the signature is NOT on chain and the blockhash window has passed, so the transaction can no longer land.
// An RPC failure, a bare 500 or a WAITING answer are never grounds. Devnet only: the routes call refuseMainnet first.
import { lookupSignature, type SignatureLookup } from "./openResult";
import { markFailed, markLanded, recordError, type GachaPackRecord } from "./packStore";

/**
 * After this long since a signed transaction was last handed to the relay, it can no longer land. A blockhash lives about 150
 * blocks (roughly 60-90 s); 5 minutes leaves a wide margin for slow clocks and RPC lag. Counted from the last relay attempt
 * (`lastSubmitAt`), not from when the pack was issued: the transaction was signed before that moment, so its blockhash is older,
 * and a late or repeated submit for the same memo is never judged against an earlier clock.
 */
export const LANDING_WINDOW_MS = 5 * 60 * 1000;

export type ReconcileOutcome =
  | "none" // nothing to ask (demo, opened, never submitted, already decided)
  | "landed" // on chain: the record is back to `submitted`
  | "unpaid" // not on chain and the window is over: recorded as tx_expired
  | "pending"; // cannot say yet: keep the memo, check again

export async function reconcileSubmit(
  record: GachaPackRecord,
  deps: { lookup?: (signature: string) => Promise<SignatureLookup>; now?: number } = {}
): Promise<ReconcileOutcome> {
  const lookup = deps.lookup ?? lookupSignature;
  const now = deps.now ?? Date.now();
  if (record.demo || record.state === "opened" || record.state === "generated") return "none";
  if (record.landed) return "none";
  if (record.lastError?.code === "tx_expired") return "none";
  const signatures = record.submitSignatures ?? [];
  if (signatures.length === 0) return "none";

  let sawUnknown = false;
  for (const signature of signatures) {
    const found = await lookup(signature);
    if (found === "landed") {
      markLanded(record, now);
      return "landed";
    }
    if (found === "unknown") sawUnknown = true;
  }
  const windowStart = Math.max(record.createdAt, record.lastSubmitAt ?? 0);
  if (!sawUnknown && now > windowStart + LANDING_WINDOW_MS) {
    recordError(
      record,
      { stage: "submit", code: "tx_expired", httpStatus: 0, message: "The signature is not on chain and the blockhash window has passed, so the transaction can no longer land." },
      now
    );
    markFailed(record, now);
    return "unpaid";
  }
  return "pending";
}
