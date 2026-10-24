/**
 * Stories and Flow-board cards as flow items (./types FlowItem): which stage
 * each is in, when it came onto the board, started and was done, and the
 * moves it made. Read live from the workspace by every Track delivery tool
 * and its agent actions, never copied into a tool's own store, so a chart
 * can't go stale or count an item twice.
 *
 * Moves come from the recorded history (Story.statusHistory,
 * KanbanCard.history). Where it falls short they are rebuilt from the
 * stamps (startedAt, doneAt / completedAt, columnSince) and the item is
 * marked `basis: "stamps"`:
 *
 *   - no history at all (a card or story from before it was kept);
 *   - the history starts after the item's earlier moves (it began mid-way,
 *     or reached its cap and dropped the oldest), and a stamp dates one of
 *     those earlier moves (when the history begins in Review or Done and
 *     the stamps only date the start, the item is put there at its start);
 *   - the history doesn't end where the item is (a hand edit, an older
 *     agent write that changed the column alone).
 *
 * Example rows (`example-` ids) are left out unless asked for, so an
 * example never counts in a real team's numbers.
 */

import type {
  KanbanCard,
  KanbanColumnId,
  Sprint,
  Story,
  StoryStatus,
  StoryStatusChange,
} from "@/lib/stores/workspace-types";
import { KANBAN_HISTORY_CAP, cardHistory } from "@/lib/kanban/flow";
import { STORY_STATUS_HISTORY_CAP } from "@/lib/sprints/story-status";
import { localDay } from "@/lib/sprints/series";
import { dayNumber } from "./days";
import { BOARD_WORKFLOW, SPRINT_WORKFLOW, stageOf, workflowOf } from "./workflows";
import type { FlowItem, FlowMove, FlowWorkflow } from "./types";

export { BOARD_WORKFLOW, SPRINT_WORKFLOW, stageKind, stageOf, workflowOf } from "./workflows";

const valid = (iso: string | null | undefined): iso is string => dayNumber(iso) !== null;

/**
 * Whether a row came from a tool's "Load an example": an `example-` id, the
 * rule of components/tool-frame/example-data isExampleId (a test holds the
 * two together). Not imported from there: that is a "use client" module,
 * and in the MCP route handler's server bundle its exports are client
 * references, not functions an agent action can call.
 */
const EXAMPLE_ID_PREFIX = "example-";
const isExampleId = (id: string | null | undefined) =>
  typeof id === "string" && id.startsWith(EXAMPLE_ID_PREFIX);

/**
 * The entries of a stored list that are objects. Stored rows aren't always
 * what the types say (a hand edit, an older client), so a list that isn't
 * one reads as empty and an entry that isn't one is skipped.
 */
function entries<T extends object>(list: readonly T[] | undefined): T[] {
  const raw: unknown = list;
  return Array.isArray(raw) ? raw.filter((c): c is T => typeof c === "object" && c !== null) : [];
}

/** The Sprint board stage a status shows in: "backlog" (or an unknown status) waits in To do. */
function sprintStage(status: StoryStatus | string): string {
  return status === "in_progress" || status === "review" || status === "done" ? status : "todo";
}

/** The Flow board stage of a column; an unknown one (a hand edit) reads as Backlog. */
function boardStage(column: KanbanColumnId | string): string {
  return stageOf(BOARD_WORKFLOW, column) ? column : "backlog";
}

/** The latest of some stamps, or undefined when none of them is one. */
function latestOf(isos: readonly (string | undefined)[]): string | undefined {
  let best: { iso: string; t: number } | undefined;
  for (const iso of isos) {
    const t = iso ? Date.parse(iso) : NaN;
    if (Number.isFinite(t) && (!best || t > best.t)) best = { iso: iso as string, t };
  }
  return best?.iso;
}

const move = (to: string, from: string | undefined, at: string): FlowMove =>
  from === undefined ? { to, at } : { to, from, at };

interface Placed {
  moves: FlowMove[];
  basis: FlowItem["basis"];
}

/**
 * The item's moves from its recorded history, completed from its stamps
 * (see the module comment). `recorded` holds every recorded change mapped
 * onto the workflow, self-moves included (a story planned in goes from
 * "backlog" to "todo", both To do): only its last entry is read for where
 * the history ends. `fromStamps` is the moves the stamps alone give.
 * `enteredAt` is when the item entered its current stage, by its stamps.
 * Rebuilt moves on or before the arrival day change nothing a chart shows
 * (the item arrived in that stage), so they don't make the item approximate;
 * stamped moves that had to be redirected or dropped to fit the history do.
 */
