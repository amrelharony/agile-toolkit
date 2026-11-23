import type { PromptDefinition } from "./types";
import { buildPreamble, formatTable, truncateData, wrapUserContent } from "./prompt-utils";
import type { BugReport } from "../stores/workspace-types";
import {
  PRIORITY_LABEL,
  SEVERITY_LABEL,
  STATUS_LABEL,
  ageDays,
  bugCounts,
  isOpen,
  oldestFirst,
  overTarget,
} from "../bug-triage/model";

/**
 * Copyable prompts over Bug Triage as the page shows it: the open bugs
 * (title, area, severity, priority, status, age), for checking the queue's
 * placements and for spotting what keeps breaking. Who reported a bug is
 * left out. The bugs are typed by people, so the table is wrapped as
 * untrusted content.
 */
export function generateBugTriagePrompts(
  bugs: readonly BugReport[],
  today: string
): PromptDefinition[] {
  const open = oldestFirst(bugs.filter(isOpen));
  if (open.length === 0) return [];
  const { data: shown, truncated, totalCount } = truncateData(open, 40);
  const table = formatTable(
    ["Bug", "Area", "Severity", "Priority", "Status", "Age (days)", "Over target"],
    shown.map((b) => [
      b.title,
      b.area ?? "-",
      b.severity ? SEVERITY_LABEL[b.severity] : "-",
      b.priority ? PRIORITY_LABEL[b.priority] : "-",
      STATUS_LABEL[b.status],
      ageDays(b, today),
      overTarget(b, today) ? "yes" : "no",
    ])
  );
  const note = truncated ? `\n(Showing ${shown.length} of ${totalCount} open bugs)\n` : "";
  const counts = bugCounts(bugs, today);
  const data = wrapUserContent(`${table}${note}`);
  return [
    {
      id: "bug-triage-check",
      title: "Check the triage",
      description: "Test each bug's severity and priority, and spot duplicates.",
      prompt:
        buildPreamble(
          "Bug Triage",
          "It holds the team's open bugs. Severity is how bad a bug is (critical, major, minor, cosmetic) and priority how soon it needs fixing (now, next, later, some day)."
        ) +
        `## Open bugs\n\n${data}\n\nCounts: ${counts.open} open, ${counts.toTriage} waiting to be triaged, ${counts.overTarget} past their fix-by target.\n\n## Questions\n\n1. For each bug not triaged yet, what severity and priority would you give it, and why, in one line?\n2. Which placed bugs look wrong: a severity that doesn't match the words, or a priority that doesn't match the severity?\n3. Which bugs look like the same problem and could be closed as duplicates?\n4. Which one bug should the team fix first, and what should it stop to make room?`,
    },
    {
      id: "bug-triage-patterns",
      title: "What keeps breaking",
      description: "Find the areas and kinds of bug that keep coming back.",
      prompt:
        buildPreamble(
          "Bug Triage",
          "Look for patterns in the team's open bugs: where they are and what kind they are."
        ) +
        `## Open bugs\n\n${data}\n\n## Questions\n\n1. Which areas of the product hold the most bugs, and the worst ones?\n2. What kinds of bug repeat (input checks, payments, layout, dates)? Group them, naming each group in a few words.\n3. What one change to how the team builds or tests would stop the biggest group coming back?\n4. Which bugs have waited longest past their target, and what does that say about how the team plans bug work?`,
    },
  ];
}
