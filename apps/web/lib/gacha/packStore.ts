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
import { readJsonFile, writeJsonFileAtomic } from "../persist/jsonFile";

export type GachaPackState = "generated" | "submitted" | "opened" | "failed";

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
};

export const MAX_PACKS = 5000;
/** DEMO DATA records are anonymous and memory-only; they get their own small cap so they can never push out a real Pull. */
export const MAX_DEMO_PACKS = 300;
export const PACK_RETENTION_MS = 7 * 24 * 60 * 60 * 1000;
const FILE = "gacha-packs.json";

type Persisted = { packs: Record<string, GachaPackRecord> };

const g = globalThis as unknown as { __slabarGachaPacks?: Map<string, GachaPackRecord> };

function load(): Map<string, GachaPackRecord> {
  if (g.__slabarGachaPacks) return g.__slabarGachaPacks;
  const data = readJsonFile<Persisted>(FILE, { packs: {} });
  g.__slabarGachaPacks = new Map(Object.entries(data.packs));
  return g.__slabarGachaPacks;
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
  g.__slabarGachaPacks = undefined;
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
  record.updatedAt = now;
  persist();
  return record;
}

/** -> opened. The first success fixes txSignature / nftAddress / openedAt; later calls with the same memo change nothing. */
export function markOpened(record: GachaPackRecord, result: { txSignature?: string; nftAddress: string }, now = Date.now()): GachaPackRecord {
  if (record.state === "opened") return record;
  record.state = "opened";
  record.nftAddress = result.nftAddress;
  if (result.txSignature) record.txSignature = result.txSignature;
  record.openedAt = now;
  record.updatedAt = now;
  persist();
  return record;
}

/** The upstream refused a relay / open. Does nothing to an opened record. The memo stays usable. */
export function markFailed(record: GachaPackRecord, now = Date.now()): GachaPackRecord {
  if (record.state === "opened") return record;
  record.state = "failed";
  record.updatedAt = now;
  persist();
  return record;
}
