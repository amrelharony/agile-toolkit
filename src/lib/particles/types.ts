/**
 * Shared message protocol for the particle engine.
 *
 * The same engine module runs in either a dedicated Worker (with a
 * transferred OffscreenCanvas) or on the main thread as a fallback.
 * These types describe what the React component sends; OutboundMsg is
 * what the worker replies with.
 */

export interface EngineConfig {
  width: number;
  height: number;
  dpr: number;
  /** Resolved CSS color string for particle fills, e.g. "#00e1ff" */
  accent: string;
  /** Resolved CSS color string for constellation strokes, e.g. "#6366f1" */
  accent2: string;
  /** When true the engine renders a single static frame and does not animate. */
  reducedMotion: boolean;
}

export type InboundMsg =
  | { type: "init"; canvas: OffscreenCanvas; cfg: EngineConfig }
  | { type: "resize"; width: number; height: number; dpr: number }
  | { type: "pointer"; x: number; y: number; active: boolean }
  | { type: "orientation"; gamma: number | null; beta: number | null }
  | { type: "theme"; accent: string; accent2: string }
  | { type: "reducedMotion"; value: boolean }
  | { type: "pause" }
  | { type: "resume" }
  | { type: "dispose" };

export type OutboundMsg = { type: "ready" } | { type: "error"; message: string };
