import { createPublicKey, randomBytes, verify } from "node:crypto";
import { base58Decode, decodeWalletAddress } from "./base58";

/**
 * Sign-in challenge store + ed25519 verification.
 *
 * MVP LIMITATION: challenges live in a process-local in-memory Map. That is
 * fine for `next dev` / a single Node server, but on serverless or multiple
 * instances a challenge issued by one instance is unknown to another. Move to
 * a shared store (KV/DB) before any multi-instance deployment.
 *
 * DoS bounds: at most MAX_CHALLENGES live entries, one live challenge per
 * wallet (a new one replaces the old), expired entries swept lazily.
 */

export const CHALLENGE_TTL_MS = 5 * 60 * 1000;
export const MAX_CHALLENGES = 5000;
const SWEEP_INTERVAL_MS = 30 * 1000;

type Challenge = { wallet: string; message: string; expiresAt: number; binding: string };
type Store = { byNonce: Map<string, Challenge>; byWallet: Map<string, string>; lastSweep: number };

const globalForAuth = globalThis as unknown as { __twinfoldChallengeStore?: Store };
const store = (globalForAuth.__twinfoldChallengeStore ??= { byNonce: new Map(), byWallet: new Map(), lastSweep: 0 });

function remove(nonce: string) {
  const c = store.byNonce.get(nonce);
  if (!c) return;
  store.byNonce.delete(nonce);
  if (store.byWallet.get(c.wallet) === nonce) store.byWallet.delete(c.wallet);
}

function sweep(now: number, force = false) {
  if (!force && now - store.lastSweep < SWEEP_INTERVAL_MS) return;
  store.lastSweep = now;
  store.byNonce.forEach((c, nonce) => {
    if (c.expiresAt <= now) remove(nonce);
  });
}

export function buildMessage(p: { domain: string; wallet: string; nonce: string; issuedAt: Date; expiresAt: Date }) {
  return [
    `${p.domain} wants you to sign in with your Solana wallet:`,
    p.wallet,
    "",
    "Network: devnet",
    "Statement: Signing this message only proves you control this wallet. It costs nothing, sends no transaction, and does not authorize any transfer.",
    `Nonce: ${p.nonce}`,
    `Issued At: ${p.issuedAt.toISOString()}`,
    `Expires At: ${p.expiresAt.toISOString()}`,
  ].join("\n");
}

export type IssueResult =
  | { ok: true; nonce: string; message: string; expiresAt: string }
  | { ok: false; reason: "invalid_wallet" | "store_full" };

/** `binding` is the random pre-auth cookie id of the requesting browser. */
export function issueChallenge(domain: string, wallet: string, binding: string, now = Date.now()): IssueResult {
  if (!decodeWalletAddress(wallet)) return { ok: false, reason: "invalid_wallet" };
  sweep(now);
  const existing = store.byWallet.get(wallet);
  if (existing) remove(existing);
  if (store.byNonce.size >= MAX_CHALLENGES) {
    sweep(now, true);
    if (store.byNonce.size >= MAX_CHALLENGES) return { ok: false, reason: "store_full" };
  }
  const nonce = randomBytes(16).toString("hex");
  const expiresAt = now + CHALLENGE_TTL_MS;
  const message = buildMessage({ domain, wallet, nonce, issuedAt: new Date(now), expiresAt: new Date(expiresAt) });
  store.byNonce.set(nonce, { wallet, message, expiresAt, binding });
  store.byWallet.set(wallet, nonce);
  return { ok: true, nonce, message, expiresAt: new Date(expiresAt).toISOString() };
}

export type VerifyResult =
  | { ok: true; wallet: string }
  | {
      ok: false;
      reason: "invalid_input" | "unknown_nonce" | "expired" | "wallet_mismatch" | "binding_mismatch" | "bad_signature";
    };

// DER prefix for an ed25519 SubjectPublicKeyInfo; the raw 32-byte key follows.
const ED25519_SPKI_PREFIX = Buffer.from("302a300506032b6570032100", "hex");

export function verifyChallenge(
  input: { wallet: string; nonce: string; signature: string; binding: string },
  now = Date.now(),
): VerifyResult {
  const publicKey = decodeWalletAddress(input.wallet);
  const signature = base58Decode(input.signature);
  if (!publicKey || !signature || signature.length !== 64 || !input.nonce) return { ok: false, reason: "invalid_input" };

  // Single-use: remove before checking anything else so a failed attempt cannot be retried on the same nonce.
  const challenge = store.byNonce.get(input.nonce);
  remove(input.nonce);
  if (!challenge) return { ok: false, reason: "unknown_nonce" };
  if (challenge.expiresAt <= now) return { ok: false, reason: "expired" };
  if (challenge.wallet !== input.wallet) return { ok: false, reason: "wallet_mismatch" };
  if (challenge.binding !== input.binding) return { ok: false, reason: "binding_mismatch" };

  const key = createPublicKey({ key: Buffer.concat([ED25519_SPKI_PREFIX, publicKey]), format: "der", type: "spki" });
  const valid = verify(null, Buffer.from(challenge.message, "utf8"), key, Buffer.from(signature));
  return valid ? { ok: true, wallet: input.wallet } : { ok: false, reason: "bad_signature" };
}
