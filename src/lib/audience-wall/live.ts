/**
 * The live wall open on the Audience Wall page, for Amr's room verbs.
 *
 * A wall room lives in the host's page (its keys, its channel, who wrote
 * what), so an action can't reach it through a store. While a room is
 * live, the page registers a small controller here; the actions call it
 * and get "no live wall" when there is none. It hands out counts only,
 * never a post's text, so nothing a participant wrote reaches Amr's chat.
 *
 * Plain module, no React and no realtime import: the actions' visitor
 * safety scan allows it.
 */

export interface LiveWallStatus {
  /** The prompt on the wall, or null before a round. */
  prompt: string | null;
  /** Takes posts and votes. */
  open: boolean;
  mode: "live" | "hidden";
  /** Posts on the wall (counted even while hidden). */
  posts: number;
  /** The hidden posts were revealed (or the round shows them live). */
  shown: boolean;
  hands: number;
  /** People in the room, the host included. */
  people: number;
  /** 25/10 scoring: "open", "shown", or null. */
  scoring: "open" | "shown" | null;
  /** The page's kind of wall. */
  kind: string;
}

export interface LiveWallControl {
  status(): LiveWallStatus;
  /** Put a new prompt up (the round before goes, unsaved). False if it can't. */
  openRound(prompt: string, mode: "live" | "hidden"): boolean;
  setOpen(open: boolean): void;
  reveal(): void;
  lowerAllHands(): void;
  /** 25/10 only: start the scoring, then show the totals. */
  setScoring?(scoring: "open" | "shown"): void;
}

let current: LiveWallControl | null = null;

/** The page registers its live wall (and null when it closes). Returns the unregister. */
export function registerLiveWall(control: LiveWallControl): () => void {
  current = control;
  return () => {
    if (current === control) current = null;
  };
}

/** The live wall on the page, or null. */
export function liveWall(): LiveWallControl | null {
  return current;
}
