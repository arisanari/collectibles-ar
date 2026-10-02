import { NextResponse } from "next/server";
import { getAsset } from "../../../../../../lib/solana/heliusClient";
import { resolveAssetAddress } from "../../../../../../lib/solana/assetRegistry";
import { findOffchainRecord } from "../../../../../../lib/solana/normalize";
import { isAssetInRedemption } from "../../../../../../lib/redemptions/store";
import { evaluateBuybackEligibility } from "../../../../../../lib/solana/buybackEligibility";
import type { BuybackQuote } from "../../../../../../lib/contract";

export const dynamic = "force-dynamic";

/**
 * GET /api/solana/assets/[assetId]/buyback-quote?wallet=<pubkey>
 *
 * Computes the "Twinfoldに売る" buyback offer: `buybackRate` (80%) of
 * Twinfold's current listed (sales) price (`commerce.twinfoldPrice`, an
 * off-chain Twinfold interpretation from fixtures/demo/assets.json's
 * offchain record — see docs/architecture.md section 3, RWA Adapter is the
 * eventual real source) — never 80% of what the wallet paid, which would
 * allow wash-trade extraction. Eligibility (`wallet` is the current
 * on-chain owner, custody is `"vaulted"`, no confirmed `redeemed` event) is
 * computed by `evaluateBuybackEligibility`, the same helper
 * `/api/devnet/transfer` uses right before signing a buyback — so this
 * route and the one that actually moves the Asset can never disagree. This
 * response is a quote (has `expiresAt`), not a binding price:
 * `/api/devnet/transfer` re-derives eligibility itself at send time rather
 * than trusting a client-supplied `quoteId`.
 */
export async function GET(request: Request, context: { params: Promise<{ assetId: string }> }) {
  const { assetId } = await context.params;
  const { searchParams } = new URL(request.url);
  const wallet = searchParams.get("wallet");
  if (!wallet) {
    return NextResponse.json({ error: "missing required query param: wallet" }, { status: 400 });
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

  const offchainRecord = findOffchainRecord(assetId);
  const now = new Date();
  const quoteId = `devnet-quote-${crypto.randomUUID()}`;
  const expiresAt = new Date(now.getTime() + 10 * 60 * 1000).toISOString();

  if (!offchainRecord?.commerce) {
    const quote: BuybackQuote = {
      assetId,
      basis: { amount: 0, currency: "USDC" },
      rate: 0,
      offerAmount: 0,
      currency: "USDC",
      eligible: false,
      reason: "この作品にはTwinfoldの販売価格が設定されていません",
      quoteId,
      expiresAt,
    };
    return NextResponse.json(quote);
  }

  try {
    const heliusAsset = await getAsset(address);
    const { eligible, reasons } = evaluateBuybackEligibility({
      offchainRecord,
      currentOwner: heliusAsset.ownership.owner,
      burnt: heliusAsset.burnt,
      wallet,
      redemptionOpen: isAssetInRedemption(assetId),
    });

    const commerce = offchainRecord.commerce;
    const offerAmount = Math.round(commerce.twinfoldPrice.amount * commerce.buybackRate * 100) / 100;

    const quote: BuybackQuote = {
      assetId,
      basis: { amount: commerce.twinfoldPrice.amount, currency: commerce.twinfoldPrice.currency },
      rate: commerce.buybackRate,
      offerAmount,
      currency: commerce.twinfoldPrice.currency,
      eligible,
      reason: eligible
        ? `Twinfold buyback offerの対象です（確認 ${now.toISOString()}）`
        : reasons.join("／"),
      quoteId,
      expiresAt,
    };
    return NextResponse.json(quote);
  } catch (error) {
    console.error(`GET /api/solana/assets/${assetId}/buyback-quote failed`, error);
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "unknown error" },
      { status: 502 }
    );
  }
}
