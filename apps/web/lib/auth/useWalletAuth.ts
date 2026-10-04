"use client";

import { useCallback, useEffect, useRef, useState } from "react";

/**
 * Phantom connect + sign-in-with-signature. Uses the injected Phantom
 * provider directly (window.phantom.solana) to avoid pulling in the wallet
 * adapter dependency tree. Wallet Standard wallets other than Phantom are not
 * supported yet. The client never holds keys: it only asks the extension to
 * sign a server-issued, human-readable message (no transaction).
 */

export type AuthStatus =
  | "disconnected"
  | "connecting"
  | "awaiting_signature"
  | "authenticated"
  | "rejected"
  | "expired"
  | "switched"
  | "no_wallet"
  | "error";

type PhantomPublicKey = { toString(): string };
type PhantomProvider = {
  isPhantom?: boolean;
  connect(options?: { onlyIfTrusted?: boolean }): Promise<{ publicKey: PhantomPublicKey }>;
  disconnect(): Promise<void>;
  signMessage(message: Uint8Array, display?: "utf8" | "hex"): Promise<{ signature: Uint8Array }>;
  /** Signs without sending (used for owner-approved transfers; the server submits). */
  signTransaction<T>(transaction: T): Promise<T>;
  publicKey?: PhantomPublicKey | null;
  on(event: string, handler: (...args: never[]) => void): void;
  off?(event: string, handler: (...args: never[]) => void): void;
};

export function getPhantom(): PhantomProvider | null {
  if (typeof window === "undefined") return null;
  const w = window as unknown as { phantom?: { solana?: PhantomProvider }; solana?: PhantomProvider };
  const provider = w.phantom?.solana ?? w.solana;
  return provider?.isPhantom ? provider : null;
}

const B58 = "123456789ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz";
function base58Encode(bytes: Uint8Array): string {
  const digits: number[] = [];
  for (let b = 0; b < bytes.length; b++) {
    let carry = bytes[b];
    for (let i = 0; i < digits.length; i++) {
      carry += digits[i] << 8;
      digits[i] = carry % 58;
      carry = (carry / 58) | 0;
    }
    while (carry > 0) {
      digits.push(carry % 58);
      carry = (carry / 58) | 0;
    }
  }
  let out = "";
  for (let b = 0; b < bytes.length; b++) {
    if (bytes[b] !== 0) break;
    out += "1";
  }
  for (let i = digits.length - 1; i >= 0; i--) out += B58[digits[i]];
  return out;
}

