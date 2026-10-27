/**
 * lib/risks/model: the one reading of a risk. Ratings on the 1–5 scale,
 * the register's bands and the one "high", the residual rating as a pair,
 * overdue and age from local days, closedOn for a reopened risk, the order,
 * the summary and verdict without examples, the impediment hand-off, and a
 * stored row read into today's shape.
 */

import { describe, expect, it } from "vitest";
import type { Risk } from "@/lib/stores/workspace-types";
import {
  RISK_LEVEL_SEVERITY,
  RISK_STATUSES,
  RISK_STATUS_RANK,
  closedOn,
  compareRisks,
  impedimentLinkOf,
  isActiveRisk,
  isHighLevel,
  isHighRisk,
  isRiskOverdue,
  linksOf,
  normalizeRisk,
  residualAboveCurrent,
  residualScore,
  riskAgeDays,
  riskAgeSprints,
  riskDaysOverdue,
  riskImpedimentSource,
  riskLevel,
  riskLevelOf,
  riskScore,
  riskSummary,
  riskTimeToClose,
  riskVerdict,
  sprintLengthOr,
  toScale,
} from "@/lib/risks/model";

const TODAY = "2026-10-27";

const risk = (over: Partial<Risk> = {}): Risk => ({
  id: "r1",
  title: "Vendor API rate limits",
  probability: 3,
  impact: 3,
  status: "open",
  raisedAt: "2026-10-01",
  ...over,
});

describe("toScale and riskScore", () => {
  it("rounds and clamps a number onto 1–5; anything else is null", () => {
    expect(toScale(3)).toBe(3);
    expect(toScale(2.5)).toBe(3);
    expect(toScale(0)).toBe(1);
    expect(toScale(9)).toBe(5);
    expect(toScale("4")).toBe(4);
    expect(toScale("")).toBeNull();
    expect(toScale(null)).toBeNull();
    expect(toScale(undefined)).toBeNull();
    expect(toScale(Number.NaN)).toBeNull();
    expect(toScale("high")).toBeNull();
  });

  it("scores probability × impact on the scale, reading a non-number as 1 (as the old page)", () => {
    expect(riskScore({ probability: 4, impact: 5 })).toBe(20);
    expect(riskScore({ probability: 7, impact: 2.4 })).toBe(10);
    expect(riskScore({ probability: Number.NaN, impact: 5 })).toBe(5);
  });
});

describe("riskLevel and the one 'high'", () => {
  it("bands: ≥16 critical, ≥10 high, ≥5 medium, else low", () => {
    expect([1, 4, 5, 9, 10, 15, 16, 25].map(riskLevel)).toEqual([
      "low",
      "low",
      "medium",
      "medium",
      "high",
      "high",
      "critical",
      "critical",
    ]);
    expect(riskLevelOf({ probability: 4, impact: 4 })).toBe("critical");
  });

  it("high means high or critical", () => {
    expect(["low", "medium", "high", "critical"].map((l) => isHighLevel(l as never))).toEqual([
      false,
      false,
      true,
      true,
    ]);
    expect(isHighRisk({ probability: 2, impact: 5 })).toBe(true);
    expect(isHighRisk({ probability: 3, impact: 3 })).toBe(false);
  });

  it("maps each level to the same impediment severity", () => {
    expect(RISK_LEVEL_SEVERITY).toEqual({
      low: "low",
      medium: "medium",
      high: "high",
      critical: "critical",
    });
  });

  it("ranks the lifecycle in order", () => {
    expect(RISK_STATUSES.map((s) => RISK_STATUS_RANK[s])).toEqual([0, 1, 2, 3]);
  });
});

describe("residual rating", () => {
  it("scores only as a pair", () => {
    expect(residualScore(risk())).toBeNull();
    expect(residualScore(risk({ residualProbability: 2 }))).toBeNull();
    expect(residualScore(risk({ residualProbability: 2, residualImpact: 3 }))).toBe(6);
  });

  it("flags a residual above the current score (a warning, never a refusal)", () => {
    expect(residualAboveCurrent(risk({ residualProbability: 4, residualImpact: 4 }))).toBe(true);
    expect(residualAboveCurrent(risk({ residualProbability: 3, residualImpact: 3 }))).toBe(false);
    expect(residualAboveCurrent(risk())).toBe(false);
  });
});

