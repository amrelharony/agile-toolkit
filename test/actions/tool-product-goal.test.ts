/**
 * tool.product_goal.* — Amr's Product Goal verbs read and write the same
 * goals the page does, keep one active (closing the current one as the
 * caller says), and the MCP path does the same against the server store.
 */

import { beforeEach, describe, expect, it, vi } from "vitest";

const rows = vi.hoisted(() => new Map<string, unknown>());
vi.mock("@/lib/actions/server-store", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/lib/actions/server-store")>();
  return {
    ...actual,
    serverGetEntity: vi.fn(
      async (_u: string, kind: string, id: string) => rows.get(`${kind}/${id}`) ?? null
    ),
    serverUpsertEntity: vi.fn(async (_u: string, kind: string, e: { id: string }) => {
      rows.set(`${kind}/${e.id}`, e);
    }),
    serverListEntities: vi.fn(async (_u: string, kind: string) =>
      Array.from(rows.entries())
        .filter(([k]) => k.startsWith(`${kind}/`))
        .map(([, v]) => v)
    ),
  };
});

import { registry } from "@/lib/actions/registry";
import { useWorkspaceStore } from "@/lib/stores/workspace-store";
import { PRODUCT_GOAL_KIND, type ProductGoal } from "@/lib/stores/workspace-types";
import "@/lib/actions/tools/product-goal";

const ctx = () => ({ userId: "u", source: "agent" as const, squadProfileIds: [] as string[] });
const run = async <T>(id: string, params: Record<string, unknown> = {}) => {
  const a = registry.get(id)!;
  return (await a.handler(a.paramsSchema.parse(params), ctx())) as T;
};
const mcp = async <T>(id: string, params: Record<string, unknown> = {}) => {
  const a = registry.get(id)!;
  return (await a.mcpHandler!(a.paramsSchema.parse(params), ctx())) as T;
};

const goal = (over: Partial<ProductGoal> = {}): ProductGoal => ({
  id: "goal_a",
  statement: "Shop owners take payments anywhere",
  measures: ["Weekly active shops"],
  status: "active",
  createdAt: "2026-09-01T00:00:00.000Z",
  updatedAt: "2026-09-01T00:00:00.000Z",
  ...over,
});
const goals = () => useWorkspaceStore.getState().productGoals ?? [];

beforeEach(() => {
  rows.clear();
  useWorkspaceStore.setState({ productGoals: [] });
});

describe("registration", () => {
  it("has a read, two writes with server handlers, and a read-only check", () => {
    expect(registry.get("tool.product_goal.list_state")?.category).toBe("read");
    expect(registry.get("tool.product_goal.check_goal")?.category).toBe("read");
    for (const id of ["tool.product_goal.set_goal", "tool.product_goal.close_goal"]) {
      expect(registry.get(id)?.category).toBe("write");
      expect(registry.get(id)?.mcpHandler).toBeTypeOf("function");
    }
  });
});

describe("list_state", () => {
  it("reads the active goal with its checks, the record, and an extra active goal", async () => {
    useWorkspaceStore.setState({
      productGoals: [
        goal(),
        goal({ id: "goal_b", updatedAt: "2026-10-01T00:00:00.000Z" }),
        goal({ id: "goal_old", status: "achieved", closedAt: "2026-08-01T00:00:00.000Z" }),
        goal({ id: "example-g", status: "abandoned" }),
      ],
    });
    const r = await run<{
      active: (ProductGoal & { checks: { id: string }[] }) | null;
      history: ProductGoal[];
      extraActive: { id: string }[];
    }>("tool.product_goal.list_state");
    expect(r.active?.id).toBe("goal_b");
    expect(r.active?.checks.map((c) => c.id)).toEqual([
      "outcome",
      "measurable",
      "single",
      "vision",
    ]);
    expect(r.history.map((g) => g.id)).toEqual(["goal_a", "goal_old"]);
    expect(r.extraActive.map((g) => g.id)).toEqual(["goal_a"]);
  });
});

describe("set_goal", () => {
  it("makes the first goal active", async () => {
    const r = await run<{ id: string; closed: unknown[] }>("tool.product_goal.set_goal", {
      statement: "  Shop owners   get paid next day ",
      measures: ["Payouts next day"],
      targetDate: "2027-06-30",
    });
    expect(r.closed).toEqual([]);
    expect(r.id).toMatch(/^goal_/);
    expect(goals()).toEqual([
      expect.objectContaining({
        id: r.id,
        statement: "Shop owners get paid next day",
        status: "active",
        targetDate: "2027-06-30",
      }),
    ]);
  });

  it("refuses to replace an active goal without saying how it ended", async () => {
    useWorkspaceStore.setState({ productGoals: [goal()] });
    await expect(run("tool.product_goal.set_goal", { statement: "Next" })).rejects.toThrow(
      /Say how it ended/
    );
    expect(goals()).toHaveLength(1);
  });

  it("closes the active goal first, then makes the new one active", async () => {
    useWorkspaceStore.setState({ productGoals: [goal()] });
    const r = await run<{ id: string; closed: { id: string; status: string }[] }>(
      "tool.product_goal.set_goal",
      { statement: "Next goal", closeAs: "abandoned", note: "The market moved" }
    );
    expect(r.closed).toEqual([{ id: "goal_a", status: "abandoned" }]);
    const old = goals().find((g) => g.id === "goal_a");
    expect(old).toMatchObject({ status: "abandoned", note: "The market moved" });
    expect(old?.closedAt).toBeTruthy();
    expect(
      goals()
        .filter((g) => g.status === "active")
        .map((g) => g.id)
    ).toEqual([r.id]);
  });

  it("refuses a target that isn't a real day", () => {
    const a = registry.get("tool.product_goal.set_goal")!;
    expect(a.paramsSchema.safeParse({ statement: "x", targetDate: "2027-02-30" }).success).toBe(
      false
    );
  });

  it("does the same on the server", async () => {
    rows.set(`${PRODUCT_GOAL_KIND}/goal_a`, goal());
    const r = await mcp<{ id: string }>("tool.product_goal.set_goal", {
      statement: "Next goal",
      closeAs: "achieved",
    });
    expect((rows.get(`${PRODUCT_GOAL_KIND}/goal_a`) as ProductGoal).status).toBe("achieved");
    expect((rows.get(`${PRODUCT_GOAL_KIND}/${r.id}`) as ProductGoal).status).toBe("active");
    const state = await mcp<{ active: { id: string } | null }>("tool.product_goal.list_state");
    expect(state.active?.id).toBe(r.id);
  });
});

describe("close_goal and check_goal", () => {
  it("closes the active goal, or says there is none", async () => {
    expect(await run("tool.product_goal.close_goal", { outcome: "achieved" })).toEqual({
      closed: false,
    });
    useWorkspaceStore.setState({ productGoals: [goal()] });
    expect(
      await run("tool.product_goal.close_goal", { outcome: "achieved", note: "Done" })
    ).toEqual({
      closed: true,
      id: "goal_a",
      status: "achieved",
    });
    expect(goals()[0]).toMatchObject({ status: "achieved", note: "Done" });
  });

  it("checks a text without saving", async () => {
    const r = await run<{ checks: { id: string; met: boolean | null }[] }>(
      "tool.product_goal.check_goal",
      { statement: "Build the app and the reports", vision: "Patients book a doctor" }
    );
    expect(r.checks.map((c) => c.met)).toEqual([false, false, true, false]);
    expect(goals()).toEqual([]);
  });
});
