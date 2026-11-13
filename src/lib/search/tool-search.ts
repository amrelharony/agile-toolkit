/**
 * Find a tool by what the user is trying to do.
 *
 * Indexes every tool's name, id, category and description (the "More tools"
 * shelf included — callers group hits by `tool.shelf`; VIP tools never), plus a
 * small vocabulary of the words people actually type ("daily scrum",
 * "definition of ready", "prioritise my backlog") that rarely appear in the
 * tool's own copy. Scored by the shared keyword/IDF matcher, which also
 * expands agile synonyms (standup↔daily, blocker↔impediment, …).
 */

import type { ToolDefinition } from "@/lib/constants/tools";
import { getVisibleTools, isVipOnly } from "@/lib/tools/catalog";
import { buildKbIndex, matchKb, type KbIndex } from "./kb-core";

/** Extra search vocabulary per tool id. Plain words; phrases are tokenised. */
export const TOOL_KEYWORDS: Record<string, string[]> = {
  standup: ["daily scrum", "daily standup", "stand-up", "yesterday today blockers"],
  "async-standup": ["daily scrum", "written standup", "remote", "slack update"],
  retro: ["retrospective", "start stop continue", "4ls", "sailboat", "mad sad glad"],
  "retro-actions": [
    "action items",
    "follow-ups",
    "retro actions",
    "improvement actions",
    "overdue",
  ],
  "planning-poker": ["estimate", "estimation", "story points", "fibonacci", "t-shirt sizing"],
  "estimation-guide": ["story points", "reference stories", "calibration"],
  "capacity-planner": ["sprint planning", "availability", "time off", "focus factor"],
  "sprint-goal": ["sprint planning", "goal", "objective"],
  refinement: ["backlog refinement", "grooming", "definition of ready", "dor"],
  "product-goal": ["product vision", "long-term goal", "north star"],
  "backlog-health": ["deep", "backlog quality", "stale stories", "given when then", "gherkin"],
  "dod-builder": ["definition of done", "dod", "quality criteria"],
  prioritizer: ["prioritise", "prioritize", "backlog", "rank", "moscow", "wsjf", "rice"],
  "rice-scoring": ["prioritise", "prioritize", "reach impact confidence effort"],
  "ice-score": ["prioritise", "prioritize", "impact confidence ease"],
  wsjf: ["prioritise", "prioritize", "cost of delay", "safe"],
  moscow: ["prioritise", "prioritize", "must should could"],
  "value-effort-matrix": ["prioritise", "prioritize", "quick wins", "2x2"],
  "kano-model": ["prioritise", "features", "delight", "customer satisfaction"],
  "cost-of-delay": ["prioritise", "urgency", "wsjf"],
  "health-check": ["team health", "squad health", "spotify", "morale"],
  "psych-safety": ["team health", "psychological safety", "trust"],
  "mood-tracker": ["team health", "morale", "happiness", "niko niko"],
  "health-dashboard": ["insights", "kpis", "metrics overview"],
  sprint: [
    "current sprint",
    "sprint dashboard",
    "cockpit",
    "today",
    "ceremonies",
    "scrum board",
    "sprint overview",
  ],
  "sprint-planning": [
    "sprint planning",
    "plan the sprint",
    "commitment",
    "sprint backlog",
    "fill to capacity",
    "what fits",
  ],
  "sprint-metrics": ["sprint dashboard", "sprint status", "sprint health", "close sprint"],
  burndown: ["sprint progress", "remaining work"],
  burnup: ["scope", "release progress"],
  velocity: ["sprint metrics", "throughput", "points per sprint"],
  "cycle-time": ["lead time", "flow metrics"],
  "cumulative-flow": ["cfd", "flow metrics", "wip"],
  kanban: ["board", "wip limits", "flow"],
  "risk-register": ["risks", "raid", "mitigation"],
  premortem: ["risks", "failure", "what could go wrong"],
  "post-mortem": ["incident review", "postmortem", "blameless", "rca", "root cause"],
  "incident-commander": ["incident", "outage", "on call"],
  impediments: ["blockers", "blocked"],
  "interrupt-buffer": ["unplanned work", "interruptions", "firefighting", "emergency procedure"],
  "decision-log": ["adr", "architecture decision record", "decisions"],
  "one-on-one": ["one to one", "1on1", "manager", "direct report", "reports", "coaching"],
  "working-agreement": ["team norms", "ground rules", "team charter"],
  icebreaker: ["warm up", "energizer", "check-in"],
  "ceremony-timer": ["timebox", "timer", "meeting"],
  "story-mapper": ["user story map", "journey", "release slices", "mvp"],
  "release-planner": ["roadmap", "release", "forecast"],
  "epic-roadmap": ["roadmap", "epics", "timeline"],
  "pi-planning": ["safe", "program increment", "art"],
  okrs: ["objectives", "key results", "goals"],
  raci: ["roles", "responsibilities", "accountable"],
  "stakeholder-map": ["stakeholders", "power interest"],
  "dora-scorecard": ["deployment frequency", "lead time", "change failure", "mttr"],
  canvas: ["whiteboard", "sticky notes", "miro", "mural", "diagram"],
};

let cached: { index: KbIndex; byId: Map<string, ToolDefinition> } | null = null;

function getIndex() {
  if (cached) return cached;
  // Everything but an unshipped comic: shelved tools must stay findable by name.
  // VIP tools stay out for everyone, the hint included: the index is built once
  // and shared, and a search result is no way to find a printed-book extra.
  const visible = getVisibleTools(true).filter((t) => !isVipOnly(t));
  const index = buildKbIndex(
    visible.map((t) => ({
      id: t.id,
      toolId: t.id,
      name: t.name,
      category: t.category,
      description: t.description,
      longDescription: [t.category, ...(TOOL_KEYWORDS[t.id] ?? [])].join(" "),
    }))
  );
  cached = { index, byId: new Map(visible.map((t) => [t.id, t])) };
  return cached;
}

/** Spellings the tokenizer would otherwise drop ("1:1" is two 1-char tokens). */
function normalizeQuery(query: string): string {
  return query.replace(/\b1\s*[:\-/]\s*1s?\b/gi, " one on one ");
}

/** Best tools for `query`, most relevant first. Empty query → []. */
export function searchTools(query: string, limit = 8): ToolDefinition[] {
  const { index, byId } = getIndex();
  return matchKb(normalizeQuery(query), index, { limit })
    .matches.map((m) => byId.get(m.entry.id))
    .filter((t): t is ToolDefinition => Boolean(t));
}

/** Test hook: forget the memoised index. */
export function resetToolSearchIndex(): void {
  cached = null;
}
