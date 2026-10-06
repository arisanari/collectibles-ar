import type { PhysicalDescriptor, ProvenanceEvent, TwinfoldAsset } from "../contract";
import type { Localized } from "../i18n";

/**
 * UI copy for the landing page (/) and the components it shares with /collection
 * (AssetCard, PhysicalDetails, ProvenanceList, VaultAcquisitionSection). Strings that come from
 * asset data (titles are localized via titleLocalized; condition, rights and notes are not) are not here.
 */

export const hero = {
  lead: {
    en: "Real-world collectibles, owned onchain. Place them in your room in AR at true size, line them up, and share the shot. The original stays in the vault.",
    ja: "オンチェーンで所有する実物コレクティブルを、ARで自分の部屋に実寸で飾り、並べて、撮ってシェアできます。現物は保管庫に置いたまま。",
  } satisfies Localized,
  cta: { en: "See what's available", ja: "取得できる作品を見る" } satisfies Localized,
  proof: [
    { en: "Ukiyo-e prints", ja: "浮世絵・古版画" },
    { en: "Vault storage", ja: "Vault保管" },
    { en: "Owned on Solana", ja: "Solanaで所有" },
    { en: "Place it in AR", ja: "ARで飾る" },
  ] satisfies Localized[],
};

export const devnetSection = {
  eyebrow: { en: "ONCHAIN · SOLANA", ja: "ONCHAIN · SOLANA" } satisfies Localized,
  heading: { en: "Live on Solana", ja: "Solana上の作品" } satisfies Localized,
  loading: { en: "Loading…", ja: "読み込み中…" } satisfies Localized,
  error: { en: "Couldn't load onchain assets right now.", ja: "いまオンチェーンの作品を読み込めません。" } satisfies Localized,
};

/** Onchain piece block and cards inside "Live on Solana" (landing only). */
export const devnetFeature = {
  label: { en: "ONCHAIN PIECE", ja: "オンチェーンの1点" } satisfies Localized,
  owner: { en: "Owner", ja: "所有者" } satisfies Localized,
  // Custody is an off-chain record, unlike Owner and Asset (onchain facts); the label says so.
  custody: { en: "Custody (off-chain record)", ja: "保管（オフチェーン記録）" } satisfies Localized,
  asset: { en: "Asset", ja: "Asset" } satisfies Localized,
  noImage: { en: "No image", ja: "画像なし" } satisfies Localized,
  previous: { en: "Previous piece", ja: "前の作品" } satisfies Localized,
  next: { en: "Next piece", ja: "次の作品" } satisfies Localized,
  rehearsalTitle: {
    en: "Rehearsal token for the redeem dry run. Not a Reference Asset.",
    ja: "redeem dry run用のリハーサルToken。Reference Assetではありません",
  } satisfies Localized,
};

export const browse = {
  eyebrow: { en: "COLLECTION", ja: "COLLECTION" } satisfies Localized,
  heading: { en: "Browse by category", ja: "カテゴリから見る" } satisfies Localized,
  comingSoon: { en: "coming soon", ja: "近日公開" } satisfies Localized,
  demoTag: { en: "Demo", ja: "デモ" } satisfies Localized,
  ukiyoe: {
    eyebrow: { en: "WALL", ja: "壁" } satisfies Localized,
    title: { en: "Ukiyo-e", ja: "浮世絵" } satisfies Localized,
  },
  shelf: {
    eyebrow: { en: "SHELF · COMING SOON", ja: "棚 · 近日公開" } satisfies Localized,
    title: { en: "Figures & folk crafts", ja: "フィギュア・郷土玩具" } satisfies Localized,
  },
  cards: {
    eyebrow: { en: "CARDS · COMING SOON", ja: "カード · 近日公開" } satisfies Localized,
    title: { en: "Trading cards", ja: "トレーディングカード" } satisfies Localized,
  },
};

/** Display-only classification used by the landing page: 3D twins sit on a shelf, everything else hangs on a wall. */
export type SpatialCategory = "wall" | "shelf";

export function spatialCategory(asset: TwinfoldAsset): SpatialCategory {
  return asset.spatialRepresentation.kind === "model" ? "shelf" : "wall";
}

export const spatialShort: Record<SpatialCategory, Localized> = {
  wall: { en: "Wall · true size", ja: "壁・実寸" },
  shelf: { en: "Shelf · 3D", ja: "棚・3D" },
};

export const eventCount = (n: number): Localized => ({ en: `${n} provenance events`, ja: `来歴 ${n}件` });

