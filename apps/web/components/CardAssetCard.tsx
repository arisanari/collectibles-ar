"use client";

/* eslint-disable @next/next/no-img-element -- card images are served by the NFT metadata host (arbitrary https hosts), so next/image's domain allowlist does not fit */
import { useState } from "react";
import type { TwinfoldAsset } from "../lib/contract";
import { cardUi } from "../lib/copy/pull";
import { gachaVerifyUrl } from "../lib/gacha/normalize";
import { useI18n } from "../lib/i18n";
import { explorerAddressUrl, shortAddress } from "../lib/labels";

/**
 * Display card for a graded card asset. Badge: DEMO DATA (fixture) / DEVNET / MAINNET (read-only).
 * The image URL comes from the NFT metadata and is loaded in the browser at runtime.
 * Grade, grading id, insured value and vault are third-party claims and are labelled as such.
 */
export function CardAssetCard({ asset, demo = false }: { asset: TwinfoldAsset; demo?: boolean }) {
  const { t } = useI18n();
  const [failedUrl, setFailedUrl] = useState<string | null>(null);
  const url = asset.imageUrl ?? asset.display.imageUrl;
  const showImage = Boolean(url) && failedUrl !== url;
  const badge = demo ? "DEMO DATA" : asset.network === "mainnet" ? "MAINNET (read-only)" : "DEVNET";
  // Shown as a card by metadata shape only: not confirmed as Collector Crypt issued (see TwinfoldAsset.sourceVerified).
  const unverified = asset.sourceVerified === false;
  const claim = [asset.gradingCompany, asset.grade].filter(Boolean).join(" ");

  return (
    <article className="devnetCard slabCard">
      <div className="slabTop">
        <div className="slabImage">
          {showImage ? (
            <img src={url} alt={asset.title} onError={() => setFailedUrl(url)} loading="lazy" />
          ) : (
            <span className="featureNoImage">{t(cardUi.noImage)}</span>
          )}
        </div>
        <span className="slabBadges">
          <span className="demoBadge">{badge}</span>
          {unverified && <span className="demoBadge unverifiedBadge">{t(cardUi.unverifiedBadge)}</span>}
        </span>
      </div>
      <h3>{asset.title}</h3>
      <dl className="slabFacts">
        {claim && <div><dt>{t(cardUi.grade)}</dt><dd>{claim}</dd></div>}
        {asset.gradingId && <div><dt>{t(cardUi.gradingId)}</dt><dd>{asset.gradingId}</dd></div>}
        {asset.insuredValueUsd !== undefined && (
          <div>
            <dt>{t(cardUi.insured)} <small>({t(cardUi.insuredNote)})</small></dt>
            <dd>${asset.insuredValueUsd.toLocaleString("en-US")}</dd>
          </div>
        )}
        {asset.vault && <div><dt>{t(cardUi.vault)}</dt><dd>{asset.vault}</dd></div>}
        {asset.vaultId && <div><dt>{t(cardUi.vaultId)}</dt><dd>{asset.vaultId}</dd></div>}
        <div>
          <dt>{t(cardUi.mint)}</dt>
          <dd>{demo ? asset.address : <a href={explorerAddressUrl(asset.address)} target="_blank" rel="noreferrer">{shortAddress(asset.address)}</a>}</dd>
        </div>
        {asset.owner && <div><dt>{t(cardUi.owner)}</dt><dd>{shortAddress(asset.owner)}</dd></div>}
        {asset.gachaMemo && (
          <div>
            <dt>{t(cardUi.memo)}</dt>
            <dd className="slabMemo">
              {asset.gachaMemo}
              {!demo && <> · <a href={gachaVerifyUrl(asset.gachaMemo)} target="_blank" rel="noreferrer">{t(cardUi.verify)}</a></>}
            </dd>
          </div>
        )}
      </dl>
      {unverified && <p className="slabClaimNote">{t(cardUi.unverifiedNote)}</p>}
      <p className="slabClaimNote">{t(cardUi.claimNote)}</p>
    </article>
  );
}
