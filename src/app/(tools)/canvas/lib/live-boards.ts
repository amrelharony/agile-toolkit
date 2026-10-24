/**
 * Live boards: Canvas templates that mirror the team's sprint and story map
 * instead of copying them once. A live board is a container whose
 * `sourceRef` names what it mirrors:
 *
 *   - a Sprint board is a kanban with `{tool: "sprint", entityId: sprintId}`:
 *     one card per story planned into that sprint, in its status column.
 *     Moving or editing a card writes the story (./live-card-writer);
 *   - a Story map is a frame with `{tool: "story-mapper", entityId:
 *     STORY_MAP_ID}`: the Story Mapper's steps, slices and cards, locked,
 *     because the map is edited in Story Mapper.
 *
 * A container's children have ids made from its own (`${containerId}__…`),
 * so every device and every run builds the same objects, and a pasted or
 * duplicated copy (fresh random ids) is never mistaken for one.
 * `reconcileLiveBoards` compares what the workspace says with what is on the
 * board and returns only the writes that close the gap. The board is derived
 * from state rather than from change signals, so it catches up on stories
 * planned in, moved or removed while the canvas was closed.
 *
 * Pure: hooks/use-live-boards applies the plan, the template gallery seeds a
 * new board with it, and the tests check both directions.
 */

import { isExampleId } from "@/components/tool-frame/example-data";
import { findLink } from "@/lib/handoffs/registry";
import { isExampleSprintId } from "@/lib/sprints/example";
import { isStoryStatus } from "@/lib/sprints/story-status";
import { STORY_MAP_ID } from "@/lib/stores/workspace-types";
import type {
  Sprint,
  Story,
  StoryStatus,
  StoryMap,
  StoryMapSlice,
  StoryMapStep,
  WhiteboardCard,
  WhiteboardCommentThread,
  WhiteboardFrame,
  WhiteboardKanbanFrame,
  WhiteboardObject,
  WhiteboardText,
} from "@/lib/stores/workspace-types";
import { estimatePoints, sliceCards, sliceTotals } from "@/lib/story-map/points";
import { wbId } from "@/lib/whiteboard/clipboard";
import {
  MAX_COLOR_LEN,
  MAX_ID_LEN,
  MAX_SHORT_LEN,
  MAX_TEXT_LEN,
  MAX_TITLE_LEN,
  SAFE_CSS_COLOR_RE,
  isValidObject,
} from "@/lib/whiteboard/object-validator";
import {
  SPRINT_COLUMNS,
  closedBoardNote,
  isClosedSprint,
  sprintColumnOf,
} from "../../kanban/sprint-view";
import { sliceSummary } from "../../story-mapper/estimate";
import {
  SPRINT_BOARD_TOOL,
  STORY_MAP_TOOL,
  isLiveContainer,
  isSprintBoard,
  isStoryMapBoard,
  liveChildId,
  liveChildrenOf,
  liveContainerOf,
  type LiveContainer,
} from "./live-board-ids";

export * from "./live-board-ids";

// Sprint board geometry. The columns split the frame's width evenly, as the
// kanban drop does (use-canvas-pointer-machine), so a card is laid out in
// the column a drop there would give it.
const SPRINT_COL_W = 260;
const SPRINT_MIN_COL_W = 180;
const SPRINT_BOARD_H = 420;
/** Room above the cards for the kanban's column labels. */
const SPRINT_HEADER_H = 40;
const SPRINT_ROW = 106;
const SPRINT_CARD_H = 96;
const PAD = 12;

// Story map geometry: a gutter of slice labels, then one column per step.
const MAP_GUTTER = 160;
const MAP_STEP_W = 240;
const MAP_HEADER_H = 56;
const MAP_CARD_H = 80;
const MAP_CARD_GAP = 8;
const MAP_ROW_PAD = 24;

/* ─── New containers ──────────────────────────────────────────────── */

/** "Sprint board · Sprint 7", marked read-only once the sprint is closed. */
export function sprintBoardLabel(sprint: Pick<Sprint, "name" | "status">): string {
  const label = `Sprint board · ${sprint.name}`;
  return isClosedSprint(sprint) ? `${label} · read-only` : label;
}

