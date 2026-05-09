import type { HapticPatternName } from "./types";

/**
 * Palette: maps {toolId, eventName} → haptic pattern.  Mirrors the shape of
 * src/lib/sonification/palette.ts so maintainers can copy entries across
 * engines.  Falls back to the "ui" surface bucket for unknown tool IDs.
 */
export const HAPTIC_PALETTE: Record<string, Record<string, HapticPatternName>> = {
  // UI surface — generic clicks/hovers/state changes
  ui: {
    "click-default": "tick",
    "click-primary": "impact-light",
    "click-destructive": "impact-heavy",
    "click-outline": "tick",
    "click-secondary": "tick",
    "click-ghost": "tick",
    "state-open": "double-tick",
    "state-close": "tick",
    "state-checked": "toggle-on",
    "state-unchecked": "toggle-off",
    "input-focus": "tick",
    "toast-success": "success",
    "toast-error": "error",
    "toast-warning": "warning",
    navigate: "navigate",
    refresh: "refresh",
    undo: "undo",
    // Drag lifecycle — SonifiedDndContext emits these for every @dnd-kit tool
    "drag-start": "drag-pickup",
    "drag-drop": "drag-drop",
    "drag-end": "tick",
  },
  // Realtime surface
  rt: {
    "member-join": "double-tick",
    "member-leave": "tick",
    "sync-remote": "soft-pulse",
  },
  // Planning Poker
  "planning-poker": {
    vote: "vote-cast",
    reveal: "reveal",
    reset: "undo",
    "card-flip": "card-flip",
    "consensus-reached": "achievement",
    "story-advance": "navigate",
  },
  // Ceremony Timer — actual events fired by the client
  "ceremony-timer": {
    start: "impact-light",
    pause: "tick",
    reset: "undo",
    "ten-seconds": "warning",
    "minute-mark": "tick",
    finish: "timer-end",
    rotate: "double-tick",
  },
  // Retro
  retro: {
    "vote-up": "vote-cast",
    "vote-down": "undo",
    "card-add": "tick",
    "card-delete": "impact-heavy",
    "column-create": "milestone",
    "phase-advance": "navigate",
    vote: "vote-cast",
  },
  // Kanban
  kanban: {
    "card-add": "tick",
    "card-move": "soft-pulse",
    "card-done": "achievement",
  },
  // NPS / CSAT
  "nps-csat": {
    "score-promoter": "success",
    "score-passive": "tick",
    "score-detractor": "warning",
  },
  // Hypothesis tracker
  "hypothesis-tracker": {
    validated: "achievement",
    invalidated: "warning",
    "status-change": "tick",
  },
  // Impediments
  impediments: {
    "impediment-raised": "warning",
    "impediment-resolved": "success",
  },
  // Risk register
  "risk-register": { "risk-added": "warning", "risk-mitigated": "success" },
  // Mood tracker
  "mood-tracker": {
    "mood-good": "success",
    "mood-neutral": "tick",
    "mood-bad": "warning",
  },
  // Capacity / velocity / metrics
  "capacity-planner": { "member-add": "tick", "member-remove": "impact-heavy" },
  velocity: { "sprint-add": "tick", "sprint-remove": "impact-heavy" },
  // Ice breaker
  icebreaker: { shuffle: "reveal", pick: "vote-cast" },
  // Gamification
  gamification: { "xp-gain": "soft-pulse", "level-up": "achievement", "trophy-unlock": "milestone" },
};

export function getHapticEntry(toolId: string, eventName: string): HapticPatternName | null {
  const toolMap = HAPTIC_PALETTE[toolId];
  if (toolMap && toolMap[eventName]) return toolMap[eventName];
  // Fallback to UI surface if the event name exists there
  if (HAPTIC_PALETTE.ui[eventName]) return HAPTIC_PALETTE.ui[eventName];
  return null;
}
