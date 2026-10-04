"use client";

import Link from "next/link";
import type { Redemption } from "../lib/contract";
import { explorerTxUrl, redemptionStatusLabel, redemptionStepIndex, redemptionSteps } from "../lib/labels";
import { useI18n, type Localized } from "../lib/i18n";
import type { RedemptionsState } from "../lib/redemptions/useRedemptions";

const text = {
  title: { en: "Redeem the physical item", ja: "引き取り手続き" },
  note: {
    en: "This is a dry run of redeeming the physical item. Nothing is shipped and no delivery address is recorded. Stopping the circulating Asset (lock) needs your approval in Phantom. When receipt is confirmed the Asset is retired (burned) and a Passport is issued. OshiPin's vault wallet pays the network fee.",
    ja: "現物の引き取り（redeem）のdry runです。実配送は行わず、配送先も記録しません。流通Assetの停止（lock）はPhantomでの承認が必要で、受取確認でAssetが失効（burn）し、Passportが発行されます。送信手数料はOshiPinのvault walletが負担します。",
  },
  cancelledBase: { en: "Cancelled.", ja: "取り消されました。" },
  cancelledReturned: {
    en: "The Asset was returned from escrow to your wallet.",
    ja: "Assetはescrowからあなたのwalletへ返却されました。",
  },
  cancelledUntouched: { en: "The Asset was not moved.", ja: "Assetは動かしていません。" },
  stepperLabel: { en: "Redemption progress", ja: "引き取りの進み具合" },
  exceptionPrefix: { en: "Stopped on exception:", ja: "例外停止:" },
  exceptionDefault: { en: "operator review is needed", ja: "operatorの確認が必要です" },
  exceptionSuffix: {
    en: "The Asset stays in escrow and nothing else has changed. Please wait for the operator.",
    ja: "Assetはescrowに残り、これ以上は何も変わっていません。operatorの対応をお待ちください。",
  },
  explorer: { en: "Explorer (devnet)", ja: "Explorer（devnet）" },
  retiredLabel: { en: "Retired (burned)", ja: "失効（burn）" },
  shippedNote: { en: "Shipping is a dry run (nothing is shipped).", ja: "発送はdry runです（実配送なし）。" },
  requestedNote: {
    en: "Sign in Phantom under \"Requests awaiting approval\" to stop the Asset.",
    ja: "「承認待ちの依頼」でPhantom署名をするとAssetが止まります。",
  },
  busy: { en: "Working…", ja: "処理中…" },
  receive: { en: "Confirm receipt", ja: "受け取りを確認" },
  cancel: { en: "Cancel", ja: "取消" },
  viewPassport: { en: "View Redeemed Provenance Passport", ja: "Redeemed Provenance Passportを見る" },
  noCancel: { en: "Cannot be cancelled after shipping.", ja: "発送後は取り消せません。" },
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
