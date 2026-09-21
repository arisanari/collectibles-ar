import type {
  AssetProvider,
  Entitlement,
  ProvenanceEvent,
  TwinfoldAsset,
} from "../contract";
import assetsFixture from "../fixtures/demo/assets.json";

const assets = assetsFixture as TwinfoldAsset[];

const TRANSFER_DELAY_MS = 1500;

/**
 * Reads fixtures/demo/assets.json (synced via scripts/sync-fixtures.sh) and
 * implements the shared AssetProvider contract. Screens using this provider
 * must show a "DEMO DATA" label per docs/architecture.md section 5.
 *
 * `connect`/`disconnect` model the wallet session that a real backend would
 * track server-side; they are not part of the AssetProvider interface.
 *
 * `simulateTransfer`/`resetDemoState` are also not part of the
 * AssetProvider interface; they mirror
 * `packages/TwinfoldCore/Sources/TwinfoldCore/MockAssetProvider.swift` so
 * the same Primary E2E ("別walletへtransfer → 旧所有者からDisappear →
 * 新所有者へAppear") can be demonstrated from either client.
 */
export class MockAssetProvider implements AssetProvider {
  readonly isDemoData = true;
  private connectedWallet: string | null = null;

  /** In-memory owner overrides written by `simulateTransfer`, keyed by assetId. */
  private ownerOverrides = new Map<string, string>();
  /** `transferred` events produced by `simulateTransfer`, keyed by assetId. */
  private extraProvenance = new Map<string, ProvenanceEvent[]>();
  /** requestId -> the confirmed event already produced for it (idempotency). */
  private transferRequests = new Map<string, ProvenanceEvent>();

  connect(wallet: string): void {
    this.connectedWallet = wallet;
  }

  disconnect(): void {
    this.connectedWallet = null;
  }

  async getAssets(wallet: string): Promise<TwinfoldAsset[]> {
    return assets
      .map((asset) => this.materialize(asset))
      .filter((asset) => asset.owner === wallet);
  }

  async getAsset(assetId: string): Promise<TwinfoldAsset> {
    const asset = assets.find((item) => item.id === assetId);
    if (!asset) {
      throw new Error(`asset not found: ${assetId}`);
    }
    return this.materialize(asset);
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

  /**
   * Simulates an on-chain transfer: waits ~1.5s (standing in for devnet
   * confirmation latency), then moves `assetId`'s owner to `toWallet` and
   * returns a `confirmed` `transferred` ProvenanceEvent. Idempotent per
   * `requestId` (AGENTS.md section 3).
   */
  async simulateTransfer(
    assetId: string,
    toWallet: string,
    requestId: string
  ): Promise<ProvenanceEvent> {
    const existing = this.transferRequests.get(requestId);
    if (existing) {
      return existing;
    }

    await new Promise((resolve) => setTimeout(resolve, TRANSFER_DELAY_MS));

    const alreadyDone = this.transferRequests.get(requestId);
    if (alreadyDone) {
      return alreadyDone;
    }

    if (!assets.some((asset) => asset.id === assetId)) {
      throw new Error(`asset not found: ${assetId}`);
    }

    const event: ProvenanceEvent = {
      id: `tf-transfer-${requestId}`,
      assetId,
      kind: "transferred",
      occurredAt: new Date().toISOString(),
      source: "onchain",
      status: "confirmed",
      transaction: `DEMO-TX-TRANSFER-${requestId}`,
      metadata: {},
    };

    this.ownerOverrides.set(assetId, toWallet);
    const events = this.extraProvenance.get(assetId) ?? [];
    events.push(event);
    this.extraProvenance.set(assetId, events);
    this.transferRequests.set(requestId, event);

    return event;
  }

  /**
   * Clears all owner overrides and transferred events accumulated by
   * `simulateTransfer`, restoring every asset to its fixture owner. Does
   * not touch `connectedWallet`.
   */
  resetDemoState(): void {
    this.ownerOverrides.clear();
    this.extraProvenance.clear();
    this.transferRequests.clear();
  }

  private materialize(asset: TwinfoldAsset): TwinfoldAsset {
    const owner = this.ownerOverrides.get(asset.id) ?? asset.owner;
    const extra = this.extraProvenance.get(asset.id) ?? [];
    if (owner === asset.owner && extra.length === 0) {
      return asset;
    }
    return {
      ...asset,
      owner,
      provenance: [...asset.provenance, ...extra],
    };
  }
}
