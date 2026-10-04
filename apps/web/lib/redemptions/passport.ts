// Pure (type-only imports besides the persistence helper in passports store): builds the Redeemed
// Provenance Passport from the pre-burn snapshot of the Asset and the finished Redemption.
//
// The Passport records provenance and the last verified state UP TO Vault exit. It deliberately does
// NOT guarantee the current owner, the current condition, or authenticity afterwards. onchain fact /
// off-chain evidence / Twinfold interpretation stay distinguishable via each provenance event's `source`.

import type { ProvenanceEvent, RedeemedProvenancePassport, Redemption, TwinfoldAsset } from "../contract";

export const PASSPORT_LIMITATIONS: string[] = [
  "This Passport records provenance up to Vault exit (redemption) and the last verified state at that time.",
  "It does not guarantee the current owner, the current condition of the physical item, or its authenticity after Vault exit.",
  "Records on the blockchain do not prove a work's authenticity or copyright. Onchain, only the history of the Asset's issue, transfer and retirement is certain.",
  "Condition notes are OshiPin's own observations from images and other material. They are not a third-party appraisal or grading.",
  "To circulate it again after redemption, it must be re-verified (Trust Gate) and re-vaulted into the OshiPin Vault.",
  "This demo (dry run) ships nothing and records no personal data such as a delivery address.",
];

export const PASSPORT_XR_CONDITIONS =
  "The circulating Asset has been retired (burned), so it no longer appears on the walls or shelves of the Spatial Clients (iPhone AR / Vision Pro). The Passport is for viewing provenance and is not a right to display in XR. Circulating it again needs re-verification and re-vaulting.";

/**
 * The ONLY free text a redeem step may carry into the public Passport: fixed, system-generated notes.
 * Operator notes (and `exception` events, which carry them) never reach the Passport.
 */
export const PASSPORT_STEP_NOTES: Record<string, string> = {
  requested: "Redemption requested (dry run)",
  locked: "Circulating Asset moved to the redemption escrow (out of circulation)",
  shipped: "Insured-shipping equivalent (dry run, nothing actually shipped)",
  received: "Receipt confirmed (dry run, nothing actually shipped)",
  retired: "Circulating Asset retired (burned)",
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
      metadata: { redeemStep: "retire", note: "Circulating Asset retired (burned)" },
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
    custodyAtExit: `Kept in the ${asset.physical.custody.vault} Vault (record as of Vault exit: ${asset.physical.custody.status})`,
    provenance,
    onchain: { mint, transfers, lock: redemption.lockSignature, retire: redemption.retireSignature },
    limitations: PASSPORT_LIMITATIONS,
    xrConditions: PASSPORT_XR_CONDITIONS,
    dryRun: true,
    network: "devnet",
  };
}
