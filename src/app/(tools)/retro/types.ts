/**
 * Retro board — shared types + domain constants.
 *
 * Extracted from the former single-file client so the board, its column
 * panels, and the MCP-backed root client all share one source of truth for
 * the board shape. `BoardState` is structurally the synced `RetroBoard`
 * entity minus its id (see retro-client.tsx / src/lib/actions/tools/retro.ts).
 */

import type { RetroFormat } from "@/lib/constants/retro-formats";
import type { RetroVotes } from "@/lib/retro/board";
import type { HandoffLink, HandoffRef } from "@/lib/stores/workspace-types";

export type BoardPhase = "write" | "vote" | "discuss" | "actions";

export interface RetroCard {
  id: string;
  columnKey: string;
  text: string;
  votes: number;
  groupedWith: string | null; // id of parent card, null if standalone
  isActionItem: boolean;
  assignee: string;
  discussing: boolean;
  /** Where this action was sent (an impediment, a Kanban card). */
  sentTo?: HandoffLink[];
  /** Id of the previous retro's card this action was carried over from. */
  carriedFrom?: string;
  /** The action is done (set in Retro Actions, or by the agent). */
  done?: boolean;
  doneAt?: string;
  /** When the action is due, YYYY-MM-DD. */
  dueDate?: string;
  /** The item this card came from (a kudos, a red health check); shown as "From …". */
  sourceRef?: HandoffRef;
}

export interface BoardState {
  format: RetroFormat;
  phase: BoardPhase;
  cards: RetroCard[];
  userVotes: number; // votes cast by "this user"
  timerSeconds: number;
  timerRunning: boolean;
  discussingIndex: number; // index into sorted discuss list
  /** The archived retro this one follows, for carrying its actions over. */
  previousRetroId?: string;
  /**
   * Facilitator mode: votes cast per person (name → count) on a shared
   * screen, each against their own budget (`votesPerPerson`). `userVotes`
   * stays the single-voter ("Me") count. A name with 0 is a voter added by
   * hand.
   */
  votesBy?: Record<string, number>;
  /** "Votes each": 3, 5 or 8; absent means 3 (`retroVotes` in lib/retro/board). */
  votesPerPerson?: RetroVotes;
  /**
   * The sprint this retro looks back on (Sprint.id); absent until someone
   * picks one, and on boards from before retros were per sprint. Host-local:
   * a visitor room's snapshot doesn't carry it.
   */
  sprintId?: string;
}

export const PHASES: { key: BoardPhase; label: string; description: string }[] = [
  { key: "write", label: "Write", description: "Add cards to each column" },
  { key: "vote", label: "Vote", description: "Vote on cards" },
  { key: "discuss", label: "Discuss", description: "Work through top-voted cards" },
  { key: "actions", label: "Actions", description: "Assign action items" },
];

/** A phase's one-line description; Vote's says how many votes each person has. */
export function phaseDescription(phase: BoardPhase, votesPerPerson: number): string {
  if (phase === "vote") return `Vote on cards (${votesPerPerson} votes each)`;
  return PHASES.find((p) => p.key === phase)?.description ?? "";
}
