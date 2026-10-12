import { NextResponse } from "next/server";
import { getGachaProvider } from "../../../../lib/gacha";
import { PACK_TYPE, gachaErrorResponse } from "../../../../lib/gacha/routeUtils";
import { refuseMainnet } from "../../../../lib/network";
import type { GachaPoolCard } from "../../../../lib/gacha/types";

export const dynamic = "force-dynamic";

const DEFAULT_MACHINE = "pokemon_25";
const TTL_MS = 10 * 60_000;
// How many cards of each tier the sample holds. Collector Crypt lists a pool by value, highest first, so an
// unfiltered read would return top-tier cards only; asking per tier keeps the sample from showing only those.
const SAMPLE: { rarity: GachaPoolCard["rarity"]; limit: number }[] = [
  { rarity: "epic", limit: 1 },
  { rarity: "rare", limit: 2 },
  { rarity: "uncommon", limit: 2 },
  { rarity: "common", limit: 2 },
];

type Payload = { code: string; fetchedAt: string; cards: GachaPoolCard[] };
const g = globalThis as unknown as { __twinfoldPoolCache?: Map<string, { at: number; payload: Payload }> };
const cache = (g.__twinfoldPoolCache ??= new Map());

/**
 * GET /api/gacha/pool[?code=pokemon_25]
 * A small sample of the cards in a machine's pool right now (name, tier and image URL as Collector Crypt serves them;
 * the images are loaded by the browser from Collector Crypt's host, nothing is stored here). Cached for 10 minutes.
 * The sample is for illustration on the landing page: it is not the odds and says nothing about what a Pull returns.
 */
export async function GET(request: Request) {
  const mainnet = await refuseMainnet(request);
  if (mainnet) return mainnet;
  const code = new URL(request.url).searchParams.get("code") ?? DEFAULT_MACHINE;
  if (!PACK_TYPE.test(code)) return NextResponse.json({ error: "invalid_input", message: "code is not a machine code" }, { status: 400 });
  try {
    const provider = getGachaProvider({ demo: false });
    const key = `${provider.network}:${code}:${SAMPLE.map((part) => part.limit).join("")}`;
    const hit = cache.get(key);
    let payload = hit && Date.now() - hit.at < TTL_MS ? hit.payload : null;
    if (!payload) {
      const parts = await Promise.all(SAMPLE.map((part) => provider.listPoolCards({ code, rarity: part.rarity, limit: part.limit })));
      payload = { code, fetchedAt: new Date().toISOString(), cards: parts.flat() };
      cache.set(key, { at: Date.now(), payload });
    }
    return NextResponse.json({ isDemoData: provider.isDemoData, network: provider.network, ...payload });
  } catch (error) {
    return gachaErrorResponse(error);
  }
}
