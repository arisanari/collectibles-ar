import type { TwinfoldAsset } from "../lib/contract";
import { custodyStatusLabel, explorerAddressUrl, sourceLabel } from "../lib/labels";

/**
 * Physical layer of an Asset (Issue #22): physical ID, condition, rights, custody, last verified and the
 * Asset address, each with its source label. The address is an onchain fact; the rest are Twinfold's
 * off-chain records (evidence or interpretation). None of this is an authenticity or condition guarantee.
 */
export function PhysicalDetails({ asset, demo, open = false }: { asset: TwinfoldAsset; demo: boolean; open?: boolean }) {
  const physical = asset.physical;
  if (!physical) return null;
  return (
    <details className="physicalDetails" open={open}>
      <summary>PHYSICAL · 現物の記録（出典つき）</summary>
      <dl>
        <div>
          <dt>Physical ID<small>{sourceLabel.offchain_evidence}</small></dt>
          <dd>{physical.physicalId}</dd>
        </div>
        <div>
          <dt>Asset address<small>{sourceLabel.onchain}</small></dt>
          <dd className="breakAll">
            {demo ? asset.address : <a href={explorerAddressUrl(asset.address)} target="_blank" rel="noreferrer">{asset.address}</a>}
          </dd>
        </div>
        <div>
          <dt>Condition<small>{sourceLabel.twinfold_interpretation}（鑑定ではない）</small></dt>
          <dd>{physical.condition}</dd>
        </div>
        <div>
          <dt>Rights<small>{sourceLabel.offchain_evidence}</small></dt>
          <dd>{physical.rights}</dd>
        </div>
        <div>
          <dt>Custody<small>{sourceLabel.offchain_evidence}</small></dt>
          <dd>{physical.custody.vault} · {custodyStatusLabel[physical.custody.status]}</dd>
        </div>
        <div>
          <dt>Last verified<small>{sourceLabel.offchain_evidence}</small></dt>
          <dd>{physical.lastVerifiedAt}</dd>
        </div>
      </dl>
    </details>
  );
}
