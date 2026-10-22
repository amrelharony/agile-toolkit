import type { LucideIcon } from "lucide-react";
import {
  BookOpen,
  Bot,
  CalendarRange,
  CirclePlay,
  HeartPulse,
  ListOrdered,
  RefreshCw,
  ShieldCheck,
  Target,
  TrendingUp,
} from "lucide-react";

/**
 * Navigation sections, in the order a Scrum master's sprint runs: plan it,
 * run it, look back on it, then the standing jobs around it.
 *
 * The registry's `category` (lib/constants/tools.ts) reflects how the tools
 * were built — 18 groups from 1 to 14 tools — and the agent/MCP surface keys
 * off it, so it stays. Sections are what people browse: each tool in exactly
 * one (test/constants/sections.test.ts). Tools on the "More tools" shelf keep
 * their place here and are filtered at render time (lib/tools/catalog), so a
 * section can disappear from the page when every tool in it is shelved.
 *
 * Guides are chunked per section id (lib/tools/guides/index.ts): moving a
 * tool between sections means moving its guide between chunk files too.
 */
export interface ToolSection {
  id: string;
  label: string;
  icon: LucideIcon;
  toolIds: string[];
}

export const SECTIONS: ToolSection[] = [
  {
    id: "plan",
    label: "Plan the sprint",
    icon: CalendarRange,
    toolIds: [
      "capacity-planner",
      "sprint-goal",
      "planning-poker",
      "estimation-guide",
      "refinement",
      "story-mapper",
      "walking-skeleton",
      "release-planner",
      "jtbd-mapper",
      "pi-planning",
      "epic-roadmap",
      "scrum-of-scrums",
      "dependency-map",
    ],
  },
  {
    id: "run",
    label: "Run the sprint",
    icon: CirclePlay,
    toolIds: [
      "standup",
      "async-standup",
      "impediments",
      "kanban",
      "ceremony-timer",
      "sprint-review",
    ],
  },
  {
    id: "retro",
    label: "Retrospect & improve",
    icon: RefreshCw,
    toolIds: [
      "retro",
      "premortem",
      "icebreaker",
      "liberating-structures",
      "six-hats",
      "canvas",
      "design-sprint",
    ],
  },
  {
    id: "delivery",
    label: "Track delivery",
    icon: TrendingUp,
    toolIds: [
      "sprint-metrics",
      "burndown",
      "burnup",
      "velocity",
      "sprint-compare",
      "cumulative-flow",
      "cycle-time",
      "health-dashboard",
      "dora-scorecard",
      "value-stream",
      "release-readiness",
      "feature-flag-tracker",
    ],
  },
  {
    id: "team",
    label: "Team & people",
    icon: HeartPulse,
    toolIds: [
      "health-check",
      "psych-safety",
      "mood-tracker",
      "kudos",
      "working-agreement",
      "dod-builder",
      "skills-matrix",
      "raci",
      "maturity",
      "onboarding-tracker",
      "one-on-one",
      "stakeholder-map",
      "adkar",
      "space-pulse",
      "devex-survey",
      "tech-radar",
    ],
  },
  {
    id: "prioritize",
    label: "Prioritize & decide",
    icon: ListOrdered,
    toolIds: [
      "prioritizer",
      "rice-scoring",
      "wsjf",
      "moscow",
      "ice-score",
      "value-effort-matrix",
      "kano-model",
      "cost-of-delay",
      "buy-a-feature",
      "hundred-dollar-test",
      "eisenhower",
      "decision-log",
      "daci",
      "rapid-decision",
      "weighted-decision",
      "cynefin",
      "stacey-matrix",
      "ooda-loop",
      "polarity-map",
      "rfc-tracker",
    ],
  },
  {
    id: "outcomes",
    label: "Outcomes & discovery",
    icon: Target,
    toolIds: [
      "okrs",
      "nps-csat",
      "hypothesis-tracker",
      "user-interviews",
      "opportunity-tree",
      "riskiest-assumption",
      "wardley-map",
    ],
  },
  {
    id: "quality",
    label: "Quality & risk",
    icon: ShieldCheck,
    toolIds: [
      "risk-register",
      "tech-debt",
      "quality-cost",
      "test-pyramid",
      "flaky-tests",
      "code-review-metrics",
      "slo-builder",
      "incident-commander",
      "post-mortem",
      "oncall-roster",
      "runbook-scorer",
      "platform-maturity",
      "threat-model",
      "vuln-burndown",
      "control-map",
      "a11y-tracker",
    ],
  },
  {
    id: "ai",
    label: "AI product management",
    icon: Bot,
    toolIds: [
      "ai-feature-spec",
      "llm-eval-tracker",
      "prompt-registry",
      "model-comparison",
      "hallucination-log",
      "token-cost-tracker",
      "ai-safety-checklist",
      "ai-red-team",
      "model-migration",
      "model-card",
      "agentic-workflow",
      "hitl-quality",
      "rlhf-log",
      "vector-store-inventory",
    ],
  },
  {
    id: "library",
    label: "Library",
    icon: BookOpen,
    toolIds: ["agile-at-work"],
  },
];

const SECTION_BY_TOOL = new Map(SECTIONS.flatMap((s) => s.toolIds.map((id) => [id, s] as const)));

export function getSectionForTool(toolId: string): ToolSection | undefined {
  return SECTION_BY_TOOL.get(toolId);
}
