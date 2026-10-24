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
 *     those earlier moves;
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
} from "@/lib/stores/workspace-types";
import { isExampleId } from "@/components/tool-frame/example-data";
import { KANBAN_HISTORY_CAP } from "@/lib/kanban/flow";
import { STORY_STATUS_HISTORY_CAP } from "@/lib/sprints/story-status";
import { localDay } from "@/lib/sprints/series";
import { dayNumber } from "./days";
import { BOARD_WORKFLOW, stageOf, workflowOf } from "./workflows";
import type { FlowItem, FlowMove } from "./types";

export { BOARD_WORKFLOW, SPRINT_WORKFLOW, stageKind, stageOf, workflowOf } from "./workflows";

const valid = (iso: string | null | undefined): iso is string => dayNumber(iso) !== null;

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
 * (the item arrived in that stage), so they don't make the item approximate.
 */
function place(
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
    // Stamped moves from before the history began, if they lead to where it began.
    const first = recorded[0];
    const firstDay = dayNumber(first.at) as number;
    const before = fromStamps.filter((m) => (dayNumber(m.at) as number) < firstDay);
    const leadsIn =
      before.length > 0 && first.from !== undefined && before[before.length - 1].to === first.from;
    if (leadsIn) {
      before.forEach(note);
      moves.push(...before);
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
  const history = story.statusHistory ?? [];
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
    const join = (story.sprintHistory ?? []).find((c) => c.sprintId === sprintId && valid(c.at));
    if (join) return localDay(join.at);
    const history = story.statusHistory ?? [];
    for (let i = history.length - 1; i >= 0; i--) {
      const c = history[i];
      if (c.from === "backlog" && c.status === "todo" && valid(c.at)) return localDay(c.at);
    }
  }
  if (valid(story.createdAt)) return localDay(story.createdAt);
  return sprint && valid(sprint.startDate) ? localDay(sprint.startDate) : null;
}

/** A story's moves from its stamps alone: started, then (when done) done. */
function storyStampMoves(story: Story, stage: string): FlowMove[] {
  const started = valid(story.startedAt) ? story.startedAt : undefined;
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

function storyItem(story: Story, sprint?: Pick<Sprint, "id" | "startDate">): FlowItem {
  const stage = sprintStage(story.status);
  const raw = story.statusHistory ?? [];
  const recorded = raw
    .filter((c) => valid(c.at))
    .map((c) =>
      move(sprintStage(c.status), c.from === undefined ? undefined : sprintStage(c.from), c.at)
    );
  // A full history starts with the story's creation (no `from`); a capped one lost it.
  const capped = raw.length >= STORY_STATUS_HISTORY_CAP && raw[0].from !== undefined;
  const arrivedOn = storyArrival(story, sprint);
  const enteredAt =
    stage === "done" ? story.doneAt : stage === "todo" ? undefined : story.startedAt;
  const { moves, basis } = place(
    recorded,
    capped,
    storyStampMoves(story, stage),
    stage,
    valid(enteredAt) ? enteredAt : undefined,
    arrivedOn
  );
  const owner = story.owner?.trim();
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
  };
  return {
    ...base,
    startedOn: startOf(base, story.startedAt),
    doneOn: stage === "done" ? doneOn(story) : null,
  };
}

export interface StoryItemsOptions {
  /** Only this sprint's stories (`Story.sprintId`), arriving no earlier than they joined it. */
  sprint?: Pick<Sprint, "id" | "startDate" | "endDate">;
  /** Keep `example-` stories (a tool's in-memory example). */
  includeExamples?: boolean;
}

/**
 * The stories as Sprint-board items (SPRINT_WORKFLOW), in the order given.
 * With `sprint`, only the stories in it now; a story arrives when it moved
 * into the sprint (see `storyArrival`), falling back to the sprint's start.
 */
export function storyItems(stories: readonly Story[], opts: StoryItemsOptions = {}): FlowItem[] {
  const { sprint, includeExamples = false } = opts;
  const out: FlowItem[] = [];
  for (const story of stories) {
    if (!includeExamples && isExampleId(story.id)) continue;
    if (sprint && story.sprintId !== sprint.id) continue;
    out.push(storyItem(story, sprint));
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
  const raw = card.history ?? [];
  const recorded = raw
    .filter((c) => valid(c.at))
    .map((c) =>
      move(boardStage(c.column), c.from === undefined ? undefined : boardStage(c.from), c.at)
    );
  const arrivedOn = valid(card.createdAt)
    ? localDay(card.createdAt)
    : recorded.length
      ? localDay(recorded[0].at)
      : null;
  const { moves, basis } = place(
    recorded,
    // A card's history has no creation entry, so a full one may have lost its oldest moves.
    raw.length >= KANBAN_HISTORY_CAP,
    cardStampMoves(card, stage),
    stage,
    cardEnteredAt(card, stage),
    arrivedOn
  );
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
 * each arrives on the day it was created, and moves by its history when it
 * has one, else by its stamps (`basis: "stamps"`).
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
 * wasn't on the board yet: before it arrived, or before a first move that
 * has no `from` (it was created then). The last move of a day wins, so an
 * item moved twice in a day shows where it ended up.
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
    while (i < moves.length && moves[i].n <= day) stage = moves[i++].to;
    return stage;
  };
}
