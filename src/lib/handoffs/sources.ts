/**
 * Where a "From …" link on a sent item goes: the tools that send, and the
 * label and href of the link back. Plain data and string helpers, loading
 * no route, so a page that only shows back-links (SourceLink) doesn't load
 * every hand-off target. lib/handoffs/registry re-exports all of it.
 */

import type { HandoffRef } from "./types";

/**
 * Tools that send items, with where a "From …" link on the target goes: the
 * ones sending today, and the ones the tool upgrade wires to the new routes.
 */
export const SOURCE_TOOLS: Readonly<Record<string, { name: string; href: string }>> = {
  retro: { name: "retro", href: "/retro" },
  standup: { name: "standup", href: "/standup" },
  premortem: { name: "premortem", href: "/premortem" },
  "story-mapper": { name: "story map", href: "/story-mapper" },
  // Plan the sprint
  "sprint-planning": { name: "Sprint Planning", href: "/sprint-planning" },
  "planning-poker": { name: "Planning Poker", href: "/planning-poker" },
  refinement: { name: "refinement", href: "/refinement" },
  "walking-skeleton": { name: "walking skeleton", href: "/walking-skeleton" },
  "jtbd-mapper": { name: "jobs to be done", href: "/jtbd-mapper" },
  "pi-planning": { name: "PI Planning", href: "/pi-planning" },
  "scrum-of-scrums": { name: "Scrum of Scrums", href: "/scrum-of-scrums" },
  // Run the sprint
  "async-standup": { name: "async standup", href: "/async-standup" },
  // An open impediment planned into a sprint as a story (Sprint Planning's
  // "From the last retro" panel): the story links back to the log.
  impediments: { name: "impediments", href: "/impediments" },
  "sprint-review": { name: "Sprint Review", href: "/sprint-review" },
  // Retrospect & improve
  "six-hats": { name: "six hats", href: "/six-hats" },
  "design-sprint": { name: "design sprint", href: "/design-sprint" },
  // Team & people
  "health-check": { name: "health check", href: "/health-check" },
  "psych-safety": { name: "psychological safety", href: "/psych-safety" },
  "mood-tracker": { name: "mood tracker", href: "/mood-tracker" },
  kudos: { name: "kudos", href: "/kudos" },
  maturity: { name: "maturity assessment", href: "/maturity" },
  "working-agreement": { name: "working agreement", href: "/working-agreement" },
  // Prioritize & decide
  // Sprint Planning pulls its backlog items in as stories (sprint-planning/view.ts).
  prioritizer: { name: "Backlog Prioritizer", href: "/prioritizer" },
  "weighted-decision": { name: "weighted decision", href: "/weighted-decision" },
  cynefin: { name: "Cynefin", href: "/cynefin" },
  "buy-a-feature": { name: "Buy a Feature", href: "/buy-a-feature" },
  // Shelved, but its "Push to Decision Log" still sends decided RFCs.
  "rfc-tracker": { name: "RFC", href: "/rfc-tracker" },
  // Outcomes & quality
  "opportunity-tree": { name: "opportunity tree", href: "/opportunity-tree" },
  "riskiest-assumption": { name: "riskiest assumption", href: "/riskiest-assumption" },
  "user-interviews": { name: "user interviews", href: "/user-interviews" },
  "risk-register": { name: "Risk Register", href: "/risk-register" },
  "tech-debt": { name: "tech debt", href: "/tech-debt" },
  // Track delivery
  burndown: { name: "burndown", href: "/burndown" },
  burnup: { name: "burnup", href: "/burnup" },
  velocity: { name: "velocity", href: "/velocity" },
  "sprint-metrics": { name: "Sprint Metrics", href: "/sprint-metrics" },
  "cumulative-flow": { name: "cumulative flow", href: "/cumulative-flow" },
  "cycle-time": { name: "cycle time", href: "/cycle-time" },
  "value-stream": { name: "value stream map", href: "/value-stream" },
  "health-dashboard": { name: "health dashboard", href: "/health-dashboard" },
  "dora-scorecard": { name: "DORA scorecard", href: "/dora-scorecard" },
  "release-readiness": { name: "Release Readiness", href: "/release-readiness" },
  "feature-flag-tracker": { name: "feature flag tracker", href: "/feature-flag-tracker" },
  // For readers of the book: its actions go to Retro Actions. Someone without
  // access who follows the back-link gets the lock panel and nothing else.
  "squad-session": { name: "Squad Session Kit", href: "/squad-session" },
  // A story's question for the team, sent from the story's page.
  comics: { name: "Agile at Work", href: "/comics" },
  // Phase 42, the tools plan's phase 1: listed ahead of their senders, which
  // each tool's builder adds (a parked point, a countermeasure, wall feedback
  // turned into backlog items, an interrupt, a note).
  "parking-lot": { name: "parking lot", href: "/parking-lot" },
  "root-cause": { name: "root-cause analysis", href: "/root-cause" },
  "audience-wall": { name: "Audience Wall", href: "/audience-wall" },
  // A saved vote's result, sent to the Decision Log or the retro.
  "quick-vote": { name: "Quick Vote", href: "/quick-vote" },
  "interrupt-buffer": { name: "interrupt buffer", href: "/interrupt-buffer" },
  "sm-notebook": { name: "Scrum Master Notebook", href: "/sm-notebook" },
  // A contributing factor taken to Root Cause (its analysis's sourceRef): the
  // plan's hand-off from Post-Mortem, whose sender Root Cause's builder adds.
  "post-mortem": { name: "post-mortem", href: "/post-mortem" },
  // Phase 43, the tools plan's phase 2: listed ahead of their senders.
  "example-mapping": { name: "example map", href: "/example-mapping" },
  "relative-sizing": { name: "relative sizing", href: "/relative-sizing" },
  "bug-triage": { name: "bug triage", href: "/bug-triage" },
  "hill-chart": { name: "hill chart", href: "/hill-chart" },
  "test-sessions": { name: "test sessions", href: "/test-sessions" },
  "notes-to-actions": { name: "meeting notes", href: "/notes-to-actions" },
  "product-canvas": { name: "product canvas", href: "/product-canvas" },
  "impact-map": { name: "impact map", href: "/impact-map" },
  "strategy-tree": { name: "strategy tree", href: "/strategy-tree" },
  improve: { name: "improvement", href: "/improve" },
  kickoff: { name: "kickoff", href: "/kickoff" },
  // A blocked card or story logged as an impediment (P2.6b).
  kanban: { name: "Kanban board", href: "/kanban" },
};