export const detail = {
  close: { en: "Close", ja: "閉じる" } satisfies Localized,
  viewInAr: { en: "View in AR (demo)", ja: "ARで見る（デモ）" } satisfies Localized,
  toast: { en: "Sent to your AR room (demo)", ja: "ARの部屋へ送信しました（デモ）" } satisfies Localized,
  owner: { en: "owner", ja: "所有者" } satisfies Localized,
  unowned: { en: "unowned", ja: "所有者なし" } satisfies Localized,
  display: { en: "Display", ja: "表示" } satisfies Localized,
  physical: { en: "PHYSICAL", ja: "現物" } satisfies Localized,
  provenance: { en: "PROVENANCE", ja: "来歴" } satisfies Localized,
  physicalId: { en: "Physical ID", ja: "現物ID" } satisfies Localized,
  condition: { en: "Condition", ja: "状態" } satisfies Localized,
  custody: { en: "Custody", ja: "保管" } satisfies Localized,
  lastVerified: { en: "Last verified", ja: "最終確認" } satisfies Localized,
};

export const custodyText: Record<PhysicalDescriptor["custody"]["status"], Localized> = {
  vaulted: { en: "Vaulted", ja: "Vault保管中" },
  released: { en: "Released", ja: "引き渡し済み" },
  exception: { en: "Exception", ja: "例外停止" },
  pending_intake: { en: "Not in the vault yet (self-custody)", ja: "Vault登録前（自己保管）" },
};

export const sourceText: Record<ProvenanceEvent["source"], Localized> = {
  onchain: { en: "On-chain", ja: "オンチェーン" },
  offchain_evidence: { en: "Off-chain evidence", ja: "オフチェーンの証跡" },
  twinfold_interpretation: { en: "SlabAR interpretation", ja: "SlabARの解釈" },
};

const kindText: Record<ProvenanceEvent["kind"], Localized> = {
  minted: { en: "Minted", ja: "発行" },
  transferred: { en: "Transferred", ja: "移転" },
  rwa_verified: { en: "RWA Verified", ja: "現物確認" },
  vaulted: { en: "Vaulted", ja: "Vault保管" },
  redeemed: { en: "Redeemed", ja: "Redeem" },
};

const redeemStepText: Record<string, Localized> = {
  requested: { en: "Redeem · requested", ja: "Redeem · 申請" },
  locked: { en: "Redeem · locked", ja: "Redeem · 流通停止（lock）" },
  shipped: { en: "Redeem · shipped (dry run)", ja: "Redeem · 発送（dry run）" },
  received: { en: "Redeem · received (dry run)", ja: "Redeem · 受取確認（dry run）" },
  retired: { en: "Redeemed · retired (burn)", ja: "Redeemed · 失効（burn）" },
  exception: { en: "Redeem · exception", ja: "Redeem · 例外停止" },
};

/** Title for a provenance event; redeem steps (kind `redeemed` with metadata.redeemStep) are named by their step. */
export function provenanceTitleText(event: ProvenanceEvent): Localized {
  const step = typeof event.metadata?.redeemStep === "string" ? event.metadata.redeemStep : undefined;
  if (step && redeemStepText[step]) return redeemStepText[step];
  return kindText[event.kind];
}

export const provenanceUi = {
  dryRun: { en: "DRY RUN · no real shipment", ja: "DRY RUN · 実配送なし" } satisfies Localized,
  showAll: (n: number): Localized => ({ en: `Show all ${n} events`, ja: `来歴をすべて表示（${n}件）` }),
  showLess: { en: "Show less", ja: "閉じる" } satisfies Localized,
  evidence: { en: "evidence", ja: "証跡" } satisfies Localized,
};

export const physicalUi = {
  summary: { en: "PHYSICAL · Records of the physical item (with sources)", ja: "PHYSICAL · 現物の記録（出典つき）" } satisfies Localized,
  physicalId: detail.physicalId,
  assetAddress: { en: "Asset address", ja: "Assetアドレス" } satisfies Localized,
  condition: detail.condition,
  notAppraisal: { en: "not an appraisal", ja: "鑑定ではない" } satisfies Localized,
  rights: { en: "Rights", ja: "権利" } satisfies Localized,
  custody: detail.custody,
  lastVerified: detail.lastVerified,
};

