import * as THREE from "three";

type Track = <T extends { dispose(): void }>(x: T) => T;
type Tier = 0 | 1 | 2 | 3;

/** Frame height map size (the card is 81 x 136 mm, so 912 x 1536 keeps the pattern undistorted). */
const FW = 912;
const FH = 1536;
/** The art window inside the frame, in frame-canvas pixels. */
const WIN = { x0: 109, x1: 803, y0: 190, y1: 1310 };
const ART_W = 512;
const ART_H = 824;

function makeCanvas(w: number, h: number): [HTMLCanvasElement, CanvasRenderingContext2D] {
  const c = document.createElement("canvas");
  c.width = w;
  c.height = h;
  return [c, c.getContext("2d", { willReadFrequently: true }) as CanvasRenderingContext2D];
}

const gray = (g: number) => `rgb(${g},${g},${g})`;

/** Read a canvas into a 0..1 float height array (red channel). */
function readHeights(c: HTMLCanvasElement, ctx: CanvasRenderingContext2D): Float32Array {
  const d = ctx.getImageData(0, 0, c.width, c.height).data;
  const out = new Float32Array(c.width * c.height);
  for (let i = 0; i < out.length; i++) out[i] = d[i * 4] / 255;
  return out;
}

function blur3(h: Float32Array, w: number, hh: number): Float32Array {
  const o = new Float32Array(h.length);
  for (let y = 0; y < hh; y++) {
    for (let x = 0; x < w; x++) {
      let s = 0;
      let n = 0;
      for (let dy = -1; dy <= 1; dy++) {
        for (let dx = -1; dx <= 1; dx++) {
          const xx = x + dx;
          const yy = y + dy;
          if (xx < 0 || yy < 0 || xx >= w || yy >= hh) continue;
          s += h[yy * w + xx];
          n++;
        }
      }
      o[y * w + x] = s / n;
    }
  }
  return o;
}

/** Sobel: height -> tangent-space normal map (OpenGL convention, +Y up). */
function normalCanvas(h: Float32Array, w: number, hh: number, strength: number): HTMLCanvasElement {
  const [c, ctx] = makeCanvas(w, hh);
  const img = ctx.createImageData(w, hh);
  const at = (x: number, y: number) => h[Math.min(hh - 1, Math.max(0, y)) * w + Math.min(w - 1, Math.max(0, x))];
  for (let y = 0; y < hh; y++) {
    for (let x = 0; x < w; x++) {
      const dx = at(x + 1, y - 1) + 2 * at(x + 1, y) + at(x + 1, y + 1) - (at(x - 1, y - 1) + 2 * at(x - 1, y) + at(x - 1, y + 1));
      const dy = at(x - 1, y + 1) + 2 * at(x, y + 1) + at(x + 1, y + 1) - (at(x - 1, y - 1) + 2 * at(x, y - 1) + at(x + 1, y - 1));
      let nx = -dx * strength;
      let ny = dy * strength;
      const nz = 1;
      const l = Math.hypot(nx, ny, nz);
      nx /= l;
      ny /= l;
      const i = (y * w + x) * 4;
      img.data[i] = (nx * 0.5 + 0.5) * 255;
      img.data[i + 1] = (ny * 0.5 + 0.5) * 255;
      img.data[i + 2] = ((nz / l) * 0.5 + 0.5) * 255;
      img.data[i + 3] = 255;
    }
  }
  ctx.putImageData(img, 0, 0);
  return c;
}

/** Roughness from height: raised parts polished, recesses rougher (G channel, multiplied by material.roughness = 1). */
function roughnessCanvas(h: Float32Array, w: number, hh: number): HTMLCanvasElement {
  const [c, ctx] = makeCanvas(w, hh);
  const img = ctx.createImageData(w, hh);
  for (let i = 0; i < h.length; i++) {
    const r = Math.max(0.18, Math.min(0.7, 0.2 + (1 - h[i]) * 0.5)) * 255;
    img.data[i * 4] = img.data[i * 4 + 1] = img.data[i * 4 + 2] = r;
    img.data[i * 4 + 3] = 255;
  }
  ctx.putImageData(img, 0, 0);
  return c;
}

