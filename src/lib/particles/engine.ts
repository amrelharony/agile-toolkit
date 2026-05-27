/**
 * Particle physics + render engine. Pure — no React, no DOM listeners.
 * Runs identically inside a dedicated Worker (with a transferred
 * OffscreenCanvas) or on the main thread (HTMLCanvasElement) as the
 * fallback when OffscreenCanvas is unavailable.
 *
 * State is held in Float32Arrays (struct-of-arrays) for cache locality;
 * the hot loops in `step` and `render` walk them sequentially.
 */

import type { EngineConfig } from "./types";

const REPEL_R = 200;
const REPEL_R2 = REPEL_R * REPEL_R;
const CD = 140;
const CD2 = CD * CD;
const PARTICLE_AREA = 14000;
const COUNT_MIN = 60;
const COUNT_MAX = 160;

interface ColorTriple {
  r: number;
  g: number;
  b: number;
}

function parseColor(input: string): ColorTriple {
  let s = input.trim();
  if (s.startsWith("#")) s = s.slice(1);
  if (s.length === 3)
    s = s
      .split("")
      .map((c) => c + c)
      .join("");
  if (s.length !== 6) return { r: 0, g: 225, b: 255 };
  const v = parseInt(s, 16);
  if (Number.isNaN(v)) return { r: 0, g: 225, b: 255 };
  return { r: (v >> 16) & 0xff, g: (v >> 8) & 0xff, b: v & 0xff };
}

function clamp(v: number, lo: number, hi: number): number {
  return v < lo ? lo : v > hi ? hi : v;
}
function lerp(a: number, b: number, t: number): number {
  return a + (b - a) * t;
}

type RafGlobal = {
  requestAnimationFrame: (cb: FrameRequestCallback) => number;
  cancelAnimationFrame: (handle: number) => void;
};

export class ParticleEngine {
  private px!: Float32Array;
  private py!: Float32Array;
  private vx!: Float32Array;
  private vy!: Float32Array;
  private phase!: Float32Array;
  private baseR!: Float32Array;
  private n = 0;

  private canvas: HTMLCanvasElement | OffscreenCanvas;
  private ctx: CanvasRenderingContext2D | OffscreenCanvasRenderingContext2D;

  private w: number;
  private h: number;
  private dpr: number;
  private accentRGB: ColorTriple;
  private accent2RGB: ColorTriple;
  private reducedMotion: boolean;

  private pointer = { x: -1e6, y: -1e6, active: false };
  private tilt = { gx: 0, gy: 0 };
  private rawTilt = { gx: 0, gy: 0 };

  private t = 0;
  private last = 0;
  private rafId: number | null = null;
  private running = false;
  private disposed = false;

  constructor(canvas: HTMLCanvasElement | OffscreenCanvas, cfg: EngineConfig) {
    this.canvas = canvas;
    this.w = cfg.width;
    this.h = cfg.height;
    this.dpr = cfg.dpr;
    this.accentRGB = parseColor(cfg.accent);
    this.accent2RGB = parseColor(cfg.accent2);
    this.reducedMotion = cfg.reducedMotion;

    const ctx = (canvas as HTMLCanvasElement).getContext("2d") as
      | CanvasRenderingContext2D
      | OffscreenCanvasRenderingContext2D
      | null;
    if (!ctx) throw new Error("particle: 2d context unavailable");
    this.ctx = ctx;

    this.applySize();
    this.initParticles();
  }

  private applySize(): void {
    const { w, h, dpr } = this;
    this.canvas.width = Math.max(1, Math.round(w * dpr));
    this.canvas.height = Math.max(1, Math.round(h * dpr));
    this.ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
  }

  private initParticles(): void {
    const area = this.w * this.h;
    const n = clamp(Math.round(area / PARTICLE_AREA), COUNT_MIN, COUNT_MAX);
    this.n = n;
    this.px = new Float32Array(n);
    this.py = new Float32Array(n);
    this.vx = new Float32Array(n);
    this.vy = new Float32Array(n);
    this.phase = new Float32Array(n);
    this.baseR = new Float32Array(n);
    for (let i = 0; i < n; i++) {
      this.px[i] = Math.random() * this.w;
      this.py[i] = Math.random() * this.h;
      this.vx[i] = (Math.random() - 0.5) * 0.08;
      this.vy[i] = (Math.random() - 0.5) * 0.08;
      this.phase[i] = Math.random() * Math.PI * 2;
      this.baseR[i] = 0.7 + Math.random() * 1.1;
    }
  }

  resize(w: number, h: number, dpr: number): void {
    this.w = w;
    this.h = h;
    this.dpr = dpr;
    this.applySize();
    this.initParticles();
    // applySize() clears the canvas via the width-set side effect. If the
    // rAF loop is running it will paint on the next tick, but when paused
    // (reduced-motion, tab hidden) we'd be stuck on a blank canvas.
    if (!this.running) this.render();
  }

  setPointer(x: number, y: number, active: boolean): void {
    this.pointer.x = x;
    this.pointer.y = y;
    this.pointer.active = active;
  }

