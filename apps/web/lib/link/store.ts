import { createHash, createHmac, randomBytes, randomInt, timingSafeEqual } from "node:crypto";
import { recordAudit, ref } from "./audit";

/**
 * One-time link codes + device sessions (Issue #45, docs/architecture.md
 * section 7 "Web -> iOS AR").
 *
 * Flow: authenticated Web session issues a short code -> iPhone exchanges it
 * (no cookie) -> server burns the code and issues a device token bound to the
 * same wallet. The token is an HMAC-signed value AND registered here, so it
 * can be revoked and so a server restart invalidates every device session.
 *
 * Nothing here holds or accepts a private key / seed phrase: the only secret
 * handled is TWINFOLD_SESSION_SECRET (server env) used for the HMAC.
 *
 * MVP LIMITATION: all state is process-local (globalThis Maps), like
 * lib/auth/challenge.ts. Fine for `next dev` / one Node server; on serverless
 * or multiple instances a code issued on one instance is unknown to another.
 * Move to a shared store (KV/DB) before any multi-instance deployment.
 */

// ---- tunables --------------------------------------------------------------

export const CODE_LENGTH = 8;
/** Unambiguous: no 0/O, 1/I/L. 31 symbols^8 ~ 8.5e11 combinations. */
export const CODE_ALPHABET = "ABCDEFGHJKMNPQRSTUVWXYZ23456789";
export const DEVICE_TOKEN_TTL_MS = 12 * 60 * 60 * 1000;
export const MAX_CODES = 2000; // live + tombstones
export const MAX_DEVICES = 1000;
export const MAX_DEVICES_PER_WALLET = 10;
const CODE_TOMBSTONE_MS = 10 * 60 * 1000; // keep used/expired codes so the failure reason stays distinguishable
const SWEEP_INTERVAL_MS = 30 * 1000;

/** Code TTL: 2 minutes. The env override exists only so smoke tests can observe expiry; ignored in production. */
export function codeTtlMs(): number {
  const override = Number(process.env.TWINFOLD_LINK_CODE_TTL_MS);
  if (process.env.NODE_ENV !== "production" && Number.isFinite(override) && override >= 100) return override;
  return 2 * 60 * 1000;
}

// Exchange rate limiting (failed attempts only; a short code must not be brute-forceable).
export const IP_FAIL_LIMIT = 10;
export const IP_WINDOW_MS = 10 * 60 * 1000;
export const IP_LOCKOUT_MS = 10 * 60 * 1000;
export const GLOBAL_FAIL_LIMIT = 100;
export const GLOBAL_WINDOW_MS = 10 * 60 * 1000;
// Short on purpose: when a request carries no client address, only this global backstop applies, and it
// must not lock every legitimate user out for long.
export const GLOBAL_LOCKOUT_MS = 60 * 1000;
const MAX_TRACKED_IPS = 5000;

// ---- state -----------------------------------------------------------------

type CodeEntry = {
  wallet: string;
  expiresAt: number;
  usedAt?: number;
  expiredAudited?: boolean;
};
type DeviceEntry = {
  jti: string;
  wallet: string;
  deviceName: string;
  linkedAt: number;
  expiresAt: number;
  revokedAt?: number;
  expiredAudited?: boolean;
};
type Attempts = { failures: number[]; lockedUntil: number };
type State = {
  codes: Map<string, CodeEntry>; // key: sha256(code)
  codeByWallet: Map<string, string>; // wallet -> live code hash (one live code per wallet)
  devices: Map<string, DeviceEntry>; // key: jti
  ips: Map<string, Attempts>;
  global: Attempts;
  lastSweep: number;
};

const g = globalThis as unknown as { __twinfoldLinkStore?: State };
const state: State = (g.__twinfoldLinkStore ??= {
  codes: new Map(),
  codeByWallet: new Map(),
  devices: new Map(),
  ips: new Map(),
  global: { failures: [], lockedUntil: 0 },
  lastSweep: 0,
});

// ---- helpers ---------------------------------------------------------------

function secret(): string {
  const value = process.env.TWINFOLD_SESSION_SECRET;
  if (!value || value.length < 16) {
    throw new Error("TWINFOLD_SESSION_SECRET is not set (server-only env, min 16 chars). See apps/web/.env.example.");
  }
  return value;
}

