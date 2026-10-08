"use client";

import * as THREE from "three";
import { RoomEnvironment } from "three/examples/jsm/environments/RoomEnvironment.js";
import { useCallback, useEffect, useRef, useState } from "react";
import { cameraRevealUi } from "../lib/copy/pull";
import { useI18n } from "../lib/i18n";
import { OrientationTracker } from "../lib/reveal/deviceOrientation";
import { buildCard, type CardRig } from "../lib/reveal/card";
import { Bolt } from "../lib/reveal/lightning";
import { clamp01, easeIn, easeOut, mulberry32, type Rand } from "../lib/reveal/math";
import { ParticleSys } from "../lib/reveal/particles";
import * as TX from "../lib/reveal/textures";
import { useCameraStream } from "../lib/reveal/useCameraStream";

export { requestOrientationPermission } from "../lib/reveal/deviceOrientation";

type Tier = 0 | 1 | 2 | 3;
type Phase = "ready" | "cutting" | "bloom" | "storm" | "done";

type Props = {
  tier: Tier;
  cardImageUrl?: string;
  cardTitle: string;
  demo: boolean;
  onClose: () => void;
};

/* ------------------------------------------------------------------ tuning values (metres unless noted) ------------------------------------------------------------------ */

const CFG = {
  fov: 60, // vertical field of view in degrees (iPhone back camera held upright is about 60)
  floorDrop: 1.2, // the floor is assumed this far below the camera (not detected)
  columnZ: 4.5, // the light column stands this far ahead of the reference direction
  packDist: 0.6, // distance of the hand-held pack from the camera
  packWidthRatio: 0.82, // pack width / screen width
  packTopRatio: 0.68, // pack top edge / screen height
  packMaxWidthPerH: 0.5,
  packThickness: 0.02,
  cardDist: 0.3, // about half the screen width for an upright phone (fov 60); closer and small hand turns push it off screen
  cardDrop: 0.03, // card sits this far below eye level
  // Life-size graded slab (about 81 x 136 x 7 mm).
  cardW: 0.081,
  cardH: 0.136,
  cardThickness: 0.007,
  boltDistMin: 1.5,
  boltDistMax: 6,
  boltTop: 7, // metres above the camera where bolts begin
  maxParticles: 800,
  maxEmbers: 260,
  emberRate: 45, // embers per second around the card
  dimMax: 1, // opacity of the room-dimming layer (its gradient averages about 0.55)
  cardDragYaw: 1.047, // +-60 degrees
  cardDragPitch: 0.61, // +-35 degrees
  maxDebris: 350,
  maxSparks: 100,
  autoCutAt: 0.75,
  autoCutSpeed: 1.6,
  recede: 0.5,
  bandRatio: 0.1,
};

/** bloom: seconds; column height/width (m); light strength; particles per second; pack tremble (m); small discharge. */
const BLOOM: Record<Tier, { dur: number; colH: number; colW: number; strength: number; rate: number; tremble: number; discharge: boolean }> = {
  0: { dur: 1.0, colH: 1.3, colW: 1.2, strength: 0.45, rate: 25, tremble: 0, discharge: false },
  1: { dur: 1.2, colH: 3, colW: 1.4, strength: 0.6, rate: 60, tremble: 0, discharge: false },
  2: { dur: 1.4, colH: 6, colW: 1.8, strength: 0.8, rate: 110, tremble: 0, discharge: false },
  3: { dur: 1.7, colH: 24, colW: 2.4, strength: 0.95, rate: 150, tremble: 0.004, discharge: true },
};

type Volley = { s: number; l: number; w: number; br: number; near?: boolean };
/** storm: seconds; volleys (start, length, width factor, branches); flashes (>= 0.5 s apart); video shake px; flash alpha; charge seconds; floor ring radius (0 = none). */
const STORM: Record<Tier, { dur: number; volleys: Volley[]; flashes: number[]; shake: number; flashAlpha: number; charge: number; ring: number; debris: number }> = {
  0: { dur: 0.6, volleys: [], flashes: [], shake: 0, flashAlpha: 0, charge: 0, ring: 0, debris: 0 },
  1: { dur: 1.2, volleys: [{ s: 0.1, l: 0.3, w: 2.5, br: 1 }, { s: 0.55, l: 0.3, w: 2.5, br: 0 }], flashes: [], shake: 6, flashAlpha: 0, charge: 0, ring: 0, debris: 0 },
  2: {
    dur: 1.8,
    volleys: [0.1, 0.3, 0.55, 0.8, 1.05].map((s) => ({ s, l: 0.28, w: 3.2, br: 3 })),
    flashes: [0.1, 0.7],
    shake: 12,
    flashAlpha: 0.45,
    charge: 0,
    ring: 2.4,
    debris: 0,
  },
  3: {
    dur: 2.4,
    volleys: [0.6, 0.6, 0.85, 0.85, 1.1, 1.1, 1.35, 1.35, 1.6, 1.6, 1.9].map((s, i) => ({ s, l: 0.3, w: i % 2 === 0 ? 14 : 8, br: 4, near: i % 3 === 0 })),
    flashes: [0.6, 1.2, 1.8],
    shake: 26,
    flashAlpha: 0.7,
    charge: 0.6,
    ring: 3.6,
    debris: 22,
  },
};

const BOLT_WIDTH_PER_UNIT = 0.012; // world width of a bolt core = volley.w * this
const BOLT_POOL = 12;

/* ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- */

function tierColor(tier: Tier, now: number, out: THREE.Color): THREE.Color {
  if (tier === 0) return out.setRGB(1, 0.98, 0.9);
  if (tier === 1) return out.setRGB(0.55, 0.82, 1);
  if (tier === 2) return out.setRGB(1, 0.8, 0.35);
  return out.setHSL(((now / 6) % 360) / 360, 1, 0.62);
}

