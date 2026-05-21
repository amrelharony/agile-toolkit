import type { PaletteMap, ToolPalette } from "./types";

/**
 * Each tool declares 2–5 named events.  Entries are data only — the engine
 * resolves scale `step`/`steps` against the currently drifted root, so every
 * sound stays in-key with the ambient filter/pan.
 */

const planningPoker: ToolPalette = {
  "card-hover": { voice: "blip", step: 3, octave: 5, velocity: 0.5 },
  vote: { voice: "pluck", step: 2, octave: 5 },
  reveal: { voice: "chord", steps: [0, 2, 4], octave: 5, duration: 0.7 },
  consensus: { voice: "chord", steps: [0, 2, 4, 7], octave: 5, duration: 1.4, filter: "bright" },
  disagreement: { voice: "dissonant", steps: [0, 1], octave: 4 },
};

const retro: ToolPalette = {
  "card-add": { voice: "pluck", step: 1, octave: 5 },
  vote: { voice: "blip", step: 4, octave: 6, velocity: 0.6 },
  "action-item": { voice: "pluck", step: 3, octave: 5, filter: "warm" },
  "phase-advance": { voice: "chord", steps: [0, 3, 5], octave: 4, duration: 1.1 },
  "reset-board": { voice: "pad", step: -2, octave: 3, duration: 1.5 },
};

const ceremonyTimer: ToolPalette = {
  start: { voice: "pluck", step: 0, octave: 4 },
  rotate: { voice: "pluck", step: 2, octave: 5 },
  "minute-mark": { voice: "blip", step: 4, octave: 5, velocity: 0.4 },
  "ten-seconds": { voice: "blip", step: 3, octave: 6, velocity: 0.7 },
  finish: { voice: "chord", steps: [0, 4, 7, 12], octave: 4, duration: 2.0 },
};

const burndown: ToolPalette = {
  "day-logged": { voice: "pluck", step: 2, octave: 5 },
  "scope-change": { voice: "dissonant", steps: [-2, 0], octave: 4, filter: "muffled" },
  reset: { voice: "pad", step: 0, octave: 3, duration: 1.2 },
};

const burnup: ToolPalette = {
  "day-logged": { voice: "pluck", step: 3, octave: 5 },
  "scope-increase": { voice: "blip", step: 5, octave: 6, jitterCents: -20 },
  reset: { voice: "pad", step: 0, octave: 3, duration: 1.2 },
};

const velocity: ToolPalette = {
  "sprint-added": { voice: "pluck", step: 2, octave: 5 },
  "record-high": { voice: "chord", steps: [0, 4, 7], octave: 5, duration: 0.8, filter: "bright" },
  "record-low": { voice: "dissonant", steps: [0, -2], octave: 4 },
};

const cumulativeFlow: ToolPalette = {
  "entry-logged": { voice: "pluck", step: 1, octave: 5 },
  "bottleneck-alert": { voice: "dissonant", steps: [0, 1], octave: 4, filter: "warm" },
};

const cycleTime: ToolPalette = {
  "item-added": { voice: "blip", step: 2, octave: 5 },
  outlier: { voice: "dissonant", steps: [0, -1], octave: 4 },
};

const sprintCompare: ToolPalette = {
  "sprint-toggled": { voice: "blip", step: 2, octave: 5 },
  "radar-update": { voice: "pluck", step: 4, octave: 5, velocity: 0.6 },
};

const healthDashboard: ToolPalette = {
  refresh: { voice: "chord", steps: [0, 2, 4], octave: 4, duration: 0.9, filter: "open" },
  "insight-surface": { voice: "pluck", step: 3, octave: 5 },
};

const capacityPlanner: ToolPalette = {
  "member-add": { voice: "pluck", step: 1, octave: 5 },
  "ceremony-toggle": { voice: "blip", step: 2, octave: 5, velocity: 0.5 },
  recalculate: { voice: "pluck", step: 4, octave: 5, filter: "warm" },
};

const storyMapper: ToolPalette = {
  "card-drag-start": { voice: "blip", step: 1, octave: 5, velocity: 0.5 },
  "card-drop": { voice: "pluck", step: 3, octave: 5 },
  "step-added": { voice: "pluck", step: 2, octave: 5 },
  "slice-added": { voice: "pluck", step: 4, octave: 5, filter: "warm" },
};

