"use client";

import Image from "next/image";
import { useEffect, useState, type KeyboardEvent } from "react";
import { MockAssetProvider } from "../lib/providers/mockAssetProvider";
import { SolanaAssetProvider } from "../lib/providers/solanaAssetProvider";
import type { TwinfoldAsset } from "../lib/contract";
import { browse, custodyText, detail, devnetFeature, devnetSection, eventCount, hero, spatialCategory, spatialShort } from "../lib/copy/landing";
import { displayTitle } from "../lib/displayTitle";
import { useI18n } from "../lib/i18n";
import { explorerAddressUrl, shortAddress } from "../lib/labels";
import { Carousel } from "../components/Carousel";
import { OnchainFeature } from "../components/OnchainFeature";
import { ProvenanceList } from "../components/ProvenanceList";
import { VaultAcquisitionSection } from "../components/VaultAcquisitionSection";
import walletsFixture from "../lib/fixtures/demo/wallets.json";

type WalletEntry = { label: string; address: string };
type DevnetStatus = "loading" | "unconfigured" | "error" | "ready";

const wallets = walletsFixture as Record<string, WalletEntry>;

const provider = new MockAssetProvider();
const solanaProvider = new SolanaAssetProvider();

const COMING_SOON_SHELF = 2;
const COMING_SOON_CARDS = 3;

