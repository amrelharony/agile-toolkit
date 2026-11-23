/**
 * PI predictability: how much of the business value a team planned it
 * delivered. Planned value is the business value of its committed
 * objectives (the ones with a value); actual value is what the business
 * owners score each objective at the end, committed or not, so a stretch
 * goal met can lift a team above 100%. The train's total reads the scored
 * teams together, against a band the train sets (80–100% by default, a
 * common aim rather than a rule).
 *
 * A team reads "Not scored yet" until it has planned value and every
 * committed objective with a value has its actual: a half-scored PI never
 * shows as a low one. Closing a PI keeps the scored teams' numbers in the
 * board's history; the average across closed PIs shows from three.
 *
 * Pure and server-safe: Amr's `tool.pi_planning.predictability` reads it.
 */

import { listAnd, plural } from "@/lib/charts/chart-text";
import {
  DEFAULT_BAND,
  type PiBand,
  type PiObjective,
  type PiRecord,
  type PiRecordTeam,
  type PiState,
  type PiTeam,
} from "./model";

/** Closed PIs needed before their average shows. */
export const HISTORY_AVERAGE_MIN = 3;

/** Where a percentage sits against the band. */
export type BandStatus = "below" | "within" | "above";

export type TeamStatus = "nothing-planned" | "to-score" | BandStatus;

export interface TeamPredictability {
  teamId: string;
  name: string;
  /** Business value of the committed objectives that have one. */
  plannedBv: number;
  /** Actual value scored so far, over every objective. */
  actualBv: number;
  /** Committed objectives with a business value still waiting for their actual. */
  toScore: number;
  /** Actual over planned, as a whole percentage; null until the team is scored. */
  pct: number | null;
  status: TeamStatus;
}

export interface PiPredictability {
  band: PiBand;
  teams: TeamPredictability[];
  /** The scored teams together; null while no team is scored. */
  total: {
    plannedBv: number;
    actualBv: number;
    pct: number;
    status: BandStatus;
    /** How many teams it covers. */
    teams: number;
  } | null;
}

/** The band the board is read against: the train's own, or the common aim. */
export const bandOf = (state: Pick<PiState, "band">): PiBand => state.band ?? DEFAULT_BAND;

export const bandText = (band: PiBand): string => `${band.low}–${band.high}%`;

/** Actual over planned, as a whole percentage. */
export const pctOf = (actual: number, planned: number): number =>
  Math.round((actual / planned) * 100);

export function bandStatus(pct: number, band: PiBand): BandStatus {
  if (pct < band.low) return "below";
  if (pct > band.high) return "above";
  return "within";
}

/** Planned value counts committed objectives with a business value only. */
const isPlanned = (o: PiObjective): o is PiObjective & { businessValue: number } =>
  o.committed && typeof o.businessValue === "number";

export function teamPredictability(state: PiState, team: PiTeam): TeamPredictability {
  const mine = (state.objectives ?? []).filter((o) => o.teamId === team.id);
  const planned = mine.filter(isPlanned);
  const plannedBv = planned.reduce((a, o) => a + o.businessValue, 0);
  const actualBv = mine.reduce((a, o) => a + (o.actualBusinessValue ?? 0), 0);
  const toScore = planned.filter((o) => o.actualBusinessValue === undefined).length;
  const base = { teamId: team.id, name: team.name, plannedBv, actualBv, toScore };
  if (plannedBv === 0) return { ...base, pct: null, status: "nothing-planned" };
  if (toScore > 0) return { ...base, pct: null, status: "to-score" };
  const pct = pctOf(actualBv, plannedBv);
  return { ...base, pct, status: bandStatus(pct, bandOf(state)) };
}

/** Every team's predictability, and the scored teams' total. */
export function piPredictability(state: PiState): PiPredictability {
  const band = bandOf(state);
  const teams = state.teams.map((t) => teamPredictability(state, t));
  const scored = teams.filter((t) => t.pct !== null);
  if (scored.length === 0) return { band, teams, total: null };
  const plannedBv = scored.reduce((a, t) => a + t.plannedBv, 0);
  const actualBv = scored.reduce((a, t) => a + t.actualBv, 0);
  const pct = pctOf(actualBv, plannedBv);
  return {
    band,
    teams,
    total: { plannedBv, actualBv, pct, status: bandStatus(pct, band), teams: scored.length },
  };
}

