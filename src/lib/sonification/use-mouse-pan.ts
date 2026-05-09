"use client";

import { useEffect } from "react";
import { getEngine } from "./engine";

export function useMousePan(enabled: boolean) {
  useEffect(() => {
    if (!enabled) return;
    if (typeof window === "undefined") return;
    let rafId = 0;
    let latestX = -1;

    const onMove = (e: MouseEvent) => {
      latestX = e.clientX;
      if (rafId) return;
      rafId = window.requestAnimationFrame(() => {
        rafId = 0;
        const w = window.innerWidth || 1;
        const x01 = Math.max(0, Math.min(1, latestX / w));
        getEngine().setPan(x01);
      });
    };

    window.addEventListener("mousemove", onMove, { passive: true });
    return () => {
      window.removeEventListener("mousemove", onMove);
      if (rafId) window.cancelAnimationFrame(rafId);
    };
  }, [enabled]);
}
