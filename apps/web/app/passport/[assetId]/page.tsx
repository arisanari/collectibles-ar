"use client";

import Image from "next/image";
import Link from "next/link";
import { use, useEffect, useState } from "react";
import type { RedeemedProvenancePassport } from "../../../lib/contract";
import { explorerAddressUrl, explorerTxUrl } from "../../../lib/labels";
import { useI18n, type Localized } from "../../../lib/i18n";
import { ProvenanceList } from "../../../components/ProvenanceList";

const text = {
  loading: { en: "Loading…", ja: "読み込み中…" },
  missing: {
    en: "No Passport has been issued for this work yet (it is issued once redemption is complete).",
    ja: "この作品のPassportはまだ発行されていません（引き取りが完了すると発行されます）",
  },
  error: {
    en: "Could not load the Passport. Please wait a moment and reload.",
    ja: "Passportを読み込めませんでした。時間をおいて再読み込みしてください",
  },
  backToDiscover: { en: "Back to Discover", ja: "Discoverへ戻る" },
  rehearsalTitle: {
    en: "A rehearsal token for the redeem dry run. Not a Reference Asset.",
    ja: "redeem dry run用のリハーサルToken。Reference Assetではありません",
  },
  dryRun: { en: "DRY RUN · no real shipping", ja: "DRY RUN · 実配送なし" },
  subtitle: {
    en: "Provenance record of a retired Asset (up to Vault exit)",
    ja: "失効済みAssetの来歴記録（Vault退出まで）",
  },
  notGuaranteeTitle: { en: "What this Passport does not show", ja: "このPassportが示さないこと" },
  imageCaption: {
    en: "Record image as of Vault exit. It does not show that the work is authentic.",
    ja: "Vault退出時点の記録画像です（作品の真正性を示すものではありません）",
  },
  retiredSuffix: { en: " (retired)", ja: "（失効済み）" },
  onchainBurn: { en: "On-chain (burn)", ja: "On-chain（burn）" },
  interpretationNote: {
    en: "OshiPin interpretation (not an appraisal)",
    ja: "OshiPin interpretation（鑑定ではない）",
  },
  signaturesTitle: { en: "Onchain signatures (devnet)", ja: "Onchain signatures（devnet）" },
  lockLabel: { en: "Lock (out of circulation)", ja: "Lock（流通停止）" },
  retireLabel: { en: "Retire (burn)", ja: "Retire（burn）" },
  provenanceTitle: { en: "Provenance (up to Vault exit)", ja: "Provenance（Vault退出まで）" },
  provenanceNote: {
    en: "On-chain, Off-chain evidence and OshiPin interpretation are shown separately. The dry-run steps involve no real shipping.",
    ja: "On-chain / Off-chain evidence / OshiPin interpretation を区別して表示します。dry runの手順は実配送を伴いません。",
  },
} satisfies Record<string, Localized>;

type Load = { state: "loading" } | { state: "missing" } | { state: "error" } | { state: "ready"; passport: RedeemedProvenancePassport };

/**
 * Public Redeemed Provenance Passport (Issue #28 / #42). A record of provenance and the last verified state
 * UP TO Vault exit. It does NOT guarantee the current owner, the current condition, or authenticity.
 */
