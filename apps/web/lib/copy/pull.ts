// UI copy for /pull and the card display (Collectibles AR). English first, Japanese second.
// Wording rules (AGENTS.md section 3): odds / EV / stock / buyback rate are Collector Crypt's published values,
// shown as received; no promise-of-outcome wording (see AGENTS.md section 3); buyback is performed by Collector Crypt.
import type { Localized } from "../i18n";

export const cardUi = {
  claimNote: {
    en: "Grade, insured value and vault are claims by the grading company and Collector Crypt. Collectibles AR has not verified them.",
  },
  grade: { en: "Grade" },
  gradingId: { en: "Grading ID" },
  insured: { en: "Insured value" },
  insuredNote: { en: "Collector Crypt's figure" },
  vault: { en: "Vault (Collector Crypt's record)" },
  vaultId: { en: "Vault ID (Collector Crypt's record)" },
  mint: { en: "Mint" },
  memo: { en: "Pull memo" },
  verify: { en: "Verify the draw (VRF, Collector Crypt)" },
  noImage: { en: "Image not available" },
  owner: { en: "Owner" },
  openPassport: { en: "Open Passport" },
  // Passport: three sections that are never mixed (docs/mvp.md section 6).
  factTitle: { en: "Onchain fact" },
  factNote: {
    en: "Read from the Solana chain: mint, owner and the transfer signature.",
  },
  claimsTitle: { en: "Third-party claims" },
  claimsNote: {
    en: "Written by PSA and Collector Crypt. Collectibles AR has not verified them, and the chain does not prove them.",
  },
  interpTitle: { en: "Collectibles AR interpretation" },
  interpNote: {
    en: "Display formatting only. The image is loaded from the NFT metadata at runtime. This is not a guarantee of authenticity, condition or value.",
  },
  transferSig: { en: "Transfer signature" },
  transferPending: {
    en: "Pull transaction (reported by Collector Crypt, not confirmed on chain yet)",
  },
  psaCert: { en: "Check the cert on PSA" },
  explorer: { en: "Solana Explorer" },
  sourceMatched: {
    en: "Matches a Collector Crypt collection set in Collectibles AR (by its collection address)",
  },
  sourceFromPull: {
    en: "Came out of the Collector Crypt openPack call made here",
  },
  fetchedAt: { en: "Fetched" },
  unverifiedBadge: { en: "UNVERIFIED SOURCE" },
  unverifiedNote: {
    en: "Not confirmed as issued by Collector Crypt. It is shown because its metadata looks like a graded card, and it is kept out of the AR list.",
  },
} satisfies Record<string, Localized>;

// Card Passport page (/passport/<card id>): three sections plus a one-line pointer to Collector Crypt for buyback.
export const cardPassportUi = {
  eyebrow: { en: "CARD PASSPORT" },
  buybackLine: {
    en: "Buyback is performed by Collector Crypt, within 72 hours; the rate is set per machine.",
  },
  gachaSiteLink: { en: "Open the Collector Crypt gacha site" },
  signInToView: {
    en: "This card is read from your wallet. Sign in with Phantom in My Collection, then open this page again.",
  },
  openCollection: { en: "Open My Collection" },
} satisfies Record<string, Localized>;