describe("lifecycle and dates", () => {
  it("active is open or mitigating", () => {
    expect(RISK_STATUSES.map((status) => isActiveRisk({ status }))).toEqual([
      true,
      true,
      false,
      false,
    ]);
  });

  it("closedOn reads resolvedAt only while closed, as its day", () => {
    expect(closedOn(risk({ status: "closed", resolvedAt: "2026-10-20" }))).toBe("2026-10-20");
    expect(closedOn(risk({ status: "closed", resolvedAt: "2026-10-20T23:00:00Z" }))).toBe(
      "2026-10-20"
    );
    // Reopened: the old close date stays on the row but doesn't count.
    expect(closedOn(risk({ status: "mitigating", resolvedAt: "2026-10-20" }))).toBeUndefined();
    expect(closedOn(risk({ status: "closed", resolvedAt: "soon" }))).toBeUndefined();
  });

  it("overdue: active with a due day before today; due today, closed, accepted or none is not", () => {
    expect(riskDaysOverdue(risk({ mitigationDueAt: "2026-10-24" }), TODAY)).toBe(3);
    expect(isRiskOverdue(risk({ mitigationDueAt: "2026-10-26" }), TODAY)).toBe(true);
    expect(isRiskOverdue(risk({ mitigationDueAt: TODAY }), TODAY)).toBe(false);
    expect(isRiskOverdue(risk({ mitigationDueAt: "2026-10-30" }), TODAY)).toBe(false);
    expect(isRiskOverdue(risk({ status: "closed", mitigationDueAt: "2026-10-01" }), TODAY)).toBe(
      false
    );
    expect(isRiskOverdue(risk({ status: "accepted", mitigationDueAt: "2026-10-01" }), TODAY)).toBe(
      false
    );
    expect(riskDaysOverdue(risk(), TODAY)).toBe(0);
    expect(riskDaysOverdue(risk({ mitigationDueAt: "not a date" }), TODAY)).toBe(0);
  });

  it("age runs from raised to closed (today while not closed), never negative", () => {
    expect(riskAgeDays(risk(), TODAY)).toBe(26);
    expect(riskAgeDays(risk({ status: "closed", resolvedAt: "2026-10-15" }), TODAY)).toBe(14);
    // A reopened risk ages to today.
    expect(riskAgeDays(risk({ status: "open", resolvedAt: "2026-10-15" }), TODAY)).toBe(26);
    expect(riskAgeDays(risk({ raisedAt: "2026-10-30" }), TODAY)).toBe(0);
    expect(riskAgeDays(risk({ raisedAt: "" }), TODAY)).toBeNull();
  });

  it("age in sprints is ⌊days ÷ the sprint length⌋, 14 when the length isn't usable", () => {
    expect(riskAgeSprints(risk(), 14, TODAY)).toBe(1);
    expect(riskAgeSprints(risk(), 7, TODAY)).toBe(3);
    expect(riskAgeSprints(risk(), 0, TODAY)).toBe(1);
    expect(riskAgeSprints(risk({ raisedAt: "x" }), 14, TODAY)).toBeNull();
    expect([
      sprintLengthOr(21),
      sprintLengthOr(0),
      sprintLengthOr(2.5),
      sprintLengthOr("7"),
    ]).toEqual([21, 14, 14, 14]);
  });
});

describe("compareRisks", () => {
  it("active first, then score, then days overdue, then title", () => {
    const list = [
      risk({ id: "closed", title: "A", probability: 5, impact: 5, status: "closed" }),
      risk({ id: "low", title: "B", probability: 1, impact: 1 }),
      risk({ id: "top", title: "C", probability: 5, impact: 4 }),
      risk({
        id: "tie-late",
        title: "D",
        probability: 3,
        impact: 3,
        mitigationDueAt: "2026-10-20",
      }),
      risk({ id: "tie-b", title: "F", probability: 3, impact: 3 }),
      risk({ id: "tie-a", title: "E", probability: 3, impact: 3 }),
      risk({ id: "accepted", title: "G", probability: 4, impact: 4, status: "accepted" }),
    ];
    expect([...list].sort((a, b) => compareRisks(a, b, TODAY)).map((r) => r.id)).toEqual([
      "top",
      "tie-late",
      "tie-a",
      "tie-b",
      "low",
      "closed",
      "accepted",
    ]);
  });
});

