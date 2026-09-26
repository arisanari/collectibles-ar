import { NextResponse } from "next/server";
import { getAsset, getSignaturesForAddress } from "../../../../../lib/solana/heliusClient";
import { heliusAssetToTwinfoldAsset } from "../../../../../lib/solana/normalize";
import { resolveAssetAddress } from "../../../../../lib/solana/assetRegistry";

export const dynamic = "force-dynamic";

/**
 * GET /api/solana/assets/[assetId]
 *
 * `assetId` is Twinfold's internal stable id (e.g. "tf-ukiyoe-001"), resolved
 * to a devnet Asset address via SOLANA_ASSET_ADDRESSES
 * (lib/solana/assetRegistry.ts) so the address can change after a real mint
 * without a code change.
 */
export async function GET(_request: Request, context: { params: Promise<{ assetId: string }> }) {
  const { assetId } = await context.params;

  let address: string;
  try {
    address = resolveAssetAddress(assetId);
  } catch (error) {
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "unknown error" },
      { status: 404 }
    );
  }

  try {
    const [heliusAsset, signatures] = await Promise.all([
      getAsset(address),
      getSignaturesForAddress(address),
    ]);
    return NextResponse.json(heliusAssetToTwinfoldAsset(heliusAsset, signatures));
  } catch (error) {
    console.error(`GET /api/solana/assets/${assetId} failed`, error);
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "unknown error" },
      { status: 502 }
    );
  }
}
