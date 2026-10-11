import { NextResponse } from "next/server";
import { getOpenedPackByNft } from "../../../../lib/gacha/packStore";
import { takeSlot } from "../../../../lib/rateLimit";

export const dynamic = "force-dynamic";

const NFT_ADDRESS = /^[1-9A-HJ-NP-Za-km-z]{32,44}$/;
const LOOKUPS_PER_HOUR = 120;

/**
 * GET /api/gacha/reveal?nft=<card address>
 * The public facts of a card that was pulled through this server on devnet, for replaying the opening in a browser that has no session
 * (the Pull is signed inside the Phantom app, whose browser cannot use the camera). No session: the card address is public on chain and
 * the answer holds nothing else (no memo, no wallet, no signature). Read only; nothing is written and Collector Crypt is not called.
 */
export async function GET(request: Request) {
  const nft = new URL(request.url).searchParams.get("nft") ?? "";
  if (!NFT_ADDRESS.test(nft)) return NextResponse.json({ error: "invalid_input", message: "nft is required" }, { status: 400 });
  if (!takeSlot("gacha_reveal", nft, LOOKUPS_PER_HOUR)) return NextResponse.json({ error: "rate_limited", message: "Too many requests. Please try again later." }, { status: 429 });
  const record = getOpenedPackByNft(nft);
  if (!record?.asset) return NextResponse.json({ error: "not_found", message: "No opened Pull is known for this card" }, { status: 404 });
  const { asset } = record;
  return NextResponse.json({
    isDemoData: false,
    network: "devnet",
    title: asset.title,
    imageUrl: asset.display.placeholder ? null : asset.display.imageUrl,
    backImageUrl: record.backImageUrl ?? null,
    grade: asset.grade ?? null,
    gradingCompany: asset.gradingCompany ?? null,
    rarity: record.rarity ?? null,
  });
}
