import { NextResponse } from "next/server";
import { getAssetsByOwner, getSignaturesForAddress } from "../../../../lib/solana/heliusClient";
import { heliusAssetToTwinfoldAsset } from "../../../../lib/solana/normalize";
import { collectionAddressesFromEnv, heliusCardToAsset } from "../../../../lib/gacha/normalize";
import { findOpenedByNft } from "../../../../lib/gacha/packStore";
import { decodeWalletAddress } from "../../../../lib/auth/base58";
import { clientIp } from "../../../../lib/auth/requestAuth";
import { parseNetworkParam } from "../../../../lib/network";
import { takeSlot } from "../../../../lib/rateLimit";
import { loadMainnetCards } from "../../../../lib/solana/mainnetAssets";

export const dynamic = "force-dynamic";

/**
 * GET /api/solana/assets?wallet=<address>[&network=devnet|mainnet]
 *
 * devnet (default): every Asset the wallet owns (cards by metadata shape, Core assets with provenance).
 * mainnet: READ-ONLY. Only cards whose DAS collection is in COLLECTOR_CRYPT_COLLECTION_ADDRESSES_MAINNET, as
 * category "card" / source "collectorCrypt" / sourceVerified true / network "mainnet". Cached 60 seconds on the server.
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

  const network = parseNetworkParam(searchParams.get("network"));
  if (network === null) {
    return NextResponse.json({ error: "invalid network: use devnet or mainnet" }, { status: 400 });
  }
  if (network === "mainnet") {
    if (!decodeWalletAddress(wallet)) {
      return NextResponse.json({ error: "invalid wallet address" }, { status: 400 });
    }
    // Anyone can ask about any wallet (public chain data); the 60 s cache covers repeats, this covers many wallets from one client.
    const ip = clientIp(request);
    if (ip !== "unknown" && !takeSlot("mainnet_assets_ip", ip, 300)) {
      return NextResponse.json({ error: "rate_limited" }, { status: 429 });
    }
    try {
      return NextResponse.json(await loadMainnetCards(wallet));
    } catch (error) {
      console.error("GET /api/solana/assets (mainnet) failed", error instanceof Error ? error.message : "unknown error");
      return NextResponse.json({ error: "could not read mainnet assets" }, { status: 502 });
    }
  }

  try {
    const owned = await getAssetsByOwner(wallet);
    // Graded cards (pNFT / Core / ...) are listed by metadata shape, but only an asset whose DAS collection is in
    // COLLECTOR_CRYPT_COLLECTION_ADDRESSES_DEVNET gets source "collectorCrypt" / sourceVerified true. The rest carry
    // sourceVerified false: the UI labels them UNVERIFIED SOURCE and clients must keep them out of the AR list.
    // This route reads Helius devnet DAS only, so only the devnet collection addresses apply.
    // A card this app's own openPack delivered to this wallet (an opened local pack record with the same wallet and
    // mint) is verified whatever its collection is: Collector Crypt's Core cards and pNFTs sit in different collections.
    const collectionAddresses = collectionAddressesFromEnv(process.env, "devnet");
    const live = owned.items.filter((item) => !item.burnt);
    const cardItems = new Set<string>();
    const cards = live.flatMap((item) => {
      const card = heliusCardToAsset(item, {
        collectionAddresses,
        network: "devnet",
        openedViaPack: findOpenedByNft(wallet, item.id) !== undefined,
      });
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
