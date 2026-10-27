/**
 * tool.risk_register.* after the Risk Register moved into the workspace
 * (Phase 8), on both transports: reads include the old blob's pending rows
 * (localStorage in the tab, user_state rows over MCP), every write stamps
 * updatedAt and saves a pending row merged, a delete of a pending row is
 * refused ('pending_move'), closing takes a backdated day, the residual
 * rating is a pair, the owner takes the roster's spelling, and
 * raise_impediment creates the impediment with the risk's level and links
 * it. The age in sprints reads the cadence's sprint length.
 */

import { beforeEach, describe, expect, it, vi } from "vitest";
import type { Impediment, Risk, WhiteboardObject } from "@/lib/stores/workspace-types";
import { CEREMONY_CADENCE_ID } from "@/lib/stores/workspace-types";

const rows = vi.hoisted(() => new Map<string, unknown>());
const blobs = vi.hoisted(() => new Map<string, unknown>());
vi.mock("@/lib/actions/server-store", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/lib/actions/server-store")>();
  return {
    ...actual,
    serverGetEntity: vi.fn(
      async (_u: string, kind: string, id: string) => rows.get(`${kind}/${id}`) ?? null
    ),
    serverListEntities: vi.fn(async (_u: string, kind: string) =>
      Array.from(rows.entries())
        .filter(([k]) => k.startsWith(`${kind}/`))
        .map(([, v]) => v)
    ),
    serverUpsertEntity: vi.fn(async (_u: string, kind: string, entity: { id: string }) => {
      rows.set(`${kind}/${entity.id}`, entity);
    }),
    serverGetUserStateBlob: vi.fn(async (_u: string, key: string) => blobs.get(key) ?? null),
    serverDeleteEntity: vi.fn(async (_u: string, kind: string, id: string) => {
      rows.delete(`${kind}/${id}`);
    }),
  };
});

import { registry } from "@/lib/actions/registry";
import { useWorkspaceStore } from "@/lib/stores/workspace-store";
import {
  RISK_REGISTER_KEY,
  RISK_REGISTER_MOVED_KEY,
  planRiskRegisterMove,
} from "@/lib/risks/legacy-register";
import { addDays } from "@/lib/impediments/model";
import { todayLocalISO } from "@/lib/utils/formatters";
import "@/lib/actions/tools/risk-register";
import "@/lib/actions/workspace";

const TODAY = todayLocalISO();
const ws = () => useWorkspaceStore.getState();
const tab = { userId: "u", source: "agent" as const, squadProfileIds: [] as string[] };
const mcpCtx = { userId: "u", source: "mcp" as const, squadProfileIds: [] as string[] };

/** Run an action in the tab (browser handler) or over MCP, its params parsed as the registry does. */
function run<T>(
  transport: "tab" | "mcp",
  id: string,
  params: Record<string, unknown> = {},
  extra: Record<string, unknown> = {}
): Promise<T> {
  const action = registry.get(id)!;
  const parsed = action.paramsSchema.parse(params);
  return (
    transport === "tab"
      ? action.handler(parsed, { ...tab, ...extra })
      : action.mcpHandler!(parsed, { ...mcpCtx, ...extra })
  ) as Promise<T>;
}

const risk = (over: Partial<Risk> = {}): Risk => ({
  id: "r1",
  title: "Payment sandbox outage",
  probability: 4,
  impact: 4,
  status: "open",
  raisedAt: "2026-09-01",
  ...over,
});

/** Seed one transport's stores: risks, the old blob and moved ids, the roster, impediments, a cadence. */
function seed(
  transport: "tab" | "mcp",
  s: {
    risks?: Risk[];
    blob?: unknown[];
    moved?: string[];
    roster?: string[];
    impediments?: Impediment[];
    sprintLengthDays?: number;
  }
) {
  const cadence = s.sprintLengthDays
    ? [{ id: CEREMONY_CADENCE_ID, sprintLengthDays: s.sprintLengthDays }]
    : [];
  const members = (s.roster ?? []).map((name, i) => ({ id: `m${i}`, name }));
  if (transport === "tab") {
    useWorkspaceStore.setState({
      risks: s.risks ?? [],
      teamMembers: members,
      impediments: s.impediments ?? [],
      ceremonyCadences: cadence as never,
    });
    if (s.blob) localStorage.setItem(RISK_REGISTER_KEY, JSON.stringify(s.blob));
    if (s.moved) localStorage.setItem(RISK_REGISTER_MOVED_KEY, JSON.stringify(s.moved));
    return;
  }
  for (const r of s.risks ?? []) rows.set(`workspace:risk/${r.id}`, r);
  for (const m of members) rows.set(`workspace:teamMember/${m.id}`, m);
  for (const i of s.impediments ?? []) rows.set(`workspace:impediment/${i.id}`, i);
  for (const c of cadence) rows.set(`workspace:ceremonyCadence/${c.id}`, c);
  if (s.blob) blobs.set(RISK_REGISTER_KEY, s.blob);
  if (s.moved) blobs.set(RISK_REGISTER_MOVED_KEY, s.moved);
}

