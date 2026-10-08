// Server-only: READ-ONLY mainnet My Collection. Reads a wallet's DAS assets (Helius mainnet) and keeps only the cards
// whose collection is a configured Collector Crypt mainnet collection. Nothing here signs, sends or writes anything on
// mainnet; every write route refuses `network=mainnet` (lib/network.ts).
//
// 60 second cache per wallet (concurrent calls share one upstream call). Failures are not cached.
import type { TwinfoldAsset } from "../contract";
import { collectionAddressesFromEnv, mainnetCardsFromAssets } from "../gacha/normalize";
import { getAssetsByOwner, type HeliusAssetsByOwnerResult } from "./heliusClient";

export const MAINNET_ASSETS_TTL_MS = 60_000;
const MAX_CACHED_WALLETS = 500;

type Entry = { at: number; cards: TwinfoldAsset[] };
const g = globalThis as unknown as { __twinfoldMainnetAssetsCache?: Map<string, Entry> };
const cache: Map<string, Entry> = (g.__twinfoldMainnetAssetsCache ??= new Map());
const inflight = new Map<string, Promise<TwinfoldAsset[]>>();

export type MainnetAssetsDeps = {
  fetchOwned?: (wallet: string) => Promise<HeliusAssetsByOwnerResult>;
  env?: Record<string, string | undefined>;
  now?: number;
};

export async function loadMainnetCards(wallet: string, deps: MainnetAssetsDeps = {}): Promise<TwinfoldAsset[]> {
  const now = deps.now ?? Date.now();
  const hit = cache.get(wallet);
  if (hit && now - hit.at < MAINNET_ASSETS_TTL_MS) return hit.cards;
  const pending = inflight.get(wallet);
  if (pending) return pending;
  const fetchOwned = deps.fetchOwned ?? ((owner: string) => getAssetsByOwner(owner, "mainnet"));
  const request = (async () => {
    const owned = await fetchOwned(wallet);
    const cards = mainnetCardsFromAssets(owned.items, collectionAddressesFromEnv(deps.env ?? process.env, "mainnet"));
    cache.delete(wallet); // re-insert so the Map order is "oldest first"
    cache.set(wallet, { at: now, cards });
    while (cache.size > MAX_CACHED_WALLETS) {
      const oldest = cache.keys().next().value;
      if (oldest === undefined) break;
      cache.delete(oldest);
    }
    return cards;
  })().finally(() => inflight.delete(wallet));
  inflight.set(wallet, request);
  return request;
}

/** Test hook. */
export function clearMainnetAssetsCacheForTests() {
  cache.clear();
  inflight.clear();
}
