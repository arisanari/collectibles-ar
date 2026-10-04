"use client";

import Image from "next/image";
import type { TwinfoldAsset } from "../lib/contract";
import { assetCardUi, custodyText } from "../lib/copy/landing";
import { displayTitle } from "../lib/displayTitle";
import { useI18n } from "../lib/i18n";
import { explorerAddressUrl, shortAddress } from "../lib/labels";
import { PhysicalDetails } from "./PhysicalDetails";
import { ProvenanceList } from "./ProvenanceList";

/**
 * Display-only card for a devnet (or, with `demo`, fixture) asset. No owner actions.
 * `hideNetworkBadge`: the page already labels the whole list (DEMO DATA / DEVNET) in its heading.
 */
export function AssetCard({
  asset,
  demo = false,
  showCommerce = false,
  hideNetworkBadge = false,
}: {
  asset: TwinfoldAsset;
  demo?: boolean;
  showCommerce?: boolean;
  hideNetworkBadge?: boolean;
}) {
  const { lang, t } = useI18n();
  const title = displayTitle(asset, lang);
  const custody = asset.physical?.custody.status;
  const commerce = asset.commerce;
  const offer = commerce ? Math.round(commerce.twinfoldPrice.amount * commerce.buybackRate * 100) / 100 : 0;
  const showTop = Boolean(asset.display.imageUrl) || asset.rehearsal || !hideNetworkBadge;

  return (
    <article className="devnetCard">
      {showTop && (
        <div className="assetCardTop">
          {asset.display.imageUrl && (
            <div className="devnetCardThumb">
              <Image src={asset.display.imageUrl} alt={title} width={96} height={120} className="thumbImg" />
            </div>
          )}
          <span className="badgeRow">
            {asset.rehearsal && <span className="demoBadge rehearsalBadge" title={t(assetCardUi.rehearsalTitle)}>REHEARSAL</span>}
            {!hideNetworkBadge && <span className="demoBadge">{demo ? "DEMO DATA" : "DEVNET"}</span>}
          </span>
        </div>
      )}
      <div className="cardMeta">
        <span>{demo ? t(assetCardUi.demo) : `${asset.standard} · ${asset.network}`}</span>
        <span>{asset.owner ? shortAddress(asset.owner) : t(assetCardUi.unowned)}</span>
      </div>
      <h3>{title}</h3>
      <p className="workName">
        {demo ? asset.address : <a href={explorerAddressUrl(asset.address)} target="_blank" rel="noreferrer">{asset.address}</a>}
      </p>
      <p className="custodyLine">
        <span className="eyebrow">{t(assetCardUi.custody)}</span> {custody ? t(custodyText[custody]) : "—"}
      </p>
      <PhysicalDetails asset={asset} demo={demo} />
      {showCommerce && commerce && (
        <div className="offerBox">
          <div className="eyebrow">{t(assetCardUi.offerHeading)}</div>
          <dl>
            <div><dt>{t(assetCardUi.price)}</dt><dd>{commerce.twinfoldPrice.amount.toLocaleString("en-US")} {commerce.twinfoldPrice.currency}</dd></div>
            <div>
              <dt>{t(assetCardUi.buyback(Math.round(commerce.buybackRate * 100)))}</dt>
              <dd>{commerce.buybackEligible ? `${offer.toLocaleString("en-US")} ${commerce.twinfoldPrice.currency}` : t(assetCardUi.notEligible)}</dd>
            </div>
          </dl>
          <p className="offerNote">
            {t(assetCardUi.offerNote)}
            {demo || commerce.priceNote ? t(assetCardUi.offerNotePlaceholder) : ""}
          </p>
        </div>
      )}
      <div className="eyebrow">{t(assetCardUi.provenance)}</div>
      <ProvenanceList asset={asset} demo={demo} limit={2} />
    </article>
  );
}
