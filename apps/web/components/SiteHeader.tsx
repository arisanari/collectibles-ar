"use client";

import Image from "next/image";
import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import { useEffect, useRef, useState } from "react";
import { LanguageSelect, useI18n, type Localized } from "../lib/i18n";
import { shortAddress } from "../lib/labels";
import { useAuth } from "./AuthProvider";

const copy = {
  home: { en: "Collectibles AR home", ja: "Collectibles AR ホーム" },
  mainNav: { en: "Main navigation", ja: "メインナビゲーション" },
  pull: { en: "Pull", ja: "Pull" },
  collection: { en: "Collection", ja: "コレクション" },
  myCollection: { en: "My collection", ja: "マイコレクション" },
  signOut: { en: "Sign out", ja: "サインアウト" },
  install: { en: "Install Phantom", ja: "Phantomをインストール" },
  connecting: { en: "Connecting…", ja: "接続中…" },
  signing: { en: "Sign in Phantom…", ja: "Phantomで署名…" },
  retry: { en: "Retry", ja: "再試行" },
  connect: { en: "Connect Phantom", ja: "Phantomに接続" },
  tagline: { en: "Pull a pack. It appears in your room.", ja: "パックを引く。部屋に出る。" },
} satisfies Record<string, Localized>;

export function SiteHeader() {
  const { t } = useI18n();
  const auth = useAuth();
  const pathname = usePathname();
  const router = useRouter();
  const [menuOpen, setMenuOpen] = useState(false);
  const navigateAfterSignIn = useRef(false);
  const authedWallet = auth.status === "authenticated" ? auth.wallet : null;
  const onCollection = pathname.startsWith("/collection");
  const onPull = pathname.startsWith("/pull");

  // After a user-initiated sign-in from the header, land on the wallet's page.
  useEffect(() => {
    if (authedWallet && navigateAfterSignIn.current) {
      navigateAfterSignIn.current = false;
      router.push("/collection");
    }
  }, [authedWallet, router]);

  function startSignIn() {
    navigateAfterSignIn.current = true;
    void auth.connect();
  }

  return (
    <header className="nav shell">
      <Link className="brand" href="/" aria-label={t(copy.home)}>
        <Image className="brandMark" src="/brand/collectibles-ar-mark.svg" alt="" width={24} height={30} priority />
        COLLECTIBLES AR
      </Link>
      <nav aria-label={t(copy.mainNav)}>
        <Link href="/pull" className={onPull ? "active" : ""} aria-current={onPull ? "page" : undefined}>{t(copy.pull)}</Link>
        <Link href="/collection" className={onCollection ? "active" : ""} aria-current={onCollection ? "page" : undefined}>{t(copy.collection)}</Link>
      </nav>
      <div className="navRight">
        <LanguageSelect />
        <div className="walletMenuWrap">
          {authedWallet ? (
            <>
              <button className="wallet connected" aria-expanded={menuOpen} onClick={() => setMenuOpen((open) => !open)}>
                <span className="statusDot" />{shortAddress(authedWallet)} <span aria-hidden="true">▾</span>
              </button>
              {menuOpen && (
                <div className="walletMenu" role="menu">
                  <span className="demoBadge">DEVNET</span>
                  <Link role="menuitem" href="/collection" onClick={() => setMenuOpen(false)}>{t(copy.myCollection)}</Link>
                  <button role="menuitem" onClick={() => { setMenuOpen(false); void auth.logout(); }}>{t(copy.signOut)}</button>
                </div>
              )}
            </>
          ) : auth.status === "no_wallet" ? (
            <a className="wallet" href="https://phantom.com/download" target="_blank" rel="noreferrer">{t(copy.install)}</a>
          ) : auth.status === "connecting" || auth.status === "awaiting_signature" ? (
            <button className="wallet" disabled>
              <span className="statusDot" />{auth.status === "connecting" ? t(copy.connecting) : t(copy.signing)}
            </button>
          ) : (
            <button className="wallet" onClick={startSignIn}>
              <span className="statusDot" />
              {["rejected", "expired", "switched", "error"].includes(auth.status) ? t(copy.retry) : t(copy.connect)}
            </button>
          )}
        </div>
      </div>
    </header>
  );
}

export function SiteFooter() {
  const { t } = useI18n();
  return <footer className="shell"><span>COLLECTIBLES AR / TOKYO</span><p>{t(copy.tagline)}</p><span>© 2026</span></footer>;
}
