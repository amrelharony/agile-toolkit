import type { PromptDefinition } from "./types";
import { buildPreamble, formatTable } from "./prompt-utils";

interface AsyncUpdate {
  id: string;
  member: string;
  date: string;
  yesterday: string;
  today: string;
  blockers?: string;
  description?: string;
}

export function generateAsyncStandupPrompts(data: {
  updates: AsyncUpdate[];
}): PromptDefinition[] {
  if (data.updates.length === 0) return [];

  const recent = data.updates.slice(0, 25);
  const updateTable = formatTable(
    ["Date", "Member", "Today", "Blockers"],
    recent.map((u) => [
      u.date,
      u.member,
      (u.today || "—").slice(0, 60),
      (u.blockers ?? "—").slice(0, 60),
    ])
  );

  const blockerCount = data.updates.filter(
    (u) => u.blockers && u.blockers.trim().length > 0
  ).length;
  const memberCounts = new Map<string, number>();
  for (const u of data.updates) {
    memberCounts.set(u.member, (memberCounts.get(u.member) ?? 0) + 1);
  }

  return [
    {
      id: "async-quality",
      title: "Standup Quality Review",
      description:
        "Audit async updates for clarity, specificity, and accountability.",
      prompt:
        buildPreamble(
          "Async Standup Digest",
          `${data.updates.length} updates from ${memberCounts.size} members. ${blockerCount} include blockers.`
        ) +
        `## Recent Updates\n\n${updateTable}\n\n## Questions\n\n1. Which updates are vague (\"working on X\") vs. specific (\"finished login flow, on review\")?\n2. Are members consistently posting, or is there drift?\n3. Suggest a 3-bullet template that would lift the bottom-quartile updates without adding overhead.\n4. Where do today/yesterday entries diverge in a way that suggests churn or scope-shifting?`,
    },
    {
      id: "async-blockers",
      title: "Blocker Pattern Analysis",
      description:
        "Surface recurring blocker themes and recommend systemic interventions.",
      prompt:
        buildPreamble(
          "Async Standup Digest",
          `${blockerCount} updates flag blockers across the recent window.`
        ) +
        `## Recent Updates\n\n${updateTable}\n\n## Questions\n\n1. Group the blockers into 2-4 themes (people, dependencies, environment, scope, etc.).\n2. Which blocker types repeat across days/people? Those are systemic, not tactical.\n3. For the top recurring theme, propose one structural change the team can make this week.\n4. What signals would indicate the blocker is being actively worked vs. languishing?`,
    },
  ];
}
