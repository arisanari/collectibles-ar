import { NextResponse } from "next/server";
import { authorize } from "../../../../lib/transferRequests/access";
import { ownedRedemption } from "../../../../lib/redemptions/access";
import { reconcileRedemption } from "../../../../lib/redemptions/flow";

export const dynamic = "force-dynamic";

/** GET /api/redemptions/[id] -> the redemption (own wallet only). Device Bearer token or web session. Reconciled with the chain first. */
export async function GET(request: Request, context: { params: Promise<{ id: string }> }) {
  const access = await authorize(request);
  if (!access.ok) return access.response;
  const { id } = await context.params;
  const found = ownedRedemption(id, access.auth.wallet);
  if (!found.ok) return found.response;
  await reconcileRedemption(found.redemption);
  return NextResponse.json(found.redemption);
}
