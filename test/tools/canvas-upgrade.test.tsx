import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { act, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { useWorkspaceStore } from "@/lib/stores/workspace-store";
import {
  STORY_MAP_ID,
  type Sprint,
  type Story,
  type StoryMap,
  type WhiteboardCard,
  type WhiteboardFrame,
  type WhiteboardKanbanFrame,
  type WhiteboardObject,
  type WhiteboardText,
} from "@/lib/stores/workspace-types";
import { isValidObject } from "@/lib/whiteboard/object-validator";
import { resetSelectedSprint } from "@/lib/sprints/use-selected-sprint";
import { exampleId } from "@/components/tool-frame/example-data";
import { EXAMPLE_SPRINT_PREFIX } from "@/lib/sprints/example";
import { cardFixture, stickyFixture } from "../canvas/object-fixtures";

/**
 * Canvas's live boards (the Phase 4 row: "sprint-board and story-map
 * templates bound to live Stories"): a Sprint board whose cards mirror a
 * sprint's stories by status and move them through setStoryStatus with
 * Undo, and a read-only Story map that mirrors the Story Mapper's map.
 * Covers the pure reconcile both ways, the guards the canvas's own edits go
 * through, the writer, the gallery's Live boards section and the hook that
 * keeps an open board in step.
 */

const toastSpy = vi.hoisted(() =>
  Object.assign(
    vi.fn<(message: unknown, opts?: unknown) => string>(() => "t"),
    {
      dismiss: vi.fn(),
      info: vi.fn(),
      error: vi.fn(),
      success: vi.fn(),
      warning: vi.fn(),
      message: vi.fn(),
    }
  )
);
const spies = vi.hoisted(() => ({ log: vi.fn(), mode: { value: "local" as string } }));
vi.mock("@/lib/utils/toast", () => ({ toast: toastSpy }));
vi.mock("@/lib/history/use-history-logger", () => ({
  useHistoryLogger: () => ({ log: spies.log, toolRunId: "test" }),
}));
vi.mock("@/lib/data/use-legacy-migration-mode", () => ({
  useLegacyMigrationMode: (found: boolean) => (found ? spies.mode.value : "off"),
}));

import {
  LIVE_TEXT_COLOR,
  keptLiveNote,
  liveContainerOf,
  liveDeletion,
  liveDrop,
  liveLockNote,
  livePlacement,
  mapCardCount,
  mirroredMap,
  newSprintBoard,
  newStoryMapBoard,
  reconcileLiveBoards,
  sprintBoardLabel,
  withoutLiveChildren,
  type LiveData,
  type LivePlan,
} from "@/app/(tools)/canvas/lib/live-boards";
import { moveSprintStories, writeLiveCardEdit } from "@/app/(tools)/canvas/lib/live-card-writer";
import { LIVE_RECONCILE_MS, useLiveBoards } from "@/app/(tools)/canvas/hooks/use-live-boards";
import { TemplateGallery } from "@/app/(tools)/canvas/components/template-gallery";
import { ObjectRenderer } from "@/app/(tools)/canvas/components/object-renderer";
import { CanvasModals } from "@/app/(tools)/canvas/components/canvas-modals";
import { useCanvasStore } from "@/app/(tools)/canvas/use-canvas-store";
import { syncEngine } from "@/lib/sync/engine";

const T0 = "2026-10-20T09:00:00.000Z";
const T1 = "2026-10-21T09:00:00.000Z";
const BOARD = "b1";
const C = "wb_c1";

const sprint = (patch: Partial<Sprint> = {}): Sprint => ({
  id: "s7",
  name: "Sprint 7",
  startDate: "2026-10-12",
  endDate: "2026-10-23",
  pointsPlanned: 20,
  status: "active",
  ...patch,
});

const story = (id: string, patch: Partial<Story> = {}): Story => ({
  id,
  title: `Story ${id}`,
  status: "todo",
  sprintId: "s7",
  ...patch,
});

const STORIES: Story[] = [
  story("a", { points: 3, owner: "Ada" }),
  story("b", { status: "backlog" }),
  story("c", { status: "in_progress" }),
  story("d", { status: "review" }),
  story("e", { status: "done", points: 5 }),
  story("f", { sprintId: "s8" }),
  story(exampleId("x")),
];

const data = (patch: Partial<LiveData> = {}): LiveData => ({
  stories: STORIES,
  sprints: [sprint()],
  storyMaps: [],
  ...patch,
});

const sprintBoard = (patch: Partial<WhiteboardKanbanFrame> = {}) => ({
  ...newSprintBoard({ id: C, boardId: BOARD, sprint: sprint(), x: 100, y: 100, z: 5, now: T0 }),
  ...patch,
});

/** `objects` with `plan` applied, as the store would hold them. */
function applied(objects: readonly WhiteboardObject[], plan: LivePlan): WhiteboardObject[] {
  const map = new Map(objects.map((o) => [o.id, o]));
  for (const o of plan.upsert) map.set(o.id, o);
  for (const id of plan.remove) map.delete(id);
  return Array.from(map.values());
}

/** Reconcile until nothing changes; returns the settled objects. */
function settle(objects: readonly WhiteboardObject[], d: LiveData = data()): WhiteboardObject[] {
  return applied(objects, reconcileLiveBoards(objects, d, T0));
}

const cardsOf = (objects: readonly WhiteboardObject[]) =>
  objects.filter((o): o is WhiteboardCard => o.type === "card" && o.id.startsWith(`${C}__`));
const byId = (objects: readonly WhiteboardObject[], id: string) =>
  objects.find((o) => o.id === id) as WhiteboardObject | undefined;

beforeEach(() => {
  useWorkspaceStore.getState().resetWorkspace();
  useCanvasStore.setState({
    drag: null,
    resize: null,
    rotation: null,
    marquee: null,
    drawing: null,
    editingObjectId: null,
  });
  resetSelectedSprint();
  try {
    window.localStorage.clear();
  } catch {
    /* no storage */
  }
  toastSpy.mockClear();
  toastSpy.info.mockClear();
  spies.log.mockClear();
  spies.mode.value = "local";
});

afterEach(() => {
  vi.restoreAllMocks();
});

/* ─── Sprint board reconcile ─────────────────────────────────────── */

describe("reconcileLiveBoards: Sprint board", () => {
  it("makes one card per sprint story, in stored order, by status column", () => {
    const plan = reconcileLiveBoards([sprintBoard()], data(), T0);
    const cards = cardsOf(plan.upsert);
    expect(cards.map((c) => c.id)).toEqual(["a", "b", "c", "d", "e"].map((id) => `${C}__${id}`));
    expect(cards.map((c) => c.status)).toEqual(["todo", "todo", "in_progress", "review", "done"]);
    const [a, b, c] = cards;
    // Column geometry is the drop handler's: w / 4 per column.
    expect(a).toMatchObject({ x: 112, y: 140, w: 236, h: 96, version: 1, z: 6 });
    // A backlog story waits in To do, under the first one.
    expect(b).toMatchObject({ x: 112, y: 246 });
    expect(c).toMatchObject({ x: 372, y: 140 });
    expect(a).toMatchObject({
      title: "Story a",
      points: 3,
      assignee: "Ada",
      sourceRef: { tool: "story", entityId: "a" },
      frameId: C,
      boardId: BOARD,
    });
    expect(a.locked).toBeUndefined();
    expect(plan.remove).toEqual([]);
    // Every write would pass the realtime validator.
    expect(plan.upsert.every((o) => isValidObject(o))).toBe(true);
  });

  it("is idempotent: a second run returns an empty plan", () => {
    const once = settle([sprintBoard()]);
    expect(reconcileLiveBoards(once, data(), T1)).toEqual({ upsert: [], remove: [] });
  });

  it("moves a card when its story moves, and follows title, points and owner", () => {
    const once = settle([sprintBoard()]);
    const moved = STORIES.map((s) =>
      s.id === "a"
        ? { ...s, status: "in_progress" as const, title: "Pay by card", points: 8, owner: "Bo" }
        : s
    );
    const plan = reconcileLiveBoards(once, data({ stories: moved }), T1);
    const a = plan.upsert.find((o) => o.id === `${C}__a`) as WhiteboardCard;
    expect(a).toMatchObject({
      status: "in_progress",
      title: "Pay by card",
      points: 8,
      assignee: "Bo",
      x: 372,
      // Stored order within a column: a comes before c.
      y: 140,
      version: 2,
      updatedAt: T1,
    });
    expect(plan.upsert.find((o) => o.id === `${C}__c`)).toMatchObject({ y: 246 });
    // b moves up into a's old slot in To do.
    expect(plan.upsert.find((o) => o.id === `${C}__b`)).toMatchObject({ y: 140 });
  });

  it("removes a card when its story leaves the sprint or is deleted", () => {
    const once = settle([sprintBoard()]);
    const next = STORIES.filter((s) => s.id !== "c").map((s) =>
      s.id === "a" ? { ...s, sprintId: undefined } : s
    );
    const plan = reconcileLiveBoards(once, data({ stories: next }), T1);
    expect(plan.remove.sort()).toEqual([`${C}__a`, `${C}__c`]);
  });

  it("locks a closed sprint's cards and says so on the board", () => {
    const closed = sprint({ status: "completed" });
    const plan = reconcileLiveBoards([sprintBoard()], data({ sprints: [closed] }), T0);
    expect(cardsOf(plan.upsert).every((c) => c.locked === true)).toBe(true);
    expect(byId(plan.upsert, C)).toMatchObject({ label: "Sprint board · Sprint 7 · read-only" });
    expect(sprintBoardLabel(sprint({ status: "cancelled" }))).toContain("read-only");
    expect(sprintBoardLabel(sprint())).toBe("Sprint board · Sprint 7");
  });

  it("puts back the columns and the minimum size after a preset or a shrink", () => {
    const once = settle([sprintBoard()]);
    const changed = once.map((o) =>
      o.id === C
        ? {
            ...(o as WhiteboardKanbanFrame),
            columns: ["todo", "doing", "done"],
            columnLabels: ["To do", "Doing", "Done"],
            w: 300,
            h: 50,
            version: 9,
          }
        : o
    );
    const plan = reconcileLiveBoards(changed, data(), T1);
    expect(byId(plan.upsert, C)).toMatchObject({
      columns: ["todo", "in_progress", "review", "done"],
      columnLabels: ["To do", "In progress", "Review", "Done"],
      w: 720,
      // Two cards in To do: 40 + 2 × 106 + 12.
      h: 264,
      version: 10,
    });
    // The cards follow the narrower columns (720 / 4 = 180).
    expect(byId(plan.upsert, `${C}__c`)).toMatchObject({ x: 292, w: 156 });
  });

  it("leaves a board whose sprint was deleted alone, and Undo re-adopts the same cards", () => {
    const once = settle([sprintBoard()]);
    // removeSprint: the container's link is cleared and its stories leave the sprint.
    const orphaned = once.map((o) =>
      o.id === C ? { ...o, sourceRef: undefined, version: o.version + 1 } : o
    );
    const unplanned = STORIES.map((s) => (s.sprintId === "s7" ? { ...s, sprintId: undefined } : s));
    expect(reconcileLiveBoards(orphaned, data({ stories: unplanned, sprints: [] }), T1)).toEqual({
      upsert: [],
      remove: [],
    });
    // Undo restores both; the cards are the board's again, with no duplicates.
    const restored = orphaned.map((o) =>
      o.id === C ? { ...o, sourceRef: sprintBoard().sourceRef } : o
    );
    expect(reconcileLiveBoards(restored, data(), T1)).toEqual({ upsert: [], remove: [] });
    expect(cardsOf(restored)).toHaveLength(5);
  });

  it("never touches pasted copies, other boards' objects or plain cards", () => {
    const once = settle([sprintBoard()]);
    const pasted = cardFixture({
      id: "wb_paste",
      boardId: BOARD,
      title: "Old copy",
      status: "todo",
      frameId: C,
      sourceRef: { tool: "story", entityId: "a" },
    });
    const plan = reconcileLiveBoards([...once, pasted], data(), T1);
    expect(plan).toEqual({ upsert: [], remove: [] });
  });

  it("drops a missing sprint's cards but keeps the frame", () => {
    const once = settle([sprintBoard()]);
    const plan = reconcileLiveBoards(once, data({ sprints: [] }), T1);
    expect(plan.remove).toHaveLength(5);
    expect(plan.upsert.find((o) => o.id === C)).toBeUndefined();
  });

  it("leaves example stories and example sprints out", () => {
    const plan = reconcileLiveBoards([sprintBoard()], data(), T0);
    expect(plan.upsert.some((o) => o.id.includes("example"))).toBe(false);
    const exampleSprint = sprint({ id: `${EXAMPLE_SPRINT_PREFIX}1` });
    const board = sprintBoard({ sourceRef: { tool: "sprint", entityId: exampleSprint.id } });
    const exampleStories = [story("z", { sprintId: exampleSprint.id })];
    const p2 = reconcileLiveBoards(
      [board],
      data({ sprints: [exampleSprint], stories: exampleStories }),
      T0
    );
    expect(cardsOf(p2.upsert)).toHaveLength(0);
  });

  it("handles no stories, 200 stories and an unknown status", () => {
    const empty = reconcileLiveBoards([sprintBoard()], data({ stories: [] }), T0);
    expect(cardsOf(empty.upsert)).toHaveLength(0);
    // Label already right, size already enough: nothing to write.
    expect(empty.upsert).toEqual([]);

    const many = Array.from({ length: 200 }, (_, i) => story(`m${i}`));
    const big = reconcileLiveBoards([sprintBoard()], data({ stories: many }), T0);
    expect(cardsOf(big.upsert)).toHaveLength(200);
    expect(byId(big.upsert, C)).toMatchObject({ h: 40 + 200 * 106 + 12 });
    expect(big.upsert.every((o) => isValidObject(o))).toBe(true);

    const odd = [story("q", { status: "blocked" as Story["status"] })];
    const p = reconcileLiveBoards([sprintBoard()], data({ stories: odd }), T0);
    expect(cardsOf(p.upsert)[0]).toMatchObject({ status: "todo", x: 112 });
  });

  it("keeps cards above their board when the board is brought forward", () => {
    const once = settle([sprintBoard()]);
    const raised = once.map((o) => (o.id === C ? { ...o, z: 50 } : o));
    const plan = reconcileLiveBoards(raised, data(), T1);
    expect(byId(plan.upsert, `${C}__a`)).toMatchObject({ z: 51 });
    expect(reconcileLiveBoards(applied(raised, plan), data(), T1).upsert).toEqual([]);
  });

  it("skips a card whose id would be over the realtime id cap", () => {
    // The story id fits the cap; the card's id (`wb_c1__` + it) doesn't.
    const longId = "s".repeat(195);
    const plan = reconcileLiveBoards([sprintBoard()], data({ stories: [story(longId)] }), T0);
    expect(cardsOf(plan.upsert)).toHaveLength(0);
  });

  it("keeps the user's own card fields (description, due, colour)", () => {
    const once = settle([sprintBoard()]);
    const decorated = once.map((o) =>
      o.id === `${C}__a` ? { ...o, description: "Notes", due: "2026-10-30", color: "#f00" } : o
    );
    expect(reconcileLiveBoards(decorated, data(), T1).upsert).toEqual([]);
  });
});

/* ─── Story map reconcile ────────────────────────────────────────── */

const MAP: StoryMap = {
  id: STORY_MAP_ID,
  steps: [
    { id: "st1", name: "Discover" },
    { id: "st2", name: "Buy" },
  ],
  slices: [
    {
      id: "sl1",
      name: "Walking skeleton",
      cards: {
        st1: [
          {
            id: "k1",
            title: "Browse",
            description: "",
            color: "#00f0ff",
            estimate: "3",
          },
          {
            id: "k2",
            title: "Search",
            description: "Find by name",
            color: "red; background:url(x)",
            sentTo: [{ route: "backlog-story", targetId: "c", at: T0 }],
          },
        ],
        st2: [{ id: "k3", title: "Pay", description: "", color: "#fff", estimate: "XL" }],
      },
    },
    { id: "sl2", name: "Later", cards: {} },
  ],
};
const M = "wb_m1";
const mapBoard = () =>
  newStoryMapBoard({ id: M, boardId: BOARD, x: 0, y: 0, z: 1, now: T0 }) as WhiteboardFrame;

describe("reconcileLiveBoards: Story map", () => {
  it("builds step headers, slice labels and locked cards", () => {
    const plan = reconcileLiveBoards([mapBoard()], data({ storyMaps: [MAP] }), T0);
    const texts = plan.upsert.filter((o): o is WhiteboardText => o.type === "text");
    expect(texts.map((t) => [t.id, t.content])).toEqual([
      [`${M}__step_st1`, "Discover"],
      [`${M}__step_st2`, "Buy"],
      [`${M}__slice_sl1`, "Walking skeleton · 3 pts · 1 unestimated · 1 custom"],
      [`${M}__slice_sl2`, "Later · No stories"],
    ]);
    expect(texts.every((t) => t.locked && t.color === LIVE_TEXT_COLOR)).toBe(true);
    const cards = plan.upsert.filter((o): o is WhiteboardCard => o.type === "card");
    expect(cards.map((c) => c.id)).toEqual([`${M}__card_k1`, `${M}__card_k2`, `${M}__card_k3`]);
    expect(cards.every((c) => c.locked === true && c.frameId === M)).toBe(true);
    const [k1, k2, k3] = cards;
    expect(k1).toMatchObject({
      points: 3,
      color: "#00f0ff",
      sourceRef: { tool: "story-mapper", entityId: "k1" },
      x: 172,
      y: 68,
    });
    expect(k1.status).toBeUndefined();
    expect(k1.description).toBeUndefined();
    // Sent to the backlog: the story's status and points; an unsafe colour is dropped.
    expect(k2).toMatchObject({
      status: "in_progress",
      sourceRef: { tool: "story", entityId: "c" },
      description: "Find by name",
      y: 156,
    });
    expect(k2.color).toBeUndefined();
    expect(k3.points).toBeUndefined(); // "XL" is a custom estimate, not points
    // Frame sized to the grid: 160 + 2 × 240 wide; 56 + (2 × 88 + 24) + 112 tall.
    expect(byId(plan.upsert, M)).toMatchObject({ w: 640, h: 56 + 200 + 112 });
    expect(plan.upsert.every((o) => isValidObject(o))).toBe(true);
    // Settled, it stays settled.
    expect(
      reconcileLiveBoards(applied([mapBoard()], plan), data({ storyMaps: [MAP] }), T1)
    ).toEqual({ upsert: [], remove: [] });
  });

  it("shows a backlog story's points over the map's estimate", () => {
    const stories = STORIES.map((s) => (s.id === "c" ? { ...s, points: 13 } : s));
    const plan = reconcileLiveBoards([mapBoard()], data({ storyMaps: [MAP], stories }), T0);
    expect(byId(plan.upsert, `${M}__card_k2`)).toMatchObject({ points: 13 });
  });

  it("removes a card that left the map, and everything when the map is gone", () => {
    const once = settle([mapBoard()], data({ storyMaps: [MAP] }));
    const fewer: StoryMap = {
      ...MAP,
      slices: [{ ...MAP.slices[0], cards: { st1: [MAP.slices[0].cards.st1[0]] } }, MAP.slices[1]],
    };
    const p1 = reconcileLiveBoards(once, data({ storyMaps: [fewer] }), T1);
    expect(p1.remove.sort()).toEqual([`${M}__card_k2`, `${M}__card_k3`]);
    const p2 = reconcileLiveBoards(once, data({ storyMaps: [] }), T1);
    expect(p2.remove).toHaveLength(once.length - 1);
  });

  it("mirrors the map without the Story Mapper's example cards", () => {
    const withExample: StoryMap = {
      id: STORY_MAP_ID,
      steps: [
        { id: exampleId("step"), name: "Example step" },
        { id: "own", name: "Own step" },
      ],
      slices: [
        {
          id: exampleId("slice"),
          name: "Example slice",
          cards: {
            [exampleId("step")]: [
              { id: exampleId("card"), title: "Example", description: "", color: "#fff" },
            ],
          },
        },
      ],
    };
    expect(mapCardCount(withExample)).toBe(0);
    expect(mirroredMap(withExample).steps.map((s) => s.id)).toEqual(["own"]);
    expect(mirroredMap(withExample).slices).toEqual([]);
    expect(mapCardCount(MAP)).toBe(3);
    expect(mapCardCount(undefined)).toBe(0);
  });

  it("copes with a map with no steps or slices", () => {
    const bare: StoryMap = { id: STORY_MAP_ID, steps: [], slices: [] };
    const plan = reconcileLiveBoards([mapBoard()], data({ storyMaps: [bare] }), T0);
    expect(plan.upsert).toEqual([]);
  });
});

/* ─── Guards and placement ───────────────────────────────────────── */

describe("live board guards", () => {
  it("finds a child's board, even when the board's own id has a separator", () => {
    const odd = sprintBoard({ id: "wb_ab__cd" });
    const child = cardFixture({ id: "wb_ab__cd__a", boardId: BOARD });
    const map = new Map<string, WhiteboardObject>([
      [odd.id, odd],
      [child.id, child],
    ]);
    expect(liveContainerOf(child.id, map)?.id).toBe("wb_ab__cd");
    const elsewhere = { ...child, boardId: "other" };
    expect(
      liveContainerOf(
        child.id,
        new Map<string, WhiteboardObject>([
          [odd.id, odd],
          [child.id, elsewhere],
        ])
      )
    ).toBeNull();
    expect(liveContainerOf("wb_plain", map)).toBeNull();
  });

  it("deletes a board with its cards, and keeps a lone card of a board that stays", () => {
    const once = settle([sprintBoard()]);
    const whole = liveDeletion([C], once);
    expect(whole.ids).toHaveLength(6);
    expect(whole.kept).toBe(0);
    const lone = liveDeletion([`${C}__a`, "other"], [...once, stickyFixture({ id: "other" })]);
    expect(lone).toEqual({ ids: ["other"], kept: 1, keptFrom: "sprint" });
    expect(keptLiveNote("sprint")).toContain("Sprint Planning");
    expect(keptLiveNote("story-map")).toContain("Story Mapper");
    const both = liveDeletion([`${C}__a`, C], once);
    expect(both.kept).toBe(0);
    expect(new Set(both.ids).size).toBe(6);
  });

  it("turns a drop in another column of its own board into a story move", () => {
    const once = settle([sprintBoard()]);
    const map = new Map(once.map((o) => [o.id, o]));
    const board = map.get(C);
    const a = map.get(`${C}__a`) as WhiteboardCard;
    // Dragged into the third column (Review): centre at x = 100 + 2.5 × 260.
    const toReview = { ...a, x: 100 + 2.5 * 260 - a.w / 2 };
    expect(liveDrop(toReview, board, map)).toEqual({
      move: { storyId: "a", status: "review" },
    });
    // Same column, another board, or nowhere: no move (the board puts it back).
    expect(liveDrop(a, board, map)).toEqual({ move: null });
    expect(liveDrop(toReview, sprintBoard({ id: "other" }), map)).toEqual({ move: null });
    expect(liveDrop(toReview, undefined, map)).toEqual({ move: null });
    // Past the right edge clamps to Done.
    expect(liveDrop({ ...a, x: 5000 }, board, map)?.move?.status).toBe("done");
    // A story map card never moves anything.
    const mapObjs = settle([mapBoard()], data({ storyMaps: [MAP] }));
    const mapById = new Map(mapObjs.map((o) => [o.id, o]));
    const k1 = mapById.get(`${M}__card_k1`) as WhiteboardCard;
    expect(liveDrop(k1, mapById.get(M), mapById)).toEqual({ move: null });
    // A plain card keeps the plain kanban drop.
    expect(liveDrop(cardFixture({ id: "plain" }), board, map)).toBeNull();
  });

  it("copies a board without its cards", () => {
    const once = settle([sprintBoard()]);
    expect(withoutLiveChildren(once).map((o) => o.id)).toEqual([C]);
    // A card copied on its own stays in the copy.
    const lone = once.filter((o) => o.id === `${C}__a`);
    expect(withoutLiveChildren(lone)).toHaveLength(1);
  });

  it("says why a live card can't be edited here", () => {
    expect(liveLockNote(mapBoard(), [])).toContain("Story Mapper");
    expect(liveLockNote(sprintBoard(), [sprint()])).toBeNull();
    expect(liveLockNote(sprintBoard(), [sprint({ status: "completed" })])).toContain("read-only");
  });

  it("places a new board to the right of the content", () => {
    expect(livePlacement([])).toEqual({ x: 80, y: 80 });
    const objs = [
      stickyFixture({ x: 0, y: 40, w: 200, h: 100 }),
      stickyFixture({ x: 500, y: -20, w: 100, h: 100 }),
      {
        ...stickyFixture(),
        type: "connector",
        x: 0,
        y: -999,
        w: 0,
        h: 0,
      } as unknown as WhiteboardObject,
    ];
    expect(livePlacement(objs)).toEqual({ x: 720, y: -20 });
  });
});

/* ─── Writer: moves and edits go to the story ────────────────────── */

function seedStore(stories: Story[] = STORIES, sprints: Sprint[] = [sprint()]) {
  const ws = useWorkspaceStore.getState();
  sprints.forEach((s) => ws.upsertSprint(s));
  stories.forEach((s) => ws.upsertStory(s));
}
const stored = (id: string) => useWorkspaceStore.getState().stories.find((s) => s.id === id);
/** The Undo action of the latest toast. */
function lastUndo(): () => void {
  const opts = toastSpy.mock.calls.at(-1)?.[1] as { action?: { onClick: () => void } } | undefined;
  if (!opts?.action) throw new Error("no Undo toast");
  return opts.action.onClick;
}

describe("moveSprintStories", () => {
  it("moves through setStoryStatus (stamps start and history), and Undo reverts", () => {
    seedStore();
    expect(moveSprintStories([{ storyId: "a", status: "review" }])).toBe(1);
    expect(stored("a")).toMatchObject({ status: "review" });
    expect(stored("a")?.startedAt).toBeTruthy();
    expect(stored("a")?.statusHistory?.at(-1)).toMatchObject({ status: "review", from: "todo" });
    expect(toastSpy.mock.calls.at(-1)?.[0]).toBe("Moved “Story a” to Review.");
    lastUndo()();
    expect(stored("a")?.status).toBe("todo");
    expect(stored("a")?.startedAt).toBeUndefined();
    expect(stored("a")?.statusHistory).toBeUndefined();
  });

  it("doesn't undo over a newer move", () => {
    seedStore();
    moveSprintStories([{ storyId: "a", status: "in_progress" }]);
    const undo = lastUndo();
    moveSprintStories([{ storyId: "a", status: "done" }]);
    undo();
    expect(stored("a")?.status).toBe("done");
  });

  it("moves several with one toast, and skips closed sprints, unknown and unmoved stories", () => {
    seedStore(
      [...STORIES, story("z", { sprintId: "s0" })],
      [sprint(), sprint({ id: "s0", status: "completed" })]
    );
    const n = moveSprintStories([
      { storyId: "a", status: "done" },
      { storyId: "b", status: "in_progress" },
      { storyId: "c", status: "in_progress" },
      { storyId: "z", status: "done" },
      { storyId: "nope", status: "done" },
    ]);
    expect(n).toBe(2);
    expect(toastSpy).toHaveBeenCalledTimes(1);
    expect(toastSpy.mock.calls[0][0]).toBe("Moved 2 stories.");
    expect(stored("z")?.status).toBe("todo");
    lastUndo()();
    expect(stored("a")?.status).toBe("todo");
    expect(stored("b")?.status).toBe("backlog");
    expect(moveSprintStories([])).toBe(0);
  });
});

describe("writeLiveCardEdit", () => {
  const liveCard = (id = "a") =>
    cardFixture({
      id: `${C}__${id}`,
      sourceRef: { tool: "story", entityId: id },
      title: `Story ${id}`,
    });

  it("routes title, points, assignee and status to the story", () => {
    seedStore();
    const patch = writeLiveCardEdit(liveCard(), {
      title: "  Checkout  ",
      points: 5,
      assignee: "Cy",
      status: "review",
      description: "card only",
    });
    expect(stored("a")).toMatchObject({
      title: "Checkout",
      points: 5,
      owner: "Cy",
      status: "review",
    });
    expect(patch).toEqual({
      title: "Checkout",
      points: 5,
      assignee: "Cy",
      status: "review",
      description: "card only",
    });
    // The move is undoable like a drag.
    lastUndo()();
    expect(stored("a")?.status).toBe("todo");
  });

  it("keeps the story's title when the new one is empty, and clears points and owner", () => {
    seedStore();
    const patch = writeLiveCardEdit(liveCard(), {
      title: "   ",
      points: undefined,
      assignee: undefined,
    });
    expect(toastSpy.info).toHaveBeenCalled();
    expect(stored("a")).toMatchObject({ title: "Story a" });
    expect(stored("a")?.points).toBeUndefined();
    expect(stored("a")?.owner).toBeUndefined();
    expect(patch).toEqual({ points: undefined, assignee: undefined });
  });

  it("ignores negative points and statuses that aren't story statuses", () => {
    seedStore();
    const patch = writeLiveCardEdit(liveCard(), { points: -1, status: "doing" });
    expect(stored("a")).toMatchObject({ points: 3, status: "todo" });
    expect(patch).toEqual({});
  });

  it("writes nothing to a closed sprint's story", () => {
    seedStore(STORIES, [sprint({ status: "completed" })]);
    const patch = writeLiveCardEdit(liveCard(), { title: "Renamed", color: "#0f0" });
    expect(stored("a")?.title).toBe("Story a");
    expect(toastSpy.info).toHaveBeenCalledWith(expect.stringContaining("read-only"));
    expect(patch).toEqual({ color: "#0f0" });
  });

  it("leaves the card alone when its story is gone", () => {
    seedStore([]);
    expect(writeLiveCardEdit(liveCard(), { title: "X", due: "2026-11-01" })).toEqual({
      due: "2026-11-01",
    });
  });
});

/* ─── The gallery's Live boards ─────────────────────────────────── */

const boardObjects = () =>
  (useWorkspaceStore.getState().whiteboardObjects ?? []).filter((o) => o.boardId === BOARD);

describe("TemplateGallery: Live boards", () => {
  it("says why each live board can't be added yet", () => {
    render(<TemplateGallery boardId={BOARD} onClose={() => {}} />);
    expect(screen.getByRole("heading", { name: "Live boards" })).toBeTruthy();
    expect(screen.getByText(/No sprints yet/)).toBeTruthy();
    expect(screen.getByRole("link", { name: /Plan one in Sprint Planning/ })).toHaveAttribute(
      "href",
      "/sprint-planning"
    );
    expect(screen.getByRole("button", { name: /Add sprint board/ })).toBeDisabled();
    expect(screen.getByText(/Your story map is empty/)).toBeTruthy();
    expect(screen.getByRole("link", { name: "Open Story Mapper" })).toHaveAttribute(
      "href",
      "/story-mapper"
    );
    expect(screen.getByRole("button", { name: /Add story map/ })).toBeDisabled();
  });

  it("notes a sprint with no stories yet, and a closed sprint's read-only board", () => {
    seedStore([], [sprint()]);
    const { unmount } = render(<TemplateGallery boardId={BOARD} onClose={() => {}} />);
    expect(screen.getByText(/No stories planned into Sprint 7 yet/)).toBeTruthy();
    expect(screen.getByRole("button", { name: /Add sprint board/ })).toBeEnabled();
    unmount();
    useWorkspaceStore.getState().resetWorkspace();
    seedStore([], [sprint({ status: "completed" })]);
    render(<TemplateGallery boardId={BOARD} onClose={() => {}} />);
    expect(screen.getByText(/Sprint 7 is completed, so its board is read-only/)).toBeTruthy();
  });

  it("adds a filled Sprint board beside the content, and Undo takes it away", () => {
    seedStore();
    useWorkspaceStore
      .getState()
      .upsertWhiteboardObjects([
        stickyFixture({ id: "s1", boardId: BOARD, x: 0, y: 40, w: 200, h: 100, z: 3 }),
      ]);
    const onClose = vi.fn();
    const onApplied = vi.fn();
    render(<TemplateGallery boardId={BOARD} onClose={onClose} onApplied={onApplied} />);
    expect(screen.getByText(/5 stories in Sprint 7/)).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: /Add sprint board/ }));

    const objs = boardObjects();
    const board = objs.find((o) => o.type === "kanban") as WhiteboardKanbanFrame;
    expect(board).toMatchObject({
      x: 320,
      y: 40,
      z: 4,
      version: 1,
      sourceRef: { tool: "sprint", entityId: "s7" },
    });
    expect(objs.filter((o) => o.id.startsWith(`${board.id}__`))).toHaveLength(5);
    expect(objs.every((o) => o.version === 1)).toBe(true);
    // Already settled: the hook will have nothing to do.
    expect(
      reconcileLiveBoards(objs, { ...useWorkspaceStore.getState(), storyMaps: [] }, T1).upsert
    ).toEqual([]);
    expect(onApplied).toHaveBeenCalledWith({ x: 320, y: 40, w: board.w, h: board.h });
    expect(onClose).toHaveBeenCalled();
    expect(toastSpy.mock.calls.at(-1)?.[0]).toBe("Added the Sprint 7 board");
    expect(spies.log).toHaveBeenCalledWith("template_applied", {
      template: "sprint-board",
      count: 6,
    });

    lastUndo()();
    expect(boardObjects().map((o) => o.id)).toEqual(["s1"]);
  });

  it("adds the Story map on an empty board at 80, 80", () => {
    useWorkspaceStore.getState().upsertStoryMap(MAP);
    seedStore();
    render(<TemplateGallery boardId={BOARD} onClose={() => {}} />);
    expect(screen.getByText("3 stories on your map.")).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: /Add story map/ }));
    const frame = boardObjects().find((o) => o.type === "frame") as WhiteboardFrame;
    expect(frame).toMatchObject({ x: 80, y: 80, label: "Story map", w: 640 });
    expect(boardObjects().filter((o) => o.id.startsWith(`${frame.id}__`))).toHaveLength(7);
  });

  it("hides live boards the search doesn't match", () => {
    render(<TemplateGallery boardId={BOARD} onClose={() => {}} />);
    fireEvent.change(screen.getByLabelText("Search templates"), { target: { value: "story map" } });
    expect(screen.queryByRole("button", { name: /Add sprint board/ })).toBeNull();
    expect(screen.getByRole("button", { name: /Add story map/ })).toBeTruthy();
    fireEvent.change(screen.getByLabelText("Search templates"), { target: { value: "zzz" } });
    expect(screen.queryByRole("heading", { name: "Live boards" })).toBeNull();
  });
});