describe("riskSummary and riskVerdict", () => {
  const list = [
    risk({ id: "a", title: "Payment sandbox outage", probability: 4, impact: 4, owner: "Ana" }),
    risk({
      id: "b",
      title: "One developer knows checkout",
      probability: 3,
      impact: 5,
      status: "mitigating",
      mitigationDueAt: "2026-10-22",
      residualProbability: 2,
      residualImpact: 3,
    }),
    risk({ id: "c", title: "Small", probability: 1, impact: 2 }),
    risk({ id: "d", status: "closed", resolvedAt: "2026-10-10" }),
    risk({ id: "e", status: "accepted" }),
    risk({ id: "example-risk-1", probability: 5, impact: 5 }),
  ];

  it("counts real risks only; levels, exposure and owners over the active ones", () => {
    expect(riskSummary(list, TODAY)).toEqual({
      total: 5,
      byStatus: { open: 2, mitigating: 1, accepted: 1, closed: 1 },
      byLevel: { low: 1, medium: 0, high: 1, critical: 1 },
      active: 3,
      high: 2,
      overdue: 1,
      unowned: 2,
      exposure: 16 + 15 + 2,
      residualExposure: 16 + 6 + 2,
      residualAssessed: 1,
    });
  });

  it("leads with the overdue mitigation and names unowned high risks", () => {
    expect(riskVerdict(list, TODAY)).toBe(
      "1 mitigation is overdue, “One developer knows checkout” by 5 days; 3 active risks, 2 high or critical; 1 high or critical risk has no owner."
    );
  });

  it("without an overdue one, names the top active risk", () => {
    const calm = list.map((r) => ({ ...r, mitigationDueAt: undefined, owner: "Ana" }));
    expect(riskVerdict(calm, TODAY)).toBe(
      "3 active risks, 2 high or critical; the top one, “Payment sandbox outage”, scores 16 (critical)."
    );
  });

  it("says so when nothing is active, or nothing is logged (examples aside)", () => {
    expect(riskVerdict([list[3], list[4]], TODAY)).toBe("No active risks: 1 closed, 1 accepted.");
    expect(riskVerdict([list[5]], TODAY)).toBe("No risks logged yet.");
    expect(riskVerdict([], TODAY)).toBe("No risks logged yet.");
  });

  it("counts example rows when asked, for a page holding only its example", () => {
    const opts = { includeExamples: true };
    expect(riskSummary([list[5]], TODAY, opts)).toMatchObject({
      total: 1,
      active: 1,
      high: 1,
      unowned: 1,
      exposure: 25,
    });
    expect(riskSummary(list, TODAY, opts)).toMatchObject({ total: 6, active: 4, exposure: 58 });
    expect(riskVerdict([list[5]], TODAY, opts)).toBe(
      "1 active risk, 1 high or critical; the top one, “Vendor API rate limits”, scores 25 (critical); 1 high or critical risk has no owner."
    );
  });
});

describe("riskTimeToClose", () => {
  const closed = (id: string, resolvedAt: string) => risk({ id, status: "closed", resolvedAt });

  it("is the Kaplan-Meier median of days raised → closed, from 3 closed risks", () => {
    const list = [
      closed("a", "2026-10-05"),
      closed("b", "2026-10-09"),
      closed("c", "2026-10-13"),
      // Reopened: the old close day stays, but it is still waiting at today.
      risk({ id: "d", status: "mitigating", resolvedAt: "2026-10-02" }),
      // Accepted: the team chose not to mitigate it.
      risk({ id: "e", status: "accepted" }),
    ];
    expect(riskTimeToClose(list, TODAY)).toEqual({ closed: 3, medianDays: 8 });
    expect(riskTimeToClose(list.slice(0, 2), TODAY)).toEqual({ closed: 2, medianDays: null });
    expect(riskTimeToClose([risk({ raisedAt: "" })], TODAY)).toEqual({
      closed: 0,
      medianDays: null,
    });
  });

  it("leaves out a closed risk with no close day: when it closed isn't known", () => {
    const dated = [
      closed("a", "2026-10-05"),
      closed("b", "2026-10-09"),
      closed("c", "2026-10-13"),
      risk({ id: "d", status: "open" }),
    ];
    // Counted as still waiting at today (26 days), it would pull the median from 8 to 12.
    for (const resolvedAt of [undefined, "", "not a day"]) {
      const undated = risk({ id: "f", status: "closed", resolvedAt });
      expect(riskTimeToClose([...dated, undated], TODAY), String(resolvedAt)).toEqual(
        riskTimeToClose(dated, TODAY)
      );
    }
    expect(riskTimeToClose(dated, TODAY)).toEqual({ closed: 3, medianDays: 8 });
  });
});

