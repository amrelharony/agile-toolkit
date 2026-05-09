import type { PromptDefinition } from "./types";
import { buildPreamble, formatTable } from "./prompt-utils";

interface ShiftLite {
  person: string;
  startDate: string;
  endDate: string;
  pageCount: number;
  description?: string;
}

interface PersonStat {
  person: string;
  totalPages: number;
  shifts: number;
  pagesPerShift: number;
}

export function generateOncallRosterPrompts(data: {
  shifts: ShiftLite[];
  personStats: PersonStat[];
  totalPagesThisMonth: number;
  topPagedPerson: string | null;
}): PromptDefinition[] {
  if (data.shifts.length === 0) return [];

  const shiftTable = formatTable(
    ["Person", "Start", "End", "Pages", "Description"],
    data.shifts
      .slice(0, 20)
      .map((s) => [
        s.person,
        s.startDate,
        s.endDate,
        s.pageCount,
        (s.description ?? "—").slice(0, 60),
      ])
  );

  const personTable = formatTable(
    ["Person", "Shifts", "Total pages", "Pages / shift"],
    data.personStats.map((p) => [
      p.person,
      p.shifts,
      p.totalPages,
      p.pagesPerShift.toFixed(2),
    ])
  );

  return [
    {
      id: "burnout-signals",
      title: "Burnout signals",
      description:
        "Spot rotation members at burnout risk based on paging frequency and rotation density.",
      prompt:
        buildPreamble(
          "On-Call Roster",
          `${data.totalPagesThisMonth} pages logged this month. Top-paged person: ${data.topPagedPerson ?? "—"}.`
        ) +
        `## Shifts\n\n${shiftTable}\n\n## Per-person stats\n\n${personTable}\n\n## Questions\n\n1. Identify 1-3 people whose paging frequency suggests burnout risk and explain why.\n2. Are pages clustering in a few shifts (system fragility) or evenly distributed (chronic noise)?\n3. Recommend three immediate interventions and one structural change.\n4. Draft a one-paragraph "healthy oncall" charter for the team to align on.`,
    },
    {
      id: "rotation-rebalancing",
      title: "Rotation rebalancing",
      description:
        "Recommend changes to shift assignment to balance load and recover oncall hygiene.",
      prompt:
        buildPreamble(
          "On-Call Roster",
          "Rotation balance affects both response quality and morale."
        ) +
        `## Per-person stats\n\n${personTable}\n\n## Questions\n\n1. Is the rotation cadence sustainable, or does any one person carry a disproportionate load?\n2. Recommend a target pages-per-shift ceiling and how to reach it.\n3. Identify reasons pages might cluster (recent launches, missing alert tuning, single-team domain).\n4. Suggest a quarterly oncall retro agenda.`,
    },
  ];
}