describe("Story map frame", () => {
  it("links to Story Mapper, where the map is edited", () => {
    render(<ObjectRenderer object={mapBoard()} selected={false} />);
    expect(screen.getByRole("link", { name: "Edit in Story Mapper" })).toHaveAttribute(
      "href",
      "/story-mapper"
    );
  });

  it("shows no link on a plain frame", () => {
    render(<ObjectRenderer object={{ ...mapBoard(), sourceRef: undefined }} selected={false} />);
    expect(screen.queryByRole("link")).toBeNull();
  });
});

/* ─── Card details on a live card ────────────────────────────────── */

function renderCardDetails(cardDetailId: string, objects: readonly WhiteboardObject[]) {
  const setCardDetailId = vi.fn();
  const onPatchStyles = vi.fn();
  const noop = () => {};
  render(
    <CanvasModals
      showMiniMap={false}
      objects={objects}
      camera={{ x: 0, y: 0, zoom: 1 }}
      size={{ w: 800, h: 600 }}
      setCamera={noop}
      boardId={BOARD}
      selection={[]}
      showAIPanel={false}
      clusters={[]}
      insights={[]}
      setSelection={noop}
      setShowAIPanel={noop}
      onApplyAiStickies={noop}
      onApplyClusterSummary={noop}
      onApplyTextUpdates={noop}
      onApplyActionItems={noop}
      onApplyMindMapTree={noop}
      activeCommentThread={null}
      setActiveCommentThreadId={noop}
      cardDetailId={cardDetailId}
      setCardDetailId={setCardDetailId}
      objectsById={new Map(objects.map((o) => [o.id, o]))}
      onPatchStyles={onPatchStyles}
    />
  );
  return { setCardDetailId, onPatchStyles };
}

