/**
 * tool.tech_debt.* after Tech Debt moved into the workspace (Phase 8), on
 * both transports: list_state reads the old blob's pending rows and ranks
 * with the page's capped score and the cadence's sprint length,
 * mark_resolved takes a day, add_tag / set_area save a pending row merged
 * and stamped, delete refuses a pending row ('pending_move'), and
 * add_to_backlog makes a linked backlog story.
 */

import { beforeEach, describe, expect, it, vi } from "vitest";
import type { Story, TechDebtItem } from "@/lib/stores/workspace-types";
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
import { TECH_DEBT_KEY, TECH_DEBT_MOVED_KEY, planTechDebtMove } from "@/lib/tech-debt/legacy";
import { addDays } from "@/lib/impediments/model";
import { todayLocalISO } from "@/lib/utils/formatters";
import "@/lib/actions/tools/tech-debt";
import "@/lib/actions/workspace";

const TODAY = todayLocalISO();
const ws = () => useWorkspaceStore.getState();
const tab = { userId: "u", source: "agent" as const, squadProfileIds: [] as string[] };
const mcpCtx = { userId: "u", source: "mcp" as const, squadProfileIds: [] as string[] };

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

const item = (over: Partial<TechDebtItem> = {}): TechDebtItem => ({
  id: "d1",
  title: "Flaky deploy script",
  impact: 3,
  effort: 3,
  raisedAt: "2026-09-01",
  ...over,
});

function seed(
  transport: "tab" | "mcp",
  s: {
    items?: TechDebtItem[];
    blob?: unknown[];
    moved?: string[];
    stories?: Story[];
    sprintLengthDays?: number;
  }
) {
  const cadence = s.sprintLengthDays
    ? [{ id: CEREMONY_CADENCE_ID, sprintLengthDays: s.sprintLengthDays }]
    : [];
  if (transport === "tab") {
    useWorkspaceStore.setState({
      techDebt: s.items ?? [],
      stories: s.stories ?? [],
      ceremonyCadences: cadence as never,
    });
    if (s.blob) localStorage.setItem(TECH_DEBT_KEY, JSON.stringify(s.blob));
    if (s.moved) localStorage.setItem(TECH_DEBT_MOVED_KEY, JSON.stringify(s.moved));
    return;
  }
  for (const t of s.items ?? []) rows.set(`workspace:techDebt/${t.id}`, t);
  for (const st of s.stories ?? []) rows.set(`workspace:story/${st.id}`, st);
  for (const c of cadence) rows.set(`workspace:ceremonyCadence/${c.id}`, c);
  if (s.blob) blobs.set(TECH_DEBT_KEY, s.blob);
  if (s.moved) blobs.set(TECH_DEBT_MOVED_KEY, s.moved);
}

function stored(transport: "tab" | "mcp") {
  if (transport === "tab") return { items: ws().techDebt, stories: ws().stories };
  const of = <T>(kind: string) =>
    Array.from(rows.entries())
      .filter(([k]) => k.startsWith(`workspace:${kind}/`))
      .map(([, v]) => v as T);
  return { items: of<TechDebtItem>("techDebt"), stories: of<Story>("story") };
}

beforeEach(() => {
  rows.clear();
  blobs.clear();
  localStorage.clear();
  useWorkspaceStore.setState({
    techDebt: [],
    stories: [],
    ceremonyCadences: [],
    whiteboardObjects: [],
  });
});

describe("tool.tech_debt — registration", () => {
  it("registers delete and add_to_backlog on both transports; delete asks first", () => {
    for (const name of ["delete", "add_to_backlog"]) {
      const a = registry.get(`tool.tech_debt.${name}`);
      expect(a, name).toBeDefined();
      expect(a!.mcpHandler, name).toBeTypeOf("function");
      expect(a!.category).toBe("write");
    }
    expect(registry.get("tool.tech_debt.delete")!.requiresConfirmation).toBe(true);
    expect(registry.get("tool.tech_debt.add_to_backlog")!.requiresConfirmation).toBe(false);
  });
});

