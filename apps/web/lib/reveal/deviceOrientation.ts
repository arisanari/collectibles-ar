import * as THREE from "three";

export type OrientationPermission = "granted" | "denied" | "unsupported";

let permission: OrientationPermission | "unknown" = "unknown";

/**
 * Ask for motion access. On iOS this must be called inside a user gesture (a click handler).
 * Where `requestPermission` does not exist (Android, desktop) nothing is asked and listeners work as they are.
 */
export async function requestOrientationPermission(): Promise<OrientationPermission> {
  const Ctor = (typeof window !== "undefined" ? window.DeviceOrientationEvent : undefined) as
    | (typeof DeviceOrientationEvent & { requestPermission?: () => Promise<"granted" | "denied"> })
    | undefined;
  if (!Ctor) {
    permission = "unsupported";
    return permission;
  }
  if (typeof Ctor.requestPermission !== "function") {
    permission = "granted";
    return permission;
  }
  try {
    permission = await Ctor.requestPermission();
  } catch {
    permission = "denied";
  }
  return permission;
}

const ZEE = new THREE.Vector3(0, 0, 1);
const Q1 = new THREE.Quaternion(-Math.sqrt(0.5), 0, 0, Math.sqrt(0.5)); // camera looks out the back of the device
const EULER = new THREE.Euler();
const Q0 = new THREE.Quaternion();
const D2R = Math.PI / 180;

function screenAngle(): number {
  const o = window.screen?.orientation?.angle;
  if (typeof o === "number") return o;
  const legacy = (window as unknown as { orientation?: number }).orientation;
  return typeof legacy === "number" ? legacy : 0;
}

/**
 * Smoothed camera rotation from DeviceOrientationEvent (same maths as three's DeviceOrientationControls; rotation only,
 * position is never tracked). Without usable events it sways slowly by itself (`active` stays false).
 */
export class OrientationTracker {
  /** True once a real event with angles has arrived. */
  active = false;
  readonly quaternion = new THREE.Quaternion();
  private target = new THREE.Quaternion();
  private started = 0;
  private sway = new THREE.Quaternion();

  private onEvent = (e: DeviceOrientationEvent) => {
    if (permission === "denied" || e.alpha == null || e.beta == null || e.gamma == null) return;
    EULER.set(e.beta * D2R, e.alpha * D2R, -e.gamma * D2R, "YXZ");
    this.target.setFromEuler(EULER);
    this.target.multiply(Q1);
    this.target.multiply(Q0.setFromAxisAngle(ZEE, -screenAngle() * D2R));
    if (!this.active) this.quaternion.copy(this.target);
    this.active = true;
  };

  start() {
    this.started = performance.now();
    window.addEventListener("deviceorientation", this.onEvent);
  }

  stop() {
    window.removeEventListener("deviceorientation", this.onEvent);
  }

  /** True when no event came within `ms` of start (or access was denied). */
  isFallback(ms = 1500): boolean {
    return permission === "denied" || (!this.active && performance.now() - this.started > ms);
  }

  update(dt: number, now: number, reduced: boolean) {
    if (this.active) {
      this.quaternion.slerp(this.target, 1 - Math.exp(-dt * 14));
    } else {
      const s = reduced ? 0 : 1;
      EULER.set(Math.sin(now / 2600) * 0.05 * s, Math.sin(now / 3400) * 0.09 * s, 0, "YXZ");
      this.sway.setFromEuler(EULER);
      this.quaternion.slerp(this.sway, 1 - Math.exp(-dt * 4));
    }
  }
}
