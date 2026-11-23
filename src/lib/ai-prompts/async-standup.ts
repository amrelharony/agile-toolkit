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
  /** "ppp": Progress, Plans and Problems; anything else is Yesterday, Today and Blockers. */
  format?: "classic" | "ppp";
  /** Who can clear the blocker. */
  blockerDri?: string;
}

const FORMAT_NOTE =
  "Updates come in two formats: Yesterday, Today and Blockers, or Progress, Plans and Problems (PPP). A DRI is the one person who owns clearing a blocker.";

export function generateAsyncStandupPrompts(data: { updates: AsyncUpdate[] }): PromptDefinition[] {
  if (data.updates.length === 0) return [];

  const recent = data.updates.slice(0, 25);
  const updateTable = formatTable(
    ["Date", "Member", "Format", "Today / Plans", "Blockers / Problems", "DRI"],
    recent.map((u) => [
      u.date,
      u.member,
      u.format === "ppp" ? "PPP" : "Classic",
      (u.today || "—").slice(0, 60),
      (u.blockers || "—").slice(0, 60),
      u.blockers && u.blockerDri ? u.blockerDri.slice(0, 40) : "—",
    ])
  );

  const blockerCount = data.updates.filter(
    (u) => u.blockers && u.blockers.trim().length > 0
  ).length;
  const withDri = data.updates.filter((u) => u.blockers?.trim() && u.blockerDri?.trim()).length;
  const memberCounts = new Map<string, number>();
  for (const u of data.updates) {
    memberCounts.set(u.member, (memberCounts.get(u.member) ?? 0) + 1);
  }

  return [
    {
      id: "async-quality",
      title: "Standup Quality Review",
      description: "Audit async updates for clarity, specificity, and accountability.",
      prompt:
        buildPreamble(
          "Async Standup Digest",
          `${data.updates.length} updates from ${memberCounts.size} members. ${blockerCount} include blockers. ${FORMAT_NOTE}`
        ) +
        `## Recent Updates\n\n${updateTable}\n\n## Questions\n\n1. Which updates are vague (\"working on X\") vs. specific (\"finished login flow, on review\")?\n2. Are members consistently posting, or is there drift?\n3. Suggest a 3-bullet template that would lift the bottom-quartile updates without adding overhead.\n4. Where do today/yesterday (or plans/progress) entries diverge in a way that suggests churn or scope-shifting?`,
    },
    {
      id: "async-blockers",
      title: "Blocker Pattern Analysis",
      description: "Surface recurring blocker themes and recommend systemic interventions.",
      prompt:
        buildPreamble(
          "Async Standup Digest",
          `${blockerCount} updates flag blockers across the recent window, ${withDri} of them with a DRI. ${FORMAT_NOTE}`
        ) +
        `## Recent Updates\n\n${updateTable}\n\n## Questions\n\n1. Group the blockers into 2-4 themes (people, dependencies, environment, scope, etc.).\n2. Which blocker types repeat across days/people? Those are systemic, not tactical.\n3. For the top recurring theme, propose one structural change the team can make this week.\n4. Which blockers have no DRI, and who on the team is best placed to own clearing each one?\n5. What signals would indicate the blocker is being actively worked vs. languishing?`,
    },
  ];
}
