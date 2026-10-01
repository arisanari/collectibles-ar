"use client";

import Image from "next/image";
import { useEffect, useState } from "react";
import { MockAssetProvider } from "../lib/providers/mockAssetProvider";
import { SolanaAssetProvider } from "../lib/providers/solanaAssetProvider";
import type { TwinfoldAsset } from "../lib/contract";
import { displayTitle } from "../lib/displayTitle";
import { custodyStatusLabel, shortAddress, spatialLabel } from "../lib/labels";
import { useLang } from "../lib/useLang";
import { AssetCard } from "../components/AssetCard";
import { ProvenanceList } from "../components/ProvenanceList";
import walletsFixture from "../lib/fixtures/demo/wallets.json";

type WalletEntry = { label: string; address: string };
type DevnetStatus = "loading" | "unconfigured" | "error" | "ready";

const wallets = walletsFixture as Record<string, WalletEntry>;

const provider = new MockAssetProvider();
const solanaProvider = new SolanaAssetProvider();

/** Discover: public view. Fixture reference assets (DEMO DATA) + public devnet assets (DEVNET). */
export default function Home() {
  const [allAssets, setAllAssets] = useState<TwinfoldAsset[]>([]);
  const [selected, setSelected] = useState<TwinfoldAsset | null>(null);
  const [notice, setNotice] = useState("");
  const [devnetAssets, setDevnetAssets] = useState<TwinfoldAsset[]>([]);
  const [devnetStatus, setDevnetStatus] = useState<DevnetStatus>("loading");
  const [devnetError, setDevnetError] = useState("");
  const lang = useLang();
  const title = (asset: TwinfoldAsset) => displayTitle(asset, lang);

  useEffect(() => {
    let cancelled = false;
    Promise.all(Object.values(wallets).map((entry) => provider.getAssets(entry.address))).then((lists) => {
      if (cancelled) return;
      const merged = new Map<string, TwinfoldAsset>();
      lists.flat().forEach((asset) => merged.set(asset.id, asset));
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
        setDevnetAssets(loaded);
        if (loaded.length === 0) {
          setDevnetStatus("error");
          setDevnetError(failed[0]?.reason instanceof Error ? failed[0].reason.message : "取得に失敗しました");
        } else {
          setDevnetStatus("ready");
          if (failed.length > 0) {
            setDevnetError(`${failed.length}件のAssetは取得に失敗しました`);
          }
        }
      })
      .catch((error) => {
        if (cancelled) return;
        setDevnetStatus("error");
        setDevnetError(error instanceof Error ? error.message : "取得に失敗しました");
      });
    return () => {
      cancelled = true;
    };
  }, []);

  function showNotice(message: string) {
    setNotice(message);
    window.setTimeout(() => setNotice(""), 2600);
  }

  return (
    <main>
      <section className="hero shell">
        <div className="eyebrow">PHYSICAL × DIGITAL TWIN</div>
        <h1>Own the provenance.<br /><em>Keep it real.</em></h1>
        <p>壁に掛ける浮世絵・古版画をReference Assetとして登録し、来歴・現物状態・保管をSolana devnet上で追跡する。棚のコレクティブル（郷土玩具・こけし等）にも対応。<br className="desktop" />表示中のデータはすべてfixtureです。</p>
        <button className="primary" onClick={() => document.getElementById("works")?.scrollIntoView({ behavior: "smooth" })}>
          Explore the assets <span>↘</span>
        </button>
        <div className="heroArt" aria-hidden="true">
          <div className="frame front"><Image src="/artworks/ukiyoe-demo.png" alt="" fill priority sizes="360px" /></div>
          <div className="seal">DEMO<br /><b>DATA</b><br />NOT ON CHAIN</div>
        </div>
        <div className="proofRow">
          <span>浮世絵 Reference Asset</span><span>Vault保管</span><span>Solana devnet接続（テストAsset）</span><span>XRギャラリー対応</span>
        </div>
      </section>

      <section className="works shell" id="works">
        <div className="sectionTitle">
          <div><span>REFERENCE ASSETS</span><h2>Available assets</h2></div>
          <div className="sectionTools">
            <p>{allAssets.length.toString().padStart(2, "0")} unique assets</p>
            <span className="demoBadge">DEMO DATA</span>
          </div>
        </div>
        {allAssets.length === 0 ? (
          <p className="emptyState">表示できるAssetがありません。</p>
        ) : (
          <div className="grid">
            {allAssets.map((item) => (
              <article className="card" key={item.id} onClick={() => setSelected(item)}>
                <div className="cardImage"><Image className="contain" src={item.display.imageUrl} alt={title(item)} fill sizes="(max-width: 700px) 100vw, 33vw" /></div>
                <div className="cardMeta"><span>FIXTURE · NOT ON CHAIN · {spatialLabel(item)}</span><span>Reference</span></div>
                <h3>{title(item)}</h3>
                <div className="price"><span>{item.address}</span><strong>{item.provenance.length} events</strong></div>
              </article>
            ))}
          </div>
        )}
      </section>

      <section className="works shell devnetSection" id="devnet-assets">
        <div className="sectionTitle">
          <div>
            <span>SOLANA DEVNET · ON-CHAIN</span>
            <h2>Devnet assets</h2>
          </div>
          <p className="demoBadge">DEVNET</p>
        </div>

        {devnetStatus === "loading" && <p className="emptyState">Devnet Assetを読み込み中…</p>}
        {devnetStatus === "unconfigured" && (
          <p className="emptyState">
            SOLANA_ASSET_ADDRESSESが未設定です。apps/web/.env.localに設定するとここにdevnet Assetが表示されます。
          </p>
        )}
        {devnetStatus === "error" && devnetAssets.length === 0 && (
          <p className="emptyState">Devnet Assetの取得に失敗しました: {devnetError}</p>
        )}
        {devnetStatus === "ready" && (
          <>
            {devnetError && <p className="emptyState small">{devnetError}</p>}
            <div className="grid devnetGrid">
              {devnetAssets.map((asset) => (
                <AssetCard key={asset.id} asset={asset} />
              ))}
            </div>
          </>
        )}
      </section>

      {selected && (
        <div className="overlay" onMouseDown={() => setSelected(null)}>
          <section className="detail" onMouseDown={(event) => event.stopPropagation()}>
            <button className="close" onClick={() => setSelected(null)}>×</button>
            <div className="detailImage"><Image src={selected.display.imageUrl} alt={title(selected)} fill sizes="50vw" /></div>
            <div className="detailBody">
              <div className="eyebrow">FIXTURE · NOT ON CHAIN · DEMO DATA</div>
              <h2>{title(selected)}</h2>
              <p className="workName">{selected.address} · owner: {selected.owner ? shortAddress(selected.owner) : "unowned"}</p>
              <p className="description">{selected.display.rightsNote}</p>

              <dl>
                <div><dt>Asset ID</dt><dd>{selected.id}</dd></div>
                <div><dt>Data</dt><dd>FIXTURE · NOT ON CHAIN</dd></div>
                <div><dt>Spatial</dt><dd>{spatialLabel(selected)}</dd></div>
              </dl>

              {selected.physical && (
                <div className="physicalBlock">
                  <div className="eyebrow">PHYSICAL</div>
                  <dl>
                    <div><dt>Physical ID</dt><dd>{selected.physical.physicalId}</dd></div>
                    <div><dt>Condition</dt><dd>{selected.physical.condition}</dd></div>
                    <div><dt>Custody</dt><dd>{selected.physical.custody.vault} ({custodyStatusLabel[selected.physical.custody.status]})</dd></div>
                    <div><dt>Last verified</dt><dd>{selected.physical.lastVerifiedAt}</dd></div>
                  </dl>
                  <p className="description small">{selected.physical.rights}</p>
                </div>
              )}

              <div className="eyebrow">PROVENANCE</div>
              <ProvenanceList asset={selected} demo />

              <div className="detailActions">
                <button className="primary" onClick={() => showNotice("Vision Proギャラリーへ同期しました（デモ）")}>空間ギャラリーで見る</button>
              </div>
            </div>
          </section>
        </div>
      )}

      {notice && <div className="toast">{notice}</div>}
    </main>
  );
}
