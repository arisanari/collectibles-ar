import { cookies } from "next/headers";
import { NextResponse } from "next/server";
import { verifyChallenge } from "../../../../lib/auth/challenge";
import {
  boundedString,
  hasSameOrigin,
  MAX_SIGNATURE_LEN,
  MAX_WALLET_LEN,
  PREAUTH_COOKIE,
  readSmallJson,
} from "../../../../lib/auth/http";
import { createSessionToken, SESSION_COOKIE, sessionCookieOptions } from "../../../../lib/auth/session";

export const dynamic = "force-dynamic";

/** POST /api/auth/verify { wallet, nonce, signature(base58) } -> sets session cookie */
export async function POST(request: Request) {
  if (!hasSameOrigin(request)) return NextResponse.json({ error: "forbidden origin" }, { status: 403 });
  const body = await readSmallJson(request);
  const wallet = boundedString(body?.wallet, MAX_WALLET_LEN);
  const nonce = boundedString(body?.nonce, 64);
  const signature = boundedString(body?.signature, MAX_SIGNATURE_LEN);
  if (!wallet || !nonce || !signature) {
    return NextResponse.json({ error: "invalid_input" }, { status: 400 });
  }
  const binding = (await cookies()).get(PREAUTH_COOKIE)?.value ?? "";

  const result = verifyChallenge({ wallet, nonce, signature, binding });
  if (!result.ok) {
    const status = result.reason === "invalid_input" ? 400 : 401;
    return NextResponse.json({ error: result.reason }, { status });
  }

  let session;
  try {
    session = createSessionToken(result.wallet);
  } catch {
    console.error("auth/verify: session secret is missing or too short (TWINFOLD_SESSION_SECRET)");
    return NextResponse.json({ error: "server misconfigured" }, { status: 500 });
  }
  const response = NextResponse.json({ wallet: result.wallet, expiresAt: new Date(session.expiresAt).toISOString() });
  response.cookies.set(SESSION_COOKIE, session.token, sessionCookieOptions(Math.floor((session.expiresAt - Date.now()) / 1000)));
  response.cookies.set(PREAUTH_COOKIE, "", sessionCookieOptions(0));
  return response;
}
