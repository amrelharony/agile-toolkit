/**
 * tool.improve.* action coverage.
 *
 *   1. registration: list_state reads; add_step, record_result, log_reading
 *      and add_obstacle write without a confirmation, each with an MCP
 *      handler, and none is kept from visitors (it's the person's own data)
 *   2. list_state: every improvement with its progress, readings, the A3's
 *      gaps, the Kata's obstacle and last experiment, and the verdict,
 *      newest change first, examples listed but not counted, a malformed
 *      row read safely, and a step done in Retro Actions read as done
 *   3. add_step / record_result: within the caps, stamped, a Kata
 *      experiment refused without what the team expects (needs_expect)
 *   4. log_reading: dated, never for a later day (future_date)
 *   5. add_obstacle: Kata only, within its cap
 *   6. the MCP path reads the user's rows (with the boards and stories)
 *      and writes them back
 */

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("@/lib/actions/server-store", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/lib/actions/server-store")>();
  return {
    ...actual,
    serverGetEntity: vi.fn(async () => null),
    serverListEntities: vi.fn(async () => []),
    serverUpsertEntity: vi.fn(async () => {}),
  };
});

import * as serverStore from "@/lib/actions/server-store";
import { registry } from "@/lib/actions/registry";
import { useWorkspaceStore } from "@/lib/stores/workspace-store";
import {
  IMPROVEMENT_KIND,
  TOOL_LIST_MAX,
  type Improvement,
  type RetroBoard,
} from "@/lib/stores/workspace-types";
import { todayIso } from "@/lib/sprints/series";

import "@/lib/actions/tools/improve";

const ctx = () => ({
  userId: "test-user",
  source: "agent" as const,
  squadProfileIds: [] as string[],
});
const ws = () => useWorkspaceStore.getState();
const run = async <T>(id: string, params: Record<string, unknown> = {}) =>
  (await registry.get(id)!.handler(params, ctx())) as T;
const runMcp = async <T>(id: string, params: Record<string, unknown> = {}) =>
  (await registry.get(id)!.mcpHandler!(params, ctx())) as T;

function improvement(over: Partial<Improvement> & Pick<Improvement, "id">): Improvement {
  return {
    title: "Releases wait six days",
    method: "a3",
    status: "open",
    background: "",
    current: { text: "" },
    target: { text: "" },
    obstacles: [],
    steps: [],
    readings: [],
    createdAt: "2026-11-01T09:00:00.000Z",
    updatedAt: "2026-11-01T09:00:00.000Z",
    ...over,
  };
}

const kata = (over: Partial<Improvement> = {}) =>
  improvement({
    id: "improve_k",
    title: "Reviews wait too long",
    method: "kata",
    current: { text: "", value: 19 },
    target: { text: "Under 8 h", value: 8 },
    obstacles: [{ id: "o1", text: "One reviewer", status: "working" }],
    steps: [{ id: "s1", text: "Review slot", expect: "Wait drops", status: "running" }],
    readings: [{ id: "r1", date: "2026-11-10", value: 13 }],
    ...over,
  });

const stored = (id: string) => (ws().improvements ?? []).find((i) => i.id === id);

beforeEach(() => {
  useWorkspaceStore.setState({
    improvements: [],
    retroBoards: [],
    stories: [],
    rootCauseAnalyses: [],
  });
  vi.mocked(serverStore.serverGetEntity).mockReset().mockResolvedValue(null);
  vi.mocked(serverStore.serverListEntities).mockReset().mockResolvedValue([]);
  vi.mocked(serverStore.serverUpsertEntity)
    .mockReset()
    .mockResolvedValue(undefined as never);
});

afterEach(() => {
  vi.useRealTimers();
});

describe("tool.improve: registration", () => {
  it("reads with list_state and writes with four verbs, each with an MCP handler", () => {
    expect(registry.get("tool.improve.list_state")?.category).toBe("read");
    for (const name of ["add_step", "record_result", "log_reading", "add_obstacle"]) {
      const action = registry.get(`tool.improve.${name}`);
      expect(action?.category, name).toBe("write");
      expect(action?.requiresConfirmation, name).toBe(false);
      expect(action?.mcpHandler, name).toBeTypeOf("function");
      expect(action?.visitor, name).toBeUndefined();
    }
    expect(registry.get("tool.improve.list_state")?.mcpHandler).toBeTypeOf("function");
  });
});

