// Pure (type-only imports besides the persistence helper in passports store): builds the Redeemed
// Provenance Passport from the pre-burn snapshot of the Asset and the finished Redemption.
//
// The Passport records provenance and the last verified state UP TO Vault exit. It deliberately does
// NOT guarantee the current owner, the current condition, or authenticity afterwards. onchain fact /
// off-chain evidence / Twinfold interpretation stay distinguishable via each provenance event's `source`.

import type { ProvenanceEvent, RedeemedProvenancePassport, Redemption, TwinfoldAsset } from "../contract";

export const PASSPORT_LIMITATIONS: string[] = [
  "このPassportは、Vault退出（引き取り）までの来歴と、その時点の最終確認状態の記録です。",
  "Vault退出後の現在の所有者、現物の現在の状態、真正性は保証しません。",
  "blockchain上の記録は、作品の真正性や著作権を証明しません。onchainで確かなのは、Assetの発行・移転・失効の履歴だけです。",
  "状態の記載は、画像等からのTwinfoldの所見であり、第三者による鑑定・グレーディングではありません。",
  "redeem後に再流通させるには、再確認（Trust Gate）と、Twinfold Vaultへのre-vaultが必要です。",
  "このデモ（dry run）では実配送を行わず、配送先などの個人情報も記録していません。",
];

export const PASSPORT_XR_CONDITIONS =
  "流通Assetは失効（burn）済みのため、Spatial Client（iPhone AR／Vision Pro）の壁・棚には表示されません。Passportは来歴の閲覧用で、XR表示の権利ではありません。再流通には再確認とre-vaultが必要です。";

/**
 * The ONLY free text a redeem step may carry into the public Passport: fixed, system-generated notes.
 * Operator notes (and `exception` events, which carry them) never reach the Passport.
 */
export const PASSPORT_STEP_NOTES: Record<string, string> = {
  requested: "引き取り申請（dry run）",
  locked: "流通Assetをredemption escrowへ移しました（流通停止）",
  shipped: "保険付き配送相当（dry run、実配送なし）",
  received: "受取確認（dry run、実配送なし）",
  retired: "流通Assetを失効（burn）しました",
};

export class PassportBuildError extends Error {}

/**
 * @param asset a TwinfoldAsset snapshot taken BEFORE the burn (with off-chain physical record and chain history)
 * @param redemption the Redemption at the moment retire succeeded (status `retired`, `retireSignature` set)
 */
export function buildPassport(asset: TwinfoldAsset, redemption: Redemption): RedeemedProvenancePassport {
  if (redemption.status !== "retired" || !redemption.retireSignature) throw new PassportBuildError("redemption is not retired");
  if (!asset.physical) throw new PassportBuildError("asset has no physical record");

  const retiredAt = redemption.events.find((e) => e.kind === "retired")?.at ?? redemption.updatedAt;
  const byId = new Map<string, ProvenanceEvent>();
  for (const event of asset.provenance) byId.set(event.id, event);
  // The burn itself (onchain), in case the snapshot predates it.
  if (!Array.from(byId.values()).some((e) => e.transaction === redemption.retireSignature)) {
    byId.set(`${asset.id}-tx-${redemption.retireSignature}`, {
      id: `${asset.id}-tx-${redemption.retireSignature}`,
      assetId: asset.id,
      kind: "redeemed",
      occurredAt: retiredAt,
      source: "onchain",
      status: "confirmed",
      transaction: redemption.retireSignature,
      metadata: { redeemStep: "retire", note: "流通Assetを失効（burn）" },
    });
  }
  const provenance = Array.from(byId.values())
    // The redeem steps recorded while the procedure was open are `pending`; the procedure is now complete.
    .map((e) => (e.metadata?.redemptionId === redemption.id && e.status === "pending" ? { ...e, status: "confirmed" as const } : e))
    .filter((e) => e.metadata?.redeemStep !== "exception" && (e.occurredAt <= retiredAt || e.kind === "redeemed"))
    .map((e) => {
      const step = e.metadata?.redeemStep;
      if (typeof step !== "string") return e;
      const { note: _operatorOrFree, ...rest } = e.metadata as Record<string, unknown>;
      void _operatorOrFree;
      return { ...e, metadata: PASSPORT_STEP_NOTES[step] ? { ...rest, note: PASSPORT_STEP_NOTES[step] } : rest };
    })
    .sort((a, b) => a.occurredAt.localeCompare(b.occurredAt));

  const isLock = (e: ProvenanceEvent) => !!e.transaction && e.transaction === redemption.lockSignature;
  const mint = provenance.find((e) => e.kind === "minted" && e.source === "onchain" && e.status === "confirmed")?.transaction;
  const transfers = provenance
    .filter((e) => e.kind === "transferred" && e.source === "onchain" && e.status === "confirmed" && e.transaction && !isLock(e))
    .map((e) => e.transaction as string);

  return {
    assetId: asset.id,
    sourceAsset: asset.address,
    physicalId: asset.physical.physicalId,
    title: asset.title,
    titleLocalized: asset.titleLocalized,
    imageUrl: asset.display.imageUrl || undefined,
    rehearsal: asset.rehearsal ? true : undefined,
    redeemedAt: retiredAt,
    lastVerifiedAt: asset.physical.lastVerifiedAt,
    lastVerifiedCondition: asset.physical.condition,
    custodyAtExit: `${asset.physical.custody.vault}のVaultで保管（Vault退出時点の記録: ${asset.physical.custody.status}）`,
    provenance,
    onchain: { mint, transfers, lock: redemption.lockSignature, retire: redemption.retireSignature },
    limitations: PASSPORT_LIMITATIONS,
    xrConditions: PASSPORT_XR_CONDITIONS,
    dryRun: true,
    network: "devnet",
  };
}
