"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import type { TwinfoldAsset } from "../contract";
import { getPhantom } from "../auth/useWalletAuth";
import { addOrphan, ORPHAN_MEMOS_KEY, parseOrphans, removeOrphan, type OrphanMemo } from "./orphanMemos";
import { resolveResume, type RemotePackStatus, type ResumeLocal, type ResumeLocalState } from "./resume";

/**
 * Client-side Pull flow: generatePack -> Phantom signTransaction -> submit -> openPack polling.
 * Every Collector Crypt call goes through this app's /api/gacha/* routes (never directly).
 *
 * Idempotence / resume: the Pull's `memo` is saved to localStorage as soon as the signed transaction is about to be
 * sent. If the tab closes, the saved memo is polled again on the next visit; the same memo always returns the same
 * card, so it can never open a second pack. A brand-new generatePack is only ever started by an explicit Pull click.
 * Nothing secret is stored: memo, pack type, public wallet address, and (after opening) the result card.
 *
 * Before a saved memo is resumed, GET /api/gacha/pack/status says what the server and Collector Crypt know about it,
 * and resolveResume() (lib/gacha/resume.ts) decides: reopen / keep polling / drop it (failed before payment, unpaid for
 * over 2 hours, refunded) / keep it as "payment not confirmed". A memo that was never paid is never polled again.
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
  | "previousUnpaid"
  | "refunded"
  | "unconfirmedPayment"
  | "generic";

/** Why the last step failed, as the server recorded it (GachaPackError) or as this hook saw it (pack creation, network, stale). */
export type PullLastError = { at?: string; stage: string; code: string; httpStatus: number; message: string };

export type PullState = {
  stage: PullStage;
  memo?: string;
  packType?: string;
  asset?: TwinfoldAsset;
  rarity?: string;
  /** The slab's back photo, when the Pull result carried one (used by the opening only). */
  backImageUrl?: string;
  transactionSignature?: string;
  error?: PullErrorKind;
  errorDetail?: string;
  /** Shown as "Details" under a failed result. */
  lastError?: PullLastError;
  /** The transaction expired (or went stale) before it was sent: nothing was paid, so only a fresh Pull makes sense. */
  unpaid?: boolean;
  /** openPack attempts so far in this polling run. */
  attempts: number;
  /** Polling hit the attempt cap while still waiting: not a failure, "check again" continues with the same memo. */
  paused: boolean;
  /** The last openPack answer was 429/503 and we are backing off. */
  busyRetry: boolean;
  /** The pull was resumed from a saved memo. */
  resumed: boolean;
  /** A saved memo with no payment seen yet, still inside its 2 hour window: Pull is offered, and "Check again" asks the status again. */
  unconfirmed?: boolean;
  /** The payment may have been sent, so only the same memo may be used (no new generatePack). */
  resumable: boolean;
};

/** The Pull event of an opened card: `confirmed` only when its signature was found on chain, else `pending`. */
const pullEventPending = (asset: TwinfoldAsset | undefined) => asset?.provenance[0]?.status !== "confirmed";

export const statusOf = (stage: PullStage, asset?: TwinfoldAsset, unconfirmed?: boolean): PullStatus | null =>
  unconfirmed ? "pending" : stage === "idle" ? null : stage === "opened" ? (pullEventPending(asset) ? "pending" : "confirmed") : stage === "failed" ? "failed" : "pending";

const IDLE: PullState = { stage: "idle", attempts: 0, paused: false, busyRetry: false, resumed: false, resumable: false };
/** openPack answers WAITING_FOR_WEBHOOK until the payment settles; give up polling after this many tries (then "Check again" / "Start a new pull"). */
const MAX_ATTEMPTS = 10;
const POLL_INTERVAL_MS = 1000;
const MAX_BACKOFF_MS = 8000;
const DEMO_PLAYER = "DEMO-PLAYER-WALLET";
/** After the card arrives with an unconfirmed Pull transaction, ask again (same memo) this often, this many times. */
const CONFIRM_INTERVAL_MS = 3000;
const CONFIRM_ATTEMPTS = 10;
/** The pack transaction carries a blockhash that lasts about a minute. Past this since generatePack, it is not sent. */
const SIGN_FRESH_MS = 45_000;
/** DEMO DATA test flags for the mock submit (?fail=submit / ?fail=expired). Never sent outside DEMO DATA. */
const DEMO_FAIL: Record<string, string> = { submit: "DEMO-FAIL-SUBMIT", expired: "DEMO-FAIL-EXPIRED" };

