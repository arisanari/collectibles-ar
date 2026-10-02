"use client";

import Image from "next/image";
import Link from "next/link";
import { useCallback, useEffect, useRef, useState } from "react";
import type { AcquisitionView, TwinfoldAsset } from "../lib/contract";
import { displayTitle } from "../lib/displayTitle";
import { custodyStatusLabel, explorerAddressUrl, explorerTxUrl } from "../lib/labels";
import { SolanaAssetProvider } from "../lib/providers/solanaAssetProvider";
import { useLang } from "../lib/useLang";
import { useAuth } from "./AuthProvider";
import { ProvenanceList } from "./ProvenanceList";

const provider = new SolanaAssetProvider();
const POLL_MS = 3000;

const priceText = (asset: TwinfoldAsset) =>
  asset.commerce ? `${asset.commerce.twinfoldPrice.amount.toLocaleString("en-US")} ${asset.commerce.twinfoldPrice.currency}` : "";

/** Thumbnail, title, custody, price and the button first; provenance collapsed below. */
function VaultCard({ asset, authed, onAcquire }: { asset: TwinfoldAsset; authed: boolean; onAcquire: () => void }) {
  const lang = useLang();
  const [showProvenance, setShowProvenance] = useState(false);
  const title = displayTitle(asset, lang);
  const custody = asset.physical?.custody.status;
  return (
    <article className="devnetCard vaultCard">
      <div className="vaultCardTop">
        <div className="vaultThumb">
          {asset.display.imageUrl ? (
            <Image src={asset.display.imageUrl} alt={title} fill sizes="140px" priority className="thumbImg" />
          ) : (
            <span className="emptyState small">画像なし</span>
          )}
        </div>
        <div className="vaultCardInfo">
          <span className="demoBadge">DEVNET</span>
          <h3>{title}</h3>
          <p className="custodyLine"><span className="eyebrow">CUSTODY</span> {custody ? custodyStatusLabel[custody] : "—"}</p>
          <p className="workName"><a href={explorerAddressUrl(asset.address)} target="_blank" rel="noreferrer">{asset.address}</a></p>
          <p className="vaultPrice">{priceText(asset)} <small>表示のみ・デモ用の仮の値</small></p>
          <button className="primary" onClick={onAcquire}>
            {authed ? "取得する" : "Connect Phantomして取得"}
          </button>
        </div>
      </div>
      <button className="textButton" aria-expanded={showProvenance} onClick={() => setShowProvenance((v) => !v)}>
        {showProvenance ? "来歴を閉じる" : "来歴を見る"}
      </button>
      {showProvenance && <ProvenanceList asset={asset} demo={false} />}
    </article>
  );
}

/**
 * 「Twinfoldから取得できる作品」: Assets the Twinfold vault wallet holds on devnet.
 * Acquisition = the vault wallet signs a devnet transfer to the signed-in wallet. No payment;
 * the price is Twinfold's off-chain display value (demo placeholder). The Asset's physical
 * original stays in Twinfold's Vault.
 */
