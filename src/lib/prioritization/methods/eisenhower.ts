/**
 * The Eisenhower matrix: urgent × important → Do, Schedule, Delegate or
 * Delete. Personal tasks, not backlog items: it's off the hub.
 *
 * Urgent is the toggle being Yes OR the task being due within two days
 * (overdue included), with the reason kept for the row ("Urgent because
 * it's due tomorrow"). Important is a toggle. The quadrant is derived from
 * both and never stored; a task missing either answer is "Not sorted yet",
 * never Do.
 *
 * Stored as the agent actions always did: `urgent` and `important` as the
 * strings "true" / "false", plus `dueAt` ("YYYY-MM-DD") and `delegateTo` (a
 * roster name). Rows from before hold only a hand-picked `quadrant`, which
 * maps back to the pair losslessly (Do = urgent + important, Schedule =
 * important, Delegate = urgent, Delete = neither) and is dropped on the
 * next write.
 */

import { isoDayNumber } from "@/lib/sprints/calendar";
import { todayLocalISO } from "@/lib/utils/formatters";
import {
  formatNumber,
  inputErrors,
  notScored,
  put,
  toChoice,
  toDay,
  toText,
  toValidation,
} from "./fields";
import type {
  BucketDef,
  EvalContext,
  MethodInput,
  PrioritizationMethod,
  RowFields,
  Values,
} from "./types";

export const EISENHOWER_QUADRANTS = ["do", "schedule", "delegate", "delete"] as const;
export type EisenhowerQuadrant = (typeof EISENHOWER_QUADRANTS)[number];

export const EISENHOWER_LABEL: Record<EisenhowerQuadrant, string> = {
  do: "Do",
  schedule: "Schedule",
  delegate: "Delegate",
  delete: "Delete",
};

export const EISENHOWER_MEANING: Record<EisenhowerQuadrant, string> = {
  do: "Urgent and important: do it now.",
  schedule: "Important, not urgent: put a time on it.",
  delegate: "Urgent, not important: hand it to someone.",
  delete: "Neither: drop it.",
};

/** The quadrant's sort score: Do first. */
export const EISENHOWER_SCORE: Record<EisenhowerQuadrant, number> = {
  do: 4,
  schedule: 3,
  delegate: 2,
  delete: 1,
};

/** A task due within this many days (or overdue) is urgent. */
export const URGENT_WITHIN_DAYS = 2;

const YES_NO = [
  { id: "true", label: "Yes" },
  { id: "false", label: "No" },
] as const;

const BOOL_IDS = ["true", "false"] as const;

const LEGACY_PAIR: Record<
  EisenhowerQuadrant,
  { urgent: "true" | "false"; important: "true" | "false" }
> = {
  do: { urgent: "true", important: "true" },
  schedule: { urgent: "false", important: "true" },
  delegate: { urgent: "true", important: "false" },
  delete: { urgent: "false", important: "false" },
};

const BUCKETS: readonly BucketDef[] = EISENHOWER_QUADRANTS.map((id, order) => ({
  id,
  label: EISENHOWER_LABEL[id],
  meaning: EISENHOWER_MEANING[id],
  order,
  tone:
    id === "do" ? "danger" : id === "schedule" ? "accent" : id === "delegate" ? "warning" : "muted",
}));

const INPUTS: readonly MethodInput[] = [
  {
    key: "important",
    kind: "choice",
    label: "Important? (does it move a goal)",
    hint: "Important work moves a goal forward; busy work doesn't.",
    missing: "Say whether it's important.",
    options: YES_NO,
  },
  {
    key: "urgent",
    kind: "choice",
    label: "Urgent? (does waiting cause harm soon)",
    hint: `A task due within ${URGENT_WITHIN_DAYS} days counts as urgent anyway.`,
    missing: "Say whether it's urgent.",
    options: YES_NO,
  },
  {
    key: "dueAt",
    kind: "date",
    label: "Due",
    hint: "Optional. Within two days, or overdue, makes it urgent.",
    missing: "Enter the due date.",
    optional: true,
  },
  {
    key: "delegateTo",
    kind: "person",
    label: "Who takes it?",
    hint: "Optional: who the task is handed to.",
    missing: "Pick who takes it.",
    optional: true,
  },
];