describe.each(["tab", "mcp"] as const)("tool.tech_debt over %s", (transport) => {
  it("list_state ranks with the capped score in sprints of the cadence, pending rows included", async () => {
    seed(transport, {
      items: [
        // 56 days old at 7-day sprints: 8 sprints × 2 = 16, capped at 10.
        item({
          id: "old",
          title: "Old trivial",
          impact: 1,
          effort: 5,
          interestRate: 2,
          raisedAt: addDays(TODAY, -56),
        }),
        item({ id: "fresh", title: "Fresh critical", impact: 5, effort: 1, raisedAt: TODAY }),
        item({ id: "done", title: "Paid", impact: 5, effort: 1, resolvedAt: "2026-10-01" }),
        item({
          id: "sent",
          title: "On the backlog",
          impact: 2,
          effort: 2,
          area: "ci",
          sentTo: [{ route: "backlog-story", targetId: "s1", at: "2026-10-01T00:00:00Z" }],
        }),
      ],
      blob: [
        {
          id: "blob",
          title: "From the old page",
          impact: 4,
          effort: 2,
          raisedAt: TODAY,
          area: "api",
        },
      ],
      stories: [{ id: "s1", title: "On the backlog", status: "done" } as Story],
      sprintLengthDays: 7,
    });
    const s = await run<{
      sprintLengthDays: number;
      openCount: number;
      resolvedCount: number;
      byArea: Record<string, number>;
      items: {
        id: string;
        ageSprints: number | null;
        score: { total: number; capped: boolean };
        inBacklog: string | null;
        storyDone: boolean;
        pending: boolean;
        open: boolean;
      }[];
      openByArea: Record<string, number>;
      interestPerSprint: number;
      unestimated: number;
      inBacklog: number;
      pending: number;
      verdict: string;
    }>(transport, "tool.tech_debt.list_state", { today: TODAY });
    expect(s.sprintLengthDays).toBe(7);
    expect(s.items.map((i) => [i.id, i.score.total, i.open])).toEqual([
      ["fresh", 19, true],
      ["blob", 14, true],
      ["old", 9, true],
      ["sent", 6, true],
      ["done", 19, false],
    ]);
    expect(s.items.find((i) => i.id === "old")).toMatchObject({
      ageSprints: 8,
      score: { capped: true },
    });
    expect(s.items.find((i) => i.id === "sent")).toMatchObject({
      inBacklog: "s1",
      storyDone: true,
    });
    expect(s.items.find((i) => i.id === "blob")?.pending).toBe(true);
    expect([s.openCount, s.resolvedCount]).toEqual([4, 1]);
    expect(s.byArea).toEqual({ __unassigned: 3, ci: 1, api: 1 });
    expect(s.openByArea).toEqual({ __unassigned: 2, ci: 1, api: 1 });
    expect([s.interestPerSprint, s.unestimated, s.inBacklog, s.pending]).toEqual([2, 3, 1, 1]);
    expect(s.verdict).toMatch(
      /^4 open items cost about 2 points a sprint \(3 not estimated\); the top one, “Fresh critical”/
    );
  });

  it("mark_resolved takes a day: today by default, backdated, never future or before raised", async () => {
    seed(transport, { items: [item()] });
    const latest = transport === "mcp" ? addDays(TODAY, 1) : TODAY;
    await expect(
      run(transport, "tool.tech_debt.mark_resolved", { id: "d1", resolvedAt: addDays(latest, 1) })
    ).resolves.toEqual({ updated: false, reason: "future_day" });
    await expect(
      run(transport, "tool.tech_debt.mark_resolved", { id: "d1", resolvedAt: "2026-08-01" })
    ).resolves.toEqual({ updated: false, reason: "before_raised" });
    await expect(
      run(transport, "tool.tech_debt.mark_resolved", { id: "d1", resolvedAt: "2026-02-30" })
    ).resolves.toEqual({ updated: false, reason: "not_a_day" });
    await expect(run(transport, "tool.tech_debt.mark_resolved", { id: "x" })).resolves.toEqual({
      updated: false,
      reason: "not_found",
    });
    await expect(run(transport, "tool.tech_debt.mark_resolved", { id: "d1" })).resolves.toEqual({
      updated: true,
      resolvedAt: TODAY,
    });
    expect(stored(transport).items[0]).toMatchObject({
      resolvedAt: TODAY,
      updatedAt: expect.any(String),
    });
  });

  it("add_tag and set_area save a pending row merged, stamped", async () => {
    seed(transport, { blob: [item({ id: "old", description: "From the old page" })] });
    await expect(
      run(transport, "tool.tech_debt.add_tag", { id: "old", tag: "perf" })
    ).resolves.toEqual({
      added: true,
    });
    await expect(
      run(transport, "tool.tech_debt.set_area", { id: "old", area: "ci" })
    ).resolves.toEqual({
      updated: true,
    });
    expect(stored(transport).items).toEqual([
      {
        ...item({ id: "old" }),
        description: "From the old page",
        tags: ["perf"],
        area: "ci",
        updatedAt: expect.any(String),
      },
    ]);
  });

  it("delete refuses a pending row and removes a workspace one", async () => {
    seed(transport, { items: [item({ id: "ws" })], blob: [item({ id: "old" })] });
    await expect(run(transport, "tool.tech_debt.delete", { id: "old" })).resolves.toMatchObject({
      deleted: false,
      reason: "pending_move",
    });
    await expect(
      run(transport, "tool.tech_debt.delete", { id: "ws" }, { confirm: async () => false })
    ).resolves.toEqual({ deleted: false, confirmed: false });
    await expect(run(transport, "tool.tech_debt.delete", { id: "ws" })).resolves.toEqual({
      deleted: true,
      id: "ws",
      title: "Flaky deploy script",
    });
    expect(stored(transport).items).toEqual([]);
  });

  it("add_to_backlog makes an unestimated backlog story linked both ways, once", async () => {
    seed(transport, {
      items: [
        item(),
        item({ id: "paid", resolvedAt: "2026-10-01" }),
        item({ id: "example-debt-1" }),
      ],
    });
    const out = await run<{ sent: boolean; storyId: string }>(
      transport,
      "tool.tech_debt.add_to_backlog",
      {
        id: "d1",
      }
    );
    expect(out).toEqual({ sent: true, storyId: expect.stringMatching(/^story_/) });
    const { items, stories } = stored(transport);
    // Unestimated (effort isn't story points); the tab's store also stamps createdAt.
    expect(stories).toEqual([
      expect.objectContaining({
        id: out.storyId,
        title: "Flaky deploy script",
        status: "backlog",
        sourceRef: { tool: "tech-debt", id: "d1" },
      }),
    ]);
    expect(stories[0].points).toBeUndefined();
    expect(items.find((t) => t.id === "d1")?.sentTo).toEqual([
      { route: "backlog-story", targetId: out.storyId, at: expect.any(String) },
    ]);
    await expect(run(transport, "tool.tech_debt.add_to_backlog", { id: "d1" })).resolves.toEqual({
      sent: false,
      reason: "already_sent",
      storyId: out.storyId,
    });
    for (const [id, reason] of [
      ["paid", "resolved"],
      ["example-debt-1", "example"],
      ["nope", "not_found"],
    ]) {
      await expect(run(transport, "tool.tech_debt.add_to_backlog", { id })).resolves.toEqual({
        sent: false,
        reason,
      });
    }
  });
});