function dataTexture(c: HTMLCanvasElement): THREE.CanvasTexture {
  const t = new THREE.CanvasTexture(c);
  t.colorSpace = THREE.NoColorSpace;
  t.anisotropy = 4;
  return t;
}

/** One small spiral scroll at (x, y); `flip` mirrors it. Own geometric ornament, drawn as a raised line. */
function spiral(ctx: CanvasRenderingContext2D, x: number, y: number, r0: number, flip: number, g = 200) {
  ctx.beginPath();
  for (let a = 0; a < Math.PI * 4; a += 0.2) {
    const r = r0 * (1 - a / (Math.PI * 4.6));
    const px = x + Math.cos(a) * r * flip;
    const py = y + Math.sin(a) * r;
    if (a === 0) ctx.moveTo(px, py);
    else ctx.lineTo(px, py);
  }
  ctx.strokeStyle = gray(g);
  ctx.lineWidth = 4;
  ctx.lineCap = "round";
  ctx.stroke();
}

function scrollStrip(ctx: CanvasRenderingContext2D, x0: number, y0: number, x1: number, y1: number, step: number, r: number) {
  const len = Math.hypot(x1 - x0, y1 - y0);
  const n = Math.floor(len / step);
  for (let i = 0; i <= n; i++) {
    const x = x0 + ((x1 - x0) * i) / n;
    const y = y0 + ((y1 - y0) * i) / n;
    spiral(ctx, x, y, r, i % 2 ? 1 : -1);
    ctx.fillStyle = gray(215);
    ctx.beginPath();
    ctx.arc(x + ((x1 - x0) / n) * 0.5, y + ((y1 - y0) / n) * 0.5, 3.5, 0, Math.PI * 2);
    ctx.fill();
  }
}

function nameplate(ctx: CanvasRenderingContext2D, x0: number, x1: number, y0: number, y1: number) {
  const m = (y1 - y0) / 2;
  const path = (inset: number) => {
    ctx.beginPath();
    ctx.moveTo(x0 + inset, y0 + m);
    ctx.lineTo(x0 + m + inset, y0 + inset);
    ctx.lineTo(x1 - m - inset, y0 + inset);
    ctx.lineTo(x1 - inset, y0 + m);
    ctx.lineTo(x1 - m - inset, y1 - inset);
    ctx.lineTo(x0 + m + inset, y1 - inset);
    ctx.closePath();
  };
  path(0);
  ctx.fillStyle = gray(215);
  ctx.fill();
  path(9);
  ctx.strokeStyle = gray(60);
  ctx.lineWidth = 5;
  ctx.stroke();
  path(18);
  ctx.fillStyle = gray(185);
  ctx.fill();
  for (const rx of [x0 + m + 6, x1 - m - 6]) {
    ctx.fillStyle = gray(245);
    ctx.beginPath();
    ctx.arc(rx, y0 + m, 6, 0, Math.PI * 2);
    ctx.fill();
  }
}

function cornerOrnament(ctx: CanvasRenderingContext2D, cx: number, cy: number) {
  const g = ctx.createRadialGradient(cx, cy, 0, cx, cy, 62);
  g.addColorStop(0, gray(250));
  g.addColorStop(0.6, gray(190));
  g.addColorStop(1, gray(130));
  ctx.fillStyle = g;
  ctx.beginPath();
  ctx.arc(cx, cy, 60, 0, Math.PI * 2);
  ctx.fill();
  ctx.strokeStyle = gray(40);
  ctx.lineWidth = 5;
  ctx.beginPath();
  ctx.arc(cx, cy, 44, 0, Math.PI * 2);
  ctx.stroke();
  for (let i = 0; i < 8; i++) {
    ctx.save();
    ctx.translate(cx, cy);
    ctx.rotate((Math.PI / 4) * i);
    ctx.fillStyle = gray(230);
    ctx.beginPath();
    ctx.ellipse(0, -30, 8, 18, 0, 0, Math.PI * 2);
    ctx.fill();
    ctx.restore();
  }
  ctx.fillStyle = gray(250);
  ctx.beginPath();
  ctx.arc(cx, cy, 12, 0, Math.PI * 2);
  ctx.fill();
}

