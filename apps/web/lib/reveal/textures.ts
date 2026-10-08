import * as THREE from "three";

function canvas(w: number, h: number): [HTMLCanvasElement, CanvasRenderingContext2D] {
  const c = document.createElement("canvas");
  c.width = w;
  c.height = h;
  return [c, c.getContext("2d") as CanvasRenderingContext2D];
}

function tex(c: HTMLCanvasElement, srgb = true): THREE.CanvasTexture {
  const t = new THREE.CanvasTexture(c);
  if (srgb) t.colorSpace = THREE.SRGBColorSpace;
  t.anisotropy = 4;
  return t;
}

/** Soft round light. */
export function glowTexture(): THREE.CanvasTexture {
  const [c, g] = canvas(128, 128);
  const gr = g.createRadialGradient(64, 64, 0, 64, 64, 64);
  gr.addColorStop(0, "rgba(255,255,255,1)");
  gr.addColorStop(0.35, "rgba(255,255,255,.45)");
  gr.addColorStop(1, "rgba(255,255,255,0)");
  g.fillStyle = gr;
  g.fillRect(0, 0, 128, 128);
  return tex(c);
}

/** A ring that lies on the floor. */
export function ringTexture(): THREE.CanvasTexture {
  const [c, g] = canvas(256, 256);
  const gr = g.createRadialGradient(128, 128, 0, 128, 128, 128);
  gr.addColorStop(0, "rgba(255,255,255,.08)");
  gr.addColorStop(0.6, "rgba(255,255,255,.1)");
  gr.addColorStop(0.82, "rgba(255,255,255,.95)");
  gr.addColorStop(0.92, "rgba(255,255,255,.25)");
  gr.addColorStop(1, "rgba(255,255,255,0)");
  g.fillStyle = gr;
  g.fillRect(0, 0, 256, 256);
  return tex(c);
}

/** Vertical light: opaque at the bottom, gone at the top, soft at the sides. */
export function columnTexture(): THREE.CanvasTexture {
  const [c, g] = canvas(128, 256);
  const v = g.createLinearGradient(0, 256, 0, 0);
  v.addColorStop(0, "rgba(255,255,255,1)");
  v.addColorStop(0.6, "rgba(255,255,255,.45)");
  v.addColorStop(1, "rgba(255,255,255,0)");
  g.fillStyle = v;
  g.fillRect(0, 0, 128, 256);
  g.globalCompositeOperation = "destination-in";
  const h = g.createLinearGradient(0, 0, 128, 0);
  h.addColorStop(0, "rgba(0,0,0,0)");
  h.addColorStop(0.5, "rgba(0,0,0,1)");
  h.addColorStop(1, "rgba(0,0,0,0)");
  g.fillStyle = h;
  g.fillRect(0, 0, 128, 256);
  return tex(c);
}

/** Across a ribbon: bright centre, soft edges. */
export function stripeTexture(): THREE.CanvasTexture {
  const [c, g] = canvas(64, 4);
  const h = g.createLinearGradient(0, 0, 64, 0);
  h.addColorStop(0, "rgba(255,255,255,0)");
  h.addColorStop(0.5, "rgba(255,255,255,1)");
  h.addColorStop(1, "rgba(255,255,255,0)");
  g.fillStyle = h;
  g.fillRect(0, 0, 64, 4);
  return tex(c);
}

/** A hard little shard for debris. */
export function debrisTexture(): THREE.CanvasTexture {
  const [c, g] = canvas(32, 32);
  g.fillStyle = "#fff";
  g.beginPath();
  g.moveTo(16, 3);
  g.lineTo(28, 22);
  g.lineTo(6, 27);
  g.closePath();
  g.fill();
  return tex(c);
}

