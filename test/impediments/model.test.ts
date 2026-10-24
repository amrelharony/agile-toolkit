import { describe, expect, it } from "vitest";
import {
  addDays,
  daysOverdue,
  fillFromLegacy,
  fromLegacyImpediment,
  impedimentAgeDays,
  impedimentDueDate,
  impedimentStatus,
  impedimentSummary,
  isImpedimentOverdue,
  openDuring,
  sortImpediments,
  withImpedimentStatus,
} from "@/lib/impediments/model";
import type { Impediment } from "@/lib/stores/workspace-types";

/**
 * Impediments read the same everywhere: the page, the cockpit, hand-offs
 * and agents. Status is derived from the dates.
 */

const imp = (over: Partial<Impediment> = {}): Impediment => ({
  id: "i",
  title: "Waiting on the API keys",
  severity: "medium",
  raisedAt: "2026-10-01",
  ...over,
});

const TODAY = "2026-10-24";

describe("status", () => {
  it("derives open, escalated and resolved from the dates", () => {
    expect(impedimentStatus(imp())).toBe("open");
    expect(impedimentStatus(imp({ escalatedAt: "2026-10-02" }))).toBe("escalated");
    expect(impedimentStatus(imp({ escalatedAt: "2026-10-02", resolvedAt: "2026-10-05" }))).toBe(
      "resolved"
    );
  });

  it("escalates, resolves (keeping the escalation) and reopens (clearing both)", () => {
    const escalated = withImpedimentStatus(imp(), "escalated", "2026-10-02");
    expect(escalated).toMatchObject({ escalatedAt: "2026-10-02" });
    const resolved = withImpedimentStatus(escalated, "resolved", "2026-10-05");
    expect(resolved).toMatchObject({ escalatedAt: "2026-10-02", resolvedAt: "2026-10-05" });
    const reopened = withImpedimentStatus(resolved, "open", "2026-10-06");
    expect("resolvedAt" in reopened || "escalatedAt" in reopened).toBe(false);
    // Unchanged: the same object, so callers can skip the write.
    expect(withImpedimentStatus(resolved, "resolved", "2027-01-01")).toBe(resolved);
  });

  it("re-escalating a resolved one keeps the first escalation date", () => {
    const resolved = imp({ escalatedAt: "2026-10-02", resolvedAt: "2026-10-05" });
    expect(withImpedimentStatus(resolved, "escalated", "2026-10-09")).toEqual(
      imp({ escalatedAt: "2026-10-02" })
    );
  });
});

describe("due dates and age", () => {
  it("uses the due date, else raised plus the expected days", () => {
    expect(impedimentDueDate(imp({ dueDate: "2026-10-10", expectedResolutionDays: 1 }))).toBe(
      "2026-10-10"
    );
    expect(impedimentDueDate(imp({ expectedResolutionDays: 5 }))).toBe("2026-10-06");
    expect(impedimentDueDate(imp())).toBeNull();
    expect(impedimentDueDate(imp({ expectedResolutionDays: -1 }))).toBeNull();
  });

  it("is overdue only unresolved and past due", () => {
    expect(isImpedimentOverdue(imp({ dueDate: "2026-10-23" }), TODAY)).toBe(true);
    expect(isImpedimentOverdue(imp({ dueDate: TODAY }), TODAY)).toBe(false);
    expect(daysOverdue(imp({ dueDate: "2026-10-20" }), TODAY)).toBe(4);
    expect(daysOverdue(imp({ dueDate: "2026-10-20", resolvedAt: "2026-10-22" }), TODAY)).toBe(0);
  });

  it("ages to today while open and to the resolution once resolved; reads full timestamps by day", () => {
    expect(impedimentAgeDays(imp(), TODAY)).toBe(23);
    expect(impedimentAgeDays(imp({ resolvedAt: "2026-10-04T18:00:00Z" }), TODAY)).toBe(3);
    expect(impedimentAgeDays(imp({ raisedAt: "garbage" }), TODAY)).toBeNull();
    expect(addDays("2026-12-30", 3)).toBe("2027-01-02");
  });
});