describe("Card details on a live card", () => {
  it("saves a Sprint board card's title to its story, and the rest to the card", () => {
    seedStore();
    const objects = settle([sprintBoard()]);
    const { onPatchStyles } = renderCardDetails(`${C}__a`, objects);
    expect(screen.getByText(/saved to the story/)).toBeTruthy();
    fireEvent.change(screen.getByLabelText("Title"), { target: { value: "Checkout" } });
    fireEvent.change(screen.getByLabelText("Description"), { target: { value: "Notes" } });
    fireEvent.click(screen.getByRole("button", { name: "Save" }));
    expect(stored("a")?.title).toBe("Checkout");
    expect(onPatchStyles).toHaveBeenCalledWith([
      { id: `${C}__a`, patch: { title: "Checkout", description: "Notes" } },
    ]);
  });

  it("keeps the story's title when the card's title is cleared", () => {
    seedStore();
    const objects = settle([sprintBoard()]);
    const { onPatchStyles } = renderCardDetails(`${C}__a`, objects);
    fireEvent.change(screen.getByLabelText("Title"), { target: { value: "  " } });
    fireEvent.click(screen.getByRole("button", { name: "Save" }));
    expect(stored("a")?.title).toBe("Story a");
    expect(toastSpy.info).toHaveBeenCalledWith(expect.stringContaining("keeps its old one"));
    expect(onPatchStyles).not.toHaveBeenCalled();
  });

  it("doesn't open a story map card: it says where the map is edited", () => {
    const objects = settle([mapBoard()], data({ storyMaps: [MAP] }));
    const { setCardDetailId } = renderCardDetails(`${M}__card_k1`, objects);
    expect(screen.queryByRole("dialog", { name: "Card details" })).toBeNull();
    expect(toastSpy.info).toHaveBeenCalledWith(expect.stringContaining("Story Mapper"));
    expect(setCardDetailId).toHaveBeenCalledWith(null);
  });

  it("doesn't open a closed sprint's card", () => {
    seedStore(STORIES, [sprint({ status: "completed" })]);
    const objects = settle([sprintBoard()], data({ sprints: [sprint({ status: "completed" })] }));
    renderCardDetails(`${C}__a`, objects);
    expect(screen.queryByRole("dialog", { name: "Card details" })).toBeNull();
    expect(toastSpy.info).toHaveBeenCalledWith(expect.stringContaining("read-only"));
  });
});

