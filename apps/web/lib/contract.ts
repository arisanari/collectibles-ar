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
  // Rehearsal token for the redeem dry run (registry id `<baseId>-rehearsal-<n>`): it represents the
  // same physical item as `<baseId>` and is NOT an additional claim on it. Never counted or labeled
  // as a Reference Asset; UI shows a REHEARSAL badge.
  rehearsal?: boolean;
  // Redemption state overlaid by the backend (off-chain record of Twinfold's redeem procedure).
  // Present while a redemption is open or after it finished. Clients must not offer buyback/send for an
  // Asset with `redemption.open === true`.
  redemption?: RedemptionSummary;
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

/** Owner-approved transfer request (Issue #45): created by the iPhone or Web, approved on the Web with Phantom. */
export type TransferRequestKind = "buyback" | "send" | "redeem_lock";
export type TransferRequestStatus = "awaiting_approval" | "submitted" | "confirmed" | "failed" | "rejected" | "expired";

export type TransferRequestView = {
  requestId: string;
  assetId: string;
  assetTitle: string;
  kind: TransferRequestKind;
  status: TransferRequestStatus;
  toWallet: string;
  redemptionId?: string; // set for redeem_lock
  toLabel?: string; // "Twinfold Vault" for a buyback, "Twinfold Redemption Escrow" for redeem_lock
  origin?: "web" | "device"; // "device" = created from the iPhone
  quote?: { basis: { amount: number; currency: string }; rate: number; offerAmount: number; currency: string };
  signature?: string;
  error?: string;
  retryable?: boolean;
  createdAt: string; // ISO 8601 UTC
  expiresAt: string; // ISO 8601 UTC
};

/**
 * "Twinfoldから取得" (Issue #60): an authenticated wallet acquires an Asset held by Twinfold's vault wallet.
 * Devnet only; Twinfold's vault signs, no payment happens. `listedPrice` is Twinfold's off-chain
 * interpretation shown for display only (demo placeholder), not an onchain fact.
 */
export type AcquisitionStatus = "pending" | "submitted" | "confirmed" | "failed";

export type AcquisitionView = {
  requestId: string;
  assetId: string;
  assetTitle: string;
  status: AcquisitionStatus;
  buyerWallet: string;
  listedPrice: { amount: number; currency: string };
  paymentMade: false; // always false: devnet acquisition, no payment
  signature?: string;
  error?: string;
  createdAt: string; // ISO 8601 UTC
  updatedAt: string; // ISO 8601 UTC
};

export type Entitlement = {
  wallet: string;
  assetId: string;
  canDisplay: boolean;
  reason: string;
  checkedAt: string;
};

/**
 * Redeem Physical (dry run, Issues #22/#23/#28/#42). The owner asks to take the physical item out of the
 * Vault; the circulating Asset is stopped (locked into Twinfold's redemption escrow wallet), the
 * dry-run shipping step is recorded, and on receipt the Asset is retired (burned) and a Redeemed
 * Provenance Passport is written. No real shipping happens and NO personal data (name, address,
 * phone) is ever part of a Redemption: a shipping step is only recorded as having happened.
 *
 * requested -> locked -> shipped -> received -> retired ; cancelled (requested/locked only) ;
 * exception (safe stop, e.g. retire failed: the Asset stays in escrow; operator-only retry).
 */
export type RedemptionStatus = "requested" | "locked" | "shipped" | "received" | "retired" | "cancelled" | "exception";

export type RedemptionEventKind = "requested" | "locked" | "shipped" | "received" | "retired" | "cancelled" | "exception" | "returned";

export type RedemptionEvent = {
  kind: RedemptionEventKind;
  at: string; // ISO 8601 UTC
  // onchain: the lock / burn / return transaction (has `signature`). offchain_evidence: Twinfold's own record
  // of a step (requested, shipped, received), marked `dryRun` where nothing real happened.
  source: ProvenanceSource;
  signature?: string;
  dryRun?: boolean;
  note?: string; // short, operator-facing; never personal data
};

export type Redemption = {
  id: string; // client requestId, idempotency key
  assetId: string;
  assetAddress: string;
  assetTitle?: string; // display title at request time (off-chain record)
  wallet: string; // the owner who requested it
  status: RedemptionStatus;
  createdAt: string; // ISO 8601 UTC
  updatedAt: string; // ISO 8601 UTC
  lockSignature?: string;
  retireSignature?: string;
  events: RedemptionEvent[];
  // Owner-approval request that moves the Asset into escrow (status `requested`).
  lockRequestId?: string;
  // Operator-facing reason when status is `exception`.
  exceptionReason?: string;
  exceptionFrom?: RedemptionStatus; // the status the safe stop happened in (retry resumes there)
  passportMissing?: boolean; // operator view only: retired but the Passport could not be written
  dryRun: true; // MVP: always a dry run, no real shipping
};

export type RedemptionSummary = {
  id: string;
  status: RedemptionStatus;
  open: boolean; // requested | locked | shipped | received | exception
  updatedAt: string;
};

export type RedeemedProvenancePassport = {
  assetId: string;
  sourceAsset: string; // the retired Asset's address
  physicalId: string;
  title: string;
  titleLocalized?: { ja?: string; en?: string };
  imageUrl?: string; // shown as a record of the item at exit, not as an authenticity claim
  rehearsal?: boolean;
  redeemedAt: string;
  lastVerifiedAt: string;
  lastVerifiedCondition: string; // the last condition record up to Vault exit; not a current condition
  custodyAtExit: string;
  // History up to Vault exit, each tagged with its source (onchain / off-chain evidence / Twinfold interpretation).
  provenance: ProvenanceEvent[];
  onchain: {
    mint?: string; // mint transaction signature, when known
    transfers: string[]; // transfer signatures up to exit
    lock?: string;
    retire?: string;
  };
  limitations: string[]; // non-guarantee statements, shown prominently
  xrConditions: string; // what XR display remains (or not) after redemption
  dryRun: true;
  network: "devnet";
};

export interface AssetProvider {
  /** true when data comes from fixtures; UI shows DEMO DATA, otherwise DEVNET */
  readonly isDemoData: boolean;
  getAssets(wallet: string): Promise<TwinfoldAsset[]>;
  getAsset(assetId: string): Promise<TwinfoldAsset>;
  refreshOwnership(assetId: string): Promise<Entitlement>;
}
