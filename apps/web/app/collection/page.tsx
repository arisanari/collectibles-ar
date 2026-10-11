"use client";

import Link from "next/link";
import { useEffect, useState } from "react";
import { MockAssetProvider } from "../../lib/providers/mockAssetProvider";
import { SolanaAssetProvider } from "../../lib/providers/solanaAssetProvider";
import type { TwinfoldAsset } from "../../lib/contract";
import type { AuthStatus } from "../../lib/auth/useWalletAuth";
import { shortAddress } from "../../lib/labels";
import { useI18n, type Localized } from "../../lib/i18n";
import { AssetCard } from "../../components/AssetCard";
import { CardAssetCard } from "../../components/CardAssetCard";
import { useAuth } from "../../components/AuthProvider";
import { DeviceLinkPanel } from "../../components/DeviceLinkPanel";
import { PendingRequestsPanel } from "../../components/PendingRequestsPanel";
import { OwnershipSection } from "../../components/OwnershipSection";
import { RedemptionPanel } from "../../components/RedemptionPanel";
import { useRedemptions } from "../../lib/redemptions/useRedemptions";
import { useTransferRequests } from "../../lib/transferRequests/useTransferRequests";
import walletsFixture from "../../lib/fixtures/demo/wallets.json";

// Collectibles AR: the DEMO DATA wallet owns the self-made dummy cards (walletA / walletB keep the earlier legacy fixture Assets).
const demoWallet = (walletsFixture as Record<string, { label: string; address: string }>).walletC;
const mockProvider = new MockAssetProvider();
const solanaProvider = new SolanaAssetProvider();

const authLabel: Record<AuthStatus, Localized> = {
  disconnected: { en: "Not connected" },
  connecting: { en: "Connecting…" },
  awaiting_signature: {
    en: "Sign in Phantom (no fee, no transfer)",
  },
  authenticated: { en: "Signed in" },
  rejected: { en: "Signature was rejected" },
  expired: { en: "Session expired" },
  switched: { en: "Wallet was switched" },
  no_wallet: { en: "Phantom not found" },
  error: { en: "Sign-in error" },
};

const text = {
  eyebrow: { en: "YOUR ARCHIVE" },
  title: { en: "My collection" },
  connectPrompt: {
    en: "Sign in with Phantom (devnet) to see the Assets your wallet owns. Signing is free and sends no funds.",
  },
  status: { en: "Status:" },
  retry: { en: "Retry sign-in" },
  connect: { en: "Connect Phantom" },
  demoTitle: {
    en: "Fixture demo wallet (does not connect to Solana)",
  },
  demoTry: { en: "Try with DEMO DATA" },
  demoNote: {
    en: "Showing the fixture demo wallet (not connected to Solana).",
  },
  demoOff: { en: "Leave DEMO DATA" },
  demoAsset: { en: "DEMO DATA Asset" },
  devnetAsset: { en: "devnet Asset" },
  loading: { en: "Loading…" },
  loadFailed: {
    en: "Could not load the Assets you own. Please wait a moment and reload.",
  },
  empty: {
    en: "This wallet owns no devnet Assets.",
  },
  pullAPack: { en: "Pull a pack" },
  sellTitle: {
    en: "Creates a request and asks Phantom to sign it (devnet, no payment)",
  },
  networkLabel: { en: "Network:" },
  networkDevnet: { en: "Devnet" },
  networkMainnet: { en: "Mainnet (read-only)" },
  mainnetNote: {
    en: "Display only. Pull, buyback and transfer are not done in this app.",
  },
  mainnetAsset: { en: "mainnet card" },
  mainnetEmpty: {
    en: "No Collector Crypt cards found in this wallet on mainnet.",
  },
  sell: { en: "Sell to Twinfold (legacy demo; approve in Phantom)" },
} satisfies Record<string, Localized>;

type Result = { key: string; assets: TwinfoldAsset[]; failed: boolean; fetchedAt: string };
type Network = "devnet" | "mainnet";

