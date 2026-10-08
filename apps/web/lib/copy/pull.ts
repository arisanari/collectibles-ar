// UI copy for /pull and the card display (Collectibles AR). English first, Japanese second.
// Wording rules (AGENTS.md section 3): odds / EV / stock / buyback rate are Collector Crypt's published values,
// shown as received; no promise-of-outcome wording (see AGENTS.md section 3); buyback is performed by Collector Crypt.
import type { Localized } from "../i18n";

export const cardUi = {
  claimNote: {
    en: "Grade, insured value and vault are claims by the grading company and Collector Crypt. Collectibles AR has not verified them.",
    ja: "グレード・保険価値・Vaultは鑑定会社とCollector Cryptの記載です。Collectibles ARは検証していません。",
  },
  grade: { en: "Grade", ja: "グレード" },
  gradingId: { en: "Grading ID", ja: "鑑定番号" },
  insured: { en: "Insured value", ja: "保険価値" },
  insuredNote: { en: "Collector Crypt's figure", ja: "Collector Cryptの記載値" },
  vault: { en: "Vault (Collector Crypt's record)", ja: "Vault（Collector Cryptの記録）" },
  vaultId: { en: "Vault ID (Collector Crypt's record)", ja: "Vault ID（Collector Cryptの記録）" },
  mint: { en: "Mint", ja: "Mint" },
  memo: { en: "Pull memo", ja: "Pull memo" },
  verify: { en: "Verify the draw (VRF, Collector Crypt)", ja: "抽選の検証（VRF・Collector Crypt）" },
  noImage: { en: "Image not available", ja: "画像を取得できません" },
  owner: { en: "Owner", ja: "所有者" },
  openPassport: { en: "Open Passport", ja: "Open Passport" },
  // Passport: three sections that are never mixed (docs/mvp.md section 6).
  factTitle: { en: "Onchain fact", ja: "Onchain fact（オンチェーンの事実）" },
  factNote: {
    en: "Read from the Solana chain: mint, owner and the transfer signature.",
    ja: "Solanaのチェーンから読み取った値です。mint、所有者、移転の署名。",
  },
  claimsTitle: { en: "Third-party claims", ja: "Third-party claims（第三者の主張）" },
  claimsNote: {
    en: "Written by PSA and Collector Crypt. Collectibles AR has not verified them, and the chain does not prove them.",
    ja: "PSAとCollector Cryptの記載です。Collectibles ARは検証しておらず、チェーンが証明するものでもありません。",
  },
  interpTitle: { en: "Collectibles AR interpretation", ja: "Collectibles AR interpretation（Collectibles ARの解釈）" },
  interpNote: {
    en: "Display formatting only. The image is loaded from the NFT metadata at runtime. This is not a guarantee of authenticity, condition or value.",
    ja: "表示用の整形だけです。画像はNFTメタデータから実行時に読み込みます。真正性・状態・価値を保証するものではありません。",
  },
  transferSig: { en: "Transfer signature", ja: "移転の署名" },
  transferPending: {
    en: "Pull transaction (reported by Collector Crypt, not confirmed on chain yet)",
    ja: "Pull取引（Collector Cryptの報告。チェーン上ではまだ確認できていません）",
  },
  psaCert: { en: "Check the cert on PSA", ja: "PSAで鑑定番号を確認" },
  explorer: { en: "Solana Explorer", ja: "Solana Explorer" },
  sourceMatched: {
    en: "Matches a Collector Crypt collection set in Collectibles AR (by its collection address)",
    ja: "Collectibles ARに設定したCollector Cryptのcollectionと一致（collectionアドレスによる判定）",
  },
  sourceFromPull: {
    en: "Came out of the Collector Crypt openPack call made here",
    ja: "このアプリで行ったCollector Cryptのパック開封から出たカード",
  },
  fetchedAt: { en: "Fetched", ja: "取得日時" },
  unverifiedBadge: { en: "UNVERIFIED SOURCE", ja: "UNVERIFIED SOURCE" },
  unverifiedNote: {
    en: "Not confirmed as issued by Collector Crypt. It is shown because its metadata looks like a graded card, and it is kept out of the AR list.",
    ja: "Collector Cryptが発行したものとは確認できていません。メタデータが鑑定カードの形式のため表示しており、ARの対象からは除外しています。",
  },
} satisfies Record<string, Localized>;

