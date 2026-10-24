/**
 * The agenda editor's draft: the total and each segment's name, minutes and
 * turn-taking, kept consistent while the team types. Changing the total
 * re-splits the segments in their current proportions; changing a segment
 * moves the total. Pure, for ./agenda-card.tsx and its tests.
 */

import { parseNumber, type FormErrors, type Validation } from "@/lib/utils/form";
import {
  MAX_AGENDA_MINUTES,
  MIN_SEGMENT_MINUTES,
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
}

export interface AgendaDraft {
  total: string;
  rows: DraftRow[];
}

/** Error keys: "total", "label:<segment id>", "minutes:<segment id>". */
export type AgendaErrorKey = string;

export function draftOf(agenda: Agenda): AgendaDraft {
  const rows = agenda.segments.map((s) => ({
    id: s.id,
    label: s.label,
    // A Custom time-box with no length yet starts blank, not "0".
    minutes: s.seconds > 0 ? minutesValue(s.seconds) : "",
    speakers: s.speakers,
  }));
  const total = agenda.segments.reduce((sum, s) => sum + s.seconds, 0);
  return { total: total > 0 ? minutesValue(total) : "", rows };
}

/** Minutes a segment (or the total, `max` given) can be, else null. */
function usableMinutes(raw: string, min: number, max: number): number | null {
  const n = parseNumber(raw);
  if (n === undefined || !Number.isFinite(n) || n < min || n > max) return null;
  return n;
}

/** The draft after the total was typed: the segments follow when it is usable. */
export function withTotal(draft: AgendaDraft, raw: string): AgendaDraft {
  const n = draft.rows.length;
  const total = usableMinutes(raw, MIN_SEGMENT_MINUTES * n, MAX_AGENDA_MINUTES);
  if (total === null) return { ...draft, total: raw };
  // Current proportions; a blank or unusable segment counts as one share.
  const weights = draft.rows.map(
    (r) => usableMinutes(r.minutes, MIN_SEGMENT_MINUTES, MAX_AGENDA_MINUTES) ?? 1
  );
  const seconds = splitSeconds(total * 60, weights);
  return {
    total: raw,
    rows: draft.rows.map((r, i) => ({ ...r, minutes: minutesValue(seconds[i]) })),
  };
}

/** The draft after a segment's minutes were typed: the total follows when all add up. */
export function withRowMinutes(draft: AgendaDraft, id: string, raw: string): AgendaDraft {
  const rows = draft.rows.map((r) => (r.id === id ? { ...r, minutes: raw } : r));
  const mins = rows.map((r) => usableMinutes(r.minutes, MIN_SEGMENT_MINUTES, MAX_AGENDA_MINUTES));
  if (mins.some((m) => m === null)) return { ...draft, rows };
  const sum = (mins as number[]).reduce((a, b) => a + Math.round(b * 60), 0);
  return { total: minutesValue(sum), rows };
}

const RANGE = `from ${MIN_SEGMENT_MINUTES} to ${MAX_AGENDA_MINUTES}`;

/**
 * Every segment needs a name and minutes in range, and the whole agenda
 * fits a working day. Nothing is filled in for the team: a blank stays an
 * error until they type something.
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
    const n = parseNumber(row.minutes);
    if (n === undefined) errors[`minutes:${row.id}`] = "Enter the minutes.";
    else if (!Number.isFinite(n) || n < MIN_SEGMENT_MINUTES || n > MAX_AGENDA_MINUTES) {
      errors[`minutes:${row.id}`] = `Minutes run ${RANGE}.`;
    }
    const seg = base.segments.find((s) => s.id === row.id);
    if (seg && label && n !== undefined && Number.isFinite(n)) {
      segments.push({ ...seg, label, seconds: Math.round(n * 60), speakers: row.speakers });
    }
  }

  const sum = segments.reduce((s, x) => s + x.seconds, 0);
  const n = draft.rows.length;
  if (n > 1) {
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