export const pullUi = {
  eyebrow: { en: "PULL" },
  title: { en: "Pull a pack" },
  lead: {
    en: "The machines are Collector Crypt's, hosted here. You sign one USDC payment in Phantom (devnet); the card that comes out is yours to see in My Collection.",
  },
  network: { en: "Devnet test funds only. Nothing here is a sale or a purchase of real cards." },
  demoOn: { en: "Showing DEMO DATA (no network, nothing to sign)." },
  demoTry: { en: "Try with DEMO DATA" },
  demoOff: { en: "Leave DEMO DATA" },
  machine: { en: "Machine" },
  price: { en: "Price" },
  priceUnit: { en: "USDC" },
  odds: { en: "Odds" },
  ev: { en: "EV" },
  stock: { en: "Stock" },
  buyback: { en: "Collector Crypt instant buyback" },
  tier: {
    common: { en: "common" },
    uncommon: { en: "uncommon" },
    rare: { en: "rare" },
    epic: { en: "epic" },
  },
  published: {
    en: "Collector Crypt's published value. Collectibles AR does not guarantee these figures.",
  },
  demoValue: { en: "DEMO DATA value (made up)" },
  fetchedAt: { en: "Fetched" },
  buybackNote: {
    en: "Buyback is performed by Collector Crypt, within 72 hours; the rate is set per machine. Collectibles AR does not guarantee these figures.",
  },
  soon: { en: "Opening soon" },
  soonNote: { en: "Pulls are not open yet. You can look at the machines and their odds, or try the flow with DEMO DATA." },
  machinesLoading: { en: "Loading machines…" },
  machinesFailed: { en: "Could not load the machines. Please try again in a moment." },
  connect: { en: "Connect Phantom to pull" },
  connecting: { en: "Connecting…" },
  openInPhantom: { en: "Open in Phantom to pull" },
  noPhantomNote: { en: "Phantom was not found in this browser. On a phone, open this page inside the Phantom app; on a computer, install the Phantom extension." },
  pull: { en: "Pull" },
  pullDemo: { en: "Pull (DEMO DATA)" },
  busy: { en: "Pull in progress…" },
  statusLabel: { en: "Status" },
  confirmingNote: {
    en: "The card was received, but its Pull transaction is not confirmed on chain yet. Checking again…",
  },
  orphanTitle: { en: "Unconfirmed memos" },
  orphanNote: {
    en: "Pulls you left, by starting a new pull, before they were confirmed. If you signed, the payment may have gone through; keep the memo and contact Collector Crypt with it.",
  },
  orphanDismiss: { en: "Remove from this list" },
  confirmNewPull: {
    en: "This pull has not finished and you may already have signed. Starting a new pull will drop it from this screen (the memo is kept in the list below). Continue?",
  },
  status: {
    pending: { en: "pending" },
    confirmed: { en: "confirmed" },
    failed: { en: "failed" },
  },
  stage: {
    creating: { en: "Creating the pack…" },
    signing: { en: "Sign the USDC payment in Phantom" },
    submitting: { en: "Sending the signed transaction…" },
    opening: { en: "Waiting for Collector Crypt to open the pack…" },
    openingPaused: {
      en: "The payment could not be confirmed. Check again, or start a new pull.",
    },
    openingBusy: { en: "Collector Crypt is busy. Retrying with the same memo…" },
    resumed: { en: "Resumed an unfinished pull with its saved memo." },
    resuming: { en: "Checking the saved memo before resuming…" },
  },
  attempts: { en: "check" },
  checkAgain: { en: "Check again (same memo)" },
  newPull: { en: "Start a new pull" },
  errors: {
    busy_pending: { en: "Too many unopened packs are pending. Open or wait for them, then try again." },
    busy_opening: { en: "Collector Crypt is opening too many packs right now. Please try again shortly." },
    machine_off_balance: { en: "This machine is temporarily unavailable. Try another machine." },
    rate_limited: { en: "Too many attempts. Please try again later." },
    signCancelled: { en: "Signing was cancelled. No payment was made." },
    walletMismatch: { en: "The account selected in Phantom differs from the signed-in wallet. Please switch accounts." },
    noPhantom: { en: "Phantom was not found." },
    expired: { en: "This pack has expired (packs must be opened within 2 hours). Contact Collector Crypt with the memo if you paid." },
    submitFailed: { en: "The send could not be confirmed, so this app cannot say whether the payment went through. It is being checked. Check again with the same memo before pulling anew." },
    unauthenticated: { en: "Please sign in with Phantom again." },
    memoNotOwned: { en: "This memo does not belong to the signed-in wallet." },
    invalidTransaction: { en: "Phantom returned a transaction this app could not accept. No payment was sent." },
    previousUnpaid: {
      en: "The previous pull failed before payment. No payment was made. You can pull again.",
    },
    refunded: {
      en: "The previous pull was refunded (Collector Crypt's record). Nothing is pending. You can pull again.",
    },
    unconfirmedPayment: {
      en: "Payment not confirmed yet. If you signed, check again with the same memo. You can also pull again (this memo stays in the list below).",
    },
    generic: { en: "Something went wrong." },
  },
  expiredUnpaid: {
    en: "The transaction expired (about 1 minute) before it was sent. No payment was made. Create a new pull.",
  },
  recreate: { en: "Create a new pull" },
  detailsLabel: { en: "Details" },
  detailsHttp: { en: "HTTP" },
  detailsCode: {
    wallet_not_signer: {
      en: "The wallet that signed differs from the connected wallet.",
    },
    invalid_transaction: {
      en: "The signed transaction could not be read. Nothing was sent.",
    },
    memo_not_owned: {
      en: "This memo does not belong to the connected wallet.",
    },
    rate_limited: {
      en: "Too many requests from this wallet.",
    },
    tx_expired: {
      en: "The transaction expired before it was sent.",
    },
    signature_too_slow: {
      en: "Signing took too long, so the transaction was not sent.",
    },
    network: {
      en: "This app could not reach its own server.",
    },
    unpaid_window_closed: {
      en: "No payment was seen within 2 hours of creating this pack, so it is treated as failed.",
    },
  },
  resultTitle: { en: "Result" },
  collectionLink: { en: "Open My Collection" },
  replayOpening: { en: "Play the opening again" },
  revealElsewhereNote: { en: "If the camera does not start here (the Phantom app's browser cannot use it), play the same opening in Safari." },
  revealInSafari: { en: "Open the reveal in Safari" },
  revealCopy: { en: "Copy the link" },
  revealCopied: { en: "Link copied" },
  revealTitle: { en: "Your card, in your room" },
  revealLead: { en: "This replays the opening of a card pulled on devnet. Display only: nothing is signed or sent from this page. The card itself stays in Collector Crypt's vault." },
  revealLoading: { en: "Looking up the card…" },
  revealNotFound: { en: "This card was not found among the Pulls made through this app. Open the link from the Pull result again." },
  revealStart: { en: "Open it with the camera" },
  rarity: { en: "Rarity" },
  tx: { en: "Pull transaction" },
  demoResultNote: { en: "DEMO DATA: a self-made placeholder card, not a real transaction." },
} as const;

