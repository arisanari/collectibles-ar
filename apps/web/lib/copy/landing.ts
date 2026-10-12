import type { PhysicalDescriptor, ProvenanceEvent } from "../contract";
import type { Localized } from "../i18n";

/**
 * UI copy for the landing page (/) (`home`) and for the shared components kept from the earlier landing
 * (AssetCard, PhysicalDetails, ProvenanceList, OnchainFeature, VaultAcquisitionSection; none is shown on / any more). Strings that come from
 * asset data (titles are localized via titleLocalized; condition, rights and notes are not) are not here.
 */

export const home = {
  heroEyebrow: { en: "Real graded cards on Solana, in AR" } satisfies Localized,
  heroTitle1: { en: "Your collectibles." } satisfies Localized,
  heroTitle2: { en: "Summon in AR." } satisfies Localized,
  heroLead: {
    en: "Connect your wallet. Your collectibles show up in AR, wherever you are.",
  } satisfies Localized,
  ctaPull: { en: "Pull a pack" } satisfies Localized,
  pullSoon: { en: "Opening soon" } satisfies Localized,
  iosSoon: { en: "Beta test" } satisfies Localized,
  ctaIos: { en: "Get the iOS app" } satisfies Localized,
  heroFine: { en: "Both are in testing. Packs use devnet test funds, and the iPhone app is an invite-only beta." } satisfies Localized,
  linkedWith: { en: "Linked with Phantom" } satisfies Localized,
  dragHint: { en: "Drag to spin" } satisfies Localized,
  videoLabel: { en: "Screen recording of the iPhone app placing a graded card on a desk in AR" } satisfies Localized,
  videoCaption: {
    en: "Recorded on an iPhone. A real card from a linked mainnet wallet, shown read-only. The card stays in Collector Crypt's vault.",
  } satisfies Localized,
  roomLabel: { en: "In your room" } satisfies Localized,
  heroTags: [{ en: "Yours, onchain" }, { en: "Stays in the vault" }, { en: "Life-size on iPhone" }] satisfies Localized[],
  artCaption: { en: "Self-made dummy cards for illustration. Not real cards." } satisfies Localized,
  scrollHint: { en: "Scroll" } satisfies Localized,
  marquee: [{ en: "Pull" }, { en: "Summon" }, { en: "Line up" }, { en: "Shoot" }, { en: "Share" }] satisfies Localized[],

  shareEyebrow: { en: "SHOOT AND SHARE" } satisfies Localized,
  shareTitle: { en: "Put it anywhere. Hit record." } satisfies Localized,
  shareBody: { en: "On the desk, side by side, up close. The card is in your room, so the shot is yours to share." } satisfies Localized,
  shareLabels: {
    lineUp: { en: "Side by side" },
    desk: { en: "On the desk" },
    close: { en: "Up close" },
    angle: { en: "From any angle" },
    stand: { en: "Standing up" },
    cardOnly: { en: "Out of the slab" },
  } satisfies Record<string, Localized>,
  shareNote: { en: "Every clip was recorded on an iPhone in the app, with real cards from a linked mainnet wallet." } satisfies Localized,

  two: {
    label: { en: "Two things you can do here" },
    items: [
      { href: "#pull", name: { en: "AR Gacha" }, body: { en: "Pull a pack and open it in AR." }, where: { en: "Web · devnet" } },
      { href: "#ios", name: { en: "AR Collection" }, body: { en: "See the cards you own anywhere, in AR." }, where: { en: "iPhone app · beta" } },
    ] satisfies { href: string; name: Localized; body: Localized; where: Localized }[],
  },

  pullShow: {
    eyebrow: { en: "AR GACHA" },
    title: { en: "Pull a pack in AR." },
    body: { en: "The capsule opens through your camera, and the card you pulled shows up in AR. The real card stays in Collector Crypt's vault." },
    note: { en: "Collector Crypt's machines, hosted here. Test funds only; odds are shown before you pull." },
    poolNote: {
      en: "The cards around the phone are in the Starter Pokémon machine's pool right now, one or two from each tier. Images are served by Collector Crypt. They are examples, not what a pull returns.",
    },
  },

  ios: {
    eyebrow: { en: "AR COLLECTION" },
    pill: { en: "iPhone app" },
    beta: { en: "Beta test" },
    title: { en: "See your cards anywhere, in AR." },
    body: { en: "Link your wallet. At home, at your desk, at a café, outside. Life-size, wherever you are." },
    places: [{ en: "At home" }, { en: "At your desk" }, { en: "At a café" }, { en: "Outside" }] satisfies Localized[],
    cta: { en: "Get the iPhone app" },
    videoLabel: { en: "Screen recording of the iPhone app showing a graded card on a desk in AR" },
    soon: { en: "The beta is invite-only for now. A public test link is coming." },
    note: { en: "Reads your wallet and never moves your cards or funds. The real cards stay in the vault." },
  },

  whatEyebrow: { en: "WHAT IT IS" } satisfies Localized,
  whatTitle: { en: "The card stays in the vault. You get to see it." } satisfies Localized,
  features: [
    {
      title: { en: "See it life-size" },
      body: { en: "Your card at its real size, in its graded slab, standing on whatever is in front of you. Walk up to it and look closer." },
    },
    {
      title: { en: "Still tradable" },
      body: { en: "Nothing ships. The card stays in the vault and the token stays in your wallet." },
    },
    {
      title: { en: "Line up and shoot" },
      body: { en: "Put cards side by side, hit record, and share the shot." },
    },
    {
      title: { en: "Your wallet stays yours" },
      body: { en: "The iPhone app only reads what your wallet holds. It never asks you to sign a transaction, and it cannot move your cards or funds." },
    },
  ] satisfies { title: Localized; body: Localized }[],

  faqEyebrow: { en: "FAQ" } satisfies Localized,
  faqTitle: { en: "Before you try it" } satisfies Localized,
  faqs: [
    {
      q: { en: "Where is the physical card?" },
      a: { en: "In Collector Crypt's vault. Buyback, shipping and refunds are Collector Crypt's responsibility, not Collectibles AR's." },
    },
    {
      q: { en: "What does the iOS app do with my wallet?" },
      a: { en: "It reads which cards your wallet holds. You approve a sign-in message in Phantom to link it. The app never asks you to sign a transaction, and it cannot pull, sell or send anything." },
    },
  ] satisfies { q: Localized; a: Localized }[],
  realPacksPre: { en: "Real packs can be pulled at " } satisfies Localized,
  realPacksPost: { en: "." } satisfies Localized,

  closingTitle: { en: "Every token needs a place to be seen." } satisfies Localized,
  closingBody: { en: "Pull one, or bring the ones you own, and see them anywhere." } satisfies Localized,
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
