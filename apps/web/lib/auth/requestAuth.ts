import { cookies } from "next/headers";
import { verifyDeviceToken } from "../link/store";
import { readSessionToken, SESSION_COOKIE } from "./session";

export type RequestAuth = {
  wallet: string;
  via: "cookie" | "device";
  expiresAt: number;
};

export type AuthOutcome =
  | { ok: true; auth: RequestAuth }
  | { ok: false; status: 401 | 500; error: string };

export function bearerToken(request: Request): string | null {
  const header = request.headers.get("authorization");
  if (!header) return null;
  const match = /^Bearer\s+(\S+)$/i.exec(header);
  return match ? match[1] : null;
}

/**
 * Best-effort client address for rate limiting. X-Forwarded-For / X-Real-IP are client-controllable headers:
 * they are only trustworthy behind a known reverse proxy that overwrites them. Without a proxy an attacker
 * can rotate them to dodge the per-IP bucket, which is why the global backstop in lib/link/store.ts exists.
 * "unknown" (no header) is not rate limited per IP, only globally.
 */
export function clientIp(request: Request): string {
  const forwarded = request.headers.get("x-forwarded-for")?.split(",")[0]?.trim();
  return forwarded || request.headers.get("x-real-ip") || "unknown";
}

/** Web session cookie only. */
export async function authenticateCookie(): Promise<AuthOutcome> {
  try {
    const token = (await cookies()).get(SESSION_COOKIE)?.value;
    const session = readSessionToken(token);
    if (!session) return { ok: false, status: 401, error: "unauthenticated" };
    return { ok: true, auth: { wallet: session.wallet, via: "cookie", expiresAt: session.expiresAt } };
  } catch {
    return { ok: false, status: 500, error: "server misconfigured" };
  }
}

/**
 * Cookie session or device Bearer token. A Bearer header, when present, is the
 * only credential considered (a bad token is 401 even if a cookie exists), so
 * a stale iPhone token never silently falls through to another identity.
 */
export async function authenticateRequest(request: Request): Promise<AuthOutcome> {
  const bearer = bearerToken(request);
  if (bearer !== null) {
    try {
      const result = verifyDeviceToken(bearer);
      if (!result.ok) return { ok: false, status: 401, error: `device_session_${result.reason}` };
      return { ok: true, auth: { wallet: result.wallet, via: "device", expiresAt: result.expiresAt } };
    } catch {
      return { ok: false, status: 500, error: "server misconfigured" };
    }
  }
  if (request.headers.get("authorization")) return { ok: false, status: 401, error: "unauthenticated" };
  return authenticateCookie();
}