/** A team's number in words: "94%", or why there is none yet. */
export function teamPctText(t: Pick<TeamPredictability, "pct" | "status" | "toScore">): string {
  if (t.pct !== null) return `${t.pct}%`;
  if (t.status === "to-score") return `${plural(t.toScore, "objective")} to score`;
  return "Not scored yet";
}

/**
 * One sentence on the PI's predictability:
 *
 *   "Checkout 94% and Payments 75% against an aim of 80–100%; the train
 *    88%. Mobile has 1 objective to score."
 */
export function predictabilityVerdict(p: PiPredictability): string {
  if (p.teams.length === 0) return "No teams on the board yet.";
  const scored = p.teams.filter((t) => t.pct !== null);
  const waiting = p.teams.filter((t) => t.status === "to-score");
  if (!p.total) {
    if (waiting.length === 0) {
      return "Not scored yet: give committed objectives a business value, then score what each delivered.";
    }
    return `Not scored yet: ${listAnd(
      waiting.map((t) => `${t.name || "A team"} has ${plural(t.toScore, "objective")}`)
    )} to score.`;
  }
  let text = `${listAnd(scored.map((t) => `${t.name || "A team"} ${t.pct}%`))} against an aim of ${bandText(
    p.band
  )}`;
  if (scored.length > 1) text += `; the train ${p.total.pct}%`;
  text += ".";
  if (waiting.length > 0) {
    text += ` ${listAnd(
      waiting.map((t) => `${t.name || "A team"} has ${plural(t.toScore, "objective")}`)
    )} to score.`;
  }
  return text;
}

/**
 * The PI as a closed record: the scored teams' planned and actual value.
 * Null when no team is scored, as there would be nothing to keep.
 */
export function recordFrom(
  state: PiState,
  meta: { id: string; name: string; closedAt: string }
): PiRecord | null {
  const teams: PiRecordTeam[] = piPredictability(state)
    .teams.filter((t) => t.pct !== null)
    .map((t) => ({ teamId: t.teamId, name: t.name, plannedBv: t.plannedBv, actualBv: t.actualBv }));
  if (teams.length === 0) return null;
  return { id: meta.id, name: meta.name, closedAt: meta.closedAt, teams };
}

/**
 * The newest closed PI when closing now would only repeat it: the same
 * teams with the same planned and actual value, under the same name when
 * the PI has one. Closing keeps the board as it is, so pressing it again
 * would keep the same PI twice and count it twice in the average. Null
 * when closing now keeps something new.
 */
export function repeatedClose(state: PiState): PiRecord | null {
  const history = state.history ?? [];
  const newest = history[history.length - 1];
  if (!newest) return null;
  const record = recordFrom(state, { id: "", name: "", closedAt: "" });
  if (!record || record.teams.length !== newest.teams.length) return null;
  const same = record.teams.every((t, i) => {
    const n = newest.teams[i];
    return n.teamId === t.teamId && n.plannedBv === t.plannedBv && n.actualBv === t.actualBv;
  });
  if (!same) return null;
  const name = state.name?.trim();
  return !name || name === newest.name ? newest : null;
}

/** A closed PI's predictability: its teams together, or null when it planned nothing. */
export function recordPct(record: Pick<PiRecord, "teams">): number | null {
  const planned = record.teams.reduce((a, t) => a + t.plannedBv, 0);
  if (planned <= 0) return null;
  return pctOf(
    record.teams.reduce((a, t) => a + t.actualBv, 0),
    planned
  );
}

/**
 * The average predictability of the closed PIs, once at least
 * HISTORY_AVERAGE_MIN of them have a number; null before. No trend is
 * read from so few points.
 */
export function historyAverage(
  history: readonly PiRecord[] | undefined
): { pct: number; count: number } | null {
  const pcts = (history ?? []).map(recordPct).filter((p): p is number => p !== null);
  if (pcts.length < HISTORY_AVERAGE_MIN) return null;
  return { pct: Math.round(pcts.reduce((a, p) => a + p, 0) / pcts.length), count: pcts.length };
}
