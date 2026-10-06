"use client";

/* eslint-disable @next/next/no-img-element -- card images are served by the NFT metadata host (arbitrary https hosts), so next/image's domain allowlist does not fit */
import { useState } from "react";
import type { TwinfoldAsset } from "../lib/contract";
import { cardUi } from "../lib/copy/pull";
import { gachaVerifyUrl } from "../lib/gacha/normalize";
import { useI18n } from "../lib/i18n";
import { explorerAddressUrl, explorerTxUrl, psaCertUrl, shortAddress } from "../lib/labels";

/**
 * Display card for a graded card asset. Badge: DEMO DATA (fixture) / DEVNET / MAINNET (read-only).
 * The image URL comes from the NFT metadata and is loaded in the browser at runtime.
 * The Passport part is split in three headings that are never mixed (docs/mvp.md section 6):
 *   Onchain fact           mint, owner, confirmed transfer signature
 *   Third-party claims     PSA grade / cert, Collector Crypt insured value / vault, the Pull memo + VRF link
 *   Collectibles AR interpretation  display formatting, source check, fetch time
 */
export function CardAssetCard({ asset, demo = false, fetchedAt }: { asset: TwinfoldAsset; demo?: boolean; fetchedAt?: string }) {
  const { t } = useI18n();
  const [failedUrl, setFailedUrl] = useState<string | null>(null);
  const url = asset.imageUrl ?? asset.display.imageUrl;
  const showImage = Boolean(url) && failedUrl !== url;
  const mainnet = !demo && asset.network === "mainnet";
  const badge = demo ? "DEMO DATA" : mainnet ? "MAINNET (read-only)" : "DEVNET";
  // Shown as a card by metadata shape only: not confirmed as Collector Crypt issued (see TwinfoldAsset.sourceVerified).
  const unverified = asset.sourceVerified === false;
  const claim = [asset.gradingCompany, asset.grade].filter(Boolean).join(" ");
  const psaUrl = demo ? undefined : psaCertUrl(asset.gradingCompany, asset.gradingId);
  // Only a signature the chain has confirmed is an onchain fact. A pending Pull is Collector Crypt's say-so.
  const pull = asset.provenance.filter((e) => e.kind === "transferred" && e.transaction);
  const confirmedTxs = pull.filter((e) => e.source === "onchain" && e.status === "confirmed");
  const pendingTxs = pull.filter((e) => !(e.source === "onchain" && e.status === "confirmed"));
  const txCell = (signature: string) => (demo ? signature : <a href={explorerTxUrl(signature, asset.network)} target="_blank" rel="noreferrer">{shortAddress(signature)}</a>);

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

      <section className="passportSection" aria-label={t(cardUi.factTitle)}>
        <h4>{t(cardUi.factTitle)}</h4>
        <dl className="slabFacts">
          <div>
            <dt>{t(cardUi.mint)}</dt>
            <dd>{demo ? asset.address : <a href={explorerAddressUrl(asset.address, asset.network)} target="_blank" rel="noreferrer">{shortAddress(asset.address)}</a>}</dd>
          </div>
          {asset.owner && (
            <div>
              <dt>{t(cardUi.owner)}</dt>
              <dd>{demo ? shortAddress(asset.owner) : <a href={explorerAddressUrl(asset.owner, asset.network)} target="_blank" rel="noreferrer">{shortAddress(asset.owner)}</a>}</dd>
            </div>
          )}
          {confirmedTxs.map((e) => (
            <div key={e.id}>
              <dt>{t(cardUi.transferSig)}</dt>
              <dd>{txCell(e.transaction as string)}</dd>
            </div>
          ))}
        </dl>
        <p className="slabClaimNote">{t(cardUi.factNote)}</p>
      </section>

      <section className="passportSection" aria-label={t(cardUi.claimsTitle)}>
        <h4>{t(cardUi.claimsTitle)}</h4>
        <dl className="slabFacts">
          {claim && <div><dt>{t(cardUi.grade)}</dt><dd>{claim}</dd></div>}
          {asset.gradingId && (
            <div>
              <dt>{t(cardUi.gradingId)}</dt>
              <dd>
                {asset.gradingId}
                {psaUrl && <> · <a href={psaUrl} target="_blank" rel="noreferrer">{t(cardUi.psaCert)}</a></>}
              </dd>
            </div>
          )}
          {asset.insuredValueUsd !== undefined && (
            <div>
              <dt>{t(cardUi.insured)} <small>({t(cardUi.insuredNote)})</small></dt>
              <dd>${asset.insuredValueUsd.toLocaleString("en-US")}</dd>
            </div>
          )}
          {asset.vault && <div><dt>{t(cardUi.vault)}</dt><dd>{asset.vault}</dd></div>}
          {asset.vaultId && <div><dt>{t(cardUi.vaultId)}</dt><dd>{asset.vaultId}</dd></div>}
          {asset.gachaMemo && (
            <div>
              <dt>{t(cardUi.memo)}</dt>
              <dd className="slabMemo">
                {asset.gachaMemo}
                {!demo && <> · <a href={gachaVerifyUrl(asset.gachaMemo)} target="_blank" rel="noreferrer">{t(cardUi.verify)}</a></>}
              </dd>
            </div>
          )}
          {pendingTxs.map((e) => (
            <div key={e.id}>
              <dt>{t(cardUi.transferPending)}</dt>
              <dd>{txCell(e.transaction as string)}</dd>
            </div>
          ))}
        </dl>
        <p className="slabClaimNote">{t(cardUi.claimsNote)}</p>
      </section>

      <section className="passportSection" aria-label={t(cardUi.interpTitle)}>
        <h4>{t(cardUi.interpTitle)}</h4>
        <dl className="slabFacts">
          {asset.sourceVerified === true && <div><dt>{t(asset.gachaMemo ? cardUi.sourceFromPull : cardUi.sourceMatched)}</dt><dd>OK</dd></div>}
          {fetchedAt && <div><dt>{t(cardUi.fetchedAt)}</dt><dd>{fetchedAt}</dd></div>}
        </dl>
        {unverified && <p className="slabClaimNote">{t(cardUi.unverifiedNote)}</p>}
        <p className="slabClaimNote">{t(cardUi.interpNote)}</p>
      </section>
    </article>
  );
}