describe.each(["tab", "mcp"] as const)(
  "the workspace.tech_debt CRUD on a row still in the old blob, %s",
  (transport) => {
    const crud = <T>(verb: string, params: Record<string, unknown>) =>
      run<T>(transport, `workspace.tech_debt.${verb}`, params);

    it("an update merges into the item as listed, so the move keeps the blob's resolution", async () => {
      // Pushed, then paid down on the old page; the workspace's copy is still open.
      const blob = [item({ area: "ci", resolvedAt: "2026-10-20" })];
      seed(transport, { items: [item()], blob });
      expect(await crud("update", { id: "d1", patch: { tags: ["deploy"] } })).toEqual({
        updated: true,
      });
      const [saved] = stored(transport).items;
      expect(saved).toMatchObject({ area: "ci", resolvedAt: "2026-10-20", tags: ["deploy"] });
      expect(saved.updatedAt).toEqual(expect.any(String));
      expect(planTechDebtMove(blob, [saved], [])).toMatchObject({ toFill: [], conflicts: [] });
    });

    it("reopens with an empty resolvedAt, and the move doesn't resolve it again", async () => {
      const blob = [item({ resolvedAt: "2026-10-20" })];
      seed(transport, { items: [item()], blob });
      await crud("update", { id: "d1", patch: { resolvedAt: "" } });
      const [saved] = stored(transport).items;
      expect(saved.resolvedAt).toBe("");
      const s = await run<{ items: { id: string; open: boolean }[] }>(
        transport,
        "tool.tech_debt.list_state",
        { today: TODAY }
      );
      expect(s.items.find((t) => t.id === "d1")?.open).toBe(true);
      expect(planTechDebtMove(blob, [saved], []).toFill).toEqual([]);
    });

    it("an item only the old blob holds is updated as listed: the documented reopen works", async () => {
      // Paid down on the old page and never pushed: list_state shows it pending and resolved.
      const blob = [item({ id: "old", area: "ci", resolvedAt: "2026-10-20" })];
      seed(transport, { blob });
      expect(await crud("update", { id: "old", patch: { resolvedAt: "" } })).toEqual({
        updated: true,
      });
      const [saved] = stored(transport).items;
      expect(saved).toMatchObject({ id: "old", title: "Flaky deploy script", area: "ci" });
      expect(saved.resolvedAt).toBe("");
      expect(saved.updatedAt).toEqual(expect.any(String));
      const s = await run<{ items: { id: string; open: boolean }[] }>(
        transport,
        "tool.tech_debt.list_state",
        { today: TODAY }
      );
      expect(s.items.filter((t) => t.id === "old")).toEqual([
        expect.objectContaining({ open: true }),
      ]);
      // Stamped: the page's move leaves it as saved.
      expect(planTechDebtMove(blob, [saved], [])).toMatchObject({
        toAdd: [],
        toFill: [],
        conflicts: [],
      });
      // A rating it sets is judged as on any row; an id nobody lists is still unknown.
      await expect(crud("update", { id: "old", patch: { impact: 9 } })).rejects.toThrow(/impact/);
      expect(await crud("update", { id: "nope", patch: { area: "x" } })).toEqual({
        updated: false,
      });
    });

    it("a blob row already moved, or blank, is no row to update", async () => {
      seed(transport, {
        blob: [item({ id: "gone" }), { id: "blank", title: "", impact: 3, effort: 3 }],
        moved: ["gone"],
      });
      for (const id of ["gone", "blank"]) {
        expect(await crud("update", { id, patch: { area: "x" } })).toEqual({ updated: false });
      }
      expect(stored(transport).items).toEqual([]);
    });

    it("a delete of a row still in the old blob is refused; once moved, it goes", async () => {
      seed(transport, { items: [item()], blob: [item(), item({ id: "blob-only", title: "Old" })] });
      await expect(crud("delete", { id: "d1" })).rejects.toThrow("pending_move");
      await expect(crud("delete", { id: "blob-only" })).rejects.toThrow("pending_move");
      expect(stored(transport).items.map((t) => t.id)).toEqual(["d1"]);
      if (transport === "tab") {
        localStorage.setItem(TECH_DEBT_MOVED_KEY, JSON.stringify(["d1", "blob-only"]));
      } else blobs.set(TECH_DEBT_MOVED_KEY, ["d1", "blob-only"]);
      expect(await crud("delete", { id: "d1" })).toEqual({ deleted: true });
      expect(stored(transport).items).toEqual([]);
    });
  }
);
