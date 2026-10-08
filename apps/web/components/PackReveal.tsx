"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { cameraRevealUi, holoUi, packUi, pullUi } from "../lib/copy/pull";
import { useI18n } from "../lib/i18n";
import { makeBolt, drawBoltShape, type BoltShape, type Pt, type Rand } from "../lib/reveal/bolt2d";
import { OrientationTracker } from "../lib/reveal/deviceOrientation";
import { useCameraStream } from "../lib/reveal/useCameraStream";
import { useDeviceTilt } from "../lib/reveal/useDeviceTilt";
import { HoloCard, type HoloCardHandle } from "./HoloCard";

type Tier = 0 | 1 | 2 | 3;
type Phase = "waiting" | "armed" | "struck1" | "struck2" | "whiteout" | "rise" | "facts" | "flip" | "done" | "sold";
type Fact = { label: string; value: string; emphasis?: boolean };
type UiState = "open" | "peek" | "hidden";

type Props = {
  tier: Tier;
  /** False while the result has not arrived yet (the pack waits, dim). Default true. */
  ready?: boolean;
  imageUrl?: string;
  backImageUrl?: string;
  /** Picture of the foil pack (transparent background, seal bands at the top and bottom). Default "/lab/pack-foil.webp". */
  packImageUrl?: string;
  /** Facts about the card (year, series, grade, rarity ...), shown one by one while the card waits face down. Strings are shown as given. */
  facts?: Fact[];
  title: string;
  demo: boolean;
  onClose: () => void;
  /** Display strings for the sell-back choice, exactly as given (nothing is computed here). No sell-back button without it. */
  buyback?: { amountLabel: string; rateLabel?: string; windowLabel?: string };
  onKeep?: () => void;
  /** While the returned promise is pending the sell button is disabled and shows "processing". */
  onSell?: () => void | Promise<void>;
  /** The parent's result of the choice. Default "none". */
  outcome?: "none" | "kept" | "sold";
  /** Called by "Again" so the parent can reset its outcome. */
  onAgain?: () => void;
};

/* ------------------------------------------------------------------ tuning values ------------------------------------------------------------------ */

// Colour ladder (like a pachinko panel): blue < green < red < gold < rainbow. One "stage" colours the light of the room at once.
const STAGE_NAMES = ["blue", "green", "red", "gold", "rainbow"] as const;
const STAGE_COLORS: [number, number, number][] = [
  [70, 140, 255], // blue
  [70, 220, 130], // green
  [255, 70, 70], // red
  [255, 205, 90], // gold
  [255, 255, 255], // rainbow: replaced by a smoothly drifting hue (see stageRGB)
];
// How far each tier climbs. `to` is the one change while waiting (1.0-1.4 s after arming); `taps` is the stage after tap 1, 2 and 3.
const STAGE_PLAN: { to?: number; taps: [number, number, number] }[] = [
  { taps: [0, 0, 0] }, // tier 0: blue all the way
  { taps: [0, 1, 1] }, // tier 1: blue, blue, green, green
  { to: 1, taps: [1, 2, 2] }, // tier 2: blue -> green while waiting, then green, red, red
  { to: 1, taps: [2, 3, 4] }, // tier 3: blue -> green, then red (skipping green), gold, rainbow
];
const WAIT_CHANGE_MS: [number, number] = [450, 800]; // within the build-up before the first strike
const RAINBOW_SPEED = 8; // ms per degree of hue

// The room is fixed to the world: where things are on screen follows the phone's direction (rotation only).
// maxDeg 0 = room anchoring off. Tried on an iPhone at 40 (2026-10-07): the overlay swims against the camera image
// (gyro reacts before the delayed camera frame, and the assumed field of view does not match the cropped video), which felt bad.
const ROOM_TRACK = { fovDeg: 60, maxDeg: 0, follow: 12, followReduced: 5 }; // vertical field of view, clamp, smoothing (1/s)
// How bright the camera image is, per stage (the pack's light looks stronger as the room darkens), and in other moments.
const ROOM_BRIGHT = { waiting: 0.85, stage: [0.85, 0.72, 0.6, 0.5, 0.5], finale: 0.5, sold: 0.85, rate: 6, reduced: 0.4 };
const LIGHTSOUT = { level: 0.12, downSec: 0.15, holdSec: 0.4 }; // tier 2 and 3, before the third strike ("the lights go out")
const BLACKOUT_MS = 450; // tier 3: the room goes fully black after the third strike
const BURST_MS = 320; // tier 3: a rainbow ring spreads through the room from the pack, into the white-out
const STRIKE_FLASH = { peak: 1.5, sec: 0.1 }; // the room's brightness jumps to this when lightning lands
// Light the pack throws on the room (soft-light): radius (fraction of the screen height) and strength, per stage.
const ROOM_LIGHT = [
  { r: 0.9, a: 0.35 },
  { r: 1.1, a: 0.45 },
  { r: 1.35, a: 0.6 },
  { r: 1.6, a: 0.7 },
  { r: 1.8, a: 0.8 },
];
const LIGHT_PASSES = 2; // soft-light is subtle; the same glow is drawn this many times
const LIGHTSOUT_PULSE = 1.6; // the pack's light swells by this while the lights are out

const AURA = [0.25, 0.35, 0.5, 0.6, 0.7]; // glow behind the pack (DOM), per stage
// The card comes up out of the open pack (behind the pack's front face), then the pack drops away.
const RISE = { sec: 1.0, startScale: 0.92, packOutAt: 0.75, packOutSec: 0.5, leak: 0.35 }; // seconds; packOutAt is the share of the rise after which the pack drops; leak = strength of the light from the mouth
const CARD_LIGHT = 0.2; // the card's faint colour on the room once it is up (0 = off)
const CONFETTI_ON = false; // one small burst of confetti the moment the face turns up; false cuts it completely
const CONFETTI = [0, 16, 36, 60]; // particles per tier (tier 0 none; 60 at most)
const CONFETTI_DEPTH = { size: [3, 5, 8], gravity: [380, 520, 760] }; // three depths: bigger and nearer falls faster
const MAX_PARTICLES = 300;
const FOIL_BY_TIER: (0 | 1 | 2 | 3)[] = [0, 0, 0, 0];

// The pack builds up by itself, three strikes fall to the bottom of the screen, and after the last one the pack vanishes.
const ARMED_MS = 1000; // build-up before the first strike (the glow and the discharge strengthen)
const MOUTH_BOLT = 4.5; // thickness of the discharge that bursts up out of the pack with every strike
const MOUTH_AIM = { x: [0.2, 0.8], y: [0.15, 0.45] }; // where it goes: scattered points in the upper part of the screen (shares of the screen)
const PACK_VANISH = { ms: 180, flash: 2.2, swell: 1.06 }; // the pack flashes white, swells a little and is gone this fast after the last bolt of the big strike
// Lightning that follows the build-up by itself. Aim: x and y as shares of the screen; the middle of the screen is for the plush toy.
const AUTO = { gap1Ms: 950, gap2Ms: 1050, x: [0.3, 0.7], xRange: [[0.24, 0.36], [0.64, 0.76]], x3: 0.5, x3Range: [0.46, 0.54], jitter: 0.04 }; // bolts fall to the bottom of the screen: first left, second right, then one thick one in the middle
// The room's backdrop (blur and dark) while the card is up, then it clears so the room shows.
const BACKDROP_HOLD = 0.8; // seconds after the finishing lightning has ended
const BACKDROP_FADE = 2.2; // seconds to go back to the plain camera image
// Facts, one at a time in huge type in the middle of the screen over a dark navy veil (up to FACTS_MAX of them), then the card turns over.
// The keyframes of .packRevealBigFact in globals.css assume fadeIn 0.25 + hold 0.75 + fadeOut 0.2 = 1.2 s.
const FACTS_MAX = 3;
const FACTS = { veilIn: 0.35, fadeIn: 0.25, hold: 0.75, fadeOut: 0.2, veilOut: 0.3, veilOpacity: 0.86 };
const UI_MS = 280; // how long the bottom sheet takes to open and close