describe("order and summary", () => {
  const list = [
    imp({ id: "resolved-old", resolvedAt: "2026-10-03" }),
    imp({ id: "open-low", severity: "low" }),
    imp({ id: "open-critical", severity: "critical", raisedAt: "2026-10-10" }),
    imp({ id: "open-overdue", severity: "low", dueDate: "2026-10-20" }),
    imp({ id: "escalated", escalatedAt: "2026-10-05" }),
    imp({ id: "resolved-new", resolvedAt: "2026-10-20" }),
  ];

  it("puts escalated first, then overdue, severe, old; resolved last, latest first", () => {
    expect(sortImpediments(list, TODAY).map((i) => i.id)).toEqual([
      "escalated",
      "open-overdue",
      "open-critical",
      "open-low",
      "resolved-new",
      "resolved-old",
    ]);
  });

  it("counts by status with overdue, critical and resolution time", () => {
    expect(impedimentSummary(list, TODAY)).toEqual({
      total: 6,
      open: 3,
      escalated: 1,
      resolved: 2,
      overdue: 1,
      critical: 1,
      avgResolutionDays: 10.5,
      oldestOpenDays: 23,
    });
    expect(impedimentSummary([], TODAY)).toMatchObject({
      avgResolutionDays: null,
      oldestOpenDays: null,
    });
  });

  it("knows what was in the way during a sprint", () => {
    expect(openDuring(imp({ raisedAt: "2026-09-20" }), "2026-10-01", "2026-10-14")).toBe(true);
    expect(openDuring(imp({ raisedAt: "2026-10-15" }), "2026-10-01", "2026-10-14")).toBe(false);
    expect(
      openDuring(
        imp({ raisedAt: "2026-09-01", resolvedAt: "2026-09-30" }),
        "2026-10-01",
        "2026-10-14"
      )
    ).toBe(false);
  });
});

describe("the tool's old local rows", () => {
  const legacy = {
    id: "l1",
    title: " Build server down ",
    description: "Since Monday",
    category: "Technical",
    severity: "High",
    raisedBy: "Alice",
    assignedTo: "Sam",
    status: "Escalated",
    raisedDate: "2026-10-02",
    expectedResolutionDays: 3,
    source: "standup",
    sourceRef: { tool: "standup", id: "e1" },
  };

  it("maps every field, lowercasing the enums", () => {
    expect(fromLegacyImpediment(legacy)).toEqual({
      id: "l1",
      title: "Build server down",
      severity: "high",
      raisedAt: "2026-10-02",
      escalatedAt: "2026-10-02",
      owner: "Sam",
      source: "standup",
      sourceRef: { tool: "standup", id: "e1" },
      description: "Since Monday",
      category: "technical",
      raisedBy: "Alice",
      expectedResolutionDays: 3,
    });
  });

  it("resolves on its resolved date (else the raised date) and skips unreadable rows", () => {
    expect(
      fromLegacyImpediment({ ...legacy, status: "Resolved", resolvedDate: "2026-10-04" })
    ).toMatchObject({ resolvedAt: "2026-10-04" });
    expect(fromLegacyImpediment({ ...legacy, status: "Resolved" })).toMatchObject({
      resolvedAt: "2026-10-02",
    });
    expect(fromLegacyImpediment({ ...legacy, raisedDate: "" })).toBeNull();
    expect(fromLegacyImpediment({ ...legacy, title: "  " })).toBeNull();
    expect(fromLegacyImpediment(null)).toBeNull();
  });

  it("fills only the gaps of a row the workspace has, and never escalates a resolved one", () => {
    const local = fromLegacyImpediment(legacy)!;
    const shared = imp({ id: "l1", title: "Edited by an agent", owner: "Kim" });
    expect(fillFromLegacy(shared, local)).toMatchObject({
      title: "Edited by an agent",
      owner: "Kim",
      description: "Since Monday",
      category: "technical",
      escalatedAt: "2026-10-02",
    });
    const resolved = { ...shared, resolvedAt: "2026-10-05" };
    expect(fillFromLegacy(resolved, local).escalatedAt).toBeUndefined();
  });
});
