"use client";

import { useEffect, useRef, type RefObject } from "react";

/** Device tilt relative to the first reading (degrees). `active` turns true once a real event with angles arrives. */
export type DeviceTilt = { active: boolean; dBeta: number; dGamma: number };

/** Raw beta/gamma difference from the orientation at the moment the hook started listening. Read `.current` inside an animation frame. */
export function useDeviceTilt(): RefObject<DeviceTilt> {
  const ref = useRef<DeviceTilt>({ active: false, dBeta: 0, dGamma: 0 });
  useEffect(() => {
    let base: { b: number; g: number } | null = null;
    const state = ref.current;
    const onEvent = (e: DeviceOrientationEvent) => {
      if (e.beta == null || e.gamma == null) return;
      if (!base) base = { b: e.beta, g: e.gamma };
      state.active = true;
      state.dBeta = e.beta - base.b;
      state.dGamma = e.gamma - base.g;
    };
    window.addEventListener("deviceorientation", onEvent);
    return () => window.removeEventListener("deviceorientation", onEvent);
  }, []);
  return ref;
}
