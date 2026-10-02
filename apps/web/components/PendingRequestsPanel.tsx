"use client";

import { useState } from "react";
import type { TransferRequestView } from "../lib/contract";
import { explorerTxUrl, shortAddress } from "../lib/labels";
import type { TransferRequestsState } from "../lib/transferRequests/useTransferRequests";

const statusLabel: Record<TransferRequestView["status"], string> = {
  awaiting_approval: "承認待ち",
  submitted: "送信済み・確定待ち",
  confirmed: "確定（confirmed）",
  failed: "失敗",
  rejected: "拒否済み",
  expired: "期限切れ",
};

const phaseLabel = { preparing: "準備中…", signing: "Phantomで署名してください…", submitting: "検証・送信中…" } as const;

function destination(r: TransferRequestView) {
  return r.toLabel ?? shortAddress(r.toWallet);
}

/** 「承認待ちの依頼」: requests created by the iPhone (or a card button) that the owner approves with Phantom. */
export function PendingRequestsPanel({ tr }: { tr: TransferRequestsState }) {
  const { requests, phase, errors, approve, reject, notice } = tr;
  // Non-vault destinations ("send") need an explicit confirmation before 承認.
  const [confirmed, setConfirmed] = useState<Record<string, boolean>>({});

  return (
    <section className="linkPanel requestsPanel" aria-labelledby="requestsTitle">
      <h2 id="requestsTitle">承認待ちの依頼</h2>
      <p className="linkNote">
        iPhoneで「送る」「Twinfoldに売る」「現物を引き取る」を押すか、Webで引き取りを申請すると、ここに依頼が届きます。あなたがPhantomで署名するまで、何も動きません（devnet）。
        送信手数料はTwinfoldのvault walletが負担します。
      </p>
      {notice && <p className="emptyState small" role="status">{notice}</p>}
      {requests.length === 0 ? (
        <p className="emptyState small">承認待ちの依頼はありません</p>
      ) : (
        <ul className="requestList">
          {requests.map((r) => {
            const working = phase[r.requestId];
            const canAct = r.status === "awaiting_approval" || (r.status === "failed" && r.retryable);
            return (
              <li key={r.requestId} className={`requestItem status-${r.status}`}>
                <div className="requestHead">
                  <b>{r.assetTitle}</b>
                  <span className="demoBadge">{statusLabel[r.status]}</span>
                </div>
                <div className="requestMeta">
                  {r.kind === "buyback" ? "Twinfoldに売る" : r.kind === "redeem_lock" ? "現物の引き取り：流通Assetを止める（lock）" : "送る"} → {destination(r)}
                  {r.origin === "device" && <> ・ <b>iPhoneからの依頼</b></>}
                </div>
                {r.kind === "send" && (
                  <>
                    <div className="requestMeta">送信先アドレス（全文。1文字ずつ確認してください）</div>
                    <code className="fullAddress">{r.toWallet}</code>
                    {r.origin === "device" && (
                      <div className="requestMeta">
                        この依頼はiPhoneの連携端末から作成されました。心当たりがなければ「拒否」し、連携を解除してください。
                      </div>
                    )}
                  </>
                )}
                {r.kind === "redeem_lock" && (
                  <div className="requestMeta">
                    署名するとAssetはTwinfoldのredemption escrowへ移り、流通が止まります（あなたの壁から消えます）。
                    取消はescrowからの返却で、発送前なら可能です。dry runのため実配送はなく、配送先も記録しません。
                  </div>
                )}
                {r.kind === "buyback" && r.quote && (
                  <div className="requestMeta">
                    買取オファー {r.quote.offerAmount.toLocaleString("en-US")} {r.quote.currency}
                    （販売価格 {r.quote.basis.amount.toLocaleString("en-US")} の{Math.round(r.quote.rate * 100)}%）
                    <br />
                    オファーであり、保証ではありません。devnetでは実際の支払いは発生しません。
                  </div>
                )}
                {working && <div className="requestMeta" aria-live="polite">{phaseLabel[working]}</div>}
                {r.status === "confirmed" && r.signature && (
                  <div className="requestMeta">
                    <a href={explorerTxUrl(r.signature)} target="_blank" rel="noreferrer">Explorerで確認（devnet）</a>
                  </div>
                )}
                {r.status === "failed" && r.error && <div className="requestMeta" role="alert">{r.error}</div>}
                {errors[r.requestId] && <div className="requestMeta" role="alert">{errors[r.requestId]}</div>}
                {canAct && r.kind === "send" && (
                  <label className="confirmLine">
                    <input
                      type="checkbox"
                      checked={!!confirmed[r.requestId]}
                      disabled={!!working}
                      onChange={(e) => setConfirmed((c) => ({ ...c, [r.requestId]: e.target.checked }))}
                    />
                    <span>この宛先へ送る（Twinfold Vault以外のアドレスです）</span>
                  </label>
                )}
                {canAct && (
                  <div className="linkActions">
                    <button
                      className="primary"
                      disabled={!!working || (r.kind === "send" && !confirmed[r.requestId])}
                      onClick={() => void approve(r.requestId)}
                    >
                      承認（Phantomで署名）
                    </button>
                    <button className="secondary" disabled={!!working} onClick={() => void reject(r.requestId)}>
                      拒否
                    </button>
                  </div>
                )}
              </li>
            );
          })}
        </ul>
      )}
    </section>
  );
}
