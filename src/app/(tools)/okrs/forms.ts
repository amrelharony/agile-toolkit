/**
 * The OKR Tracker's three forms as pure checks: an objective, a key result
 * and a check-in. Nothing reaches the workspace until its check passes
 * (UX contract items 1–2): "New objective" used to save a blank record at
 * once, "Add key result" a row with target 100 and confidence 5.
 *
 * A key result names where it starts (the baseline) and which way it
 * should move, and the form checks the target against both, so "Payment
 * errors down from 8% to 3%" can be written down and measured. Progress
 * itself is lib/okrs' (krProgress): nothing here computes it.
 */

import { nanoid } from "nanoid";
import {
  KR_CHECK_IN_CAP,
  type KeyResult,
  type KeyResultCheckIn,
  type KeyResultDirection,
  type Okr,
} from "@/lib/stores/workspace-types";
import { CHECK_IN_NOTE_MAX, krBaseline, krDirection } from "@/lib/okrs/progress";
import { normalizeQuarter, quarterIndex } from "@/lib/roadmap/quarters";
import { isIsoDate } from "@/lib/sprints/calendar";
import { fmt } from "@/lib/charts/chart-text";
import { parseNumber, type Validation } from "@/lib/utils/form";

/** The longest objective or key-result title saved. */
export const TITLE_MAX = 200;
/** The longest description saved. */
export const DESCRIPTION_MAX = 2000;
/** The longest unit ("%", "sign-ups", "ms"). */
export const UNIT_MAX = 24;
/** The longest owner's name: the roster's own cap (PersonInPlace). */
export const OWNER_MAX = 120;

/** One line, trimmed: pasted line breaks and runs of spaces become one space. */
const oneLine = (s: string) => s.replace(/\s+/g, " ").trim();

/* ── Objective ──────────────────────────────────────────────────────── */

export interface ObjectiveDraft {
  objective: string;
  /** "2026 Q4", or "" until one is picked. */
  quarter: string;
  owner: string;
  description: string;
}

export type ObjectiveField = keyof ObjectiveDraft;

export interface ObjectiveValues {
  objective: string;
  quarter: string;
  owner?: string;
  description?: string;
}

/** A new objective's draft: the quarter starts on the one the list is showing, if any. */
export const emptyObjective = (quarter = ""): ObjectiveDraft => ({
  objective: "",
  quarter,
  owner: "",
  description: "",
});

/**
 * The edit draft of a stored objective. A quarter written another way
 * ("Q4 2026") reads as the picker's "2026 Q4"; text that isn't a quarter
 * ("next spring") reads as none, so saving the edit asks for one.
 */
export function objectiveDraft(okr: Okr): ObjectiveDraft {
  return {
    objective: okr.objective ?? "",
    quarter: normalizeQuarter(okr.quarter),
    owner: okr.owner ?? "",
    description: okr.description ?? "",
  };
}

/** The objective is required and the quarter must be one; owner and description are optional. */
export function validateObjective(d: ObjectiveDraft): Validation<ObjectiveValues, ObjectiveField> {
  const errors: Partial<Record<ObjectiveField, string>> = {};
  const objective = oneLine(d.objective);
  const owner = d.owner.trim();
  const description = d.description.trim();
  if (!objective) errors.objective = "Say what the team wants to achieve.";
  else if (objective.length > TITLE_MAX) errors.objective = `Keep it to ${TITLE_MAX} characters.`;
  if (quarterIndex(d.quarter) === 0) errors.quarter = "Pick the quarter it's for.";
  if (owner.length > OWNER_MAX) errors.owner = `Keep the name to ${OWNER_MAX} characters.`;
  if (description.length > DESCRIPTION_MAX)
    errors.description = `Keep it to ${DESCRIPTION_MAX} characters.`;
  if (Object.keys(errors).length > 0) return { ok: false, errors };
  return {
    ok: true,
    values: {
      objective,
      quarter: normalizeQuarter(d.quarter),
      ...(owner ? { owner } : {}),
      ...(description ? { description } : {}),
    },
  };
}

/** A new objective from checked values, with no key results yet (each is added through its form). */
export function newObjective(v: ObjectiveValues): Okr {
  return { id: `okr_${nanoid(8)}`, keyResults: [], ...v };
}

