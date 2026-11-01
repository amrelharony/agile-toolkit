/**
 * The Decision Log's old blob moving into workspace.decisions
 * (lib/decisions/legacy-log): a gap fill by id that adds what the
 * workspace lacks, fills only empty fields on a record both hold, keeps
 * the later lifecycle status, remembers what moved, and is idempotent. The
 * last block runs the page's whole move (blob, then old DACI / RAPID rows,
 * then numbers) on the pure parts, as the Decision Log's hook does.
 */

import { describe, expect, it } from "vitest";
import {
  DECISION_LOG_KEY,
  DECISION_LOG_MOVED_KEY,
  isPendingDecisionLogRow,
  planDecisionLogMove,
  readDecisionLogRows,
  withPendingDecisionLog,
} from "@/lib/decisions/legacy-log";
import { fromDaci, fromRapid, numberUnnumbered } from "@/lib/decisions/model";
import type { DACIDecision, Decision, RAPIDDecision } from "@/lib/stores/workspace-types";

const rec = (over: Partial<Decision> = {}): Decision => ({
  id: "d1",
  title: "Use Postgres",
  decision: "",
  status: "proposed",
  date: "2026-10-01",
  ...over,
});

describe("the keys", () => {
  it("are the old page's blob and its moved-ids record", () => {
    expect(DECISION_LOG_KEY).toBe("agile-toolkit:decision-log");
    expect(DECISION_LOG_MOVED_KEY).toBe("agile-toolkit:decision-log:moved");
  });
});

describe("readDecisionLogRows", () => {
  it("reads usable rows once each; anything that isn't a list is none", () => {
    expect(readDecisionLogRows(null)).toEqual([]);
    expect(readDecisionLogRows({ id: "a" })).toEqual([]);
    expect(
      readDecisionLogRows([
        { id: "a", title: "A" },
        { title: "no id" },
        7,
        { id: "a", title: "dup" },
      ])
    ).toEqual([{ id: "a", title: "A", decision: "", status: "proposed", date: "" }]);
  });
});