// Card Passport page (/passport/<card id>): three sections plus a one-line pointer to Collector Crypt for buyback.
export const cardPassportUi = {
  eyebrow: { en: "CARD PASSPORT", ja: "CARD PASSPORT" },
  buybackLine: {
    en: "Buyback is performed by Collector Crypt, within 72 hours; the rate is set per machine.",
    ja: "買取はCollector Cryptが行います。72時間以内、率は台ごとに異なります。",
  },
  gachaSiteLink: { en: "Open the Collector Crypt gacha site", ja: "Collector Cryptのガチャサイトを開く" },
  signInToView: {
    en: "This card is read from your wallet. Sign in with Phantom in My Collection, then open this page again.",
    ja: "このカードはウォレットから読み取ります。My CollectionでPhantomにサインインしてから、このページをもう一度開いてください。",
  },
  openCollection: { en: "Open My Collection", ja: "My Collectionを開く" },
} satisfies Record<string, Localized>;

export const pullUi = {
  eyebrow: { en: "PULL", ja: "PULL" },
  title: { en: "Pull a pack", ja: "パックを引く" },
  lead: {
    en: "The machines are Collector Crypt's, hosted here. You sign one USDC payment in Phantom (devnet); the card that comes out is yours to see in My Collection.",
    ja: "台はCollector Cryptのものを、このアプリ内でホストしています。Phantom（devnet）でUSDCの支払いに1回署名すると、出たカードをMy Collectionで見られます。",
  },
  network: { en: "Devnet test funds only. Nothing here is a sale or a purchase of real cards.", ja: "devnetのテスト資金のみです。実物カードの売買ではありません。" },
  demoOn: { en: "Showing DEMO DATA (no network, nothing to sign).", ja: "DEMO DATAの表示です（通信せず、署名もありません）。" },
  demoTry: { en: "Try with DEMO DATA", ja: "DEMO DATAで試す" },
  demoOff: { en: "Leave DEMO DATA", ja: "DEMO DATAをやめる" },
  machine: { en: "Machine", ja: "台" },
  price: { en: "Price", ja: "価格" },
  priceUnit: { en: "USDC", ja: "USDC" },
  odds: { en: "Odds", ja: "確率" },
  ev: { en: "EV", ja: "EV" },
  stock: { en: "Stock", ja: "在庫" },
  buyback: { en: "Collector Crypt instant buyback", ja: "Collector Cryptの即時買取率" },
  tier: {
    common: { en: "common", ja: "common" },
    uncommon: { en: "uncommon", ja: "uncommon" },
    rare: { en: "rare", ja: "rare" },
    epic: { en: "epic", ja: "epic" },
  },
  published: {
    en: "Collector Crypt's published value. Collectibles AR does not guarantee these figures.",
    ja: "Collector Cryptの公表値です。Collectibles ARが保証するものではありません。",
  },
  demoValue: { en: "DEMO DATA value (made up)", ja: "DEMO DATAの値（架空）" },
  fetchedAt: { en: "Fetched", ja: "取得時刻" },
  buybackNote: {
    en: "Buyback is performed by Collector Crypt, within 72 hours; the rate is set per machine. Collectibles AR does not guarantee these figures.",
    ja: "買取はCollector Cryptが行います。72時間以内、率は台ごとに異なります。Collectibles ARが保証するものではありません。",
  },
  machinesLoading: { en: "Loading machines…", ja: "台を読み込み中…" },
  machinesFailed: { en: "Could not load the machines. Please try again in a moment.", ja: "台を取得できませんでした。時間をおいて再度お試しください。" },
  connect: { en: "Connect Phantom to pull", ja: "Phantomを接続して引く" },
  connecting: { en: "Connecting…", ja: "接続中…" },
  pull: { en: "Pull", ja: "Pull" },
  pullDemo: { en: "Pull (DEMO DATA)", ja: "Pull（DEMO DATA）" },
  busy: { en: "Pull in progress…", ja: "処理中…" },
  statusLabel: { en: "Status", ja: "状態" },
  confirmingNote: {
    en: "The card was received, but its Pull transaction is not confirmed on chain yet. Checking again…",
    ja: "カードは受け取りましたが、Pull取引はまだチェーン上で確認できていません。再確認しています…",
  },
  orphanTitle: { en: "Unconfirmed memos", ja: "未確認のmemo" },
  orphanNote: {
    en: "Pulls you left, by starting a new pull, before they were confirmed. If you signed, the payment may have gone through; keep the memo and contact Collector Crypt with it.",
    ja: "確認が済む前に新しいPullを始めたため、破棄したPullです。署名済みの場合は支払いが済んでいる可能性があります。memoを控えてCollector Cryptへ問い合わせてください。",
  },
  orphanDismiss: { en: "Remove from this list", ja: "この一覧から消す" },
  confirmNewPull: {
    en: "This pull has not finished and you may already have signed. Starting a new pull will drop it from this screen (the memo is kept in the list below). Continue?",
    ja: "このPullは完了しておらず、署名済みの可能性があります。新しく始めるとこの画面からは外れます（memoは下の一覧に残ります）。続けますか？",
  },
  status: {
    pending: { en: "pending", ja: "処理中" },
    confirmed: { en: "confirmed", ja: "完了" },
    failed: { en: "failed", ja: "失敗" },
  },
  stage: {
    creating: { en: "Creating the pack…", ja: "パックを作成中…" },
    signing: { en: "Sign the USDC payment in Phantom", ja: "PhantomでUSDCの支払いに署名してください" },
    submitting: { en: "Sending the signed transaction…", ja: "署名済みの取引を送信中…" },
    opening: { en: "Waiting for Collector Crypt to open the pack…", ja: "Collector Cryptの開封を待っています…" },
    openingPaused: {
      en: "The payment could not be confirmed. Check again, or start a new pull.",
      ja: "支払いを確認できませんでした。もう一度確認するか、新しくPullしてください。",
    },
    openingBusy: { en: "Collector Crypt is busy. Retrying with the same memo…", ja: "Collector Cryptが混み合っています。同じmemoで再試行中…" },
    resumed: { en: "Resumed an unfinished pull with its saved memo.", ja: "保存したmemoで未完了のPullを再開しました。" },
    resuming: { en: "Checking the saved memo before resuming…", ja: "再開する前に、保存したmemoの状態を確認しています…" },
  },
  attempts: { en: "check", ja: "確認" },
  checkAgain: { en: "Check again (same memo)", ja: "もう一度確認（同じmemo）" },
  newPull: { en: "Start a new pull", ja: "新しくPullする" },
  errors: {
    busy_pending: { en: "Too many unopened packs are pending. Open or wait for them, then try again.", ja: "未開封のパックが多すぎます。開封または時間をおいてから再度お試しください。" },
    busy_opening: { en: "Collector Crypt is opening too many packs right now. Please try again shortly.", ja: "Collector Cryptの開封が混み合っています。少し待って再度お試しください。" },
    machine_off_balance: { en: "This machine is temporarily unavailable. Try another machine.", ja: "この台は一時的に利用できません。別の台をお試しください。" },
    rate_limited: { en: "Too many attempts. Please try again later.", ja: "試行回数が多すぎます。時間をおいて再度お試しください。" },
    signCancelled: { en: "Signing was cancelled. No payment was made.", ja: "署名をキャンセルしました。支払いは行われていません。" },
    walletMismatch: { en: "The account selected in Phantom differs from the signed-in wallet. Please switch accounts.", ja: "Phantomで選択中のアカウントがサインイン中のウォレットと異なります。切り替えてください。" },
    noPhantom: { en: "Phantom was not found.", ja: "Phantomが見つかりません。" },
    expired: { en: "This pack has expired (packs must be opened within 2 hours). Contact Collector Crypt with the memo if you paid.", ja: "このパックは期限切れです（発行から2時間以内に開封が必要）。支払い済みの場合はmemoを添えてCollector Cryptへ問い合わせてください。" },
    submitFailed: { en: "The send could not be confirmed, so this app cannot say whether the payment went through. It is being checked. Check again with the same memo before pulling anew.", ja: "送信を確認できなかったため、支払いが済んだかどうかはまだ分かりません。確認中です。新しく引く前に、同じmemoでもう一度確認してください。" },
    unauthenticated: { en: "Please sign in with Phantom again.", ja: "Phantomで再度サインインしてください。" },
    memoNotOwned: { en: "This memo does not belong to the signed-in wallet.", ja: "このmemoはサインイン中のウォレットのものではありません。" },
    invalidTransaction: { en: "Phantom returned a transaction this app could not accept. No payment was sent.", ja: "Phantomが返した取引を受け付けられませんでした。支払いは送信されていません。" },
    previousUnpaid: {
      en: "The previous pull failed before payment. No payment was made. You can pull again.",
      ja: "前回のPullは支払い前に失敗しました。支払いは発生していません。もう一度引けます。",
    },
    refunded: {
      en: "The previous pull was refunded (Collector Crypt's record). Nothing is pending. You can pull again.",
      ja: "前回のPullは返金済みです（Collector Cryptの記録）。保留中のものはありません。もう一度引けます。",
    },
    unconfirmedPayment: {
      en: "Payment not confirmed yet. If you signed, check again with the same memo. You can also pull again (this memo stays in the list below).",
      ja: "支払いはまだ確認できていません。署名済みの場合は、同じmemoでもう一度確認してください。新しくPullすることもできます（このmemoは下の一覧に残ります）。",
    },
    generic: { en: "Something went wrong.", ja: "問題が発生しました。" },
  },
  expiredUnpaid: {
    en: "The transaction expired (about 1 minute) before it was sent. No payment was made. Create a new pull.",
    ja: "取引の有効期限（約1分）が切れました。支払いは発生していません。新しいPullを作り直してください。",
  },
  recreate: { en: "Create a new pull", ja: "新しいPullを作り直す" },
  detailsLabel: { en: "Details", ja: "詳細" },
  detailsHttp: { en: "HTTP", ja: "HTTP" },
  detailsCode: {
    wallet_not_signer: {
      en: "The wallet that signed differs from the connected wallet.",
      ja: "署名した wallet が接続中の wallet と違う。",
    },
    invalid_transaction: {
      en: "The signed transaction could not be read. Nothing was sent.",
      ja: "署名済みの取引を読み取れませんでした。送信していません。",
    },
    memo_not_owned: {
      en: "This memo does not belong to the connected wallet.",
      ja: "このmemoは接続中のwalletのものではありません。",
    },
    rate_limited: {
      en: "Too many requests from this wallet.",
      ja: "このwalletからのリクエストが多すぎます。",
    },
    tx_expired: {
      en: "The transaction expired before it was sent.",
      ja: "取引が送信前に期限切れになりました。",
    },
    signature_too_slow: {
      en: "Signing took too long, so the transaction was not sent.",
      ja: "署名に時間がかかったため、送信しませんでした。",
    },
    network: {
      en: "This app could not reach its own server.",
      ja: "このアプリのサーバーに接続できませんでした。",
    },
    unpaid_window_closed: {
      en: "No payment was seen within 2 hours of creating this pack, so it is treated as failed.",
      ja: "パック作成から2時間以内に支払いを確認できなかったため、失敗として扱います。",
    },
  },
  resultTitle: { en: "Result", ja: "結果" },
  collectionLink: { en: "Open My Collection", ja: "My Collectionを開く" },
  rarity: { en: "Rarity", ja: "レアリティ" },
  tx: { en: "Pull transaction", ja: "Pull取引" },
  demoResultNote: { en: "DEMO DATA: a self-made placeholder card, not a real transaction.", ja: "DEMO DATA: 自作のプレースホルダーカードで、実際の取引ではありません。" },
} as const;