export default function PassportPage({ params }: { params: Promise<{ assetId: string }> }) {
  const { assetId } = use(params);
  const { lang, t } = useI18n();
  const [load, setLoad] = useState<Load>({ state: "loading" });

  useEffect(() => {
    let cancelled = false;
    fetch(`/api/passports/${encodeURIComponent(assetId)}`, { cache: "no-store" })
      .then(async (res) => {
        if (cancelled) return;
        if (res.status === 404) return setLoad({ state: "missing" });
        if (!res.ok) return setLoad({ state: "error" });
        setLoad({ state: "ready", passport: (await res.json()) as RedeemedProvenancePassport });
      })
      .catch(() => !cancelled && setLoad({ state: "error" }));
    return () => {
      cancelled = true;
    };
  }, [assetId]);

  if (load.state === "loading") return <main className="shell passportPage"><p className="emptyState">{t(text.loading)}</p></main>;
  if (load.state === "missing" || load.state === "error") {
    return (
      <main className="shell passportPage">
        <div className="eyebrow">REDEEMED PROVENANCE PASSPORT</div>
        <h1>Passport</h1>
        <p className="emptyState" role={load.state === "error" ? "alert" : undefined}>
          {load.state === "missing" ? t(text.missing) : t(text.error)}
        </p>
        <Link href="/" className="secondary linkButton">{t(text.backToDiscover)}</Link>
      </main>
    );
  }

  const p = load.passport;
  const isJa = lang.toLowerCase().startsWith("ja");
  const title = (isJa ? p.titleLocalized?.ja : undefined) ?? p.titleLocalized?.en ?? p.title;

  return (
    <main className="shell passportPage">
      <div className="passportBadges">
        <span className="demoBadge">DEVNET</span>
        {p.rehearsal && <span className="demoBadge rehearsalBadge" title={t(text.rehearsalTitle)}>REHEARSAL</span>}
        {p.dryRun && <span className="demoBadge">{t(text.dryRun)}</span>}
      </div>
      <div className="eyebrow">REDEEMED PROVENANCE PASSPORT</div>
      <h1>{title}</h1>
      <p className="workName">{t(text.subtitle)}</p>

      <section className="notGuarantee" aria-labelledby="notGuaranteeTitle" role="note">
        <h2 id="notGuaranteeTitle">{t(text.notGuaranteeTitle)}</h2>
        <ul>
          {p.limitations.map((line) => (
            <li key={line}>{line}</li>
          ))}
        </ul>
        <p>{p.xrConditions}</p>
      </section>

      <div className="passportGrid">
        {p.imageUrl && (
          <figure className="passportImage">
            <Image src={p.imageUrl} alt={title} width={320} height={400} className="thumbImg" />
            <figcaption>{t(text.imageCaption)}</figcaption>
          </figure>
        )}
        <dl className="passportFacts">
          <div>
            <dt>Source Asset<small>On-chain</small></dt>
            <dd className="breakAll"><a href={explorerAddressUrl(p.sourceAsset)} target="_blank" rel="noreferrer">{p.sourceAsset}</a>{t(text.retiredSuffix)}</dd>
          </div>
          <div>
            <dt>Physical ID<small>Off-chain evidence</small></dt>
            <dd>{p.physicalId}</dd>
          </div>
          <div>
            <dt>Redeemed at<small>{t(text.onchainBurn)}</small></dt>
            <dd>{p.redeemedAt}</dd>
          </div>
          <div>
            <dt>Last verified<small>Off-chain evidence</small></dt>
            <dd>{p.lastVerifiedAt}</dd>
          </div>
          <div>
            <dt>Condition at last verification<small>{t(text.interpretationNote)}</small></dt>
            <dd>{p.lastVerifiedCondition}</dd>
          </div>
          <div>
            <dt>Custody at exit<small>Off-chain evidence</small></dt>
            <dd>{p.custodyAtExit}</dd>
          </div>
        </dl>
      </div>

      <section className="passportSection">
        <h2>{t(text.signaturesTitle)}</h2>
        <ul className="signatureList">
          {p.onchain.mint && <li>Mint: <a href={explorerTxUrl(p.onchain.mint)} target="_blank" rel="noreferrer">{p.onchain.mint}</a></li>}
          {p.onchain.transfers.map((sig) => (
            <li key={sig}>Transfer: <a href={explorerTxUrl(sig)} target="_blank" rel="noreferrer">{sig}</a></li>
          ))}
          {p.onchain.lock && <li>{t(text.lockLabel)}: <a href={explorerTxUrl(p.onchain.lock)} target="_blank" rel="noreferrer">{p.onchain.lock}</a></li>}
          {p.onchain.retire && <li>{t(text.retireLabel)}: <a href={explorerTxUrl(p.onchain.retire)} target="_blank" rel="noreferrer">{p.onchain.retire}</a></li>}
        </ul>
      </section>

      <section className="passportSection">
        <h2>{t(text.provenanceTitle)}</h2>
        <p className="emptyState small">{t(text.provenanceNote)}</p>
        <ProvenanceList asset={{ provenance: p.provenance }} demo={false} />
      </section>
    </main>
  );
}
