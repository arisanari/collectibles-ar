"use client";

import Link from "next/link";
import type { Redemption } from "../lib/contract";
import { explorerTxUrl, redemptionStatusLabel, redemptionStepIndex, redemptionSteps } from "../lib/labels";
import { useI18n, type Localized } from "../lib/i18n";
import type { RedemptionsState } from "../lib/redemptions/useRedemptions";

const text = {
  title: { en: "Redeem the physical item" },
  note: {
    en: "This is a dry run of redeeming the physical item. Nothing is shipped and no delivery address is recorded. Stopping the circulating Asset (lock) needs your approval in Phantom. When receipt is confirmed the Asset is retired (burned) and a Passport is issued. The Twinfold (legacy demo) vault wallet pays the network fee.",
  },
  cancelledBase: { en: "Cancelled." },
  cancelledReturned: {
    en: "The Asset was returned from escrow to your wallet.",
  },
  cancelledUntouched: { en: "The Asset was not moved." },
  stepperLabel: { en: "Redemption progress" },
  exceptionPrefix: { en: "Stopped on exception:" },
  exceptionDefault: { en: "operator review is needed" },
  exceptionSuffix: {
    en: "The Asset stays in escrow and nothing else has changed. Please wait for the operator.",
  },
  explorer: { en: "Explorer (devnet)" },
  retiredLabel: { en: "Retired (burned)" },
  shippedNote: { en: "Shipping is a dry run (nothing is shipped)." },
  requestedNote: {
    en: "Sign in Phantom under \"Requests awaiting approval\" to stop the Asset.",
  },
  busy: { en: "Working…" },
  receive: { en: "Confirm receipt" },
  cancel: { en: "Cancel" },
  viewPassport: { en: "View Redeemed Provenance Passport" },
  noCancel: { en: "Cannot be cancelled after shipping." },
} satisfies Record<string, Localized>;

const sigOf = (r: Redemption, kind: "locked" | "retired" | "returned") => r.events.find((e) => e.kind === kind)?.signature;

/** 「引き取り手続き」: Redeem Physical (dry run) progress per redemption, with the owner's actions. */
export function RedemptionPanel({ rd }: { rd: RedemptionsState }) {
  const { t } = useI18n();
  const { redemptions, busy, errors, cancel, receive } = rd;
  if (redemptions.length === 0) return null;

  return (
    <section className="linkPanel requestsPanel redemptionPanel" aria-labelledby="redemptionTitle">
      <h2 id="redemptionTitle">{t(text.title)} <span className="demoBadge">DRY RUN</span></h2>
      <p className="linkNote">{t(text.note)}</p>
      <ul className="requestList">
        {redemptions.map((r) => {
          const index = redemptionStepIndex(r.status, r.exceptionFrom);
          const lock = r.lockSignature ?? sigOf(r, "locked");
          const retire = r.retireSignature ?? sigOf(r, "retired");
          const returned = sigOf(r, "returned");
          return (
            <li key={r.id} className={`requestItem redemptionItem status-${r.status}`}>
              <div className="requestHead">
                <b>{r.assetTitle ?? r.assetId}</b>
                <span className="demoBadge">{redemptionStatusLabel[r.status]}</span>
              </div>
              {r.status === "cancelled" ? (
                <div className="requestMeta">{t(text.cancelledBase)} {returned ? t(text.cancelledReturned) : t(text.cancelledUntouched)}</div>
              ) : (
                <ol className="stepper" aria-label={t(text.stepperLabel)}>
                  {redemptionSteps.map((label, i) => {
                    const done = r.status === "retired" || i < index;
                    const current = r.status !== "retired" && i === index;
                    const failed = r.status === "exception" && current;
                    return (
                      <li key={label} className={`step${done ? " done" : ""}${current ? " current" : ""}${failed ? " failed" : ""}`}>
                        <span className="stepDot" aria-hidden>{done ? "✓" : failed ? "!" : i + 1}</span>
                        <span className="stepLabel">{label}</span>
                      </li>
                    );
                  })}
                </ol>
              )}
              {r.status === "exception" && (
                <div className="requestMeta" role="alert">
                  {t(text.exceptionPrefix)} {r.exceptionReason ?? t(text.exceptionDefault)}. {t(text.exceptionSuffix)}
                </div>
              )}
              <div className="requestMeta">
                {lock && <>lock: <a href={explorerTxUrl(lock)} target="_blank" rel="noreferrer">{t(text.explorer)}</a> · </>}
                {retire && <>{t(text.retiredLabel)}: <a href={explorerTxUrl(retire)} target="_blank" rel="noreferrer">{t(text.explorer)}</a> · </>}
                {r.status === "shipped" && t(text.shippedNote)}
                {r.status === "requested" && t(text.requestedNote)}
              </div>
              {errors[r.id] && <div className="requestMeta" role="alert">{errors[r.id]}</div>}
              <div className="linkActions">
                {r.status === "shipped" && (
                  <button className="primary" disabled={!!busy[r.id]} onClick={() => void receive(r.id)}>
                    {busy[r.id] ? t(text.busy) : t(text.receive)}
                  </button>
                )}
                {(r.status === "requested" || r.status === "locked") && (
                  <button className="secondary" disabled={!!busy[r.id]} onClick={() => void cancel(r.id)}>
                    {busy[r.id] ? t(text.busy) : t(text.cancel)}
                  </button>
                )}
                {r.status === "retired" && (
                  <Link className="primary linkButton" href={`/passport/${encodeURIComponent(r.assetId)}`}>{t(text.viewPassport)}</Link>
                )}
              </div>
              {(r.status === "shipped" || r.status === "received") && <div className="requestMeta">{t(text.noCancel)}</div>}
            </li>
          );
        })}
      </ul>
    </section>
  );
}
