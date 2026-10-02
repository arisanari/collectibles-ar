import type { TwinfoldAsset } from "../lib/contract";
import { explorerTxUrl, provenanceTitle, sortedProvenance, sourceLabel } from "../lib/labels";

/** Provenance timeline. onchain / off-chain evidence / Twinfold interpretation are
 * tagged separately. Transaction links go to Solana Explorer (devnet) only for real
 * (non-demo) data; fixture signatures are shown as plain text. */
export function ProvenanceList({ asset, demo }: { asset: Pick<TwinfoldAsset, "provenance">; demo: boolean }) {
  return (
    <ol className="provenanceList">
      {sortedProvenance(asset).map((event) => (
        <li className={`provenanceItem src-${event.source}`} key={event.id}>
          <div className="provenanceHead">
            <strong>{provenanceTitle(event)}</strong>
            <span className={`statusTag ${event.status}`}>{event.status}</span>
          </div>
          <div className="provenanceMeta">
            <span className="sourceTag">{sourceLabel[event.source]}</span>
            <span>{event.occurredAt}</span>
            {event.metadata?.dryRun === true && <span className="sourceTag">DRY RUN · 実配送なし</span>}
          </div>
          {typeof event.metadata?.note === "string" && event.metadata.redeemStep ? <div className="provenanceDetail">{event.metadata.note}</div> : null}
          {event.transaction && (
            <div className="provenanceDetail">
              tx:{" "}
              {demo ? (
                event.transaction
              ) : (
                <a href={explorerTxUrl(event.transaction)} target="_blank" rel="noreferrer">{event.transaction}</a>
              )}
            </div>
          )}
          {event.evidenceHash && <div className="provenanceDetail">evidence: {event.evidenceHash}</div>}
        </li>
      ))}
    </ol>
  );
}