/** Front frame relief (own geometric design): double border, art window bevel, corner ornaments, nameplates, scroll bands. */
function frameHeights(): Float32Array {
  const [c, ctx] = makeCanvas(FW, FH);
  ctx.fillStyle = gray(120);
  ctx.fillRect(0, 0, FW, FH);
  ctx.lineJoin = "round";
  // outer rim and two fine lines
  ctx.strokeStyle = gray(235);
  ctx.lineWidth = 28;
  ctx.strokeRect(14, 14, FW - 28, FH - 28);
  ctx.strokeStyle = gray(40);
  ctx.lineWidth = 6;
  ctx.strokeRect(46, 46, FW - 92, FH - 92);
  ctx.strokeStyle = gray(205);
  ctx.lineWidth = 10;
  ctx.strokeRect(60, 60, FW - 120, FH - 120);
  // scroll bands between the border and the window
  scrollStrip(ctx, 96, 88, FW - 96, 88, 46, 15);
  scrollStrip(ctx, 96, FH - 88, FW - 96, FH - 88, 46, 15);
  scrollStrip(ctx, 88, 240, 88, FH - 240, 46, 15);
  scrollStrip(ctx, FW - 88, 240, FW - 88, FH - 240, 46, 15);
  // window: recessed, with a raised bevel around it
  const { x0, x1, y0, y1 } = WIN;
  ctx.strokeStyle = gray(225);
  ctx.lineWidth = 16;
  ctx.strokeRect(x0 - 12, y0 - 12, x1 - x0 + 24, y1 - y0 + 24);
  ctx.strokeStyle = gray(45);
  ctx.lineWidth = 6;
  ctx.strokeRect(x0 - 2, y0 - 2, x1 - x0 + 4, y1 - y0 + 4);
  ctx.fillStyle = gray(70);
  ctx.fillRect(x0, y0, x1 - x0, y1 - y0);
  // nameplates
  nameplate(ctx, 250, 662, 112, 176);
  nameplate(ctx, 190, 722, 1334, 1424);
  scrollStrip(ctx, 150, 1474, FW - 150, 1474, 46, 13);
  // corners
  for (const [cx, cy] of [[70, 70], [FW - 70, 70], [70, FH - 70], [FW - 70, FH - 70]]) cornerOrnament(ctx, cx, cy);
  // rivets along the sides
  ctx.fillStyle = gray(245);
  for (const x of [34, FW - 34]) for (const y of [FH * 0.3, FH * 0.5, FH * 0.7]) {
    ctx.beginPath();
    ctx.arc(x, y, 7, 0, Math.PI * 2);
    ctx.fill();
  }
  return blur3(readHeights(c, ctx), FW, FH);
}

