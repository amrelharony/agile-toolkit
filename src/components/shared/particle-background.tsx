"use client";

/**
 * Ambient particle field rendered into a full-viewport canvas.
 *
 * Primary path: transfers the canvas to a Web Worker via
 * `transferControlToOffscreen()` so all physics + drawing happens off
 * the main thread. Fallback (older Safari etc.): the same engine runs
 * on the main thread. Gated by `prefers-reduced-motion`; pauses when
 * the tab is hidden.
 *
 * StrictMode note: `transferControlToOffscreen` is one-shot per canvas,
 * so the worker and engine are kept in refs and never torn down on
 * cleanup. This component lives in the root layout for the page
 * lifetime; the worker is GC'd when the page unloads. Only DOM
 * listeners are detached/re-attached across effect cycles.
 */

import { useEffect, useRef } from "react";
import { ParticleEngine } from "@/lib/particles/engine";
import type { EngineConfig, InboundMsg } from "@/lib/particles/types";

function readAccents(): { accent: string; accent2: string } {
  const cs = getComputedStyle(document.documentElement);
  const accent = cs.getPropertyValue("--accent").trim() || "#00e1ff";
  const accent2 = cs.getPropertyValue("--accent2").trim() || "#6366f1";
  return { accent, accent2 };
}

function readDpr(): number {
  return Math.min(window.devicePixelRatio || 1, 1.75);
}

type CanvasWithTransfer = HTMLCanvasElement & {
  transferControlToOffscreen?: () => OffscreenCanvas;
};

type Mode = "worker" | "main" | "off";

