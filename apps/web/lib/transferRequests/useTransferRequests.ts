"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import type { TransferRequestView } from "../contract";
import { getPhantom } from "../auth/useWalletAuth";

export type ApprovalPhase = "preparing" | "signing" | "submitting";

const POLL_MS = 3000;

const toBase64 = (bytes: Uint8Array) => {
  let binary = "";
  bytes.forEach((b) => (binary += String.fromCharCode(b)));
  return btoa(binary);
};
const fromBase64 = (b64: string) => Uint8Array.from(atob(b64), (c) => c.charCodeAt(0));

async function postJson(url: string, body: unknown = {}) {
  const res = await fetch(url, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) });
  const data = (await res.json().catch(() => ({}))) as Record<string, unknown>;
  return { ok: res.ok, status: res.status, data };
}

/**
 * Pending transfer requests for the authenticated wallet, and the approve /
 * reject actions. Approval = server prepares a transaction (fee payer: Twinfold
 * vault) -> Phantom `signTransaction` here in the browser (no key leaves the
 * wallet; not signAndSendTransaction, so Phantom's selected network does not
 * matter) -> the server verifies the signature and submits to devnet.
 */
export function useTransferRequests(wallet: string | null) {
  const [requests, setRequests] = useState<TransferRequestView[]>([]);
  const [phase, setPhase] = useState<Record<string, ApprovalPhase | undefined>>({});
  const [errors, setErrors] = useState<Record<string, string | undefined>>({});
  const [notice, setNotice] = useState("");
  const inFlight = useRef<Set<string>>(new Set());

  const refresh = useCallback(async () => {
    const res = await fetch("/api/transfer-requests", { cache: "no-store" }).catch(() => null);
    if (res?.ok) setRequests(((await res.json()) as { requests: TransferRequestView[] }).requests);
  }, []);

  useEffect(() => {
    if (!wallet) return;
    const first = setTimeout(() => void refresh(), 0);
    const t = setInterval(() => void refresh(), POLL_MS);
    return () => {
      clearTimeout(first);
      clearInterval(t);
    };
  }, [wallet, refresh]);

  const setError = (id: string, message?: string) => setErrors((e) => ({ ...e, [id]: message }));
  const setPhaseFor = (id: string, p?: ApprovalPhase) => setPhase((s) => ({ ...s, [id]: p }));

  const approve = useCallback(
    async (id: string) => {
      if (inFlight.current.has(id)) return;
      inFlight.current.add(id);
      setError(id);
      try {
        const phantom = getPhantom();
        if (!phantom) return setError(id, "Phantomが見つかりません");
        const current = phantom.publicKey?.toString();
        if (wallet && current && current !== wallet) {
          return setError(id, "Phantomで選択中のアカウントが、ログイン中のwalletと違います。アカウントを切り替えてください");
        }

        setPhaseFor(id, "preparing");
        const prepared = await postJson(`/api/transfer-requests/${id}/prepare`);
        if (!prepared.ok) {
          const reasonText = typeof prepared.data.message === "string" ? prepared.data.message : "";
          return setError(
            id,
            prepared.status === 410
              ? "依頼の有効期限が切れました"
              : prepared.status === 429
                ? "準備の回数が上限に達しました。しばらくしてから再試行してください"
                : reasonText || "トランザクションを準備できませんでした。時間をおいて再試行してください",
          );
        }

        const { VersionedTransaction } = await import("@solana/web3.js");
        const tx = VersionedTransaction.deserialize(fromBase64(prepared.data.transaction as string));
        setPhaseFor(id, "signing");
        let signed;
        try {
          signed = await phantom.signTransaction(tx);
        } catch {
          return setError(id, "署名がキャンセルされました（依頼はまだ有効です）");
        }

        setPhaseFor(id, "submitting");
        const submitted = await postJson(`/api/transfer-requests/${id}/submit`, { signedTransaction: toBase64(signed.serialize()) });
        if (!submitted.ok) {
          setError(id, submitted.status === 400 ? "署名の検証に失敗しました（内容が準備したものと一致しません）" : "送信に失敗しました");
        }
      } catch {
        setError(id, "承認中にエラーが発生しました");
      } finally {
        inFlight.current.delete(id);
        setPhaseFor(id);
        void refresh();
      }
    },
    [wallet, refresh],
  );

  const reject = useCallback(
    async (id: string) => {
      setError(id);
      const res = await postJson(`/api/transfer-requests/${id}/reject`);
      if (!res.ok) setError(id, "拒否できませんでした（すでに処理中の可能性があります）");
      void refresh();
    },
    [refresh],
  );

  /** "Twinfoldに売る" from a /collection card: same request, then straight to approval. */
  const createBuyback = useCallback(
    async (assetId: string) => {
      setNotice("");
      const requestId = crypto.randomUUID();
      const res = await postJson("/api/transfer-requests", { requestId, assetId, kind: "buyback" });
      if (!res.ok) {
        const reasons = Array.isArray(res.data.reasons) ? (res.data.reasons as string[]).join("／") : "";
        setNotice(
          res.status === 409 && res.data.error === "open_request_exists"
            ? "この作品にはすでに承認待ちの依頼があります"
            : `依頼を作成できませんでした${reasons ? `: ${reasons}` : ""}`,
        );
        return;
      }
      await refresh();
      void approve(requestId);
    },
    [approve, refresh],
  );

  return { requests, phase, errors, notice, approve, reject, createBuyback, refresh };
}

export type TransferRequestsState = ReturnType<typeof useTransferRequests>;
