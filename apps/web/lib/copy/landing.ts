import type { PhysicalDescriptor, ProvenanceEvent } from "../contract";
import type { Localized } from "../i18n";

/**
 * UI copy for the landing page (/) (`home`) and for the shared components kept from the earlier landing
 * (AssetCard, PhysicalDetails, ProvenanceList, OnchainFeature, VaultAcquisitionSection; none is shown on / any more). Strings that come from
 * asset data (titles are localized via titleLocalized; condition, rights and notes are not) are not here.
 */

export const home = {
  eyebrow: { en: "GRADED CARDS × SOLANA × AR" } satisfies Localized,
  title: { en: "Pull a pack. It appears in your room." } satisfies Localized,
  lead: {
    en: "Real graded cards on Solana. Gacha runs on Collector Crypt's machines; the card you pull shows up life-size in AR on your iPhone. The card stays in the vault.",
  } satisfies Localized,
  ctaPull: { en: "Pull a pack (devnet)" } satisfies Localized,
  ctaCollection: { en: "See my collection" } satisfies Localized,
  artCaption: {
    en: "Self-made dummy cards for illustration. Not real cards.",
  } satisfies Localized,

  stepsEyebrow: { en: "HOW IT WORKS" } satisfies Localized,
  stepsTitle: { en: "Three steps" } satisfies Localized,
  steps: [
    {
      name: { en: "Pull" },
      body: {
        en: "Pay once in USDC and sign in Phantom.",
      },
    },
    {
      name: { en: "Appear" },
      body: {
        en: "The card shows up in AR on your linked iPhone, life-size in its graded holder, within seconds.",
      },
    },
    {
      name: { en: "Keep, sell back or ship" },
      body: {
        en: "Collector Crypt buys it back within 72 hours at a rate set per machine. Shipping is also done by Collector Crypt.",
      },
    },
  ],

  whyEyebrow: { en: "WHY SOLANA" } satisfies Localized,
  whyTitle: { en: "Why Solana" } satisfies Localized,
  whyMove: {
    title: { en: "Ownership moves without shipping" },
    body: {
      en: "The card lands in your wallet the moment you pull it. Sell it back and it disappears from your room.",
    },
  },
  whyVerify: {
    title: { en: "Odds and pool can be verified (VRF)" },
    // The bare /verify-selection path returns 404; the page needs a draw memo. The link goes to the gacha site.
    pre: { en: "Each draw has a memo, and Collector Crypt's " },
    linkText: { en: "/verify-selection page" },
    post: { en: " shows how it was drawn." },
  },
  whyFees: {
    title: { en: "Fees are small" },
    body: {
      en: "Network fees are small enough that a $25 card still makes sense.",
    },
  },

  diffEyebrow: { en: "COMPARED" } satisfies Localized,
  diffTitle: { en: "How this differs from other onchain gacha" } satisfies Localized,
  diffBody: {
    en: "Jupiter Gacha, Solflare Packs and Rarible Gacha Station are front ends that sit on top of Collector Crypt's inventory. After the pull, the flow ends at a list. Collectibles AR puts what you pulled into your room.",
  } satisfies Localized,
  diffColOthers: { en: "Other front ends" } satisfies Localized,
  diffColUs: { en: "Collectibles AR" } satisfies Localized,
  diffRows: [
    { label: { en: "Pull a pack" }, others: true },
    { label: { en: "View it in AR" }, others: false },
    { label: { en: "Place it in your room" }, others: false },
    { label: { en: "Capture and share" }, others: false },
  ] satisfies { label: Localized; others: boolean }[],
  diffYes: { en: "Yes" } satisfies Localized,
  diffNo: { en: "Not offered" } satisfies Localized,
  diffNote: {
    en: "AR steps only, based on public information as of October 2026. Their features may change.",
  } satisfies Localized,

  noticeEyebrow: { en: "NOTICE" } satisfies Localized,
  noticeTitle: { en: "Before you try it" } satisfies Localized,
  notices: [
    {
      en: "This is DEVNET. Test funds, test cards, no real shipment.",
    },
    {
      en: "Odds, expected value, buyback rates and insured values are published by Collector Crypt and PSA. Collectibles AR does not vouch for them.",
    },
    {
      en: "Buyback, shipping and refunds are the responsibility of Collector Crypt, not Collectibles AR.",
    },
  ] satisfies Localized[],
  realPacksPre: { en: "Real packs can be pulled at " } satisfies Localized,
  realPacksPost: { en: "." } satisfies Localized,
};

/** Onchain piece block and cards inside "Live on Solana" (landing only). */
export const devnetFeature = {
  label: { en: "ONCHAIN PIECE" } satisfies Localized,
  owner: { en: "Owner" } satisfies Localized,
  // Custody is an off-chain record, unlike Owner and Asset (onchain facts); the label says so.
  custody: { en: "Custody (off-chain record)" } satisfies Localized,
  asset: { en: "Asset" } satisfies Localized,
  noImage: { en: "No image" } satisfies Localized,
  previous: { en: "Previous piece" } satisfies Localized,
  next: { en: "Next piece" } satisfies Localized,
  rehearsalTitle: {
    en: "Rehearsal token for the redeem dry run. Not a Reference Asset.",
  } satisfies Localized,
};

export const detail = {
  close: { en: "Close" } satisfies Localized,
  viewInAr: { en: "View in AR (demo)" } satisfies Localized,
  toast: { en: "Sent to your AR room (demo)" } satisfies Localized,
  owner: { en: "owner" } satisfies Localized,
  unowned: { en: "unowned" } satisfies Localized,
  display: { en: "Display" } satisfies Localized,
  physical: { en: "PHYSICAL" } satisfies Localized,
  provenance: { en: "PROVENANCE" } satisfies Localized,
  physicalId: { en: "Physical ID" } satisfies Localized,
  condition: { en: "Condition" } satisfies Localized,
  custody: { en: "Custody" } satisfies Localized,
  lastVerified: { en: "Last verified" } satisfies Localized,
};

