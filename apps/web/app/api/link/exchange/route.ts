import { NextResponse } from "next/server";
import { boundedString, readSmallJson } from "../../../../lib/auth/http";
import { clientIp } from "../../../../lib/auth/requestAuth";
import { exchangeLinkCode } from "../../../../lib/link/store";

export const dynamic = "force-dynamic";

const STATUS = { invalid_code: 400, unknown_code: 404, expired: 410, already_used: 409, rate_limited: 429 } as const;

/**
 * POST /api/link/exchange { code, deviceName? } -> { token, wallet, expiresAt }
 * Called by the iPhone, so no cookie and no Origin check. Failed attempts are
 * rate limited per IP and globally (lockout -> 429 + Retry-After) because the
 * code is short. The code is burned on success.
 */
export async function POST(request: Request) {
  const body = await readSmallJson(request);
  const code = boundedString(body?.code, 32);
  if (!code) return NextResponse.json({ error: "invalid_input" }, { status: 400 });
  const deviceName = typeof body?.deviceName === "string" ? body.deviceName.slice(0, 80) : "";

  let result;
  try {
    result = exchangeLinkCode(code, deviceName, clientIp(request));
  } catch {
    console.error("link/exchange: session secret is missing or too short (TWINFOLD_SESSION_SECRET)");
    return NextResponse.json({ error: "server misconfigured" }, { status: 500 });
  }
  if (!result.ok) {
    const response = NextResponse.json({ error: result.reason }, { status: STATUS[result.reason] });
    if (result.retryAfterMs) response.headers.set("Retry-After", String(Math.ceil(result.retryAfterMs / 1000)));
    return response;
  }
  const response = NextResponse.json({
    token: result.token,
    wallet: result.wallet,
    expiresAt: new Date(result.expiresAt).toISOString(),
  });
  response.headers.set("Cache-Control", "no-store");
  return response;
}