interface NewBoardArgs {
  boardId: string;
  x: number;
  y: number;
  z: number;
  now: string;
  /** Defaults to a fresh object id. */
  id?: string;
}

/** An empty Sprint board for `sprint`; reconcile fills in its cards. */
export function newSprintBoard({
  boardId,
  sprint,
  x,
  y,
  z,
  now,
  id = wbId("wb"),
}: NewBoardArgs & { sprint: Sprint }): WhiteboardKanbanFrame {
  return {
    id,
    boardId,
    type: "kanban",
    x,
    y,
    w: SPRINT_COLUMNS.length * SPRINT_COL_W,
    h: SPRINT_BOARD_H,
    z,
    label: sprintBoardLabel(sprint),
    columns: SPRINT_COLUMNS.map((c) => c.id),
    columnLabels: SPRINT_COLUMNS.map((c) => c.label),
    sourceRef: { tool: SPRINT_BOARD_TOOL, entityId: sprint.id },
    version: 1,
    createdAt: now,
    updatedAt: now,
  };
}

/** An empty Story map frame; reconcile fills in the map and sizes the frame to it. */
export function newStoryMapBoard({
  boardId,
  x,
  y,
  z,
  now,
  id = wbId("wb"),
}: NewBoardArgs): WhiteboardFrame {
  return {
    id,
    boardId,
    type: "frame",
    x,
    y,
    w: MAP_GUTTER + MAP_STEP_W,
    h: MAP_HEADER_H + mapRowHeight(1),
    z,
    label: "Story map",
    sourceRef: { tool: STORY_MAP_TOOL, entityId: STORY_MAP_ID },
    version: 1,
    createdAt: now,
    updatedAt: now,
  };
}

/**
 * Where a new live board goes: to the right of everything on the board, top
 * aligned with it, so it never lands on someone's work (no "click again to
 * append" step). An empty board starts at 80, 80.
 */
export function livePlacement(objects: readonly WhiteboardObject[]): { x: number; y: number } {
  let right = -Infinity;
  let top = Infinity;
  for (const o of objects) {
    // A connector's box is a placeholder (0, 0, 0, 0): its ends are objects.
    if (o.type === "connector") continue;
    right = Math.max(right, o.x, o.x + o.w);
    top = Math.min(top, o.y, o.y + o.h);
  }
  if (!Number.isFinite(right) || !Number.isFinite(top)) return { x: 80, y: 80 };
  return { x: Math.round(right + 120), y: Math.round(top) };
}

/* ─── What a live board shows ─────────────────────────────────────── */

/** The sprint a Sprint board mirrors, if it still exists (never an example preview sprint). */
export function sprintOf(
  board: WhiteboardKanbanFrame,
  sprints: readonly Sprint[]
): Sprint | undefined {
  const id = board.sourceRef?.entityId;
  if (!id || isExampleSprintId(id)) return undefined;
  return sprints.find((s) => s.id === id);
}

/**
 * The sprint's own stories, by id: example stories never reach a real
 * board. Not in stored order, which differs between devices (a device
 * holds its own stories in the order it made them, pulled ones in the
 * cloud's id order): two devices with the board open would each lay the
 * cards out their way and rewrite each other's rows for as long as both
 * stay open. Compared by code unit, not `localeCompare`, which depends on
 * the device's locale too.
 */
export function sprintStories(sprintId: string, stories: readonly Story[]): Story[] {
  return stories
    .filter((s) => s.sprintId === sprintId && !isExampleId(s.id))
    .sort((a, b) => (a.id < b.id ? -1 : a.id > b.id ? 1 : 0));
}

/**
 * The map as the canvas mirrors it: without the Story Mapper's example
 * cards, and without an example step or slice that holds none of the
 * user's cards (the rule of Story Mapper's "Clear example"), so the example
 * map never shows as the team's.
 */