/** Back relief: same rim, with a geometric mark. */
function backHeights(w: number, h: number): Float32Array {
  const [c, ctx] = makeCanvas(w, h);
  ctx.fillStyle = gray(120);
  ctx.fillRect(0, 0, w, h);
  ctx.strokeStyle = gray(235);
  ctx.lineWidth = 16;
  ctx.strokeRect(8, 8, w - 16, h - 16);
  ctx.strokeStyle = gray(40);
  ctx.lineWidth = 4;
  ctx.strokeRect(28, 28, w - 56, h - 56);
  ctx.strokeStyle = gray(205);
  ctx.lineWidth = 6;
  ctx.strokeRect(36, 36, w - 72, h - 72);
  ctx.lineWidth = 7;
  for (let i = 0; i < 6; i++) {
    ctx.save();
    ctx.translate(w / 2, h / 2);
    ctx.rotate((Math.PI / 12) * i);
    ctx.strokeStyle = gray(225 - i * 12);
    const s = 190 - i * 8;
    ctx.strokeRect(-s / 2, -s / 2, s, s);
    ctx.restore();
  }
  ctx.strokeStyle = gray(240);
  ctx.lineWidth = 10;
  ctx.beginPath();
  ctx.arc(w / 2, h / 2, 150, 0, Math.PI * 2);
  ctx.stroke();
  ctx.beginPath();
  ctx.arc(w / 2, h / 2, 40, 0, Math.PI * 2);
  ctx.fillStyle = gray(240);
  ctx.fill();
  for (let i = 0; i < 24; i++) {
    const a = (Math.PI / 12) * i;
    ctx.strokeStyle = gray(200);
    ctx.lineWidth = 4;
    ctx.beginPath();
    ctx.moveTo(w / 2 + Math.cos(a) * 160, h / 2 + Math.sin(a) * 160);
    ctx.lineTo(w / 2 + Math.cos(a) * 200, h / 2 + Math.sin(a) * 200);
    ctx.stroke();
  }
  for (const [cx, cy] of [[70, 70], [w - 70, 70], [70, h - 70], [w - 70, h - 70]]) {
    ctx.save();
    ctx.translate(cx, cy);
    ctx.rotate(Math.PI / 4);
    ctx.fillStyle = gray(235);
    ctx.fillRect(-18, -18, 36, 36);
    ctx.restore();
  }
  return blur3(readHeights(c, ctx), w, h);
}

/** Own placeholder art (no text): dark graded background, radial rays, concentric rings, a geometric crest, scattered stars. */
function placeholderArt(): HTMLCanvasElement {
  const [c, g] = makeCanvas(ART_W, ART_H);
  const bg = g.createLinearGradient(0, 0, 0, ART_H);
  bg.addColorStop(0, "#0d1233");
  bg.addColorStop(0.55, "#2a1457");
  bg.addColorStop(1, "#0b1a3a");
  g.fillStyle = bg;
  g.fillRect(0, 0, ART_W, ART_H);
  const cx = ART_W / 2;
  const cy = ART_H * 0.42;
  for (let i = 0; i < 28; i++) {
    const a0 = (Math.PI * 2 * i) / 28;
    g.fillStyle = i % 2 ? "rgba(255,200,120,.10)" : "rgba(120,160,255,.07)";
    g.beginPath();
    g.moveTo(cx, cy);
    g.arc(cx, cy, 700, a0, a0 + (Math.PI * 2) / 56);
    g.closePath();
    g.fill();
  }
  const halo = g.createRadialGradient(cx, cy, 10, cx, cy, 240);
  halo.addColorStop(0, "rgba(255,230,160,.95)");
  halo.addColorStop(0.35, "rgba(255,150,90,.35)");
  halo.addColorStop(1, "rgba(255,150,90,0)");
  g.fillStyle = halo;
  g.fillRect(0, 0, ART_W, ART_H);
  g.strokeStyle = "rgba(255,235,190,.9)";
  for (let i = 0; i < 4; i++) {
    g.lineWidth = 4 - i * 0.6;
    g.beginPath();
    g.arc(cx, cy, 70 + i * 44, 0, Math.PI * 2);
    g.stroke();
  }
  g.lineWidth = 5;
  g.strokeStyle = "rgba(255,248,220,1)";
  for (let k = 0; k < 2; k++) {
    g.beginPath();
    for (let i = 0; i < 6; i++) {
      const a = (Math.PI / 3) * i + (k ? Math.PI / 6 : 0) - Math.PI / 2;
      const r = k ? 56 : 92;
      const px = cx + Math.cos(a) * r;
      const py = cy + Math.sin(a) * r;
      if (i === 0) g.moveTo(px, py);
      else g.lineTo(px, py);
    }
    g.closePath();
    g.stroke();
  }
  g.fillStyle = "rgba(255,255,255,.95)";
  g.beginPath();
  g.arc(cx, cy, 14, 0, Math.PI * 2);
  g.fill();
  // ground band
  const gb = g.createLinearGradient(0, ART_H * 0.7, 0, ART_H);
  gb.addColorStop(0, "rgba(255,170,90,0)");
  gb.addColorStop(1, "rgba(255,170,90,.35)");
  g.fillStyle = gb;
  g.fillRect(0, ART_H * 0.7, ART_W, ART_H * 0.3);
  let seed = 4;
  for (let i = 0; i < 70; i++) {
    seed = (seed * 16807) % 2147483647;
    const x = (seed % 1000) / 1000 * ART_W;
    seed = (seed * 16807) % 2147483647;
    const y = (seed % 1000) / 1000 * ART_H;
    g.fillStyle = `rgba(255,255,255,${0.3 + ((seed % 7) / 7) * 0.6})`;
    g.fillRect(x, y, 2 + (seed % 3), 2 + (seed % 3));
  }
  return c;
}