// /pull/lab: a prototype of the opening effect. Effect strength only; no rarity names, no outcome wording.
export const cameraRevealUi = {
  cutHint: { en: "Swipe along the line to open" },
  cutLabel: { en: "Open the pack" },
  noOrientation: { en: "Motion sensors are unavailable, so the view drifts on its own." },
  noWebgl: { en: "3D is unavailable on this device." },
  noCamera: { en: "The camera is unavailable, so this is shown without a background." },
  again: { en: "Again" },
  close: { en: "Close" },
  closeLabel: { en: "Close the camera view" },
} as const;

export const labUi = {
  title: { en: "Opening effect lab" },
  note: { en: "A prototype of the effect. No real Pull is made." },
  lead: {
    en: "Pick an effect strength, then try it with your camera. Swipe across the pack's cut line to open it and watch the light and storm fill the camera view.",
  },
  tierLabel: { en: "Effect strength" },
  tierName: { en: "Effect" },
  start: { en: "Try the opening with the camera" },
  modeLabel: { en: "Rendering" },
  mode3d: { en: "3D (spatial)" },
  mode2d: { en: "2D" },
  dummyTitle: { en: "Sample Card" },
} as const;

// /pull/lab/card: a prototype of the card's look (light reacting to tilt). Foil strength only; no rarity names.
export const holoUi = {
  title: { en: "Card look lab" },
  note: { en: "A prototype of the card's look. No real Pull is made." },
  lead: {
    en: "Tilt your phone or drag the card to see the light move over it. Pick a foil strength and compare.",
  },
  spinHint: { en: "Drag sideways to turn, tap to flip" },
  foilLabel: { en: "Foil strength" },
  foilName: { en: "Foil" },
  start: { en: "View with the camera" },
  imgNote: {
    en: "The image is loaded at run time from the URL given. This is not the result of a real pull.",
  },
  noCamera: { en: "The camera is unavailable, so this is shown without a background." },
  closeLabel: { en: "Close" },
  dummyTitle: { en: "Sample Card" },
} as const;

// /pull/lab/open: the pack-and-lightning opening experiment. Effect strength only; no rarity names, no outcome wording.
export const packUi = {
  title: { en: "Opening lab: capsule" },
  lead: {
    en: "Pick an effect strength, then try it. A capsule rolls in from the right, rocks twice, pops open and lights up, and the card comes out of it. The card waits face down while its year, grade and rarity appear beneath it one by one, then it turns over. When the card is up, the interface can be hidden to take a screenshot of the room.",
  },
  preparing: { en: "Getting your pull ready…" },
  factYear: { en: "YEAR" },
  factSeries: { en: "SERIES" },
  factGrade: { en: "GRADE" },
  factRarity: { en: "RARITY" },
  hideUi: { en: "Hide the interface" },
  tierHint: [
    { en: "blue" },
    { en: "green" },
    { en: "red" },
    { en: "rainbow" },
  ],
  keep: { en: "Keep in collection" },
  sell: { en: "Sell back to Collector Crypt" },
  processing: { en: "Processing…" },
  kept: { en: "Added to your collection." },
  sold: { en: "Sold back. The card has left the room." },
  sellNote: { en: "Selling back is a display prototype; no real transaction is made." },
  demoAmount: { en: "$0.00 (DEMO DATA)" },
} as const;