export function mirroredMap(map: Pick<StoryMap, "steps" | "slices">): {
  steps: StoryMapStep[];
  slices: StoryMapSlice[];
} {
  const own = (map.slices ?? []).map((sl) => {
    const cards: StoryMapSlice["cards"] = {};
    for (const [stepId, list] of Object.entries(sl.cards ?? {})) {
      cards[stepId] = (list ?? []).filter((c) => !isExampleId(c.id));
    }
    return { ...sl, cards };
  });
  const steps = (map.steps ?? []).filter(
    (st) => !isExampleId(st.id) || own.some((sl) => (sl.cards[st.id] ?? []).length > 0)
  );
  const slices = own.filter(
    (sl) => !isExampleId(sl.id) || steps.some((st) => (sl.cards[st.id] ?? []).length > 0)
  );
  return { steps, slices };
}

/** The story map document, if one is saved. */
export function storyMapDoc(storyMaps: readonly StoryMap[] | undefined, id = STORY_MAP_ID) {
  return (storyMaps ?? []).find((m) => m.id === id);
}

/** How many of the user's own cards the map shows (0 for no map). */
export function mapCardCount(map: Pick<StoryMap, "steps" | "slices"> | undefined): number {
  if (!map) return 0;
  const { steps, slices } = mirroredMap(map);
  return slices.reduce((n, sl) => n + sliceCards(sl, steps).length, 0);
}

/* ─── Reconcile ───────────────────────────────────────────────────── */

export interface LiveData {
  stories: readonly Story[];
  sprints: readonly Sprint[];
  storyMaps: readonly StoryMap[];
  /** The board's comment threads: a card with one pinned to it is kept, not removed. */
  threads?: readonly Pick<WhiteboardCommentThread, "objectId">[];
}

/** The writes that bring a board's live containers in line with the workspace. */
export interface LivePlan {
  upsert: WhiteboardObject[];
  remove: string[];
  /**
   * Comment threads to re-pin, from a child the board let go of to its
   * plain copy (see `detached`). Only there when there are some.
   */
  rehome?: { from: string; to: string }[];
}

/** A child as the workspace says it should be: its kind and the fields reconcile owns. */
interface ChildSpec {
  id: string;
  type: "card" | "text";
  fields: Record<string, unknown>;
}

/**
 * What a live container should look like: its own fields, and its children,
 * or null to leave the children as they are (a Sprint board whose sprint
 * isn't in the list: see `sprintBoardSpec`).
 */
interface ContainerSpec {
  container: Fields;
  children: ChildSpec[] | null;
}

type Fields = Record<string, unknown>;

const sameRef = (a: unknown, b: unknown) => {
  const x = a as { tool?: string; entityId?: string } | undefined;
  const y = b as { tool?: string; entityId?: string } | undefined;
  if (!x || !y) return !x && !y;
  return x.tool === y.tool && x.entityId === y.entityId;
};

const sameList = (a: unknown, b: unknown) =>
  Array.isArray(a) &&
  Array.isArray(b) &&
  a.length === b.length &&
  a.every((v, i) => v === (b as unknown[])[i]);

/** Whether `current` already holds `want` for the managed field `key`. */
function same(key: string, current: unknown, want: unknown): boolean {
  if (key === "sourceRef") return sameRef(current, want);
  // A cleared lock may be stored as false or not at all.
  if (key === "locked") return Boolean(current) === Boolean(want);
  if (Array.isArray(want)) return sameList(current, want);
  return current === want;
}

function differs(current: WhiteboardObject, fields: Fields): boolean {
  const rec = current as unknown as Record<string, unknown>;
  return Object.keys(fields).some((k) => !same(k, rec[k], fields[k]));
}

const clip = (s: string | undefined, max: number) =>
  typeof s === "string" && s.length > max ? s.slice(0, max) : s;

/** Points the validator accepts (0 to a million), else none. */
const validPoints = (p: unknown): number | undefined =>
  typeof p === "number" && Number.isFinite(p) && p >= 0 && p <= 1_000_000 ? p : undefined;

