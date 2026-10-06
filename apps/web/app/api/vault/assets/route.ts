import { NextResponse } from "next/server";
import { devnetWalletAddressOrNull } from "../../../../lib/solana/devnetAuthz";
import { getAssetsByOwner, getSignaturesForAddress } from "../../../../lib/solana/heliusClient";
import { heliusAssetToTwinfoldAsset } from "../../../../lib/solana/normalize";

export const dynamic = "force-dynamic";

/**
 * GET /api/vault/assets -> TwinfoldAsset[]
 * The Assets Twinfold's vault wallet currently holds on devnet and lists for acquisition
 * ("Twinfoldから取得"): current on-chain owner == vault wallet, with `commerce` (the listed price is
 * Twinfold's off-chain interpretation, a demo placeholder). Public chain data, so no auth; clients
 * need not know the vault address. The acquisition itself re-checks everything server-side
 * (POST /api/acquisitions), so this list is advisory.
 */
export async function GET() {
  const vault = devnetWalletAddressOrNull("vault");
  if (!vault) return NextResponse.json({ error: "Twinfold (legacy demo) vault wallet is not configured on this server" }, { status: 503 });
  try {
    const owned = await getAssetsByOwner(vault);
    const assets = await Promise.all(
      owned.items
        .filter((item) => item.interface === "MplCoreAsset" && !item.burnt && item.ownership.owner === vault)
        .map(async (item) => heliusAssetToTwinfoldAsset(item, await getSignaturesForAddress(item.id))),
    );
    return NextResponse.json(assets.filter((asset) => !!asset.commerce && !asset.redemption?.open));
  } catch (error) {
    console.error("GET /api/vault/assets failed", error);
    return NextResponse.json({ error: error instanceof Error ? error.message : "unknown error" }, { status: 502 });
  }
}
