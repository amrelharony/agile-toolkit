/**
 * Story.backlogRank is the decided rank a story was pulled in with. Every
 * Decide order renumbers the backlog items, so stories pulled under
 * different orders must read their item's rank as it is now; otherwise
 * Sprint Planning's backlog, "Fill to capacity", the agent's plan and
 * Refinement compare ranks from different orders.
 */

import { beforeEach, describe, expect, it, vi } from "vitest";

// The MCP path talks to the server store: an in-memory row per kind + id.
const rows = vi.hoisted(() => new Map<string, unknown>());
vi.mock("@/lib/actions/server-store", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/lib/actions/server-store")>();
  return {
    ...actual,
    serverGetEntity: vi.fn(async (_u: string, kind: string, id: string) => {
      return rows.get(`${kind}/${id}`) ?? null;
    }),
    serverUpsertEntity: vi.fn(async (_u: string, kind: string, entity: { id: string }) => {
      rows.set(`${kind}/${entity.id}`, entity);
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
import type { BacklogItem, Sprint, Story } from "@/lib/stores/workspace-types";
import {
  BACKLOG_SOURCE_TOOL,
  backlogByPriority,
  selectStoriesForCapacity,
  withLiveBacklogRank,
} from "@/lib/sprints/plan";
import { backlogStories, planFill } from "@/app/(tools)/sprint-planning/view";
import { refinementSession } from "@/app/(tools)/refinement/session";
import "@/lib/actions/intents/plan-sprint";

const ctx = () => ({ userId: "u", source: "agent" as const, squadProfileIds: [] as string[] });

const item = (id: string, rank?: number): BacklogItem => ({
  id,
  name: id.toUpperCase(),
  ...(rank !== undefined ? { rank } : {}),
});

/** A story pulled from backlog item `itemId`, with the rank it was pulled in with. */
const pulled = (
  id: string,
  itemId: string,
  backlogRank?: number,
  priorityScore?: number
): Story => ({
  id,
  title: id,
  status: "backlog",
  points: 3,
  sourceRef: { tool: BACKLOG_SOURCE_TOOL, id: itemId },
  ...(backlogRank !== undefined ? { backlogRank } : {}),
  ...(priorityScore !== undefined ? { priorityScore } : {}),
});

/*
 * Decide order saved A=1, B=2 and both were pulled. Later C and D were
 * added and a new order saved: C=1, D=2, A=3, B=4; C and D were pulled
 * then. A and B still hold the ranks of the first order.
 */
const ITEMS = [item("a", 3), item("b", 4), item("c", 1), item("d", 2)];
const STORIES: Story[] = [
  pulled("sa", "a", 1, 2),
  pulled("sb", "b", 2, 9),
  pulled("sc", "c", 1, 5),
  pulled("sd", "d", 2, 1),
];
const ids = (stories: readonly Story[]) => stories.map((s) => s.id);

describe("withLiveBacklogRank", () => {
  it("reads each pulled story's rank from its item as it is now", () => {
    const live = withLiveBacklogRank(STORIES, ITEMS);
    expect(live.map((s) => [s.id, s.backlogRank])).toEqual([
      ["sa", 3],
      ["sb", 4],
      ["sc", 1],
      ["sd", 2],
    ]);
    // The stored stories are never touched; an unchanged one isn't copied.
    expect(STORIES.map((s) => s.backlogRank)).toEqual([1, 2, 1, 2]);
    expect(live[2]).toBe(STORIES[2]);
  });

  it("drops the rank of an item now Not ordered yet, keeps a gone item's, and leaves typed stories", () => {
    const typed: Story = { id: "typed", title: "Typed", status: "backlog", backlogRank: 7 };
    const live = withLiveBacklogRank(
      [pulled("unranked", "a", 1), pulled("gone", "zz", 2), typed],
      [item("a")]
    );
    expect(live[0]).not.toHaveProperty("backlogRank");
    expect(live[1].backlogRank).toBe(2);
    expect(live[2]).toBe(typed);
    // No backlog items to read (not loaded, or the example): nothing changes.
    expect(withLiveBacklogRank(STORIES, undefined)).toEqual(STORIES);
    expect(withLiveBacklogRank(STORIES, [])).toEqual(STORIES);
  });
});

describe("the backlog order after a second Decide order", () => {
  it("lists Sprint Planning's backlog in the saved order C, D, A, B", () => {
    // Before: the snapshots read A(1), C(1), B(2), D(2), ties broken by score.
    expect(ids(backlogStories(STORIES, ITEMS))).toEqual(["sc", "sd", "sa", "sb"]);
    expect(backlogStories(STORIES, ITEMS).map((s) => s.backlogRank)).toEqual([1, 2, 3, 4]);
  });

  it("fills to capacity in that order", () => {
    // Room for two 3-point stories: C and D, never A or B ahead of them.
    const fill = planFill(backlogStories(STORIES, ITEMS), 6);
    expect(ids(fill.selected)).toEqual(["sc", "sd"]);
    expect(ids(fill.tooBig)).toEqual(["sa", "sb"]);
  });

  it("walks Refinement in that order", () => {
    const session = refinementSession(STORIES, ITEMS);
    expect(ids(session.toRefine)).toEqual(["sc", "sd", "sa", "sb"]);
  });

  it("is the shared comparator's order once ranks are live", () => {
    const live = withLiveBacklogRank(STORIES, ITEMS);
    expect(ids(backlogByPriority(live))).toEqual(["sc", "sd", "sa", "sb"]);
    expect(ids(selectStoriesForCapacity(live, 6).selected)).toEqual(["sc", "sd"]);
  });
});

describe("intent.plan_sprint", () => {
  const SPRINT: Sprint = {
    id: "s9",
    name: "Sprint 9",
    startDate: "2026-10-19",
    endDate: "2026-10-30",
    pointsPlanned: 0,
    status: "planned",
  };

  beforeEach(() => {
    rows.clear();
    useWorkspaceStore.setState({
      sprints: [SPRINT],
      stories: STORIES.map((s) => ({ ...s })),
      backlogItems: ITEMS,
    });
  });

  it("picks by the live decided rank and commits the stories as stored", async () => {
    const out = (await registry
      .get("intent.plan_sprint")!
      .handler({ sprintId: "s9", capacityPoints: 9, commit: true }, ctx())) as {
      selected: { id: string }[];
    };
    expect(out.selected.map((s) => s.id)).toEqual(["sc", "sd", "sa"]);
    const stored = useWorkspaceStore.getState().stories;
    // Written as stored, as the page's fill does: only the status and the sprint change.
    expect(stored.find((s) => s.id === "sa")).toMatchObject({
      sprintId: "s9",
      status: "todo",
      backlogRank: 1,
    });
    expect(stored.find((s) => s.id === "sb")?.sprintId).toBeUndefined();
  });

  it("does the same on the server, reading the user's backlog items", async () => {
    rows.set("workspace:sprint/s9", SPRINT);
    for (const s of STORIES) rows.set(`workspace:story/${s.id}`, { ...s });
    for (const b of ITEMS) rows.set(`workspace:backlogItem/${b.id}`, b);
    const out = (await registry.get("intent.plan_sprint")!.mcpHandler!(
      { sprintId: "s9", capacityPoints: 6, commit: true },
      ctx()
    )) as {
      selected: { id: string }[];
    };
    expect(out.selected.map((s) => s.id)).toEqual(["sc", "sd"]);
    expect(rows.get("workspace:story/sd")).toMatchObject({ sprintId: "s9", status: "todo" });
    expect((rows.get("workspace:story/sa") as Story).sprintId).toBeUndefined();
  });
});
