"use client";

import Image from "next/image";
import Link from "next/link";
import { use, useEffect, useState } from "react";
import type { RedeemedProvenancePassport } from "../../../lib/contract";
import { explorerAddressUrl, explorerTxUrl } from "../../../lib/labels";
import { useLang } from "../../../lib/useLang";
import { ProvenanceList } from "../../../components/ProvenanceList";

type Load = { state: "loading" } | { state: "missing" } | { state: "error" } | { state: "ready"; passport: RedeemedProvenancePassport };

/**
 * Public Redeemed Provenance Passport (Issue #28 / #42). A record of provenance and the last verified state
 * UP TO Vault exit. It does NOT guarantee the current owner, the current condition, or authenticity.
 */
export default function PassportPage({ params }: { params: Promise<{ assetId: string }> }) {
  const { assetId } = use(params);
  const lang = useLang();
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

  if (load.state === "loading") return <main className="shell passportPage"><p className="emptyState">読み込み中…</p></main>;
  if (load.state === "missing" || load.state === "error") {
    return (
      <main className="shell passportPage">
        <div className="eyebrow">REDEEMED PROVENANCE PASSPORT</div>
        <h1>Passport</h1>
        <p className="emptyState" role={load.state === "error" ? "alert" : undefined}>
          {load.state === "missing" ? "この作品のPassportはまだ発行されていません（引き取りが完了すると発行されます）" : "Passportを読み込めませんでした。時間をおいて再読み込みしてください"}
        </p>
        <Link href="/" className="secondary linkButton">Discoverへ戻る</Link>
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
        {p.rehearsal && <span className="demoBadge rehearsalBadge" title="redeem dry run用のリハーサルToken。Reference Assetではありません">REHEARSAL</span>}
        {p.dryRun && <span className="demoBadge">DRY RUN · 実配送なし</span>}
      </div>
      <div className="eyebrow">REDEEMED PROVENANCE PASSPORT</div>
      <h1>{title}</h1>
      <p className="workName">失効済みAssetの来歴記録（Vault退出まで）</p>

      <section className="notGuarantee" aria-labelledby="notGuaranteeTitle" role="note">
        <h2 id="notGuaranteeTitle">このPassportが示さないこと</h2>
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
            <figcaption>Vault退出時点の記録画像です（作品の真正性を示すものではありません）</figcaption>
          </figure>
        )}
        <dl className="passportFacts">
          <div>
            <dt>Source Asset<small>On-chain</small></dt>
            <dd className="breakAll"><a href={explorerAddressUrl(p.sourceAsset)} target="_blank" rel="noreferrer">{p.sourceAsset}</a>（失効済み）</dd>
          </div>
          <div>
            <dt>Physical ID<small>Off-chain evidence</small></dt>
            <dd>{p.physicalId}</dd>
          </div>
          <div>
            <dt>Redeemed at<small>On-chain（burn）</small></dt>
            <dd>{p.redeemedAt}</dd>
          </div>
          <div>
            <dt>Last verified<small>Off-chain evidence</small></dt>
            <dd>{p.lastVerifiedAt}</dd>
          </div>
          <div>
            <dt>Condition at last verification<small>Twinfold interpretation（鑑定ではない）</small></dt>
            <dd>{p.lastVerifiedCondition}</dd>
          </div>
          <div>
            <dt>Custody at exit<small>Off-chain evidence</small></dt>
            <dd>{p.custodyAtExit}</dd>
          </div>
        </dl>
      </div>

      <section className="passportSection">
        <h2>Onchain signatures（devnet）</h2>
        <ul className="signatureList">
          {p.onchain.mint && <li>Mint: <a href={explorerTxUrl(p.onchain.mint)} target="_blank" rel="noreferrer">{p.onchain.mint}</a></li>}
          {p.onchain.transfers.map((sig) => (
            <li key={sig}>Transfer: <a href={explorerTxUrl(sig)} target="_blank" rel="noreferrer">{sig}</a></li>
          ))}
          {p.onchain.lock && <li>Lock（流通停止）: <a href={explorerTxUrl(p.onchain.lock)} target="_blank" rel="noreferrer">{p.onchain.lock}</a></li>}
          {p.onchain.retire && <li>Retire（burn）: <a href={explorerTxUrl(p.onchain.retire)} target="_blank" rel="noreferrer">{p.onchain.retire}</a></li>}
        </ul>
      </section>

      <section className="passportSection">
        <h2>Provenance（Vault退出まで）</h2>
        <p className="emptyState small">On-chain / Off-chain evidence / Twinfold interpretation を区別して表示します。dry runの手順は実配送を伴いません。</p>
        <ProvenanceList asset={{ provenance: p.provenance }} demo={false} />
      </section>
    </main>
  );
}
