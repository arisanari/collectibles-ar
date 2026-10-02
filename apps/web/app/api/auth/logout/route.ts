import { NextResponse } from "next/server";
import { hasSameOrigin } from "../../../../lib/auth/http";
import { authenticateCookie } from "../../../../lib/auth/requestAuth";
import { SESSION_COOKIE, sessionCookieOptions } from "../../../../lib/auth/session";
import { revokeDevicesForWallet } from "../../../../lib/link/store";

export const dynamic = "force-dynamic";

/** POST /api/auth/logout -> clears the session cookie and revokes every device token issued for that wallet (#45) */
export async function POST(request: Request) {
  if (!hasSameOrigin(request)) return NextResponse.json({ error: "forbidden origin" }, { status: 403 });
  const outcome = await authenticateCookie();
  const revoked = outcome.ok ? revokeDevicesForWallet(outcome.auth.wallet, "web logout") : 0;
  const response = NextResponse.json({ ok: true, revoked });
  response.cookies.set(SESSION_COOKIE, "", sessionCookieOptions(0));
  return response;
}