describe("planDecisionLogMove", () => {
  it("adds blob rows the workspace lacks, in the blob's order; blank rows stay behind", () => {
    const blob = [
      { id: "b", title: "B", status: "accepted", decision: "Go", date: "2026-09-02" },
      { id: "blank", title: "", decision: "", status: "proposed", date: "2026-09-03" },
      { id: "a", title: "A", alternatives: ["x", ""], date: "2026-09-01T10:00:00Z" },
    ];
    const plan = planDecisionLogMove(blob, [], []);
    expect(plan.toAdd).toEqual([
      rec({ id: "b", title: "B", status: "accepted", decision: "Go", date: "2026-09-02" }),
      rec({ id: "a", title: "A", alternatives: ["x"], date: "2026-09-01" }),
    ]);
    expect(plan.toFill).toEqual([]);
    expect(plan.moved).toEqual(["b", "blank", "a"]);
    expect(plan.changed).toBe(true);
  });

  it("fills only what the workspace row lacks, never a field it holds", () => {
    const ws = rec({
      title: "Use Postgres (agent's title)",
      context: "  ",
      decision: "",
      consequences: "From the agent",
      alternatives: [],
    });
    const blob = [
      rec({
        title: "Use Postgres",
        context: "Event log",
        decision: "We will use Postgres.",
        consequences: "From the page",
        alternatives: ["Mongo"],
        sourceRef: { tool: "six-hats", id: "s1" },
      }),
    ];
    const { toFill, toAdd, conflicts } = planDecisionLogMove(blob, [ws], []);
    expect(toAdd).toEqual([]);
    expect(toFill).toEqual([
      rec({
        title: "Use Postgres (agent's title)",
        context: "Event log",
        decision: "We will use Postgres.",
        consequences: "From the agent",
        alternatives: ["Mongo"],
        sourceRef: { tool: "six-hats", id: "s1" },
      }),
    ]);
    // What both hold differently is kept as the workspace has it, and reported.
    expect(conflicts).toEqual([
      {
        id: "d1",
        field: "title",
        blob: "Use Postgres",
        workspace: "Use Postgres (agent's title)",
      },
      { id: "d1", field: "consequences", blob: "From the page", workspace: "From the agent" },
    ]);
  });

  it("reports the text a Pushed row's later edits on the old page hold, never a gap or a match", () => {
    // Push copied the row; the team kept editing it on the old page.
    const pushed = rec({
      title: "Use Postgres ",
      decision: "We will try Postgres.",
      alternatives: ["Mongo", " "],
    });
    const blob = [
      rec({
        title: "Use Postgres",
        decision: "We will use Postgres for the event log.",
        context: "Only in the blob",
        alternatives: ["Mongo", "SQLite"],
      }),
    ];
    expect(planDecisionLogMove(blob, [pushed], []).conflicts).toEqual([
      {
        id: "d1",
        field: "decision",
        blob: "We will use Postgres for the event log.",
        workspace: "We will try Postgres.",
      },
      { id: "d1", field: "alternatives", blob: ["Mongo", "SQLite"], workspace: ["Mongo"] },
    ]);
    // Moved already, or saved since the merge (the workspace's is the newer): none.
    expect(planDecisionLogMove(blob, [pushed], ["d1"]).conflicts).toEqual([]);
    expect(planDecisionLogMove(blob, [{ ...pushed, number: 2 }], []).conflicts).toEqual([]);
  });

  it("keeps the later lifecycle status of the two, the blob's on a tie", () => {
    const status = (wsStatus: Decision["status"], blobStatus: Decision["status"]) => {
      const ws = rec({ status: wsStatus, decision: "Go" });
      const plan = planDecisionLogMove([rec({ status: blobStatus, decision: "Go" })], [ws], []);
      return plan.toFill[0]?.status ?? ws.status;
    };
    expect(status("proposed", "accepted")).toBe("accepted");
    expect(status("accepted", "proposed")).toBe("accepted");
    expect(status("superseded", "accepted")).toBe("superseded");
    expect(status("deprecated", "superseded")).toBe("superseded");
    expect(status("superseded", "deprecated")).toBe("deprecated");
    // The same status and nothing to fill: no write.
    expect(
      planDecisionLogMove([rec({ decision: "Go" })], [rec({ decision: "Go" })], []).toFill
    ).toEqual([]);
  });

  it("a row saved since the merge keeps its own status: a reopen or a replacement isn't undone", () => {
    const keeps = (row: Decision, blobStatus: Decision["status"]) =>
      withPendingDecisionLog([row], [rec({ status: blobStatus, decision: "Go" })], [])[0];
    // Reopened by an agent before the move ran; the blob still says accepted.
    const reopened = rec({ decision: "Go", reopenedAt: "2026-10-20" });
    expect(keeps(reopened, "accepted")).toEqual(reopened);
    expect(planDecisionLogMove([rec({ status: "accepted" })], [reopened], []).toFill).toEqual([]);
    // Replaced, naming its replacement; the blob says deprecated (a tie).
    const replaced = rec({ status: "superseded", decision: "Go", supersededBy: "d9" });
    expect(keeps(replaced, "deprecated").status).toBe("superseded");
    // Numbered by the move (its moved-ids write lost), then moved back to proposed.
    const numbered = rec({ decision: "Go", number: 4 });
    expect(keeps(numbered, "accepted").status).toBe("proposed");
    // Gaps are still filled from the blob.
    expect(
      withPendingDecisionLog([rec({ reopenedAt: "2026-10-20" })], [rec({ context: "Why" })], [])
    ).toEqual([rec({ reopenedAt: "2026-10-20", context: "Why" })]);
  });

  it("leaves a row already moved alone, so one deleted since stays deleted", () => {
    const blob = [rec({ id: "gone" }), rec({ id: "kept", decision: "Old outcome" })];
    const plan = planDecisionLogMove(blob, [rec({ id: "kept" })], ["gone", "kept"]);
    expect(plan).toEqual({
      toAdd: [],
      toFill: [],
      conflicts: [],
      moved: ["gone", "kept"],
      changed: false,
    });
  });

  it("an empty or unreadable blob plans nothing, and keeps only string ids", () => {
    expect(planDecisionLogMove(null, [rec()], ["a", 3 as unknown as string])).toEqual({
      toAdd: [],
      toFill: [],
      conflicts: [],
      moved: ["a"],
      changed: false,
    });
    expect(planDecisionLogMove([], [], [])).toEqual({
      toAdd: [],
      toFill: [],
      conflicts: [],
      moved: [],
      changed: false,
    });
  });

  it("a repeated id in the moved-ids record doesn't hide a new one", () => {
    const plan = planDecisionLogMove([rec({ id: "a" }), rec({ id: "b" })], [], ["a", "a"]);
    expect(plan.toAdd.map((d) => d.id)).toEqual(["b"]);
    expect(plan.moved).toEqual(["a", "b"]);
    expect(plan.changed).toBe(true);
    // Nothing new: unchanged, and each id once.
    expect(planDecisionLogMove([rec({ id: "a" })], [], ["a", "a"])).toMatchObject({
      moved: ["a"],
      changed: false,
    });
  });

  it("is idempotent: the same plan twice, nothing after saving it, nothing when the moved write was lost", () => {
    const blob = [
      { id: "a", title: "A", status: "accepted", decision: "Go", date: "2026-09-01" },
      { id: "both", title: "Both", status: "accepted", decision: "Yes", date: "2026-09-02" },
    ];
    const existing = [rec({ id: "both", title: "Both", date: "2026-09-02" })];
    const first = planDecisionLogMove(blob, existing, []);
    expect(planDecisionLogMove(blob, existing, [])).toEqual(first);

    const fills = new Map(first.toFill.map((d) => [d.id, d]));
    const saved = [...existing.map((d) => fills.get(d.id) ?? d), ...first.toAdd];
    expect(saved.map((d) => [d.id, d.status, d.decision])).toEqual([
      ["both", "accepted", "Yes"],
      ["a", "accepted", "Go"],
    ]);

    expect(planDecisionLogMove(blob, saved, first.moved)).toEqual({
      toAdd: [],
      toFill: [],
      conflicts: [],
      moved: ["a", "both"],
      changed: false,
    });
    // The moved-ids write was lost (another device, a closed tab): still nothing to add or fill.
    const lost = planDecisionLogMove(blob, saved, []);
    expect(lost.toAdd).toEqual([]);
    expect(lost.toFill).toEqual([]);
    expect(lost.changed).toBe(true);
  });

  it("a newer workspace edit wins over the blob's older copy", () => {
    // The agent decided after the hand-off; the blob still holds the proposal.
    const ws = rec({
      status: "accepted",
      decision: "We will.",
      decidedAt: "2026-10-05",
      number: 3,
    });
    const blob = [rec({ status: "proposed", decision: "", title: "Use Postgres" })];
    expect(planDecisionLogMove(blob, [ws], []).toFill).toEqual([]);
  });
});

