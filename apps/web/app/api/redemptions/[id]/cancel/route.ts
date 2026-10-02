import { NextResponse } from "next/server";
import { authorize } from "../../../../../lib/transferRequests/access";
import { ownedRedemption } from "../../../../../lib/redemptions/access";
import { escrowAddress, escrowTransferTo, fetchOwnerViaRpc } from "../../../../../lib/redemptions/chain";
import { reconcileRedemption, withdrawLockRequest } from "../../../../../lib/redemptions/flow";
import { markCancelled, markLocked, recordRefusal, runtimeOf } from "../../../../../lib/redemptions/store";
import { getRequest } from "../../../../../lib/transferRequests/store";
import { assertDevnetServerSigningAllowed } from "../../../../../lib/solana/devnetSigningGuard";

export const dynamic = "force-dynamic";

const refuse = (status: number, error: string, extra: object = {}) => NextResponse.json({ error, ...extra }, { status });

/**
 * POST /api/redemptions/[id]/cancel  (owner, web session, same-origin)
 * Allowed only in `requested` or `locked`. A locked redemption's Asset is returned from escrow to the owner
 * (escrow-signed transfer, fee payer = vault) before the redemption is marked `cancelled`; if that return fails
 * nothing changes (still `locked`). Refused after `shipped` (409).
 * Concurrency: `busy` is taken synchronously right after the final status check and before any await that signs,
 * and the operator route refuses while it is set, so a `ship` cannot slip in between the check and the return transfer.
 * `cancelled` is never inferred from a (possibly stale) DAS read.
 */
export async function POST(request: Request, context: { params: Promise<{ id: string }> }) {
  const access = await authorize(request, { webOnly: true, mutating: true });
  if (!access.ok) return access.response;
  const { id } = await context.params;
  const found = ownedRedemption(id, access.auth.wallet);
  if (!found.ok) return found.response;
  const r = found.redemption;
  const rt = runtimeOf(r.id);

  if (r.status === "cancelled") return NextResponse.json(r);
  if (rt.busy) return refuse(409, "処理中です。しばらくしてから再試行してください");
  await reconcileRedemption(r, Date.now() + 10_000);

  // A lock that landed on chain but is not recorded yet must be recorded before we decide anything (RPC, not DAS).
  if (r.status === "requested") {
    const lock = r.lockRequestId ? getRequest(r.lockRequestId) : undefined;
    if (lock && (lock.status === "submitted" || lock.status === "confirmed" || lock.submitting)) {
      return refuse(409, "Phantomの署名が処理中、または確定しています。画面を更新して、lock済みになってから取り消してください", { status: r.status });
    }
    const escrow = escrowAddress();
    if (escrow) {
      const owner = await fetchOwnerViaRpc(r.assetAddress);
      if (owner === null) return refuse(502, "Assetの状態をdevnetから読み取れませんでした。時間をおいて再試行してください");
      if (owner === escrow && r.status === "requested") markLocked(r, lock?.signature);
    }
  }

  // ---- no await between the status check and taking `busy` ----
  if (rt.busy) return refuse(409, "処理中です。しばらくしてから再試行してください");
  if (r.status !== "requested" && r.status !== "locked") {
    recordRefusal(r.wallet, `redemption ${r.id.slice(0, 6)}: cancel refused in ${r.status}`);
    return refuse(409, r.status === "exception" ? "例外停止中のため取り消せません（operatorの対応待ちです）" : "発送後は取り消せません", { status: r.status });
  }
  rt.busy = true;
  try {
    if (r.status === "requested") {
      const withdrawn = withdrawLockRequest(r);
      if (!withdrawn.ok) return refuse(409, "Phantomの署名が処理中です。確定後に取り消してください", { status: r.status });
      if (!markCancelled(r, undefined).ok) return refuse(409, "この状態では取り消せません", { status: r.status });
      return NextResponse.json(r);
    }

    // locked: return the Asset from escrow to the owner first.
    try {
      assertDevnetServerSigningAllowed();
    } catch (error) {
      return refuse(403, error instanceof Error ? error.message : "devnet server signing disabled");
    }
    if (!escrowAddress()) return refuse(503, "escrow wallet is not configured on this server");
    rt.returnSignature = undefined;
    try {
      const result = await escrowTransferTo({ assetAddress: r.assetAddress, to: r.wallet, onSubmitted: (s) => (rt.returnSignature = s) });
      if (result.error || !result.signature) {
        recordRefusal(r.wallet, `redemption ${r.id.slice(0, 6)}: return from escrow failed`);
        return refuse(502, result.error ?? "escrowからの返却に失敗しました", { status: r.status });
      }
      if (!markCancelled(r, result.signature).ok) {
        // The state machine refused after the Asset already moved: surface it, never report success.
        console.error(`redemption ${r.id.slice(0, 6)}: cancel refused by the state machine after the return was sent`);
        return refuse(409, "取り消しを記録できませんでした。operatorの確認が必要です", { status: r.status });
      }
      return NextResponse.json(r);
    } catch (error) {
      // Return sent but confirmation uncertain: stay `locked`; reconcile cancels only once rt.returnSignature is confirmed.
      console.error("redemption cancel failed", error instanceof Error ? error.message : "unknown error");
      return refuse(502, rt.returnSignature ? "返却の確定を確認中です。しばらくして画面を更新してください" : "escrowからの返却に失敗しました。Assetはescrowに残っています", { status: r.status });
    }
  } finally {
    rt.busy = false;
  }
}
