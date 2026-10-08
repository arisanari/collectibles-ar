"use client";

import { useState } from "react";
import type { TwinfoldAsset } from "../lib/contract";
import { displayTitle } from "../lib/displayTitle";
import { redemptionStatusLabel } from "../lib/labels";
import type { RedemptionsState } from "../lib/redemptions/useRedemptions";
import { useI18n, type Localized } from "../lib/i18n";
import { useLang } from "../lib/useLang";

const text = {
  eyebrow: { en: "OWNERSHIP", ja: "OWNERSHIP" },
  vaultedTitle: { en: "Vaulted ownership (keep it in the Vault)", ja: "Vaulted Ownership（Vaultで持ち続ける）" },
  vaultedBusy: {
    en: "Redemption is in progress, so selling and sending are unavailable.",
    ja: "引き取り手続き中のため、売却・送信はできません",
  },
  vaultedCurrent: {
    en: "Current choice. The physical item stays in the Twinfold (legacy demo) Vault and the Asset can circulate.",
    ja: "現在の選択。現物はTwinfold（旧デモ）のVaultで保管され、Assetは流通できます",
  },
  physicalTitle: { en: "Physical ownership (redeem the physical item)", ja: "Physical Ownership（現物を引き取る）" },
  physicalActive: {
    en: "Continue in \"Redeem the physical item\" below.",
    ja: "下の「引き取り手続き」で進めます",
  },
  physicalInfo: {
    en: "Take the physical item home. The Asset is retired and its provenance stays in the Passport (dry run).",
    ja: "現物を手元に引き取ります。Assetは失効し、来歴はPassportに残ります（dry run）",
  },
  request: { en: "Request to redeem the physical item (dry run)", ja: "現物の引き取りを申請（dry run）" },
  dialogEyebrow: { en: "DEVNET · REDEEM · DRY RUN", ja: "DEVNET · REDEEM · DRY RUN" },
  dialogLead: { en: "You are requesting to redeem the physical item.", ja: "現物の引き取りを申請します" },
  point1: {
    en: "The Asset stops circulating. When you sign in Phantom it moves to Twinfold's (legacy demo) escrow and disappears from your wall. It is retired (burned) after receipt is confirmed.",
    ja: "流通するAssetは止まります（Phantomで署名するとTwinfold（旧デモ）のescrowへ移り、あなたの壁から消えます）。受取確認後にAssetは失効（burn）します。",
  },
  point2: {
    en: "To circulate it again after redemption, it needs re-verification (Trust Gate) and re-vaulting into the Twinfold Vault.",
    ja: "引き取り後に再流通させるには、再確認（Trust Gate）とTwinfold Vaultへのre-vaultが必要です。",
  },
  point3: {
    en: "This demo ships nothing. No delivery address (name, address, phone) is recorded.",
    ja: "このデモでは実配送はしません。配送先（氏名・住所・電話）も記録しません。",
  },
  point4: {
    en: "The Passport records provenance and the last verified state up to redemption. It does not guarantee the owner, the condition of the physical item, or its authenticity after redemption.",
    ja: "Passportは引き取りまでの来歴と最終確認状態の記録で、引き取り後の所有者・現物の状態・真正性を保証するものではありません。",
  },
  busy: { en: "Working…", ja: "処理中…" },
  submit: { en: "Submit request (dry run)", ja: "申請する（dry run）" },
  cancel: { en: "Cancel", ja: "キャンセル" },
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
