import type { ProvenanceEvent, TwinfoldAsset } from "../contract";
import type { HeliusAsset, HeliusSignatureInfo } from "./heliusClient";
import { loadAssetRegistry } from "./assetRegistry";

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
 * Normalizes a Helius DAS getAsset result (Metaplex Core) into a
 * TwinfoldAsset, using the on-chain transaction history for `provenance`.
 * `physical` is intentionally omitted here: Physical/RWA fields come from
 * the RWA Adapter (Phase 3), not from on-chain metadata, per
 * docs/architecture.md section 3 ("浮世絵・こけしなどvertical固有の...要件は
 * RWA Adapter内に置き、Coreへ埋め込まない").
 */
export function heliusAssetToTwinfoldAsset(
  heliusAsset: HeliusAsset,
  signatures: HeliusSignatureInfo[]
): TwinfoldAsset {
  const assetId = reverseRegistryLookup(heliusAsset.id) ?? `devnet-${heliusAsset.id}`;

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
    provenance: heliusTransactionsToProvenanceEvents(assetId, signatures),
  };
}

/**
 * Normalizes on-chain transaction history into ProvenanceEvents.
 *
 * Known limitation (tracked as an open item in docs/architecture.md section
 * 12, "Solana transactionから復元するEvent範囲とRPC／DAS provider"): Metaplex
 * Core does not expose a per-instruction event log through
 * getSignaturesForAddress alone, so this normalizer uses a heuristic — the
 * oldest transaction for an Asset address is classified `minted`, every
 * later one `transferred`. It does not decode instruction data to
 * distinguish transfer from e.g. a metadata update. A fuller normalizer
 * (parsing instructions via getTransaction) is deferred to when Phase 2 adds
 * real owner-to-owner transfers to verify against.
 */
export function heliusTransactionsToProvenanceEvents(
  assetId: string,
  signatures: HeliusSignatureInfo[]
): ProvenanceEvent[] {
  // getSignaturesForAddress returns newest-first; sort oldest-first so the
  // first chronological transaction is treated as the mint.
  const chronological = [...signatures].sort((a, b) => a.slot - b.slot);

  return chronological.map((sig, index) => {
    const occurredAt = sig.blockTime
      ? new Date(sig.blockTime * 1000).toISOString()
      : new Date(0).toISOString();

    return {
      id: `${assetId}-tx-${sig.signature}`,
      assetId,
      kind: index === 0 ? "minted" : "transferred",
      occurredAt,
      source: "onchain",
      status: sig.err ? "failed" : "confirmed",
      transaction: sig.signature,
      slot: sig.slot,
      metadata: {},
    } satisfies ProvenanceEvent;
  });
}