describe("isPendingDecisionLogRow", () => {
  it("is a blob row the move hasn't handled yet", () => {
    const blob = [rec({ id: "a" }), rec({ id: "b" })];
    expect(isPendingDecisionLogRow("a", blob, [])).toBe(true);
    expect(isPendingDecisionLogRow("b", blob, ["b"])).toBe(false);
    expect(isPendingDecisionLogRow("c", blob, [])).toBe(false);
    expect(isPendingDecisionLogRow("a", null, [])).toBe(false);
  });
});

describe("withPendingDecisionLog", () => {
  it("reads the records as they will be once moved", () => {
    const existing = [rec({ id: "both" }), rec({ id: "ws-only" })];
    const blob = [
      rec({ id: "both", status: "accepted", decision: "Go" }),
      rec({ id: "blob-only", title: "From the old page" }),
    ];
    expect(withPendingDecisionLog(existing, blob, []).map((d) => [d.id, d.status])).toEqual([
      ["both", "accepted"],
      ["ws-only", "proposed"],
      ["blob-only", "proposed"],
    ]);
    expect(withPendingDecisionLog(existing, blob, ["both", "blob-only"])).toEqual(existing);
    expect(withPendingDecisionLog(existing, null, [])).toEqual(existing);
  });
});

describe("the page's whole move", () => {
  interface Ws {
    decisions: Decision[];
    daci: DACIDecision[];
    rapid: RAPIDDecision[];
  }

  /** The Decision Log hook's steps on the pure parts: blob, old DACI / RAPID rows, numbers. */
  function runMove(
    ws: Ws,
    raw: unknown,
    moved: string[]
  ): { decisions: Decision[]; moved: string[] } {
    const plan = planDecisionLogMove(raw, ws.decisions, moved);
    const fills = new Map(plan.toFill.map((d) => [d.id, d]));
    const decisions = [...ws.decisions.map((d) => fills.get(d.id) ?? d), ...plan.toAdd];
    const have = new Set(decisions.map((d) => d.id));
    for (const d of ws.daci) if (!have.has(d.id)) decisions.push(fromDaci(d));
    for (const r of ws.rapid) if (!have.has(r.id)) decisions.push(fromRapid(r));
    const numbered = new Map(numberUnnumbered(decisions).map((d) => [d.id, d]));
    return { decisions: decisions.map((d) => numbered.get(d.id) ?? d), moved: plan.moved };
  }

  const ws: Ws = {
    decisions: [
      // Sent after the upgrade, so already numbered.
      rec({ id: "handoff", title: "From six hats", date: "2026-10-20", number: 1 }),
      // Made by an agent through the generic CRUD: no number.
      rec({ id: "agent", title: "From an agent", date: "2026-09-15" }),
      // A DACI row already edited into a record: shadows its old row.
      rec({ id: "daci-edited", title: "Vendor (edited)", template: "daci", date: "2026-09-10" }),
    ],
    daci: [
      { id: "daci-edited", title: "Vendor", status: "open", date: "2026-09-10T09:00:00Z" },
      { id: "daci-old", title: "Hiring", status: "implemented", date: "2026-08-01T09:00:00Z" },
    ],
    rapid: [{ id: "rapid-old", title: "Reorg", status: "decided", date: "2026-09-01T09:00:00Z" }],
  };
  const blob = [
    {
      id: "adr-old",
      title: "ADR: Postgres",
      status: "accepted",
      decision: "Go",
      date: "2026-07-01",
    },
    { id: "blank", title: "", decision: "", status: "proposed", date: "2026-07-02" },
  ];

  it("numbers every source after the highest number, oldest first, and keeps the old rows' meaning", () => {
    const { decisions, moved } = runMove(ws, blob, []);
    expect(decisions.map((d) => [d.id, d.number, d.template ?? "adr", d.status])).toEqual([
      ["handoff", 1, "adr", "proposed"],
      ["agent", 6, "adr", "proposed"],
      ["daci-edited", 5, "daci", "proposed"],
      ["adr-old", 2, "adr", "accepted"],
      ["daci-old", 3, "daci", "accepted"],
      ["rapid-old", 4, "rapid", "accepted"],
    ]);
    expect(decisions.find((d) => d.id === "daci-edited")?.title).toBe("Vendor (edited)");
    expect(decisions.find((d) => d.id === "daci-old")?.implementedAt).toBe("2026-08-01");
    expect(moved).toEqual(["adr-old", "blank"]);
  });

  it("run twice, the second run changes nothing", () => {
    const once = runMove(ws, blob, []);
    const twice = runMove({ ...ws, decisions: once.decisions }, blob, once.moved);
    expect(twice).toEqual(once);
  });
});
