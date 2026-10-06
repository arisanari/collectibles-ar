"use client";

import { useState } from "react";
import type { TwinfoldAsset } from "../lib/contract";
import { provenanceTitleText, provenanceUi, sourceText } from "../lib/copy/landing";
import { useI18n } from "../lib/i18n";
import { explorerTxUrl, shortAddress, sortedProvenance } from "../lib/labels";

/** Provenance timeline. onchain / off-chain evidence / SlabAR interpretation are tagged
 * separately (source label + border). Transaction links go to Solana Explorer (devnet) only
 * for real (non-demo) data; fixture signatures are shown as plain text.
 * With `limit`, events are listed newest first and only `limit` are shown until expanded.
 * `variant="timeline"`: one row per event along a vertical line (date, kind, source, tx link); the source is
 * shown both as text and as the marker shape (filled / outlined ink / outlined muted). Notes go in `title`. */
export function ProvenanceList({
  asset,
  demo,
  limit,
  variant = "boxes",
}: {
  asset: Pick<TwinfoldAsset, "provenance">;
  demo: boolean;
  limit?: number;
  variant?: "boxes" | "timeline";
}) {
  const { t } = useI18n();
  const [expanded, setExpanded] = useState(false);
  const chronological = sortedProvenance(asset);
  const events = limit ? [...chronological].reverse() : chronological;
  const canToggle = limit !== undefined && events.length > limit;
  const shown = limit !== undefined && !expanded ? events.slice(0, limit) : events;

  const toggle = canToggle && (
    <button type="button" className="textButton provenanceToggle" aria-expanded={expanded} onClick={() => setExpanded((open) => !open)}>
      {expanded ? t(provenanceUi.showLess) : t(provenanceUi.showAll(events.length))}
    </button>
  );

  if (variant === "timeline") {
    return (
      <>
        <ol className="provenanceTimeline">
          {shown.map((event) => {
            const note = typeof event.metadata?.note === "string" ? event.metadata.note : undefined;
            const rowTitle = [note, event.evidenceHash ? `${t(provenanceUi.evidence)}: ${event.evidenceHash}` : undefined].filter(Boolean).join("\n");
            return (
              <li className={`tlItem src-${event.source}`} key={event.id} title={rowTitle || undefined}>
                <time className="tlDate" dateTime={event.occurredAt} title={event.occurredAt}>{event.occurredAt.slice(0, 10)}</time>
                <span className="tlKind">{t(provenanceTitleText(event))}</span>
                <span className="tlRight">
                  {event.status !== "confirmed" && <span className={`statusTag ${event.status}`}>{event.status}</span>}
                  {event.metadata?.dryRun === true && <span className="tlSource">{t(provenanceUi.dryRun)}</span>}
                  <span className="tlSource">{t(sourceText[event.source])}</span>
                  {event.source === "onchain" && event.transaction && (
                    demo ? (
                      <span className="tlTx" title={event.transaction}>tx</span>
                    ) : (
                      <a className="tlTx" href={explorerTxUrl(event.transaction)} target="_blank" rel="noreferrer" title={event.transaction}>tx ↗</a>
                    )
                  )}
                </span>
              </li>
            );
          })}
        </ol>
        {toggle}
      </>
    );
  }

  return (
    <>
      <ol className="provenanceList">
        {shown.map((event) => (
          <li className={`provenanceItem src-${event.source}`} key={event.id}>
            <div className="provenanceHead">
              <strong>{t(provenanceTitleText(event))}</strong>
              <span className={`statusTag ${event.status}`}>{event.status}</span>
            </div>
            <div className="provenanceMeta">
              <span className="sourceTag">{t(sourceText[event.source])}</span>
              <time dateTime={event.occurredAt} title={event.occurredAt}>{event.occurredAt.slice(0, 10)}</time>
              {event.metadata?.dryRun === true && <span className="sourceTag">{t(provenanceUi.dryRun)}</span>}
            </div>
            {typeof event.metadata?.note === "string" && event.metadata.redeemStep ? <div className="provenanceDetail">{event.metadata.note}</div> : null}
            {event.transaction && (
              <div className="provenanceDetail">
                tx:{" "}
                {demo ? (
                  <span title={event.transaction}>{shortAddress(event.transaction)}</span>
                ) : (
                  <a href={explorerTxUrl(event.transaction)} target="_blank" rel="noreferrer" title={event.transaction}>{shortAddress(event.transaction)} ↗</a>
                )}
              </div>
            )}
            {event.evidenceHash && (
              <div className="provenanceDetail">
                {t(provenanceUi.evidence)}: <span title={event.evidenceHash}>{shortAddress(event.evidenceHash)}</span>
              </div>
            )}
          </li>
        ))}
      </ol>
      {toggle}
    </>
  );
}