export const assetCardUi = {
  unowned: detail.unowned,
  demo: { en: "Demo", ja: "デモ" } satisfies Localized,
  custody: { en: "CUSTODY", ja: "保管" } satisfies Localized,
  provenance: detail.provenance,
  rehearsalTitle: {
    en: "Rehearsal token for the redeem dry run. Not a Reference Asset.",
    ja: "redeem dry run用のリハーサルToken。Reference Assetではありません",
  } satisfies Localized,
  offerHeading: { en: "SLABAR PRICE / BUYBACK OFFER", ja: "SLABAR価格 / 買取オファー" } satisfies Localized,
  price: { en: "SlabAR price", ja: "SlabAR価格" } satisfies Localized,
  buyback: (pct: number): Localized => ({ en: `Buyback offer (${pct}%)`, ja: `買取オファー（${pct}%）` }),
  notEligible: { en: "Not eligible", ja: "対象外" } satisfies Localized,
  offerNote: {
    en: "The buyback amount is an offer from SlabAR and does not guarantee a buyback or any price. No real payment is made on devnet.",
    ja: "買取額はSlabARが提示するオファーであり、買取や価格を保証するものではありません。devnetでは実際の支払いは発生しません。",
  } satisfies Localized,
  offerNotePlaceholder: { en: " Prices are demo placeholders.", ja: " 価格はデモ用の仮の値です" } satisfies Localized,
};

export const vault = {
  eyebrow: { en: "FROM THE SLABAR VAULT", ja: "FROM THE SLABAR VAULT" } satisfies Localized,
  heading: { en: "Available from SlabAR", ja: "SlabARから取得できる作品" } satisfies Localized,
  note: {
    en: "Demo on Solana devnet: no payment is taken and prices are placeholders. The original stays in the SlabAR vault.",
    ja: "Solana devnetでのデモです。支払いは発生せず、価格は仮の値です。現物はSlabARのVaultに保管されたままです。",
  } satisfies Localized,
  loading: { en: "Loading…", ja: "読み込み中…" } satisfies Localized,
  failed: { en: "Couldn't load available works right now.", ja: "いま取得できる作品を読み込めません。" } satisfies Localized,
  empty: { en: "Nothing is available right now.", ja: "いま取得できる作品はありません。" } satisfies Localized,
  noImage: { en: "No image", ja: "画像なし" } satisfies Localized,
  custody: assetCardUi.custody,
  priceNote: { en: "Display only · placeholder price", ja: "表示のみ・仮の価格" } satisfies Localized,
  acquire: { en: "Acquire", ja: "取得する" } satisfies Localized,
  connectToAcquire: { en: "Connect Phantom to acquire", ja: "Phantomに接続して取得" } satisfies Localized,
  showProvenance: { en: "Show provenance", ja: "来歴を見る" } satisfies Localized,
  hideProvenance: { en: "Hide provenance", ja: "来歴を閉じる" } satisfies Localized,
  dialogEyebrow: { en: "DEVNET · ACQUIRE", ja: "DEVNET · 取得" } satisfies Localized,
  dialogPrice: (price: string): Localized => ({
    en: `Displayed price ${price} (SlabAR display value, placeholder)`,
    ja: `表示価格 ${price}（SlabARの表示値・仮の値）`,
  }),
  confirmItems: [
    { en: "This is an acquisition on devnet. No payment is taken.", ja: "devnet上の取得であり、支払いは発生しません。" },
    { en: "The price is display-only (a placeholder).", ja: "価格は表示のみです（仮の値）。" },
    { en: "The original stays in the SlabAR vault.", ja: "現物はSlabARのVaultに保管されたままです。" },
  ] satisfies Localized[],
  processing: { en: "Processing…", ja: "処理中…" } satisfies Localized,
  cancel: { en: "Cancel", ja: "キャンセル" } satisfies Localized,
  notAcquired: { en: "Couldn't acquire this work.", ja: "取得できませんでした。" } satisfies Localized,
  networkError: {
    en: "Couldn't start the acquisition. Check your network connection.",
    ja: "取得を開始できませんでした。ネットワークを確認してください。",
  } satisfies Localized,
  sending: { en: "Sending…", ja: "送信中…" } satisfies Localized,
  waiting: { en: "Sent · waiting for confirmation on devnet…", ja: "送信済み・devnetで確定待ち…" } satisfies Localized,
  confirmed: { en: "Confirmed.", ja: "確定しました（confirmed）。" } satisfies Localized,
  explorer: { en: "View on Explorer (devnet)", ja: "Explorerで確認（devnet）" } satisfies Localized,
  viewCollection: { en: "View in My collection", ja: "My collectionで見る" } satisfies Localized,
  close: detail.close,
};
