// Pure normalizers: Collector Crypt openPack result / DAS asset -> TwinfoldAsset (category "card").
// No network, no env: unit-tested by scripts/gacha-normalize.test.mjs.
//
// Trust split (AGENTS.md section 3): owner, mint address and the Pull transaction are onchain facts. Grade, grading
// id, insured value and vault are THIRD-PARTY claims copied from NFT metadata (PSA / Collector Crypt); they are
// stored in the card fields of TwinfoldAsset and never promoted to onchain provenance.
import type { ProvenanceEvent, TwinfoldAsset } from "../contract";
import type { HeliusAsset } from "../solana/heliusClient";
import type { CcAttribute, CcOpenPackWon, GachaNetwork } from "./types";

/**
 * Verification page for a Pull's VRF selection (devnet host). A link to Collector Crypt's mechanism; Collectibles AR does not vouch for it.
 * The devnet host does serve the page: checked 2026-10-06, https://dev-gacha.collectorcrypt.com/verify-selection/<memo>
 * answers 200 while an unknown path on the same host answers 404, so the route exists there and the devnet link stays
 * on the devnet host (a devnet memo is not known to the mainnet host). Only devnet Pulls carry a memo in this app.
 */
export function gachaVerifyUrl(memo: string): string {
  return `https://dev-gacha.collectorcrypt.com/verify-selection/${encodeURIComponent(memo)}`;
}

export function cardAssetId(nftAddress: string): string {
  return `tf-card-${nftAddress.slice(0, 8)}`;
}

export function attributeOf(attributes: readonly CcAttribute[] | undefined, traitType: string): string | undefined {
  const found = attributes?.find((a) => a.trait_type === traitType);
  if (!found || found.value === null || found.value === undefined) return undefined;
  const text = String(found.value).trim();
  return text === "" ? undefined : text;
}

/** "487" -> 487, "$1,200.50" -> 1200.5, "n/a" -> undefined. Never guesses. */
export function parseInsuredValue(raw: string | undefined): number | undefined {
  if (raw === undefined) return undefined;
  const cleaned = raw.replace(/[$,\s]/g, "");
  if (!/^\d+(\.\d+)?$/.test(cleaned)) return undefined;
  const value = Number(cleaned);
  return Number.isFinite(value) ? value : undefined;
}

type CardFields = Pick<TwinfoldAsset, "grade" | "gradingCompany" | "gradingId" | "insuredValueUsd" | "vault" | "vaultId">;

/** Maps the Collector Crypt attribute trait types onto the card fields. Missing attributes stay absent (never invented). */
export function cardFieldsFromAttributes(attributes: readonly CcAttribute[] | undefined): CardFields {
  const fields: CardFields = {};
  const grade = attributeOf(attributes, "The Grade");
  const gradingCompany = attributeOf(attributes, "Grading Company");
  const gradingId = attributeOf(attributes, "Grading ID");
  const insured = parseInsuredValue(attributeOf(attributes, "Insured Value"));
  const vault = attributeOf(attributes, "Vault");
  const vaultId = attributeOf(attributes, "Vault ID");
  if (grade !== undefined) fields.grade = grade;
  if (gradingCompany !== undefined) fields.gradingCompany = gradingCompany;
  if (gradingId !== undefined) fields.gradingId = gradingId;
  if (insured !== undefined) fields.insuredValueUsd = insured;
  if (vault !== undefined) fields.vault = vault;
  if (vaultId !== undefined) fields.vaultId = vaultId;
  return fields;
}

/** https URLs, or a same-origin public path such as the demo fixture's "/artworks/...". Anything else (http, data:, javascript:, //host) is dropped. */
export function httpsOnly(url: string | undefined): string | undefined {
  return url && /^(https:\/\/|\/(?!\/))/i.test(url) ? url : undefined;
}

type ImageSources = {
  image?: string;
  content?: { links?: { image?: string }; files?: { uri?: string; cdn_uri?: string; cc_cdn?: string }[] };
};

/**
 * First usable https image URL from an openPack `nftWon` or a DAS asset. The image is read at runtime from the
 * host that serves it; it is never copied into the repo. Order: explicit image, links.image, then file entries
 * (Collector Crypt's CDN copy first, then the original uri).
 */
export function pickImageUrl(source: ImageSources | undefined): string | undefined {
  if (!source) return undefined;
  const file = source.content?.files?.[0];
  return (
    httpsOnly(source.image) ??
    httpsOnly(source.content?.links?.image) ??
    httpsOnly(file?.cc_cdn) ??
    httpsOnly(file?.uri) ??
    httpsOnly(file?.cdn_uri)
  );
}

const STANDARD_BY_INTERFACE: Record<string, string> = {
  MplCoreAsset: "metaplex-core",
  ProgrammableNFT: "pnft",
  V1_NFT: "nft",
  V2_NFT: "nft",
};

export function standardFromInterface(iface: string | undefined): string {
  if (!iface) return "unknown";
  return STANDARD_BY_INTERFACE[iface] ?? iface;
}