export const custodyText: Record<PhysicalDescriptor["custody"]["status"], Localized> = {
  vaulted: { en: "Vaulted" },
  released: { en: "Released" },
  exception: { en: "Exception" },
  pending_intake: { en: "Not in the vault yet (self-custody)" },
};

export const sourceText: Record<ProvenanceEvent["source"], Localized> = {
  onchain: { en: "On-chain" },
  offchain_evidence: { en: "Off-chain evidence" },
  twinfold_interpretation: { en: "Collectibles AR interpretation" },
};

const kindText: Record<ProvenanceEvent["kind"], Localized> = {
  minted: { en: "Minted" },
  transferred: { en: "Transferred" },
  rwa_verified: { en: "RWA Verified" },
  vaulted: { en: "Vaulted" },
  redeemed: { en: "Redeemed" },
};

const redeemStepText: Record<string, Localized> = {
  requested: { en: "Redeem · requested" },
  locked: { en: "Redeem · locked" },
  shipped: { en: "Redeem · shipped (dry run)" },
  received: { en: "Redeem · received (dry run)" },
  retired: { en: "Redeemed · retired (burn)" },
  exception: { en: "Redeem · exception" },
};

/** Title for a provenance event; redeem steps (kind `redeemed` with metadata.redeemStep) are named by their step. */
export function provenanceTitleText(event: ProvenanceEvent): Localized {
  const step = typeof event.metadata?.redeemStep === "string" ? event.metadata.redeemStep : undefined;
  if (step && redeemStepText[step]) return redeemStepText[step];
  return kindText[event.kind];
}

export const provenanceUi = {
  dryRun: { en: "DRY RUN · no real shipment" } satisfies Localized,
  showAll: (n: number): Localized => ({ en: `Show all ${n} events` }),
  showLess: { en: "Show less" } satisfies Localized,
  evidence: { en: "evidence" } satisfies Localized,
};

export const physicalUi = {
  summary: { en: "PHYSICAL · Records of the physical item (with sources)" } satisfies Localized,
  physicalId: detail.physicalId,
  assetAddress: { en: "Asset address" } satisfies Localized,
  condition: detail.condition,
  notAppraisal: { en: "not an appraisal" } satisfies Localized,
  rights: { en: "Rights" } satisfies Localized,
  custody: detail.custody,
  lastVerified: detail.lastVerified,
};

export const assetCardUi = {
  unowned: detail.unowned,
  demo: { en: "Demo" } satisfies Localized,
  custody: { en: "CUSTODY" } satisfies Localized,
  provenance: detail.provenance,
  rehearsalTitle: {
    en: "Rehearsal token for the redeem dry run. Not a Reference Asset.",
  } satisfies Localized,
  offerHeading: { en: "TWINFOLD (LEGACY DEMO) PRICE / BUYBACK OFFER" } satisfies Localized,
  price: { en: "Twinfold price" } satisfies Localized,
  buyback: (pct: number): Localized => ({ en: `Buyback offer (${pct}%)` }),
  notEligible: { en: "Not eligible" } satisfies Localized,
  offerNote: {
    en: "The buyback amount is an offer from Twinfold and does not promise a buyback or any price. No real payment is made on devnet.",
  } satisfies Localized,
  offerNotePlaceholder: { en: " Prices are demo placeholders." } satisfies Localized,
};

export const vault = {
  eyebrow: { en: "FROM THE TWINFOLD VAULT (LEGACY DEMO)" } satisfies Localized,
  heading: { en: "Available from Twinfold" } satisfies Localized,
  note: {
    en: "Demo on Solana devnet: no payment is taken and prices are placeholders. The original stays in the Twinfold vault.",
  } satisfies Localized,
  loading: { en: "Loading…" } satisfies Localized,
  failed: { en: "Couldn't load available works right now." } satisfies Localized,
  empty: { en: "Nothing is available right now." } satisfies Localized,
  noImage: { en: "No image" } satisfies Localized,
  custody: assetCardUi.custody,
  priceNote: { en: "Display only · placeholder price" } satisfies Localized,
  acquire: { en: "Acquire" } satisfies Localized,
  connectToAcquire: { en: "Connect Phantom to acquire" } satisfies Localized,
  showProvenance: { en: "Show provenance" } satisfies Localized,
  hideProvenance: { en: "Hide provenance" } satisfies Localized,
  dialogEyebrow: { en: "DEVNET · ACQUIRE" } satisfies Localized,
  dialogPrice: (price: string): Localized => ({
    en: `Displayed price ${price} (Twinfold display value, placeholder)`,
  }),
  confirmItems: [
    { en: "This is an acquisition on devnet. No payment is taken." },
    { en: "The price is display-only (a placeholder)." },
    { en: "The original stays in the Twinfold vault." },
  ] satisfies Localized[],
  processing: { en: "Processing…" } satisfies Localized,
  cancel: { en: "Cancel" } satisfies Localized,
  notAcquired: { en: "Couldn't acquire this work." } satisfies Localized,
  networkError: {
    en: "Couldn't start the acquisition. Check your network connection.",
  } satisfies Localized,
  sending: { en: "Sending…" } satisfies Localized,
  waiting: { en: "Sent · waiting for confirmation on devnet…" } satisfies Localized,
  confirmed: { en: "Confirmed." } satisfies Localized,
  explorer: { en: "View on Explorer (devnet)" } satisfies Localized,
  viewCollection: { en: "View in My collection" } satisfies Localized,
  close: detail.close,
};
