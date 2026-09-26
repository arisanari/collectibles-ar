// Server-only Helius DAS/RPC client. Only imported by app/api/solana/*
// route handlers (Next.js route handlers run server-side). Never import
// this from a client component ("use client") or from
// lib/providers/solanaAssetProvider.ts — the UI must go through the
// AssetProvider interface, not this client directly (AGENTS.md section 3,
// docs/architecture.md section 3 "Twinfold Backend").
//
// HELIUS_API_KEY is read from process.env here (server-side only) and must
// never be exposed as NEXT_PUBLIC_*.

const HELIUS_DEVNET_RPC = "https://devnet.helius-rpc.com";

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

async function rpc<T>(method: string, params: unknown): Promise<T> {
  const apiKey = getApiKey();
  const response = await fetch(`${HELIUS_DEVNET_RPC}/?api-key=${apiKey}`, {
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
    metadata: {
      name: string;
      description?: string;
      attributes?: { trait_type: string; value: string }[];
    };
  };
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

/** DAS getAssetsByOwner: every Asset (of any standard DAS indexes) a wallet owns. */
export function getAssetsByOwner(ownerAddress: string): Promise<HeliusAssetsByOwnerResult> {
  return rpc<HeliusAssetsByOwnerResult>("getAssetsByOwner", {
    ownerAddress,
    page: 1,
    limit: 1000,
  });
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
