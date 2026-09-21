"use client";

import Image from "next/image";
import { useEffect, useMemo, useState } from "react";
import { MockAssetProvider } from "../lib/providers/mockAssetProvider";
import type { ProvenanceEvent, TwinfoldAsset } from "../lib/contract";
import walletsFixture from "../lib/fixtures/demo/wallets.json";

type View = "discover" | "collection";
type WalletEntry = { label: string; address: string };

const wallets = walletsFixture as Record<string, WalletEntry>;
const primaryWallet = wallets.walletA;

const provider = new MockAssetProvider();

const kindLabel: Record<ProvenanceEvent["kind"], string> = {
  minted: "Minted",
  transferred: "Transferred",
  rwa_verified: "RWA Verified",
  vaulted: "Vaulted",
  redeemed: "Redeemed",
};

const sourceLabel: Record<ProvenanceEvent["source"], string> = {
  onchain: "On-chain",
  offchain_evidence: "Off-chain evidence",
  twinfold_interpretation: "Twinfold interpretation",
};

function sortedProvenance(asset: TwinfoldAsset) {
  return [...asset.provenance].sort((a, b) => a.occurredAt.localeCompare(b.occurredAt));
}

function shortAddress(address: string) {
  return address.length > 10 ? `${address.slice(0, 4)}…${address.slice(-4)}` : address;
}

/** Short label for `TwinfoldAsset.spatialRepresentation`, so the Web UI can
 * hint which client experience an asset gets: the flat image card, or a
 * real-world-scale USDZ twin placed next to the physical item in AR. */
function spatialLabel(asset: TwinfoldAsset) {
  return asset.spatialRepresentation.kind === "model"
    ? `3D twin · ${asset.spatialRepresentation.resource}`
    : "Card";
}

