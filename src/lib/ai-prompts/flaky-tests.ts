import type { PromptDefinition } from "./types";
import { buildPreamble, formatTable, sanitizePromptCell, wrapUserContent } from "./prompt-utils";
import type { FlakyTest } from "../stores/workspace-types";
import {
  FEW_RUNS,
  FLAKY_HIGH_RATE,
  FLAKY_STATUS_LABEL,
  QUARANTINE_ALERT_DAYS,
  fewRuns,
  flakyRate,
  flakySummary,
  flakyVerdict,
  hasRunCounts,
  quarantinedDays,
  ratePercent,
} from "../quality/flaky";

/**
 * The board as the Flaky Test Scoreboard page shows it: its tests (the
 * team's, or the example while it is loaded) and the day quarantine ages
 * are counted on.
 */
interface FlakyData {
  tests: readonly FlakyTest[];
  /** Local "YYYY-MM-DD". */
  today: string;
}

/** The table lists this many tests. */
const MAX_ROWS = 25;

const plural = (n: number, one: string, many = `${one}s`) => `${n} ${n === 1 ? one : many}`;

/**
 * Open tests first, by rate (a tie to the one with more runs, then by
 * name: worstOffenders' order), those with no readable rate after them,
 * fixed tests last.
 */
function boardOrder(tests: readonly FlakyTest[]): FlakyTest[] {
  const rank = (t: FlakyTest) => (t.status === "fixed" ? 2 : flakyRate(t) === null ? 1 : 0);
  const runs = (t: FlakyTest) => (hasRunCounts(t) ? t.runs : 0);
  return [...tests].sort(
    (a, b) =>
      rank(a) - rank(b) ||
      (flakyRate(b) ?? 0) - (flakyRate(a) ?? 0) ||
      runs(b) - runs(a) ||
      a.name.localeCompare(b.name)
  );
}

/** "Quarantined 21 days (past the 14-day alert)", "Quarantined (date unknown)", "Fixed 2026-10-02". */
function statusText(t: FlakyTest, today: string): string {
  if (t.status === "quarantined") {
    const days = quarantinedDays(t, today);
    if (days === null) return "Quarantined (date unknown)";
    const alert =
      days >= QUARANTINE_ALERT_DAYS ? ` (past the ${QUARANTINE_ALERT_DAYS}-day alert)` : "";
    return `Quarantined ${plural(days, "day")}${alert}`;
  }
  if (t.status === "fixed") return t.fixedAt ? `Fixed ${t.fixedAt.slice(0, 10)}` : "Fixed";
  return FLAKY_STATUS_LABEL[t.status] ?? t.status;
}

/**
 * The flaky-test prompts with the page's numbers (lib/quality/flaky): each
 * test's failed runs out of its runs and its rate (a "few runs" note under
 * FEW_RUNS; a row from before Phase 8 with a rate only says so), the rate
 * weighted by runs over the open tests that have run counts (rate-only
 * rows are counted beside it, never folded in), how long each quarantined
 * test has sat there, and the page's verdict.
 */
export function generateFlakyPrompts(data: FlakyData): PromptDefinition[] {
  const { tests, today } = data;
  if (tests.length === 0) return [];
  const s = flakySummary(tests, today);
  const table = formatTable(
    ["Test", "Suite", "Owner", "Failed runs", "Rate", "Status", "Description"],
    boardOrder(tests)
      .slice(0, MAX_ROWS)
      .map((t) => {
        const rate = flakyRate(t);
        return [
          t.name.slice(0, 80) || "Untitled test",
          t.suite?.trim() || "—",
          t.owner?.trim() || "No owner",
          hasRunCounts(t) ? `${t.failures} of ${t.runs}` : "Rate only (no run counts)",
          rate === null ? "—" : `${ratePercent(rate)}${fewRuns(t) ? " (few runs)" : ""}`,
          statusText(t, today),
          (t.description ?? "").slice(0, 60) || "—",
        ];
      })
  );
  const more = tests.length > MAX_ROWS ? `\n(Showing ${MAX_ROWS} of ${tests.length} tests)` : "";
  const verdict = `Verdict: ${sanitizePromptCell(flakyVerdict(s), 400)}\n\n`;
  // Names, suites, owners and descriptions are user-typed.
  const body = wrapUserContent(`${verdict}${table}${more}`);

  const w = s.weighted;
  const weighted =
    w.rate === null
      ? "Weighted failure rate: — (no open test has run counts yet)."
      : `Weighted failure rate: ${ratePercent(w.rate)} (${w.failures} failed of ${w.runs} runs over ${plural(w.counted, "open test")} with run counts).`;
  const rateOnly =
    w.rateOnly > 0
      ? ` ${plural(w.rateOnly, "open test")} without run counts ${w.rateOnly === 1 ? "is" : "are"} left out of it.`
      : "";
  const long =
    s.longQuarantined.length > 0
      ? ` Quarantined ${QUARANTINE_ALERT_DAYS} days or more: ${s.longQuarantined
          .slice(0, 10)
          .map((q) => `“${sanitizePromptCell(q.name, 60)}” (${q.days} days)`)
          .join(", ")}.`
      : "";
  const unknown =
    s.quarantineDateUnknown > 0
      ? ` ${plural(s.quarantineDateUnknown, "quarantined test")} with no quarantine date.`
      : "";
  const context = `${s.byStatus.active} active, ${s.byStatus.quarantined} quarantined, ${s.byStatus.fixed} fixed (${s.fixedThisQuarter} this quarter). ${weighted}${rateOnly} ${s.highRate} open above ${Math.round(
    FLAKY_HIGH_RATE * 100
  )}%; ${s.fewRuns} with fewer than ${FEW_RUNS} runs.${long}${unknown}`;

  return [
    {
      id: "flaky-triage",
      title: "Triage Queue Prioritization",
      description:
        "Sequence the next 5 fixes by failure-rate, suite blast radius, and ownership clarity.",
      prompt:
        buildPreamble("Flaky Test Scoreboard", context) +
        `## Tests, worst first\n\n${body}\n\n## Questions\n\n1. Which 5 tests should the team fix next? Justify by failure rate and how many runs back it, blast radius (suite), and ownership clarity.\n2. Which quarantined tests have sat too long, and should they be fixed or deleted?\n3. For the highest-failure-rate test, propose 2-3 hypotheses for the underlying cause and a quick triage experiment for each.`,
    },
    {
      id: "flaky-patterns",
      title: "Anti-Pattern Detection",
      description: "Spot test-design anti-patterns that produce flakiness systemically.",
      prompt:
        buildPreamble("Flaky Test Scoreboard", context) +
        `## Tests\n\n${body}\n\n## Questions\n\n1. Looking at names + suites, what shared anti-patterns are likely (timing, network, shared fixtures, order dependence)?\n2. Recommend 2 codebase-wide changes that would prevent ~half of these from recurring.\n3. Suggest a quarantine policy for the team — when to quarantine, when to escalate, when to delete.`,
    },
  ];
}
