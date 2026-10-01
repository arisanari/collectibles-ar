import type { TwinfoldAsset } from "../lib/contract";
import { explorerTxUrl, kindLabel, sortedProvenance, sourceLabel } from "../lib/labels";

/** Provenance timeline. onchain / off-chain evidence / Twinfold interpretation are
 * tagged separately. Transaction links go to Solana Explorer (devnet) only for real
 * (non-demo) data; fixture signatures are shown as plain text. */
export function ProvenanceList({ asset, demo }: { asset: TwinfoldAsset; demo: boolean }) {
  return (
    <ol className="provenanceList">
      {sortedProvenance(asset).map((event) => (
        <li className={`provenanceItem src-${event.source}`} key={event.id}>
          <div className="provenanceHead">
            <strong>{kindLabel[event.kind]}</strong>
            <span className={`statusTag ${event.status}`}>{event.status}</span>
          </div>
          <div className="provenanceMeta">
            <span className="sourceTag">{sourceLabel[event.source]}</span>
            <span>{event.occurredAt}</span>
          </div>
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
