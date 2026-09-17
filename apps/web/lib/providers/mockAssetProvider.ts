import type { AssetProvider, Entitlement, TwinfoldAsset } from "../contract";
import assetsFixture from "../fixtures/demo/assets.json";

const assets = assetsFixture as TwinfoldAsset[];

/**
 * Reads fixtures/demo/assets.json (synced via scripts/sync-fixtures.sh) and
 * implements the shared AssetProvider contract. Screens using this provider
 * must show a "DEMO DATA" label per docs/architecture.md section 5.
 *
 * `connect`/`disconnect` model the wallet session that a real backend would
 * track server-side; they are not part of the AssetProvider interface.
 */
export class MockAssetProvider implements AssetProvider {
  readonly isDemoData = true;
  private connectedWallet: string | null = null;

  connect(wallet: string): void {
    this.connectedWallet = wallet;
  }

  disconnect(): void {
    this.connectedWallet = null;
  }

  async getAssets(wallet: string): Promise<TwinfoldAsset[]> {
    return assets.filter((asset) => asset.owner === wallet);
  }

  async getAsset(assetId: string): Promise<TwinfoldAsset> {
    const asset = assets.find((item) => item.id === assetId);
    if (!asset) {
      throw new Error(`asset not found: ${assetId}`);
    }
    return asset;
  }

  async refreshOwnership(assetId: string): Promise<Entitlement> {
    const asset = await this.getAsset(assetId);
    const wallet = this.connectedWallet ?? "";
    const canDisplay = Boolean(wallet) && asset.owner === wallet;
    return {
      wallet,
      assetId,
      canDisplay,
      reason: canDisplay
        ? "demo: chain owner matches wallet"
        : "demo: chain owner does not match wallet",
      checkedAt: new Date().toISOString(),
    };
  }
}
