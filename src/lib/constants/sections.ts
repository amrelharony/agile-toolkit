import type { LucideIcon } from "lucide-react";
import {
  BookOpen,
  Bot,
  CalendarRange,
  HeartPulse,
  ListOrdered,
  ShieldCheck,
  Target,
  TrendingUp,
  Users,
} from "lucide-react";

/**
 * Navigation sections, grouped by the job a person is doing.
 *
 * The registry's `category` (lib/constants/tools.ts) reflects how the tools
 * were built — 18 groups from 1 to 14 tools, with Retro, Premortem and
 * Post-mortem in three different places — and the agent/MCP surface keys
 * off it, so it stays. Sections are what people browse: eight jobs, each
 * tool in exactly one.
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
    label: "Plan & estimate",
    icon: CalendarRange,
    toolIds: [
      "planning-poker",
      "capacity-planner",
      "sprint-goal",
      "story-mapper",
      "refinement",
      "estimation-guide",
      "release-planner",
      "jtbd-mapper",
      "walking-skeleton",
      "pi-planning",
      "epic-roadmap",
      "scrum-of-scrums",
      "dependency-map",
    ],
  },
  {
    id: "ceremonies",
    label: "Run ceremonies",
    icon: Users,
    toolIds: [
      "retro",
      "standup",
      "async-standup",
      "sprint-review",
      "ceremony-timer",
      "icebreaker",
      "premortem",
      "one-on-one",
      "working-agreement",
      "liberating-structures",
      "design-sprint",
      "canvas",
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
      "six-hats",
      "cynefin",
      "stacey-matrix",
      "ooda-loop",
      "polarity-map",
      "rfc-tracker",
    ],
  },
  {
    id: "delivery",
    label: "Track delivery",
    icon: TrendingUp,
    toolIds: [
      "sprint-metrics",
      "burndown",
      "velocity",
      "kanban",
      "burnup",
      "cycle-time",
      "cumulative-flow",
      "sprint-compare",
      "health-dashboard",
      "value-stream",
      "release-readiness",
      "feature-flag-tracker",
    ],
  },
  {
    id: "team",
    label: "Team health",
    icon: HeartPulse,
    toolIds: [
      "health-check",
      "psych-safety",
      "mood-tracker",
      "kudos",
      "impediments",
      "maturity",
      "skills-matrix",
      "raci",
      "onboarding-tracker",
      "devex-survey",
      "space-pulse",
      "tech-radar",
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
      "stakeholder-map",
      "adkar",
      "wardley-map",
    ],
  },
  {
    id: "quality",
    label: "Quality, reliability & risk",
    icon: ShieldCheck,
    toolIds: [
      "risk-register",
      "tech-debt",
      "dod-builder",
      "dora-scorecard",
      "slo-builder",
      "incident-commander",
      "post-mortem",
      "oncall-roster",
      "runbook-scorer",
      "platform-maturity",
      "test-pyramid",
      "flaky-tests",
      "code-review-metrics",
      "quality-cost",
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
