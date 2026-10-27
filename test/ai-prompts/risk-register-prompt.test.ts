// @vitest-environment node
import { describe, expect, it } from "vitest";
import { generateRiskRegisterPrompts } from "@/lib/ai-prompts/risk-register";
import type { Risk } from "@/lib/stores/workspace-types";

/**
 * The risk prompt reads the register as the page does (lib/risks/model):
 * each risk's score and level, owner, days overdue and rating after
 * mitigation (flagged when it is worse than now), in the register's order,
 * with the counts, the exposure and the page's verdict.
 */

const TODAY = "2026-10-27";

const risk = (id: string, title: string, extra: Partial<Risk>): Risk => ({
  id,
  title,
  probability: 1,
  impact: 1,
  status: "open",
  raisedAt: "2026-09-01",
  ...extra,
});

const RISKS: Risk[] = [
  risk("r3", "Scope creep", {
    probability: 2,
    impact: 2,
    status: "closed",
    resolvedAt: "2026-10-10",
  }),
  risk("r4", "Migration", {
    probability: 2,
    impact: 3,
    owner: "Sam",
    residualProbability: 3,
    residualImpact: 3,
  }),
  risk("r2", "Key person leaves", {
    probability: 3,
    impact: 4,
    status: "mitigating",
    mitigationDueAt: "2026-11-15",
  }),
  risk("r1", "Vendor outage", {
    probability: 4,
    impact: 5,
    owner: "Ana",
    mitigation: "Second vendor",
    mitigationDueAt: "2026-10-20",
    residualProbability: 2,
    residualImpact: 3,
  }),
];

describe("generateRiskRegisterPrompts", () => {
  const [prioritize, mitigation] = generateRiskRegisterPrompts({
    risks: RISKS,
    today: TODAY,
    medianTTM: null,
    closed: 1,
  });

  it("lists each risk's score, level, owner, overdue days and rating after mitigation, in order", () => {
    const rows = prioritize.prompt
      .split("\n")
      .filter((l) => /^\| (Vendor|Key|Migration|Scope)/.test(l));
    expect(rows).toEqual([
      "| Vendor outage | Ana | 4 | 5 | 20 (Critical) | Open | 2026-10-20 (7 days overdue) | 6 (Medium) | Second vendor |",
      "| Key person leaves | No owner | 3 | 4 | 12 (High) | Mitigating | 2026-11-15 | Not assessed | None yet |",
      "| Migration | Sam | 2 | 3 | 6 (Medium) | Open | — | 9 (Medium), above the current rating | None yet |",
      "| Scope creep | No owner | 2 | 2 | 4 (Low) | Closed | — | Not assessed | None yet |",
    ]);
  });

  it("states the counts, the exposure and the page's verdict", () => {
    expect(prioritize.prompt).toContain(
      "3 active risks (open or mitigating), 2 high or critical, 1 mitigation overdue, 1 with no owner. Exposure (sum of active scores) 38 now, 27 after mitigation (2 of 3 rated for after). Median time to mitigate: — (shows once 3 are closed; 1 so far)."
    );
    expect(mitigation.prompt).toContain(
      "Verdict: 1 mitigation is overdue, “Vendor outage” by 7 days; 3 active risks, 2 high or critical; 1 high or critical risk has no owner."
    );
  });

  it("counts the example's rows while the page shows only its example, as its cards do", () => {
    // The page passes countedRisks: the example alone, never mixed with the team's rows.
    const [p] = generateRiskRegisterPrompts({
      risks: RISKS.map((r) => ({ ...r, id: `example-${r.id}` })),
      today: TODAY,
      medianTTM: null,
      closed: 1,
    });
    expect(p.prompt).toContain(
      "3 active risks (open or mitigating), 2 high or critical, 1 mitigation overdue, 1 with no owner. Exposure (sum of active scores) 38 now"
    );
    expect(p.prompt).toContain("Verdict: 1 mitigation is overdue, “Vendor outage” by 7 days;");
    expect(p.prompt).not.toContain("No risks logged yet.");
  });

  it("quotes the median time to mitigate once there is one", () => {
    const [p] = generateRiskRegisterPrompts({
      risks: RISKS,
      today: TODAY,
      medianTTM: 12,
      closed: 5,
    });
    expect(p.prompt).toContain("Median time to mitigate: 12 days (over 5 closed).");
    expect(
      generateRiskRegisterPrompts({ risks: [], today: TODAY, medianTTM: null, closed: 0 })
    ).toEqual([]);
  });

  it("tells too few closed apart from fewer than half closed, as the page's card does", () => {
    // Enough closed for the sample, but the Kaplan-Meier median isn't reached yet.
    const [p] = generateRiskRegisterPrompts({
      risks: RISKS,
      today: TODAY,
      medianTTM: null,
      closed: 4,
    });
    expect(p.prompt).toContain(
      "Median time to mitigate: — (fewer than half have closed yet, over 4 closed)."
    );
    expect(p.prompt).not.toContain("shows once");
  });
});
