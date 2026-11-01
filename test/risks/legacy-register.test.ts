/**
 * The Risk Register's old blob moving into workspace.risks
 * (lib/risks/legacy-register), Phase 7's decision-log move with risk
 * fields: blob rows the workspace lacks are added (examples too, blank ones
 * left), a row both hold fills only its gaps and takes the later status,
 * values both hold differently keep the workspace's and are reported, a
 * row saved since the upgrade (updatedAt) keeps everything (nothing filled,
 * a field cleared since stays clear), rows only the workspace holds are
 * reported until saved (an empty blob too), every reported row is saved
 * so its notice shows once, moved ids are left alone, and the plan is
 * idempotent, a lost moved-ids write included.
 */

import { describe, expect, it } from "vitest";
import type { Risk } from "@/lib/stores/workspace-types";
import {
  RISK_CONFLICT_FIELDS,
  RISK_REGISTER_KEY,
  RISK_REGISTER_MOVED_KEY,
  isPendingRiskRow,
  listedRisk,
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

/** The save stamp runMove writes, as saveRisks would. */
const SAVED_AT = "2026-10-27T09:00:00.000Z";

/**
 * The page hook's steps on the pure parts, as saveRisks writes them: every
 * row it saves is stamped, fills replace by id, adds go first.
 */
function runMove(existing: Risk[], raw: unknown, moved: string[]) {
  const plan = planRiskRegisterMove(raw, existing, moved);
  const stamp = (r: Risk): Risk => ({ ...r, updatedAt: SAVED_AT });
  const fills = new Map(plan.toFill.map((r) => [r.id, stamp(r)]));
  return {
    plan,
    risks: [...plan.toAdd.map(stamp), ...existing.map((r) => fills.get(r.id) ?? r)],
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
    // Nothing is overwritten: the row is saved as it is (the same object),
    // so the save's stamp settles it and the conflict is reported once.
    expect(plan.toFill).toHaveLength(1);
    expect(plan.toFill[0]).toBe(pushed);
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

  it("a row saved since the upgrade keeps everything: its status and values, nothing filled", () => {
    const saved = rec({
      status: "open",
      title: "Reworded since",
      updatedAt: "2026-10-26T10:00:00.000Z",
    });
    const blob = [
      rec({
        status: "closed",
        resolvedAt: "2026-10-20",
        title: "Old title",
        mitigation: "Plan",
        owner: "Ana",
        residualProbability: 1,
        residualImpact: 2,
      }),
    ];
    const [after] = withPendingRisks([saved], blob, []);
    expect(after).toBe(saved);
    const plan = planRiskRegisterMove(blob, [saved], []);
    expect(plan.toFill).toEqual([]);
    expect(plan.conflicts).toEqual([]);
    expect(plan.appeared).toEqual([]);
  });

  it("a field cleared since the upgrade stays clear: no gap fill brings it back", () => {
    // Every Phase 8 writer saved the row with the blob's copy folded in, so a
    // blank or missing field on a stamped row was cleared since, on purpose.
    const cleared = rec({ mitigation: "", updatedAt: "2026-10-26T10:00:00.000Z" });
    const blob = [rec({ mitigation: "Ask for a higher tier", mitigationDueAt: "2026-11-01" })];
    expect(withPendingRisks([cleared], blob, [])).toEqual([cleared]);
    expect(planRiskRegisterMove(blob, [cleared], []).toFill).toEqual([]);
    expect(listedRisk(cleared, blob, [])).toBe(cleared);
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

  it("names the workspace rows the old page never listed, until they are saved", () => {
    const existing = [rec({ id: "agent" }), rec({ id: "both" })];
    const blob = [rec({ id: "both" }), rec({ id: "blob" })];
    const plan = planRiskRegisterMove(blob, existing, []);
    expect(plan.appeared).toEqual(["agent"]);
    // Saved as it is (the same object), so the save's stamp settles it.
    expect(plan.toFill).toEqual([existing[0]]);
    expect(plan.toFill[0]).toBe(existing[0]);
    // An id the page marked moved before the move ran doesn't hide the notice.
    expect(planRiskRegisterMove(blob, existing, ["blob"]).appeared).toEqual(["agent"]);
    // Saved since the upgrade: a new row (an agent's, a hand-off's), not one that appeared.
    const stamped = { ...existing[0], updatedAt: "2026-10-26T10:00:00.000Z" };
    expect(planRiskRegisterMove(blob, [stamped, existing[1]], []).appeared).toEqual([]);
    // No blob at all: the old page listed nothing to compare with.
    expect(planRiskRegisterMove(null, existing, []).appeared).toEqual([]);
  });

  it("an empty blob (every row deleted on the old page) names the rows that come back", () => {
    // The old page's delete removed a Pushed row from its blob only: the
    // workspace's copy is still there and the one-store register lists it.
    const pushed = [rec({ id: "w1" }), rec({ id: "w2", title: "Second" })];
    const plan = planRiskRegisterMove([], pushed, []);
    expect(plan.appeared).toEqual(["w1", "w2"]);
    expect(plan.toFill).toEqual(pushed);
    expect(plan.toAdd).toEqual([]);
    expect(plan.moved).toEqual([]);
    // Once saved (stamped), the notice isn't shown again.
    const once = runMove(pushed, [], []);
    expect(planRiskRegisterMove([], once.risks, once.moved)).toEqual({
      toAdd: [],
      toFill: [],
      conflicts: [],
      appeared: [],
      moved: [],
      changed: false,
    });
    // Read through unchanged meanwhile.
    expect(withPendingRisks(pushed, [], [])).toEqual(pushed);
  });

  it("is idempotent: the same plan twice, nothing after saving it, nothing when the moved write was lost", () => {
    const blob = [
      rec({ id: "a", title: "A", status: "mitigating", mitigation: "Plan A" }),
      rec({ id: "both", title: "Both", status: "closed", resolvedAt: "2026-10-20" }),
      rec({ id: "differs", title: "Old page title" }),
    ];
    const existing = [
      rec({ id: "both", title: "Both" }),
      rec({ id: "differs", title: "Workspace title" }),
      rec({ id: "agent", title: "Agent-made" }),
    ];
    expect(planRiskRegisterMove(blob, existing, [])).toEqual(
      planRiskRegisterMove(blob, existing, [])
    );
    const once = runMove(existing, blob, []);
    expect(once.plan.conflicts.map((c) => [c.id, c.field])).toEqual([["differs", "title"]]);
    expect(once.plan.appeared).toEqual(["agent"]);
    expect(once.risks.map((r) => [r.id, r.status, r.title])).toEqual([
      ["a", "mitigating", "A"],
      ["both", "closed", "Both"],
      ["differs", "open", "Workspace title"],
      ["agent", "open", "Agent-made"],
    ]);
    expect(planRiskRegisterMove(blob, once.risks, once.moved)).toEqual({
      toAdd: [],
      toFill: [],
      conflicts: [],
      appeared: [],
      moved: ["a", "both", "differs"],
      changed: false,
    });
    // The moved-ids write was lost (another device, a closed tab): nothing to
    // add or fill, and neither notice is shown again.
    const lost = planRiskRegisterMove(blob, once.risks, []);
    expect(lost.toAdd).toEqual([]);
    expect(lost.toFill).toEqual([]);
    expect(lost.conflicts).toEqual([]);
    expect(lost.appeared).toEqual([]);
    expect(lost.changed).toBe(true);
    // Run twice, the second run changes nothing.
    const twice = runMove(once.risks, blob, once.moved);
    expect(twice.risks).toEqual(once.risks);
  });
});

describe("listedRisk", () => {
  it("is a stored row as the register lists it: its pending blob copy folded in", () => {
    const stored = rec({ title: "Agent's title" });
    const blob = [rec({ status: "closed", resolvedAt: "2026-10-20", mitigation: "Plan" })];
    expect(listedRisk(stored, blob, [])).toEqual(
      rec({
        title: "Agent's title",
        status: "closed",
        resolvedAt: "2026-10-20",
        mitigation: "Plan",
      })
    );
    expect(listedRisk(stored, blob, [])).toEqual(withPendingRisks([stored], blob, [])[0]);
    // Moved already, not in the blob, or no blob: the row itself.
    expect(listedRisk(stored, blob, ["r1"])).toBe(stored);
    expect(listedRisk(rec({ id: "other" }), blob, [])).toEqual(rec({ id: "other" }));
    expect(listedRisk(stored, null, [])).toBe(stored);
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