/** A Sprint board's frame fields and its cards. */
function sprintBoardSpec(c: WhiteboardKanbanFrame, data: LiveData): ContainerSpec {
  const sprint = sprintOf(c, data.sprints);
  // A sprint the board still names but the list doesn't hold: deleted on
  // another device, with the board's cleared link not here yet (deleting
  // a sprint clears it, and an unlinked board is left alone), or not
  // pulled yet. Leave the board as it is rather than empty it.
  if (!sprint) return { container: {}, children: null };
  const stories = sprintStories(sprint.id, data.stories);
  const locked = isClosedSprint(sprint) ? true : undefined;

  const rows: Record<string, number> = {};
  const placed = stories.map((story) => {
    const col = sprintColumnOf(story.status);
    const row = rows[col] ?? 0;
    rows[col] = row + 1;
    return { story, col, row };
  });
  const tallest = Math.max(0, ...Object.values(rows));
  const w = Math.max(c.w, SPRINT_COLUMNS.length * SPRINT_MIN_COL_W);
  const h = Math.max(c.h, SPRINT_HEADER_H + tallest * SPRINT_ROW + PAD);
  const colW = w / SPRINT_COLUMNS.length;

  const container: Fields = {
    columns: SPRINT_COLUMNS.map((col) => col.id),
    columnLabels: SPRINT_COLUMNS.map((col) => col.label),
    w,
    h,
    label: clip(sprintBoardLabel(sprint), MAX_TITLE_LEN),
  };

  const children = placed.map(({ story, col, row }): ChildSpec => {
    const colIdx = SPRINT_COLUMNS.findIndex((x) => x.id === col);
    return {
      id: liveChildId(c.id, story.id),
      type: "card",
      fields: {
        x: c.x + colIdx * colW + PAD,
        y: c.y + SPRINT_HEADER_H + row * SPRINT_ROW,
        w: colW - 2 * PAD,
        h: SPRINT_CARD_H,
        title: clip(story.title, MAX_TITLE_LEN) ?? "",
        points: validPoints(story.points),
        status: col,
        assignee: clip(story.owner?.trim() || undefined, MAX_SHORT_LEN),
        sourceRef: { tool: "story", entityId: story.id },
        frameId: c.id,
        locked,
      },
    };
  });
  return { container, children };
}

const mapRowHeight = (tallest: number) =>
  Math.max(1, tallest) * (MAP_CARD_H + MAP_CARD_GAP) + MAP_ROW_PAD;

/**
 * A step header's or slice label's fields. No colour, so the text takes
 * the canvas's themed text colour: an object's own colour must be a
 * literal one (the realtime validator rejects `var(--…)`), and no literal
 * reads at 4.5:1 on both the dark and the light canvas, least of all
 * under the lock's dimming. Managed as "no colour", so a colour set by an
 * earlier build is cleared.
 */
const textFields = (content: string, fontSize: number) => ({
  content: clip(content, MAX_TITLE_LEN) ?? "",
  fontSize,
  fontWeight: 600,
  color: undefined,
  align: "left",
  locked: true,
});

/**
 * A Story map frame's size and its headers, slice labels and cards. Not
 * its label: "Story map" is only where a new one starts (`newStoryMapBoard`),
 * so a renamed board keeps its name.
 */