/** One transport's stored risks and impediments. */
function stored(transport: "tab" | "mcp") {
  if (transport === "tab") return { risks: ws().risks, impediments: ws().impediments };
  const of = <T>(kind: string) =>
    Array.from(rows.entries())
      .filter(([k]) => k.startsWith(`workspace:${kind}/`))
      .map(([, v]) => v as T);
  return { risks: of<Risk>("risk"), impediments: of<Impediment>("impediment") };
}

beforeEach(() => {
  rows.clear();
  blobs.clear();
  localStorage.clear();
  useWorkspaceStore.setState({
    risks: [],
    teamMembers: [],
    impediments: [],
    ceremonyCadences: [],
    whiteboardObjects: [],
  });
});

describe("tool.risk_register — registration", () => {
  it("registers the Phase 8 verbs on both transports; delete asks first", () => {
    for (const name of [
      "list_state",
      "set_status",
      "set_mitigation",
      "set_owner",
      "delete",
      "raise_impediment",
    ]) {
      const a = registry.get(`tool.risk_register.${name}`);
      expect(a, name).toBeDefined();
      expect(a!.mcpHandler, name).toBeTypeOf("function");
    }
    expect(registry.get("tool.risk_register.delete")!.requiresConfirmation).toBe(true);
    expect(registry.get("tool.risk_register.set_owner")!.category).toBe("write");
    expect(registry.get("tool.risk_register.raise_impediment")!.requiresConfirmation).toBe(false);
  });

  it("compute_risk_score says whether the level is high", async () => {
    await expect(
      run("tab", "tool.risk_register.compute_risk_score", { probability: 2, impact: 5 })
    ).resolves.toMatchObject({ score: 10, level: "high", high: true });
  });
});