const prioritizer: ToolPalette = {
  "item-add": { voice: "pluck", step: 1, octave: 5 },
  "framework-switch": { voice: "chord", steps: [0, 2, 4], octave: 4, duration: 0.7 },
  "score-update": { voice: "blip", step: 3, octave: 5, velocity: 0.5 },
};

const estimationGuide: ToolPalette = {
  "size-picked": { voice: "pluck", step: 2, octave: 5 },
  "scale-switch": { voice: "blip", step: 4, octave: 5 },
};

const sprintGoal: ToolPalette = {
  "step-advance": { voice: "pluck", step: 2, octave: 5, filter: "bright" },
  complete: { voice: "chord", steps: [0, 4, 7], octave: 5, duration: 1.4 },
  "criterion-add": { voice: "blip", step: 3, octave: 5 },
};

const releasePlanner: ToolPalette = {
  simulate: { voice: "chord", steps: [0, 2, 4, 7], octave: 4, duration: 1.6, filter: "open" },
  "velocity-added": { voice: "pluck", step: 2, octave: 5 },
  "config-change": { voice: "blip", step: 1, octave: 5, velocity: 0.5 },
};

const standup: ToolPalette = {
  "entry-added": { voice: "pluck", step: 2, octave: 5 },
  "blocker-raised": { voice: "dissonant", steps: [0, 1], octave: 4 },
  "blocker-cleared": { voice: "chord", steps: [0, 4, 7], octave: 5, duration: 0.9, filter: "bright" },
};

const sprintReview: ToolPalette = {
  "template-picked": { voice: "pluck", step: 2, octave: 5 },
  "demo-added": { voice: "pluck", step: 3, octave: 5 },
  "feedback-logged": { voice: "blip", step: 4, octave: 6, velocity: 0.5 },
};

const refinement: ToolPalette = {
  "item-checked": { voice: "blip", step: 3, octave: 5, velocity: 0.6 },
  "all-passed": { voice: "chord", steps: [0, 4, 7], octave: 5, duration: 1.0, filter: "bright" },
  failure: { voice: "dissonant", steps: [0, -1], octave: 4 },
};

const icebreaker: ToolPalette = {
  shuffle: { voice: "blip", step: 2, octave: 6, jitterCents: 30 },
  reveal: { voice: "chord", steps: [0, 2, 4], octave: 5, duration: 0.8, filter: "open" },
};

const healthCheck: ToolPalette = {
  "dimension-voted": { voice: "pluck", step: 2, octave: 5 },
  "result-red": { voice: "dissonant", steps: [0, 1], octave: 4 },
  "result-amber": { voice: "pluck", step: 1, octave: 5, filter: "warm" },
  "result-green": { voice: "chord", steps: [0, 4, 7], octave: 5, duration: 0.8, filter: "bright" },
};

const maturity: ToolPalette = {
  "dimension-set": { voice: "pluck", step: 2, octave: 5 },
  "level-up": { voice: "chord", steps: [0, 2, 4, 7], octave: 5, duration: 1.2, filter: "bright" },
};

const raci: ToolPalette = {
  assign: { voice: "pluck", step: 2, octave: 5 },
  conflict: { voice: "dissonant", steps: [0, 1], octave: 4 },
  "matrix-complete": { voice: "chord", steps: [0, 4, 7], octave: 5, duration: 1.0 },
};

const skillsMatrix: ToolPalette = {
  "skill-assigned": { voice: "pluck", step: 2, octave: 5 },
  "bus-factor-low": { voice: "dissonant", steps: [0, -1], octave: 4, filter: "warm" },
};

const impediments: ToolPalette = {
  "impediment-raised": { voice: "dissonant", steps: [0, 1], octave: 4 },
  "impediment-resolved": { voice: "chord", steps: [0, 4, 7], octave: 5, duration: 1.0, filter: "bright" },
  "severity-changed": { voice: "blip", step: 3, octave: 5, velocity: 0.5 },
};

