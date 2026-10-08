import { cookies } from "next/headers";
import { NextResponse } from "next/server";
import { readSessionToken, SESSION_COOKIE } from "../../../../lib/auth/session";

export const dynamic = "force-dynamic";

/**
 * GET /api/auth/session -> { wallet, expiresAt } or 401.
 * GET /api/auth/session?soft=1 -> the same, but "no session" is a normal 200 { authenticated: false }, so the page's
 * on-load session check does not log a 401 in the browser console for a visitor who has not signed in.
 */
export async function GET(request: Request) {
  const soft = new URL(request.url).searchParams.get("soft") === "1";
  const token = (await cookies()).get(SESSION_COOKIE)?.value;
  let session = null;
  try {
    session = readSessionToken(token);
  } catch {
    return NextResponse.json({ error: "server misconfigured" }, { status: 500 });
  }
  if (!session) return soft ? NextResponse.json({ authenticated: false }) : NextResponse.json({ error: "unauthenticated" }, { status: 401 });
  return NextResponse.json({ authenticated: true, wallet: session.wallet, expiresAt: new Date(session.expiresAt).toISOString() });
}