/** Discover: public view. Fixture reference assets (DEMO DATA) + public devnet assets (DEVNET). */
export default function Home() {
  const [allAssets, setAllAssets] = useState<TwinfoldAsset[]>([]);
  const [selected, setSelected] = useState<TwinfoldAsset | null>(null);
  const [notice, setNotice] = useState("");
  const [devnetAssets, setDevnetAssets] = useState<TwinfoldAsset[]>([]);
  const [devnetStatus, setDevnetStatus] = useState<DevnetStatus>("loading");
  const { lang, t } = useI18n();
  const title = (asset: TwinfoldAsset) => displayTitle(asset, lang);
  const wallAssets = allAssets.filter((asset) => spatialCategory(asset) === "wall");
  const shelfAssets = allAssets.filter((asset) => spatialCategory(asset) === "shelf");
  // Display-only order for the landing slideshow: Reference Assets first, then rehearsal tokens, then assets without an image (pipeline tests).
  const liveRank = (asset: TwinfoldAsset) => (!asset.display.imageUrl ? 2 : asset.rehearsal ? 1 : 0);
  const liveAssets = [...devnetAssets].sort((a, b) => liveRank(a) - liveRank(b));
  const [liveIndex, setLiveIndex] = useState(0);
  const liveCurrent = liveAssets[Math.min(liveIndex, liveAssets.length - 1)];
  const selectedIsDevnet = selected !== null && devnetAssets.includes(selected);

  useEffect(() => {
    let cancelled = false;
    Promise.all(Object.values(wallets).map((entry) => provider.getAssets(entry.address))).then((lists) => {
      if (cancelled) return;
      const merged = new Map<string, TwinfoldAsset>();
      // Collectibles AR demo cards live under /pull and /collection; this (dormant ukiyo-e) landing keeps its own works only.
      lists.flat().filter((asset) => asset.category !== "card").forEach((asset) => merged.set(asset.id, asset));
      setAllAssets(Array.from(merged.values()));
    });
    return () => {
      cancelled = true;
    };
  }, []);

  useEffect(() => {
    let cancelled = false;
    solanaProvider
      .listConfiguredAssetIds()
      .then(async (assetIds) => {
        if (cancelled) return;
        if (assetIds.length === 0) {
          setDevnetStatus("unconfigured");
          return;
        }
        const results = await Promise.allSettled(assetIds.map((id) => solanaProvider.getAsset(id)));
        if (cancelled) return;
        const loaded = results
          .filter((r): r is PromiseFulfilledResult<TwinfoldAsset> => r.status === "fulfilled")
          .map((r) => r.value);
        const failed = results.filter((r): r is PromiseRejectedResult => r.status === "rejected");
        failed.forEach((r) => console.warn("Devnet asset failed to load", r.reason));
        setDevnetAssets(loaded);
        setDevnetStatus(loaded.length === 0 ? "error" : "ready");
      })
      .catch((error) => {
        if (cancelled) return;
        console.warn("Devnet assets failed to load", error);
        setDevnetStatus("error");
      });
    return () => {
      cancelled = true;
    };
  }, []);

  useEffect(() => {
    if (!selected) return;
    const onKey = (event: globalThis.KeyboardEvent) => {
      if (event.key === "Escape") setSelected(null);
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [selected]);

  function showNotice(message: string) {
    setNotice(message);
    window.setTimeout(() => setNotice(""), 2600);
  }

  function openOnKey(event: KeyboardEvent<HTMLElement>, asset: TwinfoldAsset) {
    if (event.key === "Enter" || event.key === " ") {
      event.preventDefault();
      setSelected(asset);
    }
  }

  function categoryHeader(eyebrow: string, heading: string) {
    return (
      <div>
        <span>{eyebrow}</span>
        <h3>{heading}</h3>
      </div>
    );
  }

  function assetCard(item: TwinfoldAsset, demoTag: boolean) {
    return (
      <article
        className="card"
        key={item.id}
        role="button"
        tabIndex={0}
        onClick={() => setSelected(item)}
        onKeyDown={(event) => openOnKey(event, item)}
      >
        <div className="cardImage"><Image className="contain" src={item.display.imageUrl} alt={title(item)} fill sizes="300px" /></div>
        <div className="cardMeta">
          <span>{t(spatialShort[spatialCategory(item)])}</span>
          {demoTag && <span>{t(browse.demoTag)}</span>}
        </div>
        <h3>{title(item)}</h3>
        <div className="price"><strong>{t(eventCount(item.provenance.length))}</strong></div>
      </article>
    );
  }

  function devnetCard(item: TwinfoldAsset) {
    const custody = item.physical?.custody.status;
    return (
      <article
        className="card"
        key={item.id}
        role="button"
        tabIndex={0}
        onClick={() => setSelected(item)}
        onKeyDown={(event) => openOnKey(event, item)}
      >
        <div className="cardImage"><Image className="contain" src={item.display.imageUrl} alt={title(item)} fill sizes="300px" /></div>
        <div className="cardMeta">
          <span>{custody ? t(custodyText[custody]) : "—"}</span>
          <span>{t(devnetFeature.owner)} {item.owner ? shortAddress(item.owner) : t(detail.unowned)}</span>
        </div>
        <h3>{title(item)}</h3>
      </article>
    );
  }

  function comingSoonCards(count: number, prefix: string) {
    return Array.from({ length: count }, (_, index) => (
      <div className="comingCard" key={`${prefix}-${index}`} aria-hidden="true">
        <div className="comingFrame">{t(browse.comingSoon)}</div>
      </div>
    ));
  }

  return (
    <main>
      <section className="hero shell">
        <div className="eyebrow">PHYSICAL × ONCHAIN × AR</div>
        <h1>Own it on Solana.<br /><em>Pin it in AR.</em></h1>
        <p>{t(hero.lead)}</p>
        <button className="primary" onClick={() => document.getElementById("vault-assets")?.scrollIntoView({ behavior: "smooth" })}>
          {t(hero.cta)} <span>↘</span>
        </button>
        <div className="heroArt" aria-hidden="true">
          <div className="frame front"><Image src="/artworks/ukiyoe-demo.png" alt="" fill priority sizes="360px" /></div>
          <div className="seal">CATEGORY 01<br /><b>UKIYO-E</b><br />WALL PRINTS</div>
        </div>
        <div className="proofRow">
          {hero.proof.map((item) => <span key={item.en}>{t(item)}</span>)}
        </div>
      </section>

      <VaultAcquisitionSection />

      {devnetStatus !== "unconfigured" && !(devnetStatus === "ready" && liveAssets.length === 0) && (
        <section className="works shell devnetSection" id="devnet-assets">
          {devnetStatus === "ready" && liveCurrent ? (
            <>
              <div className="sectionTitle">
                <div>
                  <span>{t(devnetSection.eyebrow)}</span>
                  <h2>{t(devnetSection.heading)}</h2>
                </div>
                <div className="carouselTools">
                  <span className="demoBadge">DEVNET</span>
                  {liveAssets.length > 1 && (
                    <>
                      <span className="slideCount" aria-live="polite">
                        {liveAssets.indexOf(liveCurrent) + 1} / {liveAssets.length}
                      </span>
                      <div className="carouselButtons">
                        <button
                          type="button"
                          className="carouselBtn"
                          aria-label={t(devnetFeature.previous)}
                          disabled={liveAssets.indexOf(liveCurrent) === 0}
                          onClick={() => setLiveIndex(liveAssets.indexOf(liveCurrent) - 1)}
                        >←</button>
                        <button
                          type="button"
                          className="carouselBtn"
                          aria-label={t(devnetFeature.next)}
                          disabled={liveAssets.indexOf(liveCurrent) === liveAssets.length - 1}
                          onClick={() => setLiveIndex(liveAssets.indexOf(liveCurrent) + 1)}
                        >→</button>
                      </div>
                    </>
                  )}
                </div>
              </div>
              <OnchainFeature key={liveCurrent.id} asset={liveCurrent} />
            </>
          ) : (
            <Carousel
              label={t(devnetSection.heading)}
              header={(
                <div>
                  <span>{t(devnetSection.eyebrow)}</span>
                  <h2>{t(devnetSection.heading)}</h2>
                </div>
              )}
              badge={<span className="demoBadge">DEVNET</span>}
              placeholder={
                devnetStatus === "loading" ? (
                  <p className="emptyState">{t(devnetSection.loading)}</p>
                ) : devnetStatus === "error" ? (
                  <p className="emptyState">{t(devnetSection.error)}</p>
                ) : undefined
              }
            >
              {liveAssets.map((asset) => devnetCard(asset))}
            </Carousel>
          )}
        </section>
      )}

      <section className="works shell" id="works">
        <div className="sectionTitle">
          <div><span>{t(browse.eyebrow)}</span><h2>{t(browse.heading)}</h2></div>
          <span className="demoBadge">DEMO DATA</span>
        </div>

        <div className="categories">
          <Carousel
            headClassName="categoryHead"
            label={t(browse.ukiyoe.title)}
            header={categoryHeader(t(browse.ukiyoe.eyebrow), t(browse.ukiyoe.title))}
          >
            {wallAssets.map((item) => assetCard(item, false))}
          </Carousel>

          <Carousel
            headClassName="categoryHead"
            label={t(browse.shelf.title)}
            header={categoryHeader(t(browse.shelf.eyebrow), t(browse.shelf.title))}
          >
            {shelfAssets.map((item) => assetCard(item, true))}
            {comingSoonCards(COMING_SOON_SHELF, "shelf")}
          </Carousel>

          <Carousel
            headClassName="categoryHead"
            label={t(browse.cards.title)}
            header={categoryHeader(t(browse.cards.eyebrow), t(browse.cards.title))}
          >
            {comingSoonCards(COMING_SOON_CARDS, "cards")}
          </Carousel>
        </div>
      </section>

      {selected && (
        <div className="overlay" onMouseDown={() => setSelected(null)}>
          <section className="detail" role="dialog" aria-modal="true" aria-label={title(selected)} onMouseDown={(event) => event.stopPropagation()}>
            <button className="close" aria-label={t(detail.close)} onClick={() => setSelected(null)}>×</button>
            <div className="detailImage"><Image src={selected.display.imageUrl} alt={title(selected)} fill sizes="50vw" /></div>
            <div className="detailBody">
              <div className="eyebrow"><span className="demoBadge">{selectedIsDevnet ? "DEVNET" : "DEMO DATA"}</span></div>
              <h2>{title(selected)}</h2>
              <p className="workName">
                {selectedIsDevnet ? (
                  <>
                    <a href={explorerAddressUrl(selected.address)} target="_blank" rel="noreferrer" title={selected.address}>{shortAddress(selected.address)} ↗</a>
                    {" · "}{t(detail.owner)}:{" "}
                    {selected.owner ? (
                      <a href={explorerAddressUrl(selected.owner)} target="_blank" rel="noreferrer" title={selected.owner}>{shortAddress(selected.owner)} ↗</a>
                    ) : t(detail.unowned)}
                  </>
                ) : (
                  <>{selected.address} · {t(detail.owner)}: {selected.owner ? shortAddress(selected.owner) : t(detail.unowned)}</>
                )}
              </p>
              <p className="description">{selected.display.rightsNote}</p>

              <dl>
                <div><dt>Asset ID</dt><dd>{selected.id}</dd></div>
                <div><dt>{t(detail.display)}</dt><dd>{t(spatialShort[spatialCategory(selected)])}</dd></div>
              </dl>

              {selected.physical && (
                <div className="physicalBlock">
                  <div className="eyebrow">{t(detail.physical)}</div>
                  <dl>
                    <div><dt>{t(detail.physicalId)}</dt><dd>{selected.physical.physicalId}</dd></div>
                    <div><dt>{t(detail.condition)}</dt><dd>{selected.physical.condition}</dd></div>
                    <div><dt>{t(detail.custody)}</dt><dd>{selected.physical.custody.vault} ({t(custodyText[selected.physical.custody.status])})</dd></div>
                    <div><dt>{t(detail.lastVerified)}</dt><dd>{selected.physical.lastVerifiedAt}</dd></div>
                  </dl>
                  <p className="description small">{selected.physical.rights}</p>
                </div>
              )}

              <div className="eyebrow">{t(detail.provenance)}</div>
              <ProvenanceList asset={selected} demo={!selectedIsDevnet} variant="timeline" />

              <div className="detailActions">
                <button className="primary" onClick={() => showNotice(t(detail.toast))}>{t(detail.viewInAr)}</button>
              </div>
            </div>
          </section>
        </div>
      )}

      {notice && <div className="toast">{notice}</div>}
    </main>
  );
}
