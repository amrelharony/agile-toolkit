/**
 * The shapes the Track delivery tools share: a board's workflow and the work
 * items on it, read off the Sprint board (stories) or the Flow board (cards).
 * Cumulative Flow, Cycle Time, Value Stream, the Health Dashboard and the DORA
 * Scorecard all build them with ./items, so a story or a card is placed, aged
 * and timed the same way on every page and in every agent action.
 *
 * Days are local calendar days ("YYYY-MM-DD", lib/sprints/series localDay):
 * stamps are UTC timestamps, and slicing one would put an evening's move on
 * the next day east of UTC.
 */

/** Which board the items come from: the Sprint board's stories or the Flow board's cards. */
export type FlowSource = "sprint" | "flow";

/**
 * What a stage means for flow: a queue waits (To do, Backlog, Ready), an
 * active stage is work in progress (In progress, Review), done is finished.
 * WIP and ageing read the active stages, throughput and cycle time the done one.
 */
export type StageKind = "queue" | "active" | "done";

export interface FlowStage {
  /** The board's own column or status id ("todo", "in_progress", ...). */
  id: string;
  label: string;
  kind: StageKind;
}

export interface FlowWorkflow {
  source: FlowSource;
  /** In board order, with exactly one "done" stage, last. */
  stages: readonly FlowStage[];
}

/** One move of an item into a stage. */
export interface FlowMove {
  /** The stage it entered. */
  to: string;
  /** The stage it left (absent for an item created in `to`). */
  from?: string;
  /** When: an ISO timestamp, or a plain "YYYY-MM-DD" from a date-only write. */
  at: string;
}

/** A story or a card as the flow tools read it. */
export interface FlowItem {
  id: string;
  title: string;
  kind: "story" | "card";
  /** The stage it is in now (an id of its workflow: SPRINT_WORKFLOW or BOARD_WORKFLOW). */
  stage: string;
  /**
   * The local day it came onto the board, or null when nothing says: a
   * card's creation; a story's move into its sprint (see `storyItems`).
   * Before it, `stageOn` reads null.
   */
  arrivedOn: string | null;
  /** The local day work started (null while it waits in a queue, or without a start). */
  startedOn: string | null;
  /**
   * The local day it was done, only while it is in done: an item moved out
   * of done no longer counts as finished, even with a stale stamp (the
   * finishedCards rule, lib/kanban/flow).
   */
  doneOn: string | null;
  /** Its moves, oldest first. */
  moves: readonly FlowMove[];
  /**
   * "history" when the moves are the recorded ones; "stamps" when they were
   * rebuilt from startedAt / doneAt / columnSince because no history was
   * kept, or it was capped and the earliest moves are gone. Charts say how
   * many items are placed approximately.
   */
  basis: "history" | "stamps";
  /** Flagged as blocked (never while done). */
  blocked: boolean;
  /** Who is working on it: a story's owner, a card's assignee. */
  owner?: string;
  /** A story's points. */
  points?: number;
  /** A story's sprint. */
  sprintId?: string;
}
