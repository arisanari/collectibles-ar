"use client";

import Image from "next/image";
import type { TwinfoldAsset } from "../lib/contract";
import { custodyText, detail, devnetFeature } from "../lib/copy/landing";
import { displayTitle } from "../lib/displayTitle";
import { useI18n } from "../lib/i18n";
import { explorerAddressUrl, shortAddress } from "../lib/labels";
import { PhysicalDetails } from "./PhysicalDetails";
import { ProvenanceList } from "./ProvenanceList";

const TIMELINE_LIMIT = 4;

/** Landing only: one slide of "Live on Solana" (large image, three facts, provenance timeline). */
export function OnchainFeature({ asset }: { asset: TwinfoldAsset }) {
  const { lang, t } = useI18n();
  const title = displayTitle(asset, lang);
  const custody = asset.physical?.custody.status;

  return (
    <article className="onchainFeature">
      <div className="cardImage featureImage">
        {asset.display.imageUrl ? (
          <Image className="contain" src={asset.display.imageUrl} alt={title} fill sizes="(max-width: 900px) 100vw, 600px" />
        ) : (
          <span className="featureNoImage">{t(devnetFeature.noImage)}</span>
        )}
      </div>
      <div className="featureBody">
        <div className="eyebrow featureLabel">
          {t(devnetFeature.label)}
          {asset.rehearsal && <span className="demoBadge rehearsalBadge" title={t(devnetFeature.rehearsalTitle)}>REHEARSAL</span>}
        </div>
        <h3>{title}</h3>
        <dl className="featureFacts">
          <div>
            <dt>{t(devnetFeature.owner)}</dt>
            <dd>
              {asset.owner ? (
                <a href={explorerAddressUrl(asset.owner)} target="_blank" rel="noreferrer" title={asset.owner}>{shortAddress(asset.owner)} ↗</a>
              ) : (
                t(detail.unowned)
              )}
            </dd>
          </div>
          <div>
            <dt>{t(devnetFeature.custody)}</dt>
            <dd>{custody ? t(custodyText[custody]) : "—"}</dd>
          </div>
          <div>
            <dt>{t(devnetFeature.asset)}</dt>
            <dd>
              <a href={explorerAddressUrl(asset.address)} target="_blank" rel="noreferrer" title={asset.address}>{shortAddress(asset.address)} ↗</a>
            </dd>
          </div>
        </dl>
        <div className="eyebrow">{t(detail.provenance)}</div>
        <ProvenanceList asset={asset} demo={false} limit={TIMELINE_LIMIT} variant="timeline" />
        <PhysicalDetails asset={asset} demo={false} />
      </div>
    </article>
  );
}
