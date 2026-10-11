// Shared helpers for app/api/gacha/* route handlers (server-only).
import { NextResponse } from "next/server";
import { decodeWalletAddress } from "../auth/base58";
import { authorize } from "../transferRequests/access";
import { GachaApiError } from "./types";

export const PACK_TYPE = /^[a-z0-9_]{1,40}$/;
export const MEMO = /^[A-Za-z0-9_.:-]{4,200}$/;
const BASE64 = /^[A-Za-z0-9+/]+={0,2}$/;

export function isWalletAddress(value: unknown): value is string {
  return typeof value === "string" && value.length <= 44 && decodeWalletAddress(value) !== null;
}

/** DEMO DATA player / nft addresses look like "DEMO-PLAYER-WALLET" and are not base58. */
export function isDemoAddress(value: unknown): value is string {
  return typeof value === "string" && /^[A-Za-z0-9_-]{4,64}$/.test(value);
}

/** A real wallet address, or (in DEMO DATA mode only) a DEMO-style placeholder. */
export function isPlayerAddress(value: unknown, demo: boolean): value is string {
  return demo ? isDemoAddress(value) : isWalletAddress(value);
}

export function isBase64Transaction(value: unknown): value is string {
  return typeof value === "string" && value.length > 0 && value.length <= 4096 && BASE64.test(value);
}

/** Upstream refusal -> JSON the UI can tell apart: busy_pending (429), busy_opening (503), machine_off_balance, upstream_error. */
export function gachaErrorResponse(error: unknown): NextResponse {
  if (error instanceof GachaApiError) {
    const text = `${error.message} ${error.details ?? ""}`;
    const kind =
      error.status === 429 ? "busy_pending" : error.status === 503 ? "busy_opening" : /off balance/i.test(text) ? "machine_off_balance" : "upstream_error";
    const status = error.status === 429 || error.status === 503 ? error.status : 502;
    console.warn("gacha upstream refused", kind, error.status, error.message, error.details ?? "");
    return NextResponse.json({ error: kind, message: error.message, ...(error.details ? { details: error.details } : {}) }, { status });
  }
  console.error("gacha route failed", error instanceof Error ? error.message : "unknown error");
  return NextResponse.json({ error: "server_error", message: "Unexpected server error" }, { status: 500 });
}

/**
 * Non-demo Pull calls need the signed-in web session (same-origin POST) so nobody can drive our server-side
 * Collector Crypt calls anonymously. DEMO DATA calls touch no network and need no session.
 */
export async function requireSession(request: Request, demo: boolean): Promise<{ ok: true; wallet: string | null } | { ok: false; response: NextResponse }> {
  if (demo) return { ok: true, wallet: null };
  const access = await authorize(request, { webOnly: true, mutating: true });
  if (!access.ok) return access;
  return { ok: true, wallet: access.auth.wallet };
}

/** Same as requireSession for GET routes: the web session cookie is required (non-demo), but there is no same-origin POST check. */
export async function requireSessionRead(request: Request, demo: boolean): Promise<{ ok: true; wallet: string | null } | { ok: false; response: NextResponse }> {
  if (demo) return { ok: true, wallet: null };
  const access = await authorize(request, { webOnly: true });
  if (!access.ok) return access;
  return { ok: true, wallet: access.auth.wallet };
}

/** Per-hour caps (sliding window, lib/rateLimit.ts). open: per wallet + memo; submit / buyback: per wallet. */
export const OPEN_PER_HOUR = 300;
export const SUBMIT_PER_HOUR = 60;
export const BUYBACK_PER_HOUR = 30;

export function rateLimited(): NextResponse {
  return NextResponse.json({ error: "rate_limited", message: "Too many requests. Please try again later." }, { status: 429 });
}

export function memoNotOwned(): NextResponse {
  // Someone else's memo and an unknown memo are reported the same way.
  return NextResponse.json({ error: "memo_not_owned", message: "This memo does not belong to the signed-in wallet" }, { status: 403 });
}