const hashCode = (code: string) => createHash("sha256").update(code).digest("hex");

export function normalizeCode(raw: string): string | null {
  const code = raw.replace(/[\s-]/g, "").toUpperCase();
  if (code.length !== CODE_LENGTH) return null;
  for (const ch of code) if (!CODE_ALPHABET.includes(ch)) return null;
  return code;
}

export function formatCode(code: string): string {
  return `${code.slice(0, 4)}-${code.slice(4)}`;
}

function generateCode(): string {
  let out = "";
  for (let i = 0; i < CODE_LENGTH; i++) out += CODE_ALPHABET[randomInt(CODE_ALPHABET.length)];
  return out;
}

function sweep(now: number, force = false) {
  if (!force && now - state.lastSweep < SWEEP_INTERVAL_MS) return;
  state.lastSweep = now;
  state.codes.forEach((c, h) => {
    if (c.expiresAt <= now && !c.usedAt && !c.expiredAudited) {
      c.expiredAudited = true;
      recordAudit("code_expired", { wallet: c.wallet, detail: `code ${ref(h)}` }, now);
      if (state.codeByWallet.get(c.wallet) === h) state.codeByWallet.delete(c.wallet);
    }
    const end = c.usedAt ?? c.expiresAt;
    if (end + CODE_TOMBSTONE_MS <= now) state.codes.delete(h);
  });
  state.devices.forEach((d, jti) => {
    if (d.expiresAt <= now && !d.revokedAt && !d.expiredAudited) {
      d.expiredAudited = true;
      recordAudit("token_expired", { wallet: d.wallet, detail: `device ${ref(jti)}` }, now);
    }
    if ((d.revokedAt ?? d.expiresAt) + CODE_TOMBSTONE_MS <= now && d.expiresAt <= now) state.devices.delete(jti);
  });
  state.ips.forEach((a, ip) => {
    a.failures = a.failures.filter((t) => now - t < IP_WINDOW_MS);
    if (a.failures.length === 0 && a.lockedUntil <= now) state.ips.delete(ip);
  });
}

// ---- codes -----------------------------------------------------------------

export type IssueCodeResult =
  | { ok: true; code: string; expiresAt: number }
  | { ok: false; reason: "store_full" };

/** Issues a code for `wallet`, replacing (invalidating) any earlier live code for the same wallet. */
export function issueLinkCode(wallet: string, now = Date.now()): IssueCodeResult {
  sweep(now);
  const previous = state.codeByWallet.get(wallet);
  if (previous) {
    state.codes.delete(previous);
    state.codeByWallet.delete(wallet);
  }
  if (state.codes.size >= MAX_CODES) {
    sweep(now, true);
    if (state.codes.size >= MAX_CODES) return { ok: false, reason: "store_full" };
  }
  let code = generateCode();
  while (state.codes.has(hashCode(code))) code = generateCode();
  const hash = hashCode(code);
  const expiresAt = now + codeTtlMs();
  state.codes.set(hash, { wallet, expiresAt });
  state.codeByWallet.set(wallet, hash);
  recordAudit("code_issued", { wallet, detail: `code ${ref(hash)}` }, now);
  return { ok: true, code, expiresAt };
}

// ---- rate limiting ---------------------------------------------------------

function pruned(a: Attempts, windowMs: number, now: number) {
  a.failures = a.failures.filter((t) => now - t < windowMs);
}

const UNKNOWN_IP = "unknown"; // what clientIp() returns without X-Forwarded-For / X-Real-IP

/** Returns the remaining lockout in ms (0 = allowed). */
export function exchangeLockoutMs(ip: string, now = Date.now()): number {
  const perIp = ip === UNKNOWN_IP ? undefined : state.ips.get(ip);
  return Math.max(perIp?.lockedUntil ?? 0, state.global.lockedUntil, now) - now;
}

