import { NextResponse } from "next/server";
import { readSmallJson } from "../../../../lib/auth/http";
import { getGachaProvider } from "../../../../lib/gacha";
import { gachaErrorResponse, isPlayerAddress, PACK_TYPE, requireSession } from "../../../../lib/gacha/routeUtils";
import { recordGenerated } from "../../../../lib/gacha/packStore";
import { takeSlot } from "../../../../lib/rateLimit";

export const dynamic = "force-dynamic";

/** Per-wallet cap on generatePack calls (each one reserves a pack on Collector Crypt's side). */
const PACKS_PER_HOUR = 30;

/**
 * POST /api/gacha/pack { playerAddress, packType, demo? }
 * Returns { memo, transaction } where `transaction` (base64, partially signed) is signed by the player in Phantom.
 * Non-demo calls need the signed-in session and playerAddress must be that wallet.
 */
export async function POST(request: Request) {
  const body = await readSmallJson(request);
  const demo = body?.demo === true;
  const session = await requireSession(request, demo);
  if (!session.ok) return session.response;

  const playerAddress = body?.playerAddress;
  const packType = body?.packType;
  if (!isPlayerAddress(playerAddress, demo) || typeof packType !== "string" || !PACK_TYPE.test(packType)) {
    return NextResponse.json({ error: "invalid_input", message: "playerAddress and packType are required" }, { status: 400 });
  }
  if (session.wallet !== null && session.wallet !== playerAddress) {
    return NextResponse.json({ error: "wallet_mismatch", message: "playerAddress must be the signed-in wallet" }, { status: 403 });
  }
  if (!demo && !takeSlot("gacha_pack", playerAddress, PACKS_PER_HOUR)) {
    return NextResponse.json({ error: "rate_limited", message: "Too many packs requested. Please try again later." }, { status: 429 });
  }

  try {
    const provider = getGachaProvider({ demo });
    const result = await provider.generatePack({ playerAddress, packType });
    // One record per memo: later open / submit calls must come from this wallet.
    recordGenerated({ memo: result.memo, wallet: playerAddress, packType, demo: provider.isDemoData });
    return NextResponse.json({ ...result, isDemoData: provider.isDemoData, network: provider.network });
  } catch (error) {
    return gachaErrorResponse(error);
  }
}
