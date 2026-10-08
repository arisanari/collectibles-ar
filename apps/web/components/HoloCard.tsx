"use client";

/* eslint-disable @next/next/no-img-element -- the card image is served by Collector Crypt's host and read at run time */
import { useEffect, useImperativeHandle, useRef, useState, type Ref } from "react";
import { useDeviceTilt } from "../lib/reveal/useDeviceTilt";

export type HoloCardHandle = { flip: (dir?: 1 | -1) => void };

type Props = {
  imageUrl?: string;
  backImageUrl?: string;
  title: string;
  foil: 0 | 1 | 2 | 3;
  demo: boolean;
  /** Which face is toward the viewer at the start. Default "front". */
  initialFace?: "front" | "back";
  /** When false, drag, tap and keys are ignored (the parent can still turn it with `controlRef`). Default true. */
  interactive?: boolean;
  /** Lets a parent turn the card over: flip(1) is half a turn. */
  controlRef?: Ref<HoloCardHandle>;
};

/* ---- tuning values ---- */
const SENSOR_MAX = 22; // degrees of card tilt from the phone's tilt
const FINGER_MAX = 28; // degrees of pitch from dragging vertically
const TILT_MAX = 34;
const YAW_PER_PX = 0.5; // degrees of turn per px of horizontal drag
const FRICTION = 2.2; // coasting deceleration (1/s); a hard flick of 1500 deg/s turns about two times
const SNAP_SPEED = 60; // deg/s below which the card is pulled to the nearest face
const SPRING_K = 45; // spring toward a face (yaw) and toward the pitch target
const SPRING_C = 10;
const MAX_SPEED = 2500;
const TAP_MS = 250;
const LAYERS = 10; // thin rounded outlines stacked through the case thickness (no gaps at the corners)
const DEPTH_RATIO = 0.086; // thickness / width (used for the shadow width)
const MID = [172, 180, 192, 0.5]; // resin outline colour in the middle of the thickness (r, g, b, a)
const EDGE = [226, 231, 239, 0.72]; // and next to the front/back faces
const GLARE_SHIFT = 1.6; // how far the highlight moves per degree of tilt (percent per degree)
const FLASH_AT = 78; // degrees from facing at which the resin face flashes just before edge-on
// Foil region, thickness and light strength are CSS variables on .holoCard: --foil-top/-left/-right/-bottom, --depth.

const clamp = (v: number, a: number, b: number) => Math.max(a, Math.min(b, v));
const D2R = Math.PI / 180;

export function isHttpsUrl(value: string | null | undefined): value is string {
  if (!value) return false;
  try {
    return new URL(value).protocol === "https:";
  } catch {
    return false;
  }
}

/**
 * One real card: the photo of the graded slab with light reacting to tilt on top (glare, foil, case edge, shadow).
 * Tilt comes from the phone's orientation and from dragging; the visuals are CSS driven by custom properties that an
 * animation frame updates (no React re-render while moving).
 */