function cardDisplay(imageUrl: string | undefined): TwinfoldAsset["display"] {
  return {
    kind: "image",
    imageUrl: imageUrl ?? "",
    // No image URL in the metadata -> the UI shows its "image not available" placeholder.
    placeholder: imageUrl === undefined,
    rightsNote:
      "Image URL comes from the NFT metadata and is loaded at runtime. Not stored in this repository; rights stay with the rights holders.",
  };
}

/**
 * The single provenance event of an opened Pull: the NFT transfer to the player as reported by openPack.
 * `confirmed` + `onchain` only when the signature was found on chain, otherwise `pending` + `offchain_evidence`.
 */
export function pullEvent(input: { assetId: string; memo: string; signature?: string; owner: string | null; occurredAt: string; confirmed: boolean }): ProvenanceEvent {
  const { assetId, memo, signature, owner, occurredAt, confirmed } = input;
  return {
    id: `${assetId}-pull-${memo}`,
    assetId,
    kind: "transferred",
    occurredAt,
    source: confirmed ? "onchain" : "offchain_evidence",
    status: confirmed ? "confirmed" : "pending",
    ...(signature ? { transaction: signature } : {}),
    metadata: {
      via: "collectorCryptGacha",
      memo,
      ...(owner ? { to: owner } : {}),
      note: confirmed
        ? "NFT transfer to the player as reported by Collector Crypt openPack; the signature was found on chain"
        : "NFT transfer to the player as reported by Collector Crypt openPack; the signature is not confirmed on chain yet",
    },
  };
}

/** The same asset once its Pull signature has been seen on chain (only the Pull event changes; its time and signature stay). */
export function withPullConfirmed(asset: TwinfoldAsset): TwinfoldAsset {
  const memo = asset.gachaMemo;
  const event = asset.provenance.find((e) => memo !== undefined && e.id === `${asset.id}-pull-${memo}`);
  if (!memo || !event || !event.transaction || event.status === "confirmed") return asset;
  const owner = typeof event.metadata?.to === "string" ? event.metadata.to : null;
  const confirmed = pullEvent({ assetId: asset.id, memo, signature: event.transaction, owner, occurredAt: event.occurredAt, confirmed: true });
  return { ...asset, provenance: asset.provenance.map((e) => (e === event ? confirmed : e)) };
}

export type OpenPackToAssetInput = {
  won: CcOpenPackWon;
  memo: string;
  /** Player wallet (or the DAS owner when known). null = unknown. */
  owner: string | null;
  /** Image URL found through DAS when `won` carries none. */
  fallbackImageUrl?: string;
  /** DAS `interface`, when known. */
  assetInterface?: string;
  network?: GachaNetwork;
  /**
   * Was the Pull transaction signature seen on chain (RPC getSignatureStatuses)? Only then is the event
   * `confirmed` + `onchain`; otherwise it stays `pending` + `offchain_evidence` (Collector Crypt's say-so).
   * DEMO DATA passes true: its fixture signature is a made-up value and the screen says DEMO DATA.
   */
  chainConfirmed?: boolean;
  /** Event time. The server passes the pack record's stored time so the same memo always yields the same output. */
  now?: Date;
};

/**
 * openPack result -> TwinfoldAsset (category card, source collectorCrypt, gachaMemo = memo).
 * An asset that came out of OUR openPack call is Collector Crypt issued by construction, so `source` and
 * `sourceVerified` are set here (and only here and for a configured collection, see heliusCardToAsset).
 * The single provenance event is the NFT transfer to the player as reported by openPack: `confirmed` + `onchain`
 * only when the signature was checked on chain (`chainConfirmed`), otherwise `pending` + `offchain_evidence`.
 */
export function openPackToAsset(input: OpenPackToAssetInput): TwinfoldAsset {
  const { won, memo, owner } = input;
  const network = input.network ?? "devnet";
  const metadata = won.nftWon?.content?.metadata;
  const imageUrl = pickImageUrl(won.nftWon) ?? httpsOnly(input.fallbackImageUrl);
  const id = cardAssetId(won.nft_address);
  const occurredAt = (input.now ?? new Date()).toISOString();
  const confirmed = Boolean(won.transactionSignature) && input.chainConfirmed === true;

  const event = pullEvent({ assetId: id, memo, signature: won.transactionSignature, owner, occurredAt, confirmed });

  return {
    id,
    network,
    address: won.nft_address,
    standard: standardFromInterface(input.assetInterface),
    owner,
    title: metadata?.name ?? "Collector Crypt card",
    display: cardDisplay(imageUrl),
    spatialRepresentation: { kind: "card" },
    provenance: [event],
    category: "card",
    ...cardFieldsFromAttributes(metadata?.attributes),
    source: "collectorCrypt",
    sourceVerified: true,
    gachaMemo: memo,
    ...(imageUrl ? { imageUrl } : {}),
  };
}

