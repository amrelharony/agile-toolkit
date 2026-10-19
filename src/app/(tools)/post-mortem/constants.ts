/**
 * Blameless Post-Mortem — singleton id + status badge palettes.
 * PM_ID MUST match the constant in src/lib/actions/tools/post-mortem.ts.
 */

import type { ActionStatus, PMState, PMStatus } from "./types";

export const DEFAULT_STATE: PMState = { postmortems: [] };

export const PM_ID = "postMortem:current"; // MUST match PM_ID in post-mortem.ts.

export const STATUS_BADGE: Record<PMStatus, string> = {
  draft: "bg-warning/10 text-warning border-warning/30",
  review: "bg-accent/10 text-accent border-accent/30",
  published: "bg-success/10 text-success border-success/30",
};

export const ACTION_STATUS_BADGE: Record<ActionStatus, string> = {
  open: "bg-warning/10 text-warning border-warning/30",
  in_progress: "bg-accent/10 text-accent border-accent/30",
  done: "bg-success/10 text-success border-success/30",
};