function place(
  workflow: FlowWorkflow,
  recorded: readonly FlowMove[],
  capped: boolean,
  fromStamps: readonly FlowMove[],
  stage: string,
  enteredAt: string | undefined,
  arrivedOn: string | null
): Placed {
  const arrived = dayNumber(arrivedOn);
  let rebuilt = false;
  const note = (m: FlowMove) => {
    const n = dayNumber(m.at);
    if (arrived === null || (n !== null && n > arrived)) rebuilt = true;
  };
  const real = recorded.filter((m) => m.to !== m.from);
  const moves: FlowMove[] = [];
  if (recorded.length === 0) {
    fromStamps.forEach(note);
    moves.push(...fromStamps);
  } else {
    // Stamped moves from before the history began, joined up with where it began.
    const first = recorded[0];
    const firstDay = dayNumber(first.at) as number;
    const before = fromStamps.filter((m) => (dayNumber(m.at) as number) < firstDay);
    const last = before[before.length - 1];
    if (last && first.from !== undefined) {
      if (last.to === first.from) {
        before.forEach(note);
        moves.push(...before);
      } else if (stageOf(workflow, first.from)?.kind !== "queue") {
        // The stamps date the start; the history begins with the item in
        // Review (or Done), which it reached at some unrecorded time after.
        // Put there at the start, it is work in progress from the right day,
        // in a stage that is approximate.
        moves.push(...before, move(first.from, last.to, last.at));
        rebuilt = true;
      } else {
        // The history begins with the item waiting in a queue, after a
        // stamped start: a stale stamp, or one a write backfilled. Either
        // way the days before the history are a guess.
        rebuilt = true;
      }
    }
    moves.push(...real);
  }
  // Where the history (or the stamps) leave it must be where it is now.
  const last = moves[moves.length - 1];
  const implied = recorded.length ? recorded[recorded.length - 1].to : last?.to;
  if (implied !== undefined && implied !== stage) {
    const lastDay = last ? dayNumber(last.at) : null;
    const entered =
      enteredAt && (lastDay === null || (dayNumber(enteredAt) as number) >= lastDay)
        ? enteredAt
        : last?.at;
    if (entered) {
      const m = move(stage, implied, entered);
      note(m);
      moves.push(m);
    }
  }
  return { moves, basis: capped || rebuilt ? "stamps" : "history" };
}

/**
 * The day work on the item started: its start stamp, else the first move
 * into an active stage since it last waited in a queue. Null while it waits
 * in a queue now (a stale stamp from an earlier attempt doesn't count).
 */
function startOf(item: Omit<FlowItem, "startedOn" | "doneOn">, startedAt?: string): string | null {
  const wf = workflowOf(item);
  const kind = (id: string) => stageOf(wf, id)?.kind;
  if (kind(item.stage) === "queue") return null;
  if (valid(startedAt)) return localDay(startedAt);
  let start: string | null = null;
  for (const m of item.moves) {
    if (kind(m.to) === "queue") start = null;
    else if (start === null && kind(m.to) === "active") start = localDay(m.at);
  }
  return start;
}

/** The day of the latest move into done, or null. */
function lastDoneMove(moves: readonly FlowMove[]): string | null {
  for (let i = moves.length - 1; i >= 0; i--) {
    if (moves[i].to === "done") return localDay(moves[i].at);
  }
  return null;
}

/** The earlier of `day` and the earliest move's local day; null when neither is one. */
function earliestDay(day: string | null, moves: readonly FlowMove[]): string | null {
  let best = dayNumber(day);
  let out = best === null ? null : day;
  for (const m of moves) {
    const n = dayNumber(m.at);
    if (n !== null && (best === null || n < best)) {
      best = n;
      out = localDay(m.at);
    }
  }
  return out;
}

/**
 * The local day a story was done: `doneAt`, else its last move into done in
 * the status history; null when neither says. The one rule the Sprint
 * cockpit's burndown and the retro facts read too (they each kept a copy,
 * `doneDay`). It doesn't check the story is still done: callers that count
 * finished work look at the status first (a FlowItem's `doneOn` does).
 */
export function doneOn(story: Pick<Story, "doneAt" | "statusHistory">): string | null {
  const stamped = localDay(story.doneAt);
  if (stamped) return stamped;
  const history = entries(story.statusHistory);
  for (let i = history.length - 1; i >= 0; i--) {
    if (history[i].status === "done") return localDay(history[i].at);
  }
  return null;
}