export function VaultAcquisitionSection() {
  const auth = useAuth();
  const lang = useLang();
  const [assets, setAssets] = useState<TwinfoldAsset[] | null>(null);
  const [failed, setFailed] = useState("");
  const [dialog, setDialog] = useState<TwinfoldAsset | null>(null);
  const [acq, setAcq] = useState<AcquisitionView | null>(null);
  const [message, setMessage] = useState("");
  const [busy, setBusy] = useState(false);
  const requestIdRef = useRef<string | null>(null);

  const load = useCallback(() => {
    provider
      .getVaultAssets()
      .then((list) => {
        setAssets(list);
        setFailed("");
      })
      .catch((error) => setFailed(error instanceof Error ? error.message : "取得に失敗しました"));
  }, []);

  useEffect(() => {
    const first = setTimeout(load, 0);
    return () => clearTimeout(first);
  }, [load]);

  // Poll the acquisition until it is terminal.
  const watching = acq && (acq.status === "pending" || acq.status === "submitted") ? acq.requestId : null;
  useEffect(() => {
    if (!watching) return;
    const t = setInterval(() => {
      provider.acquisitionStatus(watching).then(setAcq).catch(() => undefined);
    }, POLL_MS);
    return () => clearInterval(t);
  }, [watching]);
  useEffect(() => {
    if (acq?.status === "confirmed") {
      const t = setTimeout(load, 0); // the Asset leaves the vault list
      return () => clearTimeout(t);
    }
  }, [acq?.status, load]);

  function open(asset: TwinfoldAsset) {
    if (auth.status !== "authenticated") {
      void auth.connect();
      return;
    }
    requestIdRef.current = crypto.randomUUID();
    setAcq(null);
    setMessage("");
    setDialog(asset);
  }

  async function confirm() {
    if (!dialog || !requestIdRef.current || busy) return;
    setBusy(true);
    setMessage("");
    try {
      const result = await provider.acquire(requestIdRef.current, dialog.id);
      if (result.view) setAcq(result.view);
      if (!result.ok) setMessage(result.view?.error ?? result.message ?? "取得できませんでした");
    } catch {
      setMessage("取得を開始できませんでした。ネットワークを確認してください");
    } finally {
      setBusy(false);
    }
  }

  function close() {
    setDialog(null);
    setAcq(null);
    setMessage("");
  }

  const authed = auth.status === "authenticated";
  const inProgress = acq?.status === "pending" || acq?.status === "submitted";

  return (
    <section className="works shell devnetSection" id="vault-assets">
      <div className="sectionTitle">
        <div>
          <span>SOLANA DEVNET · TWINFOLD VAULT</span>
          <h2>Twinfoldから取得できる作品</h2>
        </div>
        <p className="demoBadge">DEVNET</p>
      </div>
      <p className="emptyState small">
        TwinfoldのVault walletが保有するAssetを、あなたのwalletへdevnet上で取得します。支払いは行われません。価格は表示のみ（デモ用の仮の値）で、現物はTwinfoldのVaultに保管されたままです。
        {!authed && " 取得にはPhantomでの接続（署名のみ・送金なし）が必要です。"}
      </p>
      {assets === null && !failed && <p className="emptyState">読み込み中…</p>}
      {failed && assets === null && <p className="emptyState" role="alert">Vault保有Assetの取得に失敗しました: {failed}</p>}
      {assets !== null && assets.length === 0 && <p className="emptyState">いま取得できる作品はありません</p>}
      {assets !== null && assets.length > 0 && (
        <div className="grid devnetGrid">
          {assets.map((asset) => (
            <VaultCard key={asset.id} asset={asset} authed={authed} onAcquire={() => open(asset)} />
          ))}
        </div>
      )}

      {dialog && (
        <div className="overlay" onMouseDown={() => !inProgress && close()}>
          <section className="confirmBox" role="dialog" aria-modal="true" aria-labelledby="acqTitle" onMouseDown={(e) => e.stopPropagation()}>
            <div className="eyebrow">DEVNET · 取得</div>
            <h2 id="acqTitle">{displayTitle(dialog, lang)}</h2>
            <p className="workName">表示価格 {priceText(dialog)}（Twinfoldの表示値・デモ用の仮の値）</p>
            <ul className="confirmList">
              <li>devnet上の取得であり、支払いは行われません。</li>
              <li>価格は表示のみです（デモ用の仮の値）。</li>
              <li>現物はTwinfoldのVaultに保管されたままです。</li>
            </ul>
            {!acq && (
              <div className="linkActions">
                <button className="primary" disabled={busy} onClick={() => void confirm()}>
                  {busy ? "処理中…" : "取得する"}
                </button>
                <button className="secondary" disabled={busy} onClick={close}>キャンセル</button>
              </div>
            )}
            {message && <p className="emptyState small" role="alert">{message}</p>}
            {inProgress && <p className="emptyState small" aria-live="polite">{acq?.status === "pending" ? "送信中…" : "送信済み・devnetで確定待ち…"}</p>}
            {acq?.status === "confirmed" && (
              <>
                <p className="emptyState small" role="status">
                  確定しました（confirmed）。
                  {acq.signature && <> <a href={explorerTxUrl(acq.signature)} target="_blank" rel="noreferrer">Explorerで確認（devnet）</a></>}
                </p>
                <div className="linkActions">
                  <Link href="/collection" className="primary linkButton">My collectionで見る</Link>
                  <button className="secondary" onClick={close}>閉じる</button>
                </div>
              </>
            )}
            {acq?.status === "failed" && (
              <div className="linkActions">
                <button className="secondary" onClick={close}>閉じる</button>
              </div>
            )}
          </section>
        </div>
      )}
    </section>
  );
}
