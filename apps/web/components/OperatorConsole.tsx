"use client";

import { useCallback, useState } from "react";
import type { Redemption } from "../lib/contract";
import { explorerTxUrl, redemptionStatusLabel, shortAddress } from "../lib/labels";

type Action = "ship" | "exception" | "retry_retire" | "resume";

/**
 * OPERATOR · DRY RUN (dev-only page; /operator is 404 unless the devnet server-signing guard passes).
 * The operator token is typed into a password field and kept ONLY in memory (React state): it is never written
 * to localStorage / sessionStorage / cookies / the URL. Nothing here records or shows personal data.
 */
export function OperatorConsole() {
  const [token, setToken] = useState("");
  const [note, setNote] = useState("");
  const [rows, setRows] = useState<Redemption[] | null>(null);
  const [message, setMessage] = useState("");
  const [busy, setBusy] = useState<string | null>(null);

  const headers = useCallback(() => ({ "Content-Type": "application/json", "x-twinfold-operator-token": token }), [token]);

  const load = useCallback(async () => {
    setMessage("");
    const res = await fetch("/api/operator/redemptions", { headers: headers(), cache: "no-store" }).catch(() => null);
    if (!res) return setMessage("読み込めませんでした（ネットワーク）");
    const data = (await res.json().catch(() => ({}))) as { redemptions?: Redemption[]; error?: string };
    if (!res.ok) {
      setRows(null);
      return setMessage(res.status === 403 ? `権限がありません: ${data.error ?? ""}` : `読み込めませんでした（HTTP ${res.status}）`);
    }
    setRows(data.redemptions ?? []);
  }, [headers]);

  async function act(id: string, action: Action) {
    if (busy) return;
    setBusy(id);
    setMessage("");
    try {
      const res = await fetch(`/api/redemptions/${id}/operator`, {
        method: "POST",
        headers: headers(),
        body: JSON.stringify(note.trim() ? { action, note: note.trim() } : { action }),
      });
      const data = (await res.json().catch(() => ({}))) as { error?: string };
      if (!res.ok) setMessage(data.error ?? `失敗しました（HTTP ${res.status}）`);
    } catch {
      setMessage("操作中にエラーが発生しました");
    } finally {
      setBusy(null);
      void load();
    }
  }

  return (
    <main className="shell collectionPage operatorPage">
      <section className="collectionTop">
        <div>
          <div className="eyebrow">OPERATOR · DRY RUN</div>
          <h1>Redemption operator</h1>
          <p className="emptyState small">
            devnet開発用の運用画面です。実配送は行いません。発送は「dry runで発送した」という記録だけを残し、追跡番号や配送先などの個人情報は扱いません。
          </p>
        </div>
      </section>

      <section className="linkPanel">
        <label className="confirmLine" htmlFor="operatorToken">
          <span>Operator token（このタブのメモリ内だけに保持します）</span>
        </label>
        <input
          id="operatorToken"
          type="password"
          autoComplete="off"
          value={token}
          onChange={(e) => setToken(e.target.value)}
          placeholder="TWINFOLD_OPERATOR_TOKEN"
          className="operatorInput"
        />
        <label className="confirmLine" htmlFor="operatorNote">
          <span>メモ（任意、120文字まで。個人情報・連絡先は入力しない）</span>
        </label>
        <input id="operatorNote" type="text" maxLength={120} value={note} onChange={(e) => setNote(e.target.value)} className="operatorInput" />
        <div className="linkActions">
          <button className="primary" disabled={!token} onClick={() => void load()}>未完了の引き取りを読み込む</button>
        </div>
        {message && <p className="emptyState small" role="alert">{message}</p>}
      </section>

      {rows && rows.length === 0 && <p className="emptyState">未完了の引き取りはありません</p>}
      {rows && rows.length > 0 && (
        <ul className="requestList operatorList">
          {rows.map((r) => (
            <li key={r.id} className={`requestItem status-${r.status}`}>
              <div className="requestHead">
                <b>{r.assetTitle ?? r.assetId}</b>
                <span className="demoBadge">{redemptionStatusLabel[r.status]}</span>
              </div>
              <div className="requestMeta">
                id {r.id.slice(0, 8)} ・ asset {r.assetId} ・ owner {shortAddress(r.wallet)} ・ {r.updatedAt}
                {r.lockSignature && <> ・ <a href={explorerTxUrl(r.lockSignature)} target="_blank" rel="noreferrer">lock tx</a></>}
              </div>
              {r.status === "retired" && r.passportMissing && (
                <div className="requestMeta" role="alert">失効済みですがPassportを書き込めませんでした（pre-burn snapshotが無い等）。手動対応が必要です。</div>
              )}
              {r.status === "exception" && <div className="requestMeta" role="alert">理由: {r.exceptionReason ?? "-"}（停止前: {r.exceptionFrom ?? "-"}）</div>}
              <div className="linkActions">
                {r.status === "locked" && (
                  <button className="primary" disabled={!!busy} onClick={() => void act(r.id, "ship")}>発送済みにする（dry run）</button>
                )}
                {(r.status === "locked" || r.status === "shipped" || r.status === "received") && (
                  <button className="secondary" disabled={!!busy} onClick={() => void act(r.id, "exception")}>例外で停止</button>
                )}
                {r.status === "exception" && r.exceptionFrom === "received" && (
                  <button className="primary" disabled={!!busy} onClick={() => void act(r.id, "retry_retire")}>失効を再試行</button>
                )}
                {r.status === "exception" && (r.exceptionFrom === "locked" || r.exceptionFrom === "shipped") && (
                  <button className="primary" disabled={!!busy} onClick={() => void act(r.id, "resume")}>停止前の状態へ再開</button>
                )}
              </div>
            </li>
          ))}
        </ul>
      )}
    </main>
  );
}