/** "true" / "false" from a stored string or boolean; undefined otherwise. */
function toBool(v: unknown): "true" | "false" | undefined {
  if (v === true) return "true";
  if (v === false) return "false";
  return toChoice(BOOL_IDS, v);
}

function read(fields: Values | undefined): Values {
  const legacy = toChoice(EISENHOWER_QUADRANTS, fields?.quadrant);
  const pair = legacy ? LEGACY_PAIR[legacy] : undefined;
  return {
    urgent: toBool(fields?.urgent) ?? pair?.urgent,
    important: toBool(fields?.important) ?? pair?.important,
    dueAt: toDay(fields?.dueAt),
    delegateTo: toText(fields?.delegateTo, 80),
  };
}

function write(fields: RowFields | undefined, v: Values): RowFields {
  const out: RowFields = { ...fields };
  // The quadrant is derived from the pair; a legacy one goes once the pair is written.
  delete out.quadrant;
  put(out, "urgent", toBool(v.urgent));
  put(out, "important", toBool(v.important));
  put(out, "dueAt", toDay(v.dueAt));
  put(out, "delegateTo", toText(v.delegateTo, 80));
  return out;
}

export interface Urgency {
  urgent: boolean | null;
  /** Why it's urgent: the toggle, or a due date within two days. */
  because: "toggle" | "due" | null;
  /** Days from today to the due date, negative when overdue; null without one. */
  daysToDue: number | null;
}

/** Whether a task is urgent today, and why. */
export function urgency(v: Values, today: string = todayLocalISO()): Urgency {
  const due = isoDayNumber(toDay(v.dueAt) ?? null);
  const now = isoDayNumber(today);
  const daysToDue = due !== null && now !== null ? due - now : null;
  const toggle = toBool(v.urgent);
  if (toggle === "true") return { urgent: true, because: "toggle", daysToDue };
  if (daysToDue !== null && daysToDue <= URGENT_WITHIN_DAYS) {
    return { urgent: true, because: "due", daysToDue };
  }
  if (toggle === "false") return { urgent: false, because: null, daysToDue };
  return { urgent: null, because: null, daysToDue };
}

/** "due today", "due tomorrow", "due in 3 days", "2 days overdue". */
export function dueText(daysToDue: number): string {
  if (daysToDue === 0) return "due today";
  if (daysToDue === 1) return "due tomorrow";
  if (daysToDue > 1) return `due in ${daysToDue} days`;
  const late = -daysToDue;
  return late === 1 ? "1 day overdue" : `${late} days overdue`;
}

/** The quadrant of a task today; null until both answers are known. */
export function eisenhowerQuadrant(v: Values, today?: string): EisenhowerQuadrant | null {
  const u = urgency(v, today);
  const important = toBool(v.important);
  if (u.urgent === null || important === undefined) return null;
  if (important === "true") return u.urgent ? "do" : "schedule";
  return u.urgent ? "delegate" : "delete";
}

export const EISENHOWER: PrioritizationMethod = {
  id: "eisenhower",
  toolId: "eisenhower",
  label: "Eisenhower",
  embedded: false,
  inputs: INPUTS,
  buckets: BUCKETS,
  read,
  write,
  validate: (draft) => toValidation(draft, inputErrors(INPUTS, draft)),
  evaluate(v, ctx?: EvalContext) {
    const r = read(v);
    const u = urgency(r, ctx?.today);
    const quadrant = eisenhowerQuadrant(r, ctx?.today);
    if (!quadrant) {
      const missing: string[] = [];
      if (r.important === undefined) missing.push("important");
      if (u.urgent === null) missing.push("urgent");
      return { ...notScored(missing), extra: { daysToDue: u.daysToDue } };
    }
    const score = EISENHOWER_SCORE[quadrant];
    return {
      score,
      bucket: quadrant,
      sortKey: score,
      missing: [],
      warnings: [],
      extra: { urgentBecause: u.because, daysToDue: u.daysToDue },
    };
  },
  format: (score) => formatNumber(score, 2),
};