function registerFailure(ip: string, now: number) {
  // "unknown" = the request had no usable client address. Many different clients share it, so it gets NO
  // per-IP bucket (10 failures would lock everyone out); only the global backstop below counts it.
  let a = ip === UNKNOWN_IP ? undefined : state.ips.get(ip);
  if (!a && ip === UNKNOWN_IP) {
    a = { failures: [], lockedUntil: 0 }; // scratch, not stored
  } else if (!a) {
    if (state.ips.size >= MAX_TRACKED_IPS) sweep(now, true);
    if (state.ips.size >= MAX_TRACKED_IPS) {
      // Too many distinct sources: fold into the global counter only.
      a = { failures: [], lockedUntil: 0 };
    } else {
      a = { failures: [], lockedUntil: 0 };
      state.ips.set(ip, a);
    }
  }
  a.failures.push(now);
  pruned(a, IP_WINDOW_MS, now);
  if (a.failures.length >= IP_FAIL_LIMIT) a.lockedUntil = now + IP_LOCKOUT_MS;

  state.global.failures.push(now);
  pruned(state.global, GLOBAL_WINDOW_MS, now);
  if (state.global.failures.length >= GLOBAL_FAIL_LIMIT) state.global.lockedUntil = now + GLOBAL_LOCKOUT_MS;
}

// ---- exchange --------------------------------------------------------------

export type ExchangeFailure = "invalid_code" | "unknown_code" | "expired" | "already_used" | "rate_limited";
export type ExchangeResult =
  | { ok: true; token: string; wallet: string; expiresAt: number }
  | { ok: false; reason: ExchangeFailure; retryAfterMs?: number };

/** Burns the code and issues a device token. Throws if TWINFOLD_SESSION_SECRET is missing. */
export function exchangeLinkCode(rawCode: string, deviceName: string, ip: string, now = Date.now()): ExchangeResult {
  secret(); // fail early (500) if misconfigured, before burning anything
  sweep(now);

  const lockout = exchangeLockoutMs(ip, now);
  if (lockout > 0) {
    recordAudit("code_exchange_failed", { detail: "rate_limited" }, now);
    return { ok: false, reason: "rate_limited", retryAfterMs: lockout };
  }

  const fail = (reason: ExchangeFailure, wallet?: string, codeRef?: string): ExchangeResult => {
    registerFailure(ip, now);
    recordAudit("code_exchange_failed", { wallet, detail: codeRef ? `${reason} code ${codeRef}` : reason }, now);
    return { ok: false, reason };
  };

  const code = normalizeCode(rawCode);
  if (!code) return fail("invalid_code");
  const hash = hashCode(code);
  const entry = state.codes.get(hash);
  if (!entry) return fail("unknown_code");
  if (entry.usedAt) return fail("already_used", entry.wallet, ref(hash));
  if (entry.expiresAt <= now) return fail("expired", entry.wallet, ref(hash));

  // Single-use: burn before issuing anything.
  entry.usedAt = now;
  if (state.codeByWallet.get(entry.wallet) === hash) state.codeByWallet.delete(entry.wallet);

  if (state.devices.size >= MAX_DEVICES) sweep(now, true);
  // Per-wallet cap: revoke the oldest live devices beyond the limit.
  const live = Array.from(state.devices.values())
    .filter((d) => d.wallet === entry.wallet && !d.revokedAt && d.expiresAt > now)
    .sort((a, b) => a.linkedAt - b.linkedAt);
  while (live.length >= MAX_DEVICES_PER_WALLET) {
    const oldest = live.shift()!;
    oldest.revokedAt = now;
    recordAudit("token_revoked", { wallet: oldest.wallet, detail: `device ${ref(oldest.jti)} (per-wallet cap)` }, now);
  }
  if (state.devices.size >= MAX_DEVICES) {
    // Still full of live entries: refuse rather than grow without bound.
    entry.usedAt = undefined;
    state.codeByWallet.set(entry.wallet, hash);
    return { ok: false, reason: "rate_limited", retryAfterMs: 60_000 };
  }

  const jti = randomBytes(16).toString("hex");
  const expiresAt = now + DEVICE_TOKEN_TTL_MS;
  const name = deviceName.trim().slice(0, 40) || "iPhone";
  state.devices.set(jti, { jti, wallet: entry.wallet, deviceName: name, linkedAt: now, expiresAt });
  recordAudit("code_exchanged", { wallet: entry.wallet, detail: `device ${ref(jti)}` }, now);
  return { ok: true, token: signDeviceToken(jti, entry.wallet, expiresAt), wallet: entry.wallet, expiresAt };
}

