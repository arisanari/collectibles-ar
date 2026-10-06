"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import type { TwinfoldAsset } from "../contract";
import { getPhantom } from "../auth/useWalletAuth";
import { addOrphan, ORPHAN_MEMOS_KEY, parseOrphans, removeOrphan, type OrphanMemo } from "./orphanMemos";

/**
 * Client-side Pull flow: generatePack -> Phantom signTransaction -> submit -> openPack polling.
 * Every Collector Crypt call goes through this app's /api/gacha/* routes (never directly).
 *
 * Idempotence / resume: the Pull's `memo` is saved to localStorage as soon as the signed transaction is about to be
 * sent. If the tab closes, the saved memo is polled again on the next visit; the same memo always returns the same
 * card, so it can never open a second pack. A brand-new generatePack is only ever started by an explicit Pull click.
 * Nothing secret is stored: memo, pack type, public wallet address, and (after opening) the result card.
 */

export type PullStage = "idle" | "creating" | "signing" | "submitting" | "opening" | "opened" | "failed";
export type PullStatus = "pending" | "confirmed" | "failed";
export type PullErrorKind =
  | "busy_pending"
  | "busy_opening"
  | "machine_off_balance"
  | "rate_limited"
  | "signCancelled"
  | "walletMismatch"
  | "noPhantom"
  | "expired"
  | "submitFailed"
  | "unauthenticated"
  | "memoNotOwned"
  | "invalidTransaction"
  | "generic";

export type PullState = {
  stage: PullStage;
  memo?: string;
  packType?: string;
  asset?: TwinfoldAsset;
  rarity?: string;
  transactionSignature?: string;
  error?: PullErrorKind;
  errorDetail?: string;
  /** openPack attempts so far in this polling run. */
  attempts: number;
  /** Polling hit the attempt cap while still waiting: not a failure, "check again" continues with the same memo. */
  paused: boolean;
  /** The last openPack answer was 429/503 and we are backing off. */
  busyRetry: boolean;
  /** The pull was resumed from a saved memo. */
  resumed: boolean;
  /** The payment may have been sent, so only the same memo may be used (no new generatePack). */
  resumable: boolean;
};

/** The Pull event of an opened card: `confirmed` only when its signature was found on chain, else `pending`. */
const pullEventPending = (asset: TwinfoldAsset | undefined) => asset?.provenance[0]?.status !== "confirmed";

export const statusOf = (stage: PullStage, asset?: TwinfoldAsset): PullStatus | null =>
  stage === "idle" ? null : stage === "opened" ? (pullEventPending(asset) ? "pending" : "confirmed") : stage === "failed" ? "failed" : "pending";

const IDLE: PullState = { stage: "idle", attempts: 0, paused: false, busyRetry: false, resumed: false, resumable: false };
const MAX_ATTEMPTS = 30;
const POLL_INTERVAL_MS = 1000;
const MAX_BACKOFF_MS = 8000;
const DEMO_PLAYER = "DEMO-PLAYER-WALLET";
/** After the card arrives with an unconfirmed Pull transaction, ask again (same memo) this often, this many times. */
const CONFIRM_INTERVAL_MS = 3000;
const CONFIRM_ATTEMPTS = 10;

type StoredPull = {
  v: 1;
  memo: string;
  packType: string;
  playerAddress: string;
  stage: "generated" | "submitted" | "opened";
  createdAt: string;
  asset?: TwinfoldAsset;
  rarity?: string;
  transactionSignature?: string;
};

const storageKey = (demo: boolean, wallet: string | null) => `slabar.pull.v1.${demo ? "demo" : "devnet"}.${wallet ?? "none"}`;

function readStored(key: string): StoredPull | null {
  try {
    const raw = window.localStorage.getItem(key);
    if (!raw) return null;
    const value = JSON.parse(raw) as StoredPull;
    return value && value.v === 1 && typeof value.memo === "string" ? value : null;
  } catch {
    return null;
  }
}

function writeStored(key: string, value: StoredPull | null) {
  try {
    if (value) window.localStorage.setItem(key, JSON.stringify(value));
    else window.localStorage.removeItem(key);
  } catch {
    // Storage unavailable (private mode): the pull still works, it just cannot resume after closing the tab.
  }
}

