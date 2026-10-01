"use client";

import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import { useEffect, useRef, useState } from "react";
import { shortAddress } from "../lib/labels";
import { useAuth } from "./AuthProvider";

export function SiteHeader() {
  const auth = useAuth();
  const pathname = usePathname();
  const router = useRouter();
  const [menuOpen, setMenuOpen] = useState(false);
  const navigateAfterSignIn = useRef(false);
  const authedWallet = auth.status === "authenticated" ? auth.wallet : null;
  const onCollection = pathname.startsWith("/collection");

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
      <Link className="brand" href="/" aria-label="Twinfold home">
        <span className="brandMark"><i /><i /></span>
        TWINFOLD
      </Link>
      <nav aria-label="Main navigation">
        <Link href="/" className={!onCollection ? "active" : ""} aria-current={!onCollection ? "page" : undefined}>Discover</Link>
        <Link href="/collection" className={onCollection ? "active" : ""} aria-current={onCollection ? "page" : undefined}>Collection</Link>
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
                <Link role="menuitem" href="/collection" onClick={() => setMenuOpen(false)}>My collection</Link>
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
  );
}

export function SiteFooter() {
  return <footer className="shell"><span>TWINFOLD / TOKYO</span><p>Real-world provenance, spatially alive.</p><span>© 2026</span></footer>;
}
