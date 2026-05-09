import type { HapticPatternName, HapticPatternSpec } from "./types";

/**
 * 24-pattern haptics library. Each spec carries both a navigator.vibrate pattern
 * and an iOS CSS-pulse shadow (since iOS Safari does not support vibrate).
 * Priority patterns bypass rate-limit/cooldown/suppression gates.
 */
export const PATTERNS: Record<HapticPatternName, HapticPatternSpec> = {
  tick:              { vibrate: [10],                    ios: { cssScale: 0.988, durationMs: 80 },  category: "ui" },
  "double-tick":     { vibrate: [10, 30, 10],            ios: { cssScale: 0.985, durationMs: 120 }, category: "ui" },
  "triple-tick":     { vibrate: [8, 25, 8, 25, 8],       ios: { cssScale: 0.985, durationMs: 140 }, category: "ui" },
  success:           { vibrate: [15, 40, 25],            ios: { cssScale: 0.982, durationMs: 140 }, category: "toasts" },
  error:             { vibrate: [50, 80, 50, 80, 50],    ios: { cssScale: 0.97, durationMs: 260 },  category: "error", priority: true },
  warning:           { vibrate: [30, 60, 30],            ios: { cssScale: 0.978, durationMs: 180 }, category: "toasts" },
  "impact-light":    { vibrate: [15],                    ios: { cssScale: 0.985, durationMs: 90 },  category: "ui" },
  "impact-medium":   { vibrate: [25],                    ios: { cssScale: 0.98, durationMs: 110 },  category: "ui" },
  "impact-heavy":    { vibrate: [40],                    ios: { cssScale: 0.975, durationMs: 130 }, category: "ui" },
  "soft-pulse":      { vibrate: [6, 20, 6],              ios: { cssScale: 0.99, durationMs: 110 },  category: "ui" },
  "long-press-confirm": { vibrate: [8, 50, 8, 50, 20],   ios: { cssScale: 0.97, durationMs: 180 },  category: "ui" },
  "drag-pickup":     { vibrate: [12, 30, 8],             ios: { cssScale: 0.985, durationMs: 130 }, category: "drag" },
  "drag-drop":       { vibrate: [8, 20, 12, 20, 8],      ios: { cssScale: 0.982, durationMs: 160 }, category: "drag" },
  "card-flip":       { vibrate: [8, 12, 8],              ios: { cssScale: 0.99, durationMs: 100 },  category: "voting" },
  reveal:            { vibrate: [10, 30, 10, 30, 20],    ios: { cssScale: 0.982, durationMs: 180 }, category: "voting" },
  "vote-cast":       { vibrate: [15, 20, 10],            ios: { cssScale: 0.985, durationMs: 120 }, category: "voting" },
  "timer-tick":      { vibrate: [5],                     ios: { cssScale: 0.995, durationMs: 60 },  category: "timer" },
  "timer-end":       { vibrate: [80, 80, 80, 80, 150],   ios: { cssScale: 0.96, durationMs: 320 },  category: "timer", priority: true },
  milestone:         { vibrate: [20, 50, 20, 50, 40],    ios: { cssScale: 0.975, durationMs: 200 }, category: "ceremonies", priority: true },
  achievement:       { vibrate: [15, 30, 15, 30, 15, 30, 50], ios: { cssScale: 0.97, durationMs: 260 }, category: "ceremonies", priority: true },
  undo:              { vibrate: [8, 25, 8],              ios: { cssScale: 0.988, durationMs: 110 }, category: "ui" },
  refresh:           { vibrate: [10, 15, 10],            ios: { cssScale: 0.99, durationMs: 90 },   category: "ui" },
  navigate:          { vibrate: [6, 10, 6],              ios: { cssScale: 0.993, durationMs: 70 },  category: "ui" },
  "toggle-on":       { vibrate: [10],                    ios: { cssScale: 0.99, durationMs: 90 },   category: "ui" },
  "toggle-off":      { vibrate: [8],                     ios: { cssScale: 0.99, durationMs: 80 },   category: "ui" },
};

export function getPattern(name: string): HapticPatternSpec | null {
  return (PATTERNS as Record<string, HapticPatternSpec>)[name] ?? null;
}

const ESSENTIAL = new Set<HapticPatternName>([
  "error",
  "success",
  "timer-end",
  "achievement",
  "milestone",
]);

export function isEssential(name: HapticPatternName): boolean {
  return ESSENTIAL.has(name);
}

/** Downgrade a pattern when battery is low — any impact-* becomes a tick. */
export function downgradePattern(name: HapticPatternName): HapticPatternName {
  if (name.startsWith("impact-")) return "tick";
  if (name === "drag-drop" || name === "reveal") return "double-tick";
  if (name === "achievement" || name === "milestone") return "success";
  return name;
}
