// Server-side record of every Pull (one record per Collector Crypt memo). Server-only.
//
// Why: the memo is the idempotency key AND the only proof of which wallet started a Pull. /api/gacha/open and
// /api/gacha/submit check that the memo belongs to the signed-in wallet (403 otherwise), and /api/gacha/open takes the
// card's event time from this record so the same memo always yields the same output.
//
// State: generated (pack created, nothing signed) -> submitted (signed tx relayed) -> opened (card received).
// `failed` marks a relay/open the upstream refused; the memo stays usable (the player may have paid, so open can
// still be retried) and a later success moves it on. `opened` never goes back.
//
// Persistence follows lib/redemptions/store.ts: file-backed JSON (lib/persist/jsonFile.ts, apps/web/.data/,
// gitignored) so a dev-server restart does not strand a paid Pull. DEMO DATA records are kept in memory only.
// Stored values are public (wallet address, memo, pack type, mint address, signature); nothing secret.
//
// MVP LIMITATION: single process, local disk.
import type { TwinfoldAsset } from "../contract";
import { readJsonFile, writeJsonFileAtomic } from "../persist/jsonFile";

export type GachaPackState = "generated" | "submitted" | "opened" | "failed";

/**
 * Why the last submit / open did not go through. `code` is ours (wallet_not_signer, invalid_transaction, rate_limited,
 * tx_expired, busy_pending, busy_opening, machine_off_balance, upstream_error, server_error). `message` is Collector Crypt's
 * `error` / `message` / `details` (clipped), never a header, key or signed transaction.
 */
export type GachaPackError = {
  at: string; // ISO 8601
  stage: "submit" | "open";
  code: string;
  httpStatus: number;
  message: string;
};

export type GachaPackRecord = {
  wallet: string; // the signed-in wallet that created the pack (DEMO DATA: the demo player address)
  memo: string;
  packType: string;
  state: GachaPackState;
  createdAt: number;
  updatedAt: number;
  demo: boolean;
  txSignature?: string; // the Pull transaction signature reported by openPack
  nftAddress?: string;
  /** Time the card was first received. Used as the provenance event time so the same memo gives the same output. */
  openedAt?: number;
  /**
   * The card as /api/gacha/open last returned it (same normalizer), so GET /api/gacha/packs gives the iPhone the same
   * output for the same memo without asking Collector Crypt or DAS again. Public data only (image URL from NFT metadata).
   */
  asset?: TwinfoldAsset;
  /** Image URL found through DAS when openPack carried none; kept so DAS is asked once per memo, not on every call. */
  imageUrl?: string;
  /** DAS `interface` found with it. */
  assetInterface?: string;
  /**
   * First signature (transaction id) of each signed transaction relayed for this memo (newest last, at most 3). Lets the server ask
   * the chain whether a submit that errored actually landed. Public data.
   */
  submitSignatures?: string[];
  /** When a signed transaction was last handed to the relay for this memo (ms). The landing window is counted from here. */
  lastSubmitAt?: number;
  /** A submit signature was seen on chain (confirmed / finalized, no error): the payment went through, whatever submit answered. */
  landed?: boolean;
  /** The most recent refusal (upstream or ours). Cleared when the pack is submitted or opened. */
  lastError?: GachaPackError;
};

export const MAX_PACKS = 5000;
/** DEMO DATA records are anonymous and memory-only; they get their own small cap so they can never push out a real Pull. */
export const MAX_DEMO_PACKS = 300;
export const PACK_RETENTION_MS = 7 * 24 * 60 * 60 * 1000;
const FILE = "gacha-packs.json";

type Persisted = { packs: Record<string, GachaPackRecord> };

const g = globalThis as unknown as { __twinfoldGachaPacks?: Map<string, GachaPackRecord> };

function load(): Map<string, GachaPackRecord> {
  if (g.__twinfoldGachaPacks) return g.__twinfoldGachaPacks;
  const data = readJsonFile<Persisted>(FILE, { packs: {} });
  g.__twinfoldGachaPacks = new Map(Object.entries(data.packs));
  return g.__twinfoldGachaPacks;
}

function persist() {
  const packs: Record<string, GachaPackRecord> = {};
  load().forEach((record, memo) => {
    if (!record.demo) packs[memo] = record;
  });
  try {
    writeJsonFileAtomic(FILE, { packs } satisfies Persisted);
  } catch (error) {
    // The in-memory record still works for this process; only restart-survival is lost.
    console.warn("gacha pack store: could not write the file", error instanceof Error ? error.message : "unknown error");
  }
}

