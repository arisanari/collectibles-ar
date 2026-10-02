"use client";

import { useState } from "react";
import type { TwinfoldAsset } from "../lib/contract";
import { displayTitle } from "../lib/displayTitle";
import { redemptionStatusLabel } from "../lib/labels";
import type { RedemptionsState } from "../lib/redemptions/useRedemptions";
import { useLang } from "../lib/useLang";

/**
 * 「Vaulted Ownership（Vaultで持ち続ける）」(current) vs 「Physical Ownership（現物を引き取る）」.
 * Requesting a redemption is a dry run: no real shipping, no delivery address is asked for or stored.
 * The Asset is stopped only after the owner approves the lock with Phantom (see 「承認待ちの依頼」).
 */
export function OwnershipSection({ asset, rd }: { asset: TwinfoldAsset; rd: RedemptionsState }) {
  const lang = useLang();
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
      <div className="eyebrow">OWNERSHIP</div>
      <div className={`ownershipChoice${inRedemption ? "" : " current"}`}>
        <b>Vaulted Ownership（Vaultで持ち続ける）</b>
        <span>{inRedemption ? "引き取り手続き中のため、売却・送信はできません" : "現在の選択。現物はTwinfoldのVaultで保管され、Assetは流通できます"}</span>
      </div>
      <div className={`ownershipChoice${inRedemption ? " current" : ""}`}>
        <b>Physical Ownership（現物を引き取る）</b>
        {inRedemption && asset.redemption ? (
          <span>{redemptionStatusLabel[asset.redemption.status]}。下の「引き取り手続き」で進めます</span>
        ) : (
          <>
            <span>現物を手元に引き取ります。Assetは失効し、来歴はPassportに残ります（dry run）</span>
            <button className="secondary" onClick={() => setOpen(true)}>現物の引き取りを申請（dry run）</button>
          </>
        )}
      </div>

      {open && (
        <div className="overlay" onMouseDown={() => !busy && setOpen(false)}>
          <section className="confirmBox" role="dialog" aria-modal="true" aria-labelledby={`redeemTitle-${asset.id}`} onMouseDown={(e) => e.stopPropagation()}>
            <div className="eyebrow">DEVNET · REDEEM · DRY RUN</div>
            <h2 id={`redeemTitle-${asset.id}`}>{displayTitle(asset, lang)}</h2>
            <p className="workName">現物の引き取りを申請します</p>
            <ul className="confirmList">
              <li>流通するAssetは止まります（Phantomで署名するとTwinfoldのescrowへ移り、あなたの壁から消えます）。受取確認後にAssetは失効（burn）します。</li>
              <li>引き取り後に再流通させるには、再確認（Trust Gate）とTwinfold Vaultへのre-vaultが必要です。</li>
              <li>このデモでは実配送はしません。配送先（氏名・住所・電話）も記録しません。</li>
              <li>Passportは引き取りまでの来歴と最終確認状態の記録で、引き取り後の所有者・現物の状態・真正性を保証するものではありません。</li>
            </ul>
            {rd.notice && <p className="emptyState small" role="alert">{rd.notice}</p>}
            <div className="linkActions">
              <button className="primary" disabled={busy} onClick={() => void confirm()}>{busy ? "処理中…" : "申請する（dry run）"}</button>
              <button className="secondary" disabled={busy} onClick={() => setOpen(false)}>キャンセル</button>
            </div>
          </section>
        </div>
      )}
    </div>
  );
}