const piPlanning: ToolPalette = {
  "team-added": { voice: "pluck", step: 0, octave: 5 },
  "feature-planned": { voice: "pluck", step: 2, octave: 5 },
  "overload-detected": { voice: "dissonant", steps: [0, 1], octave: 4 },
  "pi-ready": { voice: "chord", steps: [0, 4, 7, 12], octave: 4, duration: 1.8, filter: "open" },
};

const epicRoadmap: ToolPalette = {
  "epic-added": { voice: "pluck", step: 2, octave: 5 },
  "progress-update": { voice: "blip", step: 3, octave: 5, velocity: 0.5 },
  "epic-complete": { voice: "chord", steps: [0, 4, 7], octave: 5, duration: 1.2, filter: "bright" },
};

const scrumOfScrums: ToolPalette = {
  "entry-logged": { voice: "pluck", step: 2, octave: 5 },
  "blocker-escalated": { voice: "dissonant", steps: [0, 1], octave: 4 },
  resolve: { voice: "chord", steps: [0, 4, 7], octave: 5, duration: 0.9, filter: "bright" },
};

const hypothesisTracker: ToolPalette = {
  "hypothesis-added": { voice: "pluck", step: 2, octave: 5 },
  validated: { voice: "chord", steps: [0, 4, 7], octave: 5, duration: 1.2, filter: "bright" },
  invalidated: { voice: "dissonant", steps: [0, -1], octave: 4 },
  "status-change": { voice: "blip", step: 3, octave: 5, velocity: 0.5 },
};

const userInterviews: ToolPalette = {
  "interview-new": { voice: "pluck", step: 1, octave: 5 },
  "quote-added": { voice: "pluck", step: 3, octave: 5 },
  "tag-added": { voice: "blip", step: 4, octave: 6, velocity: 0.5 },
};

const opportunityTree: ToolPalette = {
  "node-added": { voice: "pluck", step: 2, octave: 5 },
  "child-branch": { voice: "pluck", step: 4, octave: 5, filter: "warm" },
  prune: { voice: "dissonant", steps: [0, -1], octave: 4 },
};

const riskRegister: ToolPalette = {
  "risk-added": { voice: "dissonant", steps: [0, 1], octave: 4 },
  mitigate: { voice: "pluck", step: 3, octave: 5 },
  close: { voice: "chord", steps: [0, 4, 7], octave: 5, duration: 1.0, filter: "bright" },
  "score-critical": { voice: "dissonant", steps: [0, 1, 2], octave: 4 },
};

const techDebt: ToolPalette = {
  "debt-added": { voice: "dissonant", steps: [0, -1], octave: 4, filter: "warm" },
  "debt-resolved": { voice: "chord", steps: [0, 4, 7], octave: 5, duration: 1.0, filter: "bright" },
  "priority-change": { voice: "blip", step: 3, octave: 5, velocity: 0.5 },
};

const decisionLog: ToolPalette = {
  "adr-new": { voice: "pluck", step: 1, octave: 5 },
  accept: { voice: "chord", steps: [0, 4, 7], octave: 5, duration: 0.9, filter: "open" },
  deprecate: { voice: "dissonant", steps: [0, -1], octave: 4 },
};

const premortem: ToolPalette = {
  "cause-added": { voice: "dissonant", steps: [0, 1], octave: 4 },
  "action-plan": { voice: "pluck", step: 3, octave: 5, filter: "warm" },
  "rank-move": { voice: "blip", step: 4, octave: 6, velocity: 0.5 },
};

const dodBuilder: ToolPalette = {
  "item-added": { voice: "pluck", step: 2, octave: 5 },
  "toggle-required": { voice: "blip", step: 3, octave: 5, velocity: 0.6 },
  "category-switch": { voice: "blip", step: 4, octave: 5, velocity: 0.4 },
};

const kanban: ToolPalette = {
  "card-add": { voice: "pluck", step: 1, octave: 5 },
  "card-move": { voice: "blip", step: 3, octave: 5, velocity: 0.6 },
  "card-done": { voice: "chord", steps: [0, 4, 7], octave: 5, duration: 0.9, filter: "bright" },
  "wip-violation": { voice: "dissonant", steps: [0, 1], octave: 4 },
};

const dependencyMap: ToolPalette = {
  "node-added": { voice: "pluck", step: 2, octave: 5 },
  "edge-added": { voice: "pluck", step: 4, octave: 5, filter: "warm" },
  "cycle-detected": { voice: "dissonant", steps: [0, 1, 2], octave: 4 },
};