/** Test hook: forget the in-memory copy so the next call re-reads the file (simulates a restart). */
export function reloadFromDiskForTests() {
  g.__twinfoldGachaPacks = undefined;
}

function evictOldest(records: GachaPackRecord[], limit: number) {
  const packs = load();
  const sorted = records.sort((a, b) => a.createdAt - b.createdAt);
  for (const record of sorted.slice(0, Math.max(0, sorted.length - limit))) packs.delete(record.memo);
}

function sweep(now: number) {
  const packs = load();
  packs.forEach((record, memo) => {
    if (record.updatedAt + PACK_RETENTION_MS <= now) packs.delete(memo);
  });
  const all = Array.from(packs.values());
  evictOldest(all.filter((r) => r.demo), MAX_DEMO_PACKS);
  evictOldest(all.filter((r) => !r.demo), MAX_PACKS);
}

export function getPack(memo: string): GachaPackRecord | undefined {
  return load().get(memo);
}

/** The record for `memo`, only when it belongs to `wallet`. Someone else's memo and an unknown memo look the same. */
export function getOwnedPack(memo: string, wallet: string): GachaPackRecord | undefined {
  const record = load().get(memo);
  return record && record.wallet === wallet ? record : undefined;
}

/** The server's view of one memo for GET /api/gacha/pack/status (`createdAt` = when the pack was issued, ISO 8601). */
export type PackStatusLocal = { state: GachaPackState; lastError: GachaPackError | null; createdAt: string; landed: boolean };

/**
 * The record a status read may show. A real wallet only sees its own records; someone else's memo, an unknown memo and a
 * DEMO DATA record all look the same (`forbidden`). A DEMO DATA caller (`wallet` null) only sees DEMO DATA records, and an
 * unknown memo is `unknown` there (a demo /api/gacha/open creates its record on demand).
 */
export function getPackStatusLocal(memo: string, wallet: string | null): { kind: "ok"; local: PackStatusLocal } | { kind: "forbidden" } | { kind: "unknown" } {
  const record = load().get(memo);
  if (wallet === null) {
    if (!record) return { kind: "unknown" };
    if (!record.demo) return { kind: "forbidden" };
  } else if (!record || record.demo || record.wallet !== wallet) {
    return { kind: "forbidden" };
  }
  return { kind: "ok", local: { state: record.state, lastError: record.lastError ?? null, createdAt: new Date(record.createdAt).toISOString(), landed: record.landed === true } };
}

/**
 * Records a freshly generated pack. Idempotent by memo: an existing record is returned unchanged (it is never
 * reset and never handed to another wallet).
 */
export function recordGenerated(input: { memo: string; wallet: string; packType: string; demo?: boolean }, now = Date.now()): GachaPackRecord {
  const packs = load();
  const existing = packs.get(input.memo);
  if (existing) return existing;
  const record: GachaPackRecord = {
    wallet: input.wallet,
    memo: input.memo,
    packType: input.packType,
    state: "generated",
    createdAt: now,
    updatedAt: now,
    demo: input.demo === true,
  };
  packs.set(record.memo, record);
  sweep(now);
  persist();
  return record;
}

/** generated | failed -> submitted. An opened record stays opened. */
export function markSubmitted(record: GachaPackRecord, now = Date.now()): GachaPackRecord {
  if (record.state === "opened") return record;
  record.state = "submitted";
  delete record.lastError;
  record.updatedAt = now;
  persist();
  return record;
}

/** -> opened. The first success fixes txSignature / nftAddress / openedAt; later calls with the same memo change nothing. */
export function markOpened(record: GachaPackRecord, result: { txSignature?: string; nftAddress: string }, now = Date.now()): GachaPackRecord {
  if (record.state === "opened") return record;
  record.state = "opened";
  delete record.lastError;
  record.nftAddress = result.nftAddress;
  if (result.txSignature) record.txSignature = result.txSignature;
  record.openedAt = now;
  record.updatedAt = now;
  persist();
  return record;
}

/**
 * Keeps the normalized card (and the DAS lookups behind it) on an opened record. A change in the stored card bumps
 * `updatedAt` so a feed client polling with `since` sees it (for example the Pull event turning confirmed).
 */