describe.each(["tab", "mcp"] as const)("tool.risk_register over %s", (transport) => {
  it("list_state lists the old blob's pending rows with the new keys, in the register's order", async () => {
    seed(transport, {
      risks: [
        risk({ id: "a", owner: "Ana", mitigationDueAt: addDays(TODAY, -3) }),
        risk({ id: "b", title: "Closed", status: "closed", resolvedAt: "2026-10-01" }),
        risk({ id: "example-risk-1", probability: 5, impact: 5 }),
      ],
      blob: [
        {
          id: "old",
          title: "From the old page",
          probability: 2,
          impact: 5,
          raisedAt: "2026-09-15",
        },
        { id: "moved", title: "Already moved" },
      ],
      moved: ["moved"],
      sprintLengthDays: 7,
    });
    const s = await run<{
      sprintLengthDays: number;
      total: number;
      items: {
        id: string;
        pending: boolean;
        example: boolean;
        overdue: boolean;
        daysOverdue: number;
        level: string;
        ageSprints: number | null;
      }[];
      active: number;
      overdue: number;
      unowned: number;
      high: number;
      exposure: number;
      pending: number;
      examples: number;
      verdict: string;
    }>(transport, "tool.risk_register.list_state", { today: TODAY });
    expect(s.sprintLengthDays).toBe(7);
    expect(s.items.map((i) => [i.id, i.pending, i.example])).toEqual([
      ["example-risk-1", false, true],
      ["a", false, false],
      ["old", true, false],
      ["b", false, false],
    ]);
    expect(s.items.find((i) => i.id === "a")).toMatchObject({
      overdue: true,
      daysOverdue: 3,
      level: "critical",
    });
    expect(s.items.find((i) => i.id === "old")?.ageSprints).toBeGreaterThan(0);
    expect(s.total).toBe(4);
    // The summary keys leave the example out.
    expect([s.active, s.overdue, s.unowned, s.high, s.exposure]).toEqual([2, 1, 1, 2, 26]);
    expect([s.pending, s.examples]).toEqual([1, 1]);
    expect(s.verdict).toMatch(/^1 mitigation is overdue/);
  });

  it("a write on a pending row saves the merged row, stamped", async () => {
    seed(transport, {
      risks: [risk({ id: "both", title: "Pushed" })],
      blob: [risk({ id: "both", title: "Pushed", mitigation: "From the old page" })],
    });
    const out = await run(transport, "tool.risk_register.set_owner", { id: "both", owner: "Ana" });
    expect(out).toEqual({ updated: true, owner: "Ana", onTeam: false });
    expect(stored(transport).risks).toEqual([
      {
        ...risk({ id: "both", title: "Pushed" }),
        mitigation: "From the old page",
        owner: "Ana",
        updatedAt: expect.any(String),
      },
    ]);
  });

  it("set_status closes on a backdated day, refuses a future or pre-raised one, and re-dates a close", async () => {
    seed(transport, { risks: [risk()] });
    const latest = transport === "mcp" ? addDays(TODAY, 1) : TODAY;
    await expect(
      run(transport, "tool.risk_register.set_status", {
        id: "r1",
        status: "closed",
        resolvedAt: addDays(latest, 1),
      })
    ).resolves.toEqual({ updated: false, reason: "future_day" });
    await expect(
      run(transport, "tool.risk_register.set_status", {
        id: "r1",
        status: "closed",
        resolvedAt: "2026-08-01",
      })
    ).resolves.toEqual({ updated: false, reason: "before_raised" });
    await expect(
      run(transport, "tool.risk_register.set_status", {
        id: "r1",
        status: "mitigating",
        resolvedAt: "2026-10-01",
      })
    ).resolves.toEqual({ updated: false, reason: "resolved_at_needs_closed" });
    await expect(
      run(transport, "tool.risk_register.set_status", {
        id: "r1",
        status: "closed",
        resolvedAt: "2026-10-01",
      })
    ).resolves.toEqual({ updated: true, status: "closed", resolvedAt: "2026-10-01" });
    await expect(
      run(transport, "tool.risk_register.set_status", {
        id: "r1",
        status: "closed",
        resolvedAt: "2026-10-03",
      })
    ).resolves.toEqual({ updated: true, status: "closed", resolvedAt: "2026-10-03" });
    await expect(
      run(transport, "tool.risk_register.set_status", { id: "r1", status: "closed" })
    ).resolves.toEqual({ updated: false, reason: "already-in-status" });
    // Reopening keeps the date; it counts only while closed.
    await run(transport, "tool.risk_register.set_status", { id: "r1", status: "open" });
    const [r] = stored(transport).risks;
    expect(r).toMatchObject({
      status: "open",
      resolvedAt: "2026-10-03",
      updatedAt: expect.any(String),
    });
  });

  it("set_mitigation sets the residual pair, warns when it is above the current score, and clears it", async () => {
    seed(transport, { risks: [risk({ probability: 2, impact: 2 })] });
    await expect(
      run(transport, "tool.risk_register.set_mitigation", {
        id: "r1",
        residualProbability: 3,
        residualImpact: 2,
      })
    ).resolves.toEqual({
      updated: true,
      transitioned: false,
      score: 4,
      residualScore: 6,
      warning: "residual_above_current",
    });
    expect(stored(transport).risks[0]).toMatchObject({
      residualProbability: 3,
      residualImpact: 2,
      status: "open",
    });
    await expect(
      run(transport, "tool.risk_register.set_mitigation", {
        id: "r1",
        mitigation: "Stub it",
        residualProbability: null,
        residualImpact: null,
      })
    ).resolves.toEqual({ updated: true, transitioned: true, score: 4, residualScore: null });
    expect(stored(transport).risks[0]).toMatchObject({
      status: "mitigating",
      mitigation: "Stub it",
    });
    expect(stored(transport).risks[0].residualImpact).toBeUndefined();
    await expect(
      run(transport, "tool.risk_register.set_mitigation", {
        id: "r1",
        mitigationDueAt: "2026-08-01",
      })
    ).resolves.toEqual({ updated: false, transitioned: false, reason: "due_before_raised" });
  });

  it("set_owner takes the roster's spelling and an empty owner clears it", async () => {
    seed(transport, { risks: [risk()], roster: ["Ana Lima"] });
    await expect(
      run(transport, "tool.risk_register.set_owner", { id: "r1", owner: " ana lima " })
    ).resolves.toEqual({ updated: true, owner: "Ana Lima", onTeam: true });
    expect(stored(transport).risks[0].owner).toBe("Ana Lima");
    await expect(
      run(transport, "tool.risk_register.set_owner", { id: "r1", owner: "" })
    ).resolves.toEqual({
      updated: true,
      owner: null,
      onTeam: false,
    });
    expect(stored(transport).risks[0].owner).toBeUndefined();
    await expect(
      run(transport, "tool.risk_register.set_owner", { id: "x", owner: "A" })
    ).resolves.toEqual({
      updated: false,
      reason: "not_found",
    });
  });

  it("delete refuses a pending row and removes a workspace one", async () => {
    seed(transport, { risks: [risk({ id: "ws" })], blob: [risk({ id: "old" })] });
    await expect(run(transport, "tool.risk_register.delete", { id: "old" })).resolves.toMatchObject(
      {
        deleted: false,
        reason: "pending_move",
      }
    );
    await expect(run(transport, "tool.risk_register.delete", { id: "nope" })).resolves.toEqual({
      deleted: false,
      reason: "not_found",
    });
    await expect(
      run(transport, "tool.risk_register.delete", { id: "ws" }, { confirm: async () => false })
    ).resolves.toEqual({ deleted: false, confirmed: false });
    await expect(run(transport, "tool.risk_register.delete", { id: "ws" })).resolves.toEqual({
      deleted: true,
      id: "ws",
      title: "Payment sandbox outage",
    });
    expect(stored(transport).risks).toEqual([]);
  });

  it("raise_impediment creates the impediment with the risk's level and links it; the status stays", async () => {
    seed(transport, {
      risks: [
        risk({ owner: "Ana", description: "Blocks wallet tests", mitigation: "Stub the provider" }),
        risk({ id: "closed", status: "closed" }),
        risk({ id: "example-risk-2" }),
      ],
    });
    const out = await run<{ raised: boolean; impedimentId: string; severity: string }>(
      transport,
      "tool.risk_register.raise_impediment",
      { id: "r1" }
    );
    expect(out).toEqual({
      raised: true,
      impedimentId: expect.stringMatching(/^imp_/),
      severity: "critical",
    });
    const { risks, impediments } = stored(transport);
    expect(impediments).toEqual([
      expect.objectContaining({
        id: out.impedimentId,
        title: "Payment sandbox outage",
        description: "Blocks wallet tests\n\nMitigation plan: Stub the provider",
        owner: "Ana",
        severity: "critical",
        source: "manual",
        sourceRef: { tool: "risk-register", id: "r1" },
      }),
    ]);
    const r1 = risks.find((r) => r.id === "r1")!;
    expect(r1.status).toBe("open");
    expect(r1.sentTo).toEqual([
      { route: "impediment", targetId: out.impedimentId, at: expect.any(String) },
    ]);

    await expect(
      run(transport, "tool.risk_register.raise_impediment", { id: "r1" })
    ).resolves.toEqual({
      raised: false,
      reason: "already_raised",
      impedimentId: out.impedimentId,
    });
    for (const [id, reason] of [
      ["closed", "not_active"],
      ["example-risk-2", "example"],
      ["nope", "not_found"],
    ]) {
      await expect(run(transport, "tool.risk_register.raise_impediment", { id })).resolves.toEqual({
        raised: false,
        reason,
      });
    }

    // Resolved: list_state shows it, for the risk to be closed.
    const imp = impediments[0];
    if (transport === "tab") ws().upsertImpediment({ ...imp, resolvedAt: TODAY });
    else rows.set(`workspace:impediment/${imp.id}`, { ...imp, resolvedAt: TODAY });
    const s = await run<{ items: { id: string; impediment: unknown }[] }>(
      transport,
      "tool.risk_register.list_state"
    );
    expect(s.items.find((i) => i.id === "r1")?.impediment).toEqual({ id: imp.id, resolved: true });
  });
});