function storyMapSpec(c: WhiteboardFrame, data: LiveData): ContainerSpec {
  const doc = storyMapDoc(data.storyMaps, c.sourceRef?.entityId);
  // No map saved: nothing to mirror, so the frame keeps its size and empties.
  if (!doc) return { container: {}, children: [] };
  const { steps, slices } = mirroredMap(doc);
  const children: ChildSpec[] = [];

  steps.forEach((step, i) => {
    children.push({
      id: liveChildId(c.id, `step_${step.id}`),
      type: "text",
      fields: {
        x: c.x + MAP_GUTTER + i * MAP_STEP_W + PAD,
        y: c.y + PAD,
        w: MAP_STEP_W - 2 * PAD,
        h: 32,
        frameId: c.id,
        ...textFields(step.name, 16),
      },
    });
  });

  let top = c.y + MAP_HEADER_H;
  for (const slice of slices) {
    const tallest = Math.max(0, ...steps.map((st) => (slice.cards[st.id] ?? []).length));
    const rowH = mapRowHeight(tallest);
    children.push({
      id: liveChildId(c.id, `slice_${slice.id}`),
      type: "text",
      fields: {
        x: c.x + PAD,
        y: top + PAD,
        w: MAP_GUTTER - 2 * PAD,
        h: rowH - 2 * PAD,
        frameId: c.id,
        ...textFields(`${slice.name} · ${sliceSummary(sliceTotals(slice, steps))}`, 13),
      },
    });
    steps.forEach((step, i) => {
      (slice.cards[step.id] ?? []).forEach((card, k) => {
        // The backlog story this card was sent to, read from the snapshot
        // passed in (not `liveLink`, which reads the store), so reconcile
        // stays pure.
        const link = findLink(card.sentTo, "backlog-story");
        const story = link ? data.stories.find((s) => s.id === link.targetId) : undefined;
        const color = typeof card.color === "string" ? card.color.trim() : "";
        children.push({
          id: liveChildId(c.id, `card_${card.id}`),
          type: "card",
          fields: {
            x: c.x + MAP_GUTTER + i * MAP_STEP_W + PAD,
            y: top + PAD + k * (MAP_CARD_H + MAP_CARD_GAP),
            w: MAP_STEP_W - 2 * PAD,
            h: MAP_CARD_H,
            title: clip(card.title, MAX_TITLE_LEN) ?? "",
            description: card.description?.trim()
              ? clip(card.description, MAX_TEXT_LEN)
              : undefined,
            points: validPoints(story ? story.points : estimatePoints(card.estimate)),
            status: story?.status,
            sourceRef: story
              ? { tool: "story", entityId: story.id }
              : { tool: STORY_MAP_TOOL, entityId: card.id },
            color:
              color && color.length <= MAX_COLOR_LEN && SAFE_CSS_COLOR_RE.test(color)
                ? color
                : undefined,
            frameId: c.id,
            locked: true,
          },
        });
      });
    });
    top += rowH;
  }

  const height = top - c.y;
  return {
    container: {
      w: MAP_GUTTER + Math.max(1, steps.length) * MAP_STEP_W,
      h: slices.length > 0 ? height : MAP_HEADER_H + mapRowHeight(1),
    },
    children,
  };
}

/** The object a spec creates: the managed fields plus what the kind requires. */
function created(spec: ChildSpec, c: LiveContainer, z: number, now: string): WhiteboardObject {
  const base = {
    id: spec.id,
    boardId: c.boardId,
    z,
    version: 1,
    createdAt: now,
    updatedAt: now,
  };
  if (spec.type === "card") {
    return { ...base, type: "card", ...spec.fields } as unknown as WhiteboardCard;
  }
  return { ...base, type: "text", ...spec.fields } as unknown as WhiteboardText;
}

/** A Sprint board card's own fields: reconcile never writes them, the user does. */
const USER_CARD_FIELDS = ["description", "due", "tags", "color"] as const;

/**
 * Whether removing `child` would lose something the user added to it: a
 * comment thread pinned to it, a connector to it (removing an object takes
 * its connectors and threads with it), or, on a Sprint board, where they
 * are the user's, a description, due date, tags or colour.
 */
function annotated(
  child: WhiteboardObject,
  c: LiveContainer,
  pinned: ReadonlySet<string>,
  wired: ReadonlySet<string>
): boolean {
  if (pinned.has(child.id) || wired.has(child.id)) return true;
  if (!isSprintBoard(c) || child.type !== "card") return false;
  const rec = child as unknown as Record<string, unknown>;
  return USER_CARD_FIELDS.some((key) => {
    const v = rec[key];
    if (Array.isArray(v)) return v.length > 0;
    return typeof v === "string" ? v.trim() !== "" : v !== undefined;
  });
}

/**
 * `child`, let go by its board (its story left the sprint, its card left
 * the map) but annotated: a plain object beside the board, with no link,
 * frame or lock, under an id that isn't the board's (no `__`), so no board
 * claims it again. The id comes from the child's own id and creation time,
 * so every device that lets it go writes the same copy, and a card made
 * again for a story that came back gets a copy of its own.
 */
