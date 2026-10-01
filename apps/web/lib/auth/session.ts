import { createHmac, timingSafeEqual } from "node:crypto";

export const SESSION_COOKIE = "twinfold_session";
export const SESSION_TTL_MS = 60 * 60 * 1000; // 1 hour, short-lived by design

function secret(): string {
  const value = process.env.TWINFOLD_SESSION_SECRET;
  if (!value || value.length < 16) {
    throw new Error("TWINFOLD_SESSION_SECRET is not set (server-only env, min 16 chars). See apps/web/.env.example.");
  }
  return value;
}

function sign(payload: string) {
  return createHmac("sha256", secret()).update(payload).digest("base64url");
}

export function createSessionToken(wallet: string, now = Date.now()) {
  const expiresAt = now + SESSION_TTL_MS;
  const payload = Buffer.from(JSON.stringify({ w: wallet, exp: expiresAt })).toString("base64url");
  return { token: `${payload}.${sign(payload)}`, expiresAt };
}

export function readSessionToken(token: string | undefined, now = Date.now()): { wallet: string; expiresAt: number } | null {
  if (!token) return null;
  const [payload, mac] = token.split(".");
  if (!payload || !mac) return null;
  const expected = Buffer.from(sign(payload));
  const actual = Buffer.from(mac);
  if (expected.length !== actual.length || !timingSafeEqual(expected, actual)) return null;
  try {
    const { w, exp } = JSON.parse(Buffer.from(payload, "base64url").toString("utf8")) as { w?: string; exp?: number };
    if (typeof w !== "string" || typeof exp !== "number" || exp <= now) return null;
    return { wallet: w, expiresAt: exp };
  } catch {
    return null;
  }
}

export function sessionCookieOptions(maxAgeSeconds: number) {
  return {
    httpOnly: true,
    sameSite: "lax" as const,
    secure: process.env.NODE_ENV === "production",
    path: "/",
    maxAge: maxAgeSeconds,
  };
}
