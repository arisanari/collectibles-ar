import { NextResponse } from "next/server";
import { getAssetsByOwner, getSignaturesForAddress } from "../../../../lib/solana/heliusClient";
import { heliusAssetToTwinfoldAsset } from "../../../../lib/solana/normalize";

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
    const assets = await Promise.all(
      owned.items
        .filter((item) => item.interface === "MplCoreAsset" && !item.burnt)
        .map(async (item) => {
          const signatures = await getSignaturesForAddress(item.id);
          return heliusAssetToTwinfoldAsset(item, signatures);
        })
    );
    return NextResponse.json(assets);
  } catch (error) {
    console.error("GET /api/solana/assets failed", error);
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "unknown error" },
      { status: 502 }
    );
  }
}
