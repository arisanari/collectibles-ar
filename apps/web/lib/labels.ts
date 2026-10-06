import type { PhysicalDescriptor, ProvenanceEvent, Redemption, TwinfoldAsset } from "./contract";

export const kindLabel: Record<ProvenanceEvent["kind"], string> = {
  minted: "Minted",
  transferred: "Transferred",
  rwa_verified: "RWA Verified",
  vaulted: "Vaulted",
  redeemed: "Redeemed",
};

export const custodyStatusLabel: Record<PhysicalDescriptor["custody"]["status"], string> = {
  vaulted: "Vaulted",
  released: "Released",
  exception: "Exception",
  pending_intake: "Pre-vault (self-custody)",
};

export const sourceLabel: Record<ProvenanceEvent["source"], string> = {
  onchain: "On-chain",
  offchain_evidence: "Off-chain evidence",
  twinfold_interpretation: "SlabAR interpretation",
};

export function explorerAddressUrl(address: string) {
  return `https://explorer.solana.com/address/${address}?cluster=devnet`;
}

export function explorerTxUrl(signature: string) {
  return `https://explorer.solana.com/tx/${signature}?cluster=devnet`;
}

export function sortedProvenance(asset: Pick<TwinfoldAsset, "provenance">) {
  return [...asset.provenance].sort((a, b) => a.occurredAt.localeCompare(b.occurredAt));
}

export function shortAddress(address: string) {
  return address.length > 10 ? `${address.slice(0, 4)}…${address.slice(-4)}` : address;
}

/** Short label for `TwinfoldAsset.spatialRepresentation`. */
export function spatialLabel(asset: TwinfoldAsset) {
  return asset.spatialRepresentation.kind === "model"
    ? `3D twin · ${asset.spatialRepresentation.resource}`
    : "Card";
}

// ---- Redeem Physical (dry run) ----

export const redemptionStatusLabel: Record<Redemption["status"], string> = {
  requested: "Requested (awaiting lock approval in Phantom)",
  locked: "Locked (out of circulation)",
  shipped: "Shipped (dry run)",
  received: "Receipt confirmed (retiring)",
  retired: "Retired (burned), Passport issued",
  cancelled: "Cancelled",
  exception: "Stopped on exception (awaiting operator)",
};

/** Stepper: request -> lock -> shipping (dry run) -> receipt -> retire + Passport. */
export const redemptionSteps = ["Request", "Locked (out of circulation)", "Shipped (dry run)", "Receipt confirmed", "Retired + Passport"] as const;

/** Index of the step a redemption is currently at (steps before it are done; `retired` = all done). */
export function redemptionStepIndex(status: Redemption["status"], exceptionFrom?: Redemption["status"]): number {
  const order: Redemption["status"][] = ["requested", "locked", "shipped", "received", "retired"];
  if (status === "exception") return Math.max(0, order.indexOf(exceptionFrom ?? "locked"));
  return Math.max(0, order.indexOf(status));
}

const redeemStepLabel: Record<string, string> = {
  requested: "Redeem · Requested",
  locked: "Redeem · Locked (out of circulation)",
  shipped: "Redeem · Shipped (dry run)",
  received: "Redeem · Receipt confirmed (dry run)",
  retired: "Redeemed · Retired (burned)",
  exception: "Redeem · Stopped on exception",
};

/** Title for a provenance event; redeem steps (kind `redeemed` with metadata.redeemStep) are named by their step. */
export function provenanceTitle(event: ProvenanceEvent): string {
  const step = typeof event.metadata?.redeemStep === "string" ? event.metadata.redeemStep : undefined;
  if (step && redeemStepLabel[step]) return redeemStepLabel[step];
  return kindLabel[event.kind];
}
