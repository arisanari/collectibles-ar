"use client";

import Image from "next/image";
import { useEffect, useMemo, useRef, useState } from "react";
import { MockAssetProvider } from "../lib/providers/mockAssetProvider";
import { SolanaAssetProvider } from "../lib/providers/solanaAssetProvider";
import type { PhysicalDescriptor, ProvenanceEvent, TwinfoldAsset } from "../lib/contract";
import { useWalletAuth, type AuthStatus } from "../lib/auth/useWalletAuth";
import walletsFixture from "../lib/fixtures/demo/wallets.json";

type View = "discover" | "collection";
type WalletEntry = { label: string; address: string };
type DevnetStatus = "loading" | "unconfigured" | "error" | "ready";

const wallets = walletsFixture as Record<string, WalletEntry>;
const primaryWallet = wallets.walletA;

const authLabel: Record<AuthStatus, string> = {
  disconnected: "未接続",
  connecting: "接続中…",
  awaiting_signature: "Phantomで署名してください（費用なし・送金なし）",
  authenticated: "認証済み",
  rejected: "署名が拒否されました",
  expired: "有効期限切れ",
  switched: "ウォレットが切り替わりました",
  no_wallet: "Phantomが見つかりません",
  error: "認証エラー",
};

const provider = new MockAssetProvider();
const solanaProvider = new SolanaAssetProvider();

function explorerAddressUrl(address: string) {
  return `https://explorer.solana.com/address/${address}?cluster=devnet`;
}

function explorerTxUrl(signature: string) {
  return `https://explorer.solana.com/tx/${signature}?cluster=devnet`;
}

const kindLabel: Record<ProvenanceEvent["kind"], string> = {
  minted: "Minted",
  transferred: "Transferred",
  rwa_verified: "RWA Verified",
  vaulted: "Vaulted",
  redeemed: "Redeemed",
};

