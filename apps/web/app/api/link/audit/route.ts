import { NextResponse } from "next/server";
import { authenticateCookie } from "../../../../lib/auth/requestAuth";
import { auditFor } from "../../../../lib/link/audit";

export const dynamic = "force-dynamic";

/** GET /api/link/audit -> { events } newest first, only this session's wallet (in-memory ring buffer, see lib/link/audit.ts). */
export async function GET() {
  const outcome = await authenticateCookie();
  if (!outcome.ok) return NextResponse.json({ error: outcome.error }, { status: outcome.status });
  return NextResponse.json({ events: auditFor(outcome.auth.wallet) });
}