describe("tool.improve.list_state", () => {
  it("summarises each improvement, newest first, examples listed but not counted", async () => {
    useWorkspaceStore.setState({
      improvements: [
        improvement({ id: "improve_a", updatedAt: "2026-11-02T09:00:00.000Z" }),
        kata({ updatedAt: "2026-11-05T09:00:00.000Z", nextCoachingAt: "2000-01-01" }),
        improvement({ id: "example-improve-x", status: "closed" }),
      ],
    });
    const out = await run<{
      total: number;
      byStatus: Record<string, number>;
      verdict: string;
      items: {
        id: string;
        example: boolean;
        progressPct: number | null;
        gaps: string[];
        workingObstacle: { id: string } | null;
        lastExperiment: { id: string } | null;
        readings: { count: number; last: { value: number } | null };
        coachingDue: boolean;
        steps: { total: number; done: number };
      }[];
    }>("tool.improve.list_state");
    expect(out.total).toBe(2);
    expect(out.byStatus).toEqual({ open: 2, checking: 0, closed: 0, dropped: 0 });
    expect(out.verdict).toBe("1 coaching talk is due: walk it with Coach me.");
    expect(out.items.map((i) => [i.id, i.example])).toEqual([
      ["improve_k", false],
      ["improve_a", false],
      ["example-improve-x", true],
    ]);
    const [k, a] = out.items;
    expect(k).toMatchObject({
      progressPct: 55,
      gaps: [],
      workingObstacle: { id: "o1" },
      lastExperiment: { id: "s1" },
      readings: { count: 1, last: { value: 13 } },
      coachingDue: true,
    });
    expect(a.gaps).toContain("Say why this matters now.");
    expect(a.progressPct).toBeNull();
  });

  it("reads a malformed row safely, and a step done in Retro Actions as done", async () => {
    useWorkspaceStore.setState({
      improvements: [
        { id: "improve_bad", steps: "nope", title: 7 } as unknown as Improvement,
        improvement({
          id: "improve_sent",
          steps: [
            {
              id: "s1",
              text: "Automate checks",
              status: "planned",
              sentTo: [{ route: "retro-action", targetId: "c1", at: "2026-11-01T09:00:00.000Z" }],
            },
          ],
        }),
      ],
      retroBoards: [
        { id: "retro:current", cards: [{ id: "c1", done: true, isActionItem: true }] },
      ] as unknown as RetroBoard[],
    });
    const out = await run<{ items: { id: string; title: string; steps: { done: number } }[] }>(
      "tool.improve.list_state"
    );
    expect(out.items.find((i) => i.id === "improve_bad")?.title).toBe("Untitled improvement");
    expect(out.items.find((i) => i.id === "improve_sent")?.steps.done).toBe(1);
  });
});

describe("tool.improve.add_step and record_result", () => {
  it("adds a planned step, stamped, and refuses an unknown improvement, obstacle or a full list", async () => {
    useWorkspaceStore.setState({ improvements: [kata()] });
    const added = await run<{ added: boolean; stepId: string; count: number }>(
      "tool.improve.add_step",
      {
        itemId: "improve_k",
        text: "Pair on payment reviews",
        expect: "Same-morning reviews",
        obstacleId: "o1",
      }
    );
    expect(added).toMatchObject({ added: true, count: 2 });
    const step = stored("improve_k")!.steps[1];
    expect(step).toEqual({
      id: added.stepId,
      text: "Pair on payment reviews",
      expect: "Same-morning reviews",
      obstacleId: "o1",
      status: "planned",
    });
    expect(stored("improve_k")!.updatedAt).not.toBe("2026-11-01T09:00:00.000Z");
    expect(await run("tool.improve.add_step", { itemId: "nope", text: "x" })).toEqual({
      added: false,
      reason: "not_found",
    });
    expect(
      await run("tool.improve.add_step", { itemId: "improve_k", text: "x", obstacleId: "o9" })
    ).toEqual({ added: false, reason: "unknown_obstacle" });
    useWorkspaceStore.setState({
      improvements: [
        kata({
          steps: Array.from({ length: TOOL_LIST_MAX.improveSteps }, (_, i) => ({
            id: `s${i}`,
            text: "x",
            status: "planned" as const,
          })),
        }),
      ],
    });
    expect(await run("tool.improve.add_step", { itemId: "improve_k", text: "One more" })).toEqual({
      added: false,
      reason: "list_full",
    });
  });

  it("records a result, stamping done, and refuses a Kata try with no expectation", async () => {
    useWorkspaceStore.setState({
      improvements: [kata({ steps: [{ id: "s1", text: "Look", status: "planned" }] })],
    });
    expect(
      await run("tool.improve.record_result", {
        itemId: "improve_k",
        stepId: "s1",
        status: "running",
      })
    ).toEqual({ updated: false, reason: "needs_expect" });
    expect(
      await run("tool.improve.record_result", {
        itemId: "improve_k",
        stepId: "s1",
        status: "done",
        expect: "Wait drops",
        result: "It fell",
        learned: "Pairing helps",
      })
    ).toEqual({ updated: true, status: "done" });
    expect(stored("improve_k")!.steps[0]).toMatchObject({
      status: "done",
      expect: "Wait drops",
      result: "It fell",
      learned: "Pairing helps",
    });
    expect(stored("improve_k")!.steps[0].doneAt).toBeTypeOf("string");
    expect(
      await run("tool.improve.record_result", { itemId: "improve_k", stepId: "nope", result: "x" })
    ).toEqual({ updated: false, reason: "unknown_step" });
  });
});

