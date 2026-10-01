import { randomBytes } from "node:crypto";
import { NextResponse } from "next/server";
import { CHALLENGE_TTL_MS, issueChallenge } from "../../../../lib/auth/challenge";
import { boundedString, hasSameOrigin, MAX_WALLET_LEN, PREAUTH_COOKIE, readSmallJson } from "../../../../lib/auth/http";
import { sessionCookieOptions } from "../../../../lib/auth/session";

export const dynamic = "force-dynamic";

/** POST /api/auth/challenge { wallet } -> { nonce, message, expiresAt }; also sets a pre-auth cookie binding the challenge to this browser. */
export async function POST(request: Request) {
  if (!hasSameOrigin(request)) return NextResponse.json({ error: "forbidden origin" }, { status: 403 });
  const body = await readSmallJson(request);
  const wallet = boundedString(body?.wallet, MAX_WALLET_LEN);
  if (!wallet) return NextResponse.json({ error: "valid wallet is required" }, { status: 400 });

  const binding = randomBytes(16).toString("hex");
  const domain = request.headers.get("host") ?? "localhost";
  const challenge = issueChallenge(domain, wallet, binding);
  if (!challenge.ok) {
    return challenge.reason === "store_full"
      ? NextResponse.json({ error: "too many pending challenges, retry later" }, { status: 429 })
      : NextResponse.json({ error: "invalid wallet address" }, { status: 400 });
  }
  const response = NextResponse.json({ nonce: challenge.nonce, message: challenge.message, expiresAt: challenge.expiresAt });
  response.cookies.set(PREAUTH_COOKIE, binding, sessionCookieOptions(Math.floor(CHALLENGE_TTL_MS / 1000)));
  return response;
}
