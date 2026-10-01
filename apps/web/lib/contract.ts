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
  // "pending_intake": physical item exists and is recorded, but has not yet
  // been placed in a Twinfold-operated Vault (e.g. self-custody ahead of RWA
  // intake). Distinct from "exception", which means an active
  // mismatch/problem needing resolution.
  custody: { vault: string; status: "vaulted" | "released" | "exception" | "pending_intake" };
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

// Off-chain Twinfold interpretation, not an onchain fact: Twinfold's own
// listed price for this Asset and the buyback terms derived from it. Prices
// here are DEMO PLACEHOLDER values pending the user setting real ones (see
// fixtures/demo/assets.json comments). `buybackEligible` is a snapshot
// computed when the record was materialized (custody vaulted && not
// redeemed); callers that need a live, non-stale answer (e.g. the actual
// offer flow) should re-check via the buyback-quote endpoint /
// AssetProvider.buybackQuote instead of trusting this field alone.
export type Commerce = {
  // Twinfold's current listed (sales) price for this Asset — the basis the
  // buyback offer is a percentage of. Not what the current owner paid.
  twinfoldPrice: { amount: number; currency: "USDC" };
  buybackRate: number; // 0.8 = Twinfold buys back at 80% of twinfoldPrice
  buybackEligible: boolean;
  // Optional human-readable note. fixtures/demo/assets.json sets this to
  // flag that twinfoldPrice is a DEMO PLACEHOLDER, not a real listed price.
  priceNote?: string;
};

export type TwinfoldAsset = {
  id: string; // "tf-stamp-001"
  network: "devnet";
  address: string; // fixtureは "DEMO-..." で始める
  standard: string; // "metaplex-core"
  owner: string | null;
  title: string; // Devnetではon-chain metadata name（onchain fact）
  titleLocalized?: { ja?: string; en?: string }; // Twinfoldのoff-chain記録。表示言語の選択に使う
  display: DisplayDescriptor;
  spatialRepresentation: SpatialRepresentation;
  provenance: ProvenanceEvent[];
  physical?: PhysicalDescriptor;
  commerce?: Commerce;
};

// GET /api/solana/assets/[assetId]/buyback-quote?wallet=... response shape.
// A quote is a snapshot with an expiry, not a binding price — the actual
// transfer endpoint re-derives eligibility from current custody/ownership at
// send time rather than trusting a stale quote.
export type BuybackQuote = {
  assetId: string;
  basis: { amount: number; currency: "USDC" };
  rate: number;
  offerAmount: number;
  currency: "USDC";
  eligible: boolean;
  reason: string;
  quoteId: string;
  expiresAt: string; // ISO 8601 UTC
};

export type DevnetTransferStatus = "pending" | "confirmed" | "failed";

export type DevnetTransferResult = {
  requestId: string;
  assetId: string;
  status: DevnetTransferStatus;
  signature?: string;
  error?: string;
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
