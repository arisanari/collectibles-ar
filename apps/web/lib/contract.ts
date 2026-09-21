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

// Spatial表現の種別。既存の画像付きカード（切手など）と、実寸USDZで置く3D
// twin（こけしなど棚に飾るコレクティブル）を区別する。`card` はdisplayの
// imageUrlをそのまま使う。`model` はresource（例:
// "kokeshi_demo.usdz"）がPackageのResources/modelsに置かれたUSDZファイル名を
// 指す。実ファイルが無い場合はTwinfoldSpatial側でcard表現へfallbackする。
export type SpatialRepresentation =
  | { kind: "card" }
  | { kind: "model"; resource: string };

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
  // 額装カードを壁に実寸で表示するための外寸。cmで持ち、Spatial Client側で
  // メートルへ変換する。`spatialRepresentation.kind === "model"` の
  // twinはUSDZ自体が実寸を持つためdimensionsを持たない。未指定の場合、
  // AssetCardEntityは既定サイズにfallbackする。
  dimensions?: {
    widthCm: number;
    heightCm: number;
    depthCm?: number; // 額の厚み。省略時はAssetCardEntity既定の厚みを使う
    label: string; // 人が読む表記。例: "大判錦絵 額装 外寸 約26.5×39cm"
  };
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
  spatialRepresentation: SpatialRepresentation;
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