// ---- device tokens ---------------------------------------------------------

/**
 * Format: `tfd1.<base64url payload>.<base64url HMAC-SHA256>`.
 * payload = { typ:"device", aud:"twinfold-ios", jti, w, exp }.
 * The MAC covers "twinfold-device-v1\n" + payload (domain separation), while the
 * Web cookie MAC covers the bare payload — so neither token type verifies as the other.
 */
const DEVICE_TOKEN_PREFIX = "tfd1";
const DEVICE_MAC_DOMAIN = "twinfold-device-v1\n";

function deviceMac(payload: string) {
  return createHmac("sha256", secret()).update(DEVICE_MAC_DOMAIN + payload).digest("base64url");
}

function signDeviceToken(jti: string, wallet: string, exp: number): string {
  const payload = Buffer.from(JSON.stringify({ typ: "device", aud: "twinfold-ios", jti, w: wallet, exp })).toString("base64url");
  return `${DEVICE_TOKEN_PREFIX}.${payload}.${deviceMac(payload)}`;
}

export type DeviceAuthResult =
  | { ok: true; wallet: string; expiresAt: number; jti: string }
  | { ok: false; reason: "malformed" | "bad_signature" | "expired" | "revoked" };

export function verifyDeviceToken(token: string | undefined | null, now = Date.now()): DeviceAuthResult {
  if (!token) return { ok: false, reason: "malformed" };
  const parts = token.split(".");
  if (parts.length !== 3 || parts[0] !== DEVICE_TOKEN_PREFIX) return { ok: false, reason: "malformed" };
  const [, payload, mac] = parts;
  const expected = Buffer.from(deviceMac(payload));
  const actual = Buffer.from(mac);
  if (expected.length !== actual.length || !timingSafeEqual(expected, actual)) return { ok: false, reason: "bad_signature" };
  let claims: { typ?: string; aud?: string; jti?: string; w?: string; exp?: number };
  try {
    claims = JSON.parse(Buffer.from(payload, "base64url").toString("utf8"));
  } catch {
    return { ok: false, reason: "malformed" };
  }
  if (claims.typ !== "device" || claims.aud !== "twinfold-ios" || typeof claims.jti !== "string" || typeof claims.w !== "string" || typeof claims.exp !== "number") {
    return { ok: false, reason: "malformed" };
  }
  sweep(now);
  const entry = state.devices.get(claims.jti);
  // Unknown to the registry (e.g. server restarted) is treated as revoked.
  if (!entry || entry.wallet !== claims.w || entry.revokedAt) return { ok: false, reason: "revoked" };
  if (claims.exp <= now || entry.expiresAt <= now) return { ok: false, reason: "expired" };
  return { ok: true, wallet: entry.wallet, expiresAt: entry.expiresAt, jti: entry.jti };
}

export type DeviceInfo = { id: string; name: string; linkedAt: string; expiresAt: string };

export function listDevices(wallet: string, now = Date.now()): DeviceInfo[] {
  sweep(now);
  return Array.from(state.devices.values())
    .filter((d) => d.wallet === wallet && !d.revokedAt && d.expiresAt > now)
    .sort((a, b) => b.linkedAt - a.linkedAt)
    .map((d) => ({
      id: ref(d.jti),
      name: d.deviceName,
      linkedAt: new Date(d.linkedAt).toISOString(),
      expiresAt: new Date(d.expiresAt).toISOString(),
    }));
}

/** Revokes every live device token (and the live code) issued for `wallet`. Returns how many tokens were revoked. */
export function revokeDevicesForWallet(wallet: string, reason: string, now = Date.now()): number {
  let count = 0;
  state.devices.forEach((d) => {
    if (d.wallet === wallet && !d.revokedAt && d.expiresAt > now) {
      d.revokedAt = now;
      count++;
      recordAudit("token_revoked", { wallet, detail: `device ${ref(d.jti)} (${reason})` }, now);
    }
  });
  const liveCode = state.codeByWallet.get(wallet);
  if (liveCode) {
    state.codes.delete(liveCode);
    state.codeByWallet.delete(wallet);
  }
  return count;
}
