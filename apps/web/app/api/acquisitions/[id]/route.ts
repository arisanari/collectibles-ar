import { NextResponse } from "next/server";
import { reconcileAcquisition } from "../../../../lib/acquisitions/reconcile";
import { getAcquisition, toAcquisitionView } from "../../../../lib/acquisitions/store";
import { authorize } from "../../../../lib/transferRequests/access";

export const dynamic = "force-dynamic";

/**
 * GET /api/acquisitions/[id] -> status (+ signature once known). Web session or device Bearer token;
 * the acquisition must belong to the authenticated wallet (another wallet's id is reported as not found).
 * A non-terminal acquisition is reconciled with the chain first (signature status / on-chain owner).
 */
export async function GET(request: Request, context: { params: Promise<{ id: string }> }) {
  const access = await authorize(request);
  if (!access.ok) return access.response;
  const { id } = await context.params;
  const found = getAcquisition(id);
  if (!found || found.wallet !== access.auth.wallet) return NextResponse.json({ error: "acquisition not found" }, { status: 404 });
  await reconcileAcquisition(found);
  return NextResponse.json(toAcquisitionView(found));
}
