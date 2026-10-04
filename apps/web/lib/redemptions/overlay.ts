// Pure (type-only imports). Overlays a Redemption onto a normalized TwinfoldAsset:
//  - `redemption` summary, so clients can show state and stop offering buyback / send;
//  - provenance: the redeem steps with their correct source. The lock and the burn are ONCHAIN facts (they
//    carry a transaction signature and are merged into the chain-derived events when those exist); requested /
//    shipped / received are OFF-CHAIN evidence, marked dry run (nothing real was shipped). Intermediate steps use
//    kind `redeemed` with status `pending` while the redemption is open (the procedure is not finished);
//    only the retire (burn) is `confirmed`. No new ProvenanceKind is added;
//  - after retire: custody `released`, owner null (the Asset is burnt), no buyback.

import type { ProvenanceEvent, Redemption, RedemptionEvent, TwinfoldAsset } from "../contract";

const isOpen = (r: Redemption) => r.status !== "retired" && r.status !== "cancelled";

/** The redemption that currently affects the Asset: open or retired (a cancelled one no longer does). */
export function affectsAsset(r: Redemption | undefined): r is Redemption {
  return !!r && r.status !== "cancelled";
}

export function applyRedemptionOverlay(asset: TwinfoldAsset, redemption: Redemption | undefined): TwinfoldAsset {
  if (!affectsAsset(redemption)) return asset;
  const retired = redemption.status === "retired";
  const provenance: ProvenanceEvent[] = asset.provenance.map((e) => ({ ...e, metadata: { ...e.metadata } }));

  redemption.events.forEach((event: RedemptionEvent, index) => {
    if (event.kind === "cancelled" || event.kind === "returned") return;
    // Operator-entered text (exception notes) is never exposed through the public asset API.
    const note = event.kind === "exception" ? "Stopped on exception (awaiting operator)" : event.note;
    const meta = { redeemStep: event.kind, redemptionId: redemption.id, ...(event.dryRun ? { dryRun: true } : {}), ...(note ? { note } : {}) };
    if (event.signature) {
      const existing = provenance.find((p) => p.transaction === event.signature);
      if (existing) {
        existing.metadata = { ...existing.metadata, ...meta };
        if (event.kind === "retired") existing.kind = "redeemed";
        return;
      }
    }
    provenance.push({
      id: `${asset.id}-redeem-${redemption.id}-${event.kind}-${index}`,
      assetId: asset.id,
      kind: "redeemed",
      occurredAt: event.at,
      source: event.source,
      status: event.kind === "retired" || retired ? "confirmed" : event.kind === "exception" ? "failed" : "pending",
      ...(event.signature ? { transaction: event.signature } : {}),
      metadata: meta,
    });
  });
  provenance.sort((a, b) => a.occurredAt.localeCompare(b.occurredAt));

  return {
    ...asset,
    owner: retired ? null : asset.owner,
    provenance,
    physical: asset.physical && retired ? { ...asset.physical, custody: { ...asset.physical.custody, status: "released" } } : asset.physical,
    commerce: asset.commerce ? { ...asset.commerce, buybackEligible: false } : asset.commerce,
    redemption: { id: redemption.id, status: redemption.status, open: isOpen(redemption), updatedAt: redemption.updatedAt },
  };
}

/**
 * Entitlement reason for the former owner once the circulating Asset is stopped. `null` = redemption does
 * not change the ordinary chain-owner check (none, cancelled, or only `requested`: the Asset still circulates).
 */
export function redemptionEntitlement(redemption: Redemption | undefined): { canDisplay: false; reason: string } | null {
  if (!affectsAsset(redemption)) return null;
  if (redemption.status === "retired") {
    return { canDisplay: false, reason: `Retired (redemption complete, dry run). Provenance is in the Redeemed Provenance Passport: /passport/${redemption.assetId}` };
  }
  if (redemption.status === "requested") return null;
  return { canDisplay: false, reason: "Redemption in progress (out of circulation)" };
}
