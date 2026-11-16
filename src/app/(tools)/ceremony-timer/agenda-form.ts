/**
 * The agenda editor's draft: the total and each segment's name, minutes and
 * turn-taking, kept consistent while the team types. Changing the total
 * re-splits the segments in the proportions they had before the team began
 * typing it; changing a segment moves the total. Segments can be added,
 * removed and moved up or down, and a named agenda's draft carries its
 * name. Pure, for ./agenda-card.tsx and its tests.
 */

import { nameKey } from "@/lib/team/names";
import { parseNumber, type FormErrors, type Validation } from "@/lib/utils/form";
import {
  AGENDA_NAME_MAX,
  MAX_AGENDA_MINUTES,
  MAX_NAMED_AGENDAS,
  MAX_SEGMENTS,
  MIN_SEGMENT_MINUTES,
  SEGMENT_LABEL_MAX,
  minutesValue,
  splitSeconds,
  type Agenda,
  type Segment,
} from "./agenda";

export interface DraftRow {
  id: string;
  label: string;
  minutes: string;
  speakers: boolean;
  /** What happens in it: kept from the segment, not edited here. */
  hint?: string;
}

export interface AgendaDraft {
  total: string;
  rows: DraftRow[];
  /**
   * Each row's share when the total is re-split: the proportions the team
   * last set, kept apart from the rows' rounded minutes. Typing "60" passes
   * through "6", and splitting by the rows that one keystroke rounded would
   * leave the retro at 10 / 20 / 10 / 10 / 10 instead of 7 / 20 / 13 / 13 / 7.
   */
  weights: number[];
  /** A named agenda's name, as typed; absent for a built-in agenda. */
  name?: string;
}

/** Error keys: "total", "name", "label:<segment id>", "minutes:<segment id>". */
export type AgendaErrorKey = string;

/** The minutes a new segment starts with. */
export const NEW_SEGMENT_MINUTES = 5;

export function draftOf(agenda: Agenda): AgendaDraft {
  const rows = agenda.segments.map((s) => ({
    id: s.id,
    label: s.label,
    // A Custom time-box with no length yet starts blank, not "0".
    minutes: s.seconds > 0 ? minutesValue(s.seconds) : "",
    speakers: s.speakers,
    ...(s.hint ? { hint: s.hint } : {}),
  }));
  const total = agenda.segments.reduce((sum, s) => sum + s.seconds, 0);
  return {
    total: total > 0 ? minutesValue(total) : "",
    rows,
    weights: agenda.segments.map((s) => s.seconds),
    ...(agenda.saved ? { name: agenda.label } : {}),
  };
}

/** Minutes a segment (or the total, `max` given) can be, else null. */
function usableMinutes(raw: string, min: number, max: number): number | null {
  const n = parseNumber(raw);
  if (n === undefined || !Number.isFinite(n) || n < min || n > max) return null;
  return n;
}

/**
 * The draft after the total was typed: the segments follow when it is
 * usable, split by the draft's weights, which typing the total never moves.
 */
export function withTotal(draft: AgendaDraft, raw: string): AgendaDraft {
  const n = draft.rows.length;
  const total = usableMinutes(raw, MIN_SEGMENT_MINUTES * n, MAX_AGENDA_MINUTES);
  if (total === null) return { ...draft, total: raw };
  const seconds = splitSeconds(total * 60, draft.weights);
  return {
    ...draft,
    total: raw,
    rows: draft.rows.map((r, i) => ({ ...r, minutes: minutesValue(seconds[i]) })),
  };
}

/**
 * The draft with `rows` as they now read: the total follows when all add
 * up, and the rows become the proportions for the next change of total (a
 * blank or unusable segment counts as one minute).
 */
function withRows(draft: AgendaDraft, rows: DraftRow[]): AgendaDraft {
  const mins = rows.map((r) => usableMinutes(r.minutes, MIN_SEGMENT_MINUTES, MAX_AGENDA_MINUTES));
  const weights = mins.map((m) => (m === null ? 1 : m));
  if (mins.some((m) => m === null)) return { ...draft, rows, weights };
  const sum = (mins as number[]).reduce((a, b) => a + Math.round(b * 60), 0);
  return { ...draft, total: minutesValue(sum), rows, weights };
}

/** The draft after a segment's minutes were typed. */
export function withRowMinutes(draft: AgendaDraft, id: string, raw: string): AgendaDraft {
  return withRows(
    draft,
    draft.rows.map((r) => (r.id === id ? { ...r, minutes: raw } : r))
  );
}

/**
 * A new segment at the end: no name yet (the team names it, so a blank is
 * an error on save rather than a made-up name) and five minutes, which the
 * total takes on. Nothing changes once the agenda has MAX_SEGMENTS.
 */
export function withAddedRow(draft: AgendaDraft, id: string): AgendaDraft {
  if (draft.rows.length >= MAX_SEGMENTS || draft.rows.some((r) => r.id === id)) return draft;
  return withRows(draft, [
    ...draft.rows,
    { id, label: "", minutes: String(NEW_SEGMENT_MINUTES), speakers: false },
  ]);
}

