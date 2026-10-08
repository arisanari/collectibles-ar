import type { PhysicalDescriptor, ProvenanceEvent } from "../contract";
import type { Localized } from "../i18n";

/**
 * UI copy for the landing page (/) (`home`) and for the shared components kept from the earlier landing
 * (AssetCard, PhysicalDetails, ProvenanceList, OnchainFeature, VaultAcquisitionSection; none is shown on / any more). Strings that come from
 * asset data (titles are localized via titleLocalized; condition, rights and notes are not) are not here.
 */

export const home = {
  eyebrow: { en: "GRADED CARDS × SOLANA × AR", ja: "鑑定済みカード × SOLANA × AR" } satisfies Localized,
  title: { en: "Pull a pack. It appears in your room.", ja: "パックを引く。部屋に出る。" } satisfies Localized,
  lead: {
    en: "Real graded cards on Solana. Gacha runs on Collector Crypt's machines; the card you pull shows up life-size in AR on your iPhone. The card stays in the vault.",
    ja: "Solana上の本物の鑑定済みカード。ガチャはCollector Cryptの台で、引いたカードはiPhoneのARに実寸で出る。現物はVaultのまま。",
  } satisfies Localized,
  ctaPull: { en: "Pull a pack (devnet)", ja: "Pull a pack (devnet)" } satisfies Localized,
  ctaCollection: { en: "See my collection", ja: "See my collection" } satisfies Localized,
  artCaption: {
    en: "Self-made dummy cards for illustration. Not real cards.",
    ja: "説明用の自作ダミーカードです。実在のカードではありません。",
  } satisfies Localized,

  stepsEyebrow: { en: "HOW IT WORKS", ja: "HOW IT WORKS" } satisfies Localized,
  stepsTitle: { en: "Three steps", ja: "3ステップ" } satisfies Localized,
  steps: [
    {
      name: { en: "Pull", ja: "Pull" },
      body: {
        en: "Pay once in USDC and sign in Phantom.",
        ja: "USDCで1回支払い、Phantomで署名します。",
      },
    },
    {
      name: { en: "Appear", ja: "Appear" },
      body: {
        en: "The card shows up in AR on your linked iPhone, life-size in its graded holder, within seconds.",
        ja: "link済みのiPhoneのARに、鑑定ホルダーの実寸で、数秒で出ます。",
      },
    },
    {
      name: { en: "Keep, sell back or ship", ja: "Keep, sell back or ship" },
      body: {
        en: "Collector Crypt buys it back within 72 hours at a rate set per machine. Shipping is also done by Collector Crypt.",
        ja: "Collector Cryptが72時間以内に台ごとの率で買取します。発送もCollector Cryptが行います。",
      },
    },
  ],

  whyEyebrow: { en: "WHY SOLANA", ja: "WHY SOLANA" } satisfies Localized,
  whyTitle: { en: "Why Solana", ja: "なぜSolana" } satisfies Localized,
  whyMove: {
    title: { en: "Ownership moves without shipping", ja: "発送せずに所有が動く" },
    body: {
      en: "The card lands in your wallet the moment you pull it. Sell it back and it disappears from your room.",
      ja: "引いた瞬間にカードがwalletへ入ります。売り戻せば、部屋からも消えます。",
    },
  },
  whyVerify: {
    title: { en: "Odds and pool can be verified (VRF)", ja: "確率とpoolをVRFで検証できる" },
    // The bare /verify-selection path returns 404; the page needs a draw memo. The link goes to the gacha site.
    pre: { en: "Each draw has a memo, and Collector Crypt's ", ja: "引くたびにmemoが付き、" },
    linkText: { en: "/verify-selection page", ja: "Collector Cryptの/verify-selectionページ" },
    post: { en: " shows how it was drawn.", ja: "で抽選を確かめられます。" },
  },
  whyFees: {
    title: { en: "Fees are small", ja: "手数料が小さい" },
    body: {
      en: "Network fees are small enough that a $25 card still makes sense.",
      ja: "手数料が小さいので、$25のカードでも成り立ちます。",
    },
  },

  diffEyebrow: { en: "COMPARED", ja: "COMPARED" } satisfies Localized,
  diffTitle: { en: "How this differs from other onchain gacha", ja: "他のonchainガチャとの違い" } satisfies Localized,
  diffBody: {
    en: "Jupiter Gacha, Solflare Packs and Rarible Gacha Station are front ends that sit on top of Collector Crypt's inventory. After the pull, the flow ends at a list. Collectibles AR puts what you pulled into your room.",
    ja: "Jupiter Gacha、Solflare Packs、Rarible Gacha StationはいずれもCollector Cryptの在庫の上に乗る配布フロントで、引いた後は一覧で終わります。Collectibles ARは、引いたものを部屋に出します。",
  } satisfies Localized,
  diffColOthers: { en: "Other front ends", ja: "他の配布フロント" } satisfies Localized,
  diffColUs: { en: "Collectibles AR", ja: "Collectibles AR" } satisfies Localized,
  diffRows: [
    { label: { en: "Pull a pack", ja: "引く" }, others: true },
    { label: { en: "View it in AR", ja: "ARで見る" }, others: false },
    { label: { en: "Place it in your room", ja: "部屋に並べる" }, others: false },
    { label: { en: "Capture and share", ja: "撮って共有する" }, others: false },
  ] satisfies { label: Localized; others: boolean }[],
  diffYes: { en: "Yes", ja: "あり" } satisfies Localized,
  diffNo: { en: "Not offered", ja: "なし" } satisfies Localized,
  diffNote: {
    en: "AR steps only, based on public information as of October 2026. Their features may change.",
    ja: "ARの工程だけの比較です。2026年10月時点の公開情報にもとづきます。各社の機能は変わる場合があります。",
  } satisfies Localized,

  noticeEyebrow: { en: "NOTICE", ja: "NOTICE" } satisfies Localized,
  noticeTitle: { en: "Before you try it", ja: "ご利用前に" } satisfies Localized,
  notices: [
    {
      en: "This is DEVNET. Test funds, test cards, no real shipment.",
      ja: "DEVNETです。テスト用の資金・カードで、実際の発送はありません。",
    },
    {
      en: "Odds, expected value, buyback rates and insured values are published by Collector Crypt and PSA. Collectibles AR does not vouch for them.",
      ja: "確率・期待値・買取率・保険価値はCollector CryptとPSAの公表値です。Collectibles ARはそれらの裏づけを行いません。",
    },
    {
      en: "Buyback, shipping and refunds are the responsibility of Collector Crypt, not Collectibles AR.",
      ja: "買取・発送・返金の責任主体はCollector Cryptです。Collectibles ARではありません。",
    },
  ] satisfies Localized[],
  realPacksPre: { en: "Real packs can be pulled at ", ja: "本物のパックは " } satisfies Localized,
  realPacksPost: { en: ".", ja: " で引けます。" } satisfies Localized,
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
  twinfold_interpretation: { en: "Collectibles AR interpretation", ja: "Collectibles ARの解釈" },
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
  offerHeading: { en: "TWINFOLD (LEGACY DEMO) PRICE / BUYBACK OFFER", ja: "TWINFOLD（旧デモ）価格 / 買取オファー" } satisfies Localized,
  price: { en: "Twinfold price", ja: "Twinfold価格" } satisfies Localized,
  buyback: (pct: number): Localized => ({ en: `Buyback offer (${pct}%)`, ja: `買取オファー（${pct}%）` }),
  notEligible: { en: "Not eligible", ja: "対象外" } satisfies Localized,
  offerNote: {
    en: "The buyback amount is an offer from Twinfold and does not promise a buyback or any price. No real payment is made on devnet.",
    ja: "買取額はTwinfoldのオファーであり、買取や価格を約束するものではありません。devnetでは実際の支払いは発生しません。",
  } satisfies Localized,
  offerNotePlaceholder: { en: " Prices are demo placeholders.", ja: " 価格はデモ用の仮の値です" } satisfies Localized,
};

export const vault = {
  eyebrow: { en: "FROM THE TWINFOLD VAULT (LEGACY DEMO)", ja: "FROM THE TWINFOLD VAULT（旧デモ）" } satisfies Localized,
  heading: { en: "Available from Twinfold", ja: "Twinfoldから取得できる作品" } satisfies Localized,
  note: {
    en: "Demo on Solana devnet: no payment is taken and prices are placeholders. The original stays in the Twinfold vault.",
    ja: "Solana devnetでのデモです。支払いは発生せず、価格は仮の値です。現物はTwinfoldのVaultに保管されたままです。",
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
    en: `Displayed price ${price} (Twinfold display value, placeholder)`,
    ja: `表示価格 ${price}（Twinfoldの表示値・仮の値）`,
  }),
  confirmItems: [
    { en: "This is an acquisition on devnet. No payment is taken.", ja: "devnet上の取得であり、支払いは発生しません。" },
    { en: "The price is display-only (a placeholder).", ja: "価格は表示のみです（仮の値）。" },
    { en: "The original stays in the Twinfold vault.", ja: "現物はTwinfoldのVaultに保管されたままです。" },
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
