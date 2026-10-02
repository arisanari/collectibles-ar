"use client";

import qrcode from "qrcode-generator";
import { useCallback, useEffect, useMemo, useState } from "react";

type Issued = { code: string; display: string; expiresAt: number };
type Device = { id: string; name: string; linkedAt: string; expiresAt: string };

/** QR drawn as one SVG path (no image, no network). Encodes only the one-time code URL, never a key. */
function QrSvg({ text }: { text: string }) {
  const { size, path } = useMemo(() => {
    const qr = qrcode(0, "M");
    qr.addData(text);
    qr.make();
    const n = qr.getModuleCount();
    let d = "";
    for (let r = 0; r < n; r++) {
      for (let c = 0; c < n; c++) if (qr.isDark(r, c)) d += `M${c + 4} ${r + 4}h1v1h-1z`;
    }
    return { size: n + 8, path: d };
  }, [text]);
  return (
    <svg viewBox={`0 0 ${size} ${size}`} width={168} height={168} role="img" aria-label="iPhone連携用QRコード" shapeRendering="crispEdges">
      <rect width={size} height={size} fill="#fff" />
      <path d={path} fill="#000" />
    </svg>
  );
}

function formatTime(iso: string) {
  return new Date(iso).toLocaleString("ja-JP", { month: "numeric", day: "numeric", hour: "2-digit", minute: "2-digit" });
}

/** "iPhoneと連携" panel for /collection (authenticated only). Uses /api/link/* via the session cookie. */
export function DeviceLinkPanel() {
  const [issued, setIssued] = useState<Issued | null>(null);
  const [now, setNow] = useState(() => Date.now());
  const [devices, setDevices] = useState<Device[]>([]);
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState("");

  const loadDevices = useCallback(async () => {
    const res = await fetch("/api/link/devices", { cache: "no-store" }).catch(() => null);
    if (res?.ok) setDevices(((await res.json()) as { devices: Device[] }).devices);
  }, []);

  useEffect(() => {
    const first = setTimeout(() => void loadDevices(), 0);
    // Linked-device list also changes when the iPhone redeems a code; poll gently.
    const t = setInterval(() => void loadDevices(), 5000);
    return () => {
      clearTimeout(first);
      clearInterval(t);
    };
  }, [loadDevices]);

  const remaining = issued ? Math.max(0, Math.ceil((issued.expiresAt - now) / 1000)) : 0;
  const live = issued !== null && remaining > 0;

  useEffect(() => {
    if (!live) return;
    const t = setInterval(() => setNow(Date.now()), 500);
    return () => clearInterval(t);
  }, [live]);

  async function issue() {
    setBusy(true);
    setMessage("");
    try {
      const res = await fetch("/api/link/code", { method: "POST", headers: { "Content-Type": "application/json" }, body: "{}" });
      if (!res.ok) {
        setMessage(res.status === 401 ? "セッションが切れています。もう一度署名してください" : "コードを発行できませんでした。時間をおいて再試行してください");
        return;
      }
      const data = (await res.json()) as { code: string; display: string; expiresAt: string };
      setNow(Date.now());
      setIssued({ code: data.code, display: data.display, expiresAt: Date.parse(data.expiresAt) });
    } finally {
      setBusy(false);
    }
  }

  async function revoke() {
    setBusy(true);
    setMessage("");
    try {
      const res = await fetch("/api/link/revoke", { method: "POST", headers: { "Content-Type": "application/json" }, body: "{}" });
      setMessage(res.ok ? "連携を解除しました。iPhoneはviewのみになります" : "解除に失敗しました");
      setIssued(null);
      await loadDevices();
    } finally {
      setBusy(false);
    }
  }

  const mm = String(Math.floor(remaining / 60)).padStart(1, "0");
  const ss = String(remaining % 60).padStart(2, "0");

  return (
    <section className="linkPanel" aria-labelledby="linkPanelTitle">
      <h2 id="linkPanelTitle">iPhoneと連携</h2>
      <p className="linkNote">
        秘密鍵・シードフレーズはこのブラウザの外へ出ません。表示されるコードは2分で失効し、一度しか使えません。
        iPhoneアプリの「Webのwalletと連携」にコードを入力するか、QRを読み取ってください。
      </p>

      {live && issued ? (
        <div className="linkCodeBox">
          <div className="linkCode" aria-live="polite">{issued.display}</div>
          <div className="linkCountdown">残り {mm}:{ss}</div>
          <QrSvg text={`twinfold://link?code=${issued.code}`} />
        </div>
      ) : (
        issued && <p className="emptyState small">コードの有効期限が切れました。もう一度発行してください。</p>
      )}

      <div className="linkActions">
        <button className="primary" disabled={busy} onClick={() => void issue()}>
          {live ? "コードを再発行" : "連携コードを発行"}
        </button>
      </div>
      {message && <p className="emptyState small" role="status">{message}</p>}

      <h3>連携中のiPhone</h3>
      {devices.length === 0 ? (
        <p className="emptyState small">連携中の端末はありません</p>
      ) : (
        <>
          <ul className="linkDevices">
            {devices.map((d) => (
              <li key={d.id}>
                <b>{d.name}</b>
                <span>連携 {formatTime(d.linkedAt)} / 有効期限 {formatTime(d.expiresAt)}</span>
              </li>
            ))}
          </ul>
          <button className="secondary" disabled={busy} onClick={() => void revoke()}>
            連携を解除
          </button>
        </>
      )}
    </section>
  );
}