const sleep = (ms: number) => new Promise<void>((resolve) => window.setTimeout(resolve, ms));
const fromBase64 = (b64: string) => Uint8Array.from(atob(b64), (c) => c.charCodeAt(0));
const toBase64 = (bytes: Uint8Array) => {
  let binary = "";
  for (let i = 0; i < bytes.length; i++) binary += String.fromCharCode(bytes[i]);
  return btoa(binary);
};

async function postJson(url: string, body: unknown) {
  try {
    const response = await fetch(url, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body), cache: "no-store" });
    const data = (await response.json().catch(() => ({}))) as Record<string, unknown>;
    return { ok: response.ok, status: response.status, data };
  } catch {
    return { ok: false, status: 0, data: {} as Record<string, unknown> };
  }
}

const KNOWN: PullErrorKind[] = ["busy_pending", "busy_opening", "machine_off_balance", "rate_limited"];

function errorKindOf(status: number, data: Record<string, unknown>): PullErrorKind {
  const text = `${data.message ?? ""} ${data.details ?? ""}`;
  if (/expired/i.test(text)) return "expired";
  if (status === 401) return "unauthenticated";
  if (data.error === "memo_not_owned") return "memoNotOwned";
  if (data.error === "wallet_not_signer" || data.error === "invalid_transaction") return "invalidTransaction";
  const code = data.error as PullErrorKind | undefined;
  return code && KNOWN.includes(code) ? code : "generic";
}