function detached(child: WhiteboardObject, right: number, now: string): WhiteboardObject {
  const made = Date.parse(child.createdAt);
  const stamp = Number.isFinite(made) ? made.toString(36) : "0";
  const id = `kept_${stamp}_${child.id}`.replace(/_{2,}/g, "_").slice(0, MAX_ID_LEN);
  return {
    ...child,
    id,
    x: right + 2 * PAD,
    frameId: undefined,
    sourceRef: undefined,
    locked: undefined,
    version: 1,
    createdAt: now,
    updatedAt: now,
  } as WhiteboardObject;
}

/**
 * The writes that make every live container in `boardObjects` (one board's
 * objects) match `data`. Idempotent: run again on its own result, it returns
 * an empty plan. An object is written only when a field reconcile owns
 * differs, with its version bumped so peers take it; a card's description,
 * due date, tags and colour on a Sprint board stay the user's.
 *
 * A child the workspace no longer has goes, unless the user annotated it
 * (`annotated`): that one becomes a plain copy beside the board, which
 * takes over its connectors and (through `rehome`) its comment threads.
 *
 * Only children of a live container on the same board are touched. A
 * container whose `sourceRef` was cleared (its sprint deleted) is no longer
 * live, so its children stay as they are, and Undo of the delete re-adopts
 * them through the same ids. Every object it returns passes the realtime
 * validator; one that wouldn't (an id over the length cap) is left out.
 */
export function reconcileLiveBoards(
  boardObjects: readonly WhiteboardObject[],
  data: LiveData,
  now: string
): LivePlan {
  const byId = new Map(boardObjects.map((o) => [o.id, o]));
  const upsert: WhiteboardObject[] = [];
  const remove: string[] = [];
  const rehome: { from: string; to: string }[] = [];
  // Old id → copy id, for the connectors that end on a let-go child.
  const kept = new Map<string, string>();
  const pinned = new Set<string>();
  for (const t of data.threads ?? []) if (t.objectId) pinned.add(t.objectId);
  const wired = new Set<string>();
  for (const o of boardObjects) {
    if (o.type !== "connector") continue;
    wired.add(o.fromId);
    wired.add(o.toId);
  }

  for (const c of boardObjects) {
    if (!isLiveContainer(c)) continue;
    const spec = isSprintBoard(c) ? sprintBoardSpec(c, data) : storyMapSpec(c, data);

    if (differs(c, spec.container)) {
      upsert.push({
        ...c,
        ...spec.container,
        version: c.version + 1,
        updatedAt: now,
      } as WhiteboardObject);
    }

    if (spec.children === null) continue;
    const wanted = new Set<string>();
    spec.children.forEach((child, i) => {
      // A card listed twice (a hand-edited map) shows once.
      if (wanted.has(child.id)) return;
      wanted.add(child.id);
      const z = c.z + 1 + i;
      const current = byId.get(child.id);
      if (!current) {
        upsert.push(created(child, c, z, now));
        return;
      }
      if (current.type !== child.type) {
        // Same id, another kind: only a hand edit gets here. Rebuild it.
        upsert.push({ ...created(child, c, z, now), version: current.version + 1 });
        return;
      }
      // Children sit above their frame, or the frame catches their clicks.
      const fields: Fields = current.z > c.z ? child.fields : { ...child.fields, z };
      if (differs(current, fields)) {
        upsert.push({
          ...current,
          ...fields,
          version: current.version + 1,
          updatedAt: now,
        } as WhiteboardObject);
      }
    });

    const width = typeof spec.container.w === "number" ? spec.container.w : c.w;
    for (const o of liveChildrenOf(c.id, boardObjects)) {
      if (wanted.has(o.id)) continue;
      if (annotated(o, c, pinned, wired)) {
        const copy = detached(o, c.x + width, now);
        // A copy that wouldn't pass the validator would be lost on the
        // way: keep the child where it is instead.
        if (!isValidObject(copy)) continue;
        upsert.push(copy);
        kept.set(o.id, copy.id);
        if (pinned.has(o.id)) rehome.push({ from: o.id, to: copy.id });
      }
      remove.push(o.id);
    }
  }

  if (kept.size > 0) {
    for (const o of boardObjects) {
      if (o.type !== "connector" || (!kept.has(o.fromId) && !kept.has(o.toId))) continue;
      upsert.push({
        ...o,
        fromId: kept.get(o.fromId) ?? o.fromId,
        toId: kept.get(o.toId) ?? o.toId,
        version: o.version + 1,
        updatedAt: now,
      });
    }
  }

  const plan: LivePlan = { upsert: upsert.filter((o) => isValidObject(o)), remove };
  if (rehome.length > 0) plan.rehome = rehome;
  return plan;
}