// /pull/lab: a prototype of the opening effect. Effect strength only; no rarity names, no outcome wording.
export const cameraRevealUi = {
  cutHint: { en: "Swipe along the line to open", ja: "なぞって開ける" },
  cutLabel: { en: "Open the pack", ja: "パックを開ける" },
  noOrientation: { en: "Motion sensors are unavailable, so the view drifts on its own.", ja: "傾きセンサーを使えないので、視点は自動で揺れます" },
  noWebgl: { en: "3D is unavailable on this device.", ja: "この端末では3Dを使えません" },
  noCamera: { en: "The camera is unavailable, so this is shown without a background.", ja: "カメラを使えないので背景なしで表示しています" },
  again: { en: "Again", ja: "もう一度" },
  close: { en: "Close", ja: "閉じる" },
  closeLabel: { en: "Close the camera view", ja: "カメラ表示を閉じる" },
} as const;

export const labUi = {
  title: { en: "Opening effect lab", ja: "開封演出ラボ" },
  note: { en: "A prototype of the effect. No real Pull is made.", ja: "演出の試作で、実際のPullは行いません。" },
  lead: {
    en: "Pick an effect strength, then try it with your camera. Swipe across the pack's cut line to open it and watch the light and storm fill the camera view.",
    ja: "演出の強さを選んで、カメラで試せます。パックの切り取り線を指でなぞって開けると、カメラ映像に光と嵐の演出が重なります。",
  },
  tierLabel: { en: "Effect strength", ja: "演出の強さ" },
  tierName: { en: "Effect", ja: "演出" },
  start: { en: "Try the opening with the camera", ja: "カメラで開封を試す" },
  modeLabel: { en: "Rendering", ja: "描画" },
  mode3d: { en: "3D (spatial)", ja: "3D（空間）" },
  mode2d: { en: "2D", ja: "2D" },
  dummyTitle: { en: "Sample Card", ja: "サンプルカード" },
} as const;