type StoredPull = {
  v: 1;
  memo: string;
  packType: string;
  playerAddress: string;
  stage: "generated" | "submitted" | "opened";
  createdAt: string;
  asset?: TwinfoldAsset;
  rarity?: string;
  backImageUrl?: string;
  transactionSignature?: string;
};

const storageKey = (demo: boolean, wallet: string | null) => `twinfold.pull.v1.${demo ? "demo" : "devnet"}.${wallet ?? "none"}`;

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

async function getJson(url: string) {
  try {
    const response = await fetch(url, { cache: "no-store" });
    const data = (await response.json().catch(() => ({}))) as Record<string, unknown>;
    return { ok: response.ok, status: response.status, data };
  } catch {
    return { ok: false, status: 0, data: {} as Record<string, unknown> };
  }
}

const LOCAL_STATES: readonly string[] = ["generated", "submitted", "opened", "failed"];

/** The status route's `local`, checked defensively (anything unexpected counts as "no usable answer"). */
function parseLocal(value: unknown): ResumeLocal | null {
  if (value === null || typeof value !== "object") return null;
  const v = value as Record<string, unknown>;
  if (typeof v.state !== "string" || !LOCAL_STATES.includes(v.state)) return null;
  const sent = v.lastError as Partial<PullLastError> | null | undefined;
  const lastError = sent && typeof sent.code === "string" ? { at: sent.at, stage: sent.stage ?? "open", code: sent.code, httpStatus: sent.httpStatus ?? 0, message: String(sent.message ?? "") } : null;
  return { state: v.state as ResumeLocalState, lastError, createdAt: typeof v.createdAt === "string" || typeof v.createdAt === "number" ? v.createdAt : undefined, landed: v.landed === true };
}