describe("tool.risk_register in the tab", () => {
  it("delete unpins the canvas cards, as the page's delete does", async () => {
    useWorkspaceStore.setState({
      risks: [risk()],
      whiteboardObjects: [
        {
          id: "c1",
          version: 1,
          sourceRef: { tool: "risk", entityId: "r1" },
        } as unknown as WhiteboardObject,
      ],
    });
    await run("tab", "tool.risk_register.delete", { id: "r1" });
    expect(ws().whiteboardObjects?.[0].sourceRef).toBeUndefined();
  });

  it("set_mitigation refuses one residual rating alone at the schema", () => {
    const schema = registry.get("tool.risk_register.set_mitigation")!.paramsSchema;
    expect(() => schema.parse({ id: "r1", residualProbability: 2 })).toThrow();
    expect(() =>
      schema.parse({ id: "r1", residualProbability: 2, residualImpact: null })
    ).toThrow();
    expect(() => schema.parse({ id: "r1" })).toThrow();
    expect(() => schema.parse({ id: "r1", residualProbability: 6, residualImpact: 2 })).toThrow();
  });
});

describe.each(["tab", "mcp"] as const)(
  "the workspace.risk CRUD on a row still in the old blob, %s",
  (transport) => {
    const crud = <T>(verb: string, params: Record<string, unknown>) =>
      run<T>(transport, `workspace.risk.${verb}`, params);
    /** Record ids as moved, as the page's move would, on this transport. */
    const markMoved = (ids: string[]) => {
      if (transport === "tab") localStorage.setItem(RISK_REGISTER_MOVED_KEY, JSON.stringify(ids));
      else blobs.set(RISK_REGISTER_MOVED_KEY, ids);
    };

    it("an update merges into the risk as listed, so the move keeps the blob's later status", async () => {
      // Pushed, then closed on the old page; the workspace's copy is still open.
      const blob = [
        risk({ status: "closed", resolvedAt: "2026-10-20", mitigation: "Cache the responses" }),
      ];
      seed(transport, { risks: [risk()], blob });
      expect(await crud("update", { id: "r1", patch: { owner: "Ana" } })).toEqual({
        updated: true,
      });
      const [saved] = stored(transport).risks;
      expect(saved).toMatchObject({
        status: "closed",
        resolvedAt: "2026-10-20",
        mitigation: "Cache the responses",
        owner: "Ana",
      });
      expect(saved.updatedAt).toEqual(expect.any(String));
      // Stamped and complete: the page's move has nothing left to change.
      const plan = planRiskRegisterMove(blob, [saved], []);
      expect(plan.toFill).toEqual([]);
      expect(plan.conflicts).toEqual([]);
    });

    it("an update is validated and judged on the risk as listed", async () => {
      // The residual pair is only in the blob's copy: one half patched makes
      // a whole pair on the listed row (on the bare stored row it would be half).
      seed(transport, {
        risks: [risk()],
        blob: [risk({ residualProbability: 2, residualImpact: 2 })],
      });
      await crud("update", { id: "r1", patch: { residualProbability: 1 } });
      expect(stored(transport).risks[0]).toMatchObject({
        residualProbability: 1,
        residualImpact: 2,
      });
      await expect(crud("update", { id: "r1", patch: { impact: 9 } })).rejects.toThrow(
        /impact: a whole number/
      );
    });

    it("a risk only the old blob holds is updated as the register lists it, and saved stamped", async () => {
      // Raised on the old page and never pushed: list_state shows it pending.
      const blob = [risk({ id: "old", mitigation: "Cache the responses" })];
      seed(transport, { blob });
      expect(
        await crud("update", { id: "old", patch: { title: "Sandbox outage", probability: 2 } })
      ).toEqual({ updated: true });
      const [saved] = stored(transport).risks;
      expect(saved).toMatchObject({
        id: "old",
        title: "Sandbox outage",
        probability: 2,
        impact: 4,
        mitigation: "Cache the responses",
        status: "open",
      });
      expect(saved.updatedAt).toEqual(expect.any(String));
      const s = await run<{ items: { id: string; title: string }[] }>(
        transport,
        "tool.risk_register.list_state"
      );
      expect(s.items.filter((i) => i.id === "old").map((i) => i.title)).toEqual(["Sandbox outage"]);
      // Stamped: the page's move leaves it as saved.
      expect(planRiskRegisterMove(blob, [saved], [])).toMatchObject({
        toAdd: [],
        toFill: [],
        conflicts: [],
      });
      await expect(crud("update", { id: "old", patch: { impact: 9 } })).rejects.toThrow(
        /impact: a whole number/
      );
      expect(await crud("update", { id: "nope", patch: { title: "x" } })).toEqual({
        updated: false,
      });
    });

    it("a blob row already moved, or blank, is no row to update", async () => {
      seed(transport, {
        blob: [risk({ id: "gone" }), { id: "blank", title: "", probability: 1, impact: 1 }],
        moved: ["gone"],
      });
      for (const id of ["gone", "blank"]) {
        expect(await crud("update", { id, patch: { owner: "Ana" } })).toEqual({ updated: false });
      }
      expect(stored(transport).risks).toEqual([]);
    });

    it("a delete of a row still in the old blob is refused; once moved, it goes", async () => {
      seed(transport, {
        risks: [risk()],
        blob: [risk(), risk({ id: "blob-only", title: "Old page only" })],
      });
      await expect(crud("delete", { id: "r1" })).rejects.toThrow("pending_move");
      await expect(crud("delete", { id: "blob-only" })).rejects.toThrow("pending_move");
      expect(stored(transport).risks.map((r) => r.id)).toEqual(["r1"]);
      markMoved(["r1", "blob-only"]);
      expect(await crud("delete", { id: "r1" })).toEqual({ deleted: true });
      expect(stored(transport).risks).toEqual([]);
    });
  }
);
