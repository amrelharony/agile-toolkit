/**
 * The NPS / CSAT response form as a pure check. The score starts unset: the
 * old form started on 8 (and went back to 8, or 4 for CSAT, after every
 * save), so one careless Add logged a passive nobody gave. The scale, the
 * tags and every number are lib/nps's: isValidScore judges a score the way
 * the agent's record and the workspace CRUD do, and tagsProblem stops a
 * tag list that would be cut before anything is cut.
 */

import { nanoid } from "nanoid";
import type { NpsResponse } from "@/lib/stores/workspace-types";
import {
  SCORE_RANGE,
  isValidScore,
  normalizeTags,
  tagsProblem,
  type SurveyKind,
} from "@/lib/nps/score";
import { isIsoDate } from "@/lib/sprints/calendar";
import type { Validation } from "@/lib/utils/form";

/** The longest respondent saved: a name or an email. */
export const RESPONDENT_MAX = 120;
/** The longest verbatim saved. */
export const VERBATIM_MAX = 4000;

export interface ResponseDraft {
  /** Unset until picked: there is no default survey. */
  kind: SurveyKind | null;
  /** Unset until picked (never 8). */
  score: number | null;
  /** "YYYY-MM-DD"; today to start with, backdated freely, never in the future. */
  date: string;
  respondent: string;
  verbatim: string;
  /** Comma-separated, as typed. */
  tags: string;
}

export type ResponseField = keyof ResponseDraft;

export interface ResponseValues {
  kind: SurveyKind;
  score: number;
  date: string;
  respondent?: string;
  verbatim?: string;
  /** Lower-case and once each (normalizeTags); [] for none. */
  tags: string[];
}

/** A fresh draft. After a save the form keeps the survey and the day (entering one survey's answers). */
export const emptyResponse = (date: string, kind: SurveyKind | null = null): ResponseDraft => ({
  kind,
  score: null,
  date,
  respondent: "",
  verbatim: "",
  tags: "",
});

/** The edit draft of a stored response. A score off the kind's scale reads as unset. */
export function responseDraft(r: NpsResponse): ResponseDraft {
  const range = SCORE_RANGE[r.kind] ?? SCORE_RANGE.nps;
  const onScale = Number.isFinite(r.score) && r.score >= range.min && r.score <= range.max;
  return {
    kind: r.kind === "csat" ? "csat" : "nps",
    score: onScale ? r.score : null,
    date: typeof r.date === "string" ? r.date.slice(0, 10) : "",
    respondent: r.respondent ?? "",
    verbatim: r.verbatim ?? "",
    tags: (r.tags ?? []).join(", "),
  };
}

/** "An NPS score is 0–10", for the score's hint and error. */
export const scaleText = (kind: SurveyKind) =>
  `${kind === "nps" ? "NPS" : "CSAT"} is ${SCORE_RANGE[kind].min}–${SCORE_RANGE[kind].max}`;

/**
 * Check a response against `today` ("YYYY-MM-DD"). Survey, score and day
 * are required; respondent, verbatim and tags are optional. `keepScore` and
 * `keepKind` are the score an edited row already holds and its survey: a
 * fraction saved before Phase 8 (7.5) stays as it is unless the user picks
 * a new one, but only on that survey. Switched to the other one, the old
 * score is judged like any other, so an NPS 8 is never saved as CSAT 8.
 */
export function validateResponse(
  d: ResponseDraft,
  today: string,
  { keepScore, keepKind }: { keepScore?: number; keepKind?: SurveyKind } = {}
): Validation<ResponseValues, ResponseField> {
  const errors: Partial<Record<ResponseField, string>> = {};
  const date = d.date.trim();
  const respondent = d.respondent.trim();
  const verbatim = d.verbatim.trim();
  const kept = d.kind !== null && d.kind === keepKind && d.score === keepScore;
  if (!d.kind) errors.kind = "Pick NPS or CSAT.";
  if (d.score === null) errors.score = "Pick the score the customer gave.";
  else if (d.kind && !isValidScore(d.kind, d.score) && !kept)
    errors.score = `${scaleText(d.kind)}: pick a whole score on it.`;
  if (!date) errors.date = "Pick the day the answer was given.";
  else if (!(date.length === 10 && isIsoDate(date))) errors.date = "Pick a day on the calendar.";
  else if (date > today) errors.date = "An answer can't be dated in the future.";
  if (respondent.length > RESPONDENT_MAX)
    errors.respondent = `Keep it to ${RESPONDENT_MAX} characters.`;
  if (verbatim.length > VERBATIM_MAX) errors.verbatim = `Keep it to ${VERBATIM_MAX} characters.`;
  const tagIssue = tagsProblem(d.tags);
  if (tagIssue) errors.tags = tagIssue;
  if (Object.keys(errors).length > 0 || !d.kind || d.score === null) {
    return { ok: false, errors };
  }
  return {
    ok: true,
    values: {
      kind: d.kind,
      score: d.score,
      date,
      ...(respondent ? { respondent } : {}),
      ...(verbatim ? { verbatim } : {}),
      tags: normalizeTags(d.tags),
    },
  };
}

/** A new response from checked values; no empty tags list is stored. */
export function newResponse(v: ResponseValues): NpsResponse {
  const { tags, ...rest } = v;
  return { id: `nps_${nanoid(8)}`, ...rest, ...(tags.length > 0 ? { tags } : {}) };
}

/** A stored response with checked values: an emptied respondent, verbatim or tag list is removed. */
export function withResponseValues(r: NpsResponse, v: ResponseValues): NpsResponse {
  const next: NpsResponse = { ...r, kind: v.kind, score: v.score, date: v.date };
  if (v.respondent) next.respondent = v.respondent;
  else delete next.respondent;
  if (v.verbatim) next.verbatim = v.verbatim;
  else delete next.verbatim;
  if (v.tags.length > 0) next.tags = v.tags;
  else delete next.tags;
  return next;
}