function parseRemote(value: unknown): RemotePackStatus | null {
  if (value === null || typeof value !== "object") return null;
  const v = value as Record<string, unknown>;
  return { paid: v.paid === true, opened: v.opened === true, refunded: v.refunded === true };
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

/** The server's `lastError` when it sent one, else what the response itself says (pack creation has none; a network failure is status 0). */
function lastErrorOf(res: { status: number; data: Record<string, unknown> }, stage: string): PullLastError {
  const sent = res.data.lastError as Partial<PullLastError> | undefined;
  if (sent && typeof sent.code === "string") {
    return { at: sent.at, stage: sent.stage ?? stage, code: sent.code, httpStatus: sent.httpStatus ?? res.status, message: String(sent.message ?? "") };
  }
  const message = [res.data.message, res.data.details].filter((v) => typeof v === "string" && v !== "").join(" | ");
  return { stage, code: res.status === 0 ? "network" : typeof res.data.error === "string" ? res.data.error : "unknown", httpStatus: res.status, message };
}

function errorKindOf(status: number, data: Record<string, unknown>): PullErrorKind {
  if (data.error === "tx_expired") return "expired";
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
    // Shown on the page under "Details" too; logged so a failure on a phone can be read from the dev server's log. No keys or signatures here.
    console.warn("pull failed", JSON.stringify({ error, detail, lastError: patch.lastError, unpaid: patch.unpaid }));
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
          const backImageUrl = typeof res.data.backImageUrl === "string" ? res.data.backImageUrl : undefined;
          const transactionSignature = typeof res.data.transactionSignature === "string" ? res.data.transactionSignature : undefined;
          writeStored(storeKey, { v: 1, memo, packType, playerAddress, stage: "opened", createdAt: new Date().toISOString(), asset, rarity, backImageUrl, transactionSignature });
          setState((s) => ({ ...s, asset, rarity: rarity ?? s.rarity, backImageUrl: backImageUrl ?? s.backImageUrl, transactionSignature: transactionSignature ?? s.transactionSignature }));
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
        setState((s) => ({ ...s, stage: "opening", memo, packType, attempts: attempt, paused: false, error: undefined, lastError: undefined, unpaid: undefined, resumable: true }));
        const res = await postJson("/api/gacha/open", { memo, playerAddress, demo });
        if (runId.current !== myRun) return;

        if (res.ok && res.data.state === "opened") {
          const asset = res.data.asset as TwinfoldAsset;
          const rarity = typeof res.data.rarity === "string" ? res.data.rarity : undefined;
          const backImageUrl = typeof res.data.backImageUrl === "string" ? res.data.backImageUrl : undefined;
          const transactionSignature = typeof res.data.transactionSignature === "string" ? res.data.transactionSignature : undefined;
          writeStored(storeKey, { v: 1, memo, packType, playerAddress, stage: "opened", createdAt: new Date().toISOString(), asset, rarity, backImageUrl, transactionSignature });
          setState((s) => ({ ...s, stage: "opened", memo, asset, rarity, backImageUrl, transactionSignature, paused: false, busyRetry: false, error: undefined, resumable: false }));
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
        if (res.data.code === "unpaid") {
          // The server's record is failed and Collector Crypt sees no payment: stop. The user can check again or start anew.
          setState((s) => ({ ...s, paused: true, busyRetry: false, lastError: lastErrorOf(res, "open") }));
          return;
        }
        if (res.status === 429 || res.status === 503) {
          setState((s) => ({ ...s, busyRetry: true }));
          await sleep(backoff);
          backoff = Math.min(backoff * 2, MAX_BACKOFF_MS);
          continue;
        }
        // A transient network error (status 0) is not final: keep the memo and let the user check again.
        fail(res.status === 0 ? "generic" : errorKindOf(res.status, res.data), { memo, packType, resumable: true, lastError: lastErrorOf(res, "open") });
        return;
      }
      if (runId.current === myRun) setState((s) => ({ ...s, paused: true, busyRetry: false }));
    },
    [demo, fail, recheckConfirmation]
  );

  /**
   * Asks the server about a saved memo (GET /api/gacha/pack/status) and acts on resolveResume(). Never polls a memo that
   * was not paid: it is dropped (failed before payment, unpaid for over 2 hours, refunded) or kept as "unconfirmed".
   */
  const resume = useCallback(
    async (stored: StoredPull, myRun: number, storeKey: string, resumed: boolean) => {
      const { memo, packType, playerAddress } = stored;
      setState({ ...IDLE, stage: "opening", memo, packType, resumed, resumable: true });
      const res = await getJson(`/api/gacha/pack/status?memo=${encodeURIComponent(memo)}${demo ? "&demo=1" : ""}`);
      if (runId.current !== myRun) return;
      if (res.status === 403) {
        // Not this wallet's memo (or unknown to the server): nothing to resume and nothing to poll.
        writeStored(storeKey, null);
        setState(IDLE);
        return;
      }
      if (demo && res.status === 404) {
        // DEMO DATA: the server forgot the record (restart); /api/gacha/open makes a new one on demand.
        await poll(memo, packType, playerAddress, myRun, storeKey);
        return;
      }
      // No usable answer (network, 5xx): decide from what this browser saved, with no Collector Crypt view.
      const local: ResumeLocal = (res.ok ? parseLocal(res.data.local) : null) ?? { state: stored.stage, createdAt: stored.createdAt };
      const remote = res.ok ? parseRemote(res.data.remote) : null;
      const decision = resolveResume(local, remote, Date.now());
      // DEMO DATA has no Collector Crypt to ask (remote is always null), so an unfinished demo pull simply keeps polling the mock.
      if (decision.action === "open" || decision.action === "poll" || (demo && decision.action === "unconfirmed")) {
        await poll(memo, packType, playerAddress, myRun, storeKey);
        return;
      }
      if (decision.action === "drop") {
        writeStored(storeKey, null);
        const lastError: PullLastError | undefined =
          decision.reason === "expired_unpaid"
            ? { stage: "resume", code: "unpaid_window_closed", httpStatus: 0, message: "" }
            : (local.lastError ?? undefined);
        setState({ ...IDLE, stage: "failed", memo, packType, error: decision.reason === "refunded" ? "refunded" : "previousUnpaid", lastError });
        return;
      }
      setState({ ...IDLE, stage: "failed", memo, packType, error: "unconfirmedPayment", unconfirmed: true, lastError: local.lastError ?? undefined });
    },
    [demo, poll]
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
        setState({ ...IDLE, stage: "opened", memo: stored.memo, packType: stored.packType, asset: stored.asset, rarity: stored.rarity, backImageUrl: stored.backImageUrl, transactionSignature: stored.transactionSignature });
        if (pullEventPending(stored.asset)) void recheckConfirmation(stored.memo, stored.packType, stored.playerAddress, myRun, key);
        return;
      }
      if (stored.stage === "generated") {
        // The transaction was never signed (the memo is saved before Phantom opens), so nothing was paid and the saved pack is useless. Drop it.
        writeStored(key, null);
        setState(IDLE);
        return;
      }
      // "submitted" (or an opened memo whose card was not saved): ask the server before resuming.
      void resume(stored, myRun, key, true);
    }, 0);
    return () => {
      window.clearTimeout(timer);
      runId.current += 1;
    };
  }, [key, demo, wallet, resume, recheckConfirmation]);

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

  /** Keeps a memo that may have been paid in the "unconfirmed memos" list (this browser only). */
  const keepAsOrphan = useCallback(
    (memo: string, packType: string | undefined, owner: string) => {
      try {
        const next = addOrphan(parseOrphans(window.localStorage.getItem(ORPHAN_MEMOS_KEY)), { memo, packType: packType ?? "", wallet: owner, droppedAt: new Date().toISOString() });
        window.localStorage.setItem(ORPHAN_MEMOS_KEY, JSON.stringify(next));
        setOrphans(next);
      } catch {
        // Storage unavailable: the memo is still shown on screen until this click; nothing else to do.
      }
    },
    []
  );

  const start = useCallback(
    async (packType: string) => {
      if (inFlight.current || !player) return;
      // A saved memo with no payment seen yet is left behind by a new Pull: it may still have been paid, so it goes to the list.
      if (state.unconfirmed && state.memo) keepAsOrphan(state.memo, state.packType, player);
      inFlight.current = true;
      const myRun = ++runId.current;
      try {
        setState({ ...IDLE, stage: "creating", packType });
        const pack = await postJson("/api/gacha/pack", { playerAddress: player, packType, demo });
        if (runId.current !== myRun) return;
        if (!pack.ok || typeof pack.data.memo !== "string") {
          return fail(errorKindOf(pack.status, pack.data), { packType, lastError: lastErrorOf(pack, "pack") });
        }
        const memo = pack.data.memo;
        writeStored(key, { v: 1, memo, packType, playerAddress: player, stage: "generated", createdAt: new Date().toISOString() });
        setState((s) => ({ ...s, stage: "signing", memo }));

        // DEMO DATA only: ?fail=submit / ?fail=expired makes the mock submit fail so the failure screen can be checked.
        const demoFail = demo ? DEMO_FAIL[new URLSearchParams(window.location.search).get("fail") ?? ""] : undefined;
        let signedTransaction = demoFail ?? "";
        const packReceivedAt = Date.now();
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
        if (!demo && Date.now() - packReceivedAt >= SIGN_FRESH_MS) {
          // The blockhash is about to run out (or has): sending now would only fail. Nothing was sent, nothing was paid.
          writeStored(key, null);
          return fail("expired", {
            memo,
            packType,
            unpaid: true,
            resumable: false,
            lastError: { stage: "sign", code: "signature_too_slow", httpStatus: 0, message: `Signed ${Math.round((Date.now() - packReceivedAt) / 1000)}s after the pack was created (limit ${SIGN_FRESH_MS / 1000}s). Not sent.` },
          });
        }

        // The player may be charged from here on, so persist the memo BEFORE sending. A reload resumes with it.
        writeStored(key, { v: 1, memo, packType, playerAddress: player, stage: "submitted", createdAt: new Date().toISOString() });
        setState((s) => ({ ...s, stage: "submitting", resumable: true }));
        const submitted = await postJson("/api/gacha/submit", { signedTransaction, memo, kind: "pack", demo });
        if (runId.current !== myRun) return;
        if (!submitted.ok && submitted.status === 400 && errorKindOf(400, submitted.data) === "invalidTransaction") {
          // Refused before relaying (the wallet is not a signer / not a transaction): nothing was sent, nothing was paid.
          writeStored(key, null);
          return fail("invalidTransaction", { memo, packType, lastError: lastErrorOf(submitted, "submit") });
        }
        if (!submitted.ok && submitted.data.error === "tx_expired") {
          // The blockhash ran out before Collector Crypt could send it: it never landed, so nothing was paid. Drop this memo
          // (no orphan entry: there is nothing to chase) and offer a fresh Pull.
          writeStored(key, null);
          return fail("expired", { memo, packType, unpaid: true, resumable: false, lastError: lastErrorOf(submitted, "submit") });
        }
        if (!submitted.ok) {
          // Unknown whether it landed: keep the memo; the user checks again with it (never a new generatePack).
          return fail("submitFailed", { memo, packType, resumable: true, lastError: lastErrorOf(submitted, "submit") });
        }
        await poll(memo, packType, player, myRun, key);
      } finally {
        inFlight.current = false;
      }
    },
    [player, demo, wallet, key, fail, poll, state.unconfirmed, state.memo, state.packType, keepAsOrphan]
  );

  /** Same memo: ask the status again (it may now be paid, opened, refunded, or confirmed unpaid), then act on it. */
  const checkAgain = useCallback(() => {
    if (!state.memo || !state.packType || !player) return;
    const myRun = ++runId.current;
    const saved = readStored(key);
    const stored: StoredPull =
      saved && saved.memo === state.memo
        ? saved
        : { v: 1, memo: state.memo, packType: state.packType, playerAddress: player, stage: "submitted", createdAt: new Date().toISOString() };
    void resume(stored, myRun, key, false);
  }, [state.memo, state.packType, player, resume, key]);

  /**
   * A Pull that was started but not finished: the payment may already have gone through, so leaving it needs the
   * player's confirmation (the page asks) and its memo is kept in the "unconfirmed memos" list.
   */
  const needsConfirm = !demo && state.resumable && state.stage !== "opened" && state.stage !== "idle" && Boolean(state.memo);

  /** Forget the saved memo and go back to idle (explicit user action). A dropped unfinished memo goes to the orphan list. */
  const reset = useCallback(() => {
    if (needsConfirm && state.memo && player) keepAsOrphan(state.memo, state.packType, player);
    runId.current += 1;
    inFlight.current = false;
    writeStored(key, null);
    setState(IDLE);
  }, [key, needsConfirm, state.memo, state.packType, player, keepAsOrphan]);

  /** After an expired, unpaid Pull: drop its memo without an orphan entry (nothing was paid) and start a fresh generatePack. */
  const discardAndRestart = useCallback(
    (packType: string) => {
      runId.current += 1;
      inFlight.current = false;
      writeStored(key, null);
      void start(packType);
    },
    [key, start]
  );

  const dismissOrphan = useCallback((memo: string) => {
    try {
      const next = removeOrphan(parseOrphans(window.localStorage.getItem(ORPHAN_MEMOS_KEY)), memo);
      window.localStorage.setItem(ORPHAN_MEMOS_KEY, JSON.stringify(next));
      setOrphans(next);
    } catch {
      setOrphans((list) => removeOrphan(list, memo));
    }
  }, []);

  return { state, start, checkAgain, reset, discardAndRestart, needsConfirm, orphans, dismissOrphan, status: statusOf(state.stage, state.asset, state.unconfirmed) };
}
