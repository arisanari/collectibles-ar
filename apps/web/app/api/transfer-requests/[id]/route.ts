import { NextResponse } from "next/server";
import { authorize, ownedRequest } from "../../../../lib/transferRequests/access";
import { reconcileRequest } from "../../../../lib/transferRequests/reconcile";
import { toView } from "../../../../lib/transferRequests/store";

export const dynamic = "force-dynamic";

/** GET /api/transfer-requests/[id] -> status (+ signature once known). Device Bearer token or web session; must be the requester's wallet. */
export async function GET(request: Request, context: { params: Promise<{ id: string }> }) {
  const access = await authorize(request);
  if (!access.ok) return access.response;
  const { id } = await context.params;
  const found = ownedRequest(id, access.auth.wallet);
  if (!found.ok) return found.response;
  await reconcileRequest(found.request); // status must not disagree with the chain (signature status / on-chain owner)
  return NextResponse.json(toView(found.request));
}
