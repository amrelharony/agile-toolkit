/**
 * Coverage for the 5 cross-tool "intent" compose-actions (Phase 2).
 *
 * These compose multiple workspace tools into one agent-callable action.
 * Previously the intents were registered + wired into the action registry but
 * had no behavioral tests. We exercise the client `handler` path (reads/writes
 * the workspace store); the `mcpHandler` (Supabase) path is verified to exist.
 *
 * The registry is a process-wide singleton; side-effect-import each intent
 * module once, exactly as production loads them.
 */

import { describe, it, expect, beforeEach } from "vitest";
import { registry } from "@/lib/actions/registry";
import { useWorkspaceStore } from "@/lib/stores/workspace-store";
import type { Sprint, Story, Risk, Impediment, Okr } from "@/lib/stores/workspace-types";

import "@/lib/actions/intents/plan-sprint";
import "@/lib/actions/intents/start-retro";
import "@/lib/actions/intents/create-okr-for-sprint";
import "@/lib/actions/intents/log-impediment-from-retro-card";
import "@/lib/actions/intents/summarize-workspace";

const INTENT_IDS = [
  "intent.plan_sprint",
  "intent.start_retro_for_sprint",
  "intent.create_okr_for_sprint",
  "intent.log_impediment_from_retro_card",
  "intent.summarize_workspace",
] as const;

function ctx() {
  return { userId: "test-user", source: "agent" as const, squadProfileIds: [] as string[] };
}

const sprint = (p: Partial<Sprint> & Pick<Sprint, "id" | "name">): Sprint =>
  ({
    status: "active",
    startDate: "2026-04-15",
    endDate: "2026-04-29",
    pointsPlanned: 40,
    ...p,
  }) as unknown as Sprint;

const story = (p: Partial<Story> & Pick<Story, "id" | "title">): Story =>
  ({ status: "backlog", ...p }) as unknown as Story;

const risk = (p: Partial<Risk> & Pick<Risk, "id" | "title">): Risk =>
  ({ status: "open", probability: 3, impact: 3, ...p }) as unknown as Risk;

const impediment = (p: Partial<Impediment> & Pick<Impediment, "id" | "title">): Impediment =>
  ({
    severity: "medium",
    raisedAt: "2026-04-20T00:00:00.000Z",
    source: "manual",
    ...p,
  }) as Impediment;

function reset() {
  useWorkspaceStore.setState({
    teamMembers: [],
    sprints: [],
    stories: [],
    impediments: [],
    risks: [],
    okrs: [],
    decisions: [],
    techDebt: [],
    whiteboards: [],
    whiteboardObjects: [],
  });
}

describe("intents — registration", () => {
  it("registers all 5 cross-tool intents under toolId=intent", () => {
    for (const id of INTENT_IDS) {
      const a = registry.get(id);
      expect(a, `missing intent: ${id}`).toBeDefined();
      expect(a!.toolId).toBe("intent");
    }
  });
  it("every intent exposes both a client handler and a server mcpHandler", () => {
    for (const id of INTENT_IDS) {
      expect(registry.get(id)!.handler).toBeTypeOf("function");
      expect(registry.get(id)!.mcpHandler).toBeTypeOf("function");
    }
  });
  it("summarize_workspace is a read; the write intents are category=intent", () => {
    expect(registry.get("intent.summarize_workspace")!.category).toBe("read");
    expect(registry.get("intent.plan_sprint")!.category).toBe("intent");
  });
});

describe("intent.plan_sprint", () => {
  beforeEach(reset);

  it("greedily selects highest-priority backlog stories that fit the capacity", async () => {
    useWorkspaceStore.setState({
      sprints: [sprint({ id: "sp1", name: "Sprint 1" })],
      stories: [
        story({ id: "a", title: "A", points: 5, priorityScore: 90 }),
        story({ id: "b", title: "B", points: 8, priorityScore: 80 }),
        story({ id: "c", title: "C", points: 3, priorityScore: 70 }),
        story({ id: "d", title: "D", points: 13, priorityScore: 60 }),
        story({ id: "done", title: "Done", points: 2, priorityScore: 99, status: "done" }),
      ],
    });
    const res = (await registry
      .get("intent.plan_sprint")!
      .handler({ sprintId: "sp1", capacityPoints: 10 }, ctx())) as {
      selected: { id: string }[];
      totalPointsSelected: number;
      committed: boolean;
    };
    // a(5)+c(3)=8 fit; b(8) skipped (only 5 left when reached); d(13) too big;
    // the non-backlog "done" story is never considered.
    expect(res.selected.map((s) => s.id)).toEqual(["a", "c"]);
    expect(res.totalPointsSelected).toBe(8);
    expect(res.committed).toBe(false);
    // Read-only by default — the stories aren't assigned yet.
    expect(
      useWorkspaceStore.getState().stories.find((s) => s.id === "a")!.sprintId
    ).toBeUndefined();
  });

  it("commit=true assigns the selected stories to the sprint (status todo)", async () => {
    useWorkspaceStore.setState({
      sprints: [sprint({ id: "sp1", name: "Sprint 1" })],
      stories: [story({ id: "a", title: "A", points: 5, priorityScore: 90 })],
    });
    await registry
      .get("intent.plan_sprint")!
      .handler({ sprintId: "sp1", capacityPoints: 10, commit: true }, ctx());
    const a = useWorkspaceStore.getState().stories.find((s) => s.id === "a")!;
    expect(a.sprintId).toBe("sp1");
    expect(a.status).toBe("todo");
  });

  it("throws for an unknown sprint", async () => {
    await expect(
      registry.get("intent.plan_sprint")!.handler({ sprintId: "nope", capacityPoints: 10 }, ctx())
    ).rejects.toThrow(/not found/i);
  });
});