const STRIKES = [
  // dur s, bolt width, branches, sparks, ring radius (fraction of width), stage shake px
  { dur: 0.3, width: 6.5, branches: 0, sparks: 18, ring: 0.22, shake: 3 },
  { dur: 0.38, width: 10.5, branches: 3, sparks: 30, ring: 0.3, shake: 6 },
  { dur: 0.42, width: 22, branches: 7, sparks: 40, ring: 0.4, shake: 9 },
];
const TRIPLE_GAP_MS = 140; // the third strike lands as three bolts in a row
const HIT_STOP_MS = [90, 140]; // strike 1, strike 2 // everything freezes for this long when a strike lands
const ZOOM = { sec: 0.28, peak: [0.07, 0.12] }; // the camera image and the world punch in and back
const WHITE = { in: 0.12, hold: 0.35, out: 0.7 }; // seconds; the single full-screen flash
const WHITE_REDUCED = { peak: 0.6, in: 0.3, hold: 0.15, out: 0.6 };
const FLASH_MAX = { count: 3, windowMs: 1000 }; // never more than this many flashes (white, room-brightness jumps, lights-out) per window
const FLIP_SHOW = 0.35; // seconds the back is shown before turning
const FLIP_CHARGE = [0, 0, 0.3, 0.5]; // extra wait (the glow pulses) per tier
const FLIP_DUR = 0.9; // time for the half turn to settle
const BURST_AT = 0.45; // seconds after the turn starts, when the face is up
const OV = 64; // the effect layers (and the camera image) reach this many px beyond every screen edge, so shaking and punching in never uncover an edge
const BOLT_END_PAST = 40; // the main bolts end this far below the bottom edge of the screen
// The third and biggest strike: one bolt through the middle of the screen the moment the card has turned face up (it passes in front
// of the card, as if the card were struck). Width is the second strike's times widthScale.
// Two short cracks in a row ("bachin, bachin") instead of one long bolt: count bolts, gapMs apart, each durSec long, the second offset sideways.
// The cracks land on opposite sides and start from the opposite top corner, so they cross the whole screen; no small landing glow at the
// bottom edge (it read as a weak "pachin"). Instead the whole screen flashes once per crack.
const FINALE_STRIKE = { widthScale: 1.35, branches: 9, xSide: [0.16, 0.3], durSec: 0.22, count: 2, gapMs: 170, sparks: 50, ring: 0.46, shake: 9, holdStopMs: 140, flashPeak: 0.72, flashSec: 0.26, flashPeakReduced: 0.3 };
// The card itself crackles like the charged pack: short arcs leave its edges from the moment it starts to turn, thickest while the finishing
// cracks land, then dying away. afterArcs: short arcs left hanging along a finishing crack when it goes out.
const CARD_CRACKLE = { beforeMs: [110, 55], duringMs: 30, afterMs: 900, afterEveryMs: [60, 260], len: [28, 90], lenDuring: [60, 170], max: 9, afterArcs: 7 };
const CRACKLE_MS: [number, number] = [150, 500];
const CRACKLE_LEN: [number, number] = [40, 110];
const SHAKE_DECAY = 9;
const SOLD_MS = 900; // the card dissolves into light after a sell-back
const SOLD_PARTICLES_PER_SEC = 200;
// The pack is held low in front of the camera: about 80% of the screen width, its top edge 79% of the way down, the rest below the screen.
// The upper 70% of the screen stays free for the room. Keep widthVw/maxPx in sync with --pkw in globals.css (topRatio is passed to the CSS as --pack-top).
const PACK = { widthVw: 80, maxPx: 420, aspect: 0.564, topRatio: 0.79, float: 2 }; // aspect of /lab/pack-foil.webp (730 x 1294)
const SHOW_ARROW = false; // an arrow to the pack when it leaves the screen (only useful when the room tracking is on)

/* -------------------------------------------------------------------------------------------------------------------------------------------------- */

const clamp01 = (v: number) => Math.max(0, Math.min(1, v));
const easeOut = (v: number) => 1 - Math.pow(1 - clamp01(v), 3);
const D2R = Math.PI / 180;

function hslToRgb(h: number, s: number, l: number): [number, number, number] {
  const k = (n: number) => (n + h / 30) % 12;
  const a = s * Math.min(l, 1 - l);
  const f = (n: number) => l - a * Math.max(-1, Math.min(k(n) - 3, Math.min(9 - k(n), 1)));
  return [f(0) * 255, f(8) * 255, f(4) * 255];
}

/** Colour of a stage. Rainbow drifts smoothly through the hues (never blinks between them). */
function stageRGB(stage: number, now: number): [number, number, number] {
  return stage === 4 ? hslToRgb((now / RAINBOW_SPEED) % 360, 1, 0.62) : STAGE_COLORS[stage];
}
/** A lighter version of a colour (towards white), for the bright middle layer of a bolt. */
const brighten = (c: [number, number, number]): [number, number, number] => [c[0] + (255 - c[0]) * 0.55, c[1] + (255 - c[1]) * 0.55, c[2] + (255 - c[2]) * 0.55];
const css = (c: [number, number, number], a = 1) => `rgba(${c[0].toFixed(0)},${c[1].toFixed(0)},${c[2].toFixed(0)},${a})`;

type Cfg = (typeof STRIKES)[number];
// All positions below are WORLD coordinates (the room), not screen coordinates; the loop adds the world offset (dx, dy) when drawing.
type Strike = { x: number; y: number; t0: number; cfg: Cfg; power: number; aim: Pt; fin: boolean; hueOff: number; iy: number; first: boolean; last: boolean; bottom: boolean; main: BoltShape | null; pack: BoltShape | null; nextShape: number; started: boolean; alpha: number };
type Impact = { x: number; y: number; t0: number; cfg: Cfg; power: number; c: [number, number, number]; bottom?: boolean };
type Crackle = { t0: number; shape: BoltShape; next: number; dur: number };
type Particle = { x: number; y: number; vx: number; vy: number; life: number; max: number; size: number; c: [number, number, number]; g: number; rect?: boolean; rot?: number; vr?: number };

/** When each of the (up to FACTS_MAX) facts shows in the middle of the screen, and how long the facts stage lasts (veil in, texts, veil out). */
function factTimes(facts: Fact[] | undefined): { times: number[]; textEnd: number; total: number } {
  const n = Math.min(FACTS_MAX, facts?.length ?? 0);
  if (n === 0) return { times: [], textEnd: 0, total: 0 };
  const per = FACTS.fadeIn + FACTS.hold + FACTS.fadeOut;
  const times = Array.from({ length: n }, (_, i) => FACTS.veilIn + i * per);
  const textEnd = FACTS.veilIn + n * per;
  return { times, textEnd, total: textEnd + FACTS.veilOut };
}

/**
 * The opening experiment, played in the room: the pack floats in front of the camera, fixed to the room (it stays put when the
 * phone turns). Three taps call lightning down on the tapped spot (aim it at a plush toy) and the burn marks stay there. A colour
 * ladder (blue, green, red, gold, rainbow) climbs with the taps as far as the tier allows, and the room reacts: it darkens, the
 * pack's light colours it, each strike lights it for an instant, the lights go out before the third strike (tier 2 and 3), and the
 * card's light fills the room at the end. Canvas 2D and CSS only. The FX canvas sits above the pack so a bolt that lands on it stays visible.
 */