/**
 * A stored objective with checked values: an emptied owner or description
 * is removed, never stored as "". Its key results are left as they are.
 */
export function withObjectiveValues(okr: Okr, v: ObjectiveValues): Okr {
  const next: Okr = { ...okr, objective: v.objective, quarter: v.quarter };
  if (v.owner) next.owner = v.owner;
  else delete next.owner;
  if (v.description) next.description = v.description;
  else delete next.description;
  return next;
}

/* ── Key result ─────────────────────────────────────────────────────── */

export interface KeyResultDraft {
  title: string;
  /** Unset until the user picks one: there is no default direction. */
  direction: KeyResultDirection | null;
  /** As typed; "" is unset (never read as 0). */
  baseline: string;
  target: string;
  unit: string;
  description: string;
}

export type KeyResultField = keyof KeyResultDraft;

export interface KeyResultValues {
  title: string;
  direction: KeyResultDirection;
  /** Absent only when editing a key result saved without one, and left blank. */
  baseline?: number;
  target: number;
  unit?: string;
  description?: string;
}

export const EMPTY_KEY_RESULT: KeyResultDraft = {
  title: "",
  direction: null,
  baseline: "",
  target: "",
  unit: "",
  description: "",
};

/** The edit draft of a stored key result; one with no baseline keeps the field blank. */
export function keyResultDraft(kr: KeyResult): KeyResultDraft {
  const base = krBaseline(kr);
  return {
    title: kr.title ?? "",
    direction: krDirection(kr),
    baseline: base === null ? "" : String(base),
    target: Number.isFinite(kr.target) ? String(kr.target) : "",
    unit: kr.unit ?? "",
    description: kr.description ?? "",
  };
}

/**
 * Check a key result. Title, direction and target are required, and so is
 * the baseline on a new one (`requireBaseline`). A key result saved before
 * baselines existed may keep none: left blank, progress still counts from 0
 * as it always did. With a baseline, the target must differ from it and
 * sit on the side the direction says: an "increase" target below its
 * baseline would read as done at once.
 */
export function validateKeyResult(
  d: KeyResultDraft,
  { requireBaseline = true }: { requireBaseline?: boolean } = {}
): Validation<KeyResultValues, KeyResultField> {
  const errors: Partial<Record<KeyResultField, string>> = {};
  const title = oneLine(d.title);
  const unit = d.unit.trim();
  const description = d.description.trim();
  const baseline = parseNumber(d.baseline);
  const target = parseNumber(d.target);
  if (!title) errors.title = "Say what will be measured.";
  else if (title.length > TITLE_MAX) errors.title = `Keep it to ${TITLE_MAX} characters.`;
  if (!d.direction) errors.direction = "Pick whether the number should go up or down.";
  if (baseline === undefined) {
    if (requireBaseline) errors.baseline = "Enter the value it starts from.";
  } else if (!Number.isFinite(baseline)) errors.baseline = "Enter a number.";
  if (target === undefined) errors.target = "Enter the value to reach.";
  else if (!Number.isFinite(target)) errors.target = "Enter a number.";
  else if (baseline !== undefined && Number.isFinite(baseline) && d.direction) {
    if (target === baseline) errors.target = "The target must differ from the baseline.";
    else if (d.direction === "increase" && target < baseline)
      errors.target = `To go up, the target must be above the baseline (${fmt(baseline, 4)}).`;
    else if (d.direction === "decrease" && target > baseline)
      errors.target = `To go down, the target must be below the baseline (${fmt(baseline, 4)}).`;
  }
  if (unit.length > UNIT_MAX) errors.unit = `Keep the unit to ${UNIT_MAX} characters.`;
  if (description.length > DESCRIPTION_MAX)
    errors.description = `Keep it to ${DESCRIPTION_MAX} characters.`;
  if (Object.keys(errors).length > 0 || !d.direction || target === undefined) {
    return { ok: false, errors };
  }
  return {
    ok: true,
    values: {
      title,
      direction: d.direction,
      ...(baseline !== undefined ? { baseline } : {}),
      target,
      ...(unit ? { unit } : {}),
      ...(description ? { description } : {}),
    },
  };
}

/**
 * A new key result: it starts at its baseline with no check-ins and no
 * confidence (not scored until someone scores it).
 */