/* ─── Guards for the canvas's own edits ───────────────────────────── */

/** A story to move to another status (a drop on a Sprint board). */
export interface StoryMove {
  storyId: string;
  status: StoryStatus;
}

/** Why a Sprint board card dropped off its board went back. */
export const LIVE_OFF_BOARD_NOTE =
  "Sprint board cards stay on their board: drag one to another column to move its story.";

/** Why the lock shortcut skipped a live board's cards. */
export const LIVE_LOCK_NOTE =
  "A live board lays out its own cards, so they can't be locked one by one. Lock the whole board instead.";

/** What the canvas knows at the end of a drag, for `liveDrop`. */
export interface LiveDropContext {
  stories: readonly Story[];
  sprints: readonly Sprint[];
  /** Every object in the drag: a card dragged along with its own board wasn't dropped anywhere. */
  dragged?: ReadonlySet<string>;
}

/** What a drop means: a story to move, or nothing (with why, when the user should hear it). */
export interface LiveDropResult {
  move: StoryMove | null;
  note?: string;
}

/** The column of `board` under `card`'s centre, found as the kanban drop finds it (w / columns each). */
function columnUnder(card: WhiteboardCard, board: WhiteboardKanbanFrame): string | undefined {
  if (board.columns.length === 0) return undefined;
  const cx = card.x + card.w / 2;
  const colW = board.w / board.columns.length;
  const idx = Math.min(board.columns.length - 1, Math.max(0, Math.floor((cx - board.x) / colW)));
  return board.columns[idx];
}

/**
 * A story card that isn't a Sprint board's own (an imported story, a copy
 * made before copies were unlinked, a card kept after its board let go)
 * dropped on a Sprint board: it moves its story only as the board's own
 * card would (with Undo, never in a closed sprint, only a story planned
 * into that sprint), and never joins the board, whose cards are its own.
 */
function storyCardDrop(
  card: WhiteboardCard,
  board: WhiteboardKanbanFrame,
  ctx: LiveDropContext
): LiveDropResult {
  const sprint = sprintOf(board, ctx.sprints);
  if (!sprint) return { move: null };
  if (isClosedSprint(sprint)) return { move: null, note: closedBoardNote(sprint) };
  const story = ctx.stories.find((s) => s.id === card.sourceRef?.entityId);
  if (!story || story.sprintId !== sprint.id) {
    const title = (story?.title ?? card.title).trim() || "This story";
    return {
      move: null,
      note: `“${title}” isn't planned into ${sprint.name}, so it can't go on its board. Plan it in from Sprint Planning.`,
    };
  }
  const status = columnUnder(card, board);
  if (!isStoryStatus(status) || sprintColumnOf(story.status) === status) return { move: null };
  return { move: { storyId: story.id, status } };
}

/**
 * What a drag that ended with `card` over `target` (the topmost kanban
 * under the card's centre, if any) means for a live card. In another column
 * of its own Sprint board, the story moves there: the column is found the
 * way the kanban drop finds it, w / columns per column. Anywhere else,
 * nothing does: the board lays the card out again (and, off its board, the
 * note says so). With `ctx`, a story card from elsewhere dropped on a
 * Sprint board goes by the same rules (`storyCardDrop`). Null for any
 * other card, which keeps the plain kanban drop.
 */
