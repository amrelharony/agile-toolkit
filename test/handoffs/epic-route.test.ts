/**
 * The "epic" hand-off route (targets/epic): a send puts an epic on the Epic
 * Roadmap's one document (starting it when there is none), next quarter,
 * at add_epic's title cap, in the first colour no epic uses yet, keeping
 * its source and with no horizon; it is done once its linked stories are;
 * "Open" goes to that epic; remove and exists work on the document.
 */

import { beforeEach, describe, expect, it, vi, afterEach } from "vitest";
import { useWorkspaceStore } from "@/lib/stores/workspace-store";
import { epicHref, epicRoute } from "@/lib/handoffs/targets/epic";
import { EPIC_ROADMAP_ID, EPIC_TITLE_MAX } from "@/lib/roadmap/epic-source";
import { EPIC_COLORS } from "@/lib/roadmap/palette";
import { horizonOf } from "@/lib/roadmap/horizons";

const NOW = new Date("2026-11-23T12:00:00Z");
const doc = () =>
  (useWorkspaceStore.getState().epicRoadmaps ?? []).find((d) => d.id === EPIC_ROADMAP_ID);
const epicById = (id: string) => doc()?.epics.find((e) => e.id === id);

beforeEach(() => {
  vi.useFakeTimers({ toFake: ["Date"] });
  vi.setSystemTime(NOW);
  useWorkspaceStore.setState({ epicRoadmaps: [], stories: [] });
});
afterEach(() => vi.useRealTimers());

describe("the epic route", () => {
  it("is named for the roadmap and opens the epic", () => {
    expect(epicRoute).toMatchObject({
      id: "epic",
      label: "Epic on the roadmap",
      doneLabel: "Put on the roadmap",
      targetToolId: "epic-roadmap",
    });
    expect(epicRoute.targetHref("e 1")).toBe("/epic-roadmap?epic=e%201");
    expect(epicHref("x")).toBe("/epic-roadmap?epic=x");
  });

  it("starts the roadmap, puts the epic in next quarter and keeps its source", () => {
    const id = epicRoute.send({
      title: `  ${"t".repeat(EPIC_TITLE_MAX + 20)}`,
      description: "Shops refund without calling.",
      sourceRef: { tool: "impact-map", id: "d1", doc: "strategyMap_1" },
    });
    const e = epicById(id)!;
    expect(e.title).toHaveLength(EPIC_TITLE_MAX);
    expect(e).toMatchObject({
      startQuarter: "2027 Q1",
      endQuarter: "2027 Q1",
      progress: 0,
      color: EPIC_COLORS[0].key,
      sourceRef: { tool: "impact-map", id: "d1", doc: "strategyMap_1" },
    });
    expect(e).not.toHaveProperty("horizon");
    // Next quarter reads as Next on the board, from its quarters.
    expect(horizonOf({ epic: e, done: false }, NOW)).toEqual({ horizon: "next", from: "quarters" });
    expect(epicRoute.exists(id)).toBe(true);
  });

  it("adds beside the epics already there, in the next free colour", () => {
    useWorkspaceStore.setState({
      epicRoadmaps: [
        {
          id: EPIC_ROADMAP_ID,
          epics: [
            {
              id: "old",
              title: "Old",
              startQuarter: "2026 Q4",
              endQuarter: "2026 Q4",
              progress: 0,
              color: EPIC_COLORS[0].key,
            },
          ],
        },
      ],
    });
    const id = epicRoute.send({ title: "New", sourceRef: { tool: "strategy-tree", id: "n1" } });
    expect(doc()!.epics.map((e) => e.id)).toEqual(["old", id]);
    expect(epicById(id)!.color).toBe(EPIC_COLORS[1].key);
  });

  it("is done once every linked story is, and removes only its own epic", () => {
    const id = epicRoute.send({ title: "Refunds", sourceRef: { tool: "impact-map", id: "d1" } });
    expect(epicRoute.isDone?.(id)).toBe(false);
    useWorkspaceStore.setState({
      stories: [
        { id: "s1", title: "A", status: "done", epicId: id },
        { id: "s2", title: "B", status: "todo", epicId: id },
      ],
    });
    expect(epicRoute.isDone?.(id)).toBe(false);
    useWorkspaceStore.setState({
      stories: [
        { id: "s1", title: "A", status: "done", epicId: id },
        { id: "s2", title: "B", status: "done", epicId: id },
      ],
    });
    expect(epicRoute.isDone?.(id)).toBe(true);
    epicRoute.remove("nope");
    expect(epicRoute.exists(id)).toBe(true);
    epicRoute.remove(id);
    expect(epicRoute.exists(id)).toBe(false);
    expect(epicRoute.isDone?.(id)).toBe(false);
  });
});
