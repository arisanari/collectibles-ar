import type { PhysicalDescriptor, ProvenanceEvent, TwinfoldAsset } from "./contract";

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

export function sortedProvenance(asset: TwinfoldAsset) {
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
