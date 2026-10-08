"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { cameraRevealUi } from "../lib/copy/pull";
import { useI18n } from "../lib/i18n";

type Tier = 0 | 1 | 2 | 3;
type Phase = "ready" | "cutting" | "bloom" | "storm" | "done";
type Rand = () => number;
type Pt = [number, number];
type Particle = { x: number; y: number; vx: number; vy: number; life: number; max: number; size: number; color: string; rect: boolean; rot: number; vr: number; g: number };
type Volley = { s: number; l: number; w: number; br: number };

type Props = {
  tier: Tier;
  cardImageUrl?: string;
  cardTitle: string;
  demo: boolean;
  onClose: () => void;
};

/* ------------------------------------------------------------------ tuning values ------------------------------------------------------------------ */

const MAX_PARTICLES = 300;
const PACK = { widthRatio: 0.82, topRatio: 0.68, heightPerWidth: 1.7, sealPerWidth: 0.13, maxWidthPerH: 0.5 };
const CUT = { autoAt: 0.75, autoSpeed: 1.6, recede: 0.5, bandRatio: 0.1 };

/** bloom: seconds, column top (fraction of screen height, 0 = top edge), light strength, particles per second, pack tremble (px). */
const BLOOM: Record<Tier, { dur: number; colTop: number; strength: number; rate: number; tremble: number; discharge: boolean }> = {
  0: { dur: 1.0, colTop: 0.6, strength: 0.45, rate: 25, tremble: 0, discharge: false },
  1: { dur: 1.2, colTop: 0.48, strength: 0.6, rate: 60, tremble: 0, discharge: false },
  2: { dur: 1.4, colTop: 0.38, strength: 0.8, rate: 110, tremble: 0, discharge: false },
  3: { dur: 1.7, colTop: 0, strength: 0.95, rate: 150, tremble: 3, discharge: true },
};

/** storm: seconds, volleys (bolts from the top edge), whole-screen flashes (>= 0.5 s apart), camera shake px, flash alpha. */
const STORM: Record<Tier, { dur: number; volleys: Volley[]; flashes: number[]; camAmp: number; flashAlpha: number; charge: number }> = {
  0: { dur: 0.6, volleys: [], flashes: [], camAmp: 0, flashAlpha: 0, charge: 0 },
  1: { dur: 1.2, volleys: [{ s: 0.1, l: 0.3, w: 2.5, br: 1 }, { s: 0.55, l: 0.3, w: 2.5, br: 0 }], flashes: [], camAmp: 6, flashAlpha: 0, charge: 0 },
  2: {
    dur: 1.8,
    volleys: [0.1, 0.3, 0.55, 0.8, 1.05].map((s) => ({ s, l: 0.28, w: 3.2, br: 3 })),
    flashes: [0.1, 0.7],
    camAmp: 12,
    flashAlpha: 0.45,
    charge: 0,
  },
  3: {
    dur: 2.4,
    volleys: [0.6, 0.6, 0.85, 0.85, 1.1, 1.1, 1.35, 1.35, 1.6, 1.6, 1.9].map((s, i) => ({ s, l: 0.3, w: i % 2 === 0 ? 7 : 4, br: 4 })),
    flashes: [0.6, 1.2, 1.8],
    camAmp: 26,
    flashAlpha: 0.7,
    charge: 0.6,
  },
};

/* -------------------------------------------------------------------------------------------------------------------------------------------------- */