/**
 * Does the metadata have the shape of a graded Collector Crypt card?
 *
 * Checked against Helius devnet DAS on 2026-10-06 (asset GzGgDbGT... in the gacha pool and a getAssetsByOwner page
 * of its holder): `getAssetsByOwner` already returns `content.metadata.attributes`, and the cards carry "Grading
 * Company" and "Vault ID" (plus "The Grade", "Grading ID"). Anyone can mint an NFT with these attribute names, so
 * this is recognition by metadata SHAPE, not proof of the issuer. It lets us show the card (category "card") but
 * never sets `source` (see isCollectorCryptCard).
 */
export function looksLikeGradedCard(asset: HeliusAsset): boolean {
  const attributes = asset.content?.metadata?.attributes as CcAttribute[] | undefined;
  return attributeOf(attributes, "Grading Company") !== undefined && attributeOf(attributes, "Vault ID") !== undefined;
}

/**
 * Is this DAS asset VERIFIED as Collector Crypt issued? Only when its DAS grouping (collection) is one of the
 * collection addresses configured for the network (COLLECTOR_CRYPT_COLLECTION_ADDRESSES_DEVNET / _MAINNET, see
 * collectionAddressesFromEnv). Attributes alone never qualify. `creators[].verified` is false on these assets,
 * so creators are not a usable signal.
 */
export function isCollectorCryptCard(asset: HeliusAsset, collectionAddresses: readonly string[] = []): boolean {
  if (collectionAddresses.length === 0) return false;
  const groups = asset.grouping ?? [];
  return groups.some((g) => g.group_key === "collection" && collectionAddresses.includes(g.group_value));
}

export function parseCollectionAddresses(raw: string | undefined): string[] {
  return (raw ?? "")
    .split(",")
    .map((s) => s.trim())
    .filter((s) => s.length > 0);
}

/** Collector Crypt collection addresses for one network. The two networks are configured separately and never mixed. */
export function collectionAddressesFromEnv(env: Record<string, string | undefined>, network: "devnet" | "mainnet"): string[] {
  return parseCollectionAddresses(env[network === "mainnet" ? "COLLECTOR_CRYPT_COLLECTION_ADDRESSES_MAINNET" : "COLLECTOR_CRYPT_COLLECTION_ADDRESSES_DEVNET"]);
}

/**
 * DAS asset -> TwinfoldAsset for My Collection. Returns null when the asset neither matches a configured Collector
 * Crypt collection nor has the graded-card attribute shape (with `requireVerified`: nor matches a configured collection).
 * `source: "collectorCrypt"` + `sourceVerified: true` only for a collection match or `openedViaPack`; a shape-only match keeps `source`
 * undefined and `sourceVerified: false` (the UI shows UNVERIFIED SOURCE and the AR list excludes it).
 * Provenance is left empty: the list call does not fetch transaction history, and no event is invented.
 */
export function heliusCardToAsset(
  asset: HeliusAsset,
  options: {
    collectionAddresses?: readonly string[];
    network?: "devnet" | "mainnet";
    requireVerified?: boolean;
    /**
     * This app's own openPack delivered this asset to this wallet (a local pack record: opened, same wallet, same
     * mint). That alone verifies the source, whatever the DAS collection is: Collector Crypt uses collections that
     * differ per token standard, and the Pull is the evidence here.
     */
    openedViaPack?: boolean;
  } = {}
): TwinfoldAsset | null {
  const verified = options.openedViaPack === true || isCollectorCryptCard(asset, options.collectionAddresses);
  // `requireVerified` (mainnet, read-only): a collection match is the only way in; a metadata shape never qualifies.
  if (options.requireVerified && !verified) return null;
  if (!verified && !looksLikeGradedCard(asset)) return null;
  const imageUrl = pickImageUrl(asset);
  return {
    id: cardAssetId(asset.id),
    network: options.network ?? "devnet",
    address: asset.id,
    standard: standardFromInterface(asset.interface),
    owner: asset.ownership.owner ?? null,
    title: asset.content.metadata.name,
    display: cardDisplay(imageUrl),
    spatialRepresentation: { kind: "card" },
    provenance: [],
    category: "card",
    ...cardFieldsFromAttributes(asset.content.metadata.attributes as CcAttribute[] | undefined),
    ...(verified ? { source: "collectorCrypt" as const } : {}),
    sourceVerified: verified,
    ...(imageUrl ? { imageUrl } : {}),
  };
}

/**
 * Mainnet My Collection (read-only): only DAS assets whose collection is one of the configured mainnet Collector Crypt
 * collections, as `source: "collectorCrypt"`, `sourceVerified: true`, `network: "mainnet"`. Burnt assets are skipped.
 * No collection configured -> nothing is returned (a metadata shape is never enough on mainnet).
 */
export function mainnetCardsFromAssets(items: readonly HeliusAsset[], collectionAddresses: readonly string[]): TwinfoldAsset[] {
  if (collectionAddresses.length === 0) return [];
  return items.flatMap((item) => {
    if (item.burnt) return [];
    const card = heliusCardToAsset(item, { collectionAddresses, network: "mainnet", requireVerified: true });
    return card ? [card] : [];
  });
}