const custodyStatusLabel: Record<PhysicalDescriptor["custody"]["status"], string> = {
  vaulted: "Vaulted",
  released: "Released",
  exception: "Exception",
  pending_intake: "Vault登録前（自己保管）",
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
  const [devnetAssets, setDevnetAssets] = useState<TwinfoldAsset[]>([]);
  const [devnetStatus, setDevnetStatus] = useState<DevnetStatus>("loading");
  const [devnetError, setDevnetError] = useState("");
  const auth = useWalletAuth();
  const [ownedResult, setOwnedResult] = useState<{ wallet: string; assets: TwinfoldAsset[]; failed: boolean } | null>(null);
  const authedWallet = auth.status === "authenticated" ? auth.wallet : null;
  const [menuOpen, setMenuOpen] = useState(false);
  const scrollAfterSignIn = useRef(false);

  // After a user-initiated sign-in, reveal the MY DEVNET COLLECTION panel.
  useEffect(() => {
    if (authedWallet && scrollAfterSignIn.current) {
      scrollAfterSignIn.current = false;
      document.getElementById("devnet-assets")?.scrollIntoView({ behavior: "smooth" });
    }
  }, [authedWallet]);
  const ownedCurrent = authedWallet && ownedResult?.wallet === authedWallet ? ownedResult : null;
  const ownedDevnet = ownedCurrent?.assets ?? [];
  const ownedStatus = !authedWallet ? "idle" : !ownedCurrent ? "loading" : ownedCurrent.failed ? "error" : "ready";

  useEffect(() => {
    if (!authedWallet) return;
    let cancelled = false;
    solanaProvider
      .getAssets(authedWallet)
      .then((assets) => {
        if (!cancelled) setOwnedResult({ wallet: authedWallet, assets, failed: false });
      })
      .catch(() => {
        if (!cancelled) setOwnedResult({ wallet: authedWallet, assets: [], failed: true });
      });
    return () => {
      cancelled = true;
    };
  }, [authedWallet]);

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

  function revealDevnetPanel() {
    document.getElementById("devnet-assets")?.scrollIntoView({ behavior: "smooth" });
  }

  function startSignIn() {
    scrollAfterSignIn.current = true;
    void auth.connect();
  }

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
        <div className="walletMenuWrap">
          {authedWallet ? (
            <>
              <button className="wallet connected" aria-expanded={menuOpen} onClick={() => setMenuOpen((open) => !open)}>
                <span className="statusDot" />{shortAddress(authedWallet)} <span aria-hidden="true">▾</span>
              </button>
              {menuOpen && (
                <div className="walletMenu" role="menu">
                  <span className="demoBadge">DEVNET</span>
                  <button role="menuitem" onClick={() => { setMenuOpen(false); revealDevnetPanel(); }}>My devnet collection</button>
                  <button role="menuitem" onClick={() => { setMenuOpen(false); void auth.logout(); }}>Sign out</button>
                </div>
              )}
            </>
          ) : auth.status === "no_wallet" ? (
            <a className="wallet" href="https://phantom.com/download" target="_blank" rel="noreferrer">Install Phantom</a>
          ) : auth.status === "connecting" || auth.status === "awaiting_signature" ? (
            <button className="wallet" disabled>
              <span className="statusDot" />{auth.status === "connecting" ? "Connecting…" : "Sign in Phantom…"}
            </button>
          ) : (
            <button className="wallet" onClick={startSignIn}>
              <span className="statusDot" />
              {["rejected", "expired", "switched", "error"].includes(auth.status) ? "Retry" : "Connect Phantom"}
            </button>
          )}
        </div>
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
            <div className="frame front"><Image src="/artworks/ukiyoe-demo.png" alt="" fill priority sizes="360px" /></div>
            <div className="seal">DEMO<br /><b>DATA</b><br />NOT ON CHAIN</div>
          </div>
          <div className="proofRow">
            <span>浮世絵 Reference Asset</span><span>Vault保管</span><span>Solana devnet接続（テストAsset）</span><span>XRギャラリー対応</span>
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
          <div className="sectionTools">
            <p>{items.length.toString().padStart(2, "0")} unique assets</p>
            <button className="demoToggle" onClick={connectWallet} title="Fixtureのデモウォレット（Solanaには接続しません）">
              DEMO DATA · {walletConnected ? `デモウォレット ${shortAddress(primaryWallet.address)} を切断` : "デモウォレットで表示"}
            </button>
          </div>
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

      <section className="works shell devnetSection" id="devnet-assets">
        <div className="sectionTitle">
          <div>
            <span>SOLANA DEVNET · ON-CHAIN</span>
            <h2>Devnet assets</h2>
          </div>
          <p className="demoBadge">DEVNET</p>
        </div>

        <div className="authPanel">
          <div className="eyebrow">MY DEVNET COLLECTION</div>
          {authedWallet ? (
            <>
              <p className="authLine">
                <span className="statusDot" /> {shortAddress(authedWallet)} · {authLabel.authenticated}
                <button className="textButton" onClick={() => void auth.logout()}>Sign out</button>
              </p>
              {ownedStatus === "loading" && <p className="emptyState small">読み込み中…</p>}
              {ownedStatus === "error" && <p className="emptyState small">所有Assetの取得に失敗しました。</p>}
              {ownedStatus === "ready" && ownedDevnet.length === 0 && (
                <p className="emptyState small">このウォレットが所有するdevnet Assetはありません。</p>
              )}
              {ownedDevnet.length > 0 && (
                <ul className="ownedList">
                  {ownedDevnet.map((asset) => (
                    <li key={asset.id}>
                      <b>{asset.title}</b> <span className="demoBadge">DEVNET</span>
                      <a href={explorerAddressUrl(asset.address)} target="_blank" rel="noreferrer">{asset.address}</a>
                    </li>
                  ))}
                </ul>
              )}
            </>
          ) : (
            <>
              <p className="emptyState small">
                Phantom（devnet）で署名すると、あなたのウォレットが所有するAssetが表示されます。署名は無料で、送金は行われません。
                未認証の間は下の公開ビューのみ表示します。
              </p>
              <p className="authLine">状態: {authLabel[auth.status]}</p>
              {auth.detail && <p className="emptyState small" role="alert">{auth.detail}</p>}
              <button
                className="primary"
                disabled={auth.status === "connecting" || auth.status === "awaiting_signature"}
                onClick={() => void auth.connect()}
              >
                {auth.status === "rejected" || auth.status === "expired" || auth.status === "switched" || auth.status === "error"
                  ? "Retry sign-in"
                  : "Connect Phantom & sign in"}
              </button>
            </>
          )}
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
                <article className="devnetCard" key={asset.id}>
                  {asset.display.imageUrl && (
                    <div className="devnetCardThumb">
                      <Image src={asset.display.imageUrl} alt={asset.title} fill sizes="80px" className="contain" />
                    </div>
                  )}
                  <div className="cardMeta">
                    <span>{asset.standard} · {asset.network}</span>
                    <span>{asset.owner ? shortAddress(asset.owner) : "unowned"}</span>
                  </div>
                  <h3>{asset.title}</h3>
                  <p className="workName">
                    <a href={explorerAddressUrl(asset.address)} target="_blank" rel="noreferrer">
                      {asset.address}
                    </a>
                  </p>
                  <div className="eyebrow">PROVENANCE</div>
                  <ol className="provenanceList">
                    {sortedProvenance(asset).map((event) => (
                      <li className="provenanceItem" key={event.id}>
                        <div className="provenanceHead">
                          <strong>{kindLabel[event.kind]}</strong>
                          <span className={`statusTag ${event.status}`}>{event.status}</span>
                        </div>
                        <div className="provenanceMeta">
                          <span className="sourceTag">{sourceLabel[event.source]}</span>
                          <span>{event.occurredAt}</span>
                        </div>
                        {event.transaction && (
                          <div className="provenanceDetail">
                            tx:{" "}
                            <a href={explorerTxUrl(event.transaction)} target="_blank" rel="noreferrer">
                              {event.transaction}
                            </a>
                          </div>
                        )}
                      </li>
                    ))}
                  </ol>
                </article>
              ))}
            </div>
          </>
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
                    <div><dt>Custody</dt><dd>{selected.physical.custody.vault} ({custodyStatusLabel[selected.physical.custody.status]})</dd></div>
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
