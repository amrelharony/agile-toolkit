import type { PromptDefinition } from "./types";
import {
  buildPreamble,
  formatTable,
  sanitizePromptCell,
  truncateData,
  wrapUserContent,
} from "./prompt-utils";
import type { TestSession } from "../stores/workspace-types";
import { COVERAGE_LABEL, STATUS_LABEL, charterSentence, noteCounts } from "../test-sessions/model";

/**
 * Copyable prompts over Test Sessions as the page shows them: each
 * session's charter, status, coverage and note counts, with its bug notes,
 * for planning the next sessions and reading what the sessions found. The
 * tester is left out. Charters and notes are typed by people, so the data
 * is wrapped as untrusted content.
 */
export function generateTestSessionsPrompts(sessions: readonly TestSession[]): PromptDefinition[] {
  if (sessions.length === 0) return [];
  const { data: shown, truncated, totalCount } = truncateData([...sessions], 20);
  const table = formatTable(
    ["Charter", "Status", "Minutes", "Covered", "Notes", "Bugs", "Questions", "Ideas"],
    shown.map((s) => {
      const c = noteCounts(s);
      return [
        charterSentence(s.charter),
        STATUS_LABEL[s.status],
        s.minutes,
        s.coverage ? COVERAGE_LABEL[s.coverage] : "-",
        c.note,
        c.bug,
        c.question,
        c.idea,
      ];
    })
  );
  const found = shown
    .flatMap((s) =>
      s.notes
        .filter((n) => n.kind !== "note")
        .map((n) => `- (${n.kind}) ${sanitizePromptCell(n.text, 300)}`)
    )
    .slice(0, 60)
    .join("\n");
  const note = truncated ? `\n(Showing ${shown.length} of ${totalCount} sessions)\n` : "";
  const data = wrapUserContent(
    `${table}${note}${found ? `\n\nBugs, questions and ideas:\n${found}` : ""}`
  );
  return [
    {
      id: "test-sessions-next",
      title: "Plan the next sessions",
      description: "Charters for what the team hasn't explored yet.",
      prompt:
        buildPreamble(
          "Test Sessions",
          "It holds the team's exploratory test sessions: each a timed session from a charter (what to look at, using what, to learn what), with notes and a debrief."
        ) +
        `## Sessions\n\n${data}\n\n## Questions\n\n1. Which parts of the product, ways of using it or risks haven't the sessions covered yet?\n2. Suggest three charters for the next sessions, each one line: look at what, using what, to learn what, and how long.\n3. Which questions and ideas from these sessions deserve a session of their own?`,
    },
    {
      id: "test-sessions-found",
      title: "What the sessions found",
      description: "Read the bugs and notes for patterns and what they say about quality.",
      prompt:
        buildPreamble(
          "Test Sessions",
          "Look for patterns in what the team's exploratory sessions found."
        ) +
        `## Sessions\n\n${data}\n\n## Questions\n\n1. What kinds of problem do the bugs share? Group them, naming each group in a few words.\n2. Which sessions covered little of their charter, and what likely got in the way?\n3. What one change to how the team builds or tests would have caught the biggest group earlier?`,
    },
  ];
}
