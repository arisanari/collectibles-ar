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
  pending_intake: "Vault登録前（自己保管）",
};

export const sourceLabel: Record<ProvenanceEvent["source"], string> = {
  onchain: "On-chain",
  offchain_evidence: "Off-chain evidence",
  twinfold_interpretation: "Twinfold interpretation",
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
  requested: "申請済み（Phantomでlock承認待ち）",
  locked: "流通停止中（lock済み）",
  shipped: "発送済み（dry run）",
  received: "受取確認済み（失効処理中）",
  retired: "失効・Passport発行済み",
  cancelled: "取消済み",
  exception: "例外停止（operator対応待ち）",
};

/** Stepper: 申請 -> 流通停止（lock） -> 発送（dry run） -> 受取確認 -> 失効・Passport. */
export const redemptionSteps = ["申請", "流通停止（lock）", "発送（dry run）", "受取確認", "失効・Passport"] as const;

/** Index of the step a redemption is currently at (steps before it are done; `retired` = all done). */
export function redemptionStepIndex(status: Redemption["status"], exceptionFrom?: Redemption["status"]): number {
  const order: Redemption["status"][] = ["requested", "locked", "shipped", "received", "retired"];
  if (status === "exception") return Math.max(0, order.indexOf(exceptionFrom ?? "locked"));
  return Math.max(0, order.indexOf(status));
}

const redeemStepLabel: Record<string, string> = {
  requested: "Redeem · 申請",
  locked: "Redeem · 流通停止（lock）",
  shipped: "Redeem · 発送（dry run）",
  received: "Redeem · 受取確認（dry run）",
  retired: "Redeemed · 失効（burn）",
  exception: "Redeem · 例外停止",
};

/** Title for a provenance event; redeem steps (kind `redeemed` with metadata.redeemStep) are named by their step. */
export function provenanceTitle(event: ProvenanceEvent): string {
  const step = typeof event.metadata?.redeemStep === "string" ? event.metadata.redeemStep : undefined;
  if (step && redeemStepLabel[step]) return redeemStepLabel[step];
  return kindLabel[event.kind];
}
