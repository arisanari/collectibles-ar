import { NextResponse } from "next/server";
import { listConfiguredAssetIds } from "../../../../lib/solana/assetRegistry";

export const dynamic = "force-dynamic";

/**
 * GET /api/solana/registry
 *
 * Lists the Twinfold asset ids currently mapped to a devnet Asset address
 * via SOLANA_ASSET_ADDRESSES, so the UI can render a DEVNET section without
 * importing lib/solana/assetRegistry.ts directly (AGENTS.md section 3).
 */
export async function GET() {
  return NextResponse.json({ assetIds: listConfiguredAssetIds() });
}
