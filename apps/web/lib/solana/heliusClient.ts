// Server-only Helius DAS/RPC client. Only imported by app/api/solana/*
// route handlers (Next.js route handlers run server-side). Never import
// this from a client component ("use client") or from
// lib/providers/solanaAssetProvider.ts — the UI must go through the
// AssetProvider interface, not this client directly (AGENTS.md section 3,
// docs/architecture.md section 3 "Twinfold Backend").
//
// HELIUS_API_KEY is read from process.env here (server-side only) and must
// never be exposed as NEXT_PUBLIC_*.

export type HeliusNetwork = "devnet" | "mainnet";

const HELIUS_HOSTS: Record<HeliusNetwork, string> = {
  devnet: "https://devnet.helius-rpc.com",
  mainnet: "https://mainnet.helius-rpc.com",
};

function getApiKey(): string {
  const key = process.env.HELIUS_API_KEY;
  if (!key) {
    throw new Error(
      "HELIUS_API_KEY is not set. Copy apps/web/.env.example to .env.local and fill in a real value " +
        "(see .claude/skills/solana-devnet/SKILL.md)."
    );
  }
  return key;
}

// `network` defaults to devnet. "mainnet" is only used for READ-ONLY DAS reads (getAssetsByOwner) by
// app/api/solana/assets; nothing in the app signs or sends a transaction on mainnet.
async function rpc<T>(method: string, params: unknown, network: HeliusNetwork = "devnet"): Promise<T> {
  const apiKey = getApiKey();
  const response = await fetch(`${HELIUS_HOSTS[network]}/?api-key=${apiKey}`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ jsonrpc: "2.0", id: "twinfold", method, params }),
    cache: "no-store",
  });

  if (!response.ok) {
    throw new Error(`Helius RPC "${method}" failed with HTTP ${response.status}`);
  }

  const json = (await response.json()) as { result?: T; error?: { message: string } };
  if (json.error) {
    throw new Error(`Helius RPC "${method}" error: ${json.error.message}`);
  }
  return json.result as T;
}

// Shapes below only include the fields normalize.ts reads. Helius returns
// more; we intentionally do not model all of it.

export type HeliusAsset = {
  id: string;
  interface: string;
  content: {
    json_uri: string;
    // Image locations, used for the card assets (lib/gacha/normalize.ts). Present on NFTs, absent on some others.
    links?: { image?: string };
    files?: { uri?: string; cdn_uri?: string; cc_cdn?: string }[];
    metadata: {
      name: string;
      description?: string;
      attributes?: { trait_type: string; value: string }[];
    };
  };
  grouping?: { group_key: string; group_value: string }[];
  ownership: { owner: string };
  mutable: boolean;
  burnt: boolean;
};

export type HeliusAssetsByOwnerResult = {
  total: number;
  items: HeliusAsset[];
};

export type HeliusSignatureInfo = {
  signature: string;
  slot: number;
  err: unknown;
  blockTime: number | null;
};

/** DAS getAsset: a single Metaplex Core Asset by address. */
export function getAsset(assetAddress: string): Promise<HeliusAsset> {
  return rpc<HeliusAsset>("getAsset", { id: assetAddress });
}

/** Pages of 1000 read by getAssetsByOwner. A wallet with more than MAX_OWNER_PAGES * 1000 assets is truncated. */
const OWNER_PAGE_LIMIT = 1000;
const MAX_OWNER_PAGES = 5;

/**
 * DAS getAssetsByOwner: every Asset (of any standard DAS indexes) a wallet owns. Devnet is one call as before;
 * mainnet wallets can hold many NFTs, so it keeps reading pages (up to MAX_OWNER_PAGES) while a page is full.
 */
export async function getAssetsByOwner(ownerAddress: string, network: HeliusNetwork = "devnet"): Promise<HeliusAssetsByOwnerResult> {
  const first = await rpc<HeliusAssetsByOwnerResult>("getAssetsByOwner", { ownerAddress, page: 1, limit: OWNER_PAGE_LIMIT }, network);
  if (network === "devnet") return first;
  let items = first.items;
  for (let page = 2; page <= MAX_OWNER_PAGES && items.length === (page - 1) * OWNER_PAGE_LIMIT; page++) {
    const next = await rpc<HeliusAssetsByOwnerResult>("getAssetsByOwner", { ownerAddress, page, limit: OWNER_PAGE_LIMIT }, network);
    if (next.items.length === 0) break;
    items = items.concat(next.items);
  }
  return { total: first.total, items };
}

/**
 * Standard Solana RPC getSignaturesForAddress, used for Metaplex Core Assets
 * because DAS's getSignaturesForAsset only indexes compressed (Bubblegum
 * tree) assets and returns "Tree not found" for Core assets (confirmed
 * against Helius devnet 2026-09-26). Returned oldest-last (Solana RPC
 * default); normalize.ts reverses to oldest-first before classifying
 * mint vs. transfer.
 */
export function getSignaturesForAddress(address: string): Promise<HeliusSignatureInfo[]> {
  return rpc<HeliusSignatureInfo[]>("getSignaturesForAddress", [address, { limit: 100 }]);
}

export type HeliusTransactionInstruction = {
  programIdIndex: number;
  accounts: number[];
  data: string; // base58
};

export type HeliusTransaction = {
  transaction: {
    message: {
      accountKeys: string[];
      instructions: HeliusTransactionInstruction[];
    };
  };
  meta: {
    innerInstructions?: { index: number; instructions: HeliusTransactionInstruction[] }[];
  } | null;
};

/**
 * Standard Solana RPC getTransaction, "json" encoding (not "jsonParsed" —
 * the Metaplex Core program isn't one of the RPC's known parsers, so
 * jsonParsed would leave its instructions undecoded anyway). Used by
 * normalize.ts to distinguish a Metaplex Core `create` from a `transfer`
 * instruction by discriminator byte, instead of guessing from transaction
 * order alone.
 */
export function getTransaction(signature: string): Promise<HeliusTransaction | null> {
  return rpc<HeliusTransaction | null>("getTransaction", [
    signature,
    { encoding: "json", maxSupportedTransactionVersion: 0 },
  ]);
}

export type HeliusSignatureStatus = {
  slot: number;
  confirmations: number | null;
  err: unknown;
  confirmationStatus?: "processed" | "confirmed" | "finalized";
} | null;

/**
 * Standard Solana RPC getSignatureStatuses (devnet). `searchTransactionHistory` lets it find a signature that
 * has aged out of the recent status cache. One entry per requested signature, `null` when the cluster does not know it.
 * Used by lib/gacha/openResult.ts to decide whether a Pull transaction is really on chain.
 */
export async function getSignatureStatuses(signatures: string[]): Promise<HeliusSignatureStatus[]> {
  const result = await rpc<{ value: HeliusSignatureStatus[] }>("getSignatureStatuses", [signatures, { searchTransactionHistory: true }]);
  return result?.value ?? [];
}