export function usePull({ demo, wallet }: { demo: boolean; wallet: string | null }) {
  const [state, setState] = useState<PullState>(IDLE);
  const [orphans, setOrphans] = useState<OrphanMemo[]>([]);
  const runId = useRef(0);
  const inFlight = useRef(false);
  const key = storageKey(demo, demo ? "demo" : wallet);
  const player = demo ? DEMO_PLAYER : wallet;

  const fail = useCallback((error: PullErrorKind, patch: Partial<PullState> = {}, detail?: string) => {
    setState((s) => ({ ...s, stage: "failed", error, errorDetail: detail, paused: false, busyRetry: false, ...patch }));
  }, []);

  /**
   * The card is in, but its Pull transaction was not found on chain yet (Status pending). Ask again with the same memo
   * every few seconds, a limited number of times; the server answers `confirmed` once it sees the signature.
   */
  const recheckConfirmation = useCallback(
    async (memo: string, packType: string, playerAddress: string, myRun: number, storeKey: string) => {
      for (let i = 0; i < CONFIRM_ATTEMPTS; i++) {
        await sleep(CONFIRM_INTERVAL_MS);
        if (runId.current !== myRun) return;
        const res = await postJson("/api/gacha/open", { memo, playerAddress, demo });
        if (runId.current !== myRun) return;
        if (res.status === 429 && res.data.error === "rate_limited") return;
        if (res.ok && res.data.state === "opened") {
          const asset = res.data.asset as TwinfoldAsset;
          if (pullEventPending(asset)) continue;
          const rarity = typeof res.data.rarity === "string" ? res.data.rarity : undefined;
          const transactionSignature = typeof res.data.transactionSignature === "string" ? res.data.transactionSignature : undefined;
          writeStored(storeKey, { v: 1, memo, packType, playerAddress, stage: "opened", createdAt: new Date().toISOString(), asset, rarity, transactionSignature });
          setState((s) => ({ ...s, asset, rarity: rarity ?? s.rarity, transactionSignature: transactionSignature ?? s.transactionSignature }));
          return;
        }
      }
    },
    [demo]
  );

  /** Polls openPack for `memo` until opened, failed, or the attempt cap. Safe to call repeatedly: same memo, same card. */
  const poll = useCallback(
    async (memo: string, packType: string, playerAddress: string, myRun: number, storeKey: string) => {
      let backoff = POLL_INTERVAL_MS;
      for (let attempt = 1; attempt <= MAX_ATTEMPTS; attempt++) {
        if (runId.current !== myRun) return;
        setState((s) => ({ ...s, stage: "opening", memo, packType, attempts: attempt, paused: false, error: undefined, resumable: true }));
        const res = await postJson("/api/gacha/open", { memo, playerAddress, demo });
        if (runId.current !== myRun) return;

        if (res.ok && res.data.state === "opened") {
          const asset = res.data.asset as TwinfoldAsset;
          const rarity = typeof res.data.rarity === "string" ? res.data.rarity : undefined;
          const transactionSignature = typeof res.data.transactionSignature === "string" ? res.data.transactionSignature : undefined;
          writeStored(storeKey, { v: 1, memo, packType, playerAddress, stage: "opened", createdAt: new Date().toISOString(), asset, rarity, transactionSignature });
          setState((s) => ({ ...s, stage: "opened", memo, asset, rarity, transactionSignature, paused: false, busyRetry: false, error: undefined, resumable: false }));
          if (pullEventPending(asset)) void recheckConfirmation(memo, packType, playerAddress, myRun, storeKey);
          return;
        }
        if (res.ok && res.data.state === "waiting") {
          setState((s) => ({ ...s, busyRetry: false }));
          await sleep(POLL_INTERVAL_MS);
          continue;
        }
        if (res.status === 429 && res.data.error === "rate_limited") {
          fail("rate_limited", { memo, packType, resumable: true });
          return;
        }
        if (res.status === 429 || res.status === 503) {
          setState((s) => ({ ...s, busyRetry: true }));
          await sleep(backoff);
          backoff = Math.min(backoff * 2, MAX_BACKOFF_MS);
          continue;
        }
        // A transient network error (status 0) is not final: keep the memo and let the user check again.
        fail(res.status === 0 ? "generic" : errorKindOf(res.status, res.data), { memo, packType, resumable: true });
        return;
      }
      if (runId.current === myRun) setState((s) => ({ ...s, paused: true, busyRetry: false }));
    },
    [demo, fail, recheckConfirmation]
  );

  // Resume from localStorage when the wallet / mode changes (and on first load). Deferred by a tick so that no
  // state is set synchronously inside the effect; the cleanup cancels it and retires any in-flight polling run.
  useEffect(() => {
    const timer = window.setTimeout(() => {
      runId.current += 1;
      const myRun = runId.current;
      inFlight.current = false;
      if (!demo && !wallet) {
        setState(IDLE);
        return;
      }
      const stored = readStored(key);
      if (!stored) {
        setState(IDLE);
        return;
      }
      if (stored.stage === "opened" && stored.asset) {
        setState({ ...IDLE, stage: "opened", memo: stored.memo, packType: stored.packType, asset: stored.asset, rarity: stored.rarity, transactionSignature: stored.transactionSignature });
        if (pullEventPending(stored.asset)) void recheckConfirmation(stored.memo, stored.packType, stored.playerAddress, myRun, key);
        return;
      }
      if (stored.stage === "submitted") {
        setState({ ...IDLE, stage: "opening", memo: stored.memo, packType: stored.packType, resumed: true, resumable: true });
        void poll(stored.memo, stored.packType, stored.playerAddress, myRun, key);
        return;
      }
      // "generated": the transaction was never signed, so nothing was paid and the saved pack is useless. Drop it.
      writeStored(key, null);
      setState(IDLE);
    }, 0);
    return () => {
      window.clearTimeout(timer);
      runId.current += 1;
    };
  }, [key, demo, wallet, poll, recheckConfirmation]);

  // Unconfirmed memos from earlier "Start a new pull" clicks (this browser). Deferred a tick like the resume effect.
  useEffect(() => {
    const timer = window.setTimeout(() => {
      try {
        setOrphans(parseOrphans(window.localStorage.getItem(ORPHAN_MEMOS_KEY)));
      } catch {
        setOrphans([]);
      }
    }, 0);
    return () => window.clearTimeout(timer);
  }, []);

  const start = useCallback(
    async (packType: string) => {
      if (inFlight.current || !player) return;
      inFlight.current = true;
      const myRun = ++runId.current;
      try {
        setState({ ...IDLE, stage: "creating", packType });
        const pack = await postJson("/api/gacha/pack", { playerAddress: player, packType, demo });
        if (runId.current !== myRun) return;
        if (!pack.ok || typeof pack.data.memo !== "string") {
          return fail(errorKindOf(pack.status, pack.data), { packType });
        }
        const memo = pack.data.memo;
        writeStored(key, { v: 1, memo, packType, playerAddress: player, stage: "generated", createdAt: new Date().toISOString() });
        setState((s) => ({ ...s, stage: "signing", memo }));

        let signedTransaction = "";
        if (!demo) {
          const phantom = getPhantom();
          if (!phantom) {
            writeStored(key, null);
            return fail("noPhantom", { memo });
          }
          if (phantom.publicKey && phantom.publicKey.toString() !== wallet) {
            writeStored(key, null);
            return fail("walletMismatch", { memo });
          }
          const { VersionedTransaction } = await import("@solana/web3.js");
          let tx;
          try {
            tx = VersionedTransaction.deserialize(fromBase64(pack.data.transaction as string));
          } catch {
            // The pack transaction could not be decoded: nothing was shown to the wallet, nothing was paid.
            writeStored(key, null);
            return fail("invalidTransaction", { memo, packType });
          }
          try {
            const signed = await phantom.signTransaction(tx);
            signedTransaction = toBase64(signed.serialize());
          } catch {
            // Nothing was signed, so nothing was paid: forget this memo.
            writeStored(key, null);
            return fail("signCancelled", { memo });
          }
        }
        if (runId.current !== myRun) return;

        // The player may be charged from here on, so persist the memo BEFORE sending. A reload resumes with it.
        writeStored(key, { v: 1, memo, packType, playerAddress: player, stage: "submitted", createdAt: new Date().toISOString() });
        setState((s) => ({ ...s, stage: "submitting", resumable: true }));
        const submitted = await postJson("/api/gacha/submit", { signedTransaction, memo, kind: "pack", demo });
        if (runId.current !== myRun) return;
        if (!submitted.ok && submitted.status === 400 && errorKindOf(400, submitted.data) === "invalidTransaction") {
          // Refused before relaying (the wallet is not a signer / not a transaction): nothing was sent, nothing was paid.
          writeStored(key, null);
          return fail("invalidTransaction", { memo, packType });
        }
        if (!submitted.ok) {
          // Unknown whether it landed: keep the memo; the user checks again with it (never a new generatePack).
          return fail("submitFailed", { memo, packType, resumable: true });
        }
        await poll(memo, packType, player, myRun, key);
      } finally {
        inFlight.current = false;
      }
    },
    [player, demo, wallet, key, fail, poll]
  );

  /** Same memo, fresh polling run (after "paused" or a failure with a saved memo). */
  const checkAgain = useCallback(() => {
    if (!state.memo || !state.packType || !player) return;
    const myRun = ++runId.current;
    void poll(state.memo, state.packType, player, myRun, key);
  }, [state.memo, state.packType, player, poll, key]);

  /**
   * A Pull that was started but not finished: the payment may already have gone through, so leaving it needs the
   * player's confirmation (the page asks) and its memo is kept in the "unconfirmed memos" list.
   */
  const needsConfirm = !demo && state.resumable && state.stage !== "opened" && state.stage !== "idle" && Boolean(state.memo);

  /** Forget the saved memo and go back to idle (explicit user action). A dropped unfinished memo goes to the orphan list. */
  const reset = useCallback(() => {
    if (needsConfirm && state.memo && player) {
      try {
        const next = addOrphan(parseOrphans(window.localStorage.getItem(ORPHAN_MEMOS_KEY)), {
          memo: state.memo,
          packType: state.packType ?? "",
          wallet: player,
          droppedAt: new Date().toISOString(),
        });
        window.localStorage.setItem(ORPHAN_MEMOS_KEY, JSON.stringify(next));
        setOrphans(next);
      } catch {
        // Storage unavailable: the memo is still shown on screen until this click; nothing else to do.
      }
    }
    runId.current += 1;
    inFlight.current = false;
    writeStored(key, null);
    setState(IDLE);
  }, [key, needsConfirm, state.memo, state.packType, player]);

  const dismissOrphan = useCallback((memo: string) => {
    try {
      const next = removeOrphan(parseOrphans(window.localStorage.getItem(ORPHAN_MEMOS_KEY)), memo);
      window.localStorage.setItem(ORPHAN_MEMOS_KEY, JSON.stringify(next));
      setOrphans(next);
    } catch {
      setOrphans((list) => removeOrphan(list, memo));
    }
  }, []);

  return { state, start, checkAgain, reset, needsConfirm, orphans, dismissOrphan, status: statusOf(state.stage, state.asset) };
}
