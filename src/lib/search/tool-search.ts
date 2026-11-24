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
  standup: [
    "daily scrum",
    "daily standup",
    "stand-up",
    "yesterday today blockers",
    "shuffle speakers",
    "speaking order",
  ],
  "async-standup": [
    "daily scrum",
    "written standup",
    "remote",
    "slack update",
    "ppp",
    "progress plans problems",
    "dri",
    "follow the sun",
    "hand-over",
  ],
  retro: [
    "retrospective",
    "start stop continue",
    "4ls",
    "sailboat",
    "mad sad glad",
    "lean coffee",
    "surprise me",
    "emotional seismograph",
    "seismograph",
    "mood timeline",
  ],
  "retro-actions": [
    "action items",
    "follow-ups",
    "retro actions",
    "improvement actions",
    "overdue",
    "recurring themes",
  ],
  "root-cause": [
    "5 whys",
    "five whys",
    "fishbone",
    "ishikawa",
    "pareto",
    "countermeasure",
    "causal loop",
    "causal loop diagram",
    "systems thinking",
    "vicious circle",
    "reinforcing loop",
    "balancing loop",
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
    "goal at risk",
    "wall mode",
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
  "cycle-time": ["lead time", "flow metrics", "flow efficiency", "time in status", "wait time"],
  "cumulative-flow": ["cfd", "flow metrics", "wip"],
  kanban: [
    "board",
    "wip limits",
    "flow",
    "definition of workflow",
    "statik",
    "policies",
    "service level expectation",
  ],
  "risk-register": ["risks", "raid", "mitigation"],
  premortem: ["risks", "failure", "what could go wrong"],
  "post-mortem": ["incident review", "postmortem", "blameless", "rca", "root cause"],
  "incident-commander": ["incident", "outage", "on call"],
  impediments: ["blockers", "blocked", "blocker clustering", "blocked time"],
  "interrupt-buffer": ["unplanned work", "interruptions", "firefighting", "emergency procedure"],
  "decision-log": ["adr", "architecture decision record", "decisions"],
  "one-on-one": ["one to one", "1on1", "manager", "direct report", "reports", "coaching"],
  "sm-notebook": ["coaching journal", "scrum master journal", "coaching notes", "observations"],
  "working-agreement": [
    "team norms",
    "ground rules",
    "team charter",
    "core hours",
    "focus time",
    "urgency ladder",
    "response times",
    "ai policy",
  ],
  icebreaker: ["warm up", "energizer", "check-in"],
  picker: [
    "spinner",
    "wheel of names",
    "random name picker",
    "dice",
    "coin flip",
    "role rotation",
    "sprint names",
  ],
  "quick-vote": [
    "poll",
    "fist of five",
    "roman vote",
    "thumbs up",
    "roti",
    "confidence vote",
    "dot voting",
    "gradients of agreement",
    "elmo",
    "esvp",
    "value poker",
    "hold-up cards",
  ],
  "audience-wall": [
    "word cloud",
    "questions and answers",
    "audience questions",
    "upvote",
    "brainwriting",
    "25/10 crowd sourcing",
    "raise hand queue",
    "town hall",
  ],
  "team-mixer": [
    "breakout groups",
    "random groups",
    "pair rotation",
    "coffee chat",
    "world cafe",
    "random teams",
  ],
  "card-decks": [
    "prompt cards",
    "question cards",
    "retro questions",
    "coaching questions",
    "check-in questions",
    "appreciation",
  ],
  "ceremony-timer": ["timebox", "timer", "meeting", "agenda", "shuffle speakers", "speaking time"],
  "facilitator-timers": [
    "pomodoro",
    "break timer",
    "back at",
    "crazy 8s",
    "meeting cost",
    "focus sounds",
    "white noise",
    "soundboard",
  ],
  "parking-lot": ["parked points", "off topic", "side discussions", "issue bin", "discuss later"],
  "meeting-audit": [
    "too many meetings",
    "calendar audit",
    "ritual reset",
    "meeting load",
    "recurring meetings",
  ],
  "story-mapper": ["user story map", "journey", "release slices", "mvp"],
  "release-planner": ["roadmap", "release", "forecast", "throughput", "monte carlo", "cut line"],
  "epic-roadmap": ["roadmap", "epics", "timeline", "now next later", "outcome roadmap"],
  "pi-planning": ["safe", "program increment", "art", "roam", "confidence vote", "predictability"],
  okrs: ["objectives", "key results", "goals"],
  raci: ["roles", "responsibilities", "accountable"],
  "stakeholder-map": ["stakeholders", "power interest"],
  "dora-scorecard": ["deployment frequency", "lead time", "change failure", "mttr"],
  canvas: ["whiteboard", "sticky notes", "miro", "mural", "diagram"],

  // Phase 43, the tools plan's phase 2: its new tools, then two existing
  // tools that gain their first line.
  "example-mapping": [
    "example mapping",
    "specification by example",
    "three amigos",
    "rules and examples",
    "bdd",
    "acceptance tests",
  ],
  "relative-sizing": [
    "magic estimation",
    "silent estimation",
    "silent sorting",
    "affinity estimation",
    "bucket system",
    "relative estimation",
  ],
  "bug-triage": ["bug severity", "defect triage", "bug priority", "severity matrix", "bug bash"],
  "hill-chart": ["hill update", "uphill", "downhill", "project status"],
  "test-sessions": ["exploratory testing", "session based testing", "test charter", "bug hunt"],
  "notes-to-actions": ["meeting minutes", "meeting notes", "extract actions", "notes to tasks"],
  "product-canvas": [
    "vision board",
    "elevator pitch",
    "value proposition",
    "lean ux",
    "pr faq",
    "prfaq",
    "press release",
    "working backwards",
    "business case",
    "shape up",
    "betting table",
    "idea intake",
    "feature requests",
    "opportunity canvas",
  ],
  "impact-map": ["impact mapping", "why who how what", "goal to deliverables", "gojko adzic"],
  "strategy-tree": [
    "dibb",
    "data insight belief bet",
    "lean value tree",
    "hoshin kanri",
    "x-matrix",
    "catchball",
    "strategy deployment",
  ],
  "persona-library": [
    "personas",
    "user persona",
    "proto-persona",
    "anti-persona",
    "customer profile",
  ],
  "product-metrics": [
    "north star metric",
    "heart framework",
    "aarrr",
    "pirate metrics",
    "funnel",
    "input metrics",
    "product kpis",
  ],
  "ab-calculator": [
    "a/b test",
    "ab test",
    "split test",
    "sample size",
    "statistical significance",
    "p-value",
    "confidence interval",
  ],
  "ebm-dashboard": [
    "evidence-based management",
    "ebm",
    "key value areas",
    "time to market",
    "ability to innovate",
    "unrealized value",
  ],
  "flow-insights": [
    "flow distribution",
    "failure demand",
    "work mix",
    "investment balance",
    "team stability",
    "work item types",
  ],
  improve: [
    "a3",
    "a3 report",
    "a3 problem solving",
    "improvement kata",
    "toyota kata",
    "kata",
    "pdca",
    "plan do check act",
    "target condition",
    "kaizen",
    "small experiments",
  ],
  kickoff: [
    "kick off",
    "kick-off",
    "project kickoff",
    "team kickoff",
    "liftoff",
    "team liftoff",
    "inception deck",
    "team canvas",
    "team alignment map",
    "project poster",
    "trade-off sliders",
    "project sliders",
    "problem statement",
    "problem framing",
    "how might we",
    "new team",
    "project start",
  ],
  "team-time": [
    "time zones",
    "timezone",
    "overlap hours",
    "world clock",
    "meeting time poll",
    "office days",
    "hybrid schedule",
    "meeting rotation",
  ],
  "release-readiness": ["release notes", "changelog", "what's new"],
  "hypothesis-tracker": ["value validated", "did it work"],
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

/**
 * Spellings the tokenizer would otherwise drop ("1:1" and "Q&A" are each two
 * 1-char tokens).
 */
function normalizeQuery(query: string): string {
  return query
    .replace(/\b1\s*[:\-/]\s*1s?\b/gi, " one on one ")
    .replace(/\bq\s*(?:&|and|n)\s*a\b/gi, " questions and answers ");
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
