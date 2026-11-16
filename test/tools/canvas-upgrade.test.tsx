import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { act, fireEvent, render, renderHook, screen, waitFor } from "@testing-library/react";
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
  LIVE_LOCK_NOTE,
  LIVE_OFF_BOARD_NOTE,
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
import {
  LIVE_RECONCILE_MS,
  applyLivePlan,
  useLiveBoards,
} from "@/app/(tools)/canvas/hooks/use-live-boards";
import { useCanvasShortcuts } from "@/app/(tools)/canvas/hooks/use-canvas-shortcuts";
import { useCanvasPointerMachine } from "@/app/(tools)/canvas/hooks/use-canvas-pointer-machine";
import { useObjectInteractions } from "@/app/(tools)/canvas/hooks/use-object-interactions";
import {
  pushBoardSnapshot,
  useCanvasUndoStack,
  type CanvasUndoEffect,
} from "@/app/(tools)/canvas/use-undo-stack";
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

/** A connector from `fromId` to `toId` on the board. */
const connector = (id: string, fromId: string, toId: string): WhiteboardObject => ({
  id,
  boardId: BOARD,
  type: "connector",
  x: 0,
  y: 0,
  w: 0,
  h: 0,
  z: 2,
  fromId,
  toId,
  fromAnchor: "auto",
  toAnchor: "auto",
  routing: "orthogonal",
  stroke: "#94a3b8",
  strokeWidth: 2,
  version: 1,
  createdAt: T0,
  updatedAt: T0,
});

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
  it("makes one card per sprint story, in id order, by status column", () => {
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
      // Id order within a column: a comes before c.
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

  it("leaves a board alone while its sprint isn't in the list, instead of emptying it", () => {
    // A sprint deleted on another device arrives before the board's
    // cleared link does (or hasn't been pulled yet): nothing is removed.
    const once = settle([sprintBoard()]);
    expect(reconcileLiveBoards(once, data({ sprints: [] }), T1)).toEqual({
      upsert: [],
      remove: [],
    });
    // Even with its stories gone too, and comments on its cards.
    const plan = reconcileLiveBoards(
      once,
      data({ sprints: [], stories: [], threads: [{ objectId: `${C}__a` }] }),
      T1
    );
    expect(plan).toEqual({ upsert: [], remove: [] });
  });

  it("lays a sprint out the same whatever order the device holds its stories in", () => {
    // The device that made the stories holds them in the order it made
    // them; another pulls them in the cloud's id order. Both must lay the
    // board out alike, or each rewrites the other's rows for as long as
    // both have it open.
    const own = [story("q2"), story("a7"), story("m1", { status: "done" }), story("b3")];
    const pulled = [...own].sort((x, y) => (x.id < y.id ? -1 : 1));
    const reversed = [...own].reverse();
    const p1 = reconcileLiveBoards([sprintBoard()], data({ stories: own }), T0);
    const p2 = reconcileLiveBoards([sprintBoard()], data({ stories: pulled }), T0);
    const p3 = reconcileLiveBoards([sprintBoard()], data({ stories: reversed }), T0);
    expect(p2).toEqual(p1);
    expect(p3).toEqual(p1);
    // Settled on one device, the other has nothing to write.
    const settledHere = settle([sprintBoard()], data({ stories: own }));
    expect(reconcileLiveBoards(settledHere, data({ stories: reversed }), T1)).toEqual({
      upsert: [],
      remove: [],
    });
    // Rows in To do follow the ids: a7, b3, q2.
    const ys = ["a7", "b3", "q2"].map((id) => byId(p1.upsert, `${C}__${id}`)?.y);
    expect(ys).toEqual([140, 246, 352]);
  });

  it("keeps an annotated card whose story left the sprint, as a plain card beside the board", () => {
    const once = settle([sprintBoard()]);
    const sticky = stickyFixture({ id: "wb_note", boardId: BOARD });
    const wire = connector("wb_wire", "wb_note", `${C}__c`);
    const decorated = [
      ...once.map((o) =>
        o.id === `${C}__a` ? { ...o, description: "Agreed with legal", tags: ["risk"] } : o
      ),
      sticky,
      wire,
    ];
    // a (notes), b (a pinned comment), c (a connector) and d (nothing) all
    // leave the sprint.
    const left = STORIES.map((s) =>
      ["a", "b", "c", "d"].includes(s.id) ? { ...s, sprintId: undefined } : s
    );
    const plan = reconcileLiveBoards(
      decorated,
      data({ stories: left, threads: [{ objectId: `${C}__b` }, { objectId: undefined }] }),
      T1
    );
    expect(plan.remove.sort()).toEqual(["a", "b", "c", "d"].map((id) => `${C}__${id}`));
    const copies = plan.upsert.filter((o) => o.id.startsWith("kept_"));
    expect(copies).toHaveLength(3);
    const copyOf = (id: string) =>
      copies.find((o) => o.type === "card" && o.title === `Story ${id}`) as WhiteboardCard;
    // A plain card: no link, no frame, never claimed by a board again.
    for (const k of copies) {
      expect(k.id).not.toContain("__");
      expect(k.sourceRef).toBeUndefined();
      expect(k.frameId).toBeUndefined();
      expect(k.locked).toBeUndefined();
      expect(k.version).toBe(1);
      expect(k.x).toBe(100 + 1040 + 24);
      expect(isValidObject(k)).toBe(true);
    }
    expect(copyOf("a")).toMatchObject({ description: "Agreed with legal", tags: ["risk"] });
    expect(plan.rehome).toEqual([{ from: `${C}__b`, to: copyOf("b").id }]);
    // The connector now ends on the copy, so removing the card keeps it.
    expect(byId(plan.upsert, "wb_wire")).toMatchObject({
      fromId: "wb_note",
      toId: copyOf("c").id,
      version: 2,
    });
    // Settled: the copies are left alone, and the same copy comes out on
    // every device (made from the card, not from the clock).
    const after = applied(decorated, plan);
    expect(
      reconcileLiveBoards(
        after,
        data({ stories: left, threads: [{ objectId: copyOf("b").id }] }),
        T1
      )
    ).toEqual({ upsert: [], remove: [] });
    const again = reconcileLiveBoards(
      decorated,
      data({ stories: left, threads: [{ objectId: `${C}__b` }] }),
      "2026-10-22T09:00:00.000Z"
    );
    expect(again.upsert.filter((o) => o.id.startsWith("kept_")).map((o) => o.id)).toEqual(
      copies.map((o) => o.id)
    );
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
    // No colour of their own: they take the canvas's themed text colour.
    expect(texts.every((t) => t.locked && t.color === undefined)).toBe(true);
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

  it("clears the fixed slate colour an earlier build gave its headers, once", () => {
    const once = settle([mapBoard()], data({ storyMaps: [MAP] }));
    // Saved by the first build: #64748b failed 4.5:1 on every canvas theme.
    const old = once.map((o) => (o.type === "text" ? { ...o, color: "#64748b" } : o));
    const plan = reconcileLiveBoards(old, data({ storyMaps: [MAP] }), T1);
    const texts = plan.upsert.filter((o): o is WhiteboardText => o.type === "text");
    expect(texts).toHaveLength(4);
    expect(texts.every((t) => t.color === undefined && t.version === 2)).toBe(true);
    expect(plan.upsert.every((o) => isValidObject(o))).toBe(true);
    // Run twice: nothing more to do.
    expect(reconcileLiveBoards(applied(old, plan), data({ storyMaps: [MAP] }), T1)).toEqual({
      upsert: [],
      remove: [],
    });
  });

  it("keeps a name given to the Story map board", () => {
    const once = settle([mapBoard()], data({ storyMaps: [MAP] }));
    const renamed = once.map((o) => (o.id === M ? { ...o, label: "Checkout map" } : o));
    expect(reconcileLiveBoards(renamed, data({ storyMaps: [MAP] }), T1)).toEqual({
      upsert: [],
      remove: [],
    });
    // Nor when the map is gone and the board empties.
    const gone = reconcileLiveBoards(renamed, data({ storyMaps: [] }), T1);
    expect(byId(gone.upsert, M)).toBeUndefined();
  });

  it("keeps a story map card with a comment on it when the card leaves the map", () => {
    const once = settle([mapBoard()], data({ storyMaps: [MAP] }));
    const fewer: StoryMap = {
      ...MAP,
      slices: [{ ...MAP.slices[0], cards: { st1: [MAP.slices[0].cards.st1[0]] } }, MAP.slices[1]],
    };
    const plan = reconcileLiveBoards(
      once,
      data({ storyMaps: [fewer], threads: [{ objectId: `${M}__card_k3` }] }),
      T1
    );
    expect(plan.remove.sort()).toEqual([`${M}__card_k2`, `${M}__card_k3`]);
    const copy = plan.upsert.find((o) => o.id.startsWith("kept_")) as WhiteboardCard;
    // A plain, unlocked card the user can now move or delete.
    expect(copy).toMatchObject({ title: "Pay", locked: undefined, sourceRef: undefined });
    expect(plan.rehome).toEqual([{ from: `${M}__card_k3`, to: copy.id }]);
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
    // Same column: no move (the board puts it back). Another board, or
    // nowhere: no move either, and the note says why it went back.
    expect(liveDrop(a, board, map)).toEqual({ move: null });
    expect(liveDrop(toReview, sprintBoard({ id: "other" }), map)).toEqual({
      move: null,
      note: LIVE_OFF_BOARD_NOTE,
    });
    expect(liveDrop(toReview, undefined, map)).toEqual({ move: null, note: LIVE_OFF_BOARD_NOTE });
    // Carried along with its own board, it wasn't dropped anywhere.
    const ctx = { stories: STORIES, sprints: [sprint()], dragged: new Set([C, a.id]) };
    expect(liveDrop(toReview, undefined, map, ctx)).toEqual({ move: null });
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

  it("moves a story card from elsewhere only by the board's rules, and never adopts it", () => {
    const once = settle([sprintBoard()]);
    const map = new Map(once.map((o) => [o.id, o]));
    const board = map.get(C);
    // An imported story card (not one of the board's), over Review.
    const imported = (entityId: string, tool = "story") =>
      cardFixture({
        id: "wb_imported",
        boardId: BOARD,
        x: 100 + 2.5 * 260 - 100,
        sourceRef: { tool, entityId },
      });
    const ctx = { stories: STORIES, sprints: [sprint()] };
    expect(liveDrop(imported("a"), board, map, ctx)).toEqual({
      move: { storyId: "a", status: "review" },
    });
    expect(liveDrop(imported("a", "backlog"), board, map, ctx)?.move?.status).toBe("review");
    // Its story is already in Review: nothing to move.
    expect(liveDrop(imported("d"), board, map, ctx)).toEqual({ move: null });
    // A story planned into another sprint, or gone: refused, with why.
    expect(liveDrop(imported("f"), board, map, ctx)?.note).toBe(
      "“Story f” isn't planned into Sprint 7, so it can't go on its board. Plan it in from Sprint Planning."
    );
    expect(liveDrop(imported("gone"), board, map, ctx)?.move).toBeNull();
    // A closed sprint's board takes no moves at all.
    const closed = { stories: STORIES, sprints: [sprint({ status: "completed" })] };
    expect(liveDrop(imported("a"), board, map, closed)?.note).toContain("read-only");
    // A plain kanban, a plain card, or no context: the plain kanban drop.
    expect(liveDrop(imported("a"), cardFixture({ id: "k" }), map, ctx)).toBeNull();
    expect(liveDrop(cardFixture({ id: "plain" }), board, map, ctx)).toBeNull();
    expect(liveDrop(imported("a"), board, map)).toBeNull();
  });

  it("copies a board without its cards, and a card without its board as a plain card", () => {
    const once = settle([sprintBoard()]);
    expect(withoutLiveChildren(once).map((o) => o.id)).toEqual([C]);
    // A card copied on its own (its board looked up on the whole board):
    // in the copy, but unlinked, so it can't move the story.
    const lone = once.filter((o) => o.id === `${C}__a`);
    const [copy] = withoutLiveChildren(lone, once);
    expect(copy).toMatchObject({ id: `${C}__a`, title: "Story a", status: "todo" });
    expect(copy.sourceRef).toBeUndefined();
    expect(copy.frameId).toBeUndefined();
    expect(copy.locked).toBeUndefined();
    // A locked story map card, too.
    const mapObjs = settle([mapBoard()], data({ storyMaps: [MAP] }));
    const k1 = mapObjs.filter((o) => o.id === `${M}__card_k1`);
    expect(withoutLiveChildren(k1, mapObjs)[0].locked).toBeUndefined();
    // Plain objects are copied as they are.
    const sticky = stickyFixture({ id: "s" });
    expect(withoutLiveChildren([sticky], [...once, sticky])).toEqual([sticky]);
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
    expect(moveSprintStories([{ storyId: "a", status: "review" }])).not.toBeNull();
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
    const effect = moveSprintStories([
      { storyId: "a", status: "done" },
      { storyId: "b", status: "in_progress" },
      { storyId: "c", status: "in_progress" },
      { storyId: "z", status: "done" },
      { storyId: "nope", status: "done" },
    ]);
    expect(effect).not.toBeNull();
    expect(toastSpy).toHaveBeenCalledTimes(1);
    expect(toastSpy.mock.calls[0][0]).toBe("Moved 2 stories.");
    expect(stored("z")?.status).toBe("todo");
    lastUndo()();
    expect(stored("a")?.status).toBe("todo");
    expect(stored("b")?.status).toBe("backlog");
    expect(moveSprintStories([])).toBeNull();
    expect(moveSprintStories([{ storyId: "c", status: "in_progress" }])).toBeNull();
  });

  it("hands Cmd+Z the same Undo, and a Redo, and the two Undos never stack", () => {
    seedStore();
    const effect = moveSprintStories([{ storyId: "a", status: "review" }])!;
    effect.undo();
    expect(stored("a")?.status).toBe("todo");
    // The toast's Undo after Cmd+Z's: nothing left to undo.
    lastUndo()();
    expect(stored("a")?.status).toBe("todo");
    effect.redo();
    expect(stored("a")?.status).toBe("review");
    expect(stored("a")?.statusHistory?.at(-1)).toMatchObject({ status: "review", from: "todo" });
    // A redo never drags back a story moved since the undo.
    effect.undo();
    useWorkspaceStore.getState().upsertStory({ ...stored("a")!, status: "done" });
    effect.redo();
    expect(stored("a")?.status).toBe("done");
  });
});

describe("writeLiveCardEdit", () => {
  const liveCard = (id = "a") =>
    cardFixture({
      id: `${C}__${id}`,
      sourceRef: { tool: "story", entityId: id },
      title: `Story ${id}`,
    });

  it("routes title, points, assignee and status to the story, under one Undo", () => {
    seedStore();
    const { patch, effect } = writeLiveCardEdit(liveCard(), {
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
    expect(effect).not.toBeNull();
    // One toast, named for the story as it now reads.
    expect(toastSpy).toHaveBeenCalledTimes(1);
    expect(toastSpy.mock.calls[0][0]).toBe("Moved “Checkout” to Review.");
    // Undo puts the move and the fields back.
    lastUndo()();
    expect(stored("a")).toMatchObject({
      title: "Story a",
      points: 3,
      owner: "Ada",
      status: "todo",
    });
  });

  it("undoes a rename (toast or Cmd+Z), redoes it, and never over a newer edit", () => {
    seedStore();
    const { effect } = writeLiveCardEdit(liveCard(), { title: "Checkout", points: undefined });
    expect(toastSpy.mock.calls.at(-1)?.[0]).toBe("Updated the story “Checkout”.");
    expect(stored("a")?.points).toBeUndefined();
    const stamp = stored("a")?.refinedAt;
    expect(stamp).toEqual(expect.any(String));
    effect!.undo();
    expect(stored("a")).toMatchObject({ title: "Story a", points: 3 });
    // Not refined any more: the Undo takes the edit's stamp back too.
    expect(stored("a")).not.toHaveProperty("refinedAt");
    // The toast's Undo after Cmd+Z's changes nothing more.
    lastUndo()();
    expect(stored("a")).toMatchObject({ title: "Story a", points: 3 });
    effect!.redo();
    expect(stored("a")?.title).toBe("Checkout");
    expect(stored("a")?.points).toBeUndefined();
    expect(stored("a")?.refinedAt).toBe(stamp);
    // Someone renames it again: Undo keeps their title, puts the points back.
    useWorkspaceStore.getState().upsertStory({ ...stored("a")!, title: "Pay by card" });
    effect!.undo();
    expect(stored("a")).toMatchObject({ title: "Pay by card", points: 3 });
  });

  it("keeps the story's title when the new one is empty, and clears points and owner", () => {
    seedStore();
    const { patch } = writeLiveCardEdit(liveCard(), {
      title: "   ",
      points: undefined,
      assignee: undefined,
    });
    expect(toastSpy.info).toHaveBeenCalled();
    expect(stored("a")).toMatchObject({ title: "Story a" });
    expect(stored("a")?.points).toBeUndefined();
    expect(stored("a")?.owner).toBeUndefined();
    expect(patch).toEqual({ points: undefined, assignee: undefined });
    lastUndo()();
    expect(stored("a")).toMatchObject({ points: 3, owner: "Ada" });
  });

  it("ignores negative points and statuses that aren't story statuses", () => {
    seedStore();
    const edit = writeLiveCardEdit(liveCard(), { points: -1, status: "doing" });
    expect(stored("a")).toMatchObject({ points: 3, status: "todo" });
    expect(edit).toEqual({ patch: {}, effect: null });
    expect(toastSpy).not.toHaveBeenCalled();
  });

  it("writes nothing to a closed sprint's story", () => {
    seedStore(STORIES, [sprint({ status: "completed" })]);
    const edit = writeLiveCardEdit(liveCard(), { title: "Renamed", color: "#0f0" });
    expect(stored("a")?.title).toBe("Story a");
    expect(toastSpy.info).toHaveBeenCalledWith(expect.stringContaining("read-only"));
    expect(edit).toEqual({ patch: { color: "#0f0" }, effect: null });
  });

  it("leaves the card alone when its story is gone", () => {
    seedStore([]);
    expect(writeLiveCardEdit(liveCard(), { title: "X", due: "2026-11-01" })).toEqual({
      patch: { due: "2026-11-01" },
      effect: null,
    });
  });
});

/* ─── Cmd+Z: the canvas's undo takes the story's side back too ───── */

describe("useCanvasUndoStack with story writes", () => {
  const effectSpy = (): CanvasUndoEffect & { calls: string[] } => {
    const calls: string[] = [];
    return { calls, undo: () => calls.push("undo"), redo: () => calls.push("redo") };
  };

  it("undoes and redoes a change made elsewhere, alone or with a snapshot", () => {
    useWorkspaceStore
      .getState()
      .upsertWhiteboardObjects([stickyFixture({ id: "s1", boardId: BOARD })]);
    const { result } = renderHook(() => useCanvasUndoStack(BOARD));
    const moved = effectSpy();
    const renamed = effectSpy();
    act(() => result.current.pushSnapshot(renamed));
    act(() => {
      useWorkspaceStore
        .getState()
        .upsertWhiteboardObjects([stickyFixture({ id: "s1", boardId: BOARD, x: 500, version: 2 })]);
    });
    act(() => result.current.pushUndoEffect(moved));
    // Newest first: the move (nothing on the board to restore), then the
    // rename with the board as it was.
    act(() => result.current.undo());
    expect(moved.calls).toEqual(["undo"]);
    expect(byId(boardObjects(), "s1")?.x).toBe(500);
    act(() => result.current.undo());
    expect(renamed.calls).toEqual(["undo"]);
    expect(byId(boardObjects(), "s1")?.x).toBe(100);
    act(() => result.current.redo());
    expect(renamed.calls).toEqual(["undo", "redo"]);
    expect(byId(boardObjects(), "s1")?.x).toBe(500);
    act(() => result.current.redo());
    expect(moved.calls).toEqual(["undo", "redo"]);
    expect(result.current.canRedo()).toBe(false);
  });

  it("never folds a step with a change elsewhere into the one before", () => {
    const { result } = renderHook(() => useCanvasUndoStack(BOARD));
    const first = effectSpy();
    act(() => result.current.pushSnapshot());
    // Same board, nothing changed in between: still a step of its own.
    act(() => result.current.pushSnapshot(first));
    act(() => result.current.pushSnapshot());
    act(() => result.current.undo());
    act(() => result.current.undo());
    expect(first.calls).toEqual(["undo"]);
  });

  it("lets the template gallery record a step on the open board", () => {
    useWorkspaceStore
      .getState()
      .upsertWhiteboardObjects([stickyFixture({ id: "s1", boardId: BOARD })]);
    const { result, unmount } = renderHook(() => useCanvasUndoStack(BOARD));
    // An edit on the canvas, with its step.
    act(() => result.current.pushSnapshot());
    act(() => {
      useWorkspaceStore
        .getState()
        .upsertWhiteboardObjects([stickyFixture({ id: "s1", boardId: BOARD, x: 500, version: 2 })]);
    });
    // Then something added from outside the canvas.
    act(() => pushBoardSnapshot(BOARD));
    act(() => {
      useWorkspaceStore
        .getState()
        .upsertWhiteboardObjects([stickyFixture({ id: "s2", boardId: BOARD })]);
    });
    act(() => result.current.undo());
    // Only the addition goes; the earlier edit stays.
    expect(boardObjects().map((o) => o.id)).toEqual(["s1"]);
    expect(byId(boardObjects(), "s1")?.x).toBe(500);
    // A board that isn't open records nothing (and doesn't throw).
    unmount();
    expect(() => pushBoardSnapshot(BOARD)).not.toThrow();
    expect(() => pushBoardSnapshot("closed")).not.toThrow();
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
    expect(screen.getByText("No templates match your search.")).toBeTruthy();
  });

  it("says nothing matches only when no live board matches either", () => {
    render(<TemplateGallery boardId={BOARD} onClose={() => {}} />);
    // No built-in template is about sprint boards; the live one is.
    fireEvent.change(screen.getByLabelText("Search templates"), {
      target: { value: "sprint board" },
    });
    expect(screen.getByRole("button", { name: /Add sprint board/ })).toBeTruthy();
    expect(screen.queryByText("No templates match your search.")).toBeNull();
    // The Planning category holds the live boards too.
    fireEvent.change(screen.getByLabelText("Search templates"), { target: { value: "" } });
    fireEvent.change(screen.getByLabelText("Filter by category"), {
      target: { value: "planning" },
    });
    expect(screen.getByRole("heading", { name: "Live boards" })).toBeTruthy();
    expect(screen.queryByText("No templates match your search.")).toBeNull();
  });

  it("only asks for a second click on the static templates", () => {
    useWorkspaceStore.getState().upsertWhiteboardObjects([stickyFixture({ boardId: BOARD })]);
    render(<TemplateGallery boardId={BOARD} onClose={() => {}} />);
    expect(screen.getByText(/a template asks for a second click/)).toBeTruthy();
    expect(screen.getByText(/Live boards go beside your content, with Undo/)).toBeTruthy();
  });

  it("applies a saved template holding a Sprint board with one card per story", () => {
    seedStore();
    // Saved by the earlier build, cards and all; a board saved now leaves
    // them out (Save as template takes the board through withoutLiveChildren).
    const saved = settle([sprintBoard()]).map((o) => ({ ...o, boardId: "" }));
    expect(withoutLiveChildren(saved).map((o) => o.id)).toEqual([C]);
    useWorkspaceStore.getState().upsertWhiteboardSavedTemplate({
      id: "wbt_1",
      name: "Our sprint wall",
      objects: saved,
      createdAt: T0,
    });
    render(<TemplateGallery boardId={BOARD} onClose={() => {}} />);
    fireEvent.click(screen.getByRole("button", { name: /Our sprint wall/ }));
    const applied1 = boardObjects();
    // Only the board: it fills itself from the sprint.
    expect(applied1).toHaveLength(1);
    expect(applied1[0]).toMatchObject({ type: "kanban", sourceRef: { tool: "sprint" } });
    const filled = settle(applied1);
    const cards = filled.filter((o) => o.type === "card");
    expect(cards).toHaveLength(5);
    expect(cards.every((o) => o.id.startsWith(`${applied1[0].id}__`))).toBe(true);
  });

  it("records a canvas undo step, so Cmd+Z takes away only the new board", () => {
    seedStore();
    useWorkspaceStore
      .getState()
      .upsertWhiteboardObjects([stickyFixture({ id: "s1", boardId: BOARD })]);
    const undoRef: { current: (() => void) | null } = { current: null };
    function Canvas() {
      const { pushSnapshot, undo } = useCanvasUndoStack(BOARD);
      undoRef.current = undo;
      // An earlier edit on the canvas, with its own step.
      return (
        <button
          type="button"
          onClick={() => {
            pushSnapshot();
            useWorkspaceStore
              .getState()
              .upsertWhiteboardObjects([
                stickyFixture({ id: "s1", boardId: BOARD, x: 400, version: 2 }),
              ]);
          }}
        >
          Edit
        </button>
      );
    }
    render(
      <>
        <Canvas />
        <TemplateGallery boardId={BOARD} onClose={() => {}} />
      </>
    );
    fireEvent.click(screen.getByRole("button", { name: "Edit" }));
    fireEvent.click(screen.getByRole("button", { name: /Add sprint board/ }));
    expect(boardObjects().length).toBeGreaterThan(1);
    act(() => undoRef.current?.());
    expect(boardObjects().map((o) => o.id)).toEqual(["s1"]);
    expect(byId(boardObjects(), "s1")?.x).toBe(400);
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
    // With how Cmd+Z takes the story's title back along with the card.
    expect(onPatchStyles).toHaveBeenCalledWith(
      [{ id: `${C}__a`, patch: { title: "Checkout", description: "Notes" } }],
      expect.objectContaining({ undo: expect.any(Function), redo: expect.any(Function) })
    );
    const effect = onPatchStyles.mock.calls[0][1] as CanvasUndoEffect;
    effect.undo();
    expect(stored("a")?.title).toBe("Story a");
  });

  it("won't save an empty title: it says so under Title and keeps the form open", () => {
    seedStore();
    const objects = settle([sprintBoard()]);
    const { onPatchStyles, setCardDetailId } = renderCardDetails(`${C}__a`, objects);
    const title = screen.getByLabelText("Title");
    fireEvent.change(title, { target: { value: "  " } });
    fireEvent.change(screen.getByLabelText("Description"), { target: { value: "Notes" } });
    fireEvent.click(screen.getByRole("button", { name: "Save" }));
    // Nothing is saved, to the story or the card.
    expect(stored("a")?.title).toBe("Story a");
    expect(onPatchStyles).not.toHaveBeenCalled();
    expect(setCardDetailId).not.toHaveBeenCalled();
    expect(screen.getByRole("dialog", { name: "Card details" })).toBeTruthy();
    const error = screen.getByRole("alert");
    expect(error.textContent).toContain("A story needs a title");
    expect(title).toHaveAttribute("aria-invalid", "true");
    expect(title.getAttribute("aria-describedby")).toBe(error.id);
    expect(document.activeElement).toBe(title);
    // Typing clears it, and Save goes through.
    fireEvent.change(title, { target: { value: "Checkout" } });
    expect(screen.queryByRole("alert")).toBeNull();
    fireEvent.click(screen.getByRole("button", { name: "Save" }));
    expect(stored("a")?.title).toBe("Checkout");
    expect(setCardDetailId).toHaveBeenCalledWith(null);
  });

  it("offers a Sprint board card only its board's columns as statuses", () => {
    seedStore([...STORIES, story("w", { status: "blocked" as Story["status"] })]);
    const objects = settle([sprintBoard()]);
    renderCardDetails(`${C}__b`, objects);
    const select = screen.getByLabelText("Status") as HTMLSelectElement;
    expect(Array.from(select.options).map((o) => [o.value, o.text])).toEqual([
      ["todo", "To do"],
      ["in_progress", "In progress"],
      ["review", "Review"],
      ["done", "Done"],
    ]);
    // A backlog story waits in To do, and To do is what the form shows.
    expect(select.value).toBe("todo");
    fireEvent.change(select, { target: { value: "review" } });
    fireEvent.click(screen.getByRole("button", { name: "Save" }));
    expect(stored("b")?.status).toBe("review");
    expect(toastSpy.mock.calls.at(-1)?.[0]).toBe("Moved “Story b” to Review.");
  });

  it("keeps the open status list on a plain card", () => {
    const plain = cardFixture({ id: "plain", boardId: BOARD });
    renderCardDetails("plain", [plain]);
    const select = screen.getByLabelText("Status") as HTMLSelectElement;
    expect(select.options[0].text).toBe("— none —");
    expect(Array.from(select.options).map((o) => o.value)).toContain("backlog");
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

  it("moves a comment to the kept copy when its card's story leaves the sprint", async () => {
    seedStore();
    const ws = useWorkspaceStore.getState();
    ws.upsertWhiteboardObjects(settle([sprintBoard()]));
    ws.upsertWhiteboardCommentThread({
      id: "th1",
      boardId: BOARD,
      objectId: `${C}__a`,
      x: 0,
      y: 0,
      comments: [{ id: "cm1", author: "Ada", text: "Check with legal", at: T0 }],
    });
    render(<Harness />);
    act(() => {
      useWorkspaceStore.getState().upsertStory({ ...stored("a")!, sprintId: undefined });
    });
    await waitFor(() => expect(byId(boardObjects(), `${C}__a`)).toBeUndefined());
    const copy = boardObjects().find((o) => o.id.startsWith("kept_"));
    expect(copy).toMatchObject({ type: "card", title: "Story a" });
    const threads = useWorkspaceStore.getState().whiteboardCommentThreads ?? [];
    expect(threads).toHaveLength(1);
    expect(threads[0]).toMatchObject({ id: "th1", objectId: copy?.id });
  });
});

describe("applyLivePlan", () => {
  it("re-pins threads before the remove, which would delete them", () => {
    const ws = useWorkspaceStore.getState();
    ws.upsertWhiteboardObjects([cardFixture({ id: "old", boardId: BOARD })]);
    ws.upsertWhiteboardCommentThread({
      id: "th1",
      boardId: BOARD,
      objectId: "old",
      x: 0,
      y: 0,
      comments: [],
    });
    ws.upsertWhiteboardCommentThread({ id: "th2", boardId: BOARD, x: 0, y: 0, comments: [] });
    applyLivePlan({
      upsert: [cardFixture({ id: "new", boardId: BOARD })],
      remove: ["old"],
      rehome: [{ from: "old", to: "new" }],
    });
    expect(boardObjects().map((o) => o.id)).toEqual(["new"]);
    const threads = useWorkspaceStore.getState().whiteboardCommentThreads ?? [];
    expect(threads.map((t) => [t.id, t.objectId])).toEqual([
      ["th1", "new"],
      ["th2", undefined],
    ]);
  });
});

/* ─── Shortcuts on live cards ─────────────────────────────────────── */

function renderShortcuts(selection: string[]) {
  const objects = boardObjects();
  const upsertMany = vi.fn();
  const pushSnapshot = vi.fn();
  const noop = () => {};
  renderHook(() =>
    useCanvasShortcuts({
      objectsRef: { current: objects },
      objectsByIdRef: { current: new Map(objects.map((o) => [o.id, o])) },
      topZRef: { current: 100 },
      lassoRafRef: { current: null },
      lassoPointsRef: { current: null },
      lastLassoWorldRef: { current: null },
      wetInkApiRef: { current: null },
      drag: null,
      resize: null,
      rotation: null,
      marquee: null,
      drawing: null,
      pendingConnectorFromId: null,
      selection,
      setSelection: noop,
      clearSelection: noop,
      setDrag: noop,
      setResize: noop,
      setRotation: noop,
      setMarquee: noop,
      setDrawing: noop,
      setPendingConnectorFromId: noop,
      setTool: noop,
      boardId: BOARD,
      removeMany: noop,
      upsertMany,
      pushSnapshot,
      undo: noop,
      redo: noop,
      log: vi.fn(),
      logActivity: noop,
      readOnly: false,
      viewportRef: { current: document.body },
      zoomActions: { zoomIn: noop, zoomOut: noop, resetZoom: noop, fitToContent: noop },
    })
  );
  return { upsertMany, pushSnapshot };
}

describe("canvas shortcuts on live cards", () => {
  it("won't lock a live card on its own, and says why", () => {
    useWorkspaceStore
      .getState()
      .upsertWhiteboardObjects([
        ...settle([sprintBoard()]),
        stickyFixture({ id: "s1", boardId: BOARD }),
      ]);
    const { upsertMany } = renderShortcuts([`${C}__a`, "s1"]);
    fireEvent.keyDown(window, { key: "l", ctrlKey: true });
    expect(toastSpy.info).toHaveBeenCalledWith(LIVE_LOCK_NOTE);
    // The sticky still locks.
    expect(upsertMany).toHaveBeenCalledTimes(1);
    expect(upsertMany.mock.calls[0][0].map((o: WhiteboardObject) => [o.id, o.locked])).toEqual([
      ["s1", true],
    ]);
  });

  it("copies nothing twice: a board's cards stay out when the board is duplicated too", () => {
    useWorkspaceStore.getState().upsertWhiteboardObjects(settle([sprintBoard()]));
    const { upsertMany } = renderShortcuts([C, `${C}__a`]);
    fireEvent.keyDown(window, { key: "d", ctrlKey: true });
    const dup = upsertMany.mock.calls[0][0] as WhiteboardObject[];
    expect(dup.map((o) => o.type)).toEqual(["kanban"]);
  });

  it("duplicates a lone live card as a plain card", () => {
    useWorkspaceStore.getState().upsertWhiteboardObjects(settle([sprintBoard()]));
    const { upsertMany } = renderShortcuts([`${C}__a`]);
    fireEvent.keyDown(window, { key: "d", ctrlKey: true });
    expect(upsertMany).toHaveBeenCalledTimes(1);
    const [dup] = upsertMany.mock.calls[0][0] as WhiteboardCard[];
    expect(dup.id).not.toContain("__");
    expect(dup).toMatchObject({ type: "card", title: "Story a" });
    expect(dup.sourceRef).toBeUndefined();
    expect(dup.frameId).toBeUndefined();
  });
});

/* ─── Drags: the drop, and the undo steps around it ──────────────── */

/** Ends a drag of `ids` (already at their dropped positions in `objects`). */
function dropDrag(objects: readonly WhiteboardObject[], ids: string[]) {
  const upsertMany = vi.fn();
  const pushUndoEffect = vi.fn();
  const noop = () => {};
  const initialRects = Object.fromEntries(ids.map((id) => [id, { x: 0, y: 0, w: 1, h: 1 }]));
  const { result } = renderHook(() =>
    useCanvasPointerMachine({
      boardId: BOARD,
      readOnly: false,
      canComment: false,
      camera: { x: 0, y: 0, zoom: 1 },
      tool: "select",
      stickyColor: "#ffd166",
      snapToGridEnabled: false,
      snapToObjectsEnabled: false,
      pendingConnectorFromId: null,
      drag: { startWorld: { x: 0, y: 0 }, initialRects },
      resize: null,
      rotation: null,
      marquee: null,
      drawing: null,
      setMarquee: noop,
      setDrawing: noop,
      setDrag: noop,
      setResize: noop,
      setRotation: noop,
      setPendingConnectorFromId: noop,
      setDragGuides: noop,
      setEditingObjectId: noop,
      setTool: noop,
      selection: ids,
      setSelection: noop,
      clearSelection: noop,
      objects,
      objectsById: new Map(objects.map((o) => [o.id, o])),
      upsert: noop,
      upsertMany,
      upsertCommentThread: noop,
      viewportRef: { current: null },
      viewportRectRef: { current: null },
      spaceHeldRef: { current: false },
      topZRef: { current: 100 },
      dragGuidesRef: { current: [] },
      anyPenActiveRef: { current: new Set<number>() },
      wetInkApiRef: { current: null },
      throttledSetCamera: noop,
      clientToWorld: (x, y) => ({ x, y }),
      publish: noop,
      setPreviewCursor: noop,
      setActiveCommentThreadId: noop,
      addObjectAt: noop,
      pushSnapshot: noop,
      pushUndoEffect,
      log: vi.fn(),
      logActivity: noop,
    })
  );
  act(() =>
    result.current.onCanvasPointerUp({ pointerId: 1 } as React.PointerEvent<HTMLDivElement>)
  );
  return { upsertMany, pushUndoEffect };
}

/** The settled Sprint board with `id` moved so its centre is at `cx`. */
const withCardAt = (id: string, cx: number, extra: WhiteboardObject[] = []) =>
  [...settle([sprintBoard()]), ...extra].map((o) => (o.id === id ? { ...o, x: cx - o.w / 2 } : o));

describe("dropping cards on a Sprint board", () => {
  it("moves the story, and records the move as a Cmd+Z step", () => {
    seedStore();
    const { pushUndoEffect, upsertMany } = dropDrag(withCardAt(`${C}__a`, 100 + 2.5 * 260), [
      `${C}__a`,
    ]);
    expect(stored("a")?.status).toBe("review");
    expect(pushUndoEffect).toHaveBeenCalledTimes(1);
    // The card itself isn't written: the board lays it out from the story.
    expect(upsertMany).not.toHaveBeenCalled();
    (pushUndoEffect.mock.calls[0][0] as CanvasUndoEffect).undo();
    expect(stored("a")?.status).toBe("todo");
  });

  it("says why a card dropped off its board goes back", () => {
    seedStore();
    const { pushUndoEffect } = dropDrag(withCardAt(`${C}__a`, 5000), [`${C}__a`]);
    expect(toastSpy.info).toHaveBeenCalledWith(LIVE_OFF_BOARD_NOTE);
    expect(stored("a")?.status).toBe("todo");
    expect(pushUndoEffect).not.toHaveBeenCalled();
  });

  it("refuses a story card from another sprint, and never adopts it", () => {
    seedStore();
    const imported = cardFixture({
      id: "wb_imported",
      boardId: BOARD,
      z: 50,
      sourceRef: { tool: "story", entityId: "f" },
    });
    const { upsertMany } = dropDrag(withCardAt("wb_imported", 100 + 3.5 * 260, [imported]), [
      "wb_imported",
    ]);
    expect(toastSpy.info).toHaveBeenCalledWith(expect.stringContaining("isn't planned into"));
    expect(stored("f")?.status).toBe("todo");
    // Not given the board as its frame, nor a status.
    expect(upsertMany).not.toHaveBeenCalled();
  });

  it("keeps the plain kanban drop for a plain card", () => {
    seedStore();
    const plain = cardFixture({ id: "wb_plain", boardId: BOARD, z: 50 });
    const { upsertMany } = dropDrag(withCardAt("wb_plain", 100 + 3.5 * 260, [plain]), ["wb_plain"]);
    expect(upsertMany).toHaveBeenCalledWith([
      expect.objectContaining({ id: "wb_plain", status: "done", frameId: C }),
    ]);
  });
});

function renderInteractions(objects: readonly WhiteboardObject[]) {
  const pushSnapshot = vi.fn();
  const upsert = vi.fn();
  const noop = () => {};
  const { result } = renderHook(() =>
    useObjectInteractions({
      boardId: BOARD,
      objects,
      objectsById: new Map(objects.map((o) => [o.id, o])),
      upsert,
      upsertMany: noop,
      tool: "select",
      setTool: noop,
      selection: [],
      setSelection: noop,
      toggleSelection: noop,
      pendingConnectorFromId: null,
      setPendingConnectorFromId: noop,
      setDrag: noop,
      setMarquee: noop,
      setResize: noop,
      setRotation: noop,
      setEditingObjectId: noop,
      viewportRef: { current: null },
      dragSnapIndexRef: { current: null },
      topZRef: { current: 100 },
      clientToWorld: (x, y) => ({ x, y }),
      pushSnapshot,
      log: vi.fn(),
      logActivity: noop,
      readOnly: false,
    })
  );
  return { result, pushSnapshot, upsert };
}

const pointerDown = { stopPropagation: () => {}, clientX: 0, clientY: 0, pointerId: 1 };

describe("undo steps for live cards", () => {
  it("records no step for dragging live cards alone, and one for anything else", () => {
    seedStore();
    const objects = [...settle([sprintBoard()]), stickyFixture({ id: "s1", boardId: BOARD })];
    const { result, pushSnapshot } = renderInteractions(objects);
    act(() => result.current.onObjectPointerDown(pointerDown as React.PointerEvent, `${C}__a`));
    expect(pushSnapshot).not.toHaveBeenCalled();
    act(() => result.current.onObjectPointerDown(pointerDown as React.PointerEvent, "s1"));
    expect(pushSnapshot).toHaveBeenCalledTimes(1);
    // The board itself (its cards come along): a step.
    act(() => result.current.onObjectPointerDown(pointerDown as React.PointerEvent, C));
    expect(pushSnapshot).toHaveBeenCalledTimes(2);
  });

  it("gives a renamed card's step the story's side, so Cmd+Z takes both back", () => {
    seedStore();
    const objects = settle([sprintBoard()]);
    const { result, pushSnapshot, upsert } = renderInteractions(objects);
    act(() => result.current.onCommitObjectEdit(`${C}__a`, "Checkout"));
    expect(stored("a")?.title).toBe("Checkout");
    expect(upsert).toHaveBeenCalledWith(expect.objectContaining({ title: "Checkout" }));
    const effect = pushSnapshot.mock.calls[0][0] as CanvasUndoEffect;
    effect.undo();
    expect(stored("a")?.title).toBe("Story a");
    effect.redo();
    expect(stored("a")?.title).toBe("Checkout");
  });

  it("passes a card details edit's story side on with its snapshot", () => {
    const objects = [stickyFixture({ id: "s1", boardId: BOARD })];
    const { result, pushSnapshot } = renderInteractions(objects);
    const effect = { undo: vi.fn(), redo: vi.fn() };
    act(() => result.current.onPatchStyles([{ id: "s1", patch: { x: 5 } }], effect));
    expect(pushSnapshot).toHaveBeenCalledWith(effect);
  });
});
