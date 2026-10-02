import { NextResponse } from "next/server";
import { authenticateCookie } from "../../../../lib/auth/requestAuth";
import { listDevices } from "../../../../lib/link/store";

export const dynamic = "force-dynamic";

/** GET /api/link/devices -> { devices: [{ id, name, linkedAt, expiresAt }] } for the session's wallet. */
export async function GET() {
  const outcome = await authenticateCookie();
  if (!outcome.ok) return NextResponse.json({ error: outcome.error }, { status: outcome.status });
  return NextResponse.json({ devices: listDevices(outcome.auth.wallet) });
}