export function newKeyResult(v: KeyResultValues): KeyResult {
  const baseline = v.baseline ?? 0;
  return {
    id: `kr_${nanoid(8)}`,
    title: v.title,
    direction: v.direction,
    baseline,
    target: v.target,
    current: baseline,
    checkIns: [],
    ...(v.unit ? { unit: v.unit } : {}),
    ...(v.description ? { description: v.description } : {}),
  };
}

/** Whether a key result has a check-in a reader can place (a real day and a value). */
const hasCheckIns = (kr: KeyResult) =>
  (kr.checkIns ?? []).some((c) => isIsoDate(c.date) && c.date.length === 10);

/**
 * A stored key result with checked values. Its check-ins, current value and
 * confidence stay; except that one with no check-in yet, still at its old
 * baseline, moves to the new baseline (it hasn't moved from where it
 * started). An emptied unit or description is removed.
 */
export function withKeyResultValues(kr: KeyResult, v: KeyResultValues): KeyResult {
  const next: KeyResult = { ...kr, title: v.title, direction: v.direction, target: v.target };
  const oldBase = krBaseline(kr);
  if (v.baseline !== undefined) {
    next.baseline = v.baseline;
    if (!hasCheckIns(kr) && oldBase !== null && kr.current === oldBase) next.current = v.baseline;
  } else delete next.baseline;
  if (v.unit) next.unit = v.unit;
  else delete next.unit;
  if (v.description) next.description = v.description;
  else delete next.description;
  return next;
}

/* ── Check-in ───────────────────────────────────────────────────────── */

export interface CheckInDraft {
  /** "YYYY-MM-DD": today to start with; can be backdated, never in the future. */
  date: string;
  /** As typed; "" until entered. */
  value: string;
  /** 0–10, or null: not scored (the default). */
  confidence: number | null;
  note: string;
}

export type CheckInField = keyof CheckInDraft;

export const emptyCheckIn = (today: string): CheckInDraft => ({
  date: today,
  value: "",
  confidence: null,
  note: "",
});

/**
 * Check a check-in against `today` ("YYYY-MM-DD") and, when given, the key
 * result it's for: a key result keeps its KR_CHECK_IN_CAP newest check-ins,
 * so a day older than every one of a full history would be dropped as soon
 * as it was saved (lib/okrs withCheckIn); the form says so instead.
 */
export function validateCheckIn(
  d: CheckInDraft,
  today: string,
  kr?: Pick<KeyResult, "checkIns">
): Validation<Omit<KeyResultCheckIn, "id">, CheckInField> {
  const errors: Partial<Record<CheckInField, string>> = {};
  const value = parseNumber(d.value);
  const note = d.note.trim();
  const date = d.date.trim();
  if (!date) errors.date = "Pick the day the value was read.";
  else if (!(date.length === 10 && isIsoDate(date))) errors.date = "Pick a day on the calendar.";
  else if (date > today) errors.date = "A check-in can't be in the future.";
  else if (kr) {
    const kept = (kr.checkIns ?? []).filter((c) => isIsoDate(c.date) && c.date.length === 10);
    const oldest = kept.reduce<string | null>(
      (a, c) => (a === null || c.date < a ? c.date : a),
      null
    );
    if (kept.length >= KR_CHECK_IN_CAP && oldest !== null && date < oldest) {
      errors.date = `Only the ${KR_CHECK_IN_CAP} newest check-ins are kept, and this day is older than all of them.`;
    }
  }
  if (value === undefined) errors.value = "Enter the value on that day.";
  else if (!Number.isFinite(value)) errors.value = "Enter a number.";
  if (d.confidence !== null && !(d.confidence >= 0 && d.confidence <= 10)) {
    errors.confidence = "Pick a confidence from 0 to 10, or clear it.";
  }
  if (note.length > CHECK_IN_NOTE_MAX)
    errors.note = `Keep the note to ${CHECK_IN_NOTE_MAX} characters.`;
  if (Object.keys(errors).length > 0 || value === undefined) return { ok: false, errors };
  return {
    ok: true,
    values: {
      date,
      value,
      ...(d.confidence !== null ? { confidence: d.confidence } : {}),
      ...(note ? { note } : {}),
    },
  };
}

/** A check-in from checked values. */
export const newCheckIn = (v: Omit<KeyResultCheckIn, "id">): KeyResultCheckIn => ({
  id: `ci_${nanoid(8)}`,
  ...v,
});