export function recordAsset(
  record: GachaPackRecord,
  snapshot: { asset: TwinfoldAsset; imageUrl?: string; assetInterface?: string },
  now = Date.now()
): GachaPackRecord {
  const before = JSON.stringify([record.asset, record.imageUrl, record.assetInterface]);
  record.asset = snapshot.asset;
  if (snapshot.imageUrl) record.imageUrl = snapshot.imageUrl;
  if (snapshot.assetInterface) record.assetInterface = snapshot.assetInterface;
  if (JSON.stringify([record.asset, record.imageUrl, record.assetInterface]) !== before) {
    record.updatedAt = now;
    persist();
  }
  return record;
}

/**
 * The opened (non-demo) record of `wallet` whose card is `nftAddress`, or undefined. This is a fact about THIS app: the
 * card reached the wallet through our own openPack call. Another wallet's record, a record not yet opened and a
 * DEMO DATA record never match.
 */
export function findOpenedByNft(wallet: string, nftAddress: string): GachaPackRecord | undefined {
  for (const record of Array.from(load().values())) {
    if (!record.demo && record.state === "opened" && record.wallet === wallet && record.nftAddress === nftAddress) return record;
  }
  return undefined;
}

/** Records the feed may show: the real wallet's own records, or (DEMO DATA) the anonymous demo records. */
export function listPacksForWallet(wallet: string | null): GachaPackRecord[] {
  return Array.from(load().values()).filter((r) => (wallet === null ? r.demo : !r.demo && r.wallet === wallet));
}

/** The upstream refused a relay / open. Does nothing to an opened record. The memo stays usable. */
export function markFailed(record: GachaPackRecord, now = Date.now()): GachaPackRecord {
  if (record.state === "opened") return record;
  record.state = "failed";
  record.updatedAt = now;
  persist();
  return record;
}

export const LAST_ERROR_MESSAGE_MAX = 500;

/** Collapses whitespace and clips to LAST_ERROR_MESSAGE_MAX characters. */
export function clipMessage(text: string): string {
  const flat = text.replace(/\s+/g, " ").trim();
  return flat.length > LAST_ERROR_MESSAGE_MAX ? `${flat.slice(0, LAST_ERROR_MESSAGE_MAX - 1)}…` : flat;
}

/**
 * Keeps why a submit / open failed on the record (and prints one server log line, memo / wallet / status / code / message
 * only). Does not change `state`: that is markFailed's job, and our own checks (wallet_not_signer ...) sent nothing.
 * An opened record is left alone (its card is what matters). Returns the stored error.
 */
export function recordError(
  record: GachaPackRecord,
  input: { stage: GachaPackError["stage"]; code: string; httpStatus: number; message: string },
  now = Date.now()
): GachaPackError {
  const lastError: GachaPackError = {
    at: new Date(now).toISOString(),
    stage: input.stage,
    code: input.code,
    httpStatus: input.httpStatus,
    message: clipMessage(input.message),
  };
  if (!record.demo) {
    console.error(`[gacha ${input.stage}]`, { memo: record.memo, wallet: record.wallet, httpStatus: lastError.httpStatus, code: lastError.code, message: lastError.message });
  }
  if (record.state === "opened") return lastError;
  record.lastError = lastError;
  record.updatedAt = now;
  persist();
  return lastError;
}

/**
 * Upstream says the transaction's blockhash ran out, so it can no longer land and no payment happened. Only the wording
 * counts: a bare HTTP 500 (or any other status) does not prove the transaction did not land, so it is NOT classified here.
 * Whether it landed is answered by the chain (lib/gacha/submitReconcile.ts). Used only for a Pull submit; a buyback is not classified.
 */
export function isTxExpiredFailure(input: { httpStatus: number; message: string }): boolean {
  return /blockhash|expired|block height/i.test(input.message);
}

/** Remembers the signature of a transaction about to be relayed (deduplicated, newest last, at most 3). */
export function recordSubmitSignature(record: GachaPackRecord, signature: string, now = Date.now()): GachaPackRecord {
  const list = record.submitSignatures ?? [];
  record.lastSubmitAt = now;
  if (!list.includes(signature)) record.submitSignatures = [...list, signature].slice(-3);
  record.updatedAt = now;
  persist();
  return record;
}

/** The chain shows a submit signature: the payment went through. Back to `submitted` so the normal open flow takes over. */
export function markLanded(record: GachaPackRecord, now = Date.now()): GachaPackRecord {
  if (record.state === "opened") return record;
  record.landed = true;
  return markSubmitted(record, now);
}