  setOrientation(gamma: number | null, beta: number | null): void {
    const gx = gamma == null || Math.abs(gamma) < 5 ? 0 : clamp(gamma / 45, -1, 1);
    const gy = beta == null || Math.abs(beta) < 5 ? 0 : clamp(beta / 45, -1, 1);
    this.rawTilt.gx = gx;
    this.rawTilt.gy = gy;
  }

  setTheme(accent: string, accent2: string): void {
    this.accentRGB = parseColor(accent);
    this.accent2RGB = parseColor(accent2);
  }

  setReducedMotion(value: boolean): void {
    const wasReduced = this.reducedMotion;
    this.reducedMotion = value;
    if (value) {
      this.pause();
      this.render();
    } else if (wasReduced && !this.running) {
      this.start();
    }
  }

  start(): void {
    if (this.disposed || this.running) return;
    // Reduced-motion: paint one static frame and never schedule rAF.
    // Prevents wasted 60 Hz render loops on resume-from-hidden when the
    // user has motion disabled.
    if (this.reducedMotion) {
      this.render();
      return;
    }
    this.running = true;
    const g = globalThis as unknown as RafGlobal;
    this.last = typeof performance !== "undefined" ? performance.now() : Date.now();
    const loop = (now: number) => {
      if (!this.running || this.disposed) return;
      // Cap dt so a long pause (tab hidden) doesn't fire one giant step.
      const dt = Math.min(64, now - this.last);
      this.last = now;
      this.t += dt;
      this.step(dt);
      this.render();
      this.rafId = g.requestAnimationFrame(loop);
    };
    this.rafId = g.requestAnimationFrame(loop);
  }

  pause(): void {
    this.running = false;
    if (this.rafId != null) {
      const g = globalThis as unknown as RafGlobal;
      g.cancelAnimationFrame(this.rafId);
      this.rafId = null;
    }
  }

  dispose(): void {
    this.pause();
    this.disposed = true;
  }

  step(dt: number): void {
    this.tilt.gx = lerp(this.tilt.gx, this.rawTilt.gx, 0.05);
    this.tilt.gy = lerp(this.tilt.gy, this.rawTilt.gy, 0.05);

    const { px, py, vx, vy, n, w, h } = this;
    const pAct = this.pointer.active;
    const pxr = this.pointer.x;
    const pyr = this.pointer.y;
    const gx = this.tilt.gx;
    const gy = this.tilt.gy;
    const tiltScale = 0.00005 * dt;
    const drag = Math.pow(0.985, dt / 16.667);
    const repelScale = (0.6 * dt) / 16;

    for (let i = 0; i < n; i++) {
      let vix = vx[i] + gx * tiltScale;
      let viy = vy[i] + gy * tiltScale;

      if (pAct) {
        const dx = px[i] - pxr;
        const dy = py[i] - pyr;
        const d2 = dx * dx + dy * dy;
        if (d2 < REPEL_R2 && d2 > 0) {
          const d = Math.sqrt(d2 < 16 ? 16 : d2);
          const f = (1 - d / REPEL_R) / d;
          vix += dx * f * repelScale;
          viy += dy * f * repelScale;
        }
      }

      vix *= drag;
      viy *= drag;

      let nx = px[i] + vix * dt;
      let ny = py[i] + viy * dt;
      if (nx < -10) nx += w + 20;
      else if (nx > w + 10) nx -= w + 20;
      if (ny < -10) ny += h + 20;
      else if (ny > h + 10) ny -= h + 20;

      px[i] = nx;
      py[i] = ny;
      vx[i] = vix;
      vy[i] = viy;
    }
  }

  render(): void {
    const { ctx, w, h, px, py, baseR, phase, n, t } = this;
    ctx.clearRect(0, 0, w, h);

    const a2 = this.accent2RGB;
    ctx.lineWidth = 1;
    for (let i = 0; i < n - 1; i++) {
      const xi = px[i];
      const yi = py[i];
      for (let j = i + 1; j < n; j++) {
        const dx = px[j] - xi;
        const dy = py[j] - yi;
        const d2 = dx * dx + dy * dy;
        if (d2 < CD2) {
          const alpha = (1 - Math.sqrt(d2) / CD) * 0.18;
          ctx.strokeStyle = `rgba(${a2.r},${a2.g},${a2.b},${alpha})`;
          ctx.beginPath();
          ctx.moveTo(xi, yi);
          ctx.lineTo(px[j], py[j]);
          ctx.stroke();
        }
      }
    }

    const a = this.accentRGB;
    ctx.fillStyle = `rgba(${a.r},${a.g},${a.b},0.55)`;
    for (let i = 0; i < n; i++) {
      const r = baseR[i] + Math.sin((t + phase[i] * 1000) * 0.002) * 0.6;
      ctx.beginPath();
      ctx.arc(px[i], py[i], r > 0.1 ? r : 0.1, 0, Math.PI * 2);
      ctx.fill();
    }
  }
}
