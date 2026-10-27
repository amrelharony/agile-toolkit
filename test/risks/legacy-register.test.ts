/**
 * The Risk Register's old blob moving into workspace.risks
 * (lib/risks/legacy-register), Phase 7's decision-log move with risk
 * fields: blob rows the workspace lacks are added (examples too, blank ones
 * left), a row both hold fills only its gaps and takes the later status,
 * values both hold differently keep the workspace's and are reported, a
 * row saved since the upgrade (updatedAt) keeps everything, moved ids are
 * left alone, and the plan is idempotent, a lost moved-ids write included.
 */

import { describe, expect, it } from "vitest";
import type { Risk } from "@/lib/stores/workspace-types";
import {
  RISK_CONFLICT_FIELDS,
  RISK_REGISTER_KEY,
  RISK_REGISTER_MOVED_KEY,
  isPendingRiskRow,
  planRiskRegisterMove,
  readRiskRegisterRows,
  withPendingRisks,
} from "@/lib/risks/legacy-register";
import { RISK_REGISTER_KEY as ROUTE_KEY } from "@/lib/handoffs/targets/risk";

const rec = (over: Partial<Risk> = {}): Risk => ({
  id: "r1",
  title: "Vendor API rate limits",
  probability: 3,
  impact: 3,
  status: "open",
  raisedAt: "2026-10-01",
  ...over,
});

/** The page hook's steps on the pure parts: fills replace by id, adds go first (saveRisks). */
function runMove(existing: Risk[], raw: unknown, moved: string[]) {
  const plan = planRiskRegisterMove(raw, existing, moved);
  const fills = new Map(plan.toFill.map((r) => [r.id, r]));
  return {
    plan,
    risks: [...plan.toAdd, ...existing.map((r) => fills.get(r.id) ?? r)],
    moved: plan.moved,
  };
}

describe("the keys", () => {
  it("are the old page's blob and its moved-ids record (the route re-exports the blob key)", () => {
    expect(RISK_REGISTER_KEY).toBe("agile-toolkit:risk-register");
    expect(RISK_REGISTER_MOVED_KEY).toBe("agile-toolkit:risk-register:moved");
    expect(ROUTE_KEY).toBe(RISK_REGISTER_KEY);
    expect(RISK_CONFLICT_FIELDS).toEqual([
      "title",
      "mitigation",
      "mitigationDueAt",
      "probability",
      "impact",
    ]);
  });
});

describe("readRiskRegisterRows", () => {
  it("reads usable rows once each; anything that isn't a list is none", () => {
    expect(readRiskRegisterRows(null)).toEqual([]);
    expect(readRiskRegisterRows({ id: "a" })).toEqual([]);
    expect(
      readRiskRegisterRows([
        { id: "a", title: "A", probability: 2, impact: 4, status: "open", raisedAt: "2026-09-01" },
        { title: "no id" },
        7,
        { id: "a", title: "dup" },
      ])
    ).toEqual([rec({ id: "a", title: "A", probability: 2, impact: 4, raisedAt: "2026-09-01" })]);
  });
});

