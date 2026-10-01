import bs58 from "bs58";
import type { TwinfoldAsset, ProvenanceEvent, ProvenanceKind } from "../contract";
import type { HeliusAsset, HeliusSignatureInfo, HeliusTransaction } from "./heliusClient";
import { getTransaction } from "./heliusClient";
import { loadAssetRegistry } from "./assetRegistry";
import offchainAssetsFixture from "../fixtures/demo/assets.json";

// Metaplex Core program id and instruction discriminators (first byte of
// instruction data), taken from mpl-core's generated instruction
// serializers (scripts/solana/node_modules/@metaplex-foundation/mpl-core/
// dist/src/generated/instructions/{createV1,createV2,transferV1}.js).
// Hardcoded here rather than importing mpl-core, since apps/web only needs
// these two constants to classify an instruction, not the full SDK, for
// reading (mpl-core is only a real dependency for the write path in
// lib/solana/devnetTransfer.ts).
const MPL_CORE_PROGRAM_ID = "CoREENxT6tW1HoK8ypY1SxRMZTcVPm7R94rH4PZNhX7d";
const CREATE_DISCRIMINATORS = new Set([0, 20]); // CreateV1, CreateV2
const TRANSFER_DISCRIMINATOR = 14; // TransferV1

const offchainAssets = offchainAssetsFixture as TwinfoldAsset[];

function attributeValue(asset: HeliusAsset, traitType: string): string | undefined {
  return asset.content.metadata.attributes?.find((a) => a.trait_type === traitType)?.value;
}

function reverseRegistryLookup(address: string): string | null {
  const registry = loadAssetRegistry();
  for (const [id, registeredAddress] of Object.entries(registry)) {
    if (registeredAddress === address) return id;
  }
  return null;
}

/**
 * Looks up Twinfold's own off-chain record for `assetId` in
 * fixtures/demo/assets.json (the same record Web/iOS/visionOS read via
 * MockAssetProvider). When a devnet Asset's registry id matches one of
 * these records, `heliusAssetToTwinfoldAsset` uses it as the source of
 * `display`, `spatialRepresentation`, and `physical` — none of which live
 * on-chain (docs/architecture.md section 3: "浮世絵・こけしなどvertical固有の
 * ...要件はRWA Adapter内に置き、Coreへ埋め込まない"). This is a stand-in for a
 * real RWA Adapter/DB lookup (Phase 3); reusing the demo fixture keeps a
 * single source for the Reference Asset's off-chain facts until that
 * exists.
 */
export function findOffchainRecord(assetId: string): TwinfoldAsset | undefined {
  return offchainAssets.find((asset) => asset.id === assetId);
}

/**
 * Normalizes a Helius DAS getAsset result (Metaplex Core) into a
 * TwinfoldAsset. `owner`, `address`, `network`, and the on-chain
 * (`source: "onchain"`) provenance always come from chain data. When the
 * registry id has a matching off-chain record (see `findOffchainRecord`),
 * `display`, `spatialRepresentation`, and `physical` come from that record
 * instead of being left empty/`card`-only, and its own
 * `offchain_evidence`/`twinfold_interpretation` provenance events are merged
 * in, sorted chronologically alongside the on-chain events. Without a
 * matching record, `physical` stays omitted and `display`/
 * `spatialRepresentation` fall back to the previous empty-image/card
 * defaults.
 */
export async function heliusAssetToTwinfoldAsset(
  heliusAsset: HeliusAsset,
  signatures: HeliusSignatureInfo[]
): Promise<TwinfoldAsset> {
  const assetId = reverseRegistryLookup(heliusAsset.id) ?? `devnet-${heliusAsset.id}`;
  const onchainProvenance = await heliusTransactionsToProvenanceEvents(
    assetId,
    signatures,
    heliusAsset.ownership.owner
  );
  const offchainRecord = findOffchainRecord(assetId);

  if (offchainRecord) {
    const offchainOnlyProvenance = offchainRecord.provenance.filter(
      (event) => event.source !== "onchain"
    );
    const provenance = [...onchainProvenance, ...offchainOnlyProvenance].sort((a, b) =>
      a.occurredAt.localeCompare(b.occurredAt)
    );

    return {
      id: assetId,
      network: "devnet",
      address: heliusAsset.id,
      standard: "metaplex-core",
      owner: heliusAsset.ownership.owner,
      title: heliusAsset.content.metadata.name,
      titleLocalized: offchainRecord.titleLocalized,
      display: offchainRecord.display,
      spatialRepresentation: offchainRecord.spatialRepresentation,
      provenance,
      physical: offchainRecord.physical,
      commerce: offchainRecord.commerce,
    };
  }

  return {
    id: assetId,
    network: "devnet",
    address: heliusAsset.id,
    standard: "metaplex-core",
    owner: heliusAsset.ownership.owner,
    title: heliusAsset.content.metadata.name,
    display: {
      kind: "image",
      // Off-chain metadata JSON (uploaded by scripts/solana) does not carry
      // a display image field yet; RWA Adapter fills this in once Physical
      // registration adds display material. Empty string keeps the type
      // honest rather than inventing a path that doesn't exist.
      imageUrl: "",
      placeholder: false,
      rightsNote:
        attributeValue(heliusAsset, "image_rights") ??
        "画像利用権は未登録（Phase 3のRWA Adapterで追加予定）",
    },
    spatialRepresentation: { kind: "card" },
    provenance: onchainProvenance,
  };
}