describe("the impediment hand-off", () => {
  it("hands over title, description and plan, owner, level as severity and the link back", () => {
    expect(
      riskImpedimentSource(
        risk({
          id: "r9",
          title: "Sandbox down",
          description: "Blocks wallet tests",
          mitigation: "Stub the provider",
          owner: "Ana",
          probability: 4,
          impact: 5,
        })
      )
    ).toEqual({
      title: "Sandbox down",
      description: "Blocks wallet tests\n\nMitigation plan: Stub the provider",
      owner: "Ana",
      severity: "critical",
      sourceRef: { tool: "risk-register", id: "r9" },
    });
    expect(riskImpedimentSource(risk({ probability: 1, impact: 2 }))).toEqual({
      title: "Vendor API rate limits",
      severity: "low",
      sourceRef: { tool: "risk-register", id: "r1" },
    });
  });

  it("finds the newest impediment link", () => {
    const at = "2026-10-01T00:00:00.000Z";
    expect(impedimentLinkOf(risk())).toBeUndefined();
    expect(
      impedimentLinkOf(
        risk({
          sentTo: [
            { route: "impediment", targetId: "i1", at },
            { route: "kanban", targetId: "k1", at },
            { route: "impediment", targetId: "i2", at },
          ],
        })
      )?.targetId
    ).toBe("i2");
  });
});

describe("normalizeRisk", () => {
  it("reads an old blob row into today's shape", () => {
    expect(
      normalizeRisk({
        id: "b1",
        title: "  Old page risk ",
        probability: 2.6,
        impact: "x",
        status: "weird",
        raisedAt: "2026-09-01T08:00:00Z",
        resolvedAt: "never",
        mitigation: "  ",
        mitigationDueAt: "2026-02-30",
        residualProbability: 2,
        owner: " Ana ",
      })
    ).toEqual({
      id: "b1",
      title: "Old page risk",
      probability: 3,
      impact: 1,
      status: "open",
      raisedAt: "2026-09-01",
      owner: "Ana",
    });
  });

  it("keeps every Phase 8 field, a residual pair and valid links", () => {
    const at = "2026-10-01T00:00:00.000Z";
    expect(
      normalizeRisk({
        id: "b2",
        title: "Full",
        probability: 4,
        impact: 4,
        status: "closed",
        raisedAt: "2026-09-01",
        resolvedAt: "2026-10-01",
        mitigationDueAt: "2026-09-20",
        description: "More",
        residualProbability: 1,
        residualImpact: 2,
        sourceRef: { tool: "premortem", id: "c1", doc: "p1" },
        sentTo: [
          { route: "impediment", targetId: "i1", at },
          { route: "nope", targetId: "x", at },
        ],
        updatedAt: "2026-10-26T10:00:00.000Z",
      })
    ).toEqual({
      id: "b2",
      title: "Full",
      probability: 4,
      impact: 4,
      status: "closed",
      raisedAt: "2026-09-01",
      resolvedAt: "2026-10-01",
      mitigationDueAt: "2026-09-20",
      description: "More",
      residualProbability: 1,
      residualImpact: 2,
      sourceRef: { tool: "premortem", id: "c1", doc: "p1" },
      sentTo: [{ route: "impediment", targetId: "i1", at }],
      updatedAt: "2026-10-26T10:00:00.000Z",
    });
  });

  it("drops what can't be a risk", () => {
    expect(normalizeRisk(null)).toBeNull();
    expect(normalizeRisk("r1")).toBeNull();
    expect(normalizeRisk({ title: "no id" })).toBeNull();
    expect(normalizeRisk({ id: "  " })).toBeNull();
    expect(linksOf("nope")).toBeUndefined();
    expect(linksOf([])).toBeUndefined();
  });
});
