"use client";

import qrcode from "qrcode-generator";
import { useCallback, useEffect, useMemo, useState } from "react";
import { useI18n, type Lang, type Localized } from "../lib/i18n";
import { issueLinkCode } from "../lib/link/issueCode";

const text = {
  qrLabel: { en: "QR code for linking your iPhone", ja: "iPhone連携用QRコード" },
  sessionExpired: {
    en: "Your session has expired. Please sign again.",
    ja: "セッションが切れています。もう一度署名してください",
  },
  issueFailed: {
    en: "Could not issue a code. Please wait a moment and try again.",
    ja: "コードを発行できませんでした。時間をおいて再試行してください",
  },
  revoked: {
    en: "Unlinked. Your iPhone is now view-only.",
    ja: "連携を解除しました。iPhoneはviewのみになります",
  },
  revokeFailed: { en: "Could not unlink.", ja: "解除に失敗しました" },
  title: { en: "Link your iPhone", ja: "iPhoneと連携" },
  note: {
    en: "Your private key and seed phrase never leave this browser. The code shown expires in 2 minutes and works once. Enter it under \"Link with web wallet\" in the iPhone app, or scan the QR.",
    ja: "秘密鍵・シードフレーズはこのブラウザの外へ出ません。表示されるコードは2分で失効し、一度しか使えません。iPhoneアプリの「Webのwalletと連携」にコードを入力するか、QRを読み取ってください。",
  },
  remaining: { en: "Time left", ja: "残り" },
  codeExpired: {
    en: "The code has expired. Please issue a new one.",
    ja: "コードの有効期限が切れました。もう一度発行してください。",
  },
  reissue: { en: "Issue a new code", ja: "コードを再発行" },
  issue: { en: "Issue a link code", ja: "連携コードを発行" },
  devicesTitle: { en: "Linked iPhones", ja: "連携中のiPhone" },
  noDevices: { en: "No linked devices.", ja: "連携中の端末はありません" },
  linked: { en: "Linked", ja: "連携" },
  validUntil: { en: "valid until", ja: "有効期限" },
  revoke: { en: "Unlink", ja: "連携を解除" },
  openInApp: { en: "Open in the iPhone app", ja: "iPhoneアプリで開く" },
} satisfies Record<string, Localized>;

type Issued = { code: string; display: string; expiresAt: number };
type Device = { id: string; name: string; linkedAt: string; expiresAt: string };

/** QR drawn as one SVG path (no image, no network). Encodes only the one-time code URL, never a key. */
function QrSvg({ text: data, label }: { text: string; label: string }) {
  const { size, path } = useMemo(() => {
    const qr = qrcode(0, "M");
    qr.addData(data);
    qr.make();
    const n = qr.getModuleCount();
    let d = "";
    for (let r = 0; r < n; r++) {
      for (let c = 0; c < n; c++) if (qr.isDark(r, c)) d += `M${c + 4} ${r + 4}h1v1h-1z`;
    }
    return { size: n + 8, path: d };
  }, [data]);
  return (
    <svg viewBox={`0 0 ${size} ${size}`} width={168} height={168} role="img" aria-label={label} shapeRendering="crispEdges">
      <rect width={size} height={size} fill="#fff" />
      <path d={path} fill="#000" />
    </svg>
  );
}

function formatTime(iso: string, lang: Lang) {
  return new Date(iso).toLocaleString(lang === "ja" ? "ja-JP" : "en-US", { month: "numeric", day: "numeric", hour: "2-digit", minute: "2-digit" });
}

/** "iPhoneと連携" panel for /collection (authenticated only). Uses /api/link/* via the session cookie. */
export function DeviceLinkPanel() {
  const { lang, t: tr } = useI18n();
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
      const result = await issueLinkCode();
      if (!result.ok) {
        setMessage(result.status === 401 ? tr(text.sessionExpired) : tr(text.issueFailed));
        return;
      }
      setNow(Date.now());
      setIssued({ code: result.code, display: result.display, expiresAt: result.expiresAt });
    } finally {
      setBusy(false);
    }
  }

  async function revoke() {
    setBusy(true);
    setMessage("");
    try {
      const res = await fetch("/api/link/revoke", { method: "POST", headers: { "Content-Type": "application/json" }, body: "{}" });
      setMessage(res.ok ? tr(text.revoked) : tr(text.revokeFailed));
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
      <h2 id="linkPanelTitle">{tr(text.title)}</h2>
      <p className="linkNote">{tr(text.note)}</p>

      {live && issued ? (
        <div className="linkCodeBox">
          <div className="linkCode" aria-live="polite">{issued.display}</div>
          <div className="linkCountdown">{tr(text.remaining)} {mm}:{ss}</div>
          <QrSvg text={`twinfold://link?code=${issued.code}`} label={tr(text.qrLabel)} />
          <a className="primary" href={`twinfold://link?code=${issued.code}`}>{tr(text.openInApp)}</a>
        </div>
      ) : (
        issued && <p className="emptyState small">{tr(text.codeExpired)}</p>
      )}

      <div className="linkActions">
        <button className="primary" disabled={busy} onClick={() => void issue()}>
          {live ? tr(text.reissue) : tr(text.issue)}
        </button>
      </div>
      {message && <p className="emptyState small" role="status">{message}</p>}

      <h3>{tr(text.devicesTitle)}</h3>
      {devices.length === 0 ? (
        <p className="emptyState small">{tr(text.noDevices)}</p>
      ) : (
        <>
          <ul className="linkDevices">
            {devices.map((d) => (
              <li key={d.id}>
                <b>{d.name}</b>
                <span>{tr(text.linked)} {formatTime(d.linkedAt, lang)} / {tr(text.validUntil)} {formatTime(d.expiresAt, lang)}</span>
              </li>
            ))}
          </ul>
          <button className="secondary" disabled={busy} onClick={() => void revoke()}>
            {tr(text.revoke)}
          </button>
        </>
      )}
    </section>
  );
}
