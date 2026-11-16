/**
 * tool.interrupt_buffer.* — Amr's Interrupt Buffer verbs set a sprint's
 * buffer, log and resolve interrupts, and read the same status the page
 * and the cockpit tile read, in the browser and on the MCP server.
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
import { INTERRUPT_ITEM_KIND, type InterruptItem, type Sprint } from "@/lib/stores/workspace-types";
import "@/lib/actions/tools/interrupt-buffer";

const ctx = () => ({ userId: "u", source: "agent" as const, squadProfileIds: [] as string[] });
const run = async <T>(id: string, params: Record<string, unknown> = {}) => {
  const a = registry.get(id)!;
  return (await a.handler(a.paramsSchema.parse(params), ctx())) as T;
};
const mcp = async <T>(id: string, params: Record<string, unknown> = {}) => {
  const a = registry.get(id)!;
  return (await a.mcpHandler!(a.paramsSchema.parse(params), ctx())) as T;
};

const sprint = (over: Partial<Sprint> = {}): Sprint => ({
  id: "s1",
  name: "Sprint 1",
  startDate: "2026-11-02",
  endDate: "2026-11-13",
  pointsPlanned: 30,
  status: "active",
  ...over,
});
const items = () => useWorkspaceStore.getState().interruptItems ?? [];

beforeEach(() => {
  rows.clear();
  useWorkspaceStore.setState({
    sprints: [
      sprint(),
      sprint({ id: "s0", name: "Sprint 0", startDate: "2026-10-19", status: "completed" }),
    ],
    interruptItems: [],
  });
});

describe("registration", () => {
  it("has two reads and three writes with server handlers", () => {
    for (const id of ["list_state", "classify"]) {
      expect(registry.get(`tool.interrupt_buffer.${id}`)?.category).toBe("read");
    }
    for (const id of ["set_buffer", "log_interrupt", "resolve"]) {
      const a = registry.get(`tool.interrupt_buffer.${id}`);
      expect(a?.category).toBe("write");
      expect(a?.mcpHandler).toBeTypeOf("function");
    }
  });
});

describe("the buffer and the interrupts", () => {
  it("sets a buffer, logs interrupts against the active sprint, and goes over", async () => {
    expect(await run("tool.interrupt_buffer.set_buffer", { pct: 20 })).toEqual({
      updated: true,
      sprintId: "s1",
      buffer: "20% of the sprint (6 points)",
    });
    const first = await run<{ kind: string; sprintId: string; status: { state: string } }>(
      "tool.interrupt_buffer.log_interrupt",
      { title: "Checkout is down", size: 5 }
    );
    expect(first).toMatchObject({ logged: true, kind: "incident", sprintId: "s1" });
    expect(first.status.state).toBe("watch");
    const second = await run<{ status: { over: boolean; summary: string } }>(
      "tool.interrupt_buffer.log_interrupt",
      { title: "Sales wants an export", kind: "request", size: 3 }
    );
    expect(second.status).toMatchObject({
      over: true,
      summary: "8 of 6 points used: 2 points over the buffer.",
    });
    const state = await run<{
      status: { usedPoints: number; state: string };
      emergencyProcedure: { id: string }[] | null;
      interrupts: InterruptItem[];
      history: { sprintId: string }[];
    }>("tool.interrupt_buffer.list_state");
    expect(state.status).toMatchObject({ usedPoints: 8, state: "over" });
    expect(state.emergencyProcedure?.[0].id).toBe("stop");
    expect(state.interrupts).toHaveLength(2);
    expect(state.history.map((h) => h.sprintId)).toEqual(["s1"]);
  });

  it("resolves and reopens an interrupt, which still counts", async () => {
    const { id } = await run<{ id: string }>("tool.interrupt_buffer.log_interrupt", {
      title: "Login broken",
      size: 2,
    });
    expect(await run("tool.interrupt_buffer.resolve", { id })).toEqual({
      updated: true,
      resolved: true,
    });
    expect(items()[0].resolvedAt).toBeTruthy();
    expect(await run("tool.interrupt_buffer.resolve", { id, reopen: true })).toEqual({
      updated: true,
      resolved: false,
    });
    expect("resolvedAt" in items()[0]).toBe(false);
    expect(await run("tool.interrupt_buffer.resolve", { id: "nope" })).toEqual({ updated: false });
  });

  it("clears a buffer, and refuses an empty change or an unknown sprint", async () => {
    await run("tool.interrupt_buffer.set_buffer", { points: 4 });
    await run("tool.interrupt_buffer.set_buffer", { clear: true });
    expect(useWorkspaceStore.getState().sprints.find((s) => s.id === "s1")).not.toHaveProperty(
      "interruptBuffer"
    );
    const a = registry.get("tool.interrupt_buffer.set_buffer")!;
    expect(a.paramsSchema.safeParse({}).success).toBe(false);
    expect(a.paramsSchema.safeParse({ pct: 95 }).success).toBe(false);
    expect(await run("tool.interrupt_buffer.set_buffer", { sprintId: "zz", points: 2 })).toEqual({
      updated: false,
      reason: "No such sprint.",
    });
  });

  it("classifies titles by keyword without saving", async () => {
    expect(
      await run("tool.interrupt_buffer.classify", {
        titles: ["Customer can't reset their password"],
      })
    ).toEqual({
      items: [{ title: "Customer can't reset their password", kind: "support", size: 1 }],
    });
    expect(items()).toEqual([]);
  });

  it("does the same on the server", async () => {
    rows.set("workspace:sprint/s1", sprint({ interruptBuffer: { points: 3 } }));
    await mcp("tool.interrupt_buffer.log_interrupt", {
      title: "Error on the orders page",
      size: 4,
    });
    const logged = Array.from(rows.entries()).filter(([k]) =>
      k.startsWith(`${INTERRUPT_ITEM_KIND}/`)
    );
    expect(logged).toHaveLength(1);
    const state = await mcp<{ status: { state: string; usedPoints: number } }>(
      "tool.interrupt_buffer.list_state"
    );
    expect(state.status).toMatchObject({ state: "over", usedPoints: 4 });
  });
});
