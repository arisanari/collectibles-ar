"use client";

import { useState } from "react";
import type { TransferRequestView } from "../lib/contract";
import { explorerTxUrl, shortAddress } from "../lib/labels";
import { useI18n, type Localized } from "../lib/i18n";
import type { TransferRequestsState } from "../lib/transferRequests/useTransferRequests";

const statusLabel: Record<TransferRequestView["status"], Localized> = {
  awaiting_approval: { en: "Awaiting approval", ja: "承認待ち" },
  submitted: { en: "Submitted, awaiting confirmation", ja: "送信済み・確定待ち" },
  confirmed: { en: "Confirmed", ja: "確定（confirmed）" },
  failed: { en: "Failed", ja: "失敗" },
  rejected: { en: "Rejected", ja: "拒否済み" },
  expired: { en: "Expired", ja: "期限切れ" },
};

const phaseLabel: Record<"preparing" | "signing" | "submitting", Localized> = {
  preparing: { en: "Preparing…", ja: "準備中…" },
  signing: { en: "Sign in Phantom…", ja: "Phantomで署名してください…" },
  submitting: { en: "Verifying and sending…", ja: "検証・送信中…" },
};

const text = {
  title: { en: "Requests awaiting approval", ja: "承認待ちの依頼" },
  note: {
    en: "Requests arrive here when you tap \"Send\", \"Sell to OshiPin\" or \"Redeem the physical item\" on iPhone, or request a redemption on the web. Nothing happens until you sign in Phantom (devnet). OshiPin's vault wallet pays the network fee.",
    ja: "iPhoneで「送る」「OshiPinに売る」「現物を引き取る」を押すか、Webで引き取りを申請すると、ここに依頼が届きます。あなたがPhantomで署名するまで、何も動きません（devnet）。送信手数料はOshiPinのvault walletが負担します。",
  },
  none: { en: "No requests awaiting approval.", ja: "承認待ちの依頼はありません" },
  kindBuyback: { en: "Sell to OshiPin", ja: "OshiPinに売る" },
  kindRedeem: { en: "Redeem the physical item: stop the Asset (lock)", ja: "現物の引き取り：流通Assetを止める（lock）" },
  kindSend: { en: "Send", ja: "送る" },
  fromDevice: { en: "Request from iPhone", ja: "iPhoneからの依頼" },
  fullAddress: {
    en: "Destination address (full; check it character by character)",
    ja: "送信先アドレス（全文。1文字ずつ確認してください）",
  },
  deviceWarning: {
    en: "This request was created by your linked iPhone. If you do not recognize it, reject it and unlink the device.",
    ja: "この依頼はiPhoneの連携端末から作成されました。心当たりがなければ「拒否」し、連携を解除してください。",
  },
  redeemNote: {
    en: "When you sign, the Asset moves to OshiPin's redemption escrow and stops circulating (it disappears from your wall). You can cancel before shipping, and the Asset is returned from escrow. This is a dry run: nothing is shipped and no delivery address is recorded.",
    ja: "署名するとAssetはOshiPinのredemption escrowへ移り、流通が止まります（あなたの壁から消えます）。取消はescrowからの返却で、発送前なら可能です。dry runのため実配送はなく、配送先も記録しません。",
  },
  buybackOffer: { en: "Buyback offer", ja: "買取オファー" },
  buybackNote: {
    en: "This is an offer, not a guarantee. On devnet no real payment is made.",
    ja: "オファーであり、保証ではありません。devnetでは実際の支払いは発生しません。",
  },
  explorer: { en: "View on Explorer (devnet)", ja: "Explorerで確認（devnet）" },
  confirmSend: {
    en: "Send to this destination (it is not the OshiPin Vault address)",
    ja: "この宛先へ送る（OshiPin Vault以外のアドレスです）",
  },
  approve: { en: "Approve (sign in Phantom)", ja: "承認（Phantomで署名）" },
  reject: { en: "Reject", ja: "拒否" },
} satisfies Record<string, Localized>;

const buybackBasis = (price: string, percent: number): Localized => ({
  en: ` (${percent}% of the list price ${price})`,
  ja: `（販売価格 ${price} の${percent}%）`,
});

function destination(r: TransferRequestView) {
  return r.toLabel ?? shortAddress(r.toWallet);
}

/** 「承認待ちの依頼」: requests created by the iPhone (or a card button) that the owner approves with Phantom. */
export function PendingRequestsPanel({ tr }: { tr: TransferRequestsState }) {
  const { t } = useI18n();
  const { requests, phase, errors, approve, reject, notice } = tr;
  // Non-vault destinations ("send") need an explicit confirmation before 承認.
  const [confirmed, setConfirmed] = useState<Record<string, boolean>>({});

  return (
    <section className="linkPanel requestsPanel" aria-labelledby="requestsTitle">
      <h2 id="requestsTitle">{t(text.title)}</h2>
      <p className="linkNote">{t(text.note)}</p>
      {notice && <p className="emptyState small" role="status">{notice}</p>}
      {requests.length === 0 ? (
        <p className="emptyState small">{t(text.none)}</p>
      ) : (
        <ul className="requestList">
          {requests.map((r) => {
            const working = phase[r.requestId];
            const canAct = r.status === "awaiting_approval" || (r.status === "failed" && r.retryable);
            return (
              <li key={r.requestId} className={`requestItem status-${r.status}`}>
                <div className="requestHead">
                  <b>{r.assetTitle}</b>
                  <span className="demoBadge">{t(statusLabel[r.status])}</span>
                </div>
                <div className="requestMeta">
                  {r.kind === "buyback" ? t(text.kindBuyback) : r.kind === "redeem_lock" ? t(text.kindRedeem) : t(text.kindSend)} → {destination(r)}
                  {r.origin === "device" && <> · <b>{t(text.fromDevice)}</b></>}
                </div>
                {r.kind === "send" && (
                  <>
                    <div className="requestMeta">{t(text.fullAddress)}</div>
                    <code className="fullAddress">{r.toWallet}</code>
                    {r.origin === "device" && (
                      <div className="requestMeta">{t(text.deviceWarning)}</div>
                    )}
                  </>
                )}
                {r.kind === "redeem_lock" && (
                  <div className="requestMeta">{t(text.redeemNote)}</div>
                )}
                {r.kind === "buyback" && r.quote && (
                  <div className="requestMeta">
                    {t(text.buybackOffer)} {r.quote.offerAmount.toLocaleString("en-US")} {r.quote.currency}
                    {t(buybackBasis(r.quote.basis.amount.toLocaleString("en-US"), Math.round(r.quote.rate * 100)))}
                    <br />
                    {t(text.buybackNote)}
                  </div>
                )}
                {working && <div className="requestMeta" aria-live="polite">{t(phaseLabel[working])}</div>}
                {r.status === "confirmed" && r.signature && (
                  <div className="requestMeta">
                    <a href={explorerTxUrl(r.signature)} target="_blank" rel="noreferrer">{t(text.explorer)}</a>
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
                    <span>{t(text.confirmSend)}</span>
                  </label>
                )}
                {canAct && (
                  <div className="linkActions">
                    <button
                      className="primary"
                      disabled={!!working || (r.kind === "send" && !confirmed[r.requestId])}
                      onClick={() => void approve(r.requestId)}
                    >
                      {t(text.approve)}
                    </button>
                    <button className="secondary" disabled={!!working} onClick={() => void reject(r.requestId)}>
                      {t(text.reject)}
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
