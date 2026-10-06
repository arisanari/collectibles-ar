import { NextResponse } from "next/server";
import { getAssetsByOwner, getSignaturesForAddress } from "../../../../lib/solana/heliusClient";
import { heliusAssetToTwinfoldAsset } from "../../../../lib/solana/normalize";
import { collectionAddressesFromEnv, heliusCardToAsset } from "../../../../lib/gacha/normalize";

export const dynamic = "force-dynamic";

/**
 * GET /api/solana/assets?wallet=<address>
 *
 * Server-only route: the only place in apps/web allowed to call Helius DAS
 * directly (AGENTS.md section 3). SolanaAssetProvider fetches this instead
 * of importing lib/solana/heliusClient.ts.
 */
export async function GET(request: Request) {
  const { searchParams } = new URL(request.url);
  const wallet = searchParams.get("wallet");
  if (!wallet) {
    return NextResponse.json({ error: "missing required query param: wallet" }, { status: 400 });
  }

  try {
    const owned = await getAssetsByOwner(wallet);
    // Graded cards (pNFT / Core / ...) are listed by metadata shape, but only an asset whose DAS collection is in
    // COLLECTOR_CRYPT_COLLECTION_ADDRESSES_DEVNET gets source "collectorCrypt" / sourceVerified true. The rest carry
    // sourceVerified false: the UI labels them UNVERIFIED SOURCE and clients must keep them out of the AR list.
    // This route reads Helius devnet DAS only, so only the devnet collection addresses apply.
    const collectionAddresses = collectionAddressesFromEnv(process.env, "devnet");
    const live = owned.items.filter((item) => !item.burnt);
    const cardItems = new Set<string>();
    const cards = live.flatMap((item) => {
      const card = heliusCardToAsset(item, { collectionAddresses, network: "devnet" });
      if (!card) return [];
      cardItems.add(item.id);
      return [card];
    });
    const coreAssets = await Promise.all(
      live
        .filter((item) => item.interface === "MplCoreAsset" && !cardItems.has(item.id))
        .map(async (item) => {
          const signatures = await getSignaturesForAddress(item.id);
          return await heliusAssetToTwinfoldAsset(item, signatures);
        })
    );
    return NextResponse.json([...cards, ...coreAssets]);
  } catch (error) {
    console.error("GET /api/solana/assets failed", error);
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "unknown error" },
      { status: 502 }
    );
  }
}