// /pull/lab/card: a prototype of the card's look (light reacting to tilt). Foil strength only; no rarity names.
export const holoUi = {
  title: { en: "Card look lab", ja: "カードの質感ラボ" },
  note: { en: "A prototype of the card's look. No real Pull is made.", ja: "質感の試作で、実際のPullは行いません。" },
  lead: {
    en: "Tilt your phone or drag the card to see the light move over it. Pick a foil strength and compare.",
    ja: "端末を傾けるか、カードをドラッグすると、光が動きます。箔の強さを選んで見比べられます。",
  },
  spinHint: { en: "Drag sideways to turn, tap to flip", ja: "横にドラッグで回転、タップで裏返す" },
  foilLabel: { en: "Foil strength", ja: "箔の強さ" },
  foilName: { en: "Foil", ja: "箔" },
  start: { en: "View with the camera", ja: "カメラで見る" },
  imgNote: {
    en: "The image is loaded at run time from the URL given. This is not the result of a real pull.",
    ja: "画像は指定された URL から実行時に読んでいます。実際の Pull の結果ではありません。",
  },
  noCamera: { en: "The camera is unavailable, so this is shown without a background.", ja: "カメラを使えないので背景なしで表示しています" },
  closeLabel: { en: "Close", ja: "閉じる" },
  dummyTitle: { en: "Sample Card", ja: "サンプルカード" },
} as const;