/**
 * The local day a story came onto its sprint's board: its move into the
 * sprint (the first `sprintHistory` entry into it), else the last
 * backlog-to-to-do move in its status history (Sprint Planning writes one
 * each time it plans the story in, so an earlier one can be another
 * sprint's), else when it was created, else the sprint's start. A story in
 * no sprint arrives when it was created.
 */
function storyArrival(story: Story, sprint?: Pick<Sprint, "id" | "startDate">): string | null {
  const sprintId = sprint?.id ?? story.sprintId;
  if (sprintId) {
    const join = entries(story.sprintHistory).find((c) => c.sprintId === sprintId && valid(c.at));
    if (join) return localDay(join.at);
    const history = entries(story.statusHistory);
    for (let i = history.length - 1; i >= 0; i--) {
      const c = history[i];
      if (c.from === "backlog" && c.status === "todo" && valid(c.at)) return localDay(c.at);
    }
  }
  if (valid(story.createdAt)) return localDay(story.createdAt);
  return sprint && valid(sprint.startDate) ? localDay(sprint.startDate) : null;
}

/**
 * Whether the story belongs on `sprint`'s board: it is in the sprint now,
 * or its sprint moves say it left (carried over when the sprint closed, or
 * descoped) no earlier than the sprint's start, having joined no later than
 * its end. `leftAt` is its last move out, so a closed sprint's chart keeps
 * the work it ended with. A story with no sprint moves is judged by the
 * sprint it is in now.
 */
function membership(
  story: Story,
  sprint: Pick<Sprint, "id" | "startDate" | "endDate">
): { leftAt?: string } | null {
  if (story.sprintId === sprint.id) return {};
  const moves = entries(story.sprintHistory).filter((c) => valid(c.at));
  const left = moves.filter((c) => c.from === sprint.id).pop();
  if (!left) return null;
  const joined = moves.find((c) => c.sprintId === sprint.id);
  const start = dayNumber(sprint.startDate);
  const end = dayNumber(sprint.endDate);
  if (start !== null && (dayNumber(left.at) as number) < start) return null;
  if (end !== null && joined && (dayNumber(joined.at) as number) > end) return null;
  return { leftAt: left.at };
}

/**
 * The story as it stood just before it left a sprint at `at`: its status
 * then (the last change before it, else the status the first change after
 * it moved from), its history up to then, and only the stamps written
 * before it. So a story carried over at the close is charted, timed and
 * counted in the sprint it left as it ended there, not as it went on in the
 * next one (and the status change the close made with the move is its next
 * sprint's).
 */
function storyBefore(story: Story, history: readonly StoryStatusChange[], at: string): Story {
  const t = Date.parse(at);
  const isBefore = (iso: string | undefined): boolean => valid(iso) && Date.parse(iso) < t;
  const kept = history.filter((c) => isBefore(c.at));
  const after = history.find((c) => valid(c.at) && !isBefore(c.at));
  const status = kept.length ? kept[kept.length - 1].status : (after?.from ?? story.status);
  const out: Story = { ...story, status, statusHistory: kept };
  if (!isBefore(story.startedAt)) delete out.startedAt;
  if (status !== "done" || !isBefore(story.doneAt)) delete out.doneAt;
  return out;
}

/**
 * Whether a done story went there straight from waiting, with no start of
 * its own: `withStoryStatus` stamps the start with the move itself (To do to
 * Done), and an agent creating a story in done stamps both at once. Nobody
 * saw it worked on, so, like a card dropped straight into Done, it has no
 * cycle time rather than a made-up 1 day; it still counts as throughput. A
 * start the write set itself (an earlier, backfilled one) is kept.
 */
function droppedIntoDone(story: Story, recorded: readonly FlowMove[]): boolean {
  if (sprintStage(story.status) !== "done" || !valid(story.startedAt)) return false;
  const started = Date.parse(story.startedAt);
  for (let i = recorded.length - 1; i >= 0; i--) {
    const m = recorded[i];
    if (m.to !== "done") continue;
    const fromQueue = m.from === undefined || stageOf(SPRINT_WORKFLOW, m.from)?.kind === "queue";
    return fromQueue && Date.parse(m.at) === started;
  }
  return (
    valid(story.doneAt) &&
    Date.parse(story.doneAt) === started &&
    !recorded.some((m) => stageOf(SPRINT_WORKFLOW, m.to)?.kind === "active")
  );
}

