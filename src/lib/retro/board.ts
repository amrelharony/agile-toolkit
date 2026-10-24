/**
 * Retro boards and the sprints they look back on, shared by the Retro page,
 * the Sprint Cockpit, the retro hand-offs and the tool.retro.* agent
 * actions, so they agree on which retro belongs to which sprint.
 *
 * A board names its sprint in `sprintId`. Boards from before retros were
 * per sprint don't, and are placed by date instead: the current board
 * belongs to a sprint while today is in that sprint's retro window, an
 * archived board to the sprint whose window holds its archive day.
 */

import type { RetroBoard, Sprint } from "@/lib/stores/workspace-types";
import type { RetroFormat } from "@/lib/constants/retro-formats";
import { isExampleId } from "@/components/tool-frame/example-data";
import { hasSyntheticDates, localDay } from "@/lib/sprints/series";
import { addDays, dayOf, daysBetween } from "@/lib/impediments/model";

/** The current board's id. MUST match RB_ID in src/app/(tools)/retro/retro-client.tsx. */
export const RETRO_CURRENT_ID = "retro:current";

/** Days after a sprint's last day in which its retro can still be held or archived. */
export const RETRO_GRACE_DAYS = 7;

/** How long a card's text can be, on the board, from a hand-off or an agent. */
export const RETRO_CARD_MAX = 500;

// The local calendar day of a timestamp, shared with the flow charts.
export { localDay };

/** The days `sprint`'s retro can fall in: its first day to a week after its last. */
export function retroWindow(
  sprint: Pick<Sprint, "startDate" | "endDate">
): { start: string; end: string } | null {
  if (hasSyntheticDates(sprint)) return null;
  const start = dayOf(sprint.startDate);
  const end = dayOf(sprint.endDate);
  if (!start || !end) return null;
  return { start, end: addDays(end, RETRO_GRACE_DAYS) };
}

/** Of `candidates` whose retro windows hold `day`, the one that ended nearest to it. */
function nearestRetroSprint(day: string, candidates: readonly Sprint[]): Sprint | undefined {
  let best: { sprint: Sprint; distance: number; ended: boolean } | null = null;
  for (const s of candidates) {
    const w = retroWindow(s);
    if (!w || day < w.start || day > w.end) continue;
    const end = dayOf(s.endDate) as string;
    const distance = Math.abs(daysBetween(end, day));
    const ended = end <= day;
    if (!best || distance < best.distance || (distance === best.distance && ended && !best.ended)) {
      best = { sprint: s, distance, ended };
    }
  }
  return best?.sprint;
}

/**
 * The sprint a retro held (or archived) on `day` looks back on: of the
 * sprints whose retro windows hold the day, the one that ended nearest to
 * it, so a retro two days into the next sprint is still the last one's. A
 * tie goes to the sprint that had already ended. Cancelled and example
 * sprints are left out: a new board is never tagged with one.
 */
export function retroSprintFor(day: string, sprints: readonly Sprint[]): Sprint | undefined {
  return nearestRetroSprint(
    day,
    sprints.filter((s) => s.status !== "cancelled" && !isExampleId(s.id))
  );
}

/** The sprint a board names, if it names one. */
export function boardSprintId(board: Pick<RetroBoard, "sprintId">): string | undefined {
  return typeof board.sprintId === "string" && board.sprintId ? board.sprintId : undefined;
}

/** Whether an archived board is `sprint`'s retro, by the sprint it names or its archive day. */
export function isArchivedRetroOf(
  board: RetroBoard,
  sprint: Sprint,
  sprints: readonly Sprint[]
): boolean {
  const tagged = boardSprintId(board);
  if (tagged) return tagged === sprint.id;
  const day = localDay(board.archivedAt);
  if (!day) return false;
  // `sprint` always competes (the cockpit asks about example sprints too).
  const others = sprints.filter((s) => s.id !== sprint.id && s.status !== "cancelled");
  return nearestRetroSprint(day, [sprint, ...others])?.id === sprint.id;
}

/** Whether a board holds anything of the team's (example cards don't count). */
export function hasOwnCards(board: Pick<RetroBoard, "cards">): boolean {
  return board.cards.some((c) => !isExampleId(c.id));
}

export interface SprintRetro {
  /** The current board, when it has the team's cards and is this sprint's retro in progress. */
  current?: RetroBoard;
  /** This sprint's archived retro (the latest, if several). */
  archived?: RetroBoard;
}

/**
 * `sprint`'s retro. The current board is its retro in progress when it
 * names the sprint, or, naming none, while today is in the sprint's window
 * (any day for a sprint without dates), so an old sprint doesn't claim
 * today's board. A board with only example cards isn't anyone's retro.
 */
export function retroFor(
  boards: readonly RetroBoard[],
  sprint: Sprint,
  sprints: readonly Sprint[],
  today: string
): SprintRetro {
  const out: SprintRetro = {};
  const window = retroWindow(sprint);
  for (const board of boards) {
    const tagged = boardSprintId(board);
    if (!board.archivedAt) {
      if (board.id !== RETRO_CURRENT_ID || !hasOwnCards(board)) continue;
      const mine = tagged
        ? tagged === sprint.id
        : !window || (today >= window.start && today <= window.end);
      if (mine) out.current = board;
      continue;
    }
    if (!isArchivedRetroOf(board, sprint, sprints)) continue;
    if (!out.archived || board.archivedAt > (out.archived.archivedAt ?? "")) out.archived = board;
  }
  return out;
}

/** The newest archived board, which a new retro follows (its actions can be carried over). */
export function newestArchivedRetro(boards: readonly RetroBoard[]): RetroBoard | undefined {
  let best: RetroBoard | undefined;
  for (const b of boards) {
    if (typeof b.archivedAt !== "string") continue;
    if (!best || b.archivedAt > (best.archivedAt ?? "")) best = b;
  }
  return best;
}

/**
 * A new, empty current board in `format`, following `previousRetroId` (the
 * newest archive, usually) and looking back on `sprintId` when given. The
 * Retro page's format picker, the retro hand-offs and agents start boards
 * through this one builder.
 */
export function blankRetroBoard(
  format: RetroFormat,
  opts: { previousRetroId?: string; sprintId?: string } = {}
): RetroBoard {
  return {
    id: RETRO_CURRENT_ID,
    format,
    phase: "write",
    cards: [],
    userVotes: 0,
    timerSeconds: 300,
    timerRunning: false,
    discussingIndex: 0,
    ...(opts.previousRetroId ? { previousRetroId: opts.previousRetroId } : {}),
    ...(opts.sprintId ? { sprintId: opts.sprintId } : {}),
  };
}
