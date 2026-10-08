"use client";

import { useCallback, useEffect, useRef, useState, type RefObject } from "react";

/**
 * Starts the back camera into the given <video>. Shared by the 3D reveal.
 * Deferred by setTimeout(0) so React StrictMode's mount/unmount/mount asks for the camera once (iOS Safari kills the
 * second stream if the first is stopped). Returns a `stop` that must also be called on close.
 */
export function useCameraStream(videoRef: RefObject<HTMLVideoElement | null>) {
  const streamRef = useRef<MediaStream | null>(null);
  const [failed, setFailed] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const stop = useCallback(() => {
    streamRef.current?.getTracks().forEach((track) => track.stop());
    streamRef.current = null;
  }, []);

  useEffect(() => {
    let cancelled = false;
    async function start() {
      try {
        if (!window.isSecureContext) throw new Error("InsecureContext");
        if (!navigator.mediaDevices?.getUserMedia) throw new Error("Unsupported");
        const stream = await navigator.mediaDevices.getUserMedia({ video: { facingMode: { ideal: "environment" } }, audio: false });
        if (cancelled) {
          stream.getTracks().forEach((track) => track.stop());
          return;
        }
        streamRef.current = stream;
        const video = videoRef.current;
        if (video) {
          video.muted = true;
          video.setAttribute("playsinline", "");
          video.srcObject = stream;
          // iOS Safari can reject the first play(); retry once the metadata is in.
          const tryPlay = () => void video.play().catch(() => undefined);
          video.addEventListener("loadedmetadata", tryPlay, { once: true });
          tryPlay();
        }
      } catch (e) {
        if (!cancelled) {
          setFailed(true);
          setError(e instanceof Error ? (e.name === "Error" ? e.message : e.name) : "Unknown");
        }
      }
    }
    const timer = window.setTimeout(() => void start(), 0);
    return () => {
      cancelled = true;
      window.clearTimeout(timer);
      stop();
    };
  }, [videoRef, stop]);

  return { failed, error, stop };
}
