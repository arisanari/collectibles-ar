// Server-only (pure, type-only imports so it is unit-testable). The reverse of
// buybackEligibility.ts: "Twinfoldから取得" is allowed only for an Asset that
// Twinfold's vault wallet currently holds on chain, that has a listed
// (off-chain, Twinfold-interpretation) price, and that is not redeemed.
// The on-chain owner is passed in by the caller, who must re-read it right
// before signing; a request status or a client claim is never proof of ownership.

import type { TwinfoldAsset } from "../contract";

export const NOT_ACQUIRABLE_MESSAGE = "この作品は現在取得できません";

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
  if (redemptionOpen) reasons.push("redeem（現物の引き取り）手続き中です");
  if (!offchainRecord?.commerce) reasons.push("Twinfoldの販売価格が設定されていません");
  if (!vaultWallet) reasons.push("Twinfold vault walletが設定されていません");
  if (burnt) reasons.push("Assetが失効（burn）しています");
  if (vaultWallet && currentOwner !== vaultWallet) reasons.push("devnet上でTwinfoldのvault walletが保有していません");
  const redeemed = offchainRecord?.provenance.some((e) => e.kind === "redeemed" && e.status === "confirmed");
  if (redeemed) reasons.push("現物を引き取り済み（redeem済み）のため対象外です");
  return { eligible: reasons.length === 0, reasons };
}
