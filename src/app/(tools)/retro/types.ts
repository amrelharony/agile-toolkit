/**
 * Retro board — shared types + domain constants.
 *
 * Extracted from the former single-file client so the board, its column
 * panels, and the MCP-backed root client all share one source of truth for
 * the board shape. `BoardState` is structurally the synced `RetroBoard`
 * entity minus its id (see retro-client.tsx / src/lib/actions/tools/retro.ts).
 */

import type { RetroFormat } from "@/lib/constants/retro-formats";

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
}

export interface BoardState {
  format: RetroFormat;
  phase: BoardPhase;
  cards: RetroCard[];
  userVotes: number; // votes cast by "this user"
  timerSeconds: number;
  timerRunning: boolean;
  discussingIndex: number; // index into sorted discuss list
}

export const MAX_VOTES = 3;

export const PHASES: { key: BoardPhase; label: string; description: string }[] = [
  { key: "write", label: "Write", description: "Add cards to each column" },
  { key: "vote", label: "Vote", description: "Vote on cards (max 3)" },
  { key: "discuss", label: "Discuss", description: "Work through top-voted cards" },
  { key: "actions", label: "Actions", description: "Assign action items" },
];