/** Phase 43's tools that open the document an item came from, and the query key each reads. */
const DOC_PARAMS: Readonly<Record<string, string>> = {
  "example-mapping": "map",
  "relative-sizing": "board",
  "hill-chart": "chart",
  "test-sessions": "session",
  "notes-to-actions": "note",
  "product-canvas": "canvas",
  "impact-map": "map",
  "strategy-tree": "tree",
  kickoff: "kickoff",
};

/** The sending tool, or undefined for one not listed (never an inherited key like "constructor"). */
function sourceTool(ref: HandoffRef | undefined): { name: string; href: string } | undefined {
  return ref && Object.prototype.hasOwnProperty.call(SOURCE_TOOLS, ref.tool)
    ? SOURCE_TOOLS[ref.tool]
    : undefined;
}

/** "From retro", for a target item's back-link; null for an unknown tool. */
export function sourceLabel(ref: HandoffRef | undefined): string | null {
  const tool = sourceTool(ref);
  return tool ? `From ${tool.name}` : null;
}

export function sourceHref(ref: HandoffRef | undefined): string | null {
  const tool = sourceTool(ref);
  if (!tool) return null;
  // A tool that keeps several documents opens the one the item came from.
  if (ref?.tool === "premortem" && ref.doc) {
    return `${tool.href}?premortem=${encodeURIComponent(ref.doc)}`;
  }
  if (ref?.tool === "weighted-decision" && ref.doc) {
    return `${tool.href}?matrix=${encodeURIComponent(ref.doc)}`;
  }
  if ((ref?.tool === "squad-session" || ref?.tool === "comics") && ref.doc) {
    return `${tool.href}?ep=${encodeURIComponent(ref.doc)}`;
  }
  // A countermeasure sent from Root Cause opens its analysis.
  if (ref?.tool === "root-cause" && ref.id) {
    return `${tool.href}?analysis=${encodeURIComponent(ref.id)}`;
  }
  // Phase 43: a bug sent on opens that bug; an improvement's step or obstacle
  // names its improvement in `doc`, an analysis it planned names it in `id`.
  if (ref?.tool === "bug-triage" && ref.id) {
    return `${tool.href}?bug=${encodeURIComponent(ref.id)}`;
  }
  if (ref?.tool === "improve") {
    return `${tool.href}?item=${encodeURIComponent(ref.doc ?? ref.id)}`;
  }
  const docParam =
    ref && Object.prototype.hasOwnProperty.call(DOC_PARAMS, ref.tool)
      ? DOC_PARAMS[ref.tool]
      : undefined;
  if (docParam && ref?.doc) {
    return `${tool.href}?${docParam}=${encodeURIComponent(ref.doc)}`;
  }
  return tool.href;
}