export function PackReveal({ tier, ready = true, imageUrl, backImageUrl, packImageUrl = "/lab/pack-foil.webp", facts, title, demo, onClose, buyback, onKeep, onSell, outcome = "none", onAgain }: Props) {
  const { t } = useI18n();
  const rootRef = useRef<HTMLDivElement>(null);
  const camRef = useRef<HTMLDivElement>(null);
  const worldRef = useRef<HTMLDivElement>(null);
  const videoRef = useRef<HTMLVideoElement>(null);
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const lightRef = useRef<HTMLCanvasElement>(null);
  const whiteRef = useRef<HTMLDivElement>(null);
  const arrowRef = useRef<HTMLDivElement>(null);
  const factsRef = useRef<Fact[] | undefined>(facts);
  const [ui, setUi] = useState<UiState>("peek");
  const [packOk, setPackOk] = useState(true);
  const cardRef = useRef<HoloCardHandle>(null);
  const phaseRef = useRef<Phase>("waiting");
  const phaseStartRef = useRef(0);
  // Warm the browser cache while the pack is still closed, so the card does not come out blank.
  useEffect(() => {
    for (const url of [imageUrl, backImageUrl]) {
      if (url && url.startsWith("https://")) new Image().src = url;
    }
  }, [imageUrl, backImageUrl]);
  useEffect(() => {
    const img = new Image();
    img.onerror = () => setPackOk(false);
    img.src = packImageUrl;
  }, [packImageUrl]);
  const clockRef = useRef(0); // the loop's virtual clock (it stops during hit-stop)
  const readyRef = useRef(ready);
  const outcomeRef = useRef(outcome);
  const [selling, setSelling] = useState(false);
  const tilt = useDeviceTilt();
  const camera = useCameraStream(videoRef);
  const [phase, setPhase] = useState<Phase>("waiting");
  const [run, setRun] = useState(0);

  useEffect(() => {
    readyRef.current = ready;
    outcomeRef.current = outcome;
    factsRef.current = facts;
  }, [ready, outcome, facts]);

  const go = useCallback((next: Phase) => {
    phaseRef.current = next;
    phaseStartRef.current = clockRef.current;
    if (next === "done" || next === "sold") setUi("peek");
    setPhase(next);
  }, []);

  const handleClose = useCallback(() => {
    camera.stop();
    onClose();
  }, [camera, onClose]);

  const restart = useCallback(() => {
    setUi("peek");
    onAgain?.();
    setRun((r) => r + 1);
  }, [onAgain]);

  const sell = async () => {
    setSelling(true);
    try {
      await onSell?.();
    } finally {
      setSelling(false);
    }
  };

  useEffect(() => {
    const root = rootRef.current;
    const cam = camRef.current;
    const world = worldRef.current;
    const video = videoRef.current;
    const canvas = canvasRef.current;
    const lightCanvas = lightRef.current;
    const white = whiteRef.current;
    const arrow = arrowRef.current;
    if (!root || !cam || !world || !video || !canvas || !lightCanvas || !white || !arrow) return;
    const ctx = canvas.getContext("2d");
    const lctx = lightCanvas.getContext("2d");
    if (!ctx || !lctx) return;
    const motion = window.matchMedia("(prefers-reduced-motion: reduce)");
    let reduced = motion.matches;
    const onMotion = () => {
      reduced = motion.matches;
    };
    motion.addEventListener("change", onMotion);
    const timers: number[] = [];
    const tracker = new OrientationTracker();
    tracker.start();

    let raf = 0;
    let lastReal = performance.now();
    let frozenTotal = 0; // total hit-stop time, removed from the virtual clock
    let frozenUntil = 0;
    let started = false;
    let count = 0;
    let vanishT = -1; // when the pack started to vanish (after the big strike)
    let usedFacts = false;
    let nextStrikeAt = -1;
    let whiteAt = 0;
    let whiteStart = 0;
    let flipCalled = false;
    let cardChargeT = -1; // when the card began to turn (its edges start to crackle)
    let nextCardCrackle = 0;
    let shake = 0;
    let zoomT = -1;
    let zoomPeak = 0;
    const flashLog: number[] = [];
    let stage = 0;
    let armedAt = -1;
    let waitChangeAt = -1;
    let waitChanged = false;
    let popT = -1;
    let flareT = -1; // the pack's light flares when the stage steps up
    let impactT = -1; // last strike landing
    let spikeT = -1; // the room's brightness jump
    let finFlashT = -1; // the whole-screen flash of a finishing crack
    let beatPlan: { lightsout?: [number, number]; black?: [number, number]; burst?: [number, number] } | null = null;
    let beat = "";
    let nextCrackle = 0;
    let soldStart = 0;
    let soldAcc = 0;
    let faceUpT = -1;
    let finaleRange: [number, number] | null = null;
    let confettiLeft: number[] = [];
    let room = ROOM_BRIGHT.waiting; // smoothed brightness of the camera image
    let blurK = 0; // 0..1, eased in once the card has appeared
    // world offset: the phone's direction relative to where it pointed when the pack armed
    let refYaw = 0;
    let refPitch = 0;
    let refSet = false;
    let dx = 0;
    let dy = 0;
    let lastDxAttr = Number.NaN;
    let lastDyAttr = Number.NaN;
    const strikes: Strike[] = [];
    const impacts: Impact[] = [];
    const crackles: Crackle[] = [];
    let parts: Particle[] = [];
    const plan = STAGE_PLAN[tier];
    const seeded = (() => {
      let a = 12345;
      return () => {
        a = (a + 0x6d2b79f5) | 0;
        let x = Math.imul(a ^ (a >>> 15), 1 | a);
        x = (x + Math.imul(x ^ (x >>> 7), 61 | x)) ^ x;
        return ((x ^ (x >>> 14)) >>> 0) / 4294967296;
      };
    })();

    const push = (p: Particle) => {
      if (parts.length < MAX_PARTICLES) parts.push(p);
    };

    const frame = (real: number) => {
      raf = requestAnimationFrame(frame);
      // hit-stop: nothing updates (canvas, CSS animations) until it ends
      if (real < frozenUntil) {
        root.setAttribute("data-hitstop", "1");
        lastReal = real;
        return;
      }
      root.removeAttribute("data-hitstop");
      const dt = Math.min(0.05, (real - lastReal) / 1000);
      lastReal = real;
      const now = real - frozenTotal;
      clockRef.current = now;
      const freeze = (ms: number) => {
        if (reduced) return;
        frozenUntil = real + ms;
        frozenTotal += ms;
      };
      const dpr = Math.min(2, window.devicePixelRatio || 1);
      const W = canvas.clientWidth - 2 * OV; // the canvases are OV px larger than the screen on every side; W, H are the screen
      const H = canvas.clientHeight - 2 * OV;
      if (W <= 0 || H <= 0) return;
      for (const c of [canvas, lightCanvas]) {
        if (c.width !== Math.round((W + 2 * OV) * dpr) || c.height !== Math.round((H + 2 * OV) * dpr)) {
          c.width = Math.round((W + 2 * OV) * dpr);
          c.height = Math.round((H + 2 * OV) * dpr);
        }
      }
      const rand: Rand = reduced ? seeded : Math.random;

      if (!started) {
        started = true;
        root.setAttribute("data-stage", STAGE_NAMES[stage]);
        go(readyRef.current ? "armed" : "waiting");
      }
      let ph = phaseRef.current;
      const pt = (now - phaseStartRef.current) / 1000;
      if (ph === "waiting" && readyRef.current) {
        go("armed");
        ph = "armed";
      }
      if (ph === "armed" && armedAt < 0) {
        armedAt = now;
        nextStrikeAt = now + ARMED_MS;
        if (plan.to !== undefined) waitChangeAt = WAIT_CHANGE_MS[0] + rand() * (WAIT_CHANGE_MS[1] - WAIT_CHANGE_MS[0]);
      }

      // ---- the room is fixed to the world: offset of the world on screen from the phone's direction ----
      tracker.update(dt, now, reduced);
      let tx = 0;
      let ty = 0;
      if (tracker.active) {
        const q = tracker.quaternion;
        // forward direction of the camera (-Z rotated by the quaternion)
        const fx = -2 * (q.x * q.z + q.w * q.y);
        const fy = -2 * (q.y * q.z - q.w * q.x);
        const fz = -(1 - 2 * (q.x * q.x + q.y * q.y));
        const yaw = Math.atan2(fx, -fz);
        const pitch = Math.asin(Math.max(-1, Math.min(1, fy)));
        if (!refSet && ph !== "waiting") {
          refSet = true;
          refYaw = yaw;
          refPitch = pitch;
        }
        if (refSet) {
          let dyaw = yaw - refYaw;
          while (dyaw > Math.PI) dyaw -= 2 * Math.PI;
          while (dyaw < -Math.PI) dyaw += 2 * Math.PI;
          const lim = ROOM_TRACK.maxDeg * D2R;
          const f = H / 2 / Math.tan((ROOM_TRACK.fovDeg / 2) * D2R);
          tx = -f * Math.tan(Math.max(-lim, Math.min(lim, dyaw)));
          ty = f * Math.tan(Math.max(-lim, Math.min(lim, pitch - refPitch)));
        }
      }
      const fk = 1 - Math.exp(-dt * (reduced ? ROOM_TRACK.followReduced : ROOM_TRACK.follow));
      dx += (tx - dx) * fk;
      dy += (ty - dy) * fk;
      world.style.transform = `translate3d(${dx.toFixed(1)}px, ${dy.toFixed(1)}px, 0)`;
      const idx = Math.round(dx);
      const idy = Math.round(dy);
      if (idx !== lastDxAttr) {
        lastDxAttr = idx;
        world.setAttribute("data-dx", String(idx));
      }
      if (idy !== lastDyAttr) {
        lastDyAttr = idy;
        world.setAttribute("data-dy", String(idy));
      }

      const tc = stageRGB(stage, now);

      // geometry of the pack (world coordinates)
      const pw = Math.min((W * PACK.widthVw) / 100, PACK.maxPx);
      const ph2 = pw / PACK.aspect;
      const cx = W / 2; // the card
      const cy = H * 0.42;
      const pkx = W / 2; // the pack's top edge, the source of its light and discharge
      const pky = H * PACK.topRatio + 6;
      const cw = Math.min(W * 0.62, 320);
      const ch = (cw * 1136) / 677;

      /** Flashes of any kind are rationed. */
      const canFlash = () => {
        while (flashLog.length && now - flashLog[0] > FLASH_MAX.windowMs) flashLog.shift();
        return flashLog.length < FLASH_MAX.count;
      };
      /** Move the colour ladder: the room's light changes colour at once, and the pack's light flares. */
      const setStage = (next: number, at: Pt, quiet = false) => {
        if (next === stage) return;
        stage = next;
        root.setAttribute("data-stage", STAGE_NAMES[stage]);
        flareT = now;
        if (!quiet) impacts.push({ x: at[0], y: at[1], t0: now, cfg: STRIKES[1], power: 2, c: stageRGB(stage, now) });
      };

      // stage change while waiting (tier 2 and 3): the pack pops
      if (ph === "armed" && count === 0 && plan.to !== undefined && !waitChanged && now - armedAt >= waitChangeAt) {
        waitChanged = true;
        popT = now;
        setStage(plan.to, [pkx, pky]);
      }

      // ---- automatic lightning: two strikes before the card is turned (the third, the biggest, comes when it turns face up) ----
      if (nextStrikeAt > 0 && now >= nextStrikeAt && count < 2 && (ph === "armed" || ph === "struck1" || ph === "struck2")) {
        count++;
        const jit = (r: number) => (reduced ? 0 : (rand() - 0.5) * 2 * r);
        const aimX = () => {
          if (count === 2) return Math.max(AUTO.x3Range[0], Math.min(AUTO.x3Range[1], AUTO.x3 + jit(AUTO.jitter))) * W;
          const [lo, hi] = AUTO.xRange[count - 1];
          return Math.max(lo, Math.min(hi, AUTO.x[count - 1] + jit(AUTO.jitter))) * W;
        };
        const cfg = count === 1 ? STRIKES[0] : STRIKES[2]; // the second strike has the strength the third used to have
        let base = now;
        if (count === 2) {
          nextStrikeAt = -1;
          // tier 2 and 3: the lights go out first; then the pack vanishes; tier 3: a blackout and the rainbow ring follow
          const outMs = tier >= 2 ? (LIGHTSOUT.downSec + LIGHTSOUT.holdSec) * 1000 : 0;
          base = now + outMs;
          beatPlan = {};
          if (outMs > 0) {
            beatPlan.lightsout = [now, base];
            flashLog.push(now);
            flareT = now;
          }
          if (tier === 3) {
            const bs = base + PACK_VANISH.ms; // after the pack has vanished
            beatPlan.black = [bs, bs + BLACKOUT_MS];
            beatPlan.burst = [bs + BLACKOUT_MS, bs + BLACKOUT_MS + BURST_MS];
            whiteAt = bs + BLACKOUT_MS + BURST_MS;
          } else {
            whiteAt = base + PACK_VANISH.ms; // right after the pack has vanished
          }
        } else {
          nextStrikeAt = now + AUTO.gap1Ms;
        }
        {
          const k = 0;
          const n = 1;
          strikes.push({ x: aimX() - dx, y: H + BOLT_END_PAST - dy, iy: H - dy, fin: false, hueOff: 0, t0: base + k * TRIPLE_GAP_MS, cfg, power: count, aim: [(MOUTH_AIM.x[0] + rand() * (MOUTH_AIM.x[1] - MOUTH_AIM.x[0])) * W - dx, (MOUTH_AIM.y[0] + rand() * (MOUTH_AIM.y[1] - MOUTH_AIM.y[0])) * H - dy], first: k === 0, last: k === n - 1, bottom: true, main: null, pack: null, nextShape: 0, started: false, alpha: 1 });
        }
      }

      // ---- beats: lights out, blackout, rainbow burst (shown through data-beat) ----
      let nextBeat = "";
      if (beatPlan) {
        if (beatPlan.lightsout && now >= beatPlan.lightsout[0] && now < beatPlan.lightsout[1]) nextBeat = "lightsout";
        else if (beatPlan.black && now >= beatPlan.black[0] && now < beatPlan.black[1]) nextBeat = "blackout";
        else if (beatPlan.burst && now >= beatPlan.burst[0] && now < beatPlan.burst[1]) nextBeat = "burst";
      }
      if (!nextBeat && finaleRange && now >= finaleRange[0] && now < finaleRange[1]) nextBeat = "finale";
      if (nextBeat !== beat) {
        if (nextBeat === "blackout") flashLog.push(now);
        beat = nextBeat;
        if (beat) root.setAttribute("data-beat", beat);
        else root.removeAttribute("data-beat");
      }

      // ---- strikes: landing, bolts ----
      ctx.setTransform(1, 0, 0, 1, 0, 0);
      ctx.clearRect(0, 0, canvas.width, canvas.height);
      ctx.setTransform(dpr, 0, 0, dpr, (OV + dx) * dpr, (OV + dy) * dpr); // from here on: world coordinates (screen origin = OV px in)
      for (let i = strikes.length - 1; i >= 0; i--) {
        const s = strikes[i];
        if (now < s.t0) continue;
        const e = (now - s.t0) / 1000;
        if (e > s.cfg.dur) {
          if (s.fin && s.main && !reduced) {
            // the crack goes out, but short arcs keep twitching along its path for a moment
            const path = s.main.main;
            for (let k = 0; k < CARD_CRACKLE.afterArcs && path.length > 2; k++) {
              const p0 = path[1 + Math.floor(rand() * (path.length - 2))];
              const th = rand() * Math.PI * 2;
              const len = 30 + rand() * 70;
              crackles.push({ t0: now + k * 28, shape: makeBolt(rand, [p0[0], p0[1]], [p0[0] + Math.cos(th) * len, p0[1] + Math.sin(th) * len], 1), next: 0.06, dur: 0.12 + rand() * 0.1 });
            }
          }
          strikes.splice(i, 1);
          continue;
        }
        if (!s.started) {
          s.started = true;
          impactT = now;
          const sc0 = stageRGB(stage, now);
          if (s.fin) finFlashT = now;
          else impacts.push({ x: s.x, y: s.iy, t0: now, cfg: s.cfg, power: s.power, c: sc0, bottom: true });
          if (!reduced) shake = Math.max(shake, s.cfg.shake);
          if (!reduced && canFlash()) {
            flashLog.push(now);
            spikeT = now; // the room lights up for an instant
          }
          if (s.last && !s.fin && s.power === 2 && vanishT < 0) vanishT = now;
          if (s.fin) {
            if (s.first) {
              freeze(FINALE_STRIKE.holdStopMs);
              if (!reduced) {
                zoomT = now;
                zoomPeak = ZOOM.peak[1];
              }
            }
          } else if (s.first) {
            // the landing: hit-stop, then the camera and the world punch in; the colour ladder steps
            freeze(HIT_STOP_MS[s.power - 1]);
            if (s.power === 1) {
              go("struck1");
              ph = "struck1";
            } else if (s.power === 2) {
              go("struck2");
              ph = "struck2";
            }
            if (!reduced) {
              zoomT = now;
              zoomPeak = ZOOM.peak[s.power - 1];
            }
            setStage(plan.taps[s.power - 1], [s.x, s.y]);
          }
          // no landing sparks for a finishing crack (same reason as the landing glow)
          for (let k = 0; k < (s.fin ? 0 : s.cfg.sparks); k++) {
            const a = rand() * Math.PI * 2;
            const sp = 80 + rand() * 320;
            push({ x: s.x, y: s.y, vx: Math.cos(a) * sp, vy: Math.sin(a) * sp - 80, life: 0, max: 0.4 + rand() * 0.4, size: 1.5 + rand() * 2, c: k % 3 ? sc0 : [255, 255, 255], g: 380 });
          }
        }
        if (s.main === null || (!reduced && e >= s.nextShape)) {
          s.nextShape = e + (s.fin ? 0.045 : 0.08); // a finishing crack re-forms faster, so it writhes
          // the bolt comes from above the top of the screen (in world terms: above the visible top edge)
          const x0 = s.fin ? W - (s.x + dx) - dx + (rand() - 0.5) * W * 0.08 : Math.max(-dx, Math.min(W - dx, s.x + (rand() - 0.5) * W * 0.25));
          s.main = makeBolt(rand, [x0, -dy - OV - 30], [s.x, s.y], s.cfg.branches);
          s.pack = s.fin ? null : makeBolt(rand, [pkx, pky + 4], s.aim, 2);
          s.alpha = reduced ? 0.8 : rand() < 0.3 ? 0.6 : 1;
        }
        const fade = reduced ? 1 - e / s.cfg.dur : e > s.cfg.dur * 0.8 ? 1 - (e - s.cfg.dur * 0.8) / (s.cfg.dur * 0.2) : 1;
        const sc1 = stage === 4 && s.fin ? hslToRgb(((now / RAINBOW_SPEED) + s.hueOff) % 360, 1, 0.62) : tc;
        const tcs = css(sc1, 1);
        const tbr = css(brighten(sc1), 1);
        drawBoltShape(ctx, s.main, s.cfg.width, tcs, s.alpha * fade, tbr);
        // a thick discharge bursts up out of the pack with every strike (not once the pack is gone)
        if (s.pack && (vanishT < 0 || now - vanishT < PACK_VANISH.ms)) drawBoltShape(ctx, s.pack, MOUTH_BOLT, tcs, s.alpha * fade, tbr);
      }

      // impacts: radial flash and expanding ring
      ctx.save();
      ctx.globalCompositeOperation = "lighter";
      for (let i = impacts.length - 1; i >= 0; i--) {
        const im = impacts[i];
        const e = (now - im.t0) / 1000;
        if (e > 0.5) {
          impacts.splice(i, 1);
          continue;
        }
        const R = 50 + im.power * 28;
        const fa = Math.exp(-e / 0.12);
        const g = ctx.createRadialGradient(im.x, im.y, 0, im.x, im.y, R);
        g.addColorStop(0, `rgba(255,255,255,${0.95 * fa})`);
        g.addColorStop(0.4, css(im.c, 0.5 * fa));
        g.addColorStop(1, css(im.c, 0));
        ctx.fillStyle = g;
        ctx.fillRect(im.x - R, im.y - R, R * 2, R * 2);
        if (im.bottom) {
          // landing at the bottom edge: the light spreads sideways along the edge and stretches upward
          ctx.save();
          ctx.translate(im.x, im.y);
          ctx.scale(4, 1);
          const wg = ctx.createRadialGradient(0, 0, 0, 0, 0, R * 1.5);
          wg.addColorStop(0, `rgba(255,255,255,${0.85 * fa})`);
          wg.addColorStop(0.45, css(im.c, 0.5 * fa));
          wg.addColorStop(1, css(im.c, 0));
          ctx.fillStyle = wg;
          ctx.fillRect(-R * 1.5, -R * 1.5, R * 3, R * 3);
          ctx.restore();
          // a tall soft glow rising from the bottom edge (no hard edge anywhere)
          ctx.save();
          ctx.translate(im.x, im.y);
          ctx.scale(1, 3);
          const ug = ctx.createRadialGradient(0, 0, 0, 0, 0, R * 1.1);
          ug.addColorStop(0, css(im.c, 0.5 * fa));
          ug.addColorStop(1, css(im.c, 0));
          ctx.fillStyle = ug;
          ctx.fillRect(-R * 1.1, -R * 1.1, R * 2.2, R * 2.2);
          ctx.restore();
        }
        if (!reduced) {
          const rk = clamp01(e / 0.45);
          ctx.beginPath();
          ctx.arc(im.x, im.y, easeOut(rk) * W * im.cfg.ring, 0, Math.PI * 2);
          ctx.strokeStyle = css(im.c, (1 - rk) * 0.8);
          ctx.lineWidth = 2 + (1 - rk) * 3;
          ctx.stroke();
        }
      }
      ctx.restore();

      // ---- the pack crackles (armed and struck) ----
      const charging = ph === "armed" || ph === "struck1" || ph === "struck2";
      if (charging) {
        if (now >= nextCrackle && crackles.length < 3) {
          nextCrackle = now + ((CRACKLE_MS[0] + rand() * (CRACKLE_MS[1] - CRACKLE_MS[0])) / (1 + 0.5 * count + stage * 0.2)) * (reduced ? 2 : 1);
          // discharge leaves the top edge of the pack and goes up, into the room
          const th = -Math.PI / 2 + (rand() - 0.5) * 1.1;
          const from: Pt = [pkx + (rand() - 0.5) * pw * 0.9, pky + rand() * 8];
          const len = (CRACKLE_LEN[0] + rand() * (CRACKLE_LEN[1] - CRACKLE_LEN[0])) * (1 + 0.3 * count);
          crackles.push({ t0: now, shape: makeBolt(rand, from, [from[0] + Math.cos(th) * len, from[1] + Math.sin(th) * len], count > 0 ? 1 : 0), next: 0.06, dur: 0.14 });
        }
      }
      // ---- the card crackles (from the turn, through the finishing cracks, fading out after them) ----
      if (cardChargeT > 0 && ph !== "sold" && !reduced) {
        const during = finaleRange !== null && now >= finaleRange[0] && now <= finaleRange[1];
        const after = finaleRange !== null && now > finaleRange[1] ? (now - finaleRange[1]) / CARD_CRACKLE.afterMs : 0;
        if (after < 1 && now >= nextCardCrackle && crackles.length < CARD_CRACKLE.max) {
          const lead = clamp01((now - cardChargeT) / 500);
          const every = during
            ? CARD_CRACKLE.duringMs
            : finaleRange !== null
              ? CARD_CRACKLE.afterEveryMs[0] + after * (CARD_CRACKLE.afterEveryMs[1] - CARD_CRACKLE.afterEveryMs[0])
              : CARD_CRACKLE.beforeMs[0] + lead * (CARD_CRACKLE.beforeMs[1] - CARD_CRACKLE.beforeMs[0]);
          nextCardCrackle = now + every * (0.6 + rand() * 0.8);
          // a point on the card's outline and the outward direction there
          const side = Math.floor(rand() * 4);
          const u = rand() - 0.5;
          const from: Pt = side === 0 ? [cx + u * cw, cy - ch / 2] : side === 1 ? [cx + cw / 2, cy + u * ch] : side === 2 ? [cx + u * cw, cy + ch / 2] : [cx - cw / 2, cy + u * ch];
          const out = side === 0 ? -Math.PI / 2 : side === 1 ? 0 : side === 2 ? Math.PI / 2 : Math.PI;
          const th = out + (rand() - 0.5) * 1.3;
          const lr = during ? CARD_CRACKLE.lenDuring : CARD_CRACKLE.len;
          const len = (lr[0] + rand() * (lr[1] - lr[0])) * (1 - after * 0.5);
          crackles.push({ t0: now, shape: makeBolt(rand, from, [from[0] + Math.cos(th) * len, from[1] + Math.sin(th) * len], during ? 2 : 1), next: 0.06, dur: during ? 0.16 : 0.13 });
        }
      }
      for (let i = crackles.length - 1; i >= 0; i--) {
        const c = crackles[i];
        const e = (now - c.t0) / 1000;
        if (e < 0) continue; // queued a little ahead
        if (e > c.dur) {
          crackles.splice(i, 1);
          continue;
        }
        drawBoltShape(ctx, c.shape, 1.6 + count * 0.5, css(tc, 1), reduced ? 0.6 * (1 - e / c.dur) : rand() < 0.25 ? 0.5 : 0.95, css(brighten(tc), 1));
      }

      // ---- white-out, then the card ----
      let whiteOpacity = 0;
      if (whiteAt > 0 && now >= whiteAt && whiteStart === 0) {
        whiteStart = now;
        flashLog.push(now);
        go("whiteout");
        ph = "whiteout";
      }
      if (whiteStart > 0) {
        const e = (now - whiteStart) / 1000;
        if (reduced) {
          const w2 = WHITE_REDUCED;
          whiteOpacity = e < w2.in ? (e / w2.in) * w2.peak : e < w2.in + w2.hold ? w2.peak : Math.max(0, w2.peak * (1 - (e - w2.in - w2.hold) / w2.out));
          if (e > w2.in + w2.hold && ph === "whiteout") {
            go("rise");
            ph = "rise";
          }
        } else {
          whiteOpacity = e < WHITE.in ? e / WHITE.in : e < WHITE.in + WHITE.hold ? 1 : Math.max(0, 1 - (e - WHITE.in - WHITE.hold) / WHITE.out);
          if (e > WHITE.in + WHITE.hold && ph === "whiteout") {
            go("rise");
            ph = "rise";
          }
        }
      }
      if (finFlashT > 0) {
        const fe = (now - finFlashT) / 1000;
        if (fe < FINALE_STRIKE.flashSec) whiteOpacity = Math.max(whiteOpacity, (reduced ? FINALE_STRIKE.flashPeakReduced : FINALE_STRIKE.flashPeak) * (1 - fe / FINALE_STRIKE.flashSec));
      }
      white.style.opacity = whiteOpacity.toFixed(3);

      // ---- sold: the card dissolves into light ----
      let sold = 0;
      if (ph === "done" && outcomeRef.current === "sold") {
        soldStart = now;
        go("sold");
        ph = "sold";
      }
      if (ph === "sold") {
        sold = clamp01((now - soldStart) / SOLD_MS);
        if (!reduced && sold < 0.7) {
          soldAcc += SOLD_PARTICLES_PER_SEC * dt;
          while (soldAcc >= 1) {
            soldAcc -= 1;
            const side = rand() * (2 * cw + 2 * ch);
            let px = cx - cw / 2;
            let py = cy - ch / 2;
            if (side < cw) px += side;
            else if (side < cw + ch) {
              px += cw;
              py += side - cw;
            } else if (side < 2 * cw + ch) {
              px += 2 * cw + ch - side;
              py += ch;
            } else py += 2 * cw + 2 * ch - side;
            push({ x: px, y: py, vx: (rand() - 0.5) * 24, vy: -(50 + rand() * 90), life: 0, max: 0.6 + rand() * 0.4, size: 1.5 + rand() * 1.8, c: stageRGB(stage, now + rand() * 900), g: 0 });
          }
        }
      }

      // ---- rise: the card comes up out of the open pack, then the pack drops away ----
      let riseY = 0;
      let riseS = 1;
      let riseO = 1;
      let packO = 1;
      let packSc = 1;
      let packBr = 1;
      let riseP = 1;
      if (ph === "rise") {
        riseP = clamp01(pt / RISE.sec);
        const e = easeOut(riseP);
        const startCy = H + 12 + (ch * RISE.startScale) / 2; // the card's top edge starts just below the screen
        if (reduced) {
          riseO = riseP;
        } else {
          riseY = (1 - e) * (startCy - cy);
          riseS = RISE.startScale + (1 - RISE.startScale) * e;
        }
        if (ph === "rise" && riseP >= 1) {
          const has = (factsRef.current?.length ?? 0) > 0;
          usedFacts = has;
          go(has ? "facts" : "flip");
          ph = has ? "facts" : "flip";
        }
      }
      if (ph === "facts") {
        // face down, the facts come up one by one; then the card turns
        if ((now - phaseStartRef.current) / 1000 >= factTimes(factsRef.current).total) {
          go("flip");
          ph = "flip";
        }
      }
      // the pack: it flashes white, swells a little and is gone right after the last bolt of the big strike
      if (vanishT > 0 || ph === "whiteout" || ph === "rise" || ph === "facts" || ph === "flip" || ph === "done" || ph === "sold") {
        const vk = vanishT > 0 ? clamp01((now - vanishT) / PACK_VANISH.ms) : 1;
        packO = vk >= 1 ? 0 : 1 - vk * vk;
        packSc = reduced ? 1 : 1 + (PACK_VANISH.swell - 1) * Math.sin(Math.min(1, vk * 1.4) * Math.PI * 0.5);
        packBr = reduced ? 1 : 1 + (PACK_VANISH.flash - 1) * Math.sin(Math.min(1, vk * 1.6) * Math.PI * 0.5) * (vk >= 1 ? 0 : 1);
      }

      // ---- flip: show the back (with a wait for tier 2 and 3), then turn ----
      if (ph === "flip" || ph === "done") {
        // Not `pt`: when rise ends in this same frame, pt still holds the rise time and the wait would be skipped.
        const ft = ph === "flip" ? (now - phaseStartRef.current) / 1000 : 99;
        const wait = usedFacts ? FLIP_CHARGE[tier] : FLIP_SHOW + FLIP_CHARGE[tier];
        if (ph === "flip" && ft >= wait && !flipCalled) {
          flipCalled = true;
          cardChargeT = now;
          cardRef.current?.flip(1);
        }
        if (faceUpT < 0 && ph === "flip" && ft >= wait + BURST_AT) {
          // the face is up: one small burst of confetti
          faceUpT = now;
          confettiLeft = CONFETTI_ON ? [0] : [];
          // the third, biggest strike: through the middle of the screen, in front of the card; the colour ladder takes its last step
          const fcfg = { dur: FINALE_STRIKE.durSec, width: STRIKES[2].width * FINALE_STRIKE.widthScale, branches: FINALE_STRIKE.branches, sparks: FINALE_STRIKE.sparks, ring: FINALE_STRIKE.ring, shake: FINALE_STRIKE.shake };
          const fn = reduced ? 1 : FINALE_STRIKE.count;
          const side = rand() < 0.5 ? -1 : 1;
          setStage(plan.taps[2], [W / 2, H - dy], true);
          for (let k = 0; k < fn; k++) {
            // alternate sides: one crack lands low on the left, the next low on the right
            const u = FINALE_STRIKE.xSide[0] + (reduced ? 0.5 : rand()) * (FINALE_STRIKE.xSide[1] - FINALE_STRIKE.xSide[0]);
            const kx = ((k % 2 === 0 ? side : -side) > 0 ? 1 - u : u) * W;
            strikes.push({ x: kx - dx, y: H + BOLT_END_PAST - dy, iy: H - dy, fin: true, hueOff: k * 70, t0: now + k * FINALE_STRIKE.gapMs, cfg: fcfg, power: 3, aim: [0, 0], first: k === 0, last: k === fn - 1, bottom: true, main: null, pack: null, nextShape: 0, started: false, alpha: 1 });
          }
          finaleRange = [now, now + (fn - 1) * FINALE_STRIKE.gapMs + fcfg.dur * 1000];
        }
        if (ph === "flip" && ft >= wait + FLIP_DUR) {
          go("done");
          ph = "done";
        }
        if (faceUpT > 0) {
          const fe = (now - faceUpT) / 1000;
          while (confettiLeft.length && fe >= confettiLeft[0]) {
            confettiLeft.shift();
            const n = Math.round(CONFETTI[tier] * (reduced ? 0.4 : 1));
            for (let k = 0; k < n; k++) {
              const depth = Math.floor(rand() * 3);
              const a = -Math.PI / 2 + (rand() - 0.5) * 1.8;
              const sp = 300 + rand() * 450;
              const col: [number, number, number] = stage === 4 ? hslToRgb(rand() * 360, 1, 0.65) : k % 3 === 0 ? [255, 255, 255] : stageRGB(stage, now);
              push({ x: cx + (rand() - 0.5) * cw * 0.6, y: cy - ch * 0.45, vx: Math.cos(a) * sp * 0.6, vy: Math.sin(a) * sp, life: 0, max: 1.8 + rand() * 1.2, size: CONFETTI_DEPTH.size[depth], c: col, g: CONFETTI_DEPTH.gravity[depth], rect: k % 2 === 0, rot: rand() * 6, vr: (rand() - 0.5) * 14 });
            }
          }
        }
      }

      // ---- the rainbow ring spreading through the room (tier 3, from the blackout into the white-out) ----
      if (beat === "burst" && beatPlan?.burst) {
        const bk = clamp01((now - beatPlan.burst[0]) / BURST_MS);
        const R = easeOut(bk) * Math.hypot(W, H) * 0.9;
        ctx.save();
        ctx.globalCompositeOperation = "lighter";
        ctx.lineWidth = 18 + 40 * bk;
        for (let i = 0; i < 36; i++) {
          ctx.strokeStyle = css(hslToRgb(i * 10, 1, 0.6), 0.85);
          ctx.beginPath();
          ctx.arc(pkx, pky, R, ((i * 10 - 1) * Math.PI) / 180, ((i * 10 + 10) * Math.PI) / 180);
          ctx.stroke();
        }
        ctx.restore();
      }

      // ---- particles (world) ----
      ctx.save();
      ctx.globalCompositeOperation = "lighter";
      const alive: Particle[] = [];
      for (const p of parts) {
        p.life += dt;
        if (p.life >= p.max) continue;
        p.vy += p.g * dt;
        p.x += p.vx * dt;
        p.y += p.vy * dt;
        if (p.rot !== undefined && p.vr !== undefined && !reduced) p.rot += p.vr * dt;
        const k = p.life / p.max;
        ctx.globalAlpha = p.g > 0 ? 1 - k * k : Math.sin(Math.PI * k);
        ctx.fillStyle = css(p.c, 1);
        if (p.rect) {
          ctx.save();
          ctx.translate(p.x, p.y);
          ctx.rotate(p.rot ?? 0);
          ctx.fillRect(-p.size, -p.size * 0.5, p.size * 2, p.size);
          ctx.restore();
        } else {
          ctx.beginPath();
          ctx.arc(p.x, p.y, p.size, 0, Math.PI * 2);
          ctx.fill();
        }
        alive.push(p);
      }
      parts = alive;
      ctx.restore();

      // the backdrop clears once the face has been up for a while, so the room shows around the card
      const backdropK = finaleRange && ph !== "sold" ? clamp01(((now - finaleRange[1]) / 1000 - BACKDROP_HOLD) / BACKDROP_FADE) : 0;

      // ---- the room's light (soft-light canvas over the camera image): the pack's glow, rings from strikes, the card's glow ----
      lctx.setTransform(1, 0, 0, 1, 0, 0);
      lctx.clearRect(0, 0, lightCanvas.width, lightCanvas.height);
      lctx.setTransform(dpr, 0, 0, dpr, (OV + dx) * dpr, (OV + dy) * dpr);
      const rl = ROOM_LIGHT[stage];
      const flare = flareT > 0 && !reduced ? 1 + 0.9 * Math.exp(-(now - flareT) / 300) : 1;
      const packLit = charging || ph === "waiting" || (ph === "whiteout" && whiteStart > 0 && (now - whiteStart) / 1000 < WHITE.in);
      if (packLit) {
        const outSwell = beat === "lightsout" ? LIGHTSOUT_PULSE : 1;
        const pulse = reduced ? 1 : 0.85 + 0.15 * Math.sin(now / (320 / (1 + 0.5 * count)));
        const a = (ph === "waiting" ? 0.12 : rl.a) * pulse * flare * outSwell;
        const R = rl.r * H * 0.5 * (beat === "lightsout" ? LIGHTSOUT_PULSE * 0.8 : 1);
        for (let i = 0; i < LIGHT_PASSES; i++) {
          const g = lctx.createRadialGradient(pkx, pky, 0, pkx, pky, R);
          g.addColorStop(0, css(tc, Math.min(1, a)));
          g.addColorStop(0.45, css(tc, Math.min(1, a * 0.45)));
          g.addColorStop(1, css(tc, 0));
          lctx.fillStyle = g;
          lctx.fillRect(pkx - R, pky - R, R * 2, R * 2);
        }
      }
      for (const im of impacts) {
        const e = (now - im.t0) / 1000;
        if (e > 0.5 || reduced) continue;
        const rk = clamp01(e / 0.45);
        const R = Math.max(30, easeOut(rk) * W * im.cfg.ring * 1.6);
        const g = lctx.createRadialGradient(im.x, im.y, R * 0.55, im.x, im.y, R);
        g.addColorStop(0, css(im.c, 0));
        g.addColorStop(0.75, css(im.c, 0.7 * (1 - rk)));
        g.addColorStop(1, css(im.c, 0));
        lctx.fillStyle = g;
        lctx.fillRect(im.x - R, im.y - R, R * 2, R * 2);
      }
      if (CARD_LIGHT > 0 && faceUpT > 0 && ph !== "sold") {
        const R = ch * 0.85;
        for (let i = 0; i < LIGHT_PASSES; i++) {
          const g = lctx.createRadialGradient(cx, cy, 0, cx, cy, R);
          g.addColorStop(0, css(tc, Math.min(1, CARD_LIGHT * (1 - backdropK))));
          g.addColorStop(1, css(tc, 0));
          lctx.fillStyle = g;
          lctx.fillRect(cx - R, cy - R, R * 2, R * 2);
        }
      }

      // ---- brightness of the camera image: the room darkens with the stage, jumps when lightning lands, goes dark before the finish ----
      let target = ROOM_BRIGHT.waiting;
      if (ph === "waiting") target = ROOM_BRIGHT.waiting;
      else if (charging || ph === "whiteout") target = ROOM_BRIGHT.stage[stage];
      else if (ph === "rise" || ph === "facts" || ph === "flip" || ph === "done") target = ROOM_BRIGHT.finale + (1 - ROOM_BRIGHT.finale) * backdropK;
      else if (ph === "sold") target = ROOM_BRIGHT.sold;
      let rate = ph === "rise" ? 2.5 : ROOM_BRIGHT.rate;
      if (beat === "lightsout") {
        target = reduced ? ROOM_BRIGHT.reduced : LIGHTSOUT.level;
        rate = 1 / LIGHTSOUT.downSec;
      } else if (beat === "blackout" || beat === "burst") {
        target = reduced ? ROOM_BRIGHT.reduced : 0;
        rate = 30;
      }
      room += (target - room) * Math.min(1, dt * rate);
      let bright = room;
      if (spikeT > 0 && !reduced) {
        const se = (now - spikeT) / 1000;
        if (se < STRIKE_FLASH.sec) bright = room + (STRIKE_FLASH.peak - room) * (1 - se / STRIKE_FLASH.sec);
      }
      const blurTarget = (ph === "whiteout" && whiteStart > 0 && (now - whiteStart) / 1000 > WHITE.in) || ph === "rise" || ph === "facts" || ph === "flip" || ph === "done" ? 1 : 0;
      blurK += (blurTarget - blurK) * Math.min(1, dt * (ph === "rise" ? 2.5 : 5));
      video.style.filter = blurK * (1 - backdropK) > 0.02 ? `brightness(${bright.toFixed(3)}) blur(${(6 * blurK * (1 - backdropK)).toFixed(1)}px)` : `brightness(${bright.toFixed(3)})`;
      video.style.transform = blurK * (1 - backdropK) > 0.02 ? `scale(${(1 + 0.1 * blurK * (1 - backdropK)).toFixed(3)})` : "";

      // ---- pack off screen: an arrow at the edge points to it (off by default: the room is not tracked) ----
      const px = pkx + dx;
      const py = pky + dy;
      const off = SHOW_ARROW && (charging || ph === "waiting") && (px < -pw * 0.3 || px > W + pw * 0.3 || py < -ph2 * 0.3 || py > H + ph2 * 0.3);
      if (off) {
        const vx = px - W / 2;
        const vy = py - H / 2;
        const m = 30;
        const tt = Math.min((W / 2 - m) / Math.max(1e-3, Math.abs(vx)), (H / 2 - m) / Math.max(1e-3, Math.abs(vy)));
        arrow.style.opacity = "1";
        arrow.style.transform = `translate(${(W / 2 + vx * tt).toFixed(1)}px, ${(H / 2 + vy * tt).toFixed(1)}px) rotate(${((Math.atan2(vy, vx) * 180) / Math.PI + 90).toFixed(1)}deg)`;
      } else {
        arrow.style.opacity = "0";
      }

      // ---- particles and DOM variables ----
      const st = root.style;
      const buildup = 1 + 0.5 * count;
      const live = charging || ph === "waiting";
      const fy = reduced || !live ? 0 : Math.sin(now / (ph === "waiting" ? 1400 : 900)) * PACK.float;
      const jit = reduced || !charging ? 0 : 0.4 + count * 1.1;
      st.setProperty("--tc", `${tc[0].toFixed(0)},${tc[1].toFixed(0)},${tc[2].toFixed(0)}`);
      st.setProperty("--fy", `${fy.toFixed(2)}px`);
      st.setProperty("--jx", `${((rand() - 0.5) * 2 * jit).toFixed(2)}px`);
      st.setProperty("--jy", `${((rand() - 0.5) * 2 * jit).toFixed(2)}px`);
      const apulse = reduced ? 1 : 0.75 + 0.25 * Math.sin(now / (260 / buildup));
      const swell = beat === "lightsout" ? LIGHTSOUT_PULSE : 1;
      st.setProperty("--aura", (charging ? AURA[stage] * buildup * apulse * swell : ph === "waiting" ? 0.08 : 0).toFixed(3));
      st.setProperty("--aura-s", (charging ? 0.9 + 0.12 * count + (reduced ? 0 : 0.05 * Math.sin(now / 200)) : 0.9).toFixed(3));
      st.setProperty("--pop", (popT > 0 && !reduced ? Math.exp(-(now - popT) / 180) : 0).toFixed(3));
      st.setProperty("--sheen", `${(50 + (tilt.current.active ? tilt.current.dGamma * 1.5 : 0) + (reduced ? 0 : Math.sin(now / 1800) * 12)).toFixed(1)}%`);
      st.setProperty("--rise-y", `${riseY.toFixed(1)}px`);
      st.setProperty("--rise-s", riseS.toFixed(3));
      st.setProperty("--rise-o", riseO.toFixed(3));
      st.setProperty("--pack-sc", packSc.toFixed(3));
      st.setProperty("--pack-br", packBr.toFixed(3));
      st.setProperty("--pack-o", packO.toFixed(3));
      st.setProperty("--sold", sold.toFixed(3));
      st.setProperty("--sold-s", (reduced ? 0 : sold).toFixed(3));
      void impactT;

      // camera shake and the punch-in after a landing (the camera image, the room's light and the world move together)
      shake *= Math.exp(-dt * SHAKE_DECAY);
      let zoom = 1;
      if (zoomT > 0) {
        const ze = (now - zoomT) / 1000;
        if (ze < ZOOM.sec) zoom = 1 + zoomPeak * Math.sin((Math.PI * ze) / ZOOM.sec);
        else zoomT = -1;
      }
      const sh = shake > 0.2 && !reduced;
      cam.style.transform =
        sh || zoom > 1.001 ? `translate(${sh ? ((rand() - 0.5) * 2 * shake).toFixed(1) : 0}px, ${sh ? ((rand() - 0.5) * 2 * shake).toFixed(1) : 0}px) scale(${(sh ? Math.max(zoom, 1.04) : zoom).toFixed(3)})` : "";
    };
    raf = requestAnimationFrame(frame);
    return () => {
      cancelAnimationFrame(raf);
      motion.removeEventListener("change", onMotion);
      tracker.stop();
      timers.forEach((id) => window.clearTimeout(id));
      cam.style.transform = "";
      video.style.filter = "";
      video.style.transform = "";
      root.removeAttribute("data-hitstop");
      root.removeAttribute("data-beat");
    };
  }, [go, tier, tilt, run]);

  const cardVisible = phase === "rise" || phase === "facts" || phase === "flip" || phase === "done" || phase === "sold";
  const afterReveal = phase === "done" || phase === "sold";
  const ft = factTimes(facts);

  return (
    <div
      ref={rootRef}
      className="packReveal"
      data-phase={phase}
      data-tier={tier}
      data-ui={afterReveal ? ui : "open"}
      data-packimg={packOk ? "image" : "fallback"}
      style={{ "--pack-img": `url(${JSON.stringify(packImageUrl)})`, "--ui-ms": `${UI_MS}ms`, "--pack-top": `${PACK.topRatio * 100}%`, "--veil": FACTS.veilOpacity, "--veil-in": `${FACTS.veilIn}s`, "--veil-out": `${FACTS.veilOut}s`, "--veil-out-at": `${ft.textEnd}s` } as React.CSSProperties}
      role="dialog"
      aria-modal="true"
    >
      <div ref={camRef} className="packRevealCam">
        <video ref={videoRef} className="packRevealVideo" playsInline muted autoPlay />
        <canvas ref={lightRef} className="packRevealLight" />
        <div ref={worldRef} className="packRevealWorld">
          {/* behind the card: a tap anywhere else brings the interface back */}
          {afterReveal && <div className="packRevealScrim" onClick={() => setUi("peek")} />}
          <div className="packRevealStage">
            <div className="packRevealAura" />
            {cardVisible && (
              <div className="packRevealCardSlot">
                <HoloCard key={run} controlRef={cardRef} imageUrl={imageUrl} backImageUrl={backImageUrl} title={title} foil={FOIL_BY_TIER[tier]} demo={demo} initialFace="back" interactive={phase === "done"} />
              </div>
            )}
            <div className="packRevealPack packRevealPackFront">
              <div className="packPart packPartFront" />
              <div className="packPart packPartGloss" />
            </div>
          </div>
        </div>
        <canvas ref={canvasRef} className="packRevealFx" />
      </div>
      <div ref={whiteRef} className="packRevealWhite" />
      <div ref={arrowRef} className="packRevealArrow" aria-hidden="true" />
      {phase === "facts" && ft.times.length > 0 && facts && (
        <>
          <div className="packRevealFactVeil" />
          <div className="packRevealBigFacts" aria-live="polite">
            {facts.slice(0, FACTS_MAX).map((f, i) => (
              <div key={`${run}-${i}`} className="packRevealBigFact" style={{ animationDelay: `${ft.times[i]}s`, "--len": Math.max(2, f.value.length) } as React.CSSProperties}>
                {f.value}
              </div>
            ))}
          </div>
        </>
      )}
      <div className="cameraRevealTop">
        <div>
          {/* Not demo means the card data came from devnet: the app never opens mainnet packs. */}
          <span className="demoBadge">{demo ? "DEMO DATA" : "DEVNET"}</span>
          {camera.failed && <p className="cameraRevealNote">{t(cameraRevealUi.noCamera)}{camera.error ? ` (${camera.error})` : ""}</p>}
        </div>
        <div className="packRevealTopBtns">
          {afterReveal && (
            <button type="button" className="cameraRevealClose packRevealHideUi" onClick={() => setUi("hidden")} aria-label={t(packUi.hideUi)}>
              <svg viewBox="0 0 24 24" width="20" height="20" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
                <path d="M2 12s3.6-7 10-7 10 7 10 7-3.6 7-10 7S2 12 2 12z" />
                <circle cx="12" cy="12" r="3" />
              </svg>
            </button>
          )}
          <button type="button" className="cameraRevealClose packRevealClose" onClick={handleClose} aria-label={t(cameraRevealUi.closeLabel)}>
            ×
          </button>
        </div>
      </div>
      {phase === "waiting" && <p className="packRevealHint packRevealHintWait">{t(packUi.preparing)}</p>}
      {afterReveal && <div className="packRevealShade" aria-hidden="true" />}
      {phase === "done" && outcome !== "sold" && <p className="holoCardHint">{t(holoUi.spinHint)}</p>}
      {afterReveal && (
        <div className="packRevealSheet">
          <button type="button" className="packRevealSheetBar" onClick={() => setUi(ui === "open" ? "peek" : "open")} aria-expanded={ui === "open"}>
            <span className="packRevealGrab" aria-hidden="true" />
            <span className="packRevealSheetName">{phase === "sold" ? t(packUi.sold) : title}</span>
            <svg className="packRevealChevron" viewBox="0 0 24 24" width="20" height="20" fill="none" stroke="currentColor" strokeWidth="2.4" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
              <path d="M6 15l6-6 6 6" />
            </svg>
          </button>
          <div className="packRevealSheetBody">
            {phase === "done" && facts && facts.length > 0 && (
              <dl className="packRevealSheetFacts">
                {facts.map((f, i) => (
                  <div key={i}>
                    <dt>{f.label}</dt>
                    <dd>{f.value}</dd>
                  </div>
                ))}
              </dl>
            )}
            {phase === "done" && outcome === "none" && (
              <div className="packRevealChoice">
                <button type="button" className="cameraRevealBtn solid" onClick={onKeep}>{t(packUi.keep)}</button>
                {buyback && (
                  <>
                    <button type="button" className="cameraRevealBtn" onClick={sell} disabled={selling} aria-busy={selling}>
                      {selling ? t(packUi.processing) : t(packUi.sell)}
                      {!selling && ` · ${buyback.amountLabel}${buyback.rateLabel ? ` (${buyback.rateLabel})` : ""}`}
                    </button>
                    <p className="packRevealChoiceNote">
                      {t(pullUi.buybackNote)}
                      {buyback.windowLabel ? ` ${buyback.windowLabel}` : ""}
                    </p>
                  </>
                )}
              </div>
            )}
            {phase === "done" && outcome === "kept" && <p className="packRevealOutcome">{t(packUi.kept)}</p>}
            <div className="packRevealTextBar">
              <button type="button" className="packRevealTextBtn" onClick={restart}>{t(cameraRevealUi.again)}</button>
              <button type="button" className="packRevealTextBtn" onClick={handleClose}>{t(cameraRevealUi.close)}</button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