const PACK_VERT = `varying vec2 vUv; void main(){ vUv = uv; gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0); }`;
const PACK_FRAG = `
uniform sampler2D map; uniform vec2 uTilt; uniform float uTime; varying vec2 vUv;
void main(){
  vec4 t = texture2D(map, vUv);
  float s = vUv.x * 1.3 + vUv.y * 0.7 + uTilt.x * 1.8 + uTilt.y * 1.2 + uTime * 0.05;
  float band = pow(sin(s * 9.0) * 0.5 + 0.5, 3.0);
  vec3 holo = 0.5 + 0.5 * cos(6.2831 * (s * 0.8 + vec3(0.0, 0.33, 0.67)));
  gl_FragColor = vec4(t.rgb + holo * band * 0.35, 1.0);
  #include <colorspace_fragment>
}`;

/**
 * 3D version of the camera opening effect: the pack is held in the camera, the effects stand in the room
 * (rotation-only tracking from the device orientation; the floor is assumed). Camera image is a <video> under a
 * transparent WebGL canvas.
 */
export function CameraReveal3D({ tier, cardImageUrl, cardTitle, demo, onClose }: Props) {
  const { t } = useI18n();
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const videoRef = useRef<HTMLVideoElement>(null);
  const flashRef = useRef<HTMLDivElement>(null);
  const darkRef = useRef<HTMLDivElement>(null);
  const glowRef = useRef<HTMLDivElement>(null);
  const dimRef = useRef<HTMLDivElement>(null);
  const dragRef = useRef({ dragging: false, x: 0, y: 0, yaw: 0, pitch: 0, vyaw: 0, vpitch: 0 });
  const hintRef = useRef<HTMLParagraphElement>(null);
  const phaseRef = useRef<Phase>("ready");
  const phaseStartRef = useRef(0);
  const tierRef = useRef<Tier>(tier);
  const cutRef = useRef({ progress: 0, dir: 1, dragging: false, auto: false, target: 0, startX: 0, startY: 0, moved: 0 });
  const resetRef = useRef<() => void>(() => undefined);
  const cardUrlRef = useRef(cardImageUrl);
  const [phase, setPhase] = useState<Phase>("ready");
  const [webglFailed, setWebglFailed] = useState(false);
  const [orientFallback, setOrientFallback] = useState(false);
  const camera = useCameraStream(videoRef);

  useEffect(() => {
    tierRef.current = tier;
    cardUrlRef.current = cardImageUrl;
  }, [tier, cardImageUrl]);

  const go = useCallback((next: Phase) => {
    phaseRef.current = next;
    phaseStartRef.current = performance.now();
    setPhase(next);
  }, []);

  const handleClose = useCallback(() => {
    camera.stop();
    onClose();
  }, [camera, onClose]);

  const restart = useCallback(() => {
    cutRef.current = { progress: 0, dir: 1, dragging: false, auto: false, target: 0, startX: 0, startY: 0, moved: 0 };
    dragRef.current = { dragging: false, x: 0, y: 0, yaw: 0, pitch: 0, vyaw: 0, vpitch: 0 };
    resetRef.current();
    go("ready");
  }, [go]);

  useEffect(() => {
    phaseStartRef.current = performance.now();
    const canvas = canvasRef.current;
    const video = videoRef.current;
    if (!canvas || !video) return;

    const disposables: { dispose(): void }[] = [];
    const track = <T extends { dispose(): void }>(x: T): T => {
      disposables.push(x);
      return x;
    };

    let renderer: THREE.WebGLRenderer;
    try {
      renderer = new THREE.WebGLRenderer({ canvas, alpha: true, antialias: true, powerPreference: "high-performance" });
    } catch {
      // Deferred: this effect only reports that 3D is unavailable.
      const timer = window.setTimeout(() => setWebglFailed(true), 0);
      return () => window.clearTimeout(timer);
    }
    renderer.setClearColor(0x000000, 0);
    track(renderer);

    const motionQuery = window.matchMedia("(prefers-reduced-motion: reduce)");
    let reduced = motionQuery.matches;
    const onMotion = () => {
      reduced = motionQuery.matches;
    };
    motionQuery.addEventListener("change", onMotion);

    const tracker = new OrientationTracker();
    tracker.start();
    const fbTimer = window.setTimeout(() => {
      if (tracker.isFallback(0)) setOrientFallback(true);
    }, 2000);

    const scene = new THREE.Scene();
    const cam = new THREE.PerspectiveCamera(CFG.fov, 1, 0.05, 60);
    scene.add(cam);

    // textures
    const glowTex = track(TX.glowTexture());
    const ringTex = track(TX.ringTexture());
    const columnTex = track(TX.columnTexture());
    const stripeTex = track(TX.stripeTexture());
    const debrisTex = track(TX.debrisTexture());
    const packTex = track(TX.packTexture());
    const sealTex = track(TX.sealTexture());

    const additive = (map: THREE.Texture, color = 0xffffff) =>
      track(new THREE.MeshBasicMaterial({ map, color, transparent: true, blending: THREE.AdditiveBlending, depthWrite: false, depthTest: false, opacity: 0 }));
    const planeGeo = track(new THREE.PlaneGeometry(1, 1));
    const boxGeo = track(new THREE.BoxGeometry(1, 1, 1));
    const baseColumnGeo = new THREE.PlaneGeometry(1, 1);
    baseColumnGeo.translate(0, 0.5, 0); // anchored at the bottom
    track(baseColumnGeo);

    /* ---------- hand-held pack (child of the camera) ---------- */
    const pivot = new THREE.Group();
    cam.add(pivot);
    const packMat = track(new THREE.ShaderMaterial({ uniforms: { map: { value: packTex }, uTilt: { value: new THREE.Vector2() }, uTime: { value: 0 } }, vertexShader: PACK_VERT, fragmentShader: PACK_FRAG }));
    const darkSide = track(new THREE.MeshBasicMaterial({ color: 0x232f7a }));
    const darkBack = track(new THREE.MeshBasicMaterial({ color: 0x151d52 }));
    const body = new THREE.Mesh(boxGeo, [darkSide, darkSide, darkSide, darkSide, packMat, darkBack]);
    pivot.add(body);
    const sealFront = track(new THREE.MeshBasicMaterial({ map: sealTex, alphaTest: 0.5 }));
    const sealSide = track(new THREE.MeshBasicMaterial({ color: 0xaab3cc }));
    const seal = new THREE.Mesh(boxGeo, [sealSide, sealSide, sealSide, sealSide, sealFront, sealSide]);
    pivot.add(seal);
    const shadow = new THREE.Mesh(planeGeo, track(new THREE.MeshBasicMaterial({ map: glowTex, color: 0x000000, transparent: true, opacity: 0.4, depthWrite: false, depthTest: false })));
    shadow.renderOrder = -1;
    pivot.add(shadow);

    const cutLine = new THREE.Mesh(planeGeo, additive(glowTex, 0xffe9a0));
    const cutBand = new THREE.Mesh(planeGeo, additive(glowTex, 0xffffff));
    const cutHead = new THREE.Sprite(track(new THREE.SpriteMaterial({ map: glowTex, color: 0xfff1c0, transparent: true, blending: THREE.AdditiveBlending, depthWrite: false, depthTest: false })));
    const dots = [0, 1, 2].map(() => new THREE.Sprite(track(new THREE.SpriteMaterial({ map: glowTex, color: 0xfff1c0, transparent: true, blending: THREE.AdditiveBlending, depthWrite: false, depthTest: false }))));
    for (const o of [cutLine, cutBand, cutHead, ...dots]) {
      o.renderOrder = 3;
      pivot.add(o);
    }
    const sparks = new ParticleSys(CFG.maxSparks, glowTex, 0.006, track);
    sparks.points.renderOrder = 4;
    pivot.add(sparks.points);

    /* ---------- the room (world fixed) ---------- */
    const colMat = additive(columnTex);
    const columnGroup = new THREE.Group();
    columnGroup.position.set(0, -CFG.floorDrop, -CFG.columnZ);
    for (const ry of [0, Math.PI / 2]) {
      const m = new THREE.Mesh(baseColumnGeo, colMat);
      m.rotation.y = ry;
      m.renderOrder = 2;
      columnGroup.add(m);
    }
    scene.add(columnGroup);
    const floorMat = additive(ringTex);
    const floorRing = new THREE.Mesh(planeGeo, floorMat);
    floorRing.rotation.x = -Math.PI / 2;
    floorRing.position.set(0, -CFG.floorDrop + 0.01, -CFG.columnZ);
    floorRing.renderOrder = 1;
    scene.add(floorRing);

    const bolts: Bolt[] = [];
    for (let i = 0; i < BOLT_POOL + 3; i++) {
      const b = new Bolt(stripeTex, track);
      bolts.push(b);
      scene.add(b.group);
    }
    type Impact = { ring: THREE.Mesh; stain: THREE.Mesh; t0: number; active: boolean; radius: number };
    const impacts: Impact[] = [];
    for (let i = 0; i < BOLT_POOL; i++) {
      const ring = new THREE.Mesh(planeGeo, additive(ringTex));
      const stain = new THREE.Mesh(planeGeo, additive(glowTex));
      for (const m of [ring, stain]) {
        m.rotation.x = -Math.PI / 2;
        m.visible = false;
        m.renderOrder = 1;
        scene.add(m);
      }
      impacts.push({ ring, stain, t0: 0, active: false, radius: 1 });
    }
    const particles = new ParticleSys(CFG.maxParticles, glowTex, 0.03, track);
    const debris = new ParticleSys(CFG.maxDebris, debrisTex, 0.03, track);
    particles.points.renderOrder = 4;
    debris.points.renderOrder = 4;
    scene.add(particles.points, debris.points);

    // room lighting for the card only (the other objects are unlit/additive): environment map + a warm key and a cool rim light
    const pmrem = new THREE.PMREMGenerator(renderer);
    const roomEnv = new RoomEnvironment();
    const envTex = pmrem.fromScene(roomEnv, 0.04).texture;
    scene.environment = envTex;
    scene.environmentIntensity = 0.8;
    // Filmic roll-off so metal highlights do not clip to flat white.
    renderer.toneMapping = THREE.ACESFilmicToneMapping;
    renderer.toneMappingExposure = 1.05;
    const keyLight = new THREE.PointLight(0xffc88a, 0, 0, 2);
    const rimLight = new THREE.PointLight(0x7fa8ff, 0, 0, 2);
    scene.add(keyLight, rimLight);

    // card: embossed metal frame + holographic art + clear case, fixed in the room in front of the reference direction
    const rig: CardRig = buildCard(tierRef.current, { w: CFG.cardW, h: CFG.cardH, t: CFG.cardThickness }, glowTex, track);
    const cardGroup = rig.group;
    cardGroup.visible = false;
    scene.add(cardGroup);
    const cardGlow = rig.halo;
    const embers = new ParticleSys(CFG.maxEmbers, glowTex, 0.004, track);
    embers.points.renderOrder = 4;
    scene.add(embers.points);

    // card image, loaded at runtime (crossOrigin set); the placeholder art stays if it fails
    let imageDisposed = false;
    if (cardUrlRef.current) {
      const loader = new THREE.ImageLoader();
      loader.setCrossOrigin("anonymous");
      loader.load(
        cardUrlRef.current,
        (img) => {
          if (!imageDisposed) rig.setImage(img);
        },
        undefined,
        () => undefined,
      );
    }

    /* ---------- state ---------- */
    const tmpColor = new THREE.Color();
    const euler = new THREE.Euler();
    const refQ = new THREE.Quaternion();
    const camQ = new THREE.Quaternion();
    const lagQ = new THREE.Quaternion();
    const relQ = new THREE.Quaternion();
    const packQ = new THREE.Quaternion();
    const lean = new THREE.Quaternion().setFromEuler(new THREE.Euler(-0.12, 0, 0));
    const identity = new THREE.Quaternion();
    const UP = new THREE.Vector3(0, 1, 0);
    let refYaw = 0;
    let seenStart = -1;
    let stormIdx = 0;
    let bloomAcc = 0;
    let sealStart = 0;
    let sealDir = 1;
    let frameNo = 0;
    let emberAcc = 0;
    let last = performance.now();
    let sizeKey = "";
    let L = { pw: 1, left: 0, top: 0, ycut: 0, bodyH: 1, stripH: 1, centerPx: 0, u: 0.001, W: 1, H: 1 };

    const volumePoint = (rand: Rand, out: THREE.Vector3) => {
      const az = (rand() - 0.5) * 2.4;
      const el = (rand() - 0.35) * 1.6;
      const r = 0.3 + 4.7 * Math.pow(rand(), 1.3);
      out.set(r * Math.cos(el) * Math.sin(az), r * Math.sin(el), -r * Math.cos(el) * Math.cos(az));
    };
    const P = new THREE.Vector3();

    resetRef.current = () => {
      particles.clear();
      embers.clear();
      debris.clear();
      sparks.clear();
      for (const b of bolts) b.group.visible = false;
      for (const im of impacts) {
        im.active = false;
        im.ring.visible = false;
        im.stain.visible = false;
      }
      cardGroup.visible = false;
      colMat.opacity = 0;
      floorMat.opacity = 0;
    };

    const frame = (now: number) => {
      raf = requestAnimationFrame(frame);
      const dt = Math.min(0.05, (now - last) / 1000);
      last = now;
      frameNo++;
      const W = canvas.clientWidth;
      const H = canvas.clientHeight;
      if (W === 0 || H === 0) return;
      const tr = tierRef.current;
      const bl = BLOOM[tr];
      const sc = STORM[tr];
      let phaseNow = phaseRef.current;
      const pt = (now - phaseStartRef.current) / 1000;
      const rand: Rand = reduced ? mulberry32(11) : Math.random;

      // ---- size and layout ----
      const key = `${W}x${H}`;
      if (key !== sizeKey) {
        sizeKey = key;
        const dpr = Math.min(2, window.devicePixelRatio || 1);
        renderer.setPixelRatio(dpr);
        renderer.setSize(W, H, false);
        cam.aspect = W / H;
        cam.updateProjectionMatrix();
        const pw = Math.min(W * CFG.packWidthRatio, H * CFG.packMaxWidthPerH);
        const top = H * CFG.packTopRatio;
        const sb = pw * 0.13;
        const ycut = top + sb + pw * 0.03;
        const stripH = ycut - top;
        const bodyH = pw * 1.7 - stripH;
        const u = (2 * CFG.packDist * Math.tan((CFG.fov / 2) * (Math.PI / 180))) / H;
        L = { pw, left: (W - pw) / 2, top, ycut, bodyH, stripH, centerPx: ycut + bodyH / 2, u, W, H };
        pivot.position.set(0, (H / 2 - L.centerPx) * u, -CFG.packDist);
        body.scale.set(pw * u, bodyH * u, CFG.packThickness);
        seal.scale.set(pw * u, stripH * u, CFG.packThickness * 1.1);
        seal.position.set(0, ((bodyH + stripH) / 2) * u, 0);
        shadow.scale.set(pw * u * 1.25, bodyH * u * 0.9, 1);
        shadow.position.set(0, -0.03, -0.02);
        cutLine.position.set(0, (bodyH / 2) * u, 0.012);
        cutBand.position.set(0, (bodyH / 2) * u, 0.011);
      }
      const u = L.u;
      const px2x = (px: number) => (px - W / 2) * u;
      const yCutLocal = (L.bodyH / 2) * u;

      // ---- camera rotation: device orientation relative to the direction at the moment the cut finished ----
      tracker.update(dt, now, reduced);
      const q = tracker.quaternion;
      euler.setFromQuaternion(q, "YXZ");
      if (phaseNow === "ready" || phaseNow === "cutting") refYaw = euler.y;
      refQ.setFromAxisAngle(UP, refYaw).invert();
      camQ.copy(refQ).multiply(q);
      cam.quaternion.copy(camQ);
      // the pack lags behind the hand a little (it tilts as the phone moves)
      lagQ.slerp(camQ, 1 - Math.exp(-dt * 3));
      relQ.copy(camQ).invert().multiply(lagQ);
      packQ.copy(identity).slerp(relQ, 0.7).multiply(lean);
      pivot.quaternion.copy(packQ);
      euler.setFromQuaternion(camQ, "YXZ");
      packMat.uniforms.uTilt.value.set(euler.z + Math.sin(now / 1500) * 0.1, euler.x);
      packMat.uniforms.uTime.value = now / 1000;

      if (phaseStartRef.current !== seenStart) {
        seenStart = phaseStartRef.current;
        stormIdx = 0;
        bloomAcc = 0;
      }

      // ---- cut progress ----
      const cut = cutRef.current;
      if (phaseNow === "ready" || phaseNow === "cutting") {
        const before = cut.progress;
        if (cut.auto) cut.progress += dt * CFG.autoCutSpeed;
        else if (cut.dragging) cut.progress += (cut.target - cut.progress) * Math.min(1, dt * 30);
        else cut.progress = Math.max(0, cut.progress - dt * CFG.recede);
        if (cut.dragging && !cut.auto && cut.progress >= CFG.autoCutAt) cut.auto = true;
        cut.progress = clamp01(cut.progress);
        if (cut.progress > 0 && phaseNow === "ready") {
          go("cutting");
          phaseNow = "cutting";
        } else if (cut.progress === 0 && phaseNow === "cutting" && !cut.dragging && !cut.auto) {
          go("ready");
          phaseNow = "ready";
        }
        if (Math.abs(cut.progress - before) > 0.001 && cut.progress > 0) {
          const hx = cut.dir > 0 ? L.left + L.pw * cut.progress : L.left + L.pw * (1 - cut.progress);
          for (let i = 0; i < 3; i++) sparks.spawn(px2x(hx), yCutLocal, 0.015, (rand() - 0.5) * 0.25, 0.03 + rand() * 0.2, 0, 0.3 + rand() * 0.3, 1, 0.9 + rand() * 0.1, 0.6, 0.8);
        }
        if (cut.progress >= 1) {
          sealStart = now;
          sealDir = cut.dir;
          go("bloom");
          phaseNow = "bloom";
        }
      }
      sparks.update(dt, reduced);

      const st = phaseNow === "storm" ? pt : phaseNow === "done" ? 99 : -1;
      const sealGone = phaseNow === "bloom" || phaseNow === "storm" || phaseNow === "done";

      // ---- pack, seal, cut effects ----
      const floating = phaseNow === "ready" || phaseNow === "cutting";
      const float = reduced || !floating ? 0 : Math.sin(now / 900) * 0.004;
      const trem = phaseNow === "bloom" && !reduced ? bl.tremble : 0;
      const baseY = (H / 2 - L.centerPx) * u;
      let slide = 0;
      if (phaseNow === "done") slide = easeIn(pt / 0.7) * H * 0.4 * u;
      pivot.position.y = baseY + float - slide + (trem ? (rand() - 0.5) * 2 * trem : 0);
      pivot.position.x = trem ? (rand() - 0.5) * 2 * trem : 0;
      pivot.visible = !(phaseNow === "done" && pt > 0.7);
      const sealBaseY = ((L.bodyH + L.stripH) / 2) * u;
      if (!sealGone) {
        seal.visible = true;
        seal.position.set(0, sealBaseY, 0);
        seal.rotation.set(0, 0, 0);
      } else if (phaseNow === "bloom" && (now - sealStart) / 1000 < 0.8) {
        const e = (now - sealStart) / 1000;
        const k = easeOut(e / 0.8);
        seal.visible = true;
        seal.position.set(sealDir * k * W * 0.15 * u, sealBaseY + k * H * 0.4 * u, k * 0.15);
        seal.rotation.set(k * 2.5, k * 3, sealDir * k * 5);
      } else {
        seal.visible = false;
      }
      // dotted cut line is part of the body texture; the glowing cut grows over it
      const showCut = (phaseNow === "ready" || phaseNow === "cutting") && cut.progress > 0;
      cutLine.visible = showCut;
      cutHead.visible = showCut;
      if (showCut) {
        const x0 = cut.dir > 0 ? L.left : L.left + L.pw;
        const x1 = cut.dir > 0 ? L.left + L.pw * cut.progress : L.left + L.pw * (1 - cut.progress);
        cutLine.position.x = px2x((x0 + x1) / 2);
        cutLine.scale.set(Math.abs(x1 - x0) * u, 7 * u, 1);
        (cutLine.material as THREE.MeshBasicMaterial).opacity = 1;
        cutHead.position.set(px2x(x1), yCutLocal, 0.014);
        cutHead.scale.set(70 * u, 70 * u, 1);
      }
      // finger hint
      const hintOn = phaseNow === "ready";
      dots.forEach((d, i) => {
        d.visible = hintOn;
        const tri = reduced ? 0.5 : Math.abs((((now - i * 70) / 1400) % 2) - 1);
        d.position.set(px2x(L.left + L.pw * (0.08 + 0.84 * tri)), yCutLocal, 0.014);
        d.scale.setScalar((30 - i * 7) * u);
      });
      if (hintRef.current) {
        hintRef.current.style.top = `${L.ycut + 14}px`;
        hintRef.current.style.opacity = hintOn ? "1" : "0";
      }
      // soft band along the cut while blooming
      const bandOn = phaseNow === "bloom";
      cutBand.visible = bandOn;
      if (bandOn) {
        const p = clamp01(pt / bl.dur);
        cutBand.scale.set(L.pw * 1.3 * u, (40 + 180 * easeOut(p)) * u, 1);
        tierColor(tr, now, tmpColor);
        const m = cutBand.material as THREE.MeshBasicMaterial;
        m.color.copy(tmpColor);
        m.opacity = bl.strength * Math.sin(Math.PI * Math.min(1, p * 0.9 + 0.1)) * 0.9;
      }

      // ---- emission (bloom) ----
      if (phaseNow === "bloom") {
        bloomAcc += bl.rate * dt;
        while (bloomAcc >= 1) {
          bloomAcc -= 1;
          volumePoint(rand, P);
          tierColor(tr, now + rand() * 900, tmpColor);
          particles.spawn(P.x, P.y, P.z, (rand() - 0.5) * 0.2, 0.15 + rand() * 0.45, (rand() - 0.5) * 0.2, 2.5 + rand() * 1.5, tmpColor.r * 0.9, tmpColor.g * 0.9, tmpColor.b * 0.9);
        }
      }

      // ---- column and floor ring ----
      const colOn = phaseNow === "bloom" || phaseNow === "storm" || (phaseNow === "done" && pt < 1.2);
      columnGroup.visible = colOn;
      floorRing.visible = colOn;
      if (colOn) {
        const p = phaseNow === "bloom" ? easeOut(pt / bl.dur) : 1;
        const fade = phaseNow === "storm" ? Math.max(0.35, 1 - st / sc.dur) : phaseNow === "done" ? Math.max(0, 0.35 * (1 - pt / 1.2)) : 1;
        columnGroup.scale.set(bl.colW, Math.max(0.01, bl.colH * p), bl.colW);
        tierColor(tr, now, tmpColor);
        colMat.color.copy(tmpColor);
        colMat.opacity = bl.strength * p * fade;
        floorRing.scale.set(bl.colW * 2.4, bl.colW * 2.4, 1);
        floorMat.color.copy(tmpColor);
        floorMat.opacity = bl.strength * 0.7 * p * fade;
      }

      // ---- bloom discharge (tier 3): thin bolts at the base of the column ----
      for (let i = 0; i < 3; i++) {
        const b = bolts[BOLT_POOL + i];
        const on = phaseNow === "bloom" && bl.discharge && !reduced;
        b.group.visible = on;
        if (!on) continue;
        if (frameNo - b.lastShape >= 3) {
          b.lastShape = frameNo;
          const sx = (rand() - 0.5) * 1.6;
          const from = new THREE.Vector3(sx, -CFG.floorDrop, -CFG.columnZ + (rand() - 0.5));
          b.reshape(rand, from, from.clone().add(new THREE.Vector3((rand() - 0.5) * 1.2, 0.7 + rand() * 1.5, (rand() - 0.5) * 0.8)), 0);
        }
        tierColor(3, now, tmpColor);
        b.outerMat.color.copy(tmpColor);
        b.coreMat.color.set(0xffffff);
        b.outerMat.opacity = 0.8;
        b.coreMat.opacity = 1;
        b.build(0.02);
      }

      // ---- storm ----
      let shake = 0;
      if (phaseNow === "storm") {
        if (tr === 0 && stormIdx === 0) {
          stormIdx = 1;
          for (let i = 0; i < 160; i++) {
            volumePoint(rand, P);
            particles.spawn(P.x, P.y, P.z, P.x * 0.25, P.y * 0.15 + 0.1, P.z * 0.25, 1.5 + rand(), 1, 0.98, 0.92);
          }
        }
        // new strikes
        while (stormIdx - (tr === 0 ? 1 : 0) < sc.volleys.length && st >= sc.volleys[stormIdx - (tr === 0 ? 1 : 0)].s) {
          const i = stormIdx - (tr === 0 ? 1 : 0);
          stormIdx++;
          const r = mulberry32(i * 7919 + 13);
          const az = (r() - 0.5) * 1.5;
          const dist = sc.volleys[i].near ? 1.2 + 1.8 * Math.sqrt(r()) : CFG.boltDistMin + (CFG.boltDistMax - CFG.boltDistMin) * Math.sqrt(r());
          const g = new THREE.Vector3(dist * Math.sin(az), -CFG.floorDrop, -dist * Math.cos(az));
          const top = new THREE.Vector3(g.x * 1.15 + (r() - 0.5) * 1.5, CFG.boltTop + r() * 3, g.z * 1.15);
          const b = bolts[i % BOLT_POOL];
          b.strands = [];
          b.lastShape = -999;
          b.ground.copy(g);
          b.topPt.copy(top);
          b.dist = dist;
          b.armed = true;
          // floor impact
          const im = impacts[i % BOLT_POOL];
          im.active = true;
          im.t0 = now;
          im.radius = sc.ring || 1;
          im.ring.position.set(g.x, g.y + 0.01, g.z);
          im.stain.position.set(g.x, g.y + 0.012, g.z);
          im.ring.visible = sc.ring > 0;
          im.stain.visible = true;
          const nDebris = sc.debris;
          for (let k = 0; k < nDebris; k++) {
            const a = rand() * Math.PI * 2;
            const sp = 0.8 + rand() * 2.6;
            tierColor(3, now + k * 40, tmpColor);
            debris.spawn(g.x, g.y + 0.05, g.z, Math.cos(a) * sp, 1.5 + rand() * 2.5, Math.sin(a) * sp, 0.8 + rand() * 0.8, tmpColor.r, tmpColor.g, tmpColor.b, 7);
          }
          if (tr === 2) {
            for (let k = 0; k < 14; k++) {
              const a = rand() * Math.PI * 2;
              const sp = 0.5 + rand() * 1.8;
              particles.spawn(g.x, g.y + 0.05, g.z, Math.cos(a) * sp, 0.8 + rand() * 1.8, Math.sin(a) * sp, 0.5 + rand() * 0.4, 1, 0.9, 0.55, 5);
            }
          }
        }
        // bolts
        sc.volleys.forEach((v, i) => {
          const b = bolts[i % BOLT_POOL];
          const active = st >= v.s && st <= v.s + v.l && b.armed;
          b.group.visible = active;
          if (!active) return;
          if (b.lastShape < 0 || (!reduced && frameNo - b.lastShape >= 3)) {
            b.lastShape = frameNo;
            b.reshape(reduced ? mulberry32(i + 5) : Math.random, b.topPt, b.ground, v.br);
          }
          const flick = reduced ? 0.5 : Math.floor(st * 40) % 4 === 3 ? 0.4 : 1;
          const far = clamp01(1.25 - b.dist / 8);
          tierColor(tr, now + i * 300, tmpColor);
          b.outerMat.color.copy(tmpColor);
          b.coreMat.color.set(tr === 3 ? 0xfff3b0 : 0xffffff);
          b.outerMat.opacity = Math.max(0.35, far) * 0.9 * flick;
          b.coreMat.opacity = Math.max(0.4, far) * flick;
          b.build(v.w * BOLT_WIDTH_PER_UNIT);
        });
        if (!reduced) {
          for (const v of sc.volleys) if (st >= v.s) shake += sc.shake * Math.exp(-(st - v.s) / 0.25);
          shake = Math.min(shake, sc.shake * 1.5);
        }
      } else {
        for (let i = 0; i < BOLT_POOL; i++) {
          bolts[i].group.visible = false;
          bolts[i].armed = false;
        }
      }

      // floor impacts: ring and stain (flat on the floor, so they read as ellipses)
      for (const im of impacts) {
        if (!im.active) continue;
        const e = (now - im.t0) / 1000;
        if (e > 1.4) {
          im.active = false;
          im.ring.visible = false;
          im.stain.visible = false;
          continue;
        }
        const ringMat = im.ring.material as THREE.MeshBasicMaterial;
        const stainMat = im.stain.material as THREE.MeshBasicMaterial;
        const rk = clamp01(e / 0.8);
        const rr = 0.3 + (im.radius - 0.3) * easeOut(rk);
        im.ring.scale.set(rr * 2, rr * 2, 1);
        tierColor(tr, now, tmpColor);
        ringMat.color.copy(tmpColor);
        ringMat.opacity = reduced ? 0.3 : (1 - rk) * 0.9;
        const sr = (tr === 3 ? 1.6 : 1) * (0.8 + 0.8 * clamp01(e / 0.4));
        im.stain.scale.set(sr * 2, sr * 2, 1);
        stainMat.color.copy(tmpColor);
        stainMat.opacity = Math.max(0, 1 - e / 1.3) * 0.8;
      }

      particles.update(dt, reduced);
      debris.update(dt, reduced);

      // ---- card (done) ----
      if (phaseNow === "done") {
        const k = easeOut(pt / 1.1);
        cardGroup.visible = true;
        const settled = pt >= 1.1;
        const wob = reduced || !settled ? 0 : Math.sin(pt * 1.2) * 0.003;
        cardGroup.position.set(0, -CFG.cardDrop - (1 - k) * 0.18 + wob, -CFG.cardDist - (1 - k) * 0.12);
        // drag rotation with inertia; it eases back to face the viewer when released
        const dr = dragRef.current;
        if (!dr.dragging) {
          dr.yaw += dr.vyaw * dt;
          dr.pitch += dr.vpitch * dt;
          const damp = Math.exp(-dt * 3);
          dr.vyaw *= damp;
          dr.vpitch *= damp;
          const back = Math.exp(-dt * 0.9);
          dr.yaw *= back;
          dr.pitch *= back;
        }
        dr.yaw = Math.max(-CFG.cardDragYaw, Math.min(CFG.cardDragYaw, dr.yaw));
        dr.pitch = Math.max(-CFG.cardDragPitch, Math.min(CFG.cardDragPitch, dr.pitch));
        const spin = reduced ? 0 : Math.PI * (1 - easeOut(pt / 1.1));
        const idleY = settled && !reduced ? Math.sin(pt * 0.7) * 0.06 : 0;
        const idleX = settled && !reduced ? Math.sin(pt * 0.9) * 0.025 : 0;
        cardGroup.rotation.set(idleX + dr.pitch, spin + idleY + dr.yaw, 0);
        cardGroup.scale.setScalar(0.6 + 0.4 * k);
        // lights: the key light slides with the phone's tilt (with time when there are no sensors), so highlights run over the frame
        const tiltX = tracker.active ? Math.max(-1, Math.min(1, euler.z * 1.5)) : Math.sin(now / 1800);
        const tiltY = tracker.active ? Math.max(-1, Math.min(1, euler.x * 1.5)) : Math.cos(now / 2300);
        keyLight.position.set(tiltX * 0.12, -CFG.cardDrop + 0.04 + tiltY * 0.08, -CFG.cardDist + 0.12);
        rimLight.position.set(-tiltX * 0.1 - 0.1, -CFG.cardDrop - 0.05, -CFG.cardDist - 0.08);
        keyLight.intensity = 0.14 * k;
        rimLight.intensity = 0.12 * k;
        rig.setTime(now / 1000);
        const hm = cardGlow.material as THREE.SpriteMaterial;
        hm.opacity = 0.45 * clamp01(pt / 0.8);
        hm.color.copy(tierColor(tr, now, tmpColor));
        // embers rising around the card
        emberAcc += CFG.emberRate * dt;
        while (emberAcc >= 1) {
          emberAcc -= 1;
          const rainbow = tr === 3 && rand() < 0.5;
          if (rainbow) tmpColor.setHSL(rand(), 1, 0.65);
          else if (tr === 2 || tr === 3) tmpColor.setRGB(1, 0.78, 0.35);
          else tmpColor.setRGB(0.8, 0.9, 1);
          embers.spawn((rand() - 0.5) * 0.22, -CFG.cardDrop - 0.1 + rand() * 0.04, -CFG.cardDist + (rand() - 0.5) * 0.25, (rand() - 0.5) * 0.02, 0.03 + rand() * 0.05, (rand() - 0.5) * 0.02, 3 + rand() * 2, tmpColor.r, tmpColor.g, tmpColor.b);
        }
      } else {
        cardGroup.visible = false;
        keyLight.intensity = 0;
        rimLight.intensity = 0;
        emberAcc = 0;
      }
      embers.update(dt, reduced);

      // dim the room from the middle of the bloom on (steady, so it is also used with reduced motion)
      let dim = 0;
      if (phaseNow === "bloom") dim = clamp01((pt / bl.dur - 0.3) / 0.7) * CFG.dimMax;
      else if (phaseNow === "storm" || phaseNow === "done") dim = CFG.dimMax;
      if (dimRef.current) dimRef.current.style.opacity = String(dim);

      // ---- screen effects (DOM): video shake, flash, charge dark, edge glow ----
      const sc2 = 1 + (2.2 * shake) / Math.min(W, H);
      video.style.transform = shake > 0.1 ? `translate(${(rand() - 0.5) * 2 * shake}px, ${(rand() - 0.5) * 2 * shake}px) scale(${sc2})` : "";
      let fl = 0;
      if (phaseNow === "storm" && !reduced) {
        for (const ft of sc.flashes) {
          const e = st - ft;
          if (e >= 0 && e < 0.25) fl = Math.max(fl, sc.flashAlpha * (1 - e / 0.25));
        }
      }
      if (flashRef.current) flashRef.current.style.opacity = String(fl);
      let dark = 0;
      if (phaseNow === "storm" && tr === 3 && st < sc.charge && !reduced) dark = Math.sin(clamp01(st / sc.charge) * Math.PI) * 0.55;
      if (darkRef.current) darkRef.current.style.opacity = String(dark);
      let edge = 0;
      if (phaseNow === "storm") edge = tr === 2 ? Math.max(0, 1 - st / sc.dur) * 0.9 : tr === 3 && st > sc.charge ? Math.exp(-(st - sc.charge) / 1.1) * 0.8 : 0;
      if (glowRef.current) {
        glowRef.current.style.opacity = String(edge);
        if (tr === 3) glowRef.current.style.setProperty("--edge", `hsl(${(now / 6) % 360} 100% 60%)`);
        else glowRef.current.style.setProperty("--edge", tr === 2 ? "#ffc850" : "#8fd3ff");
      }

      renderer.render(scene, cam);

      if (phaseNow === "bloom" && pt >= bl.dur) go("storm");
      else if (phaseNow === "storm" && pt >= sc.dur) go("done");
    };
    let raf = requestAnimationFrame(frame);

    return () => {
      cancelAnimationFrame(raf);
      window.clearTimeout(fbTimer);
      motionQuery.removeEventListener("change", onMotion);
      tracker.stop();
      imageDisposed = true;
      rig.dispose();
      envTex.dispose();
      roomEnv.dispose();
      pmrem.dispose();
      scene.environment = null;
      for (const d of disposables) d.dispose();
      // No forceContextLoss(): the canvas is reused when React StrictMode remounts in dev, and a lost context cannot be re-created on it.
      renderer.dispose();
      resetRef.current = () => undefined;
      video.style.transform = "";
    };
  }, [go]);

  // Pointer: drag across the cut line; a plain tap on the pack cuts it automatically (same controls as the 2D version).
  const layout = (rect: DOMRect) => {
    const pw = Math.min(rect.width * CFG.packWidthRatio, rect.height * CFG.packMaxWidthPerH);
    const top = rect.height * CFG.packTopRatio;
    return { pw, left: (rect.width - pw) / 2, top, ycut: top + pw * 0.16 };
  };
  const onPointerDown = (e: React.PointerEvent<HTMLCanvasElement>) => {
    const ph = phaseRef.current;
    if (ph === "done") {
      const dr = dragRef.current;
      dr.dragging = true;
      dr.x = e.clientX;
      dr.y = e.clientY;
      dr.vyaw = 0;
      dr.vpitch = 0;
      e.currentTarget.setPointerCapture(e.pointerId);
      return;
    }
    if (ph !== "ready" && ph !== "cutting") return;
    const rect = e.currentTarget.getBoundingClientRect();
    const x = e.clientX - rect.left;
    const y = e.clientY - rect.top;
    const L = layout(rect);
    const cut = cutRef.current;
    cut.startX = x;
    cut.startY = y;
    cut.moved = 0;
    if (Math.abs(y - L.ycut) > Math.max(60, rect.height * CFG.bandRatio) || x < L.left - 30 || x > L.left + L.pw + 30) return;
    if (!cut.auto) {
      cut.dir = x < rect.width / 2 ? 1 : -1;
      cut.dragging = true;
      cut.target = clamp01(cut.dir > 0 ? (x - L.left) / L.pw : (L.left + L.pw - x) / L.pw);
      e.currentTarget.setPointerCapture(e.pointerId);
    }
  };
  const onPointerMove = (e: React.PointerEvent<HTMLCanvasElement>) => {
    const dr = dragRef.current;
    if (dr.dragging) {
      const dx = e.clientX - dr.x;
      const dy = e.clientY - dr.y;
      dr.x = e.clientX;
      dr.y = e.clientY;
      dr.yaw = Math.max(-CFG.cardDragYaw, Math.min(CFG.cardDragYaw, dr.yaw + dx * 0.01));
      dr.pitch = Math.max(-CFG.cardDragPitch, Math.min(CFG.cardDragPitch, dr.pitch + dy * 0.008));
      dr.vyaw = dx * 0.6;
      dr.vpitch = dy * 0.5;
      return;
    }
    const cut = cutRef.current;
    if (!cut.dragging) return;
    const rect = e.currentTarget.getBoundingClientRect();
    const L = layout(rect);
    const x = e.clientX - rect.left;
    cut.moved = Math.max(cut.moved, Math.hypot(x - cut.startX, e.clientY - rect.top - cut.startY));
    cut.target = clamp01(cut.dir > 0 ? (x - L.left) / L.pw : (L.left + L.pw - x) / L.pw);
  };
  const onPointerUp = (e: React.PointerEvent<HTMLCanvasElement>) => {
    if (dragRef.current.dragging) {
      dragRef.current.dragging = false;
      return;
    }
    const cut = cutRef.current;
    const ph = phaseRef.current;
    const wasDragging = cut.dragging;
    cut.dragging = false;
    if (ph !== "ready" && ph !== "cutting") return;
    const rect = e.currentTarget.getBoundingClientRect();
    const L = layout(rect);
    const y = e.clientY - rect.top;
    if (cut.moved < 12 && y > L.top - 20 && !cut.auto) {
      if (wasDragging) cut.dir = cut.startX < rect.width / 2 ? 1 : -1;
      cut.auto = true;
    }
  };
  const triggerCut = () => {
    cutRef.current.dir = 1;
    cutRef.current.auto = true;
  };

  return (
    <div className="cameraReveal" role="dialog" aria-modal="true">
      <video ref={videoRef} className="cameraRevealVideo" playsInline muted autoPlay />
      <div ref={dimRef} className="cameraRevealLayer cameraRevealDim" style={{ opacity: 0 }} />
      <div ref={darkRef} className="cameraRevealLayer" style={{ background: "rgb(0,0,10)", opacity: 0 }} />
      <div ref={glowRef} className="cameraRevealLayer cameraRevealEdge" style={{ opacity: 0 }} />
      <div ref={flashRef} className="cameraRevealLayer" style={{ background: "#fff", opacity: 0 }} />
      <canvas ref={canvasRef} className="cameraRevealCanvas" onPointerDown={onPointerDown} onPointerMove={onPointerMove} onPointerUp={onPointerUp} onPointerCancel={onPointerUp} />
      <p ref={hintRef} className="cameraRevealHint" style={{ opacity: 0 }}>{t(cameraRevealUi.cutHint)}</p>
      {(phase === "ready" || phase === "cutting") && (
        <button type="button" className="cameraRevealCut" aria-label={t(cameraRevealUi.cutLabel)} onClick={triggerCut} />
      )}
      <div className="cameraRevealTop">
        <div>
          {demo && <span className="demoBadge">DEMO DATA</span>}
          {camera.failed && <p className="cameraRevealNote">{t(cameraRevealUi.noCamera)}{camera.error ? ` (${camera.error})` : ""}</p>}
          {orientFallback && <p className="cameraRevealNote">{t(cameraRevealUi.noOrientation)}</p>}
          {webglFailed && <p className="cameraRevealNote">{t(cameraRevealUi.noWebgl)}</p>}
        </div>
        <button type="button" className="cameraRevealClose" onClick={handleClose} aria-label={t(cameraRevealUi.closeLabel)}>
          ×
        </button>
      </div>
      {phase === "done" && (
        <>
          <p className="cameraRevealTitle cameraRevealBarIn">{cardTitle}</p>
          <div className="cameraRevealBar cameraRevealBarIn">
            <button type="button" className="cameraRevealBtn solid" onClick={restart}>{t(cameraRevealUi.again)}</button>
            <button type="button" className="cameraRevealBtn" onClick={handleClose}>{t(cameraRevealUi.close)}</button>
          </div>
        </>
      )}
    </div>
  );
}
