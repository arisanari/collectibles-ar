import { NextResponse } from "next/server";
import { readSmallJson } from "../../../../lib/auth/http";
import { getGachaProvider } from "../../../../lib/gacha";
import { BUYBACK_PER_HOUR, gachaErrorResponse, isDemoAddress, isWalletAddress, rateLimited, requireSession, requireSessionRead } from "../../../../lib/gacha/routeUtils";
import { takeSlot } from "../../../../lib/rateLimit";

export const dynamic = "force-dynamic";

/**
 * Buyback is performed by Collector Crypt (72 hours, rate per machine); SlabAR only relays.
 * GET  /api/gacha/buyback?nft=<address>[&demo=1]            -> { available, amount (USDC, 6 decimals), timeRemaining (s) } (needs the web session unless demo)
 * POST /api/gacha/buyback { playerAddress, nftAddress, demo? } -> { serializedTransaction, refundAmount, memo } (player signs in Phantom, then /api/gacha/submit)
 */
export async function GET(request: Request) {
  const params = new URL(request.url).searchParams;
  const demo = params.get("demo") === "1";
  const nft = params.get("nft");
  const session = await requireSessionRead(request, demo);
  if (!session.ok) return session.response;
  if (typeof nft !== "string" || !(demo ? isDemoAddress(nft) : isWalletAddress(nft))) return NextResponse.json({ error: "invalid_input", message: "nft is required" }, { status: 400 });
  try {
    const provider = getGachaProvider({ demo });
    return NextResponse.json({ ...(await provider.buybackAvailable({ nft })), isDemoData: provider.isDemoData });
  } catch (error) {
    return gachaErrorResponse(error);
  }
}

export async function POST(request: Request) {
  const body = await readSmallJson(request);
  const demo = body?.demo === true;
  const session = await requireSession(request, demo);
  if (!session.ok) return session.response;

  const playerAddress = body?.playerAddress;
  const nftAddress = body?.nftAddress;
  const validAddress = demo ? isDemoAddress : isWalletAddress;
  if (typeof playerAddress !== "string" || typeof nftAddress !== "string" || !validAddress(playerAddress) || !validAddress(nftAddress)) {
    return NextResponse.json({ error: "invalid_input", message: "playerAddress and nftAddress are required" }, { status: 400 });
  }
  if (session.wallet !== null && session.wallet !== playerAddress) {
    return NextResponse.json({ error: "wallet_mismatch", message: "playerAddress must be the signed-in wallet" }, { status: 403 });
  }
  if (!demo && !takeSlot("gacha_buyback", playerAddress, BUYBACK_PER_HOUR)) return rateLimited();
  try {
    const provider = getGachaProvider({ demo });
    return NextResponse.json({ ...(await provider.buildBuyback({ playerAddress, nftAddress })), isDemoData: provider.isDemoData });
  } catch (error) {
    return gachaErrorResponse(error);
  }
}