async function postJson(url: string, body: unknown) {
  const response = await fetch(url, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
  const data = (await response.json().catch(() => ({}))) as Record<string, string>;
  return { ok: response.ok, status: response.status, data };
}

export function useWalletAuth() {
  const [status, setStatus] = useState<AuthStatus>("disconnected");
  const [wallet, setWallet] = useState<string | null>(null);
  const [expiresAt, setExpiresAt] = useState<string | null>(null);
  const [detail, setDetail] = useState("");
  // True once the initial server-session restore attempt has finished (success or not).
  const [sessionChecked, setSessionChecked] = useState(false);
  const walletRef = useRef<string | null>(null);

  const clearSession = useCallback(async (next: AuthStatus, message = "") => {
    walletRef.current = null;
    setWallet(null);
    setExpiresAt(null);
    setStatus(next);
    setDetail(message);
    await fetch("/api/auth/logout", { method: "POST" }).catch(() => undefined);
  }, []);

  // Invalidate the session when the extension switches account or disconnects.
  // Phantom may be injected after mount, so attach lazily (brief poll + on connect).
  const attachedRef = useRef<PhantomProvider | null>(null);
  const currentKeyRef = useRef<string | null>(null);
  const attemptRef = useRef(0);
  const attachListeners = useCallback(
    (phantom: PhantomProvider) => {
      if (attachedRef.current === phantom) return;
      attachedRef.current = phantom;
      phantom.on("accountChanged", ((key: PhantomPublicKey | null) => {
        currentKeyRef.current = key ? key.toString() : null;
        attemptRef.current += 1; // invalidates any in-flight connect()
        const current = walletRef.current;
        if (!current) return;
        if (key && key.toString() === current) return;
        void clearSession("switched", "Your wallet changed. Please sign in again.");
      }) as never);
      phantom.on("disconnect", (() => {
        currentKeyRef.current = null;
        attemptRef.current += 1;
        if (walletRef.current) void clearSession("disconnected");
      }) as never);
    },
    [clearSession],
  );

  useEffect(() => {
    let tries = 0;
    const timer = window.setInterval(() => {
      const phantom = getPhantom();
      if (phantom) {
        attachListeners(phantom);
        window.clearInterval(timer);
      } else if (++tries >= 20) {
        window.clearInterval(timer);
      }
    }, 250);
    const phantom = getPhantom();
    if (phantom) attachListeners(phantom);
    return () => window.clearInterval(timer);
  }, [attachListeners]);

  // Restore an existing server session (httpOnly cookie) on load. If Phantom is
  // already trusted-connected to a different account, drop the session.
  useEffect(() => {
    let cancelled = false;
    fetch("/api/auth/session")
      .then(async (response) => {
        if (cancelled || !response.ok) return;
        const data = (await response.json()) as { wallet: string; expiresAt: string };
        const phantom = getPhantom();
        if (phantom) {
          const trusted = await phantom.connect({ onlyIfTrusted: true }).catch(() => null);
          if (cancelled) return;
          const key = trusted?.publicKey.toString() ?? null;
          currentKeyRef.current = key;
          if (key && key !== data.wallet) {
            await clearSession("switched", "Your wallet changed. Please sign in again.");
            return;
          }
        }
        walletRef.current = data.wallet;
        setWallet(data.wallet);
        setExpiresAt(data.expiresAt);
        setStatus("authenticated");
      })
      .catch(() => undefined)
      .finally(() => {
        if (!cancelled) setSessionChecked(true);
      });
    return () => {
      cancelled = true;
    };
  }, [clearSession]);

  // Session expiry (short-lived cookie) -> ask for a fresh signature.
  useEffect(() => {
    if (status !== "authenticated" || !expiresAt) return;
    const ms = new Date(expiresAt).getTime() - Date.now();
    const timer = window.setTimeout(() => void clearSession("expired", "Your session expired. Please sign in again."), Math.max(ms, 0));
    return () => window.clearTimeout(timer);
  }, [status, expiresAt, clearSession]);

  const connect = useCallback(async () => {
    const phantom = getPhantom();
    if (!phantom) {
      setStatus("no_wallet");
      setDetail("Phantom was not found. Please install the extension.");
      return;
    }
    attachListeners(phantom);
    const attempt = ++attemptRef.current;
    const stale = (address: string) => attemptRef.current !== attempt || currentKeyRef.current !== address;
    setDetail("");
    setStatus("connecting");
    let address: string;
    try {
      address = (await phantom.connect()).publicKey.toString();
      currentKeyRef.current = address;
    } catch {
      setStatus("rejected");
      setDetail("The connection was declined.");
      return;
    }

    try {
      const challenge = await postJson("/api/auth/challenge", { wallet: address });
      if (!challenge.ok) throw new Error(challenge.data.error ?? "challenge failed");
      setStatus("awaiting_signature");
      let signature: Uint8Array;
      try {
        signature = (await phantom.signMessage(new TextEncoder().encode(challenge.data.message), "utf8")).signature;
      } catch {
        setStatus("rejected");
        setDetail("The signature was declined. No fee was charged and nothing was sent.");
        return;
      }
      const verified = await postJson("/api/auth/verify", {
        wallet: address,
        nonce: challenge.data.nonce,
        signature: base58Encode(signature),
      });
      if (!verified.ok) {
        if (verified.data.error === "expired" || verified.data.error === "unknown_nonce") {
          setStatus("expired");
          setDetail("The sign-in challenge expired. Please try again.");
        } else {
          setStatus("error");
          setDetail(`Signature verification failed (${verified.data.error ?? verified.status})`);
        }
        return;
      }
      if (stale(address)) {
        // Account changed (or another attempt started) while signing: do not treat as authenticated.
        await clearSession("switched", "Your wallet changed while signing. Please sign in again.");
        return;
      }
      walletRef.current = verified.data.wallet;
      setWallet(verified.data.wallet);
      setExpiresAt(verified.data.expiresAt);
      setStatus("authenticated");
    } catch {
      setStatus("error");
      setDetail("Sign-in failed. Please try again.");
    }
  }, [attachListeners, clearSession]);

  const logout = useCallback(async () => {
    await getPhantom()?.disconnect().catch(() => undefined);
    await clearSession("disconnected");
  }, [clearSession]);

  return { status, wallet, expiresAt, detail, sessionChecked, connect, logout };
}