export function liveDrop(
  card: WhiteboardCard,
  target: WhiteboardObject | undefined,
  byId: ReadonlyMap<string, WhiteboardObject>,
  ctx?: LiveDropContext
): LiveDropResult | null {
  const live = liveContainerOf(card.id, byId);
  if (!live) {
    const tool = card.sourceRef?.tool;
    const storyCard = tool === "story" || tool === "backlog";
    return ctx && storyCard && isSprintBoard(target) ? storyCardDrop(card, target, ctx) : null;
  }
  if (ctx?.dragged?.has(live.id)) return { move: null };
  if (!isSprintBoard(live) || card.sourceRef?.tool !== "story" || live.columns.length === 0) {
    return { move: null };
  }
  if (target?.id !== live.id) return { move: null, note: LIVE_OFF_BOARD_NOTE };
  const status = columnUnder(card, live);
  if (status === card.status || !isStoryStatus(status)) return { move: null };
  return { move: { storyId: card.sourceRef.entityId, status } };
}

/**
 * Why a live card can't be edited on the canvas, or null when it can: a
 * story map card is edited in Story Mapper, and a closed sprint's board is
 * a record of what the sprint delivered.
 */
export function liveLockNote(container: LiveContainer, sprints: readonly Sprint[]): string | null {
  if (isStoryMapBoard(container)) {
    return "This card mirrors your story map. Edit it in Story Mapper.";
  }
  const sprint = sprintOf(container, sprints);
  return sprint && isClosedSprint(sprint) ? closedBoardNote(sprint) : null;
}

export interface LiveDeletion {
  /** What to remove: the selection, with each live board's children added. */
  ids: string[];
  /** Live children left in place (reconcile would only bring them back). */
  kept: number;
  /** Which kind of board the kept cards belong to, for the note. */
  keptFrom: "sprint" | "story-map" | null;
}

/**
 * What Delete or Cut removes from `selection`. Deleting a live board takes
 * its cards with it (and Cmd+Z brings the lot back from one snapshot). A
 * card of a board that stays isn't removed: the board would rebuild it from
 * the sprint or the map straight away, so the caller says where to change
 * it instead.
 */
export function liveDeletion(
  selection: readonly string[],
  objects: readonly WhiteboardObject[]
): LiveDeletion {
  const byId = new Map(objects.map((o) => [o.id, o]));
  const chosen = new Set(selection);
  const ids: string[] = [];
  const seen = new Set<string>();
  const add = (id: string) => {
    if (seen.has(id)) return;
    seen.add(id);
    ids.push(id);
  };
  let kept = 0;
  let keptFrom: LiveDeletion["keptFrom"] = null;
  for (const id of selection) {
    const container = liveContainerOf(id, byId);
    if (container && !chosen.has(container.id)) {
      kept++;
      keptFrom ??= isSprintBoard(container) ? "sprint" : "story-map";
      continue;
    }
    add(id);
    if (isLiveContainer(byId.get(id))) liveChildrenOf(id, objects).forEach((o) => add(o.id));
  }
  return { ids, kept, keptFrom };
}

/** The note for cards Delete left in place. */
export function keptLiveNote(from: LiveDeletion["keptFrom"]): string {
  return from === "story-map"
    ? "Story map cards follow your story map. Change them in Story Mapper, or delete the whole board."
    : "Live cards follow the sprint. Remove the story from the sprint in Sprint Planning, or delete the whole board.";
}

/**
 * `objects` as copy, cut, duplicate and Save as template take them. A live
 * board's children are left out when their board is among them: the board
 * rebuilds its own cards, so copying them too would paste a second set on
 * top. A child copied without its board (looked up in `board`, the whole
 * board's objects) becomes a plain object, with no link, frame or lock: the
 * copy is the user's to move and edit, not a second writer of the story.
 */
export function withoutLiveChildren<T extends WhiteboardObject>(
  objects: readonly T[],
  board: readonly WhiteboardObject[] = objects
): T[] {
  const byId = new Map<string, WhiteboardObject>(board.map((o) => [o.id, o]));
  for (const o of objects) byId.set(o.id, o);
  const chosen = new Set(objects.map((o) => o.id));
  const out: T[] = [];
  for (const o of objects) {
    const container = liveContainerOf(o.id, byId);
    if (!container) out.push(o);
    else if (!chosen.has(container.id)) {
      out.push({ ...o, sourceRef: undefined, frameId: undefined, locked: undefined });
    }
  }
  return out;
}