const valueStream: ToolPalette = {
  "stage-added": { voice: "pluck", step: 2, octave: 5 },
  "flow-efficiency-good": { voice: "chord", steps: [0, 4, 7], octave: 5, duration: 0.9, filter: "bright" },
  "flow-efficiency-bad": { voice: "dissonant", steps: [0, -1], octave: 4, filter: "warm" },
};

const okrs: ToolPalette = {
  "objective-added": { voice: "pluck", step: 0, octave: 5 },
  "kr-added": { voice: "pluck", step: 2, octave: 5 },
  "kr-updated": { voice: "blip", step: 3, octave: 5, velocity: 0.5 },
  "okr-achieved": { voice: "chord", steps: [0, 4, 7, 12], octave: 5, duration: 1.6, filter: "bright" },
};

const npsCsat: ToolPalette = {
  "score-promoter": { voice: "chord", steps: [0, 4, 7], octave: 5, duration: 0.8, filter: "bright" },
  "score-passive": { voice: "pluck", step: 2, octave: 5, filter: "warm" },
  "score-detractor": { voice: "dissonant", steps: [0, -1], octave: 4 },
};

const moodTracker: ToolPalette = {
  "mood-great": { voice: "chord", steps: [0, 4, 7], octave: 5, duration: 0.8, filter: "bright" },
  "mood-good": { voice: "pluck", step: 4, octave: 5 },
  "mood-neutral": { voice: "pluck", step: 2, octave: 5 },
  "mood-low": { voice: "pluck", step: 1, octave: 4, filter: "warm" },
  "mood-rough": { voice: "dissonant", steps: [0, -1], octave: 4 },
};

// Universal UI surfaces — used by Button, router, toast wrapper, etc.
const ui: ToolPalette = {
  // Click variants (shadcn Button's data-variant drives these)
  "click-default": { voice: "click", step: 2, octave: 5, velocity: 0.4 },
  "click-primary": { voice: "pluck", step: 4, octave: 5, velocity: 0.5 },
  "click-destructive": { voice: "dissonant", steps: [0, -1], octave: 4, velocity: 0.45 },
  "click-ghost": { voice: "click", step: 1, octave: 5, velocity: 0.3 },
  "click-outline": { voice: "click", step: 3, octave: 5, velocity: 0.35 },
  "click-secondary": { voice: "click", step: 2, octave: 5, velocity: 0.35 },
  "click-link": { voice: "blip", step: 4, octave: 6, velocity: 0.3 },
  "click-generic": { voice: "click", step: 2, octave: 5, velocity: 0.4 },
  // Hover (event router classifies target)
  hover: { voice: "blip", step: 5, octave: 6, velocity: 0.25 },
  "hover-button": { voice: "blip", step: 5, octave: 6, velocity: 0.22 },
  "hover-link": { voice: "blip", step: 4, octave: 6, velocity: 0.18 },
  "hover-input": { voice: "blip", step: 3, octave: 6, velocity: 0.15 },
  "hover-card": { voice: "blip", step: 5, octave: 6, velocity: 0.25 },
  "hover-interactive": { voice: "blip", step: 4, octave: 6, velocity: 0.2 },
  // Focus / keyboard
  "focus-input": { voice: "blip", step: 1, octave: 5, velocity: 0.3 },
  "key-confirm": { voice: "pluck", step: 4, octave: 5, velocity: 0.45 },
  "key-dismiss": { voice: "dissonant", steps: [0, -1], octave: 4, velocity: 0.4 },
  // Typing — soft mechanical-keyboard taps. Quiet velocity + cent jitter so
  // each keystroke is slightly different pitch and the stream doesn't sound
  // like a metronome. Use a single short percussive voice for all three.
  keystroke: { voice: "click", step: 2, octave: 5, velocity: 0.16, jitterCents: 60 },
  "keystroke-space": { voice: "click", step: 4, octave: 5, velocity: 0.18, jitterCents: 40 },
  "keystroke-backspace": { voice: "click", step: 0, octave: 4, velocity: 0.2, jitterCents: 30, filter: "muffled" },
  // Radix data-state transitions (MutationObserver)
  "state-open": { voice: "chord", steps: [0, 2, 4], octave: 5, duration: 0.5 },
  "state-close": { voice: "pad", step: 0, octave: 4, duration: 0.6, filter: "warm" },
  "toggle-on": { voice: "pluck", step: 4, octave: 5, filter: "bright" },
  "toggle-off": { voice: "pluck", step: 1, octave: 4, filter: "warm" },
  // Sidebar category collapse/expand — deliberately distinct from the
  // generic `toggle-on/off` so navigation chrome doesn't sound like a
  // primary CTA toggle. Soft `blip` (synth tap) with low velocity + a
  // little pitch jitter so a rapid open-close-open run doesn't sound
  // metronomic. Open rises, close falls — gives an unconscious cue of
  // "more visible" vs "less visible".
  "category-open": { voice: "blip", step: 4, octave: 6, velocity: 0.22, jitterCents: 15, filter: "muffled" },
  "category-close": { voice: "blip", step: 1, octave: 5, velocity: 0.18, jitterCents: 15, filter: "muffled" },
  "tab-change": { voice: "blip", step: 3, octave: 5, velocity: 0.45 },
  // Dnd-kit drag lifecycle
  "drag-start": { voice: "blip", step: 2, octave: 5, velocity: 0.45 },
  "drag-end": { voice: "pluck", step: 0, octave: 4, filter: "muffled" },
  "drag-drop": { voice: "pluck", step: 4, octave: 5, filter: "bright" },
  // Toast surface
  "toast-success": { voice: "chord", steps: [0, 4, 7], octave: 5, duration: 0.8, filter: "bright" },
  "toast-error": { voice: "dissonant", steps: [0, 1], octave: 4, duration: 0.5 },
  "toast-info": { voice: "pluck", step: 3, octave: 5, filter: "warm" },
  "toast-warning": { voice: "pluck", step: 1, octave: 4, filter: "warm" },
  confirm: { voice: "chord", steps: [0, 2, 4], octave: 5, duration: 0.7 },
};