export function HoloCard({ imageUrl, backImageUrl, title, foil, demo, initialFace = "front", interactive = true, controlRef }: Props) {
  const rootRef = useRef<HTMLDivElement>(null);
  const fingerRef = useRef({ active: false, nx: 0, ny: 0 });
  // rotation state shared by the pointer handlers and the animation frame
  const st = useRef({ yaw: initialFace === "back" ? 180 : 0, vyaw: 0, target: null as number | null, dragging: false, lastX: 0, lastT: 0, vel: 0, downT: 0, downX: 0, downY: 0, moved: 0 });
  const tilt = useDeviceTilt();
  const [failedUrl, setFailedUrl] = useState<string | null>(null);
  const [failedBack, setFailedBack] = useState<string | null>(null);
  const safeUrl = isHttpsUrl(imageUrl) ? imageUrl : undefined;
  const safeBack = isHttpsUrl(backImageUrl) ? backImageUrl : undefined;
  const showImage = safeUrl !== undefined && failedUrl !== safeUrl;
  const showBack = safeBack !== undefined && failedBack !== safeBack;
  const layerStyles = Array.from({ length: LAYERS }, (_, i) => {
    const lz = -0.5 + (i + 1) / (LAYERS + 1); // -0.5 .. 0.5 of the thickness
    const k = Math.pow(Math.min(1, Math.abs(lz) / (0.5 - 0.5 / (LAYERS + 1))), 1.5);
    const c = MID.map((m, j) => m + (EDGE[j] - m) * k);
    return { "--lz": lz, "--layer-c": `rgba(${c[0].toFixed(0)},${c[1].toFixed(0)},${c[2].toFixed(0)},${c[3].toFixed(2)})` } as React.CSSProperties;
  });
  const [startFace] = useState(initialFace);
  const flip = (dir: 1 | -1) => {
    const s = st.current;
    s.target = Math.round(s.yaw / 180) * 180 + dir * 180;
  };
  useImperativeHandle(
    controlRef,
    () => ({
      flip: (dir = 1) => {
        const s = st.current;
        s.target = Math.round(s.yaw / 180) * 180 + dir * 180;
      },
    }),
    [],
  );

  useEffect(() => {
    const root = rootRef.current;
    if (!root) return;
    const motion = window.matchMedia("(prefers-reduced-motion: reduce)");
    let reduced = motion.matches;
    const onMotion = () => {
      reduced = motion.matches;
    };
    motion.addEventListener("change", onMotion);
    const s = st.current;
    const p = { pitch: 0, vpitch: 0, sb: 0, sg: 0 };
    let face: string = startFace;
    let last = performance.now();
    let raf = 0;
    const frame = (now: number) => {
      raf = requestAnimationFrame(frame);
      const dt = Math.min(0.05, (now - last) / 1000);
      last = now;
      const sensor = tilt.current;
      const k = 1 - Math.exp(-dt * 10);
      p.sb += ((sensor.active ? clamp(sensor.dBeta, -SENSOR_MAX, SENSOR_MAX) : 0) - p.sb) * k;
      p.sg += ((sensor.active ? clamp(sensor.dGamma, -SENSOR_MAX, SENSOR_MAX) : 0) - p.sg) * k;

      // yaw: free spin with friction, then a spring to the nearest face (front 0 deg, back 180 deg) or to a flip target
      if (!s.dragging) {
        const snapping = s.target !== null || Math.abs(s.vyaw) < SNAP_SPEED;
        if (snapping) {
          const tgt = s.target ?? Math.round(s.yaw / 180) * 180;
          s.vyaw += ((tgt - s.yaw) * SPRING_K - s.vyaw * SPRING_C) * dt;
        } else {
          s.vyaw *= Math.exp(-dt * FRICTION * (reduced ? 3 : 1));
        }
        s.yaw += s.vyaw * dt;
        if (s.target !== null && Math.abs(s.target - s.yaw) < 0.4 && Math.abs(s.vyaw) < 4) {
          s.yaw = s.target;
          s.vyaw = 0;
          s.target = null;
        }
      }
      if (Math.abs(s.yaw) > 720) {
        const sub = Math.trunc(s.yaw / 360) * 360; // multiples of 360 keep the same face
        s.yaw -= sub;
        if (s.target !== null) s.target -= sub;
      }
      const resting = !s.dragging && s.target === null && Math.abs(s.vyaw) < 5;
      const idle = !sensor.active && !reduced && resting && !fingerRef.current.active;

      // pitch: finger position while dragging, back to level when released
      const f = fingerRef.current;
      let pt = f.active ? -f.ny * FINGER_MAX : 0;
      if (idle) pt += Math.sin(now / 2200) * 5;
      p.vpitch += ((clamp(pt, -FINGER_MAX, FINGER_MAX) - p.pitch) * SPRING_K * 1.3 - p.vpitch * SPRING_C) * dt;
      p.pitch += p.vpitch * dt;
      const rx = clamp(p.pitch + p.sb, -TILT_MAX, TILT_MAX);
      const ry = s.yaw + p.sg + (idle ? Math.cos(now / 1700) * 7 : 0);

      // which face is toward the viewer, and the angle away from facing it (-90..90)
      const yn = ((ry % 360) + 360) % 360;
      const backVisible = yn > 90 && yn < 270;
      const nearest = Math.round(ry / 180) * 180;
      const a = ry - nearest;
      const aAbs = Math.abs(a);
      const graze = 1 - Math.cos(clamp(aAbs, 0, 90) * D2R);
      const flash = Math.exp(-(((aAbs - FLASH_AT) / 9) ** 2));
      // the light stays put in the room: the highlight slides toward the edge that comes closer; the back face mirrors x
      const mx = clamp(50 - a * GLARE_SHIFT, 0, 100);
      const my = clamp(50 + rx * GLARE_SHIFT, 0, 100);
      const hyp = clamp(Math.hypot(mx - 50, my - 50) / 50, 0, 1);
      const ang = (Math.atan2(mx - 50, -(my - 50)) * 180) / Math.PI;
      const bAng = (Math.atan2(-(mx - 50), -(my - 50)) * 180) / Math.PI;
      const sp = clamp(50 + (mx - 50) * 1.4 + (my - 50) * 0.5, -15, 115);
      const bsp = clamp(50 + (100 - mx - 50) * 1.4 + (my - 50) * 0.5, -15, 115);
      const fx = clamp(50 - (a / 90) * 60, -20, 120);
      const w = clamp(Math.abs(Math.cos(ry * D2R)) * (1 - DEPTH_RATIO) + Math.abs(Math.sin(ry * D2R)) * DEPTH_RATIO, 0.09, 1);
      const style = root.style;
      style.setProperty("--rx", `${rx.toFixed(2)}deg`);
      style.setProperty("--ry", `${ry.toFixed(2)}deg`);
      style.setProperty("--mx", `${mx.toFixed(1)}%`);
      style.setProperty("--bmx", `${(100 - mx).toFixed(1)}%`);
      style.setProperty("--my", `${my.toFixed(1)}%`);
      style.setProperty("--hyp", hyp.toFixed(3));
      style.setProperty("--graze", graze.toFixed(3));
      style.setProperty("--flash", flash.toFixed(3));
      style.setProperty("--sp", `${sp.toFixed(1)}%`);
      style.setProperty("--bsp", `${bsp.toFixed(1)}%`);
      style.setProperty("--fx", `${fx.toFixed(1)}%`);
      style.setProperty("--bfx", `${(100 - fx).toFixed(1)}%`);
      style.setProperty("--edge-ang", `${ang.toFixed(1)}deg`);
      style.setProperty("--bedge-ang", `${bAng.toFixed(1)}deg`);
      style.setProperty("--ssx", w.toFixed(3));
      style.setProperty("--sx", `${(-Math.sin(ry * D2R) * 24).toFixed(1)}px`);
      style.setProperty("--sy", `${(16 + rx * 0.8).toFixed(1)}px`);
      const nextFace = backVisible ? "back" : "front";
      if (nextFace !== face) {
        face = nextFace;
        root.setAttribute("data-face", face);
      }
    };
    raf = requestAnimationFrame(frame);
    return () => {
      cancelAnimationFrame(raf);
      motion.removeEventListener("change", onMotion);
    };
  }, [tilt, startFace]);

  const onDown = (e: React.PointerEvent<HTMLDivElement>) => {
    if (!interactive) return;
    const s = st.current;
    const r = e.currentTarget.getBoundingClientRect();
    fingerRef.current = { active: true, nx: clamp(((e.clientX - r.left) / r.width) * 2 - 1, -1, 1), ny: clamp(((e.clientY - r.top) / r.height) * 2 - 1, -1, 1) };
    s.dragging = true;
    s.target = null;
    s.vyaw = 0;
    s.vel = 0;
    s.lastX = e.clientX;
    s.lastT = e.timeStamp;
    s.downT = e.timeStamp;
    s.downX = e.clientX;
    s.downY = e.clientY;
    s.moved = 0;
    e.currentTarget.setPointerCapture(e.pointerId);
  };
  const onMove = (e: React.PointerEvent<HTMLDivElement>) => {
    const s = st.current;
    if (!s.dragging) return;
    const r = e.currentTarget.getBoundingClientRect();
    fingerRef.current.nx = clamp(((e.clientX - r.left) / r.width) * 2 - 1, -1, 1);
    fingerRef.current.ny = clamp(((e.clientY - r.top) / r.height) * 2 - 1, -1, 1);
    const dx = e.clientX - s.lastX;
    const dt = Math.max(0.001, (e.timeStamp - s.lastT) / 1000);
    s.yaw += dx * YAW_PER_PX;
    s.vel = s.vel * 0.6 + ((dx * YAW_PER_PX) / dt) * 0.4;
    s.lastX = e.clientX;
    s.lastT = e.timeStamp;
    s.moved = Math.max(s.moved, Math.hypot(e.clientX - s.downX, e.clientY - s.downY));
  };
  const onUp = (e: React.PointerEvent<HTMLDivElement>) => {
    const s = st.current;
    if (!s.dragging) return;
    s.dragging = false;
    fingerRef.current.active = false;
    if (s.moved < 8 && e.timeStamp - s.downT < TAP_MS) {
      flip(1); // a short tap turns the card over
      return;
    }
    // coast at the speed of the release; a pause before lifting the finger means no spin
    s.vyaw = e.timeStamp - s.lastT > 80 ? 0 : clamp(s.vel, -MAX_SPEED, MAX_SPEED);
  };
  const onKey = (e: React.KeyboardEvent<HTMLDivElement>) => {
    if (!interactive) return;
    if (e.key === "ArrowLeft") flip(-1);
    else if (e.key === "ArrowRight" || e.key === "Enter" || e.key === " ") flip(1);
    else return;
    e.preventDefault();
  };

  const layers = (
    <>
      <div className="holoGlare" />
      <div className="holoMicro" />
      <div className="holoFlash" />
    </>
  );

  return (
    <div
      ref={rootRef}
      className="holoCard"
      data-foil={foil}
      data-demo={demo}
      data-face={startFace}
      data-interactive={interactive}
      role="button"
      tabIndex={interactive ? 0 : -1}
      aria-label={title}
      onPointerDown={onDown}
      onPointerMove={onMove}
      onPointerUp={onUp}
      onPointerCancel={onUp}
      onKeyDown={onKey}
    >
      <div className="holoCardShadow" />
      <div className="holoCardBody">
        {layerStyles.map((st2, i) => (
          <div key={i} className="holoLayer" style={st2} />
        ))}
        <div className="holoCardFace holoFront">
          {showImage ? (
            <img key={safeUrl} className="holoCardImg" src={safeUrl} alt="" draggable={false} onError={() => setFailedUrl(safeUrl)} />
          ) : (
            <div className="holoPlaceholder">
              <div className="holoPlaceholderLabel" />
              <div className="holoPlaceholderArt" />
            </div>
          )}
          {layers}
          {foil > 0 && <div className={`holoFoil f${foil}`} />}
          {foil === 3 && <div className="holoGlitter" />}
          <div className="holoEdge" />
        </div>
        <div className="holoCardFace holoBack">
          {showBack ? (
            <img key={safeBack} className="holoCardImg" src={safeBack} alt="" draggable={false} onError={() => setFailedBack(safeBack)} />
          ) : (
            <div className="holoPlaceholder holoPlaceholderBack" />
          )}
          {layers}
          <div className="holoEdge" />
        </div>
      </div>
    </div>
  );
}