export type CardRig = {
  group: THREE.Group;
  halo: THREE.Sprite;
  /** Replace the art with a runtime image (cover-cropped). A bump is added only when the pixels can be read. */
  setImage(img: HTMLImageElement): void;
  setTime(t: number): void;
  /** Releases the art textures made at runtime (the rest is released through `track`). */
  dispose(): void;
};

const FOIL: Record<Tier, number> = { 0: 0.05, 1: 0.35, 2: 0.6, 3: 1.0 };
const METAL: Record<Tier, number> = { 0: 0x9fa3ab, 1: 0x7f9bc6, 2: 0xe3b64c, 3: 0xe8bf58 };

/**
 * A graded-slab style card: embossed metal frame (height -> Sobel normal map), art with a holographic foil that runs with the
 * viewing angle, a thin clear case, and an embossed metal back. All textures are generated here; nothing is bundled.
 */
export function buildCard(tier: Tier, dims: { w: number; h: number; t: number }, glow: THREE.Texture, track: Track): CardRig {
  const { w, h, t } = dims;
  const group = new THREE.Group();

  const fh = frameHeights();
  const normal = track(dataTexture(normalCanvas(fh, FW, FH, 5)));
  const rough = track(dataTexture(roughnessCanvas(fh, FW, FH)));
  const BW = 512;
  const BH = 768;
  const bh = backHeights(BW, BH);
  const backNormal = track(dataTexture(normalCanvas(bh, BW, BH, 5)));
  const backRough = track(dataTexture(roughnessCanvas(bh, BW, BH)));

  const metalBase = { color: METAL[tier], metalness: 1, roughness: 1, clearcoat: 0.3, clearcoatRoughness: 0.25, envMapIntensity: 1.4 };
  const iri = tier === 3 ? { iridescence: 1, iridescenceIOR: 1.5, iridescenceThicknessRange: [250, 700] as [number, number] } : {};
  const frontMetal = track(new THREE.MeshPhysicalMaterial({ ...metalBase, ...iri, normalMap: normal, normalScale: new THREE.Vector2(1.3, 1.3), roughnessMap: rough }));
  const backMetal = track(new THREE.MeshPhysicalMaterial({ ...metalBase, ...iri, normalMap: backNormal, normalScale: new THREE.Vector2(1.3, 1.3), roughnessMap: backRough }));
  const sideMetal = track(new THREE.MeshPhysicalMaterial({ ...metalBase, roughness: 0.35 }));
  const boxGeo = track(new THREE.BoxGeometry(1, 1, 1));
  const plate = new THREE.Mesh(boxGeo, [sideMetal, sideMetal, sideMetal, sideMetal, frontMetal, backMetal]);
  plate.scale.set(w, h, t);
  group.add(plate);

  // art window
  const winW = ((WIN.x1 - WIN.x0) / FW) * w;
  const winH = ((WIN.y1 - WIN.y0) / FH) * h;
  const winCx = (((WIN.x0 + WIN.x1) / 2) / FW - 0.5) * w;
  const winCy = (0.5 - ((WIN.y0 + WIN.y1) / 2) / FH) * h;
  const foil = { value: FOIL[tier] };
  const time = { value: 0 };
  const artMat = track(
    new THREE.MeshPhysicalMaterial({ metalness: 0.25, roughness: 0.35, clearcoat: 0.6, clearcoatRoughness: 0.2, envMapIntensity: 0.9, normalScale: new THREE.Vector2(0.35, 0.35) }),
  );
  artMat.onBeforeCompile = (shader) => {
    shader.uniforms.uFoil = foil;
    shader.uniforms.uTime = time;
    shader.fragmentShader = `uniform float uFoil; uniform float uTime;\n${shader.fragmentShader}`.replace(
      "#include <emissivemap_fragment>",
      `#include <emissivemap_fragment>
      {
        float lum = dot(diffuseColor.rgb, vec3(0.299, 0.587, 0.114));
        float mask = smoothstep(0.22, 0.85, lum);
        float s = dot(normal.xy, vec2(1.3, 0.9)) * 4.0 + vMapUv.x * 1.4 + vMapUv.y * 0.9 + uTime * 0.04;
        vec3 rainbow = 0.5 + 0.5 * cos(6.2831 * (s + vec3(0.0, 0.33, 0.67)));
        float band = 0.35 + 0.65 * pow(sin(s * 7.0) * 0.5 + 0.5, 2.0);
        totalEmissiveRadiance += rainbow * band * mask * uFoil;
      }`,
    );
  };
  const art = new THREE.Mesh(track(new THREE.PlaneGeometry(winW, winH)), artMat);
  art.position.set(winCx, winCy, t / 2 + 0.0004);
  group.add(art);

  let mapTex: THREE.CanvasTexture | null = null;
  let artNormal: THREE.CanvasTexture | null = null;
  const applyArt = (c: HTMLCanvasElement, canRead: boolean) => {
    mapTex?.dispose();
    artNormal?.dispose();
    mapTex = new THREE.CanvasTexture(c);
    mapTex.colorSpace = THREE.SRGBColorSpace;
    mapTex.anisotropy = 4;
    artMat.map = mapTex;
    artNormal = null;
    if (canRead) {
      try {
        const ctx = c.getContext("2d") as CanvasRenderingContext2D;
        const d = ctx.getImageData(0, 0, c.width, c.height).data;
        const lum = new Float32Array(c.width * c.height);
        for (let i = 0; i < lum.length; i++) lum[i] = (d[i * 4] * 0.299 + d[i * 4 + 1] * 0.587 + d[i * 4 + 2] * 0.114) / 255;
        artNormal = dataTexture(normalCanvas(blur3(lum, c.width, c.height), c.width, c.height, 2));
      } catch {
        artNormal = null; // pixels not readable (cross-origin): no bump, still shown
      }
    }
    artMat.normalMap = artNormal;
    artMat.needsUpdate = true;
  };
  applyArt(placeholderArt(), true);

  // clear case
  const caseMat = track(
    new THREE.MeshPhysicalMaterial({ color: 0xffffff, transparent: true, opacity: 0.1, roughness: 0.05, metalness: 0, clearcoat: 1, clearcoatRoughness: 0.05, envMapIntensity: 3, depthWrite: false }),
  );
  const caseMesh = new THREE.Mesh(boxGeo, caseMat);
  caseMesh.scale.set(w * 1.05, h * 1.03, t * 2.4);
  group.add(caseMesh);

  // halo behind the card
  const halo = new THREE.Sprite(track(new THREE.SpriteMaterial({ map: glow, transparent: true, blending: THREE.AdditiveBlending, depthWrite: false, opacity: 0 })));
  halo.scale.set(h * 3.2, h * 3.2, 1);
  halo.position.set(0, 0, -t * 6);
  group.add(halo);

  return {
    group,
    halo,
    setImage(img) {
      const [c, ctx] = makeCanvas(ART_W, ART_H);
      const s = Math.max(ART_W / img.naturalWidth, ART_H / img.naturalHeight);
      const dw = img.naturalWidth * s;
      const dh = img.naturalHeight * s;
      ctx.drawImage(img, (ART_W - dw) / 2, (ART_H - dh) / 2, dw, dh);
      applyArt(c, true);
    },
    setTime(v) {
      time.value = v;
    },
    dispose() {
      mapTex?.dispose();
      artNormal?.dispose();
    },
  } satisfies CardRig;
}
