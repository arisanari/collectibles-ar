export type Rand = () => number;
export type Pt = [number, number];

/** Midpoint displacement: a polyline from (x1, y1) to (x2, y2). `jag` is the starting offset as a share of the length (0.2 = jagged, near 0 = almost straight). */
export function bolt2d(rand: Rand, x1: number, y1: number, x2: number, y2: number, depth: number, jag = 0.2): Pt[] {
  let pts: Pt[] = [[x1, y1], [x2, y2]];
  let d = Math.hypot(x2 - x1, y2 - y1) * jag;
  for (let i = 0; i < depth; i++) {
    const next: Pt[] = [pts[0]];
    for (let k = 0; k < pts.length - 1; k++) {
      const [ax, ay] = pts[k];
      const [bx, by] = pts[k + 1];
      const len = Math.hypot(bx - ax, by - ay) || 1;
      const off = (rand() - 0.5) * 2 * d;
      next.push([(ax + bx) / 2 + (-(by - ay) / len) * off, (ay + by) / 2 + ((bx - ax) / len) * off], pts[k + 1]);
    }
    pts = next;
    d *= 0.55;
  }
  return pts;
}

export type BoltShape = { main: Pt[]; branches: Pt[][] };

/** A bolt with side branches (kept as points so a caller can redraw the same shape, or rebuild it to make it flicker). */
export function makeBolt(rand: Rand, from: Pt, to: Pt, branches: number, jag = 0.2): BoltShape {
  const main = bolt2d(rand, from[0], from[1], to[0], to[1], 7, jag);
  const len = Math.hypot(to[0] - from[0], to[1] - from[1]);
  const base = Math.atan2(to[1] - from[1], to[0] - from[0]);
  const out: Pt[][] = [];
  for (let b = 0; b < branches; b++) {
    const [sx, sy] = main[Math.floor(main.length * (0.15 + rand() * 0.6))];
    const ang = base + (rand() < 0.5 ? -1 : 1) * (0.35 + rand() * 0.6);
    const l = len * (0.15 + rand() * 0.2);
    out.push(bolt2d(rand, sx, sy, sx + Math.cos(ang) * l, sy + Math.sin(ang) * l, 5, jag));
  }
  return { main, branches: out };
}

function stroke(ctx: CanvasRenderingContext2D, pts: Pt[], color: string, width: number, alpha: number) {
  ctx.beginPath();
  ctx.moveTo(pts[0][0], pts[0][1]);
  for (let i = 1; i < pts.length; i++) ctx.lineTo(pts[i][0], pts[i][1]);
  ctx.globalAlpha = alpha;
  ctx.strokeStyle = color;
  ctx.lineWidth = width;
  ctx.lineJoin = "round";
  ctx.lineCap = "round";
  ctx.stroke();
}

/**
 * Draws a bolt additively as three stacked strokes that fall off smoothly: a wide faint outer glow in the colour, a brighter
 * middle layer, and a thin white core. No shadowBlur (it is weak and heavy on iOS); the softness comes from the layering.
 * `bright` is the colour of the middle layer (defaults to `color`).
 */
export function drawBoltShape(ctx: CanvasRenderingContext2D, b: BoltShape, width: number, color: string, alpha: number, bright: string = color) {
  ctx.save();
  ctx.globalCompositeOperation = "lighter";
  const paths: [Pt[], number][] = [[b.main, 1], ...b.branches.map((br): [Pt[], number] => [br, 0.55])];
  for (const [pts, k] of paths) {
    stroke(ctx, pts, color, Math.max(2, width * 1.6 * k), alpha * 0.28 * (k < 1 ? 0.9 : 1));
    stroke(ctx, pts, bright, Math.max(1.5, width * 0.95 * k), alpha * 0.6);
    stroke(ctx, pts, "#ffffff", Math.max(1, width * 0.45 * k), alpha * 0.95);
  }
  ctx.restore();
}
