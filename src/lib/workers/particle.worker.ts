/**
 * Particle engine worker entry. Mirrors compute.worker.ts's shape:
 * a single switch dispatching incoming messages to a long-lived
 * ParticleEngine instance that owns the transferred OffscreenCanvas.
 */

import { ParticleEngine } from "@/lib/particles/engine";
import type { InboundMsg, OutboundMsg } from "@/lib/particles/types";

let engine: ParticleEngine | null = null;

declare const self: {
  onmessage: ((e: MessageEvent<InboundMsg>) => void) | null;
  postMessage: (data: OutboundMsg) => void;
};

self.onmessage = (e: MessageEvent<InboundMsg>) => {
  const msg = e.data;
  try {
    switch (msg.type) {
      case "init": {
        engine?.dispose();
        engine = new ParticleEngine(msg.canvas, msg.cfg);
        engine.start();
        self.postMessage({ type: "ready" });
        return;
      }
      case "resize": {
        engine?.resize(msg.width, msg.height, msg.dpr);
        return;
      }
      case "pointer": {
        engine?.setPointer(msg.x, msg.y, msg.active);
        return;
      }
      case "orientation": {
        engine?.setOrientation(msg.gamma, msg.beta);
        return;
      }
      case "theme": {
        engine?.setTheme(msg.accent, msg.accent2);
        return;
      }
      case "reducedMotion": {
        engine?.setReducedMotion(msg.value);
        return;
      }
      case "pause": {
        engine?.pause();
        return;
      }
      case "resume": {
        engine?.start();
        return;
      }
      case "dispose": {
        engine?.dispose();
        engine = null;
        return;
      }
    }
  } catch (err) {
    self.postMessage({ type: "error", message: (err as Error).message });
  }
};