describe("intent.start_retro_for_sprint", () => {
  beforeEach(reset);

  it("creates a board seeded with Start/Stop/Continue frames", async () => {
    useWorkspaceStore.setState({ sprints: [sprint({ id: "sp1", name: "Sprint 1" })] });
    const res = (await registry
      .get("intent.start_retro_for_sprint")!
      .handler({ sprintId: "sp1" }, ctx())) as { boardId: string; framesAdded: number };
    expect(res.framesAdded).toBe(3);
    expect(res.boardId).toMatch(/^wb_/);
    const s = useWorkspaceStore.getState();
    expect(s.whiteboards!.some((b) => b.id === res.boardId)).toBe(true);
    const frames = s.whiteboardObjects!.filter((o) => o.boardId === res.boardId);
    expect(frames.map((f) => (f as { label?: string }).label)).toEqual([
      "Start",
      "Stop",
      "Continue",
    ]);
  });
});

describe("intent.create_okr_for_sprint", () => {
  beforeEach(reset);

  it("derives the quarter from the sprint startDate and creates KRs from 0 to 1", async () => {
    useWorkspaceStore.setState({
      sprints: [sprint({ id: "sp1", name: "Sprint 1", startDate: "2026-04-15" })],
    });
    const res = (await registry
      .get("intent.create_okr_for_sprint")!
      .handler(
        { sprintId: "sp1", objective: "Ship v2", keyResults: ["Adopt", "Retain"] },
        ctx()
      )) as { okrId: string; quarter: string; keyResultIds: string[] };
    // The OKR page's quarter form ("2026 Q2"), which its picker and filter read.
    expect(res.quarter).toBe("2026 Q2");
    expect(res.keyResultIds).toHaveLength(2);
    const okr = useWorkspaceStore.getState().okrs.find((o: Okr) => o.id === res.okrId)!;
    expect(okr.objective).toBe("Ship v2");
    expect(okr.quarter).toBe("2026 Q2");
    // Counted from a baseline of 0, as every new key result is since Phase 8.
    expect(
      okr.keyResults.every(
        (k) => k.target === 1 && k.current === 0 && k.baseline === 0 && k.direction === "increase"
      )
    ).toBe(true);
  });

  it("puts an early-January sprint in Q1 of its own year", async () => {
    useWorkspaceStore.setState({
      sprints: [sprint({ id: "sp1", name: "Sprint 1", startDate: "2027-01-01" })],
    });
    const res = (await registry
      .get("intent.create_okr_for_sprint")!
      .handler({ sprintId: "sp1", objective: "New year", keyResults: ["One"] }, ctx())) as {
      quarter: string;
    };
    expect(res.quarter).toBe("2027 Q1");
  });
});

describe("intent.log_impediment_from_retro_card", () => {
  beforeEach(reset);

  it("creates an impediment defaulting severity=medium, source=retro", async () => {
    const res = (await registry
      .get("intent.log_impediment_from_retro_card")!
      .handler({ text: "Flaky CI blocks merges" }, ctx())) as { impedimentId: string };
    const imp = useWorkspaceStore.getState().impediments.find((i) => i.id === res.impedimentId)!;
    expect(imp.title).toBe("Flaky CI blocks merges");
    expect(imp.severity).toBe("medium");
    expect(imp.source).toBe("retro");
  });

  it("honors an explicit severity", async () => {
    const res = (await registry
      .get("intent.log_impediment_from_retro_card")!
      .handler({ text: "Prod outage", severity: "critical" }, ctx())) as { impedimentId: string };
    const imp = useWorkspaceStore.getState().impediments.find((i) => i.id === res.impedimentId)!;
    expect(imp.severity).toBe("critical");
  });
});

describe("intent.summarize_workspace", () => {
  beforeEach(reset);

  it("rolls up counts, the active sprint, and the top risks/impediments", async () => {
    useWorkspaceStore.setState({
      sprints: [
        sprint({ id: "sp1", name: "Past", status: "completed" }),
        sprint({ id: "sp2", name: "Now", status: "active" }),
      ],
      stories: [story({ id: "s1", title: "S1" }), story({ id: "s2", title: "S2" })],
      risks: [
        risk({ id: "r1", title: "Low", probability: 1, impact: 1 }),
        risk({ id: "r2", title: "High", probability: 5, impact: 5 }),
        risk({ id: "r3", title: "Closed", probability: 5, impact: 5, status: "closed" }),
      ],
      impediments: [
        impediment({ id: "i1", title: "Med" }),
        impediment({ id: "i2", title: "Crit", severity: "critical" }),
        impediment({ id: "i3", title: "Resolved", resolvedAt: "2026-04-21T00:00:00.000Z" }),
      ],
    });
    const res = (await registry.get("intent.summarize_workspace")!.handler({}, ctx())) as {
      counts: Record<string, number>;
      activeSprint: { id: string } | null;
      topOpenRisks: { id: string }[];
      topActiveImpediments: { id: string }[];
    };
    expect(res.counts.sprints).toBe(2);
    expect(res.counts.stories).toBe(2);
    expect(res.activeSprint?.id).toBe("sp2");
    // r3 is closed → excluded; r2 (score 25) ranks above r1 (score 1).
    expect(res.topOpenRisks.map((r) => r.id)).toEqual(["r2", "r1"]);
    // i3 is resolved → excluded; critical i2 ranks above medium i1.
    expect(res.topActiveImpediments.map((i) => i.id)).toEqual(["i2", "i1"]);
  });
});
