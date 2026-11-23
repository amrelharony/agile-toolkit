import type { Kickoff } from "@/lib/stores/workspace-types";

/**
 * A write's outcome: the kickoff as saved, or why nothing was saved (a
 * sentence to show, or null when there was simply nothing to change).
 */
export type KickoffWrite = { ok: true; kickoff: Kickoff } | { ok: false; message: string | null };

/** What a kickoff's parts get from the page. */
export interface KickoffHandle {
  kickoff: Kickoff;
  /** An example kickoff: never sent, its changes never logged. */
  example: boolean;
  /** The kickoff as the store holds it now (null once it is gone). */
  read: () => Kickoff | null;
  /**
   * Change the kickoff: `fn` gets the newest row and the time, and returns
   * the next row (stamping it, or not) or null for no change. A row too big
   * to save is refused.
   */
  write: (fn: (k: Kickoff, now: string) => Kickoff | null) => KickoffWrite;
  /** Log to history (nothing for an example kickoff). */
  log: (action: string, payload?: Record<string, unknown>) => void;
}
