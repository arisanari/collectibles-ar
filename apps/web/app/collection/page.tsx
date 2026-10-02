"use client";

import Link from "next/link";
import { useEffect, useState } from "react";
import { MockAssetProvider } from "../../lib/providers/mockAssetProvider";
import { SolanaAssetProvider } from "../../lib/providers/solanaAssetProvider";
import type { TwinfoldAsset } from "../../lib/contract";
import type { AuthStatus } from "../../lib/auth/useWalletAuth";
import { shortAddress } from "../../lib/labels";
import { AssetCard } from "../../components/AssetCard";
import { useAuth } from "../../components/AuthProvider";
import { DeviceLinkPanel } from "../../components/DeviceLinkPanel";
import { PendingRequestsPanel } from "../../components/PendingRequestsPanel";
import { OwnershipSection } from "../../components/OwnershipSection";
import { RedemptionPanel } from "../../components/RedemptionPanel";
import { useRedemptions } from "../../lib/redemptions/useRedemptions";
import { useTransferRequests } from "../../lib/transferRequests/useTransferRequests";
import walletsFixture from "../../lib/fixtures/demo/wallets.json";

const demoWallet = (walletsFixture as Record<string, { label: string; address: string }>).walletA;
const mockProvider = new MockAssetProvider();
const solanaProvider = new SolanaAssetProvider();

const authLabel: Record<AuthStatus, string> = {
  disconnected: "未接続",
  connecting: "接続中…",
  awaiting_signature: "Phantomで署名してください（費用なし・送金なし）",
  authenticated: "認証済み",
  rejected: "署名が拒否されました",
  expired: "有効期限切れ",
  switched: "ウォレットが切り替わりました",
  no_wallet: "Phantomが見つかりません",
  error: "認証エラー",
};

type Result = { key: string; assets: TwinfoldAsset[]; failed: boolean };

export default function CollectionPage() {
  const auth = useAuth();
  const authedWallet = auth.status === "authenticated" ? auth.wallet : null;
  const tr = useTransferRequests(authedWallet);
  const rd = useRedemptions(authedWallet, tr.refresh);
  // Reload the asset cards whenever a redemption changes state (a locked Asset leaves this wallet).
  const redemptionSignature = rd.redemptions.map((r) => `${r.id}:${r.status}`).join(",");
  const [demoOn, setDemoOn] = useState(false);
  const [result, setResult] = useState<Result | null>(null);

  // Authenticated devnet view takes precedence over the fixture view.
  const demo = !authedWallet && demoOn;
  const key = authedWallet ? `devnet:${authedWallet}` : demo ? "demo" : null;

  useEffect(() => {
    if (!key) return;
    let cancelled = false;
    const load = authedWallet ? solanaProvider.getAssets(authedWallet) : mockProvider.getAssets(demoWallet.address);
    load
      .then((assets) => {
        if (!cancelled) setResult({ key, assets, failed: false });
      })
      .catch(() => {
        if (!cancelled) setResult({ key, assets: [], failed: true });
      });
    return () => {
      cancelled = true;
    };
  }, [key, authedWallet, redemptionSignature]);

  const current = key && result?.key === key ? result : null;
  const status = !key ? "idle" : !current ? "loading" : current.failed ? "error" : "ready";
  const assets = current?.assets ?? [];
  const busy = auth.status === "connecting" || auth.status === "awaiting_signature";
  const retry = ["rejected", "expired", "switched", "error"].includes(auth.status);

  if (!key) {
    return (
      <main className="shell collectionPage">
        {/* Rendered during SSR too (so the prompt is in the HTML); hidden until the session check finishes to avoid a flash for signed-in users. */}
        <section className={`connectPrompt${auth.sessionChecked ? "" : " pending"}`} aria-busy={!auth.sessionChecked}>
          <div className="eyebrow">YOUR ARCHIVE</div>
          <h1>My collection</h1>
          <p className="emptyState small">
            Phantom（devnet）で署名すると、あなたのウォレットが所有するAssetが表示されます。署名は無料で、送金は行われません。
          </p>
          <p className="authLine">状態: {authLabel[auth.status]}</p>
          {auth.detail && <p className="emptyState small" role="alert">{auth.detail}</p>}
          <button className="primary" disabled={busy} onClick={() => void auth.connect()}>
            {retry ? "Retry sign-in" : "Connect Phantom"}
          </button>
          <button className="demoToggle" onClick={() => setDemoOn(true)} title="Fixtureのデモウォレット（Solanaには接続しません）">
            DEMO DATAで試す
          </button>
        </section>
      </main>
    );
  }

  const addr = authedWallet ?? demoWallet.address;

  return (
    <main className="shell collectionPage">
      <section className="collectionTop">
        <div>
          <div className="eyebrow">YOUR ARCHIVE</div>
          <h1>My collection</h1>
          <p className="collectionWallet">
            <span className="statusDot" />{shortAddress(addr)} <span className="demoBadge">{demo ? "DEMO DATA" : "DEVNET"}</span>
          </p>
          {demo && (
            <p className="emptyState small">
              fixtureのデモウォレット（Solanaには接続していません）の表示です。
              <button className="textButton inline" onClick={() => setDemoOn(false)}>DEMO DATAをやめる</button>
            </p>
          )}
        </div>
        <div className="collectionStat">
          <strong>{status === "ready" ? assets.length.toString().padStart(2, "0") : "--"}</strong>
          <span>{demo ? "DEMO DATA Asset" : "devnet Asset"}</span>
        </div>
      </section>

      {authedWallet && <PendingRequestsPanel tr={tr} />}
      {authedWallet && <RedemptionPanel rd={rd} />}
      {authedWallet && <DeviceLinkPanel />}

      {status === "loading" && <p className="emptyState">読み込み中…</p>}
      {status === "error" && <p className="emptyState" role="alert">所有Assetの取得に失敗しました。時間をおいて再読み込みしてください。</p>}
      {status === "ready" && assets.length === 0 && (
        <div className="emptyState">
          <p>このウォレットが所有するdevnet Assetはありません</p>
          <Link href="/" className="secondary linkButton">Discoverへ戻る</Link>
        </div>
      )}
      {status === "ready" && assets.length > 0 && (
        <div className="grid devnetGrid collectionGrid">
          {assets.map((asset) => (
            <div key={asset.id} className="collectionCell">
              <AssetCard asset={asset} demo={demo} showCommerce />
              {authedWallet && asset.physical?.custody.status === "vaulted" && <OwnershipSection asset={asset} rd={rd} />}
              {authedWallet && asset.commerce && !asset.redemption?.open && (
                <button
                  className="secondary sellButton"
                  onClick={() => void tr.createBuyback(asset.id)}
                  title="依頼を作成し、そのままPhantomで署名します（devnet・支払いなし）"
                >
                  Twinfoldに売る（Phantomで承認）
                </button>
              )}
            </div>
          ))}
        </div>
      )}
    </main>
  );
}