/* ─── The hook keeps an open board in step ───────────────────────── */

function Harness({ readOnly = false }: { readOnly?: boolean }) {
  const all = useWorkspaceStore((s) => s.whiteboardObjects);
  const objects = (all ?? []).filter((o) => o.boardId === BOARD);
  useLiveBoards({ boardId: BOARD, objects, readOnly });
  return null;
}

const wait = (ms: number) => act(() => new Promise<void>((r) => setTimeout(r, ms)));

describe("useLiveBoards", () => {
  it("fills a board once the workspace can be trusted, and follows story changes", async () => {
    seedStore();
    useWorkspaceStore.getState().upsertWhiteboardObjects([sprintBoard()]);
    render(<Harness />);
    await waitFor(() => expect(cardsOf(boardObjects())).toHaveLength(5));
    act(() => {
      useWorkspaceStore.getState().upsertStory({ ...stored("b")!, status: "done" });
    });
    await waitFor(() =>
      expect(byId(boardObjects(), `${C}__b`)).toMatchObject({ status: "done", x: 892 })
    );
  });

  it("waits out a drag and catches up when it ends", async () => {
    seedStore();
    useWorkspaceStore.getState().upsertWhiteboardObjects([sprintBoard()]);
    act(() => {
      useCanvasStore.setState({ drag: { startWorld: { x: 0, y: 0 }, initialRects: {} } });
    });
    render(<Harness />);
    await wait(LIVE_RECONCILE_MS * 2);
    expect(cardsOf(boardObjects())).toHaveLength(0);
    act(() => {
      useCanvasStore.setState({ drag: null });
    });
    await waitFor(() => expect(cardsOf(boardObjects())).toHaveLength(5));
  });

  it("never writes while waiting for the workspace, or in a read-only view", async () => {
    seedStore();
    useWorkspaceStore.getState().upsertWhiteboardObjects([sprintBoard()]);
    spies.mode.value = "wait";
    const { unmount } = render(<Harness />);
    await wait(LIVE_RECONCILE_MS * 2);
    expect(cardsOf(boardObjects())).toHaveLength(0);
    unmount();
    spies.mode.value = "local";
    render(<Harness readOnly />);
    await wait(LIVE_RECONCILE_MS * 2);
    expect(cardsOf(boardObjects())).toHaveLength(0);
  });

  it("for the owner, waits for the cloud's first pull", async () => {
    seedStore();
    useWorkspaceStore.getState().upsertWhiteboardObjects([sprintBoard()]);
    let release: () => void = () => {};
    vi.spyOn(syncEngine, "whenReady").mockReturnValue(
      new Promise<void>((r) => {
        release = r;
      })
    );
    spies.mode.value = "cloud";
    render(<Harness />);
    await wait(LIVE_RECONCILE_MS * 2);
    expect(cardsOf(boardObjects())).toHaveLength(0);
    await act(async () => release());
    await waitFor(() => expect(cardsOf(boardObjects())).toHaveLength(5));
  });
});
