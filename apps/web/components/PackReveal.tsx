"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { cameraRevealUi, holoUi, packUi, pullUi } from "../lib/copy/pull";
import { useI18n } from "../lib/i18n";
import { useCameraStream } from "../lib/reveal/useCameraStream";
import { createFlare } from "../lib/reveal/flareGL";
import { HoloCard, type HoloCardHandle } from "./HoloCard";

type Tier = 0 | 1 | 2 | 3;
type Phase = "waiting" | "roll" | "wobble1" | "wobble2" | "open" | "rise" | "facts" | "flip" | "done" | "sold";
type Fact = { label: string; value: string; emphasis?: boolean };
type UiState = "open" | "peek" | "hidden";

type Props = {
  tier: Tier;
  /** False while the result has not arrived yet (the capsule waits off screen). Default true. */
  ready?: boolean;
  imageUrl?: string;
  backImageUrl?: string;
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

// Colour ladder: blue < green < red < gold < rainbow, each a white light with a tint. One "stage" tints the light of the room at once.
const STAGE_NAMES = ["blue", "green", "red", "gold", "rainbow"] as const;
const STAGE_COLORS: [number, number, number][] = [
  [176, 206, 255], // blue
  [176, 232, 200], // green
  [255, 186, 180], // red
  [255, 226, 168], // gold
  [255, 255, 255], // rainbow: replaced by a smoothly drifting hue (see stageRGB)
];
// How far each tier climbs. `to` is the one change while the capsule rolls; `taps` is the stage at the first rock, the second rock and the opening.
const STAGE_PLAN: { to?: number; taps: [number, number, number] }[] = [
  { taps: [0, 0, 0] }, // tier 0: blue all the way
  { taps: [0, 1, 1] }, // tier 1: blue, blue, green, green
  { to: 1, taps: [1, 2, 2] }, // tier 2: blue -> green while rolling, then green, red, red
  { to: 1, taps: [2, 3, 4] }, // tier 3: blue -> green, then red (skipping green), gold, rainbow
];
const RAINBOW_SPEED = 22; // ms per degree of hue
const RAINBOW_SAT = 0.6; // the rainbow is a pale, white-leaning light
const RAINBOW_LIGHT = 0.8;

// The capsule (an original design, drawn with CSS only): it rolls in from the right, rocks twice, opens, and the card comes out of it.
// Keep BALL.vw/maxPx/floor in sync with --ball and --ball-floor, which are passed to the CSS from here.
const BALL = { vw: 34, maxPx: 160, floor: 0.74 }; // diameter (share of the screen width, cap in px); height of its centre (share of the screen height)
// It is seen a little from above and from the side, not head-on: the seam is a curve, the whole capsule leans by `tilt` (deg) and the clasp
// sits off the middle by `yaw` (rad round the capsule, 0 = facing the viewer).
const BALL_VIEW = { tilt: -14, yaw: -0.42 };
// The roll in has depth: the capsule starts far away on the floor (small, near the horizon line, off the right edge) and rolls toward the
// viewer along a straight line on the floor, so on screen it grows and curves down to its resting place. farZ = how many times farther away
// it starts (size 1 / farZ); horizon and startX are shares of the screen. It comes bouncing: it drops in from `bounces[0]` (heights in
// diameters), then each bounce is lower and shorter (time in the air goes with the square root of the height), it flattens for an instant
// every time it lands (squash), and from bounceUntil (share of the roll) it only rolls along the floor.
const ROLL = { sec: 2.9, settleSec: 0.45, settleDeg: 7, farZ: 3.8, horizon: 0.5, startX: 1.12, turns: 3, spins: 2, bounces: [1.3, 0.8, 0.46, 0.24, 0.1], bounceUntil: 0.8, squash: 0.24, squashSec: 0.09 };
const ROLL_REST_SEC = 0.5; // pause after the roll before the first rock
const WOBBLE = [{ deg: 24, shift: 8, sec: 0.7 }, { deg: 30, shift: 10, sec: 0.8 }]; // rotation (deg) and sideways shift (px) of each rock
const WOBBLE_GAP_SEC = 0.75; // pause after the first rock
const OPEN_DELAY_SEC = 0.6; // pause after the second rock before the lid opens
const SEAM = { roll: 0.15, wobble1: [0.25, 0.5], wobble2: [0.5, 0.8] }; // strength of the light leaking from the seam (wobble: start and end)
// The opening: it crouches, the lid tips back from the clasp (hinged at the back) and at once the whole screen goes white. The capsule is
// gone under the white, and the card is there as the white clears.
const OPEN = { lidSec: 0.16, overshoot: 1.18, holdSec: 0.48, flashPeak: 1, hopPx: 16, squashSec: 0.16, squash: 0.12, stretch: 0.16, ballOutAt: 0.52, ballOutSec: 0.08 };
const RISE = { sec: 0.9, startScale: 0.62 }; // the card comes forward out of the white, from where the capsule was
// The flare as the lid opens: a lens flare drawn by a shader (lib/reveal/flareGL.ts), as a real light looks through a camera. It builds
// faintly from fromSec before the opening, bursts at the opening, and only after leadSec the white takes the whole screen.
// It goes out while the screen is still fully white (outSec after the white began), so nothing of it is left when the card shows.
const FLARE = { leadSec: 0.5, fromSec: -0.4, outSec: 0.22, power: [0.85, 1, 1.15, 1.3] };
const MAX_PARTICLES = 300;
const FOIL_BY_TIER: (0 | 1 | 2 | 3)[] = [0, 0, 0, 0];

// How bright the camera image is, per stage, and in other moments.
const ROOM_BRIGHT = { waiting: 0.9, stage: [0.85, 0.8, 0.74, 0.68, 0.68], dim: 0.5, finale: 0.7, sold: 0.85, rate: 6 }; // dim: tier 2 and 3 at the second rock
// Light the capsule throws on the room (soft-light): radius (fraction of the screen height) and strength, per stage.
const ROOM_LIGHT = [
  { r: 0.9, a: 0.35 },
  { r: 1.1, a: 0.45 },
  { r: 1.35, a: 0.6 },
  { r: 1.6, a: 0.7 },
  { r: 1.8, a: 0.8 },
];
const LIGHT_PASSES = 2; // soft-light is subtle; the same glow is drawn this many times
const AURA = [0.18, 0.24, 0.3, 0.36, 0.42]; // glow behind the capsule (DOM), per stage
const AURA_PULSE_MS = 1100; // period scale of the glow's slow pulse
const CARD_LIGHT = 0.3; // the card's faint colour on the room once it is up (0 = off)
// The room's backdrop (blur and dark) while the card is up, then it clears so the room shows.
const BACKDROP_HOLD = 1.0; // seconds after the card has turned face up
const BACKDROP_FADE = 2.2; // seconds to go back to the plain camera image
// Facts, one at a time as a small label and value under the face-down card over a faint dark veil (up to FACTS_MAX of them), then the card turns over.
// The keyframes of .packRevealBigFact in globals.css assume fadeIn 0.4 + hold 0.7 + fadeOut 0.3 = 1.4 s.
const FACTS_MAX = 3;
const FACTS = { veilIn: 0.35, fadeIn: 0.4, hold: 0.7, fadeOut: 0.3, veilOut: 0.3, veilOpacity: 0.16 };
const UI_MS = 280; // how long the bottom sheet takes to open and close

const WHITE = { in: 0.12, hold: 0.22, out: 0.75 }; // seconds; the whole screen goes white as the lid opens (strength: OPEN.flashPeak)
const WHITE_REDUCED = { peak: 0.7, in: 0.25, hold: 0.15, out: 0.8 }; // reduced motion: softer and slower, still enough to cover the capsule going
const FLIP_SHOW = 0.35; // seconds the back is shown before turning
const FLIP_CHARGE = [0, 0, 0.3, 0.5]; // extra wait before the turn, per tier
const FLIP_DUR = 0.9; // time for the half turn to settle
const FACE_UP_AT = 0.45; // seconds after the turn starts, when the face is up
const OV = 64; // the effect layers (and the camera image) reach this many px beyond every screen edge
// The finish: the moment the card has turned face up the room brightens once, softly.
const FINALE = { flashPeak: 0.18, flashSec: 0.9, flashPeakReduced: 0.1 };
const SOLD_MS = 900; // the card dissolves into light after a sell-back
const SOLD_PARTICLES_PER_SEC = 200;

/* -------------------------------------------------------------------------------------------------------------------------------------------------- */

const clamp01 = (v: number) => Math.max(0, Math.min(1, v));
const easeOut = (v: number) => 1 - Math.pow(1 - clamp01(v), 3);

function hslToRgb(h: number, s: number, l: number): [number, number, number] {
  const k = (n: number) => (n + h / 30) % 12;
  const a = s * Math.min(l, 1 - l);
  const f = (n: number) => l - a * Math.max(-1, Math.min(k(n) - 3, Math.min(9 - k(n), 1)));
  return [f(0) * 255, f(8) * 255, f(4) * 255];
}

/** Colour of a stage. Rainbow drifts smoothly through the hues (never blinks between them). */
function stageRGB(stage: number, now: number): [number, number, number] {
  return stage === 4 ? hslToRgb((now / RAINBOW_SPEED) % 360, RAINBOW_SAT, RAINBOW_LIGHT) : STAGE_COLORS[stage];
}
const css = (c: [number, number, number], a = 1) => `rgba(${c[0].toFixed(0)},${c[1].toFixed(0)},${c[2].toFixed(0)},${a})`;

type Particle = { x: number; y: number; vx: number; vy: number; life: number; max: number; size: number; c: [number, number, number]; drag?: number; tail?: number; t0?: number };

/** How far the lid has tipped back (0 shut, 1 open): it goes past the end (overshoot) and settles back. p is 0..1 over lidSec. */
function lidCurve(p: number): number {
  if (p < 0.65) return OPEN.overshoot * easeOut(p / 0.65);
  const s = clamp01((p - 0.65) / 0.35);
  return OPEN.overshoot + (1 - OPEN.overshoot) * (s * s * (3 - 2 * s));
}

/** When each of the (up to FACTS_MAX) facts shows under the card, and how long the facts stage lasts (veil in, texts, veil out). */
function factTimes(facts: Fact[] | undefined): { times: number[]; textEnd: number; total: number } {
  const n = Math.min(FACTS_MAX, facts?.length ?? 0);
  if (n === 0) return { times: [], textEnd: 0, total: 0 };
  const per = FACTS.fadeIn + FACTS.hold + FACTS.fadeOut;
  const times = Array.from({ length: n }, (_, i) => FACTS.veilIn + i * per);
  const textEnd = FACTS.veilIn + n * per;
  return { times, textEnd, total: textEnd + FACTS.veilOut };
}

/**
 * The opening experiment, played in the room: a two-tone capsule rolls in from the right over the camera image, rocks twice (its seam
 * leaks light that changes colour up the ladder blue, green, red, gold, rainbow as far as the tier allows), pops open and lights up, and the
 * card comes out of it face down. The room reacts: it dims a little before the opening (tier 2 and 3) and the capsule's light tints it.
 * Canvas 2D and CSS only. The FX canvas sits above the capsule and the card so the light stays visible.
 */
export function PackReveal({ tier, ready = true, imageUrl, backImageUrl, facts, title, demo, onClose, buyback, onKeep, onSell, outcome = "none", onAgain }: Props) {
  const { t } = useI18n();
  const rootRef = useRef<HTMLDivElement>(null);
  const worldRef = useRef<HTMLDivElement>(null);
  const videoRef = useRef<HTMLVideoElement>(null);
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const flareRef = useRef<HTMLCanvasElement>(null);
  const lightRef = useRef<HTMLCanvasElement>(null);
  const whiteRef = useRef<HTMLDivElement>(null);
  const factsRef = useRef<Fact[] | undefined>(facts);
  const [ui, setUi] = useState<UiState>("peek");
  const cardRef = useRef<HoloCardHandle>(null);
  const phaseRef = useRef<Phase>("waiting");
  const phaseStartRef = useRef(0);
  // Warm the browser cache while the capsule is still closed, so the card does not come out blank.
  useEffect(() => {
    for (const url of [imageUrl, backImageUrl]) {
      if (url && url.startsWith("https://")) new Image().src = url;
    }
  }, [imageUrl, backImageUrl]);
  const clockRef = useRef(0); // the loop's clock
  const readyRef = useRef(ready);
  const outcomeRef = useRef(outcome);
  const [selling, setSelling] = useState(false);
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
    const world = worldRef.current;
    const video = videoRef.current;
    const canvas = canvasRef.current;
    const lightCanvas = lightRef.current;
    const white = whiteRef.current;
    if (!root || !world || !video || !canvas || !lightCanvas || !white) return;
    const flareCanvas = flareRef.current;
    const flare = flareCanvas ? createFlare(flareCanvas) : null;
    const flareSeed = Math.random() * 6.28;
    let flareOn = false;
    const ctx = canvas.getContext("2d");
    const lctx = lightCanvas.getContext("2d");
    if (!ctx || !lctx) return;
    const motion = window.matchMedia("(prefers-reduced-motion: reduce)");
    let reduced = motion.matches;
    const onMotion = () => {
      reduced = motion.matches;
    };
    motion.addEventListener("change", onMotion);

    let raf = 0;
    let lastReal = performance.now();
    let started = false;
    let usedFacts = false;
    let whiteStart = 0; // when the flash of the opening began
    let flipCalled = false;
    let stage = 0;
    let waitChanged = false;
    let openT = -1; // when the lid opened (the big light is timed from here)
    let flareT = -1; // the capsule's light flares when the stage steps up
    let finFlashT = -1; // the soft brightening when the card is face up
    let soldStart = 0;
    let soldAcc = 0;
    let faceUpT = -1;
    let room = ROOM_BRIGHT.waiting; // smoothed brightness of the camera image
    let blurK = 0; // 0..1, eased in once the card has appeared
    let parts: Particle[] = [];
    const plan = STAGE_PLAN[tier];

    const push = (p: Particle) => {
      if (parts.length < MAX_PARTICLES) parts.push(p);
    };

    const frame = (real: number) => {
      raf = requestAnimationFrame(frame);
      const dt = Math.min(0.05, (real - lastReal) / 1000);
      lastReal = real;
      const now = real;
      clockRef.current = now;
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

      /** Move the colour ladder: the room's light changes colour at once, and the capsule's light flares. */
      const setStage = (next: number) => {
        if (next === stage) return;
        stage = next;
        root.setAttribute("data-stage", STAGE_NAMES[stage]);
        flareT = now;
      };

      if (!started) {
        started = true;
        root.setAttribute("data-stage", STAGE_NAMES[stage]);
        go(readyRef.current ? "roll" : "waiting");
      }
      let ph = phaseRef.current;
      let pt = (now - phaseStartRef.current) / 1000;
      /** Enter the next phase (pt restarts from 0 in this same frame). */
      const to = (next: Phase) => {
        go(next);
        ph = next;
        pt = 0;
      };
      if (ph === "waiting" && readyRef.current) to("roll");

      // geometry (screen coordinates)
      const D = Math.min((W * BALL.vw) / 100, BALL.maxPx); // capsule diameter
      const by = H * BALL.floor; // height of the capsule's centre, which is also the seam and the mouth
      const cx = W / 2; // the card
      const cy = H * 0.42;
      const cw = Math.min(W * 0.62, 320);
      const ch = (cw * 1136) / 677;

      // ---- phases ----
      if (ph === "roll") {
        if (plan.to !== undefined && !waitChanged && pt >= ROLL.sec * 0.5) {
          waitChanged = true;
          setStage(plan.to);
        }
        if (pt >= ROLL.sec + ROLL.settleSec + ROLL_REST_SEC) {
          to("wobble1");
          setStage(plan.taps[0]);
        }
      } else if (ph === "wobble1") {
        if (pt >= WOBBLE[0].sec + WOBBLE_GAP_SEC) {
          to("wobble2");
          setStage(plan.taps[1]);
        }
      } else if (ph === "wobble2") {
        if (pt >= WOBBLE[1].sec + OPEN_DELAY_SEC) {
          to("open");
          openT = now;
          flareT = now;
          setStage(plan.taps[2]);
          whiteStart = now + FLARE.leadSec * 1000; // the flare is seen first, then the white takes the screen
        }
      } else if (ph === "open") {
        if (pt >= OPEN.lidSec + OPEN.holdSec) to("rise");
      }

      // ---- the capsule: position, roll, rocks, lid ----
      let bx = W + D; // centre x; off the right edge until it rolls in
      let ballY = 0; // offset of the capsule's bottom from its resting place (negative = higher on screen)
      let ballS = 1; // size (1 = at rest, smaller = farther away)
      let ballSq = 1; // vertical squash (below 1) and stretch (above 1) around the opening
      let shadowDy = 0; // the shadow stays on the floor while the capsule hops
      let shadowK = 1; // and gets smaller and fainter the higher the capsule is
      let markX = Math.sin(BALL_VIEW.yaw); // the clasp on the seam: where it is across the capsule (-1 left edge .. 1 right edge) and how wide it looks (0 = edge-on, hidden)
      let markW = Math.cos(BALL_VIEW.yaw);
      let rot: number = BALL_VIEW.tilt;
      let dyHop = 0;
      let ballO = 1;
      let seam: number = SEAM.roll;
      let lid = 0;
      const lidO = 1;
      let shade = 1;
      if (ph === "waiting") {
        ballO = 0;
      } else if (ph === "roll") {
        // a point on the floor, projected: distance z (1 = resting place) gives the size 1 / z, the height between the horizon and the
        // resting place, and how far the sideways offset is pulled toward the middle
        const p = clamp01(pt / ROLL.sec);
        const e = 1 - (1 - p) * (1 - p); // slows down gently, so the far part of the way is seen too
        const z = ROLL.farZ + (1 - ROLL.farZ) * e;
        ballS = 1 / z;
        const restBottom = by + D / 2;
        const horizonY = H * ROLL.horizon;
        // where it is in the chain of bounces: the first is only the fall (half an arc), the others are whole arcs
        const airs = ROLL.bounces.map((h, i) => Math.sqrt(h) * (i === 0 ? 0.5 : 1));
        const airTotal = airs.reduce((sum, v) => sum + v, 0);
        let tb = (p / ROLL.bounceUntil) * airTotal;
        let hop = 0;
        let landed = -1; // time since the last landing (s), and how hard it was (the height it fell from)
        let fell = 0;
        for (let i = 0; i < airs.length; i++) {
          if (tb < airs[i]) {
            const u = i === 0 ? 0.5 + (tb / airs[i]) * 0.5 : tb / airs[i];
            hop = D * ballS * ROLL.bounces[i] * (1 - (2 * u - 1) * (2 * u - 1));
            if (i > 0) {
              landed = ((tb / airTotal) * ROLL.bounceUntil) * ROLL.sec;
              fell = ROLL.bounces[i - 1];
            }
            break;
          }
          tb -= airs[i];
          if (i === airs.length - 1) {
            landed = ((tb / airTotal) * ROLL.bounceUntil) * ROLL.sec;
            fell = ROLL.bounces[i];
          }
        }
        if (landed >= 0) ballSq = 1 - ROLL.squash * Math.sqrt(fell / ROLL.bounces[0]) * Math.exp(-landed / ROLL.squashSec);
        shadowK = 1 - 0.55 * clamp01(hop / (D * ballS * ROLL.bounces[0]));
        ballY = horizonY + (restBottom - horizonY) / z - restBottom - hop;
        shadowDy = hop / ballS;
        bx = W / 2 + ((ROLL.startX - 0.5) * W * ROLL.farZ * (1 - e)) / z;
        rot = BALL_VIEW.tilt + ROLL.turns * 360 * (1 - e); // whole turns, so it stops at its resting lean
        // the clasp travels round the capsule: it slides across the front, narrows toward the edge, and is hidden while it is at the back
        const spin = BALL_VIEW.yaw + 2 * Math.PI * ROLL.spins * (1 - e);
        markX = Math.sin(spin);
        markW = Math.max(0, Math.cos(spin));
        ballO = clamp01(pt / 0.25);
        if (pt > ROLL.sec) {
          const u = clamp01((pt - ROLL.sec) / ROLL.settleSec);
          rot = BALL_VIEW.tilt - ROLL.settleDeg * Math.exp(-4 * u) * Math.sin(2 * Math.PI * 1.25 * u);
        }
      } else {
        bx = W / 2;
        if (ph === "wobble1" || ph === "wobble2") {
          const i = ph === "wobble1" ? 0 : 1;
          const u = clamp01(pt / WOBBLE[i].sec);
          const s = -Math.sin(3 * Math.PI * u) * (1 - u); // one and a half swings, dying away: it leans left first, then right
          rot = BALL_VIEW.tilt + WOBBLE[i].deg * s;
          bx += WOBBLE[i].shift * s;
          // it crouches just before it pops open
          if (i === 1) ballSq = 1 - OPEN.squash * clamp01((pt - (WOBBLE[1].sec + OPEN_DELAY_SEC - OPEN.squashSec)) / OPEN.squashSec);
          const [s0, s1] = i === 0 ? SEAM.wobble1 : SEAM.wobble2;
          seam = s0 + (s1 - s0) * u;
        } else {
          // open and after: the lid is back, the seam is the mouth
          const lp = ph === "open" ? clamp01(pt / OPEN.lidSec) : 1;
          lid = lidCurve(lp); // 0 = shut, 1 = tipped back
          dyHop = ph !== "open" ? 0 : -OPEN.hopPx * Math.sin(Math.PI * clamp01(pt / 0.3));
          if (ph === "open") ballSq = 1 + OPEN.stretch * Math.exp(-6 * pt) * Math.cos(18 * pt);
          shade = ph === "open" ? 1 - clamp01(pt / 0.15) : 0;
          seam = SEAM.wobble2[1] + (1 - SEAM.wobble2[1]) * lp;
          // the capsule is gone in the light, before the card comes out
          ballO = ph === "open" ? 1 - clamp01((pt - OPEN.ballOutAt) / OPEN.ballOutSec) : 0;
          seam *= ballO;
        }
      }
      const mouthY = by + dyHop;
      const tc = stageRGB(stage, now);

      // ---- rise: the card comes out of the mouth, wrapped in light that clears as it grows ----
      let riseY = 0;
      let riseS = 1;
      let riseO = 1;
      let riseP = 1;
      let riseE = 1;
      if (ph === "rise") {
        riseP = clamp01(pt / RISE.sec);
        riseE = easeOut(riseP);
        const startCy = by - 4; // the card starts at the mouth
        riseY = (1 - riseE) * (startCy - cy);
        riseS = RISE.startScale + (1 - RISE.startScale) * riseE;
        riseO = clamp01(riseP / 0.15);
        if (riseP >= 1) {
          const has = (factsRef.current?.length ?? 0) > 0;
          usedFacts = has;
          to(has ? "facts" : "flip");
        }
      }
      if (ph === "facts") {
        // face down, the facts come up one by one; then the card turns
        if (pt >= factTimes(factsRef.current).total) to("flip");
      }

      // ---- flip: show the back (with a wait for tier 2 and 3), then turn ----
      if (ph === "flip" || ph === "done") {
        const ft = ph === "flip" ? pt : 99;
        const wait = usedFacts ? FLIP_CHARGE[tier] : FLIP_SHOW + FLIP_CHARGE[tier];
        if (ph === "flip" && ft >= wait && !flipCalled) {
          flipCalled = true;
          cardRef.current?.flip(1);
        }
        if (faceUpT < 0 && ph === "flip" && ft >= wait + FACE_UP_AT) {
          faceUpT = now; // the face is up: one soft brightening
          finFlashT = now;
        }
        if (ph === "flip" && ft >= wait + FLIP_DUR) to("done");
      }

      // ---- sold: the card dissolves into light ----
      let sold = 0;
      if (ph === "done" && outcomeRef.current === "sold") {
        soldStart = now;
        to("sold");
      }
      if (ph === "sold") {
        sold = clamp01((now - soldStart) / SOLD_MS);
        if (!reduced && sold < 0.7) {
          soldAcc += SOLD_PARTICLES_PER_SEC * dt;
          while (soldAcc >= 1) {
            soldAcc -= 1;
            const side = Math.random() * (2 * cw + 2 * ch);
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
            push({ x: px, y: py, vx: (Math.random() - 0.5) * 24, vy: -(50 + Math.random() * 90), life: 0, max: 0.6 + Math.random() * 0.4, size: 1.5 + Math.random() * 1.8, c: stageRGB(stage, now + Math.random() * 900) });
          }
        }
      }

      // ---- FX canvas (drawn additively, in front of the capsule and the card) ----
      ctx.setTransform(1, 0, 0, 1, 0, 0);
      ctx.clearRect(0, 0, canvas.width, canvas.height);
      ctx.setTransform(dpr, 0, 0, dpr, OV * dpr, OV * dpr); // from here on: screen coordinates
      ctx.save();
      ctx.globalCompositeOperation = "lighter";
      // the lens flare (its own canvas): from just before the opening until it has died away under the white
      const teF = ph === "wobble2" ? pt - (WOBBLE[1].sec + OPEN_DELAY_SEC) : openT > 0 ? (now - openT) / 1000 : -9;
      const flareLive = flare !== null && flareCanvas !== null && teF > FLARE.fromSec && teF < FLARE.leadSec + FLARE.outSec && (ph === "wobble2" || ph === "open" || ph === "rise");
      if (flareLive) {
        flare.draw({ t: teF, x: W / 2, y: by, tint: tc, seed: flareSeed, power: FLARE.power[tier] * (1 - clamp01((teF - FLARE.leadSec) / FLARE.outSec)) });
        if (!flareOn) flareCanvas.style.opacity = "1";
        flareOn = true;
      } else if (flareOn && flareCanvas) {
        flareCanvas.style.opacity = "0";
        flareOn = false;
      }
      if (ph === "open" || ph === "rise") {
        if (ph === "rise") {
          // the card comes out wrapped in a lump of white light that clears as it rises
          const la = (1 - riseE) * (1 - riseE);
          const lx = cx;
          const ly = cy + riseY;
          const R = Math.max(D * 0.9, ch * riseS * 0.6);
          const g3 = ctx.createRadialGradient(lx, ly, 0, lx, ly, R);
          g3.addColorStop(0, `rgba(255,255,255,${0.85 * la})`);
          g3.addColorStop(0.5, css(tc, 0.35 * la));
          g3.addColorStop(1, css(tc, 0));
          ctx.fillStyle = g3;
          ctx.fillRect(lx - R, ly - R, R * 2, R * 2);
        }
      }
      // particles
      const alive: Particle[] = [];
      for (const p of parts) {
        if (p.t0 !== undefined && now < p.t0) {
          alive.push(p); // not thrown yet
          continue;
        }
        p.life += dt;
        if (p.life >= p.max) continue;
        if (p.drag) {
          const d = Math.exp(-p.drag * dt);
          p.vx *= d;
          p.vy *= d;
        }
        p.x += p.vx * dt;
        p.y += p.vy * dt;
        if (p.tail) {
          // a spark: a short line along its way, long while it is fast, fading out
          ctx.globalAlpha = 1 - p.life / p.max;
          ctx.strokeStyle = css(p.c, 1);
          ctx.lineWidth = p.size;
          ctx.lineCap = "round";
          ctx.beginPath();
          ctx.moveTo(p.x, p.y);
          ctx.lineTo(p.x - p.vx * p.tail, p.y - p.vy * p.tail);
          ctx.stroke();
        } else {
          ctx.globalAlpha = Math.sin((Math.PI * p.life) / p.max);
          ctx.fillStyle = css(p.c, 1);
          ctx.beginPath();
          ctx.arc(p.x, p.y, p.size, 0, Math.PI * 2);
          ctx.fill();
        }
        alive.push(p);
      }
      parts = alive;
      ctx.restore();

      // ---- the single flash as the lid opens, and the soft brightening when the card is face up ----
      let whiteOpacity = 0;
      if (whiteStart > 0 && now >= whiteStart) {
        const e = (now - whiteStart) / 1000;
        const w = reduced ? WHITE_REDUCED.in : WHITE.in;
        const h = reduced ? WHITE_REDUCED.hold : WHITE.hold;
        const o = reduced ? WHITE_REDUCED.out : WHITE.out;
        const peak = reduced ? WHITE_REDUCED.peak : OPEN.flashPeak;
        whiteOpacity = e < w ? (e / w) * peak : e < w + h ? peak : Math.max(0, peak * (1 - (e - w - h) / o));
      }
      if (finFlashT > 0) {
        const fe = (now - finFlashT) / 1000;
        if (fe < FINALE.flashSec) whiteOpacity = Math.max(whiteOpacity, (reduced ? FINALE.flashPeakReduced : FINALE.flashPeak) * (1 - fe / FINALE.flashSec));
      }
      white.style.opacity = whiteOpacity.toFixed(3);

      // the backdrop clears once the face has been up for a while, so the room shows around the card
      const backdropK = faceUpT > 0 && ph !== "sold" ? clamp01(((now - faceUpT) / 1000 - BACKDROP_HOLD) / BACKDROP_FADE) : 0;

      // ---- the room's light (soft-light canvas over the camera image): the capsule's glow at the mouth, the card's glow ----
      lctx.setTransform(1, 0, 0, 1, 0, 0);
      lctx.clearRect(0, 0, lightCanvas.width, lightCanvas.height);
      lctx.setTransform(dpr, 0, 0, dpr, OV * dpr, OV * dpr);
      const rl = ROOM_LIGHT[stage];
      const lightK = ph === "wobble1" || ph === "wobble2" ? seam * 0.6 : ph === "open" ? 1 : ph === "rise" ? 1 - riseP : 0;
      if (lightK > 0.01) {
        const flare = flareT > 0 && !reduced ? 1 + 0.9 * Math.exp(-(now - flareT) / 300) : 1;
        const pulse = reduced ? 1 : 0.85 + 0.15 * Math.sin(now / 600);
        const a = rl.a * lightK * pulse * flare;
        const R = rl.r * H * 0.5;
        for (let i = 0; i < LIGHT_PASSES; i++) {
          const g = lctx.createRadialGradient(bx, mouthY, 0, bx, mouthY, R);
          g.addColorStop(0, css(tc, Math.min(1, a)));
          g.addColorStop(0.45, css(tc, Math.min(1, a * 0.45)));
          g.addColorStop(1, css(tc, 0));
          lctx.fillStyle = g;
          lctx.fillRect(bx - R, mouthY - R, R * 2, R * 2);
        }
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

      // ---- brightness of the camera image: it dims a little with the stage, more at the second rock (tier 2 and 3), brightens at the opening ----
      let target = ROOM_BRIGHT.waiting;
      let rate = ROOM_BRIGHT.rate;
      if (ph === "wobble1" || ph === "wobble2") {
        target = ROOM_BRIGHT.stage[stage];
        if (ph === "wobble2" && tier >= 2 && !reduced) {
          target = ROOM_BRIGHT.dim;
          rate = 4;
        }
      } else if (ph === "open" || ph === "rise" || ph === "facts" || ph === "flip" || ph === "done") {
        target = ROOM_BRIGHT.finale + (1 - ROOM_BRIGHT.finale) * backdropK;
        if (ph === "rise") rate = 2.5;
      } else if (ph === "sold") target = ROOM_BRIGHT.sold;
      room += (target - room) * Math.min(1, dt * rate);
      const blurTarget = ph === "rise" || ph === "facts" || ph === "flip" || ph === "done" ? 1 : 0;
      blurK += (blurTarget - blurK) * Math.min(1, dt * (ph === "rise" ? 2.5 : 5));
      video.style.filter = blurK * (1 - backdropK) > 0.02 ? `brightness(${room.toFixed(3)}) blur(${(6 * blurK * (1 - backdropK)).toFixed(1)}px)` : `brightness(${room.toFixed(3)})`;
      video.style.transform = blurK * (1 - backdropK) > 0.02 ? `scale(${(1 + 0.1 * blurK * (1 - backdropK)).toFixed(3)})` : "";

      // ---- glow behind the capsule: none while rolling, per stage at the rocks, stronger at the opening, gone as the card rises ----
      const buildup = ph === "wobble2" ? 1.5 : 1;
      const apulse = reduced ? 1 : 0.75 + 0.25 * Math.sin(now / (AURA_PULSE_MS / buildup));
      let aura = 0;
      if (ph === "wobble1") aura = AURA[stage] * 0.7 * apulse;
      else if (ph === "wobble2") aura = AURA[stage] * apulse;
      else if (ph === "open") aura = AURA[stage] * 1.6;
      else if (ph === "rise") aura = AURA[stage] * 1.6 * clamp01(1 - riseP * 2);

      // ---- DOM variables ----
      const st = root.style;
      st.setProperty("--tc", `${tc[0].toFixed(0)},${tc[1].toFixed(0)},${tc[2].toFixed(0)}`);
      st.setProperty("--ball-x", `${bx.toFixed(1)}px`);
      st.setProperty("--ball-y", `${ballY.toFixed(1)}px`);
      st.setProperty("--ball-s", ballS.toFixed(4));
      st.setProperty("--ball-sq", ballSq.toFixed(3));
      st.setProperty("--shadow-k", shadowK.toFixed(3));
      st.setProperty("--mark-x", markX.toFixed(3));
      st.setProperty("--mark-w", markW.toFixed(3));
      st.setProperty("--shadow-dy", `${shadowDy.toFixed(1)}px`);
      st.setProperty("--ball-dy", `${dyHop.toFixed(2)}px`);
      st.setProperty("--ball-rot", `${rot.toFixed(2)}deg`);
      st.setProperty("--ball-o", ballO.toFixed(3));
      st.setProperty("--lid", lid.toFixed(3));
      st.setProperty("--lid-o", lidO.toFixed(3));
      st.setProperty("--seam", seam.toFixed(3));
      st.setProperty("--shade", shade.toFixed(3));
      st.setProperty("--aura", aura.toFixed(3));
      st.setProperty("--aura-s", (ph === "open" ? 1.1 : 0.9 + (reduced ? 0 : 0.05 * Math.sin(now / 900))).toFixed(3));
      st.setProperty("--rise-y", `${riseY.toFixed(1)}px`);
      st.setProperty("--rise-s", riseS.toFixed(3));
      st.setProperty("--rise-o", riseO.toFixed(3));
      st.setProperty("--sold", sold.toFixed(3));
      st.setProperty("--sold-s", (reduced ? 0 : sold).toFixed(3));
    };
    raf = requestAnimationFrame(frame);
    return () => {
      cancelAnimationFrame(raf);
      flare?.dispose();
      motion.removeEventListener("change", onMotion);
      video.style.filter = "";
      video.style.transform = "";
    };
  }, [go, tier, run]);

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
      style={{ "--ball": `min(${BALL.vw}vw, ${BALL.maxPx}px)`, "--ball-floor": `${BALL.floor * 100}%`, "--ui-ms": `${UI_MS}ms`, "--veil": FACTS.veilOpacity, "--veil-in": `${FACTS.veilIn}s`, "--veil-out": `${FACTS.veilOut}s`, "--veil-out-at": `${ft.textEnd}s` } as React.CSSProperties}
      role="dialog"
      aria-modal="true"
    >
      <div className="packRevealCam">
        <video ref={videoRef} className="packRevealVideo" playsInline muted autoPlay />
        <canvas ref={lightRef} className="packRevealLight" />
        <div ref={worldRef} className="packRevealWorld">
          {/* behind the card: a tap anywhere else brings the interface back */}
          {afterReveal && <div className="packRevealScrim" onClick={() => setUi("peek")} />}
          <div className="packRevealStage">
            <div className="packRevealAura" />
            {/* Stacking, back to front: floor shadow and lid (back) < the card < lower half, seam light and sphere shading (front). The same CSS variables move both. */}
            <div className="capsule capsuleBack" aria-hidden="true">
              <div className="capsuleShadow" />
            </div>
            {cardVisible && (
              <div className="packRevealCardSlot">
                <HoloCard key={run} controlRef={cardRef} imageUrl={imageUrl} backImageUrl={backImageUrl} title={title} foil={FOIL_BY_TIER[tier]} demo={demo} initialFace="back" interactive={phase === "done"} />
              </div>
            )}
            <div className="capsule capsuleFront" aria-hidden="true">
              <div className="capsuleBody">
                <div className="capsuleBase" />
                <div className="capsuleLid" />
                <div className="capsuleGlow" />
                <div className="capsuleMark" />
              </div>
              <div className="capsuleShade" />
            </div>
          </div>
        </div>
        <canvas ref={canvasRef} className="packRevealFx" />
        <canvas ref={flareRef} className="packRevealFlare" />
      </div>
      <div ref={whiteRef} className="packRevealWhite" />
      {phase === "facts" && ft.times.length > 0 && facts && (
        <>
          <div className="packRevealFactVeil" />
          <div className="packRevealBigFacts" aria-live="polite">
            {facts.slice(0, FACTS_MAX).map((f, i) => (
              <div key={`${run}-${i}`} className="packRevealBigFact" style={{ animationDelay: `${ft.times[i]}s`, "--len": Math.max(2, f.value.length) } as React.CSSProperties}>
                <span className="packRevealFactLabel">{f.label}</span>
                <span className="packRevealFactValue">{f.value}</span>
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
