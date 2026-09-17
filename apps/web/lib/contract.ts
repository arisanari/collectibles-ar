// Twinfold common model. This file is the source of truth for the shared
// contract described in docs/architecture.md section 4-5. The Swift copy in
// packages/TwinfoldCore (shared by iOS and visionOS) must mirror these fields
// and JSON key names exactly. Do not edit the copy directly; change here first.

export type ProvenanceKind =
  | "minted"
  | "transferred"
  | "rwa_verified"
  | "vaulted"
  | "redeemed";

export type ProvenanceSource =
  | "onchain"
  | "offchain_evidence"
  | "twinfold_interpretation";

export type ProvenanceStatus = "pending" | "confirmed" | "failed";

export type DisplayDescriptor = {
  kind: "image";
  imageUrl: string; // Webでは /artworks/... のようなpublicパス
  placeholder: boolean; // fixtureはtrue
  rightsNote: string; // 画像利用権のメモ
};

export type PhysicalDescriptor = {
  physicalId: string;
  condition: string;
  rights: string; // 物理所有権・図案の著作権・画像利用の区別を一文で
  custody: { vault: string; status: "vaulted" | "released" | "exception" };
  lastVerifiedAt: string; // ISO 8601 UTC
};

export type ProvenanceEvent = {
  id: string;
  assetId: string;
  kind: ProvenanceKind;
  occurredAt: string;
  source: ProvenanceSource;
  status: ProvenanceStatus;
  transaction?: string;
  slot?: number;
  evidenceHash?: string;
  metadata: Record<string, unknown>;
};

export type TwinfoldAsset = {
  id: string; // "tf-stamp-001"
  network: "devnet";
  address: string; // fixtureは "DEMO-..." で始める
  standard: string; // "metaplex-core"
  owner: string | null;
  title: string;
  display: DisplayDescriptor;
  provenance: ProvenanceEvent[];
  physical?: PhysicalDescriptor;
};

export type Entitlement = {
  wallet: string;
  assetId: string;
  canDisplay: boolean;
  reason: string;
  checkedAt: string;
};

export type RedeemedProvenancePassport = {
  sourceAsset: string;
  redeemedAt: string;
  lastVerifiedAt: string;
  limitations: string[];
};

export interface AssetProvider {
  /** true when data comes from fixtures; UI shows DEMO DATA, otherwise DEVNET */
  readonly isDemoData: boolean;
  getAssets(wallet: string): Promise<TwinfoldAsset[]>;
  getAsset(assetId: string): Promise<TwinfoldAsset>;
  refreshOwnership(assetId: string): Promise<Entitlement>;
}
