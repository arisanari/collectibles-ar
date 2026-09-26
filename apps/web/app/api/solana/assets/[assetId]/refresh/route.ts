import { NextResponse } from "next/server";
import { getAsset } from "../../../../../../lib/solana/heliusClient";
import { resolveAssetAddress } from "../../../../../../lib/solana/assetRegistry";
import type { Entitlement } from "../../../../../../lib/contract";

export const dynamic = "force-dynamic";

/**
 * POST /api/solana/assets/[assetId]/refresh
 * body: { wallet: string }
 *
 * Re-checks chain owner against `wallet` and returns an Entitlement. This is
 * a minimal `canDisplay` check for Phase 2 (chain owner match only) — the
 * full check in docs/architecture.md section 7 (session, active, display
 * rights, frozen/redeemed/exception) is completed once the RWA Adapter
 * (Phase 3) and Backend session model exist.
 */
export async function POST(request: Request, context: { params: Promise<{ assetId: string }> }) {
  const { assetId } = await context.params;
  const body = (await request.json().catch(() => null)) as { wallet?: string } | null;
  const wallet = body?.wallet;
  if (!wallet) {
    return NextResponse.json({ error: "missing required body field: wallet" }, { status: 400 });
  }

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
    const heliusAsset = await getAsset(address);
    const canDisplay = !heliusAsset.burnt && heliusAsset.ownership.owner === wallet;
    const entitlement: Entitlement = {
      wallet,
      assetId,
      canDisplay,
      reason: canDisplay
        ? "devnet: chain owner matches wallet"
        : "devnet: chain owner does not match wallet",
      checkedAt: new Date().toISOString(),
    };
    return NextResponse.json(entitlement);
  } catch (error) {
    console.error(`POST /api/solana/assets/${assetId}/refresh failed`, error);
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "unknown error" },
      { status: 502 }
    );
  }
}
