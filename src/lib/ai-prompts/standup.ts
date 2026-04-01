import type { PromptDefinition } from "./types";
import { buildPreamble, truncateData } from "./prompt-utils";

interface StandupData {
  entries: { id: string; member: string; date: string; yesterday: string; today: string; blockers: string }[];
  members: string[];
  resolvedBlockers: string[];
}

export function generateStandupPrompts(data: StandupData): PromptDefinition[] {
  if (data.entries.length === 0) return [];

  // Get today's or most recent entries
  const dates = Array.from(new Set(data.entries.map((e) => e.date))).sort().reverse();
  const latestDate = dates[0];
  const todayEntries = data.entries.filter((e) => e.date === latestDate);

  const { data: shown } = truncateData(todayEntries, 15);
  const entryText = shown
    .map((e) => `**${e.member}** (${e.date}):\n- Yesterday: ${e.yesterday}\n- Today: ${e.today}\n- Blockers: ${e.blockers || "None"}`)
    .join("\n\n");

  const allBlockers = data.entries.filter((e) => e.blockers && e.blockers.trim().length > 0);
  const unresolvedBlockers = allBlockers.filter((e) => !data.resolvedBlockers.includes(e.id));

  return [
    {
      id: "standup-blockers",
      title: "Blocker Resolution Strategy",
      description: "Analyze blockers and create an action plan for resolution.",
      prompt: buildPreamble("Daily Standup", `The team has ${data.members.length} members. Showing entries from ${latestDate}.`) +
        `## Standup Entries\n\n${entryText}\n\n## Blocker Summary\n\nTotal blockers reported: ${allBlockers.length}\nUnresolved: ${unresolvedBlockers.length}\nResolved: ${data.resolvedBlockers.length}\n\n## Questions\n\n1. Categorize the blockers: which are technical, which are organizational, which are external?\n2. For each unresolved blocker, suggest a specific resolution path and who should own it.\n3. Which blockers need escalation to management? Draft a brief escalation message.\n4. Are there patterns in blocker frequency — do they cluster around certain people, areas, or times?\n5. What systemic changes would prevent the most common blocker types from recurring?`,
    },
    {
      id: "standup-alignment",
      title: "Team Alignment Check",
      description: "Identify coordination opportunities and dependency risks.",
      prompt: buildPreamble("Daily Standup", "Analyze team alignment and collaboration opportunities.") +
        `## Standup Entries\n\n${entryText}\n\nTeam members: ${data.members.join(", ")}\nMembers who haven't reported: ${data.members.filter((m) => !todayEntries.some((e) => e.member === m)).join(", ") || "All reported"}\n\n## Questions\n\n1. Are there team members working on related items who should be coordinating?\n2. Based on "yesterday" vs "today" entries, is anyone stuck on the same task for multiple days?\n3. Are the "today" plans aligned with the sprint goal, or is there drift?\n4. Which team members might benefit from pairing based on what they're working on?\n5. Draft a brief daily summary message the Scrum Master could share with stakeholders.`,
    },
  ];
}
