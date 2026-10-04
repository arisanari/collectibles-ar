// Server-only. Shared "Twinfoldに売る" buyback eligibility rule, so
// /api/solana/assets/[assetId]/buyback-quote (an advisory quote) and
// /api/devnet/transfer (which actually signs and sends) can never disagree
// about who is allowed to sell an Asset back to Twinfold. Eligible only if
// `wallet` is the current on-chain owner, the off-chain record's custody is
// `"vaulted"`, and no `redeemed` event has been confirmed. The quote is
// advisory only — /api/devnet/transfer re-derives this itself right before
// signing, rather than trusting a client-supplied quoteId.

import type { TwinfoldAsset } from "../contract";

export type BuybackEligibility = {
  eligible: boolean;
  /** Empty when eligible. One entry per failed check, joinable for display. */
  reasons: string[];
};

export function evaluateBuybackEligibility(params: {
  offchainRecord: TwinfoldAsset | undefined;
  /** Current on-chain owner (Helius `ownership.owner`), or null/undefined if unknown/burnt. */
  currentOwner: string | null | undefined;
  burnt?: boolean;
  wallet: string;
  /** True while a redemption (Redeem Physical) is open for this Asset: it must not be offered for buyback. */
  redemptionOpen?: boolean;
}): BuybackEligibility {
  const { offchainRecord, currentOwner, burnt, wallet, redemptionOpen } = params;

  if (!offchainRecord?.commerce) {
    return { eligible: false, reasons: ["no OshiPin price set for this asset"] };
  }

  const reasons: string[] = [];
  if (redemptionOpen) reasons.push("Cannot sell while a redeem (physical item redemption) is in progress");
  if (burnt) reasons.push("The Asset has been retired (burned)");
  if (currentOwner !== wallet) {
    reasons.push("This wallet is not the current owner on devnet");
  }
  const custodyStatus = offchainRecord.physical?.custody.status;
  if (custodyStatus !== "vaulted") {
    reasons.push(`Not Vaulted, so not eligible to sell to OshiPin (custody: ${custodyStatus ?? "unknown"})`);
  }
  const alreadyRedeemed = offchainRecord.provenance.some(
    (event) => event.kind === "redeemed" && event.status === "confirmed"
  );
  if (alreadyRedeemed) {
    reasons.push("The physical item has been redeemed, so it is not eligible");
  }

  return { eligible: reasons.length === 0, reasons };
}