/** A story's moves from its stamps alone: started, then (when done) done. */
function storyStampMoves(story: Story, stage: string, startedAt: string | undefined): FlowMove[] {
  const started = valid(startedAt) ? startedAt : undefined;
  const done = valid(story.doneAt) ? story.doneAt : undefined;
  if (stage === "done") {
    const out: FlowMove[] = [];
    if (started && (!done || Date.parse(started) <= Date.parse(done))) {
      out.push(move("in_progress", "todo", started));
    }
    if (done) out.push(move("done", out.length ? "in_progress" : "todo", done));
    return out;
  }
  // In progress or Review: the start is the best date for the stage it is in.
  return started && stage !== "todo" ? [move(stage, "todo", started)] : [];
}

/** `leftAt`: the story has since left `sprint` (see `membership`); it is read as it was then. */
function storyItem(
  stored: Story,
  sprint?: Pick<Sprint, "id" | "startDate">,
  leftAt?: string
): FlowItem {
  const full = entries(stored.statusHistory);
  // A full history starts with the story's creation (no `from`); a capped one lost it.
  const capped = full.length >= STORY_STATUS_HISTORY_CAP && full[0].from !== undefined;
  const story = leftAt ? storyBefore(stored, full, leftAt) : stored;
  const stage = sprintStage(story.status);
  const recorded = entries(story.statusHistory)
    .filter((c) => valid(c.at))
    .map((c) =>
      move(sprintStage(c.status), c.from === undefined ? undefined : sprintStage(c.from), c.at)
    );
  const arrivedOn = storyArrival(stored, sprint);
  const startedAt = droppedIntoDone(story, recorded) ? undefined : story.startedAt;
  const enteredAt = stage === "done" ? story.doneAt : stage === "todo" ? undefined : startedAt;
  const { moves, basis } = place(
    SPRINT_WORKFLOW,
    recorded,
    capped,
    storyStampMoves(story, stage, startedAt),
    stage,
    valid(enteredAt) ? enteredAt : undefined,
    arrivedOn
  );
  const owner = story.owner?.trim();
  const leftOn = leftAt ? localDay(leftAt) : null;
  const base: Omit<FlowItem, "startedOn" | "doneOn"> = {
    id: story.id,
    title: story.title,
    kind: "story",
    stage,
    arrivedOn,
    moves,
    basis,
    blocked: Boolean(story.blocked) && stage !== "done",
    ...(owner ? { owner } : {}),
    ...(typeof story.points === "number" && Number.isFinite(story.points)
      ? { points: story.points }
      : {}),
    ...(story.sprintId ? { sprintId: story.sprintId } : {}),
    ...(leftOn ? { leftOn } : {}),
  };
  return {
    ...base,
    startedOn: startOf(base, startedAt),
    doneOn: stage === "done" ? doneOn(story) : null,
  };
}

export interface StoryItemsOptions {
  /**
   * Only this sprint's stories: those in it now, and those that left it
   * while it ran (carried over, descoped), read as they were when they left
   * (`FlowItem.leftOn`). Each arrives no earlier than it joined the sprint.
   */
  sprint?: Pick<Sprint, "id" | "startDate" | "endDate">;
  /** Keep `example-` stories (a tool's in-memory example). */
  includeExamples?: boolean;
}

/**
 * The stories as Sprint-board items (SPRINT_WORKFLOW), in the order given.
 * With `sprint`, the stories on that sprint's board (see the option): a
 * story arrives when it moved into the sprint (see `storyArrival`), falling
 * back to the sprint's start, and one that has since left drops off the
 * chart after the day it left. Without its sprint moves (a story from
 * before they were kept) a story counts by the sprint it is in now.
 */
export function storyItems(stories: readonly Story[], opts: StoryItemsOptions = {}): FlowItem[] {
  const { sprint, includeExamples = false } = opts;
  const out: FlowItem[] = [];
  for (const story of stories) {
    if (!includeExamples && isExampleId(story.id)) continue;
    if (!sprint) {
      out.push(storyItem(story));
      continue;
    }
    const member = membership(story, sprint);
    if (member) out.push(storyItem(story, sprint, member.leftAt));
  }
  return out;
}

/**
 * When the card entered its column, by its stamps: the later of
 * `columnSince` and the stamp the column writes (the completion for Done,
 * the start for In progress and Review), as kanban/flow-view cardColumnSince
 * reads it (an agent's move once wrote those stamps without `columnSince`).
 */
function cardEnteredAt(card: KanbanCard, stage: string): string | undefined {
  if (stage === "done") return latestOf([card.columnSince, card.completedAt]);
  if (stage === "in_progress" || stage === "review") {
    return latestOf([card.columnSince, card.startedAt]);
  }
  return latestOf([card.columnSince]);
}

