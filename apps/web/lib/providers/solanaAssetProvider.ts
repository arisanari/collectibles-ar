import type {
  AcquisitionView,
  AssetProvider,
  BuybackQuote,
  DevnetTransferResult,
  Entitlement,
  TwinfoldAsset,
} from "../contract";

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

  /** GET /api/solana/assets/{id}/buyback-quote?wallet=... — see that route's comments. */
  async buybackQuote(assetId: string, wallet: string): Promise<BuybackQuote> {
    const response = await fetch(
      `/api/solana/assets/${encodeURIComponent(assetId)}/buyback-quote?wallet=${encodeURIComponent(wallet)}`
    );
    if (!response.ok) {
      throw new Error(`Failed to get buyback quote for ${assetId}: HTTP ${response.status}`);
    }
    return (await response.json()) as BuybackQuote;
  }

  /**
   * POST /api/devnet/transfer — dev-only server-signing shortcut (Issue
   * #29; real wallet signing is #19/#45). `from`/`to` are devnet wallet
   * labels ("owner-a" | "owner-b" | "vault"), not raw pubkeys.
   */
  async devnetTransfer(params: {
    requestId: string;
    assetId: string;
    from: "owner-a" | "owner-b";
    to: "owner-a" | "owner-b" | "vault";
    quoteId?: string;
  }): Promise<DevnetTransferResult> {
    const response = await fetch("/api/devnet/transfer", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(params),
    });
    const json = (await response.json()) as DevnetTransferResult | { error: string };
    if (!response.ok || "error" in json) {
      const message = "error" in json ? json.error : `HTTP ${response.status}`;
      throw new Error(`devnet transfer failed for ${params.assetId}: ${message}`);
    }
    return json;
  }

  /** GET /api/vault/assets — Assets Twinfold's vault wallet holds and lists for acquisition (with commerce). */
  async getVaultAssets(): Promise<TwinfoldAsset[]> {
    const response = await fetch("/api/vault/assets", { cache: "no-store" });
    if (!response.ok) throw new Error(`Failed to load vault assets: HTTP ${response.status}`);
    return (await response.json()) as TwinfoldAsset[];
  }

  /**
   * POST /api/acquisitions — "Twinfoldから取得" (Issue #60). The buyer is the signed-in wallet (session cookie);
   * only Twinfold's vault signs; no payment. Idempotent by requestId. Resolves with the view even for
   * a refusal (`ok: false`), so the UI can show the server's message.
   */
  async acquire(requestId: string, assetId: string): Promise<{ ok: boolean; status: number; view?: AcquisitionView; message?: string }> {
    const response = await fetch("/api/acquisitions", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ requestId, assetId }),
    });
    const json = (await response.json().catch(() => ({}))) as Partial<AcquisitionView> & { error?: string; message?: string; reasons?: string[] };
    if ("requestId" in json && json.requestId) return { ok: response.ok, status: response.status, view: json as AcquisitionView };
    return { ok: false, status: response.status, message: json.message ?? json.reasons?.join("／") ?? json.error ?? `HTTP ${response.status}` };
  }

  /** GET /api/acquisitions/{requestId} — polls an acquisition started above. */
  async acquisitionStatus(requestId: string): Promise<AcquisitionView> {
    const response = await fetch(`/api/acquisitions/${encodeURIComponent(requestId)}`, { cache: "no-store" });
    if (!response.ok) throw new Error(`Failed to poll acquisition ${requestId}: HTTP ${response.status}`);
    return (await response.json()) as AcquisitionView;
  }

  /** GET /api/devnet/transfer/{requestId} — polls a transfer started above. */
  async devnetTransferStatus(requestId: string): Promise<DevnetTransferResult> {
    const response = await fetch(`/api/devnet/transfer/${encodeURIComponent(requestId)}`);
    if (!response.ok) {
      throw new Error(`Failed to poll devnet transfer ${requestId}: HTTP ${response.status}`);
    }
    return (await response.json()) as DevnetTransferResult;
  }
}
