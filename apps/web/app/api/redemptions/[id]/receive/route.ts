import { NextResponse } from "next/server";
import { authorize } from "../../../../../lib/transferRequests/access";
import { ownedRedemption } from "../../../../../lib/redemptions/access";
import { runRetire } from "../../../../../lib/redemptions/flow";
import { markReceived, recordRefusal, runtimeOf } from "../../../../../lib/redemptions/store";

export const dynamic = "force-dynamic";

/**
 * POST /api/redemptions/[id]/receive  (owner, web session, same-origin)
 * "受け取りを確認" (dry run: nothing was really shipped). Allowed only in `shipped`. Then the circulating Asset
 * is retired (burned from the escrow wallet, fee payer = vault) and the Redeemed Provenance Passport is written.
 * Any failure in the retire is a safe stop: status `exception`, the Asset stays in escrow, only the operator
 * (`retry_retire`) can resume. Idempotent: already received / retired returns the current state.
 */
export async function POST(request: Request, context: { params: Promise<{ id: string }> }) {
  const access = await authorize(request, { webOnly: true, mutating: true });
  if (!access.ok) return access.response;
  const { id } = await context.params;
  const found = ownedRedemption(id, access.auth.wallet);
  if (!found.ok) return found.response;
  const r = found.redemption;

  if (r.status === "received" || r.status === "retired") return NextResponse.json(r);
  if (runtimeOf(r.id).busy) return NextResponse.json(r);
  if (r.status !== "shipped") {
    recordRefusal(r.wallet, `redemption ${r.id.slice(0, 6)}: receive refused in ${r.status}`);
    return NextResponse.json({ error: "発送済みの状態でのみ受け取りを確認できます", status: r.status }, { status: 409 });
  }
  markReceived(r);
  await runRetire(r);
  return NextResponse.json(r);
}
