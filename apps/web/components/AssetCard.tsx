"use client";

import Image from "next/image";
import type { TwinfoldAsset } from "../lib/contract";
import { displayTitle } from "../lib/displayTitle";
import { custodyStatusLabel, explorerAddressUrl, shortAddress } from "../lib/labels";
import { useLang } from "../lib/useLang";
import { PhysicalDetails } from "./PhysicalDetails";
import { ProvenanceList } from "./ProvenanceList";

/** Display-only card for a devnet (or, with `demo`, fixture) asset. No owner actions. */
export function AssetCard({ asset, demo = false, showCommerce = false }: { asset: TwinfoldAsset; demo?: boolean; showCommerce?: boolean }) {
  const lang = useLang();
  const title = displayTitle(asset, lang);
  const custody = asset.physical?.custody.status;
  const commerce = asset.commerce;
  const offer = commerce ? Math.round(commerce.twinfoldPrice.amount * commerce.buybackRate * 100) / 100 : 0;

  return (
    <article className="devnetCard">
      <div className="assetCardTop">
        {asset.display.imageUrl && (
          <div className="devnetCardThumb">
            <Image src={asset.display.imageUrl} alt={title} width={96} height={120} className="thumbImg" />
          </div>
        )}
        <span className="badgeRow">
          {asset.rehearsal && <span className="demoBadge rehearsalBadge" title="redeem dry run用のリハーサルToken。Reference Assetではありません">REHEARSAL</span>}
          <span className="demoBadge">{demo ? "DEMO DATA" : "DEVNET"}</span>
        </span>
      </div>
      <div className="cardMeta">
        <span>{demo ? "FIXTURE · NOT ON CHAIN" : `${asset.standard} · ${asset.network}`}</span>
        <span>{asset.owner ? shortAddress(asset.owner) : "unowned"}</span>
      </div>
      <h3>{title}</h3>
      <p className="workName">
        {demo ? asset.address : <a href={explorerAddressUrl(asset.address)} target="_blank" rel="noreferrer">{asset.address}</a>}
      </p>
      <p className="custodyLine">
        <span className="eyebrow">CUSTODY</span> {custody ? custodyStatusLabel[custody] : "—"}
      </p>
      <PhysicalDetails asset={asset} demo={demo} />
      {showCommerce && commerce && (
        <div className="offerBox">
          <div className="eyebrow">TWINFOLD PRICE / BUYBACK OFFER</div>
          <dl>
            <div><dt>Twinfold price</dt><dd>{commerce.twinfoldPrice.amount.toLocaleString("en-US")} {commerce.twinfoldPrice.currency}</dd></div>
            <div>
              <dt>Buyback offer（{Math.round(commerce.buybackRate * 100)}%）</dt>
              <dd>{commerce.buybackEligible ? `${offer.toLocaleString("en-US")} ${commerce.twinfoldPrice.currency}` : "対象外"}</dd>
            </div>
          </dl>
          <p className="offerNote">
            買取額はTwinfoldが提示するオファーであり、買取や価格を保証するものではありません。devnetでは実際の支払いは発生しません。
            {demo || commerce.priceNote ? " 価格はデモ用の仮の値です" : ""}
          </p>
        </div>
      )}
      <div className="eyebrow">PROVENANCE</div>
      <ProvenanceList asset={asset} demo={demo} />
    </article>
  );
}