describe("tool.improve.log_reading", () => {
  it("logs a dated reading with the new progress, never for a later day", async () => {
    useWorkspaceStore.setState({ improvements: [kata()] });
    const today = todayIso();
    expect(
      await run("tool.improve.log_reading", { itemId: "improve_k", date: today, value: 8 })
    ).toEqual({ added: true, count: 2, progressPct: 100 });
    expect(
      await run("tool.improve.log_reading", { itemId: "improve_k", date: "2999-01-01", value: 8 })
    ).toEqual({ added: false, reason: "future_date" });
    expect(await run("tool.improve.log_reading", { itemId: "nope", value: 1 })).toEqual({
      added: false,
      reason: "not_found",
    });
    // The day defaults to today.
    await run("tool.improve.log_reading", { itemId: "improve_k", value: 9 });
    expect(stored("improve_k")!.readings[2]).toMatchObject({ date: today, value: 9 });
  });
});

describe("tool.improve.add_obstacle", () => {
  it("adds an open obstacle to a Kata, never to an A3", async () => {
    useWorkspaceStore.setState({ improvements: [kata(), improvement({ id: "improve_a" })] });
    const out = await run<{ added: boolean; obstacleId: string; count: number }>(
      "tool.improve.add_obstacle",
      { itemId: "improve_k", text: "Big pull requests" }
    );
    expect(out).toMatchObject({ added: true, count: 2 });
    expect(stored("improve_k")!.obstacles[1]).toEqual({
      id: out.obstacleId,
      text: "Big pull requests",
      status: "open",
    });
    expect(await run("tool.improve.add_obstacle", { itemId: "improve_a", text: "x" })).toEqual({
      added: false,
      reason: "not_kata",
    });
  });
});

describe("tool.improve on the MCP path", () => {
  it("reads the user's rows with their boards and stories, and writes back", async () => {
    const row = kata();
    vi.mocked(serverStore.serverListEntities).mockImplementation(
      async (_u, kind) => (kind === IMPROVEMENT_KIND ? [row] : []) as never
    );
    vi.mocked(serverStore.serverGetEntity).mockResolvedValue(row as never);
    const out = await runMcp<{ total: number }>("tool.improve.list_state");
    expect(out.total).toBe(1);
    const kinds = vi.mocked(serverStore.serverListEntities).mock.calls.map((c) => c[1]);
    expect(kinds).toEqual(
      expect.arrayContaining([IMPROVEMENT_KIND, "workspace:retroBoard", "workspace:story"])
    );
    expect(
      await runMcp("tool.improve.add_obstacle", {
        itemId: "improve_k",
        text: "Nobody owns the queue",
      })
    ).toMatchObject({ added: true, count: 2 });
    const [, kind, written] = vi.mocked(serverStore.serverUpsertEntity).mock.calls[0];
    expect(kind).toBe(IMPROVEMENT_KIND);
    expect((written as Improvement).obstacles).toHaveLength(2);
    // On the server's clock a reading may be for the day after (another time zone's today).
    const tomorrow = new Date(Date.now() + 86_400_000);
    const day = `${tomorrow.getFullYear()}-${String(tomorrow.getMonth() + 1).padStart(2, "0")}-${String(tomorrow.getDate()).padStart(2, "0")}`;
    expect(
      await runMcp("tool.improve.log_reading", { itemId: "improve_k", date: day, value: 10 })
    ).toMatchObject({ added: true });
  });
});
