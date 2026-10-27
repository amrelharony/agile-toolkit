// @vitest-environment node
import { describe, expect, it } from "vitest";
import { generateFlakyPrompts } from "@/lib/ai-prompts/flaky-tests";
import type { FlakyTest } from "@/lib/stores/workspace-types";

/**
 * The flaky-test prompt reads the board as the page does
 * (lib/quality/flaky): failed runs out of runs, the rate weighted by runs
 * (rate-only rows from before Phase 8 counted beside it, never in it, and
 * never read as 0%), a "few runs" note, the days in quarantine against the
 * 14-day alert, and the page's verdict.
 */

const TODAY = "2026-10-27";

const test = (id: string, name: string, extra: Partial<FlakyTest>): FlakyTest => ({
  id,
  name,
  failureRate: 0,
  status: "active",
  firstSeenAt: "2026-09-01",
  ...extra,
});

const TESTS: FlakyTest[] = [
  test("t1", "checkout e2e", {
    suite: "e2e",
    owner: "Ana",
    failures: 12,
    runs: 100,
    failureRate: 0.12,
  }),
  test("t2", "login spec", {
    failures: 3,
    runs: 6,
    failureRate: 0.5,
    status: "quarantined",
    quarantinedAt: "2026-10-01",
  }),
  test("t3", "legacy rate", { failureRate: 0.3 }),
  test("t4", "old fixed", {
    failures: 1,
    runs: 10,
    failureRate: 0.1,
    status: "fixed",
    fixedAt: "2026-10-02",
  }),
  test("t5", "unknown q", { failureRate: 0.05, status: "quarantined" }),
];

describe("generateFlakyPrompts", () => {
  const [triage, patterns] = generateFlakyPrompts({ tests: TESTS, today: TODAY });

  it("lists failures of runs, the rate and the quarantine age, worst open first", () => {
    const rows = triage.prompt
      .split("\n")
      .filter((l) => /^\| (login|legacy|checkout|unknown|old)/.test(l));
    expect(rows).toEqual([
      "| login spec | — | No owner | 3 of 6 | 50% (few runs) | Quarantined 26 days (past the 14-day alert) | — |",
      "| legacy rate | — | No owner | Rate only (no run counts) | 30% | Active | — |",
      "| checkout e2e | e2e | Ana | 12 of 100 | 12% | Active | — |",
      "| unknown q | — | No owner | Rate only (no run counts) | 5% | Quarantined (date unknown) | — |",
      "| old fixed | — | No owner | 1 of 10 | 10% | Fixed 2026-10-02 | — |",
    ]);
  });

  it("states the weighted rate without the rate-only rows, the alerts and the verdict", () => {
    expect(triage.prompt).toContain(
      "2 active, 2 quarantined, 1 fixed (1 this quarter). Weighted failure rate: 14.2% (15 failed of 106 runs over 2 open tests with run counts). 2 open tests without run counts are left out of it. 2 open above 20%; 1 with fewer than 10 runs. Quarantined 14 days or more: “login spec” (26 days). 1 quarantined test with no quarantine date."
    );
    expect(patterns.prompt).toContain(
      "Verdict: 2 open flaky tests fail 14.2% of 106 runs (2 more tests without run counts); 1 has been quarantined 14 days or more."
    );
  });

  it("reads “—”, never 0%, with no run counts", () => {
    const [p] = generateFlakyPrompts({
      tests: [test("x", "only legacy", { failureRate: 0.2 })],
      today: TODAY,
    });
    expect(p.prompt).toContain("Weighted failure rate: — (no open test has run counts yet).");
    expect(p.prompt).not.toMatch(/rate: 0%|fail 0%/);
    expect(generateFlakyPrompts({ tests: [], today: TODAY })).toEqual([]);
  });
});