/** The draft without segment `id`; the last segment always stays. */
export function withoutRow(draft: AgendaDraft, id: string): AgendaDraft {
  if (draft.rows.length <= 1) return draft;
  const rows = draft.rows.filter((r) => r.id !== id);
  return rows.length === draft.rows.length ? draft : withRows(draft, rows);
}

/** Segment `id` moved one place up (-1) or down (+1); at either end nothing changes. */
export function withMovedRow(draft: AgendaDraft, id: string, delta: -1 | 1): AgendaDraft {
  const from = draft.rows.findIndex((r) => r.id === id);
  const to = from + delta;
  if (from < 0 || to < 0 || to >= draft.rows.length) return draft;
  const rows = draft.rows.slice();
  const weights = draft.weights.slice();
  [rows[from], rows[to]] = [rows[to], rows[from]];
  [weights[from], weights[to]] = [weights[to], weights[from]];
  return { ...draft, rows, weights };
}

const RANGE = `from ${MIN_SEGMENT_MINUTES} to ${MAX_AGENDA_MINUTES}`;

/**
 * Every segment needs a name and minutes in range, and the whole agenda
 * fits a working day. Nothing is filled in for the team: a blank stays an
 * error until they type something. Segments come back in the draft's
 * order; one the base agenda doesn't have (added in the editor) is built
 * from its row.
 */
export function validateAgenda(
  draft: AgendaDraft,
  base: Agenda
): Validation<Segment[], AgendaErrorKey> {
  const errors: FormErrors<AgendaErrorKey> = {};
  const segments: Segment[] = [];
  for (const row of draft.rows) {
    const label = row.label.trim();
    if (!label) errors[`label:${row.id}`] = "Name this segment.";
    else if (label.length > SEGMENT_LABEL_MAX) {
      errors[`label:${row.id}`] = `Keep the name to ${SEGMENT_LABEL_MAX} characters.`;
    }
    const n = parseNumber(row.minutes);
    if (n === undefined) errors[`minutes:${row.id}`] = "Enter the minutes.";
    else if (!Number.isFinite(n) || n < MIN_SEGMENT_MINUTES || n > MAX_AGENDA_MINUTES) {
      errors[`minutes:${row.id}`] = `Minutes run ${RANGE}.`;
    }
    const seg = base.segments.find((s) => s.id === row.id) ?? {
      id: row.id,
      label,
      seconds: 0,
      speakers: false,
      hint: row.hint ?? "",
    };
    if (label && n !== undefined && Number.isFinite(n)) {
      segments.push({ ...seg, label, seconds: Math.round(n * 60), speakers: row.speakers });
    }
  }

  const sum = segments.reduce((s, x) => s + x.seconds, 0);
  const n = draft.rows.length;
  if (n === 0) errors.total = "Add at least one segment.";
  else if (n > MAX_SEGMENTS) errors.total = `An agenda holds up to ${MAX_SEGMENTS} segments.`;
  else if (n > 1) {
    const total = parseNumber(draft.total);
    if (total === undefined) errors.total = "Enter the total minutes.";
    else if (!Number.isFinite(total) || total <= 0) {
      errors.total = "Enter the total as a number of minutes.";
    } else if (total < MIN_SEGMENT_MINUTES * n) {
      errors.total = `${n} segments need at least ${MIN_SEGMENT_MINUTES * n} minutes.`;
    } else if (total > MAX_AGENDA_MINUTES) {
      errors.total = `The agenda can run up to ${MAX_AGENDA_MINUTES} minutes.`;
    } else if (Object.keys(errors).length === 0 && Math.abs(Math.round(total * 60) - sum) > 1) {
      // Only reachable by hand-editing the draft: typing keeps the two in step.
      errors.total = `The segments add up to ${minutesValue(sum)} minutes.`;
    }
  }
  return Object.keys(errors).length > 0 ? { ok: false, errors } : { ok: true, values: segments };
}

/**
 * A name for an agenda saved by name: required, not too long, and not one
 * another agenda has (any case). `others` are the names it must not repeat
 * (the built-in agendas' and the other saved ones'); `count` is how many
 * named agendas there are besides this one.
 */
export function validateAgendaName(
  raw: string,
  others: readonly string[],
  count = 0
): Validation<string, "name"> {
  const name = raw.trim();
  if (!name) return { ok: false, errors: { name: "Name the agenda." } };
  if (name.length > AGENDA_NAME_MAX) {
    return { ok: false, errors: { name: `Keep the name to ${AGENDA_NAME_MAX} characters.` } };
  }
  const taken = others.find((o) => nameKey(o) === nameKey(name));
  if (taken) return { ok: false, errors: { name: `“${taken}” is already an agenda.` } };
  if (count >= MAX_NAMED_AGENDAS) {
    return {
      ok: false,
      errors: { name: `You can save up to ${MAX_NAMED_AGENDAS} agendas. Delete one first.` },
    };
  }
  return { ok: true, values: name };
}
