"use client";

import { useState } from "react";
import type { TwinfoldAsset } from "../lib/contract";
import { displayTitle } from "../lib/displayTitle";
import { redemptionStatusLabel } from "../lib/labels";
import type { RedemptionsState } from "../lib/redemptions/useRedemptions";
import { useI18n, type Localized } from "../lib/i18n";
import { useLang } from "../lib/useLang";

const text = {
  eyebrow: { en: "OWNERSHIP" },
  vaultedTitle: { en: "Vaulted ownership (keep it in the Vault)" },
  vaultedBusy: {
    en: "Redemption is in progress, so selling and sending are unavailable.",
  },
  vaultedCurrent: {
    en: "Current choice. The physical item stays in the Twinfold (legacy demo) Vault and the Asset can circulate.",
  },
  physicalTitle: { en: "Physical ownership (redeem the physical item)" },
  physicalActive: {
    en: "Continue in \"Redeem the physical item\" below.",
  },
  physicalInfo: {
    en: "Take the physical item home. The Asset is retired and its provenance stays in the Passport (dry run).",
  },
  request: { en: "Request to redeem the physical item (dry run)" },
  dialogEyebrow: { en: "DEVNET · REDEEM · DRY RUN" },
  dialogLead: { en: "You are requesting to redeem the physical item." },
  point1: {
    en: "The Asset stops circulating. When you sign in Phantom it moves to Twinfold's (legacy demo) escrow and disappears from your wall. It is retired (burned) after receipt is confirmed.",
  },
  point2: {
    en: "To circulate it again after redemption, it needs re-verification (Trust Gate) and re-vaulting into the Twinfold Vault.",
  },
  point3: {
    en: "This demo ships nothing. No delivery address (name, address, phone) is recorded.",
  },
  point4: {
    en: "The Passport records provenance and the last verified state up to redemption. It does not guarantee the owner, the condition of the physical item, or its authenticity after redemption.",
  },
  busy: { en: "Working…" },
  submit: { en: "Submit request (dry run)" },
  cancel: { en: "Cancel" },
} satisfies Record<string, Localized>;

/**
 * 「Vaulted Ownership（Vaultで持ち続ける）」(current) vs 「Physical Ownership（現物を引き取る）」.
 * Requesting a redemption is a dry run: no real shipping, no delivery address is asked for or stored.
 * The Asset is stopped only after the owner approves the lock with Phantom (see 「承認待ちの依頼」).
 */
export function OwnershipSection({ asset, rd }: { asset: TwinfoldAsset; rd: RedemptionsState }) {
  const lang = useLang();
  const { t } = useI18n();
  const [open, setOpen] = useState(false);
  const [busy, setBusy] = useState(false);
  const inRedemption = asset.redemption?.open === true;

  async function confirm() {
    if (busy) return;
    setBusy(true);
    try {
      if (await rd.request(asset.id)) setOpen(false);
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="ownershipBox">
      <div className="eyebrow">{t(text.eyebrow)}</div>
      <div className={`ownershipChoice${inRedemption ? "" : " current"}`}>
        <b>{t(text.vaultedTitle)}</b>
        <span>{inRedemption ? t(text.vaultedBusy) : t(text.vaultedCurrent)}</span>
      </div>
      <div className={`ownershipChoice${inRedemption ? " current" : ""}`}>
        <b>{t(text.physicalTitle)}</b>
        {inRedemption && asset.redemption ? (
          <span>{redemptionStatusLabel[asset.redemption.status]}. {t(text.physicalActive)}</span>
        ) : (
          <>
            <span>{t(text.physicalInfo)}</span>
            <button className="secondary" onClick={() => setOpen(true)}>{t(text.request)}</button>
          </>
        )}
      </div>

      {open && (
        <div className="overlay" onMouseDown={() => !busy && setOpen(false)}>
          <section className="confirmBox" role="dialog" aria-modal="true" aria-labelledby={`redeemTitle-${asset.id}`} onMouseDown={(e) => e.stopPropagation()}>
            <div className="eyebrow">{t(text.dialogEyebrow)}</div>
            <h2 id={`redeemTitle-${asset.id}`}>{displayTitle(asset, lang)}</h2>
            <p className="workName">{t(text.dialogLead)}</p>
            <ul className="confirmList">
              <li>{t(text.point1)}</li>
              <li>{t(text.point2)}</li>
              <li>{t(text.point3)}</li>
              <li>{t(text.point4)}</li>
            </ul>
            {rd.notice && <p className="emptyState small" role="alert">{rd.notice}</p>}
            <div className="linkActions">
              <button className="primary" disabled={busy} onClick={() => void confirm()}>{busy ? t(text.busy) : t(text.submit)}</button>
              <button className="secondary" disabled={busy} onClick={() => setOpen(false)}>{t(text.cancel)}</button>
            </div>
          </section>
        </div>
      )}
    </div>
  );
}
