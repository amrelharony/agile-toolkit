/**
 * Blameless Post-Mortem — shared types.
 *
 * Persisted as a synced workspace singleton (`PostMortemLog`); `PMState` is the
 * structurally-equal local shape the UI consumes (see use-post-mortem-log.ts).
 */

export type PMStatus = "draft" | "review" | "published";
export type ActionStatus = "open" | "in_progress" | "done";

export interface ActionItem {
  id: string;
  text: string;
  owner?: string;
  dueDate?: string;
  status: ActionStatus;
}

export interface TimelineEntry {
  id: string;
  ts: string;
  author: string;
  text: string;
}

export interface PostMortem {
  id: string;
  title: string;
  incidentDate: string;
  status: PMStatus;
  summary?: string;
  contributingFactors: string[];
  timeline: TimelineEntry[];
  actions: ActionItem[];
  description?: string;
  /** ISO timestamp when the post-mortem was created (raised). Optional for
   *  backward compatibility with persisted records that pre-date this field. */
  createdAt?: string;
  /** ISO timestamp when status first transitioned to "published". */
  publishedAt?: string;
}

export interface PMState {
  postmortems: PostMortem[];
}
