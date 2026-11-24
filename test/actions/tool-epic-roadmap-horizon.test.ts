/**
 * tool.epic_roadmap and Now, Next, Later: list_state says where each epic
 * shows on the board and why (and counts them); set_horizon moves an epic
 * by hand or back to its quarters, never touching the quarters, in the
 * browser and over MCP. "Now" is fixed at 23 Nov 2026 (2026 Q4).
 */

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { Epic, EpicRoadmap } from "@/lib/stores/workspace-types";

const server = vi.hoisted(() => ({ rows: new Map<string, { id: string }>() }));

vi.mock("@/lib/actions/server-store", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/lib/actions/server-store")>();
  const key = (kind: string, id: string) => `${kind}/${id}`;
  return {
    ...actual,
    serverListEntities: vi.fn(async (_u: string, kind: string) =>
      Array.from(server.rows.entries())
        .filter(([k]) => k.startsWith(`${kind}/`))
        .map(([, v]) => v)
    ),
    serverGetEntity: vi.fn(
      async (_u: string, kind: string, id: string) => server.rows.get(key(kind, id)) ?? null
    ),
    serverUpsertEntity: vi.fn(async (_u: string, kind: string, e: { id: string }) => {
      server.rows.set(key(kind, e.id), e);
    }),
  };
});

import { registry } from "@/lib/actions/registry";
import { useWorkspaceStore } from "@/lib/stores/workspace-store";
import "@/lib/actions/tools/epic-roadmap";

const NOW = new Date("2026-11-23T12:00:00Z");
const ER_ID = "epicRoadmap:current";
const ctx = () => ({ userId: "u", source: "agent" as const, squadProfileIds: [] as string[] });
const run = async <T>(id: string, params: Record<string, unknown> = {}, onServer = false) => {
  const a = registry.get(id)!;
  const handler = onServer ? (a.mcpHandler ?? a.handler) : a.handler;
  return (await handler(a.paramsSchema.parse(params), ctx())) as T;
};

const epic = (id: string, start: string, end: string, over: Partial<Epic> = {}): Epic => ({
  id,
  title: id,
  startQuarter: start,
  endQuarter: end,
  progress: 0,
  ...over,
});
const EPICS = [
  epic("now", "2026 Q3", "2027 Q1"),
  epic("next", "2027 Q1", "2027 Q2"),
  epic("later", "2027 Q4", "2027 Q4"),
  epic("moved", "2027 Q4", "2027 Q4", { horizon: "now" }),
  epic("done", "2026 Q1", "2026 Q2", { progress: 100, horizon: "later" }),
];
const stored = () =>
  (useWorkspaceStore.getState().epicRoadmaps ?? []).find((d) => d.id === ER_ID)!.epics;

beforeEach(() => {
  vi.useFakeTimers({ toFake: ["Date"] });
  vi.setSystemTime(NOW);
  server.rows.clear();
  useWorkspaceStore.setState({ epicRoadmaps: [{ id: ER_ID, epics: EPICS }], stories: [] });
});
afterEach(() => vi.useRealTimers());

describe("list_state and the horizons", () => {
  it("says where each epic shows and why, and counts each column", async () => {
    const out = await run<{
      byHorizon: Record<string, number>;
      epics: { id: string; horizonShown: string; horizonFrom: string; horizon?: string }[];
    }>("tool.epic_roadmap.list_state");
    expect(out.epics.map((e) => [e.id, e.horizonShown, e.horizonFrom])).toEqual([
      ["now", "now", "quarters"],
      ["next", "next", "quarters"],
      ["later", "later", "quarters"],
      ["moved", "now", "set"],
      ["done", "done", "done"],
    ]);
    expect(out.epics[3].horizon).toBe("now");
    expect(out.byHorizon).toEqual({ now: 2, next: 1, later: 1, done: 1 });
  });
});

describe("tool.epic_roadmap.set_horizon", () => {
  it("is a write with an MCP handler", () => {
    const a = registry.get("tool.epic_roadmap.set_horizon");
    expect(a?.category).toBe("write");
    expect(a?.mcpHandler).toBeTypeOf("function");
    expect(a?.requiresConfirmation).toBe(false);
  });

  it("moves an epic by hand and back to its quarters, keeping the quarters", async () => {
    expect(
      await run("tool.epic_roadmap.set_horizon", { epicId: "later", horizon: "next" })
    ).toEqual({ updated: true, horizon: "next", from: "set" });
    expect(stored().find((e) => e.id === "later")).toEqual({
      ...EPICS[2],
      horizon: "next",
    });
    expect(await run("tool.epic_roadmap.set_horizon", { epicId: "later", horizon: null })).toEqual({
      updated: true,
      horizon: "later",
      from: "quarters",
    });
    expect(stored().find((e) => e.id === "later")).toEqual(EPICS[2]);
  });

  it("reports a done epic under Done whatever is set, and refuses an unknown one", async () => {
    expect(await run("tool.epic_roadmap.set_horizon", { epicId: "done", horizon: "now" })).toEqual({
      updated: true,
      horizon: "done",
      from: "done",
    });
    expect(await run("tool.epic_roadmap.set_horizon", { epicId: "nope", horizon: "now" })).toEqual({
      updated: false,
      reason: "not_found",
    });
    const schema = registry.get("tool.epic_roadmap.set_horizon")!.paramsSchema;
    expect(schema.safeParse({ epicId: "now", horizon: "done" }).success).toBe(false);
    expect(schema.safeParse({ epicId: "now" }).success).toBe(false);
  });

  it("writes the user's roadmap over MCP", async () => {
    server.rows.set(`workspace:epicRoadmap/${ER_ID}`, { id: ER_ID, epics: EPICS } as EpicRoadmap);
    expect(
      await run("tool.epic_roadmap.set_horizon", { epicId: "next", horizon: "later" }, true)
    ).toEqual({ updated: true, horizon: "later", from: "set" });
    const doc = server.rows.get(`workspace:epicRoadmap/${ER_ID}`) as EpicRoadmap;
    expect(doc.epics.find((e) => e.id === "next")?.horizon).toBe("later");
    expect(stored().find((e) => e.id === "next")).not.toHaveProperty("horizon");
    expect(
      await run("tool.epic_roadmap.set_horizon", { epicId: "x", horizon: null }, true)
    ).toEqual({ updated: false, reason: "not_found" });
  });
});
