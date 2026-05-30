/**
 * Blameless Post-Mortem — singleton id + status badge palettes.
 * PM_ID MUST match the constant in src/lib/actions/tools/post-mortem.ts.
 */

import type { ActionStatus, PMState, PMStatus } from "./types";

export const DEFAULT_STATE: PMState = { postmortems: [] };

export const PM_ID = "postMortem:current"; // MUST match PM_ID in post-mortem.ts.

export const STATUS_BADGE: Record<PMStatus, string> = {
  draft: "bg-amber-500/10 text-amber-300 border-amber-500/30",
  review: "bg-accent/10 text-accent border-accent/30",
  published: "bg-emerald-500/10 text-emerald-300 border-emerald-500/30",
};

export const ACTION_STATUS_BADGE: Record<ActionStatus, string> = {
  open: "bg-amber-500/10 text-amber-300 border-amber-500/30",
  in_progress: "bg-accent/10 text-accent border-accent/30",
  done: "bg-emerald-500/10 text-emerald-300 border-emerald-500/30",
};
