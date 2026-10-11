"use client";

import { useState } from "react";
import type { TransferRequestView } from "../lib/contract";
import { explorerTxUrl, shortAddress } from "../lib/labels";
import { useI18n, type Localized } from "../lib/i18n";
import type { TransferRequestsState } from "../lib/transferRequests/useTransferRequests";

const statusLabel: Record<TransferRequestView["status"], Localized> = {
  awaiting_approval: { en: "Awaiting approval" },
  submitted: { en: "Submitted, awaiting confirmation" },
  confirmed: { en: "Confirmed" },
  failed: { en: "Failed" },
  rejected: { en: "Rejected" },
  expired: { en: "Expired" },
};

const phaseLabel: Record<"preparing" | "signing" | "submitting", Localized> = {
  preparing: { en: "Preparing…" },
  signing: { en: "Sign in Phantom…" },
  submitting: { en: "Verifying and sending…" },
};

const text = {
  title: { en: "Requests awaiting approval" },
  note: {
    en: "Requests arrive here when you tap \"Send\", \"Sell to Twinfold (legacy demo)\" or \"Redeem the physical item\" on iPhone, or request a redemption on the web. Nothing happens until you sign in Phantom (devnet). Twinfold's vault wallet pays the network fee.",
  },
  none: { en: "No requests awaiting approval." },
  kindBuyback: { en: "Sell to Twinfold" },
  kindRedeem: { en: "Redeem the physical item: stop the Asset (lock)" },
  kindSend: { en: "Send" },
  fromDevice: { en: "Request from iPhone" },
  fullAddress: {
    en: "Destination address (full; check it character by character)",
  },
  deviceWarning: {
    en: "This request was created by your linked iPhone. If you do not recognize it, reject it and unlink the device.",
  },
  redeemNote: {
    en: "When you sign, the Asset moves to Twinfold's redemption escrow and stops circulating (it disappears from your wall). You can cancel before shipping, and the Asset is returned from escrow. This is a dry run: nothing is shipped and no delivery address is recorded.",
  },
  buybackOffer: { en: "Buyback offer" },
  buybackNote: {
    en: "This is an offer, not a guarantee. On devnet no real payment is made.",
  },
  explorer: { en: "View on Explorer (devnet)" },
  confirmSend: {
    en: "Send to this destination (it is not the Twinfold Vault address)",
  },
  approve: { en: "Approve (sign in Phantom)" },
  reject: { en: "Reject" },
} satisfies Record<string, Localized>;

const buybackBasis = (price: string, percent: number): Localized => ({
  en: ` (${percent}% of the list price ${price})`,
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
