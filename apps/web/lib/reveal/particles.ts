import * as THREE from "three";

/** A fixed pool of additive point sprites. Dead slots are black (additive = invisible). */
export class ParticleSys {
  readonly points: THREE.Points;
  private pos: Float32Array;
  private col: Float32Array;
  private vel: Float32Array;
  private base: Float32Array;
  private life: Float32Array;
  private max: Float32Array;
  private grav: Float32Array;
  private cursor = 0;

  constructor(private cap: number, map: THREE.Texture, size: number, track: (d: { dispose(): void }) => void) {
    this.pos = new Float32Array(cap * 3);
    this.col = new Float32Array(cap * 3);
    this.vel = new Float32Array(cap * 3);
    this.base = new Float32Array(cap * 3);
    this.life = new Float32Array(cap).fill(1);
    this.max = new Float32Array(cap).fill(1);
    this.grav = new Float32Array(cap);
    const geo = new THREE.BufferGeometry();
    const pa = new THREE.BufferAttribute(this.pos, 3);
    const ca = new THREE.BufferAttribute(this.col, 3);
    pa.setUsage(THREE.DynamicDrawUsage);
    ca.setUsage(THREE.DynamicDrawUsage);
    geo.setAttribute("position", pa);
    geo.setAttribute("color", ca);
    const mat = new THREE.PointsMaterial({ map, size, sizeAttenuation: true, vertexColors: true, transparent: true, blending: THREE.AdditiveBlending, depthWrite: false, depthTest: false });
    track(geo);
    track(mat);
    this.points = new THREE.Points(geo, mat);
    this.points.frustumCulled = false;
  }

  spawn(x: number, y: number, z: number, vx: number, vy: number, vz: number, max: number, r: number, g: number, b: number, grav = 0) {
    const i = this.cursor;
    this.cursor = (this.cursor + 1) % this.cap;
    this.pos[i * 3] = x;
    this.pos[i * 3 + 1] = y;
    this.pos[i * 3 + 2] = z;
    this.vel[i * 3] = vx;
    this.vel[i * 3 + 1] = vy;
    this.vel[i * 3 + 2] = vz;
    this.base[i * 3] = r;
    this.base[i * 3 + 1] = g;
    this.base[i * 3 + 2] = b;
    this.life[i] = 0;
    this.max[i] = max;
    this.grav[i] = grav;
  }

  update(dt: number, reduced: boolean) {
    for (let i = 0; i < this.cap; i++) {
      if (this.life[i] >= this.max[i]) {
        this.col[i * 3] = this.col[i * 3 + 1] = this.col[i * 3 + 2] = 0;
        continue;
      }
      this.life[i] += reduced ? dt * 2 : dt;
      if (!reduced) {
        this.vel[i * 3 + 1] -= this.grav[i] * dt;
        this.pos[i * 3] += this.vel[i * 3] * dt;
        this.pos[i * 3 + 1] += this.vel[i * 3 + 1] * dt;
        this.pos[i * 3 + 2] += this.vel[i * 3 + 2] * dt;
      }
      const f = Math.max(0, 1 - this.life[i] / this.max[i]);
      this.col[i * 3] = this.base[i * 3] * f;
      this.col[i * 3 + 1] = this.base[i * 3 + 1] * f;
      this.col[i * 3 + 2] = this.base[i * 3 + 2] * f;
    }
    (this.points.geometry.getAttribute("position") as THREE.BufferAttribute).needsUpdate = true;
    (this.points.geometry.getAttribute("color") as THREE.BufferAttribute).needsUpdate = true;
  }

  clear() {
    this.life.fill(1);
    this.max.fill(1);
  }
}