// /pull/lab/open: the pack-and-lightning opening experiment. Effect strength only; no rarity names, no outcome wording.
export const packUi = {
  title: { en: "Opening lab: lightning", ja: "開封ラボ（雷）" },
  lead: {
    en: "Pick an effect strength, then try it. The pack opens by itself and lightning comes down in the middle of the screen: point the camera at a plush toy there. The card rises from the bottom of the screen and waits face down while its year, grade and rarity appear one by one, then it turns over. When the card is up, the interface can be hidden to take a screenshot of the room.",
    ja: "演出の強さを選んで試せます。パックは自動で開き、画面の真ん中に雷が落ちます。ぬいぐるみを真ん中に映してみてください。カードは画面の下から上がり、裏向きのまま年・グレード・レア度が順に出てから表になります。カードが出たあとは、表示を隠して部屋のスクリーンショットを撮れます。",
  },
  preparing: { en: "Getting the pack ready…", ja: "パックを準備しています" },
  factYear: { en: "YEAR", ja: "年" },
  factSeries: { en: "SERIES", ja: "シリーズ" },
  factGrade: { en: "GRADE", ja: "グレード" },
  factRarity: { en: "RARITY", ja: "レア度" },
  hideUi: { en: "Hide the interface", ja: "画面の表示を隠す" },
  tierHint: [
    { en: "blue", ja: "青" },
    { en: "green", ja: "緑" },
    { en: "red", ja: "赤" },
    { en: "rainbow", ja: "虹" },
  ],
  keep: { en: "Keep in collection", ja: "コレクションに入れる" },
  sell: { en: "Sell back to Collector Crypt", ja: "Collector Cryptに売り戻す" },
  processing: { en: "Processing…", ja: "処理中…" },
  kept: { en: "Added to your collection.", ja: "コレクションに入れました" },
  sold: { en: "Sold back. The card has left the room.", ja: "売り戻しました。カードは空間から消えました。" },
  sellNote: { en: "Selling back is a display prototype; no real transaction is made.", ja: "売り戻しは表示の試作で、実際の取引は行いません" },
  demoAmount: { en: "$0.00 (DEMO DATA)", ja: "$0.00（DEMO DATA）" },
} as const;
