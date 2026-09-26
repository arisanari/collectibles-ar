import type { AssetProvider, Entitlement, TwinfoldAsset } from "../contract";

/**
 * Implements the shared AssetProvider contract by calling this app's own
 * /api/solana/* route handlers (never Helius/RPC directly — those live in
 * lib/solana/heliusClient.ts, imported only by route handlers). Screens
 * using this provider must show a "DEVNET" label per
 * docs/architecture.md section 5.
 */
export class SolanaAssetProvider implements AssetProvider {
  readonly isDemoData = false;

  async getAssets(wallet: string): Promise<TwinfoldAsset[]> {
    const response = await fetch(`/api/solana/assets?wallet=${encodeURIComponent(wallet)}`);
    if (!response.ok) {
      throw new Error(`Failed to load assets for ${wallet}: HTTP ${response.status}`);
    }
    return (await response.json()) as TwinfoldAsset[];
  }

  async getAsset(assetId: string): Promise<TwinfoldAsset> {
    const response = await fetch(`/api/solana/assets/${encodeURIComponent(assetId)}`);
    if (!response.ok) {
      throw new Error(`Failed to load asset ${assetId}: HTTP ${response.status}`);
    }
    return (await response.json()) as TwinfoldAsset;
  }

  /**
   * Not part of the AssetProvider interface (it has no wallet parameter to
   * key off), same reasoning as refreshOwnershipForWallet above. Lists the
   * Twinfold asset ids currently registered in SOLANA_ASSET_ADDRESSES, so the
   * UI can show a DEVNET section without a hardcoded asset id list.
   */
  async listConfiguredAssetIds(): Promise<string[]> {
    const response = await fetch("/api/solana/registry");
    if (!response.ok) {
      throw new Error(`Failed to load devnet asset registry: HTTP ${response.status}`);
    }
    const body = (await response.json()) as { assetIds: string[] };
    return body.assetIds;
  }

  async refreshOwnership(assetId: string): Promise<Entitlement> {
    throw new Error(
      `SolanaAssetProvider.refreshOwnership("${assetId}") has no wallet to check against; ` +
        "call refreshOwnershipForWallet(assetId, wallet) instead."
    );
  }

  /**
   * The AssetProvider interface's `refreshOwnership(assetId)` has no wallet
   * parameter (it assumes a Backend session already knows the connected
   * wallet, per docs/architecture.md section 7). apps/web has no session
   * layer yet in Phase 2, so this explicit variant is used instead until
   * that lands; UI code should call this one, not the interface method
   * above.
   */
  async refreshOwnershipForWallet(assetId: string, wallet: string): Promise<Entitlement> {
    const response = await fetch(`/api/solana/assets/${encodeURIComponent(assetId)}/refresh`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ wallet }),
    });
    if (!response.ok) {
      throw new Error(`Failed to refresh entitlement for ${assetId}: HTTP ${response.status}`);
    }
    return (await response.json()) as Entitlement;
  }
}
