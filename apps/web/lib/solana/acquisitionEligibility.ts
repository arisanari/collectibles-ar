// Server-only (pure, type-only imports so it is unit-testable). The reverse of
// buybackEligibility.ts: "Twinfoldから取得" is allowed only for an Asset that
// Twinfold's vault wallet currently holds on chain, that has a listed
// (off-chain, Twinfold-interpretation) price, and that is not redeemed.
// The on-chain owner is passed in by the caller, who must re-read it right
// before signing; a request status or a client claim is never proof of ownership.

import type { TwinfoldAsset } from "../contract";

export const NOT_ACQUIRABLE_MESSAGE = "This work is not currently available to acquire";

export type AcquisitionEligibility = { eligible: boolean; reasons: string[] };

export function evaluateAcquisitionEligibility(params: {
  offchainRecord: TwinfoldAsset | undefined;
  /** Current on-chain owner (Helius `ownership.owner`), or null/undefined if unknown. */
  currentOwner: string | null | undefined;
  burnt?: boolean;
  /** Twinfold's vault wallet address. */
  vaultWallet: string | null | undefined;
  /** True while a redemption (Redeem Physical) is open for this Asset. */
  redemptionOpen?: boolean;
}): AcquisitionEligibility {
  const { offchainRecord, currentOwner, burnt, vaultWallet, redemptionOpen } = params;
  const reasons: string[] = [];
  if (redemptionOpen) reasons.push("A redeem (physical item redemption) is in progress");
  if (!offchainRecord?.commerce) reasons.push("The SlabAR list price is not set");
  if (!vaultWallet) reasons.push("The SlabAR vault wallet is not configured");
  if (burnt) reasons.push("The Asset has been retired (burned)");
  if (vaultWallet && currentOwner !== vaultWallet) reasons.push("The SlabAR vault wallet does not hold it on devnet");
  const redeemed = offchainRecord?.provenance.some((e) => e.kind === "redeemed" && e.status === "confirmed");
  if (redeemed) reasons.push("The physical item has been redeemed, so it is not eligible");
  return { eligible: reasons.length === 0, reasons };
}