/** A card's moves from its stamps alone: Backlog from creation, started, then its column. */
function cardStampMoves(card: KanbanCard, stage: string): FlowMove[] {
  const out: FlowMove[] = [];
  const working = stage === "in_progress" || stage === "review" || stage === "done";
  const started = working && valid(card.startedAt) ? card.startedAt : undefined;
  if (started) out.push(move("in_progress", "backlog", started));
  const prev = started ? "in_progress" : "backlog";
  const entered = cardEnteredAt(card, stage);
  if (stage !== prev && entered) {
    // A column entered "before" the start (bad data) is entered at the start.
    const at = started && Date.parse(entered) < Date.parse(started) ? started : entered;
    out.push(move(stage, prev, at));
  }
  return out;
}

function cardItem(card: KanbanCard): FlowItem {
  const stage = boardStage(card.column);
  const raw = cardHistory(card);
  const recorded = raw
    .filter((c) => valid(c.at))
    .map((c) =>
      move(boardStage(c.column), c.from === undefined ? undefined : boardStage(c.from), c.at)
    );
  const created = valid(card.createdAt) ? localDay(card.createdAt) : null;
  const { moves, basis } = place(
    BOARD_WORKFLOW,
    recorded,
    // A card's history has no creation entry, so a full one may have lost its oldest moves.
    raw.length >= KANBAN_HISTORY_CAP,
    cardStampMoves(card, stage),
    stage,
    cardEnteredAt(card, stage),
    created ?? (recorded.length ? localDay(recorded[0].at) : null)
  );
  // Never after its first move: hand-offs and agents date `createdAt` by the
  // UTC day, which west of UTC is already tomorrow on an evening the card
  // can be added and moved in.
  const arrivedOn = earliestDay(created, moves);
  const owner = card.assignee?.trim();
  const base: Omit<FlowItem, "startedOn" | "doneOn"> = {
    id: card.id,
    title: card.title,
    kind: "card",
    stage,
    arrivedOn,
    moves,
    basis,
    blocked: Boolean(card.blocked) && stage !== "done",
    ...(owner ? { owner } : {}),
  };
  return {
    ...base,
    startedOn: startOf(base, card.startedAt),
    doneOn: stage === "done" ? (localDay(card.completedAt) ?? lastDoneMove(moves)) : null,
  };
}

/**
 * The Flow board's cards as items (BOARD_WORKFLOW), in the order given:
 * each arrives on the day it was created (or of its first move, if that
 * came earlier), and moves by its history when it has one, else by its
 * stamps (`basis: "stamps"`).
 */
export function cardItems(
  cards: readonly KanbanCard[],
  opts: { includeExamples?: boolean } = {}
): FlowItem[] {
  const out: FlowItem[] = [];
  for (const card of cards) {
    if (!opts.includeExamples && isExampleId(card.id)) continue;
    out.push(cardItem(card));
  }
  return out;
}

/**
 * The stage the item was in at the end of local day `day`, or null when it
 * wasn't on the board that day: before it arrived, before a first move that
 * has no `from` (it was created then), or after the day it left its sprint
 * (`leftOn`). The last move of a day wins, so an item moved twice in a day
 * shows where it ended up.
 */
export function stageOn(item: FlowItem, day: string): string | null {
  const n = dayNumber(day);
  if (n === null) return null;
  return stageWalk(item)(n);
}

/**
 * The item's stage day by day, for days asked in increasing order (dailyCounts
 * walks a range this way, so a long range costs one pass over the moves).
 * Asking for an earlier day than the last one restarts the walk.
 * @internal
 */
export function stageWalk(item: FlowItem): (day: number) => string | null {
  const arrived = dayNumber(item.arrivedOn);
  const left = dayNumber(item.leftOn);
  const moves = item.moves
    .map((m) => ({ n: dayNumber(m.at), to: m.to, from: m.from }))
    .filter((m): m is { n: number; to: string; from: string | undefined } => m.n !== null)
    // Stable: moves on the same day keep their recorded order.
    .sort((a, b) => a.n - b.n);
  const born = moves.length && moves[0].from === undefined ? moves[0].n : null;
  const initial = moves.length ? (moves[0].from ?? moves[0].to) : item.stage;
  let i = 0;
  let stage = initial;
  let lastDay = -Infinity;
  return (day: number) => {
    if (day < lastDay) {
      i = 0;
      stage = initial;
    }
    lastDay = day;
    if ((arrived !== null && day < arrived) || (born !== null && day < born)) return null;
    if (left !== null && day > left) return null;
    while (i < moves.length && moves[i].n <= day) stage = moves[i++].to;
    return stage;
  };
}
