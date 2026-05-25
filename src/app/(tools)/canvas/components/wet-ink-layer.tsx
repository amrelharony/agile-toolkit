"use client";

import { useEffect, useRef, type RefObject, type MutableRefObject } from "react";
import type { Camera } from "@/lib/geometry/bbox";

/**
 * Low-latency "wet ink" preview for the in-flight freehand stroke.
 *
 * The committed freehand path is rendered by ObjectRenderer through React +
 * SVG, which is fine for static strokes but adds ~1 frame of input→pixel
 * latency for the in-progress one. On a stylus that's perceivable as a
 * laggy trailing line. This layer side-steps React for the active stroke:
 *
 *  - Mounts a single full-viewport <canvas> overlay.
 *  - Imperative drawing: callers push the latest sample via `inkRef`'s
 *    `push(x,y,pressure)` and the layer draws the new segment directly
 *    with `lineTo`. Width is modulated by pressure.
 *  - `reset()` clears the canvas (called on pointer-up after the commit).
 *  - DPI-aware: sizes the backing store to viewport × devicePixelRatio so
 *    strokes stay crisp on the Xiaomi Pad's ~2× DPR display.
 *
 * Pointer-events: none so it never steals input. The pointer machine still
 * owns capture; this layer is a read-only mirror of what the machine
 * already collected.
 */

export interface WetInkApi {
  begin(stroke: { color: string; width: number }): void;
  push(worldX: number, worldY: number, pressure: number): void;
  reset(): void;
}

interface WetInkLayerProps {
  viewportRef: RefObject<HTMLDivElement | null>;
  camera: Camera;
  /** Mutable ref the pointer machine writes into. The layer exposes its
   *  imperative API by assigning to `apiRef.current` on mount. */
  apiRef: MutableRefObject<WetInkApi | null>;
}

export function WetInkLayer({ viewportRef, camera, apiRef }: WetInkLayerProps) {
  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  // Stash camera in a ref so the imperative push() reads the latest
  // value without rebinding the API on every camera change.
  const cameraRef = useRef(camera);
  cameraRef.current = camera;
  // Last-point + style state for the current stroke; lives in a ref so
  // the React lifecycle never touches it during the hot drawing loop.
  const strokeRef = useRef<{
    lastX: number;
    lastY: number;
    color: string;
    width: number;
    active: boolean;
  } | null>(null);

  // Resize the backing store to match viewport × DPR. Re-runs whenever
  // the viewport size changes (orientation flip, window resize). A
  // ResizeObserver beats `window.resize` because the canvas viewport
  // is often re-sized by panel collapses that don't fire window events.
  useEffect(() => {
    const canvas = canvasRef.current;
    const viewport = viewportRef.current;
    if (!canvas || !viewport) return;
    const apply = () => {
      const rect = viewport.getBoundingClientRect();
      const dpr = window.devicePixelRatio || 1;
      canvas.width = Math.max(1, Math.floor(rect.width * dpr));
      canvas.height = Math.max(1, Math.floor(rect.height * dpr));
      canvas.style.width = `${rect.width}px`;
      canvas.style.height = `${rect.height}px`;
      const ctx = canvas.getContext("2d");
      if (ctx) {
        // Map 1 canvas unit to 1 CSS pixel — all drawing math then uses
        // CSS pixels and Chrome handles the DPR scale at composite.
        ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
        ctx.lineCap = "round";
        ctx.lineJoin = "round";
      }
    };
    apply();
    const ro = new ResizeObserver(apply);
    ro.observe(viewport);
    window.addEventListener("orientationchange", apply);
    return () => {
      ro.disconnect();
      window.removeEventListener("orientationchange", apply);
    };
  }, [viewportRef]);

  // Wire the imperative API. The pointer machine reads apiRef.current
  // synchronously inside the pointer-move handler, so the binding lives
  // on a ref and only rebinds when the underlying canvas element does.
  useEffect(() => {
    apiRef.current = {
      begin: ({ color, width }: { color: string; width: number }) => {
        const ctx = canvasRef.current?.getContext("2d");
        if (!ctx) return;
        strokeRef.current = { lastX: 0, lastY: 0, color, width, active: false };
        ctx.strokeStyle = color;
      },
      push: (worldX: number, worldY: number, pressure: number) => {
        const ctx = canvasRef.current?.getContext("2d");
        const s = strokeRef.current;
        if (!ctx || !s) return;
        const cam = cameraRef.current;
        const x = (worldX - cam.x) * cam.zoom;
        const y = (worldY - cam.y) * cam.zoom;
        // Match perfect-freehand's default-thinning width curve so the
        // committed SVG path matches the preview without a width jump
        // on pointer-up. With thinning=0.5, perfect-freehand produces
        // width = size * (0.5 + p): half at p=0, full at p=0.5, 1.5×
        // at p=1. Floor at 0.5 px so a near-zero pressure tick still
        // draws something visible.
        const p = Math.max(0.15, Math.min(1, pressure));
        ctx.lineWidth = Math.max(0.5, s.width * cam.zoom * (0.5 + p));
        if (!s.active) {
          s.lastX = x;
          s.lastY = y;
          s.active = true;
          return;
        }
        ctx.beginPath();
        ctx.moveTo(s.lastX, s.lastY);
        ctx.lineTo(x, y);
        ctx.stroke();
        s.lastX = x;
        s.lastY = y;
      },
      reset: () => {
        const canvas = canvasRef.current;
        const ctx = canvas?.getContext("2d");
        if (!canvas || !ctx) return;
        const dpr = window.devicePixelRatio || 1;
        ctx.save();
        ctx.setTransform(1, 0, 0, 1, 0, 0);
        ctx.clearRect(0, 0, canvas.width, canvas.height);
        ctx.restore();
        ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
        strokeRef.current = null;
      },
    };
    return () => {
      apiRef.current = null;
    };
  }, [apiRef]);

  return (
    <canvas
      ref={canvasRef}
      aria-hidden="true"
      data-canvas-export-ignore="true"
      style={{
        position: "absolute",
        inset: 0,
        pointerEvents: "none",
        zIndex: 9995,
      }}
    />
  );
}
