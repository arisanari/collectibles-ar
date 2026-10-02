import { NextResponse } from "next/server";
import { bearerToken } from "../../../../lib/auth/requestAuth";
import { verifyDeviceToken } from "../../../../lib/link/store";

export const dynamic = "force-dynamic";

/** GET /api/link/session  (Authorization: Bearer <device token>) -> { wallet, expiresAt } or 401 (expired / revoked / invalid). */
export async function GET(request: Request) {
  const token = bearerToken(request);
  if (!token) return NextResponse.json({ error: "unauthenticated" }, { status: 401 });
  let result;
  try {
    result = verifyDeviceToken(token);
  } catch {
    return NextResponse.json({ error: "server misconfigured" }, { status: 500 });
  }
  if (!result.ok) return NextResponse.json({ error: result.reason }, { status: 401 });
  return NextResponse.json({ wallet: result.wallet, expiresAt: new Date(result.expiresAt).toISOString() });
}