/**
 * Classifies a single transaction's Metaplex Core instruction as `minted`
 * (CreateV1/CreateV2, discriminator 0/20) or `transferred` (TransferV1,
 * discriminator 14) by decoding the first instruction data byte, checking
 * both top-level and inner instructions for the mpl-core program id. Falls
 * back to position (first = minted, rest = transferred) only when no
 * mpl-core instruction can be decoded at all (e.g. getTransaction returned
 * null or an unexpected shape) — logged, not silent, per AGENTS.md section
 * 3's "core-contract" rule against swallowing unknown values quietly.
 */
function classifyInstructionKind(
  tx: HeliusTransaction | null,
  signature: string,
  fallbackKind: ProvenanceKind
): ProvenanceKind {
  if (!tx) {
    console.warn(`normalize: getTransaction(${signature}) returned null; falling back to position heuristic`);
    return fallbackKind;
  }

  const accountKeys = tx.transaction.message.accountKeys;
  const allInstructions = [
    ...tx.transaction.message.instructions,
    ...(tx.meta?.innerInstructions?.flatMap((inner) => inner.instructions) ?? []),
  ];

  for (const instruction of allInstructions) {
    const programId = accountKeys[instruction.programIdIndex];
    if (programId !== MPL_CORE_PROGRAM_ID) continue;
    let dataBytes: Uint8Array;
    try {
      dataBytes = bs58.decode(instruction.data);
    } catch {
      continue;
    }
    const discriminator = dataBytes[0];
    if (CREATE_DISCRIMINATORS.has(discriminator)) return "minted";
    if (discriminator === TRANSFER_DISCRIMINATOR) return "transferred";
  }

  console.warn(
    `normalize: no decodable mpl-core instruction found in ${signature}; falling back to position heuristic`
  );
  return fallbackKind;
}

/**
 * Normalizes on-chain transaction history into ProvenanceEvents. For each
 * signature, fetches the full transaction and decodes its Metaplex Core
 * instruction (create vs. transfer — see `classifyInstructionKind`) instead
 * of assuming "oldest = mint, everything else = transfer". The most recent
 * `transferred` event is decorated with `metadata.to` = the Asset's current
 * chain owner (`currentOwner`, from the same `getAsset` call as the rest of
 * this normalizer) since that's the one hop we can state with certainty
 * without also resolving intermediate `newOwner` accounts for older
 * transfers — a known limitation, tracked in docs/architecture.md section
 * 12.
 */
export async function heliusTransactionsToProvenanceEvents(
  assetId: string,
  signatures: HeliusSignatureInfo[],
  currentOwner?: string
): Promise<ProvenanceEvent[]> {
  // getSignaturesForAddress returns newest-first; sort oldest-first so the
  // first chronological transaction is treated as the mint fallback.
  const chronological = [...signatures].sort((a, b) => a.slot - b.slot);

  const events = await Promise.all(
    chronological.map(async (sig, index) => {
      const occurredAt = sig.blockTime
        ? new Date(sig.blockTime * 1000).toISOString()
        : new Date(0).toISOString();

      const fallbackKind: ProvenanceKind = index === 0 ? "minted" : "transferred";
      let kind: ProvenanceKind = fallbackKind;
      if (!sig.err) {
        try {
          const tx = await getTransaction(sig.signature);
          kind = classifyInstructionKind(tx, sig.signature, fallbackKind);
        } catch (error) {
          console.warn(`normalize: getTransaction(${sig.signature}) failed; falling back to position heuristic`, error);
        }
      }

      return {
        id: `${assetId}-tx-${sig.signature}`,
        assetId,
        kind,
        occurredAt,
        source: "onchain",
        status: sig.err ? "failed" : "confirmed",
        transaction: sig.signature,
        slot: sig.slot,
        metadata: {},
      } satisfies ProvenanceEvent;
    })
  );

  if (currentOwner) {
    for (let i = events.length - 1; i >= 0; i--) {
      if (events[i].kind === "transferred" && events[i].status === "confirmed") {
        events[i] = { ...events[i], metadata: { ...events[i].metadata, to: currentOwner } };
        break;
      }
    }
  }

  return events;
}
