import { cookies } from "next/headers";
import { NextResponse } from "next/server";
import { readSessionToken, SESSION_COOKIE } from "../../../../lib/auth/session";

export const dynamic = "force-dynamic";

/** GET /api/auth/session -> { wallet, expiresAt } or 401 */
export async function GET() {
  const token = (await cookies()).get(SESSION_COOKIE)?.value;
  let session = null;
  try {
    session = readSessionToken(token);
  } catch {
    return NextResponse.json({ error: "server misconfigured" }, { status: 500 });
  }
  if (!session) return NextResponse.json({ error: "unauthenticated" }, { status: 401 });
  return NextResponse.json({ wallet: session.wallet, expiresAt: new Date(session.expiresAt).toISOString() });
}
