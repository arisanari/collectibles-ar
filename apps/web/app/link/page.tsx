"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { useAuth } from "../../components/AuthProvider";
import { useI18n, type Localized } from "../../lib/i18n";
import { issueLinkCode } from "../../lib/link/issueCode";

const text = {
  title: { en: "Link your iPhone" },
  lead: {
    en: "Sign in with Phantom, then return to Collectibles AR. Your key never leaves this browser.",
  },
  signIn: { en: "Sign in with Phantom" },
  retry: { en: "Try again" },
  connecting: { en: "Connecting…" },
  signing: { en: "Sign in Phantom…" },
  noWallet: {
    en: "Open this page inside the Phantom app's browser.",
  },
  returnToApp: { en: "Return to Collectibles AR" },
  fallback: {
    en: "If the app doesn't open, type this code in the app.",
  },
  remaining: { en: "Time left" },
  codeExpired: {
    en: "The code has expired. Please issue a new one.",
  },
  reissue: { en: "Issue a new code" },
  sessionExpired: {
    en: "Session expired. Sign in again.",
  },
  issueFailed: {
    en: "Could not issue a code. Please wait a moment and try again.",
  },
} satisfies Record<string, Localized>;

type Issued = { code: string; display: string; expiresAt: number };

/** Link-only landing page opened by the iPhone app inside Phantom's in-app browser. Uses /api/link/code via the session cookie. */
export default function LinkPage() {
  const { t: tr } = useI18n();
  const auth = useAuth();
  const [issued, setIssued] = useState<Issued | null>(null);
  const [failedStatus, setFailedStatus] = useState<number | null>(null);
  const [busy, setBusy] = useState(false);
  const [now, setNow] = useState(() => Date.now());
  const autoConnected = useRef(false);
  const issuedForWallet = useRef<string | null>(null);

  const authed = auth.status === "authenticated";
  const wallet = authed ? auth.wallet : null;

  // Try to sign in once when the page opens (after the stored session had its chance to restore).
  useEffect(() => {
    if (autoConnected.current || !auth.sessionChecked || auth.status !== "disconnected") return;
    autoConnected.current = true;
    void auth.connect();
  }, [auth]);

  const issue = useCallback(async (openApp: boolean) => {
    setBusy(true);
    setFailedStatus(null);
    try {
      const result = await issueLinkCode();
      if (!result.ok) {
        setIssued(null);
        setFailedStatus(result.status);
        return;
      }
      setNow(Date.now());
      setIssued({ code: result.code, display: result.display, expiresAt: result.expiresAt });
      // One attempt only: if Phantom's browser can open the custom scheme the app comes back by itself.
      if (openApp) window.location.href = `twinfold://link?code=${result.code}`;
    } finally {
      setBusy(false);
    }
  }, []);

  // Issue one code per signed-in wallet (the ref blocks double issue, including StrictMode's second effect run).
  useEffect(() => {
    if (!wallet) {
      issuedForWallet.current = null;
      return;
    }
    if (issuedForWallet.current === wallet) return;
    issuedForWallet.current = wallet;
    void issue(true);
  }, [wallet, issue]);

  const remaining = issued ? Math.max(0, Math.ceil((issued.expiresAt - now) / 1000)) : 0;
  const live = issued !== null && remaining > 0;

  useEffect(() => {
    if (!live) return;
    const timer = setInterval(() => setNow(Date.now()), 500);
    return () => clearInterval(timer);
  }, [live]);

  const mm = String(Math.floor(remaining / 60));
  const ss = String(remaining % 60).padStart(2, "0");
  const pending = auth.status === "connecting" || auth.status === "awaiting_signature";
  const retryable = ["rejected", "expired", "switched", "error"].includes(auth.status);
  const deepLink = issued ? `twinfold://link?code=${issued.code}` : "#";

  return (
    <main className="shell linkPage">
      <h1>{tr(text.title)}</h1>
      <p className="linkNote">{tr(text.lead)}</p>

      {!authed ? (
        <>
          <button className="primary" disabled={pending} onClick={() => void auth.connect()}>
            {auth.status === "connecting" ? tr(text.connecting) : auth.status === "awaiting_signature" ? tr(text.signing) : retryable ? tr(text.retry) : tr(text.signIn)}
          </button>
          {auth.status === "no_wallet" && <p className="emptyState small" role="status">{tr(text.noWallet)}</p>}
        </>
      ) : failedStatus !== null ? (
        <>
          <p className="emptyState small" role="status">{failedStatus === 401 ? tr(text.sessionExpired) : tr(text.issueFailed)}</p>
          {failedStatus === 401 ? (
            <button className="primary" onClick={() => void auth.connect()}>{tr(text.retry)}</button>
          ) : (
            <button className="primary" disabled={busy} onClick={() => void issue(false)}>{tr(text.reissue)}</button>
          )}
        </>
      ) : live && issued ? (
        <>
          <a className="primary" href={deepLink}>{tr(text.returnToApp)}</a>
          <div className="linkCode" aria-live="polite">{issued.display}</div>
          <div className="linkCountdown">{tr(text.remaining)} {mm}:{ss}</div>
          <p className="linkNote">{tr(text.fallback)}</p>
        </>
      ) : issued ? (
        <>
          <p className="emptyState small">{tr(text.codeExpired)}</p>
          <button className="primary" disabled={busy} onClick={() => void issue(false)}>{tr(text.reissue)}</button>
        </>
      ) : null}
    </main>
  );
}