/** Pack body (own artwork, no logo): gradient, diagonal bands, geometric mark, dotted cut line on its top edge. 512 x 788. */
export function packTexture(): THREE.CanvasTexture {
  const [c, g] = canvas(512, 788);
  const bg = g.createLinearGradient(0, 0, 512, 700);
  bg.addColorStop(0, "#3a4fb8");
  bg.addColorStop(0.5, "#5a3fb0");
  bg.addColorStop(1, "#1f2a6e");
  g.fillStyle = bg;
  g.fillRect(0, 0, 512, 788);
  g.fillStyle = "rgba(255,255,255,.08)";
  for (let i = 0; i < 4; i++) {
    const o = 512 * (0.1 + i * 0.28);
    g.beginPath();
    g.moveTo(o, 0);
    g.lineTo(o + 40, 0);
    g.lineTo(o - 250, 788);
    g.lineTo(o - 290, 788);
    g.closePath();
    g.fill();
  }
  g.strokeStyle = "rgba(255,255,255,.75)";
  g.lineWidth = 4;
  for (let i = 0; i < 3; i++) {
    g.save();
    g.translate(256, 190);
    g.rotate((Math.PI / 6) * i);
    g.strokeRect(-77, -77, 154, 154);
    g.restore();
  }
  g.beginPath();
  g.arc(256, 190, 35, 0, Math.PI * 2);
  g.stroke();
  g.setLineDash([12, 10]);
  g.strokeStyle = "rgba(255,255,255,.8)";
  g.lineWidth = 3;
  g.beginPath();
  g.moveTo(10, 5);
  g.lineTo(502, 5);
  g.stroke();
  g.setLineDash([]);
  g.fillStyle = "rgba(255,255,255,.2)";
  for (let i = 0; i < 20; i++) g.fillRect(25.6 * i, 770, 12, 18);
  return tex(c);
}

/** Silver seal band with a zigzag top edge (transparent above the teeth). 512 x 96. */
export function sealTexture(): THREE.CanvasTexture {
  const [c, g] = canvas(512, 96);
  const gr = g.createLinearGradient(0, 0, 512, 0);
  gr.addColorStop(0, "#9aa4bd");
  gr.addColorStop(0.3, "#f2f5ff");
  gr.addColorStop(0.55, "#aab3cc");
  gr.addColorStop(0.8, "#eef1fb");
  gr.addColorStop(1, "#8f99b4");
  g.fillStyle = gr;
  g.beginPath();
  g.moveTo(0, 96);
  g.lineTo(0, 22);
  const teeth = 22;
  for (let i = 0; i < teeth; i++) {
    g.lineTo((512 / teeth) * (i + 0.5), 4);
    g.lineTo((512 / teeth) * (i + 1), 22);
  }
  g.lineTo(512, 96);
  g.closePath();
  g.fill();
  g.strokeStyle = "rgba(60,70,100,.35)";
  g.lineWidth = 1;
  for (let i = 1; i < 64; i++) {
    g.beginPath();
    g.moveTo(8 * i, 26);
    g.lineTo(8 * i, 96);
    g.stroke();
  }
  return tex(c);
}

/** Placeholder card face (no text; the title is shown in the DOM). 256 x 358. */
export function placeholderCardTexture(): THREE.CanvasTexture {
  const [c, g] = canvas(256, 358);
  const gr = g.createLinearGradient(0, 0, 256, 358);
  gr.addColorStop(0, "#fdf3c4");
  gr.addColorStop(1, "#c9b6ff");
  g.fillStyle = gr;
  g.fillRect(0, 0, 256, 358);
  g.strokeStyle = "rgba(0,0,0,.25)";
  g.lineWidth = 3;
  g.strokeRect(20, 20, 216, 250);
  g.beginPath();
  g.moveTo(128, 70);
  g.lineTo(184, 145);
  g.lineTo(128, 220);
  g.lineTo(72, 145);
  g.closePath();
  g.stroke();
  return tex(c);
}

/** Card back (own pattern). */
export function cardBackTexture(): THREE.CanvasTexture {
  const [c, g] = canvas(256, 358);
  g.fillStyle = "#1f2a6e";
  g.fillRect(0, 0, 256, 358);
  g.strokeStyle = "rgba(255,255,255,.45)";
  g.lineWidth = 2;
  for (let i = 0; i < 6; i++) {
    g.save();
    g.translate(128, 179);
    g.rotate((Math.PI / 12) * i);
    g.strokeRect(-60 - i * 8, -60 - i * 8, 120 + i * 16, 120 + i * 16);
    g.restore();
  }
  g.strokeRect(14, 14, 228, 330);
  return tex(c);
}
