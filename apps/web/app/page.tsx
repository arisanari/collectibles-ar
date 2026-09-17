"use client";

import Image from "next/image";
import { useMemo, useState } from "react";
import { Collectible, collectibles } from "../lib/data";

type View = "discover" | "collection";

export default function Home() {
  const [view, setView] = useState<View>("discover");
  const [wallet, setWallet] = useState(false);
  const [selected, setSelected] = useState<Collectible | null>(null);
  const [redeeming, setRedeeming] = useState<Collectible | null>(null);
  const [notice, setNotice] = useState("");

  const items = useMemo(
    () => (view === "collection" ? collectibles.filter((item) => item.status === "所蔵中") : collectibles),
    [view],
  );

  function connectWallet() {
    setWallet((value) => !value);
    setNotice(wallet ? "ウォレットを切断しました" : "Phantomデモウォレットを接続しました");
    window.setTimeout(() => setNotice(""), 2600);
  }

  function submitRedeem() {
    setRedeeming(null);
    setNotice("Redeem申請を受け付けました。発送前まではキャンセルできます。");
    window.setTimeout(() => setNotice(""), 4200);
  }

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
          <button onClick={() => setNotice("Vaultの保管証明は各作品詳細から確認できます")}>Vault</button>
        </nav>
        <button className={wallet ? "wallet connected" : "wallet"} onClick={connectWallet}>
          <span className="statusDot" />{wallet ? "7Kp…2mQ" : "Connect wallet"}
        </button>
      </header>

      {view === "discover" ? (
        <section className="hero shell">
          <div className="eyebrow">PHYSICAL × DIGITAL TWIN</div>
          <h1>Collect what matters.<br /><em>Keep it alive.</em></h1>
          <p>鑑定されたアニメ原画、トレカ、フィギュアを守り、所有し、<br className="desktop" />あなたの空間に飾る。</p>
          <button className="primary" onClick={() => document.getElementById("works")?.scrollIntoView({ behavior: "smooth" })}>
            Explore the collection <span>↘</span>
          </button>
          <div className="heroArt" aria-hidden="true">
            <div className="frame back"><Image src="/collection/aquarius-figure.webp" alt="" fill sizes="300px" /></div>
            <div className="frame front"><Image src="/collection/asuka-genga.jpg" alt="" fill priority sizes="360px" /></div>
            <div className="seal">AUTHENTICATED<br /><b>01 / 01</b><br />ON SOLANA</div>
          </div>
          <div className="proofRow">
            <span>原画・トレカ・フィギュア</span><span>Vault保管</span><span>Solana所有証明</span><span>XRギャラリー対応</span>
          </div>
        </section>
      ) : (
        <section className="collectionHead shell">
          <div>
            <div className="eyebrow">YOUR ARCHIVE</div>
            <h1>My collection</h1>
            <p>{wallet ? "7Kp5…2mQ9 が所有する作品" : "デモコレクションを表示中"}</p>
          </div>
          <div className="collectionStat"><strong>02</strong><span>作品を保管中</span></div>
          <div className="collectionStat"><strong>¥1.72M</strong><span>推定コレクション価値</span></div>
        </section>
      )}

      <section className="works shell" id="works">
        <div className="sectionTitle">
          <div><span>{view === "discover" ? "CURATED RELEASE" : "OWNED WORK"}</span><h2>{view === "discover" ? "Available works" : "In your vault"}</h2></div>
          <p>{items.length.toString().padStart(2, "0")} unique pieces</p>
        </div>
        <div className="grid">
          {items.map((item) => (
            <article className="card" key={item.id} onClick={() => setSelected(item)}>
              <div className="cardImage"><Image className={item.category === "原画" || item.category === "セル画" ? "contain" : ""} src={item.image} alt={item.title} fill sizes="(max-width: 700px) 100vw, 33vw" /></div>
              <div className="cardMeta"><span>{item.category} · {item.year}</span><span className={item.status === "所蔵中" ? "owned" : ""}>{item.status}</span></div>
              <h3>{item.title}</h3>
              <div className="price"><span>{item.studio}</span><strong>{item.price} SOL</strong></div>
            </article>
          ))}
        </div>
      </section>

      <footer className="shell"><span>TWINFOLD / TOKYO</span><p>Physical heritage, spatially alive.</p><span>© 2026</span></footer>

      {selected && (
        <div className="overlay" onMouseDown={() => setSelected(null)}>
          <section className="detail" onMouseDown={(event) => event.stopPropagation()}>
            <button className="close" onClick={() => setSelected(null)}>×</button>
            <div className="detailImage"><Image src={selected.image} alt={selected.title} fill sizes="50vw" /></div>
            <div className="detailBody">
              <div className="eyebrow">{selected.category} / ONE OF ONE</div>
              <h2>{selected.title}</h2><p className="workName">{selected.work} · {selected.year}</p>
              <p className="description">{selected.description}</p>
              <dl><div><dt>鑑定証明</dt><dd>{selected.certificate}</dd></div><div><dt>Vault</dt><dd>{selected.vaultId}</dd></div><div><dt>Solana NFT</dt><dd>{selected.token}</dd></div></dl>
              {selected.status === "販売中" ? (
                <button className="primary full" onClick={() => setNotice(wallet ? "購入トランザクションのデモを開始しました" : "先にウォレットを接続してください")}>{selected.price} SOLで購入</button>
              ) : (
                <div className="detailActions"><button className="primary" onClick={() => setNotice("Vision Proギャラリーへ同期しました")}>空間ギャラリーで見る</button><button className="secondary" onClick={() => { setRedeeming(selected); setSelected(null); }}>Redeem</button></div>
              )}
            </div>
          </section>
        </div>
      )}

      {redeeming && (
        <div className="overlay">
          <section className="confirm">
            <div className="warning">!</div><div className="eyebrow">PHYSICAL REDEEM</div><h2>物理作品を引き出しますか？</h2>
            <p>Vaultから作品を発送後、対応するNFTはburnされ、XR展示権と二次流通権が失われます。この操作は発送後に取り消せません。</p>
            <div className="redeemItem"><Image src={redeeming.image} alt="" width={56} height={70} /><span><b>{redeeming.title}</b><small>{redeeming.vaultId}</small></span></div>
            <button className="danger" onClick={submitRedeem}>内容を理解して申請する</button><button className="textButton" onClick={() => setRedeeming(null)}>キャンセル</button>
          </section>
        </div>
      )}

      {notice && <div className="toast">{notice}</div>}
    </main>
  );
}