export default function CollectionPage() {
  const { t } = useI18n();
  const auth = useAuth();
  const authedWallet = auth.status === "authenticated" ? auth.wallet : null;
  const tr = useTransferRequests(authedWallet);
  const rd = useRedemptions(authedWallet, tr.refresh);
  // Reload the asset cards whenever a redemption changes state (a locked Asset leaves this wallet).
  const redemptionSignature = rd.redemptions.map((r) => `${r.id}:${r.status}`).join(",");
  const [demoOn, setDemoOn] = useState(false);
  const [result, setResult] = useState<Result | null>(null);
  // Mainnet is a read-only view of the signed-in wallet's real cards; devnet stays the default.
  const [network, setNetwork] = useState<Network>("devnet");

  // Authenticated devnet view takes precedence over the fixture view.
  const demo = !authedWallet && demoOn;
  const mainnet = Boolean(authedWallet) && network === "mainnet";
  const key = authedWallet ? `${mainnet ? "mainnet" : "devnet"}:${authedWallet}` : demo ? "demo" : null;

  useEffect(() => {
    if (!key) return;
    let cancelled = false;
    const load = authedWallet
      ? mainnet
        ? solanaProvider.getMainnetCards(authedWallet)
        : solanaProvider.getAssets(authedWallet)
      : mockProvider.getAssets(demoWallet.address);
    load
      .then((assets) => {
        if (!cancelled) setResult({ key, assets, failed: false, fetchedAt: new Date().toISOString() });
      })
      .catch(() => {
        if (!cancelled) setResult({ key, assets: [], failed: true, fetchedAt: new Date().toISOString() });
      });
    return () => {
      cancelled = true;
    };
  }, [key, authedWallet, mainnet, redemptionSignature]);

  const current = key && result?.key === key ? result : null;
  const status = !key ? "idle" : !current ? "loading" : current.failed ? "error" : "ready";
  const assets = current?.assets ?? [];
  const busy = auth.status === "connecting" || auth.status === "awaiting_signature";
  const hasCard = assets.some((asset) => asset.category === "card");
  const hasLegacyAsset = assets.some((asset) => asset.category !== "card");
  const showLegacyPanels = status === "ready" && hasLegacyAsset && !hasCard;
  const retry = ["rejected", "expired", "switched", "error"].includes(auth.status);

  if (!key) {
    return (
      <main className="shell collectionPage">
        {/* Rendered during SSR too (so the prompt is in the HTML); hidden until the session check finishes to avoid a flash for signed-in users. */}
        <section className={`connectPrompt${auth.sessionChecked ? "" : " pending"}`} aria-busy={!auth.sessionChecked}>
          <div className="eyebrow">{t(text.eyebrow)}</div>
          <h1>{t(text.title)}</h1>
          <p className="emptyState small">{t(text.connectPrompt)}</p>
          <p className="authLine">{t(text.status)} {t(authLabel[auth.status])}</p>
          {auth.detail && <p className="emptyState small" role="alert">{auth.detail}</p>}
          <button className="primary" disabled={busy} onClick={() => void auth.connect()}>
            {retry ? t(text.retry) : t(text.connect)}
          </button>
          <button className="demoToggle" onClick={() => setDemoOn(true)} title={t(text.demoTitle)}>
            {t(text.demoTry)}
          </button>
        </section>
      </main>
    );
  }

  const addr = authedWallet ?? demoWallet.address;

  return (
    <main className="shell collectionPage">
      <section className="collectionTop">
        <div>
          <div className="eyebrow">{t(text.eyebrow)}</div>
          <h1>{t(text.title)}</h1>
          <p className="collectionWallet">
            <span className="statusDot" />{shortAddress(addr)} <span className="demoBadge">{demo ? "DEMO DATA" : mainnet ? "MAINNET (read-only)" : "DEVNET"}</span>
          </p>
          {authedWallet && (
            <div className="networkSwitch" role="group" aria-label={t(text.networkLabel)}>
              <span>{t(text.networkLabel)}</span>
              <button type="button" aria-pressed={!mainnet} onClick={() => setNetwork("devnet")}>{t(text.networkDevnet)}</button>
              <button type="button" aria-pressed={mainnet} onClick={() => setNetwork("mainnet")}>{t(text.networkMainnet)}</button>
            </div>
          )}
          {mainnet && <p className="emptyState small">{t(text.mainnetNote)}</p>}
          {demo && (
            <p className="emptyState small">
              {t(text.demoNote)}
              <button className="textButton inline" onClick={() => setDemoOn(false)}>{t(text.demoOff)}</button>
            </p>
          )}
        </div>
        <div className="collectionStat">
          <strong>{status === "ready" ? assets.length.toString().padStart(2, "0") : "--"}</strong>
          <span>{demo ? t(text.demoAsset) : mainnet ? t(text.mainnetAsset) : t(text.devnetAsset)}</span>
        </div>
      </section>

      {/* The approval and redeem dry run panels act on devnet only; the mainnet view is display only. The iPhone link panel is shown for both devnet and mainnet (read-only) views. */}
      {/* The Twinfold buyback / redeem panels belong to the legacy fixture Assets only. A wallet that holds a card (or no legacy Asset) never sees them: buyback and shipping are Collector Crypt's. */}
      {authedWallet && !mainnet && showLegacyPanels && <PendingRequestsPanel tr={tr} />}
      {authedWallet && !mainnet && showLegacyPanels && <RedemptionPanel rd={rd} />}
      {authedWallet && <DeviceLinkPanel />}

      {status === "loading" && <p className="emptyState">{t(text.loading)}</p>}
      {status === "error" && <p className="emptyState" role="alert">{t(text.loadFailed)}</p>}
      {status === "ready" && assets.length === 0 && (
        <div className="emptyState">
          <p>{t(mainnet ? text.mainnetEmpty : text.empty)}</p>
          <Link href="/pull" className="secondary linkButton">{t(text.pullAPack)}</Link>
        </div>
      )}
      {status === "ready" && assets.length > 0 && (
        <div className="grid devnetGrid collectionGrid">
          {assets.map((asset) => asset.category === "card" ? (
            <div key={asset.id} className="collectionCell">
              <CardAssetCard asset={asset} demo={demo} fetchedAt={current?.fetchedAt} />
            </div>
          ) : (
            <div key={asset.id} className="collectionCell">
              <AssetCard asset={asset} demo={demo} showCommerce={showLegacyPanels} />
              {authedWallet && !mainnet && showLegacyPanels && asset.physical?.custody.status === "vaulted" && <OwnershipSection asset={asset} rd={rd} />}
              {authedWallet && !mainnet && showLegacyPanels && asset.commerce && !asset.redemption?.open && (
                <button
                  className="secondary sellButton"
                  onClick={() => void tr.createBuyback(asset.id)}
                  title={t(text.sellTitle)}
                >
                  {t(text.sell)}
                </button>
              )}
            </div>
          ))}
        </div>
      )}
    </main>
  );
}
