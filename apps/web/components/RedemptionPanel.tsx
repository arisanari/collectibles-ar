"use client";

import Link from "next/link";
import type { Redemption } from "../lib/contract";
import { explorerTxUrl, redemptionStatusLabel, redemptionStepIndex, redemptionSteps } from "../lib/labels";
import type { RedemptionsState } from "../lib/redemptions/useRedemptions";

const sigOf = (r: Redemption, kind: "locked" | "retired" | "returned") => r.events.find((e) => e.kind === kind)?.signature;

/** 「引き取り手続き」: Redeem Physical (dry run) progress per redemption, with the owner's actions. */
export function RedemptionPanel({ rd }: { rd: RedemptionsState }) {
  const { redemptions, busy, errors, cancel, receive } = rd;
  if (redemptions.length === 0) return null;

  return (
    <section className="linkPanel requestsPanel redemptionPanel" aria-labelledby="redemptionTitle">
      <h2 id="redemptionTitle">引き取り手続き <span className="demoBadge">DRY RUN</span></h2>
      <p className="linkNote">
        現物の引き取り（redeem）のdry runです。実配送は行わず、配送先も記録しません。流通Assetの停止（lock）はPhantomでの承認が必要で、
        受取確認でAssetが失効（burn）し、Passportが発行されます。送信手数料はTwinfoldのvault walletが負担します。
      </p>
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
                <div className="requestMeta">取り消されました。{returned ? "Assetはescrowからあなたのwalletへ返却されました。" : "Assetは動かしていません。"}</div>
              ) : (
                <ol className="stepper" aria-label="引き取りの進み具合">
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
                  例外停止: {r.exceptionReason ?? "operatorの確認が必要です"}。Assetはescrowに残り、これ以上は何も変わっていません。operatorの対応をお待ちください。
                </div>
              )}
              <div className="requestMeta">
                {lock && <>lock: <a href={explorerTxUrl(lock)} target="_blank" rel="noreferrer">Explorer（devnet）</a> ・ </>}
                {retire && <>失効（burn）: <a href={explorerTxUrl(retire)} target="_blank" rel="noreferrer">Explorer（devnet）</a> ・ </>}
                {r.status === "shipped" && "発送はdry runです（実配送なし）。"}
                {r.status === "requested" && "「承認待ちの依頼」でPhantom署名をするとAssetが止まります。"}
              </div>
              {errors[r.id] && <div className="requestMeta" role="alert">{errors[r.id]}</div>}
              <div className="linkActions">
                {r.status === "shipped" && (
                  <button className="primary" disabled={!!busy[r.id]} onClick={() => void receive(r.id)}>
                    {busy[r.id] ? "処理中…" : "受け取りを確認"}
                  </button>
                )}
                {(r.status === "requested" || r.status === "locked") && (
                  <button className="secondary" disabled={!!busy[r.id]} onClick={() => void cancel(r.id)}>
                    {busy[r.id] ? "処理中…" : "取消"}
                  </button>
                )}
                {r.status === "retired" && (
                  <Link className="primary linkButton" href={`/passport/${encodeURIComponent(r.assetId)}`}>Redeemed Provenance Passportを見る</Link>
                )}
              </div>
              {(r.status === "shipped" || r.status === "received") && <div className="requestMeta">発送後は取り消せません。</div>}
            </li>
          );
        })}
      </ul>
    </section>
  );
}