export function ParticleBackground() {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const workerRef = useRef<Worker | null>(null);
  const engineRef = useRef<ParticleEngine | null>(null);
  const modeRef = useRef<Mode>("off");

  useEffect(() => {
    if (typeof window === "undefined") return;
    const canvas = canvasRef.current;
    if (!canvas) return;

    const mqReduce = window.matchMedia("(prefers-reduced-motion: reduce)");

    // First-time setup. Subsequent effect runs (e.g. React 18 StrictMode
    // double-fire) skip this block — the worker and engine persist across
    // cycles because the canvas can only be transferred once.
    if (modeRef.current === "off" && !workerRef.current && !engineRef.current) {
      const cfg: EngineConfig = {
        width: window.innerWidth,
        height: window.innerHeight,
        dpr: readDpr(),
        ...readAccents(),
        reducedMotion: mqReduce.matches,
      };

      const canTryWorker =
        typeof Worker !== "undefined" &&
        typeof OffscreenCanvas !== "undefined" &&
        typeof (canvas as CanvasWithTransfer).transferControlToOffscreen === "function";

      if (canTryWorker) {
        let attempted: Worker | null = null;
        try {
          attempted = new Worker(new URL("../../lib/workers/particle.worker.ts", import.meta.url), {
            type: "module",
          });
          const off = (canvas as CanvasWithTransfer).transferControlToOffscreen!();
          attempted.postMessage({ type: "init", canvas: off, cfg }, [off]);
          workerRef.current = attempted;
          modeRef.current = "worker";
        } catch {
          attempted?.terminate();
        }
      }

      if (modeRef.current === "off") {
        try {
          const eng = new ParticleEngine(canvas, cfg);
          eng.start();
          engineRef.current = eng;
          modeRef.current = "main";
        } catch {
          // Both paths failed — canvas stays blank, layout unaffected.
          return;
        }
      }
    }

    const send = (msg: InboundMsg) => {
      const mode = modeRef.current;
      if (mode === "worker" && workerRef.current) {
        workerRef.current.postMessage(msg);
        return;
      }
      const engine = engineRef.current;
      if (mode !== "main" || !engine) return;
      switch (msg.type) {
        case "resize":
          engine.resize(msg.width, msg.height, msg.dpr);
          return;
        case "pointer":
          engine.setPointer(msg.x, msg.y, msg.active);
          return;
        case "orientation":
          engine.setOrientation(msg.gamma, msg.beta);
          return;
        case "theme":
          engine.setTheme(msg.accent, msg.accent2);
          return;
        case "reducedMotion":
          engine.setReducedMotion(msg.value);
          return;
        case "pause":
          engine.pause();
          return;
        case "resume":
          engine.start();
          return;
        case "dispose":
          engine.dispose();
          return;
      }
    };

    // StrictMode cleanup may have paused the engine; make sure it's running
    // (unless reduced-motion is on).
    if (!mqReduce.matches) send({ type: "resume" });

    const emitResize = () => {
      send({
        type: "resize",
        width: window.innerWidth,
        height: window.innerHeight,
        dpr: readDpr(),
      });
    };

    const ro = new ResizeObserver(emitResize);
    ro.observe(document.body);
    // Emit an initial resize so DPR + viewport reflect the live window
    // after the (possibly stale) cfg used at first setup.
    emitResize();

    let dprMq: MediaQueryList | null = null;
    try {
      dprMq = window.matchMedia(`(resolution: ${window.devicePixelRatio}dppx)`);
      dprMq.addEventListener("change", emitResize);
    } catch {
      // Older browsers reject non-standard resolution units; skip.
    }

    let pending: { x: number; y: number } | null = null;
    let rafScheduled = false;
    const onPointerMove = (e: PointerEvent) => {
      pending = { x: e.clientX, y: e.clientY };
      if (rafScheduled) return;
      rafScheduled = true;
      requestAnimationFrame(() => {
        rafScheduled = false;
        if (pending) {
          send({ type: "pointer", x: pending.x, y: pending.y, active: true });
          pending = null;
        }
      });
    };
    const onPointerLeave = () => {
      send({ type: "pointer", x: -1e6, y: -1e6, active: false });
    };
    window.addEventListener("pointermove", onPointerMove, { passive: true });
    window.addEventListener("pointerleave", onPointerLeave);

    const onOrientation = (e: DeviceOrientationEvent) => {
      send({ type: "orientation", gamma: e.gamma, beta: e.beta });
    };
    const hasOrientation = typeof window.DeviceOrientationEvent !== "undefined";
    if (hasOrientation) {
      window.addEventListener("deviceorientation", onOrientation, {
        passive: true,
      } as AddEventListenerOptions);
    }

    const onVisibility = () => {
      send({ type: document.hidden ? "pause" : "resume" });
    };
    document.addEventListener("visibilitychange", onVisibility);

    const onReduceChange = (e: MediaQueryListEvent) => {
      send({ type: "reducedMotion", value: e.matches });
    };
    mqReduce.addEventListener("change", onReduceChange);

    const themeMO = new MutationObserver(() => {
      const { accent, accent2 } = readAccents();
      send({ type: "theme", accent, accent2 });
    });
    themeMO.observe(document.documentElement, {
      attributes: true,
      attributeFilter: ["class", "data-theme"],
    });

    return () => {
      // Detach listeners only. The worker/engine persists for the page
      // lifetime — see file header for rationale.
      ro.disconnect();
      themeMO.disconnect();
      dprMq?.removeEventListener("change", emitResize);
      window.removeEventListener("pointermove", onPointerMove);
      window.removeEventListener("pointerleave", onPointerLeave);
      if (hasOrientation) {
        window.removeEventListener("deviceorientation", onOrientation);
      }
      document.removeEventListener("visibilitychange", onVisibility);
      mqReduce.removeEventListener("change", onReduceChange);
    };
  }, []);

  return (
    <canvas
      ref={canvasRef}
      aria-hidden="true"
      style={{
        position: "fixed",
        inset: 0,
        // Use `100dvh` so the canvas matches the dynamic visible viewport
        // on iOS — `100vh` includes the URL bar, leaving an ~80 px particle
        // band BELOW the visible content. The body in globals.css already
        // does the `100vh` → `100dvh` cascade for older Safari.
        width: "100vw",
        height: "100dvh",
        pointerEvents: "none",
        zIndex: -1,
      }}
    />
  );
}
