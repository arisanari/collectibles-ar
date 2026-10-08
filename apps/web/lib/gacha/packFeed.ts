// The Pull feed for GET /api/gacha/packs: what the linked iPhone polls to learn about a Pull the Web finished.
// Pure shaping (unit-tested by scripts/gacha-feed.test.mjs) plus the pending-confirmation refresh, which takes its
// chain check as a parameter. Server-only (reads lib/gacha/packStore).
import type { TwinfoldAsset } from "../contract";
import assetsFixture from "../fixtures/demo/assets.json";
import { withPullConfirmed } from "./normalize";
import { listPacksForWallet, recordAsset, type GachaPackError, type GachaPackRecord, type GachaPackState } from "./packStore";

export const FEED_LIMIT = 20;
/** Wallet-level cap on feed reads (an iPhone polling every ~6 s stays under it). */
export const FEED_PER_HOUR = 2000; // iPhone polls every 3 s while the room is open (1200/h) plus the Web tab

export type PackFeedItem = {
  memo: string;
  packType: string;
  state: GachaPackState;
  createdAt: string;
  openedAt: string | null;
  nftAddress: string | null;
  asset: TwinfoldAsset | null;
  /** Why the last submit / open failed. Present only on a record that has one. */
  lastError?: GachaPackError;
};

export type PackFeed = { wallet: string; packs: PackFeedItem[] };

export const DEMO_FEED_WALLET = "DEMOwalletC3333333333333333333333333333333";

/** ISO 8601 -> epoch ms. null = no `since`; "invalid" = not a date. A "+09:00" offset whose "+" arrived as a space is repaired. */
export function parseSince(raw: string | null): number | null | "invalid" {
  if (raw === null || raw.trim() === "") return null;
  const ms = Date.parse(raw.trim().replace(/ (\d{2}:\d{2})$/, "+$1"));
  return Number.isFinite(ms) ? ms : "invalid";
}

const iso = (ms: number) => new Date(ms).toISOString();

function toItem(record: GachaPackRecord): PackFeedItem {
  return {
    memo: record.memo,
    packType: record.packType,
    state: record.state,
    createdAt: iso(record.createdAt),
    openedAt: record.openedAt === undefined ? null : iso(record.openedAt),
    nftAddress: record.nftAddress ?? null,
    // Only an opened Pull has a card, and it is the very card /api/gacha/open returned for this memo.
    asset: record.state === "opened" && record.asset ? record.asset : null,
    ...(record.lastError ? { lastError: record.lastError } : {}),
  };
}

/**
 * Newest first by `openedAt` (a Pull that is not opened yet sorts by `createdAt`), at most FEED_LIMIT.
 * With `since`, only records changed at or after it: `updatedAt` moves whenever `createdAt` / `openedAt` do, and also
 * when the pack is submitted, fails, or its card gains its image / chain confirmation, so a poller sees those too.
 */
export function buildPackFeed(records: readonly GachaPackRecord[], options: { wallet: string; since?: number | null }): PackFeed {
  const since = options.since ?? null;
  const packs = records
    .filter((r) => since === null || Math.max(r.updatedAt, r.createdAt, r.openedAt ?? 0) >= since)
    .sort((a, b) => (b.openedAt ?? b.createdAt) - (a.openedAt ?? a.createdAt) || a.memo.localeCompare(b.memo))
    .slice(0, FEED_LIMIT)
    .map(toItem);
  return { wallet: options.wallet, packs };
}

/** Is this opened record's card still showing a pending Pull event (signature not yet seen on chain)? */
function needsConfirmation(record: GachaPackRecord): boolean {
  return (
    !record.demo &&
    record.state === "opened" &&
    Boolean(record.txSignature) &&
    record.asset !== undefined &&
    record.asset.provenance.some((e) => e.status === "pending" && e.transaction === record.txSignature)
  );
}

/**
 * Re-checks (at most `maxChecks` per call) the Pull signatures of cards still pending, so a card the Web stopped
 * polling does not stay pending on the iPhone forever. `isOnChain` is the RPC check (lib/gacha/openResult.signatureIsOnChain).
 */
export async function refreshPendingConfirmations(
  records: readonly GachaPackRecord[],
  isOnChain: (signature: string) => Promise<boolean>,
  maxChecks = 5
): Promise<void> {
  const pending = records.filter(needsConfirmation).slice(0, maxChecks);
  await Promise.all(
    pending.map(async (record) => {
      if (!(await isOnChain(record.txSignature as string))) return;
      recordAsset(record, { asset: withPullConfirmed(record.asset as TwinfoldAsset) });
    })
  );
}

const DEMO_SAMPLE_AT = Date.parse("2026-10-06T00:00:00Z");

/** One fixed opened Pull made from the first self-made demo card (DEMO DATA only), so an empty DEMO feed still has a card to show. */
export function demoSampleRecord(): GachaPackRecord {
  const card = (assetsFixture as TwinfoldAsset[]).find((a) => a.category === "card" && a.id.startsWith("tf-card-DEMO-")) as TwinfoldAsset;
  const memo = "demo-memo-sample";
  return {
    wallet: DEMO_FEED_WALLET,
    memo,
    packType: "demo_25",
    state: "opened",
    createdAt: DEMO_SAMPLE_AT,
    updatedAt: DEMO_SAMPLE_AT,
    openedAt: DEMO_SAMPLE_AT,
    demo: true,
    txSignature: card.provenance[0]?.transaction,
    nftAddress: card.address,
    asset: { ...card, gachaMemo: memo },
  };
}

/**
 * The records one caller may see: a real wallet's own, or (wallet null = DEMO DATA) the anonymous demo records,
 * falling back to the fixed sample when there are none.
 */
export function recordsForFeed(wallet: string | null): GachaPackRecord[] {
  if (wallet !== null) return listPacksForWallet(wallet);
  // An opened demo record with no stored card predates the feed; the iPhone could show nothing for it, so it is left out.
  const demo = listPacksForWallet(null).filter((r) => r.state !== "opened" || r.asset !== undefined);
  return demo.length === 0 ? [demoSampleRecord()] : demo;
}
