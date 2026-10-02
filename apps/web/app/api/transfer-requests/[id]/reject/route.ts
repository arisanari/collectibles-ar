import { NextResponse } from "next/server";
import { authorize, ownedRequest } from "../../../../../lib/transferRequests/access";
import { markRejected, toView } from "../../../../../lib/transferRequests/store";

export const dynamic = "force-dynamic";

/** POST /api/transfer-requests/[id]/reject  (web session, same-origin). Only a request that is not yet submitted can be rejected. */
export async function POST(request: Request, context: { params: Promise<{ id: string }> }) {
  const access = await authorize(request, { webOnly: true, mutating: true });
  if (!access.ok) return access.response;
  const { id } = await context.params;
  const found = ownedRequest(id, access.auth.wallet);
  if (!found.ok) return found.response;
  const r = found.request;

  if (r.status === "rejected") return NextResponse.json(toView(r));
  const rejectable = r.status === "awaiting_approval" || (r.status === "failed" && r.retryable === true);
  if (!rejectable || r.submitting) return NextResponse.json({ error: `request is ${r.status}`, status: r.status }, { status: 409 });
  markRejected(r);
  return NextResponse.json(toView(r));
}
