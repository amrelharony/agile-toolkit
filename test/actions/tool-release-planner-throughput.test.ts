/**
 * tool.release_planner.throughput_forecast: the page's "count items"
 * forecast for Amr, from typed weeks or a board's finished work.
 */

import { beforeEach, describe, expect, it } from "vitest";
import { registry } from "@/lib/actions/registry";
import { useWorkspaceStore } from "@/lib/stores/workspace-store";
import { KANBAN_BOARD_ID, type Story } from "@/lib/stores/workspace-types";
import { throughputForecast } from "@/lib/sprints/throughput-forecast";
import "@/lib/actions/tools/release-planner";

const ctx = () => ({ userId: "u", source: "agent" as const, squadProfileIds: [] as string[] });

type Result = ReturnType<typeof throughputForecast> & {
  source: string;
  start: string;
  weeks: { label: string; value: number }[];
};
const run = async (params: Record<string, unknown>) =>
  (await registry
    .get("tool.release_planner.throughput_forecast")!
    .handler(params, ctx())) as Result;

const doneStory = (id: string, day: string): Story => ({
  id,
  title: id,
  status: "done",
  startedAt: `${day}T09:00:00.000Z`,
  doneAt: `${day}T12:00:00.000Z`,
});

beforeEach(() => {
  useWorkspaceStore.setState({ stories: [], kanbanBoards: [] });
});

describe("tool.release_planner.throughput_forecast", () => {
  it("is a read action with a server handler", () => {
    const action = registry.get("tool.release_planner.throughput_forecast");
    expect(action?.category).toBe("read");
    expect(typeof action?.mcpHandler).toBe("function");
  });

  it("forecasts typed weeks the way the page does", async () => {
    const params = {
      weeklyThroughput: [4, 6, 3, 5, 0, 7, 4, 5],
      items: 30,
      startDate: "2026-11-16",
      targetDate: "2027-01-11",
      features: [
        { name: "Saved cards", items: 10 },
        { name: "Refunds", items: 20 },
      ],
    };
    const r = await run(params);
    expect(r.source).toBe("typed");
    expect(r.weeks[0]).toEqual({ label: "Week 1", value: 4 });
    const page = throughputForecast({
      samples: params.weeklyThroughput,
      items: 30,
      start: "2026-11-16",
      target: "2027-01-11",
      features: params.features,
    });
    expect(r.when).toEqual(page.when);
    expect(r.howMany).toEqual(page.howMany);
    expect(r.cutLine).toEqual(page.cutLine);
    expect(r.cutLine?.rows.map((x) => x.cumulative)).toEqual([10, 30]);
  });

  it("reads the Sprint board's complete weeks when nothing is typed", async () => {
    useWorkspaceStore.setState({
      stories: [
        doneStory("a", "2026-10-13"),
        doneStory("b", "2026-10-28"),
        doneStory("c", "2026-11-04"),
        doneStory("d", "2026-11-11"), // this week: not yet
        doneStory("example-x", "2026-11-04"),
      ],
    });
    const r = await run({ today: "2026-11-12", items: 5 });
    expect(r.source).toBe("sprint");
    expect(r.weeks.map((w) => w.value)).toEqual([1, 0, 1, 1]);
    expect(r.enough).toBe(true);
    expect(r.when?.items).toBe(5);
  });

  it("falls back to the Flow board, and says when history is short", async () => {
    useWorkspaceStore.setState({
      kanbanBoards: [
        {
          id: KANBAN_BOARD_ID,
          cards: [
            {
              id: "k1",
              title: "Card",
              column: "done",
              class: "standard",
              createdAt: "2026-11-02T09:00:00.000Z",
              startedAt: "2026-11-03T09:00:00.000Z",
              completedAt: "2026-11-04T09:00:00.000Z",
              columnSince: "2026-11-04T09:00:00.000Z",
            },
          ],
        } as never,
      ],
    });
    const r = await run({ today: "2026-11-12", items: 5 });
    expect(r.source).toBe("flow");
    expect(r.weeks).toEqual([{ label: "2026-W45", value: 1 }]);
    expect(r).toMatchObject({ enough: false, notEnough: "few-weeks", when: null });
  });

  it("refuses an impossible feature", async () => {
    const action = registry.get("tool.release_planner.throughput_forecast")!;
    expect(action.paramsSchema.safeParse({ features: [{ name: "X", items: 0 }] }).success).toBe(
      false
    );
    expect(action.paramsSchema.safeParse({ weeks: 10 }).success).toBe(false);
  });
});