describe("planRiskRegisterMove", () => {
  it("adds blob rows the workspace lacks, examples included; blank rows stay behind", () => {
    const blob = [
      rec({ id: "b", title: "B", status: "mitigating" }),
      { id: "blank", title: "", probability: 3, impact: 3, status: "open", raisedAt: "2026-10-02" },
      rec({ id: "example-risk-1", title: "From the example" }),
      { id: "due-only", title: "", mitigationDueAt: "2026-11-01", raisedAt: "2026-10-02" },
    ];
    const plan = planRiskRegisterMove(blob, [], []);
    expect(plan.toAdd.map((r) => r.id)).toEqual(["b", "example-risk-1", "due-only"]);
    expect(plan.toFill).toEqual([]);
    expect(plan.conflicts).toEqual([]);
    expect(plan.moved).toEqual(["b", "blank", "example-risk-1", "due-only"]);
    expect(plan.changed).toBe(true);
  });

  it("fills only what the workspace row lacks, never a field it holds", () => {
    const ws = rec({ title: "Vendor limits (agent's title)", mitigation: "  " });
    const blob = [
      rec({
        title: "Vendor API rate limits",
        mitigation: "Ask for a higher tier",
        mitigationDueAt: "2026-11-01",
        owner: "Ana",
        residualProbability: 2,
        residualImpact: 2,
        sourceRef: { tool: "premortem", id: "c1" },
      }),
    ];
    const { toFill, toAdd } = planRiskRegisterMove(blob, [ws], []);
    expect(toAdd).toEqual([]);
    expect(toFill).toEqual([
      rec({
        title: "Vendor limits (agent's title)",
        mitigation: "Ask for a higher tier",
        mitigationDueAt: "2026-11-01",
        owner: "Ana",
        residualProbability: 2,
        residualImpact: 2,
        sourceRef: { tool: "premortem", id: "c1" },
      }),
    ]);
  });

  it("fills a residual rating only as a pair, and only when the row has neither", () => {
    const blob = [rec({ residualProbability: 1, residualImpact: 2 })];
    expect(
      planRiskRegisterMove(blob, [rec({ residualProbability: 4, residualImpact: 4 })], []).toFill
    ).toEqual([]);
    expect(
      planRiskRegisterMove(blob, [rec({ residualProbability: 4 } as Partial<Risk>)], []).toFill
    ).toEqual([]);
  });

  it("reports the values both copies hold differently, kept as the workspace has them", () => {
    // Push copied the row; the team kept editing it on the old page.
    const pushed = rec({
      title: "Vendor API rate limits ",
      mitigation: "Ask for a higher tier",
      mitigationDueAt: "2026-11-01",
      probability: 3,
      impact: 4,
    });
    const blob = [
      rec({
        title: "Vendor API rate limits",
        mitigation: "Cache the responses",
        mitigationDueAt: "2026-11-15",
        probability: 3.4 as Risk["probability"],
        impact: 5,
      }),
    ];
    const plan = planRiskRegisterMove(blob, [pushed], []);
    expect(plan.conflicts).toEqual([
      {
        id: "r1",
        field: "mitigation",
        blob: "Cache the responses",
        workspace: "Ask for a higher tier",
      },
      { id: "r1", field: "mitigationDueAt", blob: "2026-11-15", workspace: "2026-11-01" },
      { id: "r1", field: "impact", blob: 5, workspace: 4 },
    ]);
    // Nothing is overwritten: the row needs no write.
    expect(plan.toFill).toEqual([]);
    // Moved already, or saved since the upgrade (the workspace's is the newer): none.
    expect(planRiskRegisterMove(blob, [pushed], ["r1"]).conflicts).toEqual([]);
    expect(
      planRiskRegisterMove(blob, [{ ...pushed, updatedAt: "2026-10-26T10:00:00Z" }], []).conflicts
    ).toEqual([]);
  });

  it("keeps the later lifecycle status of the two", () => {
    const status = (wsStatus: Risk["status"], blobStatus: Risk["status"]) => {
      const ws = rec({ status: wsStatus });
      const plan = planRiskRegisterMove([rec({ status: blobStatus })], [ws], []);
      return plan.toFill[0]?.status ?? ws.status;
    };
    expect(status("open", "mitigating")).toBe("mitigating");
    expect(status("mitigating", "open")).toBe("mitigating");
    expect(status("open", "closed")).toBe("closed");
    expect(status("accepted", "closed")).toBe("closed");
    expect(status("closed", "accepted")).toBe("closed");
    expect(status("mitigating", "accepted")).toBe("accepted");
    // The same status and nothing to fill: no write.
    expect(planRiskRegisterMove([rec()], [rec()], []).toFill).toEqual([]);
  });

  it("a closed blob copy brings its close date with it", () => {
    const plan = planRiskRegisterMove(
      [rec({ status: "closed", resolvedAt: "2026-10-20" })],
      [rec()],
      []
    );
    expect(plan.toFill).toEqual([rec({ status: "closed", resolvedAt: "2026-10-20" })]);
  });

  it("a row saved since the upgrade keeps everything: its status and values; only its gaps fill", () => {
    const saved = rec({
      status: "open",
      title: "Reworded since",
      updatedAt: "2026-10-26T10:00:00.000Z",
    });
    const blob = [
      rec({ status: "closed", resolvedAt: "2026-10-20", title: "Old title", mitigation: "Plan" }),
    ];
    const [after] = withPendingRisks([saved], blob, []);
    expect(after.status).toBe("open");
    expect(after.title).toBe("Reworded since");
    expect(after.mitigation).toBe("Plan");
    expect(after.updatedAt).toBe("2026-10-26T10:00:00.000Z");
    expect(planRiskRegisterMove(blob, [saved], []).conflicts).toEqual([]);
    // A reopened row's earlier close date counts only while closed.
    expect(after.resolvedAt).toBe("2026-10-20");
  });

  it("never copies a blob row's save stamp onto the workspace row", () => {
    const plan = planRiskRegisterMove(
      [rec({ mitigation: "Plan", updatedAt: "2026-10-26T10:00:00.000Z" })],
      [rec()],
      []
    );
    expect(plan.toFill).toEqual([rec({ mitigation: "Plan" })]);
  });

  it("leaves a row already moved alone, so one deleted since stays deleted", () => {
    const blob = [rec({ id: "gone" }), rec({ id: "kept", mitigation: "Old plan" })];
    expect(planRiskRegisterMove(blob, [rec({ id: "kept" })], ["gone", "kept"])).toEqual({
      toAdd: [],
      toFill: [],
      conflicts: [],
      appeared: [],
      moved: ["gone", "kept"],
      changed: false,
    });
  });

  it("an empty or unreadable blob plans nothing, and keeps only string ids", () => {
    expect(planRiskRegisterMove(null, [rec()], ["a", 3 as unknown as string])).toEqual({
      toAdd: [],
      toFill: [],
      conflicts: [],
      appeared: [],
      moved: ["a"],
      changed: false,
    });
  });

  it("a repeated id in the moved-ids record doesn't hide a new one", () => {
    const plan = planRiskRegisterMove([rec({ id: "a" }), rec({ id: "b" })], [], ["a", "a"]);
    expect(plan.toAdd.map((r) => r.id)).toEqual(["b"]);
    expect(plan.moved).toEqual(["a", "b"]);
    expect(plan.changed).toBe(true);
    expect(planRiskRegisterMove([rec({ id: "a" })], [], ["a", "a"])).toMatchObject({
      moved: ["a"],
      changed: false,
    });
  });

  it("names the workspace rows the old page never listed, on the first move only", () => {
    const existing = [rec({ id: "agent" }), rec({ id: "both" })];
    const blob = [rec({ id: "both" }), rec({ id: "blob" })];
    expect(planRiskRegisterMove(blob, existing, []).appeared).toEqual(["agent"]);
    expect(planRiskRegisterMove(blob, existing, ["blob"]).appeared).toEqual([]);
    expect(planRiskRegisterMove(null, existing, []).appeared).toEqual([]);
  });

  it("is idempotent: the same plan twice, nothing after saving it, nothing when the moved write was lost", () => {
    const blob = [
      rec({ id: "a", title: "A", status: "mitigating", mitigation: "Plan A" }),
      rec({ id: "both", title: "Both", status: "closed", resolvedAt: "2026-10-20" }),
    ];
    const existing = [rec({ id: "both", title: "Both" })];
    expect(planRiskRegisterMove(blob, existing, [])).toEqual(
      planRiskRegisterMove(blob, existing, [])
    );
    const once = runMove(existing, blob, []);
    expect(once.risks.map((r) => [r.id, r.status])).toEqual([
      ["a", "mitigating"],
      ["both", "closed"],
    ]);
    expect(planRiskRegisterMove(blob, once.risks, once.moved)).toEqual({
      toAdd: [],
      toFill: [],
      conflicts: [],
      appeared: [],
      moved: ["a", "both"],
      changed: false,
    });
    // The moved-ids write was lost (another device, a closed tab): nothing to add or fill.
    const lost = planRiskRegisterMove(blob, once.risks, []);
    expect(lost.toAdd).toEqual([]);
    expect(lost.toFill).toEqual([]);
    expect(lost.changed).toBe(true);
    // Run twice, the second run changes nothing.
    const twice = runMove(once.risks, blob, once.moved);
    expect(twice.risks).toEqual(once.risks);
  });
});

describe("isPendingRiskRow", () => {
  it("is a blob row the move hasn't handled yet", () => {
    const blob = [rec({ id: "a" }), rec({ id: "b" })];
    expect(isPendingRiskRow("a", blob, [])).toBe(true);
    expect(isPendingRiskRow("b", blob, ["b"])).toBe(false);
    expect(isPendingRiskRow("c", blob, [])).toBe(false);
    expect(isPendingRiskRow("a", null, [])).toBe(false);
  });
});

describe("withPendingRisks", () => {
  it("reads the risks as they will be once moved", () => {
    const existing = [rec({ id: "both" }), rec({ id: "ws-only" })];
    const blob = [
      rec({ id: "both", status: "mitigating" }),
      rec({ id: "blob-only", title: "Old" }),
    ];
    expect(withPendingRisks(existing, blob, []).map((r) => [r.id, r.status])).toEqual([
      ["both", "mitigating"],
      ["ws-only", "open"],
      ["blob-only", "open"],
    ]);
    expect(withPendingRisks(existing, blob, ["both", "blob-only"])).toEqual(existing);
    expect(withPendingRisks(existing, null, [])).toEqual(existing);
  });
});