function mulberry32(seed: number): Rand {
  let a = seed;
  return () => {
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

const clamp01 = (v: number) => Math.max(0, Math.min(1, v));
const easeOut = (v: number) => 1 - Math.pow(1 - clamp01(v), 3);
const easeIn = (v: number) => Math.pow(clamp01(v), 2);

/** Light colour for a tier at a given time. Tier 3 drifts through the rainbow. */
function glow(tier: Tier, now: number, a: number, light = 70): string {
  if (tier === 0) return `hsla(50,25%,96%,${a})`;
  if (tier === 1) return `hsla(205,95%,82%,${a})`;
  if (tier === 2) return `hsla(44,100%,62%,${a})`;
  return `hsla(${(now / 6) % 360},100%,${light}%,${a})`;
}

/** Midpoint displacement: a jagged polyline from (x1,y1) to (x2,y2). */
function bolt(rand: Rand, x1: number, y1: number, x2: number, y2: number, depth: number): Pt[] {
  let pts: Pt[] = [[x1, y1], [x2, y2]];
  let d = Math.hypot(x2 - x1, y2 - y1) * 0.22;
  for (let i = 0; i < depth; i++) {
    const next: Pt[] = [pts[0]];
    for (let k = 0; k < pts.length - 1; k++) {
      const [ax, ay] = pts[k];
      const [bx, by] = pts[k + 1];
      const dx = bx - ax;
      const dy = by - ay;
      const len = Math.hypot(dx, dy) || 1;
      const off = (rand() - 0.5) * 2 * d;
      next.push([(ax + bx) / 2 + (-dy / len) * off, (ay + by) / 2 + (dx / len) * off]);
      next.push(pts[k + 1]);
    }
    pts = next;
    d *= 0.55;
  }
  return pts;
}

function strokePath(ctx: CanvasRenderingContext2D, pts: Pt[], color: string, width: number, blur: number, alpha: number) {
  ctx.beginPath();
  ctx.moveTo(pts[0][0], pts[0][1]);
  for (let i = 1; i < pts.length; i++) ctx.lineTo(pts[i][0], pts[i][1]);
  ctx.globalAlpha = alpha;
  ctx.strokeStyle = color;
  ctx.shadowColor = color;
  ctx.shadowBlur = blur;
  ctx.lineWidth = width;
  ctx.lineJoin = "round";
  ctx.lineCap = "round";
  ctx.stroke();
}

/** Lightning: the only place shadowBlur is used. */
function drawBolt(ctx: CanvasRenderingContext2D, rand: Rand, dpr: number, from: Pt, to: Pt, width: number, colors: [string, string], branches: number, alpha: number) {
  const pts = bolt(rand, from[0], from[1], to[0], to[1], 7);
  strokePath(ctx, pts, colors[0], width * 2.6, 24 * dpr, alpha * 0.55);
  strokePath(ctx, pts, colors[1], width, 10 * dpr, alpha);
  const len = Math.hypot(to[0] - from[0], to[1] - from[1]);
  const base = Math.atan2(to[1] - from[1], to[0] - from[0]);
  for (let b = 0; b < branches; b++) {
    const idx = Math.floor(pts.length * (0.15 + rand() * 0.6));
    const [sx, sy] = pts[idx];
    const ang = base + (rand() < 0.5 ? -1 : 1) * (0.35 + rand() * 0.6);
    const l = len * (0.15 + rand() * 0.2);
    const sub = bolt(rand, sx, sy, sx + Math.cos(ang) * l, sy + Math.sin(ang) * l, 5);
    strokePath(ctx, sub, colors[0], width * 1.2, 14 * dpr, alpha * 0.5);
    strokePath(ctx, sub, colors[1], Math.max(1, width * 0.45), 6 * dpr, alpha * 0.9);
  }
  ctx.shadowBlur = 0;
}

function roundRectPath(ctx: CanvasRenderingContext2D, x: number, y: number, w: number, h: number, r: number) {
  const rr = Math.min(r, w / 2, h / 2);
  ctx.beginPath();
  ctx.moveTo(x + rr, y);
  ctx.arcTo(x + w, y, x + w, y + h, rr);
  ctx.arcTo(x + w, y + h, x, y + h, rr);
  ctx.arcTo(x, y + h, x, y, rr);
  ctx.arcTo(x, y, x + w, y, rr);
  ctx.closePath();
}

/** Layout of the pack on screen (CSS px). */
function packLayout(W: number, H: number) {
  const pw = Math.min(W * PACK.widthRatio, H * PACK.maxWidthPerH);
  const left = (W - pw) / 2;
  const top = H * PACK.topRatio;
  const sb = pw * PACK.sealPerWidth;
  return { pw, left, top, sb, ph: pw * PACK.heightPerWidth, ycut: top + sb + pw * 0.03 };
}

/**
 * Prototype of the camera opening effect: a pack in front of the camera, cut open with a finger, then a bloom of
 * light and a storm laid over the camera image. Rendering is Canvas 2D only.
 */
export function CameraReveal({ tier, cardImageUrl, cardTitle, demo, onClose }: Props) {
  const { t } = useI18n();
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const videoRef = useRef<HTMLVideoElement>(null);
  const streamRef = useRef<MediaStream | null>(null);
  const phaseRef = useRef<Phase>("ready");
  const phaseStartRef = useRef(0);
  const propsRef = useRef({ tier, title: cardTitle, hint: "" });
  const cameraOkRef = useRef(false);
  const imageRef = useRef<HTMLImageElement | null>(null);
  const particlesRef = useRef<Particle[]>([]);
  const cutRef = useRef({ progress: 0, dir: 1, dragging: false, auto: false, target: 0, startX: 0, startY: 0, moved: 0 });
  const [phase, setPhase] = useState<Phase>("ready");
  const [cameraFailed, setCameraFailed] = useState(false);
  const [cameraError, setCameraError] = useState<string | null>(null);

  const hint = t(cameraRevealUi.cutHint);
  useEffect(() => {
    propsRef.current = { tier, title: cardTitle, hint };
  }, [tier, cardTitle, hint]);

  const go = useCallback((next: Phase) => {
    phaseRef.current = next;
    phaseStartRef.current = performance.now();
    setPhase(next);
  }, []);

  const stopCamera = useCallback(() => {
    streamRef.current?.getTracks().forEach((track) => track.stop());
    streamRef.current = null;
    cameraOkRef.current = false;
  }, []);

  const handleClose = useCallback(() => {
    stopCamera();
    onClose();
  }, [stopCamera, onClose]);

  const restart = useCallback(() => {
    cutRef.current = { progress: 0, dir: 1, dragging: false, auto: false, target: 0, startX: 0, startY: 0, moved: 0 };
    particlesRef.current = [];
    go("ready");
  }, [go]);

  // Camera: back camera if possible; on failure the same effect runs over a dark gradient.
  useEffect(() => {
    let cancelled = false;
    async function start() {
      try {
        if (!window.isSecureContext) throw new Error("InsecureContext");
        if (!navigator.mediaDevices?.getUserMedia) throw new Error("Unsupported");
        const stream = await navigator.mediaDevices.getUserMedia({ video: { facingMode: { ideal: "environment" } }, audio: false });
        if (cancelled) {
          stream.getTracks().forEach((track) => track.stop());
          return;
        }
        streamRef.current = stream;
        const video = videoRef.current;
        if (video) {
          video.muted = true;
          video.setAttribute("playsinline", "");
          video.srcObject = stream;
          cameraOkRef.current = true;
          // iOS Safari can reject the first play(); retry once the metadata is in.
          const tryPlay = () => void video.play().catch(() => undefined);
          video.addEventListener("loadedmetadata", tryPlay, { once: true });
          tryPlay();
        }
      } catch (e) {
        if (!cancelled) {
          setCameraFailed(true);
          setCameraError(e instanceof Error ? e.name === "Error" ? e.message : e.name : "Unknown");
        }
      }
    }
    // Deferred so React StrictMode's mount/unmount/mount in dev asks for the camera once, not twice
    // (on iOS Safari, stopping the first stream also kills the second one).
    const timer = window.setTimeout(() => void start(), 0);
    return () => {
      cancelled = true;
      window.clearTimeout(timer);
      stopCamera();
    };
  }, [stopCamera]);

  // Card image, loaded at runtime from the given URL.
  useEffect(() => {
    imageRef.current = null;
    if (!cardImageUrl) return;
    const img = new Image();
    img.onload = () => {
      imageRef.current = img;
    };
    img.src = cardImageUrl;
  }, [cardImageUrl]);

  // Render loop.
  useEffect(() => {
    phaseStartRef.current = performance.now();
    const canvas = canvasRef.current;
    const video = videoRef.current;
    if (!canvas || !video) return;
    const ctx = canvas.getContext("2d");
    if (!ctx) return;
    const motionQuery = window.matchMedia("(prefers-reduced-motion: reduce)");
    let reduced = motionQuery.matches;
    const onMotion = () => {
      reduced = motionQuery.matches;
    };
    motionQuery.addEventListener("change", onMotion);

    let raf = 0;
    let last = performance.now();
    let seenStart = -1;
    let stormIdx = 0;
    let bloomAcc = 0;
    let sealStart = 0;
    let sealDir = 1;

    const push = (p: Particle) => {
      if (particlesRef.current.length < MAX_PARTICLES) particlesRef.current.push(p);
    };

    const frame = (now: number) => {
      raf = requestAnimationFrame(frame);
      const dt = Math.min(0.05, (now - last) / 1000);
      last = now;
      const dpr = Math.min(2, window.devicePixelRatio || 1);
      const W = canvas.clientWidth;
      const H = canvas.clientHeight;
      if (W === 0 || H === 0) return;
      if (canvas.width !== Math.round(W * dpr) || canvas.height !== Math.round(H * dpr)) {
        canvas.width = Math.round(W * dpr);
        canvas.height = Math.round(H * dpr);
      }
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
      ctx.globalAlpha = 1;
      ctx.shadowBlur = 0;
      ctx.globalCompositeOperation = "source-over";

      const { tier: tr, title, hint: hintText } = propsRef.current;
      const bl = BLOOM[tr];
      const sc = STORM[tr];
      let phaseNow = phaseRef.current;
      const pt = (now - phaseStartRef.current) / 1000;
      const rand: Rand = reduced ? mulberry32(7) : Math.random;
      const L = packLayout(W, H);
      const cut = cutRef.current;
      if (phaseStartRef.current !== seenStart) {
        seenStart = phaseStartRef.current;
        stormIdx = 0;
        bloomAcc = 0;
      }

      // ---- cut progress ----
      if (phaseNow === "ready" || phaseNow === "cutting") {
        const before = cut.progress;
        if (cut.auto) cut.progress += dt * CUT.autoSpeed;
        else if (cut.dragging) cut.progress += (cut.target - cut.progress) * Math.min(1, dt * 30);
        else cut.progress = Math.max(0, cut.progress - dt * CUT.recede);
        if (cut.dragging && !cut.auto && cut.progress >= CUT.autoAt) cut.auto = true;
        cut.progress = clamp01(cut.progress);
        if (cut.progress > 0 && phaseNow === "ready") {
          go("cutting");
          phaseNow = "cutting";
        } else if (cut.progress === 0 && phaseNow === "cutting" && !cut.dragging && !cut.auto) {
          go("ready");
          phaseNow = "ready";
        }
        const moving = Math.abs(cut.progress - before) > 0.001;
        if (moving && cut.progress > 0) {
          const hx = cut.dir > 0 ? L.left + L.pw * cut.progress : L.left + L.pw * (1 - cut.progress);
          for (let i = 0; i < 3; i++) {
            push({ x: hx, y: L.ycut, vx: (rand() - 0.5) * 140, vy: -40 - rand() * 160, life: 0, max: 0.3 + rand() * 0.3, size: 1.5 + rand() * 1.5, color: rand() < 0.5 ? "#fff6c8" : "#ffd36b", rect: false, rot: 0, vr: 0, g: 380 });
          }
        }
        if (cut.progress >= 1) {
          sealStart = now;
          sealDir = cut.dir;
          go("bloom");
          phaseNow = "bloom";
        }
      }

      // ---- timeline ----
      const afterBloom = phaseNow === "bloom" ? pt : 99;
      const st = phaseNow === "storm" ? pt : phaseNow === "done" ? 99 : -1;
      if (phaseNow === "bloom") {
        bloomAcc += bl.rate * dt;
        while (bloomAcc >= 1) {
          bloomAcc -= 1;
          push({ x: L.left + rand() * L.pw, y: L.ycut, vx: (rand() - 0.5) * 30, vy: -(40 + rand() * 120), life: 0, max: 1.2 + rand() * 1.0, size: 1.5 + rand() * 2, color: glow(tr, now + rand() * 600, 0.9, 80), rect: false, rot: 0, vr: 0, g: 0 });
        }
      }
      if (phaseNow === "storm") {
        if (stormIdx === 0 && tr === 0) {
          for (let i = 0; i < 60; i++) push({ x: rand() * W, y: rand() * H, vx: (rand() - 0.5) * 50, vy: -rand() * 40, life: 0, max: 1.2 + rand() * 0.8, size: 1.5 + rand() * 2.5, color: glow(0, now, 0.9), rect: false, rot: 0, vr: 0, g: 0 });
          stormIdx = 1;
        }
        while (stormIdx - (tr === 0 ? 1 : 0) < sc.volleys.length && st >= sc.volleys[stormIdx - (tr === 0 ? 1 : 0)].s) {
          const i = stormIdx - (tr === 0 ? 1 : 0);
          stormIdx++;
          const r = mulberry32(i * 7919 + 13);
          const ex = W * (0.1 + 0.8 * r());
          const ey = H * (0.4 + 0.5 * r());
          const n = tr === 3 ? 22 : tr === 2 ? 10 : 0;
          for (let k = 0; k < n; k++) {
            const a = rand() * Math.PI * 2;
            const sp = 100 + rand() * 340;
            push({ x: ex, y: ey, vx: Math.cos(a) * sp, vy: Math.sin(a) * sp - 100, life: 0, max: 0.7 + rand() * 0.7, size: 3 + rand() * 5, color: tr === 3 ? glow(3, now + k * 40, 1, 70) : "#fff1b8", rect: tr === 3, rot: rand() * 6, vr: (rand() - 0.5) * 14, g: tr === 3 ? 600 : 260 });
          }
        }
      }

      // ---- camera shake ----
      let camAmp = 0;
      if (st >= 0 && !reduced && phaseNow === "storm") {
        for (const v of sc.volleys) {
          if (st < v.s) continue;
          camAmp += sc.camAmp * Math.exp(-(st - v.s) / 0.25);
        }
        camAmp = Math.min(camAmp, sc.camAmp * 1.5);
      }
      const drawBackdrop = () => {
        const sc2 = 1 + (2.2 * camAmp) / Math.min(W, H);
        ctx.save();
        ctx.translate(W / 2 + (rand() - 0.5) * 2 * camAmp, H / 2 + (rand() - 0.5) * 2 * camAmp);
        ctx.scale(sc2, sc2);
        ctx.translate(-W / 2, -H / 2);
        if (cameraOkRef.current && video.readyState >= 2 && video.videoWidth > 0) {
          const s = Math.max(W / video.videoWidth, H / video.videoHeight);
          const dw = video.videoWidth * s;
          const dh = video.videoHeight * s;
          ctx.drawImage(video, (W - dw) / 2, (H - dh) / 2, dw, dh);
        } else {
          const g = ctx.createLinearGradient(0, 0, 0, H);
          g.addColorStop(0, "#10142a");
          g.addColorStop(1, "#2a1a30");
          ctx.fillStyle = g;
          ctx.fillRect(0, 0, W, H);
        }
        ctx.restore();
      };
      ctx.clearRect(0, 0, W, H);
      drawBackdrop();

      // Tier 3 charge: the screen darkens briefly.
      if (phaseNow === "storm" && tr === 3 && st < sc.charge && !reduced) {
        ctx.fillStyle = `rgba(0,0,10,${Math.sin(clamp01(st / sc.charge) * Math.PI) * 0.55})`;
        ctx.fillRect(0, 0, W, H);
      }

      // ---- pack ----
      const floating = phaseNow === "ready" || phaseNow === "cutting";
      const float = reduced || !floating ? 0 : Math.sin(now / 900) * 4;
      let packDy = float;
      let packAlpha = 1;
      if (phaseNow === "done") {
        packDy += easeIn(pt / 0.7) * H * 0.4;
        packAlpha = 1 - clamp01(pt / 0.7);
      }
      const trem = phaseNow === "bloom" && !reduced ? bl.tremble : 0;
      const px = L.left + (trem ? (rand() - 0.5) * 2 * trem : 0);
      const ptop = L.top + packDy + (trem ? (rand() - 0.5) * 2 * trem : 0);
      const ycut = L.ycut + packDy;
      const sealGone = phaseNow === "bloom" || phaseNow === "storm" || phaseNow === "done";

      const drawSeal = (cx: number, cy: number, rot: number, alpha: number) => {
        const w = L.pw;
        const h = L.sb;
        ctx.save();
        ctx.globalAlpha = alpha;
        ctx.translate(cx, cy);
        ctx.rotate(rot);
        const g = ctx.createLinearGradient(-w / 2, 0, w / 2, 0);
        g.addColorStop(0, "#9aa4bd");
        g.addColorStop(0.3, "#f2f5ff");
        g.addColorStop(0.55, "#aab3cc");
        g.addColorStop(0.8, "#eef1fb");
        g.addColorStop(1, "#8f99b4");
        ctx.fillStyle = g;
        ctx.beginPath();
        const teeth = 22;
        ctx.moveTo(-w / 2, h / 2);
        ctx.lineTo(-w / 2, -h / 2);
        for (let i = 0; i < teeth; i++) {
          ctx.lineTo(-w / 2 + (w / teeth) * (i + 0.5), -h / 2 - h * 0.18);
          ctx.lineTo(-w / 2 + (w / teeth) * (i + 1), -h / 2);
        }
        ctx.lineTo(w / 2, h / 2);
        ctx.closePath();
        ctx.fill();
        ctx.strokeStyle = "rgba(60,70,100,.35)";
        ctx.lineWidth = 1;
        for (let i = 1; i < 40; i++) {
          ctx.beginPath();
          ctx.moveTo(-w / 2 + (w / 40) * i, -h / 2);
          ctx.lineTo(-w / 2 + (w / 40) * i, h / 2);
          ctx.stroke();
        }
        ctx.restore();
      };

      const drawPack = () => {
        const w = L.pw;
        const bodyTop = sealGone ? ycut : ptop;
        const h = ptop + L.ph - bodyTop;
        ctx.save();
        ctx.globalAlpha = packAlpha;
        // soft shadow falling downward (stacked translucent shapes; no shadowBlur)
        for (let i = 6; i >= 1; i--) {
          ctx.fillStyle = `rgba(0,0,0,${0.05})`;
          roundRectPath(ctx, px - 2 - i * 2, bodyTop + 6 + i * 5, w + 4 + i * 4, h, 14);
          ctx.fill();
        }
        // body
        roundRectPath(ctx, px, bodyTop, w, h, 14);
        const g = ctx.createLinearGradient(px, bodyTop, px + w, bodyTop + w);
        g.addColorStop(0, "#3a4fb8");
        g.addColorStop(0.5, "#5a3fb0");
        g.addColorStop(1, "#1f2a6e");
        ctx.fillStyle = g;
        ctx.fill();
        ctx.save();
        roundRectPath(ctx, px, bodyTop, w, h, 14);
        ctx.clip();
        // hologram-like diagonal sheen that slowly drifts
        const drift = reduced ? 0 : (now / 4000) % 1;
        const hg = ctx.createLinearGradient(px - w + w * 2 * drift, bodyTop, px + w * 2 * drift, bodyTop + w * 1.2);
        hg.addColorStop(0, "rgba(255,120,200,0)");
        hg.addColorStop(0.25, "rgba(255,120,200,.28)");
        hg.addColorStop(0.4, "rgba(120,240,255,.32)");
        hg.addColorStop(0.55, "rgba(255,240,140,.26)");
        hg.addColorStop(0.7, "rgba(160,140,255,.28)");
        hg.addColorStop(1, "rgba(160,140,255,0)");
        ctx.fillStyle = hg;
        ctx.fillRect(px, bodyTop, w, h);
        ctx.fillStyle = "rgba(255,255,255,.1)";
        for (let i = 0; i < 4; i++) {
          const o = w * (0.1 + i * 0.28);
          ctx.beginPath();
          ctx.moveTo(px + o, bodyTop);
          ctx.lineTo(px + o + w * 0.08, bodyTop);
          ctx.lineTo(px + o - w * 0.5 + w * 0.08, bodyTop + w * 1.2);
          ctx.lineTo(px + o - w * 0.5, bodyTop + w * 1.2);
          ctx.closePath();
          ctx.fill();
        }
        // own geometric mark
        const mx = px + w / 2;
        const my = ptop + w * 0.5;
        const r = w * 0.15;
        ctx.strokeStyle = "rgba(255,255,255,.7)";
        ctx.lineWidth = 2.5;
        for (let i = 0; i < 3; i++) {
          ctx.save();
          ctx.translate(mx, my);
          ctx.rotate((Math.PI / 6) * i);
          ctx.strokeRect(-r, -r, r * 2, r * 2);
          ctx.restore();
        }
        ctx.beginPath();
        ctx.arc(mx, my, r * 0.45, 0, Math.PI * 2);
        ctx.stroke();
        ctx.restore();
        ctx.restore();
        if (!sealGone) drawSeal(px + w / 2, ptop + L.sb / 2, 0, packAlpha);
      };
      if (phaseNow !== "done" || packAlpha > 0.01) drawPack();

      // Flying seal band.
      if (phaseNow === "bloom") {
        const e = (now - sealStart) / 1000;
        if (e < 0.8) {
          const k = easeOut(e / 0.8);
          drawSeal(L.left + L.pw / 2 + sealDir * k * W * 0.15, L.top + L.sb / 2 - k * H * 0.4, sealDir * k * 5, 1 - clamp01(e / 0.8));
        }
      }

      // Cut line, finger hint, cut glow.
      if (phaseNow === "ready" || phaseNow === "cutting") {
        ctx.save();
        ctx.setLineDash([6, 6]);
        ctx.strokeStyle = "rgba(255,255,255,.65)";
        ctx.lineWidth = 1.5;
        ctx.beginPath();
        ctx.moveTo(px + 6, ycut);
        ctx.lineTo(px + L.pw - 6, ycut);
        ctx.stroke();
        ctx.restore();
        if (phaseNow === "ready") {
          const tri = reduced ? 0.5 : Math.abs(((now / 1400) % 2) - 1);
          const hx = px + L.pw * (0.08 + 0.84 * tri);
          ctx.save();
          ctx.globalCompositeOperation = "lighter";
          for (let i = 0; i < 4; i++) {
            const tt = reduced ? 0.5 : Math.abs((((now - i * 60) / 1400) % 2) - 1);
            const x = px + L.pw * (0.08 + 0.84 * tt);
            const gr = ctx.createRadialGradient(x, ycut, 1, x, ycut, 14 - i * 2.5);
            gr.addColorStop(0, `rgba(255,248,210,${0.9 - i * 0.2})`);
            gr.addColorStop(1, "rgba(255,248,210,0)");
            ctx.fillStyle = gr;
            ctx.fillRect(x - 16, ycut - 16, 32, 32);
          }
          ctx.restore();
          void hx;
          ctx.font = "600 14px system-ui, sans-serif";
          ctx.textAlign = "center";
          ctx.lineWidth = 4;
          ctx.strokeStyle = "rgba(0,0,0,.6)";
          ctx.strokeText(hintText, W / 2, ycut + 34, W - 24);
          ctx.fillStyle = "#fff";
          ctx.fillText(hintText, W / 2, ycut + 34, W - 24);
        }
        if (cut.progress > 0) {
          const x0 = cut.dir > 0 ? px : px + L.pw;
          const x1 = cut.dir > 0 ? px + L.pw * cut.progress : px + L.pw * (1 - cut.progress);
          ctx.save();
          ctx.globalCompositeOperation = "lighter";
          ctx.lineCap = "round";
          const widths: [number, string][] = [[14, "rgba(255,200,90,.18)"], [6, "rgba(255,230,150,.5)"], [2.2, "rgba(255,255,255,1)"]];
          for (const [lw, col] of widths) {
            ctx.lineWidth = lw;
            ctx.strokeStyle = col;
            ctx.beginPath();
            ctx.moveTo(x0, ycut);
            ctx.lineTo(x1, ycut);
            ctx.stroke();
          }
          const gr = ctx.createRadialGradient(x1, ycut, 1, x1, ycut, 26);
          gr.addColorStop(0, "rgba(255,250,220,.95)");
          gr.addColorStop(1, "rgba(255,200,90,0)");
          ctx.fillStyle = gr;
          ctx.fillRect(x1 - 28, ycut - 28, 56, 56);
          ctx.restore();
        }
      }

      // ---- bloom light (additive) ----
      const lightOn = phaseNow === "bloom" || phaseNow === "storm";
      if (lightOn) {
        const p = phaseNow === "bloom" ? clamp01(afterBloom / bl.dur) : 1;
        const fade = phaseNow === "storm" ? Math.max(0.35, 1 - st / sc.dur) : 1;
        const k = easeOut(p) * bl.strength * fade;
        ctx.save();
        ctx.globalCompositeOperation = "lighter";
        // soft horizontal band along the cut
        ctx.save();
        ctx.translate(W / 2, ycut);
        ctx.scale(L.pw * 0.62, 20 + 90 * easeOut(p));
        const bg = ctx.createRadialGradient(0, 0, 0, 0, 0, 1);
        bg.addColorStop(0, glow(tr, now, k, 85));
        bg.addColorStop(1, glow(tr, now, 0, 85));
        ctx.fillStyle = bg;
        ctx.fillRect(-1, -1, 2, 2);
        ctx.restore();
        // column of light
        const topY = H * bl.colTop;
        const colTop = ycut - (ycut - topY) * easeOut(p);
        const cg = ctx.createLinearGradient(0, ycut, 0, colTop);
        cg.addColorStop(0, glow(tr, now, k * 0.9, 80));
        cg.addColorStop(1, glow(tr, now + 400, 0, 80));
        ctx.fillStyle = cg;
        ctx.beginPath();
        ctx.moveTo(W / 2 - L.pw * 0.4, ycut);
        ctx.lineTo(W / 2 + L.pw * 0.4, ycut);
        ctx.lineTo(W / 2 + L.pw * 0.17, colTop);
        ctx.lineTo(W / 2 - L.pw * 0.17, colTop);
        ctx.closePath();
        ctx.fill();
        ctx.restore();
        // tier 3: thin discharge flickering around the cut
        if (phaseNow === "bloom" && bl.discharge && Math.floor(now / 70) % 2 === 0) {
          ctx.save();
          ctx.globalCompositeOperation = "lighter";
          for (let i = 0; i < 2; i++) {
            const sx = L.left + L.pw * (0.1 + rand() * 0.8);
            const a = -Math.PI / 2 + (rand() - 0.5) * 2.2;
            const len = 50 + rand() * 70;
            drawBolt(ctx, rand, dpr, [sx, ycut], [sx + Math.cos(a) * len, ycut + Math.sin(a) * len], 1.5, [glow(3, now, 1, 70), "#ffffff"], 0, reduced ? 0.4 : 0.9);
          }
          ctx.restore();
        }
      }

      // ---- storm (additive) ----
      if (phaseNow === "storm") {
        ctx.save();
        ctx.globalCompositeOperation = "lighter";
        if (tr === 2) {
          const k = Math.max(0, 1 - st / sc.dur);
          const eg = ctx.createRadialGradient(W / 2, H / 2, Math.min(W, H) * 0.35, W / 2, H / 2, Math.max(W, H) * 0.75);
          eg.addColorStop(0, "rgba(255,200,80,0)");
          eg.addColorStop(1, `rgba(255,200,80,${0.55 * k})`);
          ctx.fillStyle = eg;
          ctx.fillRect(0, 0, W, H);
        }
        if (tr === 3 && st > sc.charge) {
          const k = Math.exp(-(st - sc.charge) / 1.1);
          const eg = ctx.createRadialGradient(W / 2, H / 2, Math.min(W, H) * 0.2, W / 2, H / 2, Math.max(W, H) * 0.8);
          eg.addColorStop(0, "rgba(255,255,255,0)");
          eg.addColorStop(1, glow(3, now, 0.5 * k, 60));
          ctx.fillStyle = eg;
          ctx.fillRect(0, 0, W, H);
        }
        const colors: [string, string] = tr === 1 ? ["#8fd3ff", "#ffffff"] : tr === 2 ? ["#ffd36b", "#ffffff"] : [glow(3, now, 1, 65), "#fff3b0"];
        sc.volleys.forEach((v, i) => {
          if (st < v.s || st > v.s + v.l) return;
          const flick = reduced ? 1 : Math.floor(st * 40) % 4 === 3 ? 0.35 : 1;
          const r = mulberry32(i * 7919 + 13);
          const x0 = W * (0.1 + 0.8 * r());
          const y1 = H * (0.4 + 0.5 * r());
          const x1 = x0 + (r() - 0.5) * W * 0.4;
          drawBolt(ctx, rand, dpr, [x0, -10], [x1, y1], v.w, colors, v.br, reduced ? 0.45 : flick);
        });
        ctx.restore();
      }

      // ---- particles ----
      {
        ctx.save();
        ctx.globalCompositeOperation = "lighter";
        const next: Particle[] = [];
        for (const p of particlesRef.current) {
          p.life += reduced ? dt * 2 : dt;
          if (p.life >= p.max) continue;
          if (!reduced) {
            p.x += p.vx * dt;
            p.y += p.vy * dt;
            p.vy += p.g * dt;
            p.rot += p.vr * dt;
          }
          ctx.globalAlpha = clamp01(1 - p.life / p.max);
          ctx.fillStyle = p.color;
          if (p.rect) {
            ctx.save();
            ctx.translate(p.x, p.y);
            ctx.rotate(p.rot);
            ctx.fillRect(-p.size / 2, -p.size / 4, p.size, p.size / 2);
            ctx.restore();
          } else {
            ctx.beginPath();
            ctx.arc(p.x, p.y, p.size, 0, Math.PI * 2);
            ctx.fill();
          }
          next.push(p);
        }
        particlesRef.current = next;
        ctx.restore();
      }

      // ---- card (done) ----
      if (phaseNow === "done") {
        const ch = Math.min(H * 0.42, W * 0.8 * 1.4);
        const cw = ch * 0.714;
        const cardCy = H * 0.4;
        const k = easeOut(pt / 0.9);
        const cy = cardCy + (1 - k) * H * 0.5;
        const scale = 0.7 + 0.3 * k;
        const wob = reduced ? 0 : Math.sin(pt * 11) * 0.05 * Math.exp(-pt * 3.2);
        ctx.save();
        // the last light the card rises out of
        ctx.globalCompositeOperation = "lighter";
        const bg = ctx.createRadialGradient(W / 2, cardCy, 4, W / 2, cardCy, Math.max(W, H) * 0.5);
        bg.addColorStop(0, glow(tr, now, 0.7 * Math.exp(-pt * 2.5), 85));
        bg.addColorStop(1, glow(tr, now, 0, 85));
        ctx.fillStyle = bg;
        ctx.fillRect(0, 0, W, H);
        ctx.restore();

        ctx.save();
        ctx.globalAlpha = clamp01(pt / 0.3);
        ctx.translate(W / 2, cy);
        ctx.rotate(wob);
        ctx.scale(scale, scale);
        const w = cw;
        const h = ch;
        ctx.save();
        roundRectPath(ctx, -w / 2, -h / 2, w, h, w * 0.07);
        ctx.fillStyle = "#f4efe2";
        ctx.fill();
        ctx.clip();
        const img = imageRef.current;
        if (img && img.naturalWidth > 0) {
          const s = Math.min(w / img.naturalWidth, h / img.naturalHeight);
          ctx.drawImage(img, -(img.naturalWidth * s) / 2, -(img.naturalHeight * s) / 2, img.naturalWidth * s, img.naturalHeight * s);
        } else {
          // placeholder: no title text here, the title is drawn once below the card
          const g = ctx.createLinearGradient(-w / 2, -h / 2, w / 2, h / 2);
          g.addColorStop(0, "#fdf3c4");
          g.addColorStop(1, "#c9b6ff");
          ctx.fillStyle = g;
          ctx.fillRect(-w / 2, -h / 2, w, h);
          ctx.strokeStyle = "rgba(0,0,0,.25)";
          ctx.lineWidth = 2;
          ctx.strokeRect(-w / 2 + w * 0.08, -h / 2 + w * 0.08, w * 0.84, h * 0.7);
          ctx.beginPath();
          ctx.moveTo(0, -h * 0.28);
          ctx.lineTo(w * 0.22, -h * 0.05);
          ctx.lineTo(0, h * 0.18);
          ctx.lineTo(-w * 0.22, -h * 0.05);
          ctx.closePath();
          ctx.stroke();
        }
        ctx.restore();
        roundRectPath(ctx, -w / 2, -h / 2, w, h, w * 0.07);
        ctx.lineWidth = 2;
        ctx.strokeStyle = "rgba(255,255,255,.85)";
        ctx.stroke();
        ctx.restore();

        // title, once
        ctx.save();
        ctx.globalAlpha = clamp01((pt - 0.7) / 0.3);
        ctx.font = "600 17px system-ui, sans-serif";
        ctx.textAlign = "center";
        ctx.lineWidth = 5;
        ctx.strokeStyle = "rgba(0,0,0,.65)";
        ctx.strokeText(title, W / 2, cardCy + ch / 2 + 34, W - 32);
        ctx.fillStyle = "#fff";
        ctx.fillText(title, W / 2, cardCy + ch / 2 + 34, W - 32);
        ctx.restore();
      }

      // ---- whole-screen flash (whiteout), at least 0.5 s apart; none for reduced motion ----
      if (phaseNow === "storm" && !reduced) {
        let fl = 0;
        for (const ft of sc.flashes) {
          const e = st - ft;
          if (e >= 0 && e < 0.25) fl = Math.max(fl, sc.flashAlpha * (1 - e / 0.25));
        }
        if (fl > 0.01) {
          ctx.fillStyle = `rgba(255,255,255,${fl})`;
          ctx.fillRect(0, 0, W, H);
        }
      }

      // ---- phase progression ----
      if (phaseNow === "bloom" && pt >= bl.dur) go("storm");
      else if (phaseNow === "storm" && pt >= sc.dur) go("done");
    };
    raf = requestAnimationFrame(frame);
    return () => {
      cancelAnimationFrame(raf);
      motionQuery.removeEventListener("change", onMotion);
    };
  }, [go]);

  // Pointer: drag across the cut line; a plain tap on the pack cuts it automatically.
  const onPointerDown = (e: React.PointerEvent<HTMLCanvasElement>) => {
    const ph = phaseRef.current;
    if (ph !== "ready" && ph !== "cutting") return;
    const rect = e.currentTarget.getBoundingClientRect();
    const x = e.clientX - rect.left;
    const y = e.clientY - rect.top;
    const L = packLayout(rect.width, rect.height);
    const cut = cutRef.current;
    cut.startX = x;
    cut.startY = y;
    cut.moved = 0;
    if (Math.abs(y - L.ycut) > Math.max(60, rect.height * CUT.bandRatio) || x < L.left - 30 || x > L.left + L.pw + 30) return;
    if (!cut.auto) {
      cut.dir = x < rect.width / 2 ? 1 : -1;
      cut.dragging = true;
      cut.target = clamp01(cut.dir > 0 ? (x - L.left) / L.pw : (L.left + L.pw - x) / L.pw);
      e.currentTarget.setPointerCapture(e.pointerId);
    }
  };
  const onPointerMove = (e: React.PointerEvent<HTMLCanvasElement>) => {
    const cut = cutRef.current;
    if (!cut.dragging) return;
    const rect = e.currentTarget.getBoundingClientRect();
    const L = packLayout(rect.width, rect.height);
    const x = e.clientX - rect.left;
    cut.moved = Math.max(cut.moved, Math.hypot(x - cut.startX, e.clientY - rect.top - cut.startY));
    cut.target = clamp01(cut.dir > 0 ? (x - L.left) / L.pw : (L.left + L.pw - x) / L.pw);
  };
  const onPointerUp = (e: React.PointerEvent<HTMLCanvasElement>) => {
    const cut = cutRef.current;
    const ph = phaseRef.current;
    const wasDragging = cut.dragging;
    cut.dragging = false;
    if (ph !== "ready" && ph !== "cutting") return;
    const rect = e.currentTarget.getBoundingClientRect();
    const L = packLayout(rect.width, rect.height);
    const y = e.clientY - rect.top;
    // a tap (hardly any movement) on the pack cuts it by itself
    if (cut.moved < 12 && y > L.top - 20 && !cut.auto) {
      if (wasDragging) cut.dir = cut.startX < rect.width / 2 ? 1 : -1;
      cut.auto = true;
    }
  };
  const triggerCut = () => {
    const cut = cutRef.current;
    cut.dir = 1;
    cut.auto = true;
  };

  return (
    <div className="cameraReveal" role="dialog" aria-modal="true">
      <video ref={videoRef} className="cameraRevealVideo" playsInline muted autoPlay />
      <canvas ref={canvasRef} className="cameraRevealCanvas" onPointerDown={onPointerDown} onPointerMove={onPointerMove} onPointerUp={onPointerUp} onPointerCancel={onPointerUp} />
      {(phase === "ready" || phase === "cutting") && (
        <button type="button" className="cameraRevealCut" aria-label={t(cameraRevealUi.cutLabel)} onClick={triggerCut} />
      )}
      <div className="cameraRevealTop">
        <div>
          {demo && <span className="demoBadge">DEMO DATA</span>}
          {cameraFailed && <p className="cameraRevealNote">{t(cameraRevealUi.noCamera)}{cameraError ? ` (${cameraError})` : ""}</p>}
        </div>
        <button type="button" className="cameraRevealClose" onClick={handleClose} aria-label={t(cameraRevealUi.closeLabel)}>
          ×
        </button>
      </div>
      {phase === "done" && (
        <div className="cameraRevealBar cameraRevealBarIn">
          <button type="button" className="cameraRevealBtn solid" onClick={restart}>{t(cameraRevealUi.again)}</button>
          <button type="button" className="cameraRevealBtn" onClick={handleClose}>{t(cameraRevealUi.close)}</button>
        </div>
      )}
    </div>
  );
}
