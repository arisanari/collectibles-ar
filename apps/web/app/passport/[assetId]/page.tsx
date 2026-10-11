"use client";

import Image from "next/image";
import Link from "next/link";
import { use, useEffect, useState } from "react";
import type { RedeemedProvenancePassport, TwinfoldAsset } from "../../../lib/contract";
import { cardPassportUi } from "../../../lib/copy/pull";
import { explorerAddressUrl, explorerTxUrl } from "../../../lib/labels";
import { useI18n, type Localized } from "../../../lib/i18n";
import { MockAssetProvider } from "../../../lib/providers/mockAssetProvider";
import { SolanaAssetProvider } from "../../../lib/providers/solanaAssetProvider";
import { CardAssetCard } from "../../../components/CardAssetCard";
import { useAuth } from "../../../components/AuthProvider";
import { ProvenanceList } from "../../../components/ProvenanceList";

const mockProvider = new MockAssetProvider();
const solanaProvider = new SolanaAssetProvider();

// Collector Crypt's gacha site for the network the card is on (devnet card: dev-gacha, mainnet card: gacha).
const gachaSiteUrl = (network: "devnet" | "mainnet") =>
  network === "mainnet" ? "https://gacha.collectorcrypt.com" : "https://dev-gacha.collectorcrypt.com";

const isDemoCardId = (id: string) => id.startsWith("tf-card-DEMO-");
const looksLikeCardId = (id: string) => id.startsWith("tf-card-");

const text = {
  loading: { en: "Loading…" },
  missing: {
    en: "No Passport has been issued for this work yet (it is issued once redemption is complete).",
  },
  error: {
    en: "Could not load the Passport. Please wait a moment and reload.",
  },
  backToDiscover: { en: "Back to Discover" },
  rehearsalTitle: {
    en: "A rehearsal token for the redeem dry run. Not a Reference Asset.",
  },
  dryRun: { en: "DRY RUN · no real shipping" },
  subtitle: {
    en: "Provenance record of a retired Asset (up to Vault exit)",
  },
  notGuaranteeTitle: { en: "What this Passport does not show" },
  imageCaption: {
    en: "Record image as of Vault exit. It does not show that the work is authentic.",
  },
  retiredSuffix: { en: " (retired)" },
  onchainBurn: { en: "On-chain (burn)" },
  interpretationNote: {
    en: "Collectibles AR interpretation (not an appraisal)",
  },
  signaturesTitle: { en: "Onchain signatures (devnet)" },
  lockLabel: { en: "Lock (out of circulation)" },
  retireLabel: { en: "Retire (burn)" },
  provenanceTitle: { en: "Provenance (up to Vault exit)" },
  provenanceNote: {
    en: "On-chain, Off-chain evidence and Collectibles AR interpretation are shown separately. The dry-run steps involve no real shipping.",
  },
} satisfies Record<string, Localized>;

type Load =
  | { state: "loading" }
  | { state: "missing" }
  | { state: "error" }
  | { state: "ready"; passport: RedeemedProvenancePassport }
  | { state: "card"; asset: TwinfoldAsset; demo: boolean; fetchedAt: string };

/**
 * A graded card (category "card") for this id or mint: the DEMO fixture without any network, otherwise the signed-in
 * wallet's devnet cards, then its mainnet cards (read-only). null when it is not a card the wallet holds.
 */
async function findCard(assetId: string, wallet: string | null): Promise<{ asset: TwinfoldAsset; demo: boolean } | null> {
  if (isDemoCardId(assetId)) {
    const asset = await mockProvider.getAsset(assetId).catch(() => null);
    return asset?.category === "card" ? { asset, demo: true } : null;
  }
  if (!wallet) return null;
  const pick = (assets: TwinfoldAsset[]) => assets.find((a) => a.category === "card" && (a.id === assetId || a.address === assetId));
  const devnet = pick(await solanaProvider.getAssets(wallet).catch(() => []));
  if (devnet) return { asset: devnet, demo: false };
  const mainnet = pick(await solanaProvider.getMainnetCards(wallet).catch(() => []));
  return mainnet ? { asset: mainnet, demo: false } : null;
}

/**
 * Public Redeemed Provenance Passport (Issue #28 / #42). A record of provenance and the last verified state
 * UP TO Vault exit. It does NOT guarantee the current owner, the current condition, or authenticity.
 */
export default function PassportPage({ params }: { params: Promise<{ assetId: string }> }) {
  const { assetId } = use(params);
  const { t } = useI18n();
  const auth = useAuth();
  const wallet = auth.status === "authenticated" ? auth.wallet : null;
  // A card that is not a DEMO fixture is read from the signed-in wallet, so wait for the session check first.
  const ready = isDemoCardId(assetId) || auth.sessionChecked;
  const key = `${assetId}|${wallet ?? ""}`;
  const [result, setResult] = useState<{ key: string; load: Load } | null>(null);

  useEffect(() => {
    if (!ready) return;
    let cancelled = false;
    const done = (load: Load) => !cancelled && setResult({ key, load });
    findCard(assetId, wallet)
      .then(async (card) => {
        if (cancelled) return;
        if (card) return done({ state: "card", asset: card.asset, demo: card.demo, fetchedAt: new Date().toISOString() });
        // Not a card: the redeemed provenance passport of a retired (dormant ukiyo-e) Asset.
        const res = await fetch(`/api/passports/${encodeURIComponent(assetId)}`, { cache: "no-store" });
        if (res.status === 404) return done({ state: "missing" });
        if (!res.ok) return done({ state: "error" });
        done({ state: "ready", passport: (await res.json()) as RedeemedProvenancePassport });
      })
      .catch(() => done({ state: "error" }));
    return () => {
      cancelled = true;
    };
  }, [assetId, wallet, key, ready]);

  const load: Load = ready && result?.key === key ? result.load : { state: "loading" };

  if (load.state === "loading") return <main className="shell passportPage"><p className="emptyState">{t(text.loading)}</p></main>;
  if (load.state === "card") {
    const { asset, demo, fetchedAt } = load;
    return (
      <main className="shell passportPage">
        <div className="eyebrow">{t(cardPassportUi.eyebrow)}</div>
        <h1>Passport</h1>
        <CardAssetCard asset={asset} demo={demo} fetchedAt={fetchedAt} />
        <p className="slabClaimNote">
          {t(cardPassportUi.buybackLine)}{" "}
          <a href={gachaSiteUrl(demo ? "devnet" : asset.network)} target="_blank" rel="noreferrer">{t(cardPassportUi.gachaSiteLink)}</a>
        </p>
      </main>
    );
  }
  if (load.state === "missing" || load.state === "error") {
    const needSignIn = load.state === "missing" && !wallet && looksLikeCardId(assetId);
    return (
      <main className="shell passportPage">
        <div className="eyebrow">{needSignIn ? t(cardPassportUi.eyebrow) : "REDEEMED PROVENANCE PASSPORT"}</div>
        <h1>Passport</h1>
        <p className="emptyState" role={load.state === "error" ? "alert" : undefined}>
          {needSignIn ? t(cardPassportUi.signInToView) : load.state === "missing" ? t(text.missing) : t(text.error)}
        </p>
        {needSignIn ? (
          <Link href="/collection" className="secondary linkButton">{t(cardPassportUi.openCollection)}</Link>
        ) : (
          <Link href="/" className="secondary linkButton">{t(text.backToDiscover)}</Link>
        )}
      </main>
    );
  }

  const p = load.passport;
  const title = p.titleLocalized?.en ?? p.title;

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
