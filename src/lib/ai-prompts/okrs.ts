import type { PromptDefinition } from "./types";
import { buildPreamble, formatTable } from "./prompt-utils";
import type { Okr } from "../stores/workspace-types";

export function generateOkrsPrompts(data: { okrs: Okr[] }): PromptDefinition[] {
  if (data.okrs.length === 0) return [];
  const rows: (string | number)[][] = [];
  for (const o of data.okrs) {
    for (const kr of o.keyResults) {
      const progress = kr.target > 0 ? Math.round((kr.current / kr.target) * 100) : 0;
      rows.push([
        o.quarter,
        o.objective.slice(0, 50),
        (o.description ?? "—").slice(0, 80),
        kr.title.slice(0, 50),
        (kr.description ?? "—").slice(0, 80),
        kr.current,
        kr.target,
        `${progress}%`,
        kr.confidence ?? "-",
      ]);
    }
  }
  const table = formatTable(
    ["Quarter", "Objective", "Obj. Description", "KR", "KR Description", "Current", "Target", "Progress", "Confidence"],
    rows
  );

  return [
    {
      id: "okr-health",
      title: "OKR Health Check",
      description: "Evaluate whether your OKRs are ambitious, measurable, and on track.",
      prompt:
        buildPreamble("OKR Tracker", "Objectives are qualitative goals; Key Results are measurable outcomes.") +
        `## OKRs\n\n${table}\n\n## Questions\n\n1. Are these objectives genuinely ambitious (stretch) or too easy?\n2. Are the Key Results measurable and outcome-based (not activities)?\n3. Where is confidence low and why?\n4. Which OKRs likely need mid-quarter reset?`,
    },
    {
      id: "okr-focus",
      title: "OKR Focus & Alignment",
      description: "Surface conflicts and prioritize focus.",
      prompt:
        buildPreamble("OKR Tracker", "Teams with too many objectives have none.") +
        `## OKRs\n\n${table}\n\n## Questions\n\n1. Are there too many objectives for the team to meaningfully invest in?\n2. Which KRs conflict or compete for the same capacity?\n3. Recommend the top 3 focus OKRs for this quarter.`,
    },
  ];
}
