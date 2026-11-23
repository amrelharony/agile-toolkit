/**
 * ROAM for the PI board's risks: each risk is Resolved, Owned, Accepted or
 * Mitigated, or still to sort. The groups, the one-line verdict, the
 * keyword guess the "Suggest from keywords" button (and the AI task's
 * fallback) uses, and the Risk Register hand-off's source.
 *
 * Pure and server-safe: Amr's `tool.pi_planning.list_state` reads the
 * groups with it.
 */

import { listAnd, plural } from "@/lib/charts/chart-text";
import type { HandoffRef } from "@/lib/stores/workspace-types";
import { ROAM_STATUSES, type PiItem, type PiState, type RoamStatus } from "./model";

/** Where a risk lives, for the target's link back (Risk Register rows name the PI board). */
export const piItemRef = (item: Pick<PiItem, "id">): HandoffRef => ({
  tool: "pi-planning",
  id: item.id,
});

export const ROAM_LABEL: Record<RoamStatus, string> = {
  resolved: "Resolved",
  owned: "Owned",
  accepted: "Accepted",
  mitigated: "Mitigated",
};

/** What each status means, in a few words, after its label ("Owned: someone takes…"). */
export const ROAM_MEANING: Record<RoamStatus, string> = {
  resolved: "dealt with, so it's no longer a risk.",
  owned: "someone takes it on and chases it.",
  accepted: "the train lives with it as it is.",
  mitigated: "a plan is making it smaller.",
};

/** A risk's group on the ROAM board: its status, or "unsorted". */
export type RoamGroup = RoamStatus | "unsorted";
export const ROAM_GROUPS: readonly RoamGroup[] = ["unsorted", ...ROAM_STATUSES];
export const ROAM_GROUP_LABEL: Record<RoamGroup, string> = {
  unsorted: "To sort",
  ...ROAM_LABEL,
};

/** A risk's status in words, as its card on the board shows it. */
export const roamLabel = (item: Pick<PiItem, "roam">): string =>
  item.roam ? ROAM_LABEL[item.roam] : ROAM_GROUP_LABEL.unsorted;

/** Owned and mitigated risks can go to the Risk Register: someone is working them. */
export const canLogRisk = (item: Pick<PiItem, "roam">): boolean =>
  item.roam === "owned" || item.roam === "mitigated";

/**
 * The board's risks: risk items on a team still on the board, in the
 * iterations it shows (an item past the last iteration is hidden there too).
 */
export function piRisks(state: PiState): PiItem[] {
  const teams = new Set(state.teams.map((t) => t.id));
  return state.items.filter(
    (i) => i.kind === "risk" && teams.has(i.teamId) && i.iteration < state.iterations
  );
}

/** The board's risks by ROAM group, in board order within each. */
export function roamGroups(state: PiState): Record<RoamGroup, PiItem[]> {
  const out = Object.fromEntries(ROAM_GROUPS.map((g) => [g, [] as PiItem[]])) as Record<
    RoamGroup,
    PiItem[]
  >;
  for (const risk of piRisks(state)) out[risk.roam ?? "unsorted"].push(risk);
  return out;
}

/**
 * One sentence on where the risks stand:
 *
 *   "4 risks: 1 resolved, 1 owned and 1 mitigated; 1 still to sort.
 *    1 owned risk has no owner yet."
 */
export function roamVerdict(state: PiState): string {
  const groups = roamGroups(state);
  const total = ROAM_GROUPS.reduce((a, g) => a + groups[g].length, 0);
  if (total === 0) return "No risks on the board yet.";
  const sorted = ROAM_STATUSES.filter((s) => groups[s].length > 0).map(
    (s) => `${groups[s].length} ${ROAM_LABEL[s].toLowerCase()}`
  );
  const unsorted = groups.unsorted.length;
  let text = `${plural(total, "risk")}: `;
  if (sorted.length === 0) text += "none sorted yet";
  else {
    text += listAnd(sorted);
    if (unsorted > 0) text += `; ${unsorted} still to sort`;
  }
  text += ".";
  const unowned = groups.owned.filter((r) => !r.roamOwner?.trim()).length;
  if (unowned > 0) {
    text += ` ${plural(unowned, "owned risk")} ${unowned === 1 ? "has" : "have"} no owner yet.`;
  }
  return text;
}

/* ── The keyword guess (no AI) ── */

/** The statuses a guess may give: only the room calls a risk resolved. */
export type RoamGuessStatus = Exclude<RoamStatus, "resolved">;

export interface RoamGuess {
  roam: RoamGuessStatus;
  /** Why, in a few words (at most 120 characters). */
  reason: string;
  /** What to do next (at most 160 characters). */
  action: string;
}

const OUTSIDE = /\b(?:depend\w*|vendor\w*|supplier\w*|approv\w*|legal\w*)\b/i;
const SMALL = /\b(?:might|unlikely|small\w*|minor)\b/i;
/** A note that already reads as a plan: something someone will do. */
const PLAN =
  /\b(?:we(?:'|’)ll|we will|plan(?:ned)?|by (?:mon|tue|wed|thu|fri|the end|iteration|\d)|add(?:ing)?|run(?:ning)?|test(?:ing)?|back ?up|fallback|workaround|mitigat\w*|reduce|limit|spike|prototype|pair(?:ing)?|book(?:ed)?|schedul\w*)\b/i;

/**
 * A ROAM status for a risk from its words alone, in this order: one that
 * depends on someone outside the team (a vendor, an approval, legal) is
 * owned; one that reads as unlikely or small is accepted; one whose note
 * already reads as a plan is mitigated; anything else is owned, because
 * a risk nobody owns is the one to act on.
 */
export function guessRoam(title: string, note?: string): RoamGuess {
  const words = `${title} ${note ?? ""}`;
  if (OUTSIDE.test(words)) {
    return {
      roam: "owned",
      reason: "It depends on someone outside the team.",
      action: "Name who chases it and by when.",
    };
  }
  if (SMALL.test(words)) {
    return {
      roam: "accepted",
      reason: "It reads as unlikely or small.",
      action: "Agree to live with it, and say what would make you look again.",
    };
  }
  if (note && PLAN.test(note)) {
    return {
      roam: "mitigated",
      reason: "Its note already reads as a plan.",
      action: "Check the plan has someone on it and a date.",
    };
  }
  return {
    roam: "owned",
    reason: "Nobody has taken it on yet.",
    action: "Name who owns it and when they report back.",
  };
}
