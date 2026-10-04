"use client";

import type { TwinfoldAsset } from "../lib/contract";
import { custodyText, physicalUi, sourceText } from "../lib/copy/landing";
import { useI18n } from "../lib/i18n";
import { explorerAddressUrl } from "../lib/labels";

/**
 * Physical layer of an Asset (Issue #22): physical ID, condition, rights, custody, last verified and the
 * Asset address, each with its source label. The address is an onchain fact; the rest are OshiPin's
 * off-chain records (evidence or interpretation). None of this is an authenticity or condition guarantee.
 * Condition, rights and the other values are asset data and shown as recorded.
 */
export function PhysicalDetails({ asset, demo, open = false }: { asset: TwinfoldAsset; demo: boolean; open?: boolean }) {
  const { t } = useI18n();
  const physical = asset.physical;
  if (!physical) return null;
  return (
    <details className="physicalDetails" open={open}>
      <summary>{t(physicalUi.summary)}</summary>
      <dl>
        <div>
          <dt>{t(physicalUi.physicalId)}<small>{t(sourceText.offchain_evidence)}</small></dt>
          <dd>{physical.physicalId}</dd>
        </div>
        <div>
          <dt>{t(physicalUi.assetAddress)}<small>{t(sourceText.onchain)}</small></dt>
          <dd className="breakAll">
            {demo ? asset.address : <a href={explorerAddressUrl(asset.address)} target="_blank" rel="noreferrer">{asset.address}</a>}
          </dd>
        </div>
        <div>
          <dt>{t(physicalUi.condition)}<small>{t(sourceText.twinfold_interpretation)} ({t(physicalUi.notAppraisal)})</small></dt>
          <dd>{physical.condition}</dd>
        </div>
        <div>
          <dt>{t(physicalUi.rights)}<small>{t(sourceText.offchain_evidence)}</small></dt>
          <dd>{physical.rights}</dd>
        </div>
        <div>
          <dt>{t(physicalUi.custody)}<small>{t(sourceText.offchain_evidence)}</small></dt>
          <dd>{physical.custody.vault} · {t(custodyText[physical.custody.status])}</dd>
        </div>
        <div>
          <dt>{t(physicalUi.lastVerified)}<small>{t(sourceText.offchain_evidence)}</small></dt>
          <dd>{physical.lastVerifiedAt}</dd>
        </div>
      </dl>
    </details>
  );
}
