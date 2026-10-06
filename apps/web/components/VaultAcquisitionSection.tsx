"use client";

import Image from "next/image";
import Link from "next/link";
import { useCallback, useEffect, useRef, useState } from "react";
import type { AcquisitionView, TwinfoldAsset } from "../lib/contract";
import { custodyText, vault } from "../lib/copy/landing";
import { displayTitle } from "../lib/displayTitle";
import { useI18n } from "../lib/i18n";
import { explorerAddressUrl, explorerTxUrl } from "../lib/labels";
import { SolanaAssetProvider } from "../lib/providers/solanaAssetProvider";
import { useAuth } from "./AuthProvider";
import { Carousel } from "./Carousel";
import { ProvenanceList } from "./ProvenanceList";

const provider = new SolanaAssetProvider();
const POLL_MS = 3000;

const priceText = (asset: TwinfoldAsset) =>
  asset.commerce ? `${asset.commerce.twinfoldPrice.amount.toLocaleString("en-US")} ${asset.commerce.twinfoldPrice.currency}` : "";

/** Thumbnail, title, custody, price and the button first; provenance collapsed below. */
function VaultCard({ asset, authed, onAcquire }: { asset: TwinfoldAsset; authed: boolean; onAcquire: () => void }) {
  const { lang, t } = useI18n();
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
            <span className="emptyState small">{t(vault.noImage)}</span>
          )}
        </div>
        <div className="vaultCardInfo">
          <h3>{title}</h3>
          <p className="custodyLine"><span className="eyebrow">{t(vault.custody)}</span> {custody ? t(custodyText[custody]) : "—"}</p>
          <p className="workName"><a href={explorerAddressUrl(asset.address)} target="_blank" rel="noreferrer">{asset.address}</a></p>
          <p className="vaultPrice">{priceText(asset)} <small>{t(vault.priceNote)}</small></p>
          <button className="primary" onClick={onAcquire}>
            {authed ? t(vault.acquire) : t(vault.connectToAcquire)}
          </button>
        </div>
      </div>
      <button className="textButton" aria-expanded={showProvenance} onClick={() => setShowProvenance((v) => !v)}>
        {showProvenance ? t(vault.hideProvenance) : t(vault.showProvenance)}
      </button>
      {showProvenance && <ProvenanceList asset={asset} demo={false} />}
    </article>
  );
}

/**
 * "Available from SlabAR": Assets the SlabAR vault wallet holds on devnet.
 * Acquisition = the vault wallet signs a devnet transfer to the signed-in wallet. No payment;
 * the price is SlabAR's off-chain display value (demo placeholder). The Asset's physical
 * original stays in SlabAR's Vault.
 */
export function VaultAcquisitionSection() {
  const auth = useAuth();
  const { lang, t } = useI18n();
  const [assets, setAssets] = useState<TwinfoldAsset[] | null>(null);
  const [failed, setFailed] = useState(false);
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
        setFailed(false);
      })
      .catch((error) => {
        console.warn("Vault assets failed to load", error);
        setFailed(true);
      });
  }, []);

  useEffect(() => {
    const first = setTimeout(load, 0);
    return () => clearTimeout(first);
  }, [load]);

  // Poll the acquisition until it is terminal.
  const watching = acq && (acq.status === "pending" || acq.status === "submitted") ? acq.requestId : null;
  useEffect(() => {
    if (!watching) return;
    const timer = setInterval(() => {
      provider.acquisitionStatus(watching).then(setAcq).catch(() => undefined);
    }, POLL_MS);
    return () => clearInterval(timer);
  }, [watching]);
  useEffect(() => {
    if (acq?.status === "confirmed") {
      const timer = setTimeout(load, 0); // the Asset leaves the vault list
      return () => clearTimeout(timer);
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
      if (!result.ok) setMessage(result.view?.error ?? result.message ?? t(vault.notAcquired));
    } catch {
      setMessage(t(vault.networkError));
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
      <Carousel
        label={t(vault.heading)}
        header={(
          <div>
            <span>{t(vault.eyebrow)}</span>
            <h2>{t(vault.heading)}</h2>
          </div>
        )}
        badge={<span className="demoBadge">DEVNET</span>}
        intro={<p className="emptyState small">{t(vault.note)}</p>}
        placeholder={
          assets === null ? (
            failed ? <p className="emptyState" role="alert">{t(vault.failed)}</p> : <p className="emptyState">{t(vault.loading)}</p>
          ) : assets.length === 0 ? (
            <p className="emptyState">{t(vault.empty)}</p>
          ) : undefined
        }
      >
        {assets?.map((asset) => (
          <VaultCard key={asset.id} asset={asset} authed={authed} onAcquire={() => open(asset)} />
        ))}
      </Carousel>

      {dialog && (
        <div className="overlay" onMouseDown={() => !inProgress && close()}>
          <section className="confirmBox" role="dialog" aria-modal="true" aria-labelledby="acqTitle" onMouseDown={(e) => e.stopPropagation()}>
            <div className="eyebrow">{t(vault.dialogEyebrow)}</div>
            <h2 id="acqTitle">{displayTitle(dialog, lang)}</h2>
            <p className="workName">{t(vault.dialogPrice(priceText(dialog)))}</p>
            <ul className="confirmList">
              {vault.confirmItems.map((item) => (
                <li key={item.en}>{t(item)}</li>
              ))}
            </ul>
            {!acq && (
              <div className="linkActions">
                <button className="primary" disabled={busy} onClick={() => void confirm()}>
                  {busy ? t(vault.processing) : t(vault.acquire)}
                </button>
                <button className="secondary" disabled={busy} onClick={close}>{t(vault.cancel)}</button>
              </div>
            )}
            {message && <p className="emptyState small" role="alert">{message}</p>}
            {inProgress && <p className="emptyState small" aria-live="polite">{acq?.status === "pending" ? t(vault.sending) : t(vault.waiting)}</p>}
            {acq?.status === "confirmed" && (
              <>
                <p className="emptyState small" role="status">
                  {t(vault.confirmed)}
                  {acq.signature && <> <a href={explorerTxUrl(acq.signature)} target="_blank" rel="noreferrer">{t(vault.explorer)}</a></>}
                </p>
                <div className="linkActions">
                  <Link href="/collection" className="primary linkButton">{t(vault.viewCollection)}</Link>
                  <button className="secondary" onClick={close}>{t(vault.close)}</button>
                </div>
              </>
            )}
            {acq?.status === "failed" && (
              <div className="linkActions">
                <button className="secondary" onClick={close}>{t(vault.close)}</button>
              </div>
            )}
          </section>
        </div>
      )}
    </section>
  );
}
