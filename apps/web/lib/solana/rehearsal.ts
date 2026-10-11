// Pure. Rehearsal Assets for the redeem dry run: registry ids of the form `<baseId>-rehearsal-<n>`
// (e.g. "tf-ukiyoe-001-rehearsal-1") resolve to the off-chain record of `<baseId>` and are marked
// `rehearsal: true`. A rehearsal token represents the same physical item as its base Asset and is NOT an
// additional claim on it; it is never counted or labeled as a Reference Asset.

import type { TwinfoldAsset } from "../contract";

const REHEARSAL_ID = /^(.+)-rehearsal-(\d+)$/;

export function parseRehearsalId(assetId: string): { baseId: string; n: number } | null {
  const match = REHEARSAL_ID.exec(assetId);
  return match ? { baseId: match[1], n: Number(match[2]) } : null;
}

export const REHEARSAL_SUFFIX_EN = " (rehearsal)";

/** Off-chain record of a rehearsal Asset, derived from the base record. Never labeled a Reference Asset. */
export function rehearsalRecord(base: TwinfoldAsset, assetId: string): TwinfoldAsset {
  const localized = base.titleLocalized;
  return {
    ...base,
    id: assetId,
    address: `DEMO-REHEARSAL-${assetId}`,
    title: `${base.title}${REHEARSAL_SUFFIX_EN}`,
    titleLocalized: {
      en: `${localized?.en ?? base.title}${REHEARSAL_SUFFIX_EN}`,
    },
    provenance: base.provenance.map((event) => ({ ...event, id: `${assetId}-${event.id}`, assetId })),
    rehearsal: true,
  };
}
