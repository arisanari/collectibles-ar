import * as THREE from "three";
import type { Rand } from "./math";

/** Midpoint displacement in 3D: a jagged polyline from a to b. */
export function bolt3D(rand: Rand, a: THREE.Vector3, b: THREE.Vector3, depth: number): THREE.Vector3[] {
  let pts: THREE.Vector3[] = [a.clone(), b.clone()];
  let d = a.distanceTo(b) * 0.18;
  for (let i = 0; i < depth; i++) {
    const next: THREE.Vector3[] = [pts[0]];
    for (let k = 0; k < pts.length - 1; k++) {
      const A = pts[k];
      const B = pts[k + 1];
      const dir = B.clone().sub(A).normalize();
      const rv = new THREE.Vector3(rand() - 0.5, rand() - 0.5, rand() - 0.5);
      rv.addScaledVector(dir, -rv.dot(dir)).normalize().multiplyScalar((rand() - 0.5) * 2 * d);
      next.push(A.clone().add(B).multiplyScalar(0.5).add(rv), B);
    }
    pts = next;
    d *= 0.55;
  }
  return pts;
}

const CAP_VERTS = 340;
const VIEW = new THREE.Vector3();
const TAN = new THREE.Vector3();
const SIDE = new THREE.Vector3();

/** A set of polylines drawn as camera-facing triangle strips (the camera sits at the origin). */
class Ribbon {
  readonly mesh: THREE.Mesh;
  private pos = new Float32Array(CAP_VERTS * 3);
  private uv = new Float32Array(CAP_VERTS * 2);
  private idx = new Uint32Array(CAP_VERTS * 3);

  constructor(readonly geo: THREE.BufferGeometry, material: THREE.Material) {
    const pa = new THREE.BufferAttribute(this.pos, 3);
    pa.setUsage(THREE.DynamicDrawUsage);
    geo.setAttribute("position", pa);
    geo.setAttribute("uv", new THREE.BufferAttribute(this.uv, 2));
    geo.setIndex(new THREE.BufferAttribute(this.idx, 1));
    this.mesh = new THREE.Mesh(geo, material);
    this.mesh.frustumCulled = false;
    this.mesh.renderOrder = 5;
  }

  build(strands: THREE.Vector3[][], width: number) {
    let v = 0;
    let ii = 0;
    for (let s = 0; s < strands.length; s++) {
      const pts = strands[s];
      const w = s === 0 ? width : width * 0.5;
      if (v + pts.length * 2 > CAP_VERTS) break;
      const first = v;
      for (let i = 0; i < pts.length; i++) {
        const p = pts[i];
        TAN.copy(pts[Math.min(i + 1, pts.length - 1)]).sub(pts[Math.max(i - 1, 0)]);
        VIEW.copy(p).multiplyScalar(-1);
        SIDE.crossVectors(TAN, VIEW).normalize().multiplyScalar(w / 2);
        const taper = s === 0 ? 1 : 1 - i / pts.length;
        this.pos.set([p.x + SIDE.x * taper, p.y + SIDE.y * taper, p.z + SIDE.z * taper, p.x - SIDE.x * taper, p.y - SIDE.y * taper, p.z - SIDE.z * taper], v * 3);
        this.uv.set([0, i / pts.length, 1, i / pts.length], v * 2);
        v += 2;
      }
      for (let i = 0; i < pts.length - 1; i++) {
        const a = first + i * 2;
        this.idx.set([a, a + 1, a + 2, a + 1, a + 3, a + 2], ii);
        ii += 6;
      }
    }
    this.geo.setDrawRange(0, ii);
    (this.geo.getAttribute("position") as THREE.BufferAttribute).needsUpdate = true;
    (this.geo.getAttribute("uv") as THREE.BufferAttribute).needsUpdate = true;
    this.geo.index!.needsUpdate = true;
  }
}

/** One lightning bolt: a main strand plus branches, drawn as a coloured outer ribbon and a white core. */
export class Bolt {
  readonly outerMat: THREE.MeshBasicMaterial;
  readonly coreMat: THREE.MeshBasicMaterial;
  private outer: Ribbon;
  private core: Ribbon;
  strands: THREE.Vector3[][] = [];
  lastShape = -999;
  /** Strike points and distance, set by the caller. */
  ground = new THREE.Vector3();
  topPt = new THREE.Vector3();
  dist = 3;
  armed = false;
  readonly group = new THREE.Group();

  constructor(stripe: THREE.Texture, track: (d: { dispose(): void }) => void) {
    const mk = (color: number) =>
      new THREE.MeshBasicMaterial({ map: stripe, color, transparent: true, blending: THREE.AdditiveBlending, depthWrite: false, depthTest: false, side: THREE.DoubleSide });
    this.outerMat = mk(0xffffff);
    this.coreMat = mk(0xffffff);
    const g1 = new THREE.BufferGeometry();
    const g2 = new THREE.BufferGeometry();
    track(this.outerMat);
    track(this.coreMat);
    track(g1);
    track(g2);
    this.outer = new Ribbon(g1, this.outerMat);
    this.core = new Ribbon(g2, this.coreMat);
    this.group.add(this.outer.mesh, this.core.mesh);
    this.group.visible = false;
  }

  reshape(rand: Rand, from: THREE.Vector3, to: THREE.Vector3, branches: number) {
    const main = bolt3D(rand, from, to, 6);
    this.strands = [main];
    const len = from.distanceTo(to);
    for (let b = 0; b < branches; b++) {
      const s = main[Math.floor(main.length * (0.15 + rand() * 0.6))];
      const end = s.clone().add(new THREE.Vector3((rand() - 0.5) * len * 0.5, -rand() * len * 0.3, (rand() - 0.5) * len * 0.5));
      this.strands.push(bolt3D(rand, s, end, 4));
    }
  }

  /** width: world metres of the core; the outer band is wider. */
  build(width: number) {
    this.outer.build(this.strands, width * 2.8);
    this.core.build(this.strands, width * 0.9);
  }
}
