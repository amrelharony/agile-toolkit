import type { PromptDefinition } from "./types";
import { buildPreamble, formatTable } from "./prompt-utils";

interface FlakyData {
  name: string;
  suite?: string;
  owner?: string;
  failureRate: number; // 0-1
  status: string;
  description?: string;
}

export function generateFlakyPrompts(data: {
  tests: FlakyData[];
  active: number;
  quarantined: number;
  fixedThisQuarter: number;
  avgFailureRate: number;
}): PromptDefinition[] {
  if (data.tests.length === 0) return [];

  const sorted = [...data.tests].sort((a, b) => b.failureRate - a.failureRate);
  const table = formatTable(
    ["Name", "Suite", "Owner", "Failure %", "Status", "Description"],
    sorted
      .slice(0, 25)
      .map((t) => [
        t.name.slice(0, 60),
        t.suite ?? "—",
        t.owner ?? "—",
        `${(t.failureRate * 100).toFixed(0)}%`,
        t.status,
        (t.description ?? "—").slice(0, 60),
      ])
  );

  return [
    {
      id: "flaky-triage",
      title: "Triage Queue Prioritization",
      description:
        "Sequence the next 5 fixes by failure-rate, suite blast radius, and ownership clarity.",
      prompt:
        buildPreamble(
          "Flaky Test Scoreboard",
          `${data.active} active flaky test(s); ${data.quarantined} quarantined; ${data.fixedThisQuarter} fixed this quarter; avg failure rate ${(data.avgFailureRate * 100).toFixed(0)}%.`
        ) +
        `## Tests (sorted by failure rate desc)\n\n${table}\n\n## Questions\n\n1. Which 5 tests should the team fix next? Justify by failure rate, blast radius (suite), and ownership clarity.\n2. Are there suites with disproportionate flakiness? Likely root cause patterns?\n3. For the highest-failure-rate test, propose 2-3 hypotheses for the underlying cause and a quick triage experiment for each.`,
    },
    {
      id: "flaky-patterns",
      title: "Anti-Pattern Detection",
      description:
        "Spot test-design anti-patterns that produce flakiness systemically.",
      prompt:
        buildPreamble(
          "Flaky Test Scoreboard",
          `${data.active} active flaky test(s); avg failure rate ${(data.avgFailureRate * 100).toFixed(0)}%.`
        ) +
        `## Tests\n\n${table}\n\n## Questions\n\n1. Looking at names + suites, what shared anti-patterns are likely (timing, network, shared fixtures, order dependence)?\n2. Recommend 2 codebase-wide changes that would prevent ~half of these from recurring.\n3. Suggest a quarantine policy for the team — when to quarantine, when to escalate, when to delete.`,
    },
  ];
}