export default function Home() {
  const [view, setView] = useState<View>("discover");
  const [walletConnected, setWalletConnected] = useState(false);
  const [allAssets, setAllAssets] = useState<TwinfoldAsset[]>([]);
  const [myAssets, setMyAssets] = useState<TwinfoldAsset[]>([]);
  const [selected, setSelected] = useState<TwinfoldAsset | null>(null);
  const [redeeming, setRedeeming] = useState<TwinfoldAsset | null>(null);
  const [notice, setNotice] = useState("");

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
    if (!walletConnected) return;
    let cancelled = false;
    provider.getAssets(primaryWallet.address).then((list) => {
      if (!cancelled) setMyAssets(list);
    });
    return () => {
      cancelled = true;
    };
  }, [walletConnected]);

  const items = view === "collection" ? myAssets : allAssets;
  const vaultedCount = useMemo(
    () => myAssets.filter((asset) => asset.physical?.custody.status === "vaulted").length,
    [myAssets],
  );

  function connectWallet() {
    const next = !walletConnected;
    setWalletConnected(next);
    if (next) {
      provider.connect(primaryWallet.address);
      setNotice("Phantomデモウォレットを接続しました");
    } else {
      provider.disconnect();
      setMyAssets([]);
      setNotice("ウォレットを切断しました");
    }
    window.setTimeout(() => setNotice(""), 2600);
  }

  function submitRedeem() {
    setRedeeming(null);
    setNotice("Redeem申請を受け付けました（デモ、実配送は行いません）。発送前まではキャンセルできます。");
    window.setTimeout(() => setNotice(""), 4200);
  }

  const isOwnedByMe = (asset: TwinfoldAsset) => walletConnected && asset.owner === primaryWallet.address;

  return (
    <main>
      <header className="nav shell">
        <button className="brand" onClick={() => setView("discover")} aria-label="Twinfold home">
          <span className="brandMark"><i /><i /></span>
          TWINFOLD
        </button>
        <nav aria-label="Main navigation">
          <button className={view === "discover" ? "active" : ""} onClick={() => setView("discover")}>Discover</button>
          <button className={view === "collection" ? "active" : ""} onClick={() => setView("collection")}>Collection</button>
          <span className="demoBadge">{provider.isDemoData ? "DEMO DATA" : "DEVNET"}</span>
        </nav>
        <button className={walletConnected ? "wallet connected" : "wallet"} onClick={connectWallet}>
          <span className="statusDot" />{walletConnected ? shortAddress(primaryWallet.address) : "Connect wallet"}
        </button>
      </header>

      {view === "discover" ? (
        <section className="hero shell">
          <div className="eyebrow">PHYSICAL × DIGITAL TWIN</div>
          <h1>Own the provenance.<br /><em>Keep it real.</em></h1>
          <p>壁に掛ける浮世絵・古版画をReference Assetとして登録し、来歴・現物状態・保管をSolana devnet上で追跡する。棚のコレクティブル（郷土玩具・こけし等）にも対応。<br className="desktop" />表示中のデータはすべてfixtureです。</p>
          <button className="primary" onClick={() => document.getElementById("works")?.scrollIntoView({ behavior: "smooth" })}>
            Explore the assets <span>↘</span>
          </button>
          <div className="heroArt" aria-hidden="true">
            <div className="frame front"><Image src="/artworks/ukiyoe-placeholder.svg" alt="" fill priority sizes="360px" /></div>
            <div className="seal">DEMO<br /><b>DATA</b><br />NOT ON CHAIN</div>
          </div>
          <div className="proofRow">
            <span>浮世絵 Reference Asset</span><span>Vault保管</span><span>Solana devnet接続は未実装</span><span>XRギャラリー対応</span>
          </div>
        </section>
      ) : (
        <section className="collectionHead shell">
          <div>
            <div className="eyebrow">YOUR ARCHIVE</div>
            <h1>My collection</h1>
            <p>{walletConnected ? `${shortAddress(primaryWallet.address)} が所有するAsset` : "ウォレットを接続するとコレクションが表示されます"}</p>
          </div>
          <div className="collectionStat"><strong>{myAssets.length.toString().padStart(2, "0")}</strong><span>Assetを保管中</span></div>
          <div className="collectionStat"><strong>{vaultedCount.toString().padStart(2, "0")}</strong><span>Vault保管中</span></div>
        </section>
      )}

      <section className="works shell" id="works">
        <div className="sectionTitle">
          <div><span>{view === "discover" ? "REFERENCE ASSETS" : "OWNED ASSETS"}</span><h2>{view === "discover" ? "Available assets" : "In your vault"}</h2></div>
          <p>{items.length.toString().padStart(2, "0")} unique assets</p>
        </div>
        {view === "collection" && !walletConnected ? (
          <p className="emptyState">ウォレットを接続すると、あなたが所有するAssetが表示されます。</p>
        ) : items.length === 0 ? (
          <p className="emptyState">表示できるAssetがありません。</p>
        ) : (
          <div className="grid">
            {items.map((item) => (
              <article className="card" key={item.id} onClick={() => setSelected(item)}>
                <div className="cardImage"><Image className="contain" src={item.display.imageUrl} alt={item.title} fill sizes="(max-width: 700px) 100vw, 33vw" /></div>
                <div className="cardMeta"><span>{item.standard} · {item.network} · {spatialLabel(item)}</span><span className={isOwnedByMe(item) ? "owned" : ""}>{isOwnedByMe(item) ? "所蔵中" : "Reference"}</span></div>
                <h3>{item.title}</h3>
                <div className="price"><span>{item.address}</span><strong>{item.provenance.length} events</strong></div>
              </article>
            ))}
          </div>
        )}
      </section>

      <footer className="shell"><span>TWINFOLD / TOKYO</span><p>Real-world provenance, spatially alive.</p><span>© 2026</span></footer>

      {selected && (
        <div className="overlay" onMouseDown={() => setSelected(null)}>
          <section className="detail" onMouseDown={(event) => event.stopPropagation()}>
            <button className="close" onClick={() => setSelected(null)}>×</button>
            <div className="detailImage"><Image src={selected.display.imageUrl} alt={selected.title} fill sizes="50vw" /></div>
            <div className="detailBody">
              <div className="eyebrow">{selected.standard.toUpperCase()} / {selected.network.toUpperCase()}</div>
              <h2>{selected.title}</h2>
              <p className="workName">{selected.address} · owner: {selected.owner ? shortAddress(selected.owner) : "unowned"}</p>
              <p className="description">{selected.display.rightsNote}</p>

              <dl>
                <div><dt>Asset ID</dt><dd>{selected.id}</dd></div>
                <div><dt>Standard</dt><dd>{selected.standard}</dd></div>
                <div><dt>Network</dt><dd>{selected.network}</dd></div>
                <div><dt>Spatial</dt><dd>{spatialLabel(selected)}</dd></div>
              </dl>

              {selected.physical && (
                <div className="physicalBlock">
                  <div className="eyebrow">PHYSICAL</div>
                  <dl>
                    <div><dt>Physical ID</dt><dd>{selected.physical.physicalId}</dd></div>
                    <div><dt>Condition</dt><dd>{selected.physical.condition}</dd></div>
                    <div><dt>Custody</dt><dd>{selected.physical.custody.vault} ({selected.physical.custody.status})</dd></div>
                    <div><dt>Last verified</dt><dd>{selected.physical.lastVerifiedAt}</dd></div>
                  </dl>
                  <p className="description small">{selected.physical.rights}</p>
                </div>
              )}

              <div className="eyebrow">PROVENANCE</div>
              <ol className="provenanceList">
                {sortedProvenance(selected).map((event) => (
                  <li className="provenanceItem" key={event.id}>
                    <div className="provenanceHead">
                      <strong>{kindLabel[event.kind]}</strong>
                      <span className={`statusTag ${event.status}`}>{event.status}</span>
                    </div>
                    <div className="provenanceMeta">
                      <span className="sourceTag">{sourceLabel[event.source]}</span>
                      <span>{event.occurredAt}</span>
                    </div>
                    {event.transaction && <div className="provenanceDetail">tx: {event.transaction}</div>}
                    {event.evidenceHash && <div className="provenanceDetail">evidence: {event.evidenceHash}</div>}
                  </li>
                ))}
              </ol>

              <div className="detailActions">
                <button className="primary" onClick={() => setNotice("Vision Proギャラリーへ同期しました（デモ）")}>空間ギャラリーで見る</button>
                {isOwnedByMe(selected) && (
                  <button className="secondary" onClick={() => { setRedeeming(selected); setSelected(null); }}>Redeem</button>
                )}
              </div>
            </div>
          </section>
        </div>
      )}

      {redeeming && (
        <div className="overlay">
          <section className="confirm">
            <div className="warning">!</div><div className="eyebrow">PHYSICAL REDEEM</div><h2>物理現物を引き出しますか？</h2>
            <p>Vaultから現物を発送後、対応するAssetはlock／burnされ、XR展示権と二次流通権が失われます。この操作は発送後に取り消せません（デモでは実配送を行いません）。</p>
            <div className="redeemItem"><Image src={redeeming.display.imageUrl} alt="" width={56} height={70} /><span><b>{redeeming.title}</b><small>{redeeming.physical?.custody.vault ?? redeeming.address}</small></span></div>
            <button className="danger" onClick={submitRedeem}>内容を理解して申請する</button><button className="textButton" onClick={() => setRedeeming(null)}>キャンセル</button>
          </section>
        </div>
      )}

      {notice && <div className="toast">{notice}</div>}
    </main>
  );
}