// Real-time / presence surfaces shared by all multiplayer tools.
const rt: ToolPalette = {
  "sync-remote": { voice: "blip", step: 4, octave: 6, velocity: 0.4 },
  "member-join": { voice: "chord", steps: [0, 2, 4, 7], octave: 5, duration: 0.9, filter: "bright" },
  "member-leave": { voice: "pad", step: 0, octave: 4, duration: 1.0, filter: "warm" },
  "room-connected": { voice: "chord", steps: [0, 4, 7], octave: 5, duration: 0.8, filter: "open" },
};

export const palette: PaletteMap = {
  "planning-poker": planningPoker,
  retro,
  "ceremony-timer": ceremonyTimer,
  burndown,
  burnup,
  velocity,
  "cumulative-flow": cumulativeFlow,
  "cycle-time": cycleTime,
  "sprint-compare": sprintCompare,
  "health-dashboard": healthDashboard,
  "capacity-planner": capacityPlanner,
  "story-mapper": storyMapper,
  prioritizer,
  "estimation-guide": estimationGuide,
  "sprint-goal": sprintGoal,
  "release-planner": releasePlanner,
  standup,
  "sprint-review": sprintReview,
  refinement,
  icebreaker,
  "health-check": healthCheck,
  maturity,
  raci,
  "skills-matrix": skillsMatrix,
  impediments,
  "pi-planning": piPlanning,
  "epic-roadmap": epicRoadmap,
  "scrum-of-scrums": scrumOfScrums,
  "hypothesis-tracker": hypothesisTracker,
  "user-interviews": userInterviews,
  "opportunity-tree": opportunityTree,
  "risk-register": riskRegister,
  "tech-debt": techDebt,
  "decision-log": decisionLog,
  premortem,
  "dod-builder": dodBuilder,
  kanban,
  "dependency-map": dependencyMap,
  "value-stream": valueStream,
  okrs,
  "nps-csat": npsCsat,
  "mood-tracker": moodTracker,
  // pseudo-tools for universal surfaces
  ui,
  rt,
};

export function getEntry(toolId: string, eventName: string) {
  const tool = palette[toolId];
  if (!tool) return undefined;
  return tool[eventName];
}
