/**
 * Decision records: one entity, workspace.decisions, for the Decision Log,
 * DACI and RAPID. `template` says which form a record was raised with
 * (absent: "adr"), the ADR lifecycle (proposed, accepted, deprecated,
 * superseded) is the status for all three, and DACI/RAPID's "implemented"
 * and "revisit" are dates on the record (`implementedAt`, `reopenedAt`).
 * Every record gets a number from one sequence across the templates
 * (ADR-0003, DACI-0004).
 *
 * DACI and RAPID rows from before the merge (workspace.daciDecisions,
 * workspace.rapidDecisions) are read through as decisions under their own
 * ids, the way the standup merge reads old async updates (lib/standup/
 * entries): an edit writes a Decision under the same id, which shadows the
 * old row from then on, and the old row stays behind as the backup.
 *
 * Shared by the Decision Log page on all three routes, the "decision"
 * hand-off, RFC Tracker's push, the weighted-decision send and the
 * tool.decision_log / tool.daci / tool.rapid_decision agent actions, so all
 * of them read a record the same way. Pure and server-safe: nothing here
 * imports a "use client" module, React or the store.
 */

import type {
  DACIDecision,
  Decision,
  DecisionOption,
  DecisionRole,
  DecisionStatus,
  DecisionTemplate,
  HandoffRef,
  RAPIDDecision,
} from "@/lib/stores/workspace-types";
import {
  DECISION_ROLES,
  DECISION_STATUSES,
  DECISION_TEMPLATES,
} from "@/lib/stores/workspace-types";
import type { HandoffSource } from "@/lib/handoffs/types";
import { enoughData } from "@/lib/analytics/min-sample";
import { isIsoDate, isoDayNumber } from "@/lib/sprints/calendar";
import { nameKey } from "@/lib/team/names";
import { isExampleId } from "@/lib/utils/example-id";
import { todayLocalISO } from "@/lib/utils/formatters";
import { SINGLE_ROLES, TEMPLATES } from "./templates";

export { DECISION_ROLES, DECISION_STATUSES, DECISION_TEMPLATES };

export const DECISION_TITLE_MAX = 300;
export const DECISION_TEXT_MAX = 4000;

/** More people than this in RAPID's Agree list is a warning: each one is a veto. */
export const MANY_AGREE = 3;
/** A proposal open longer than this many days is waiting too long. */
export const STALE_PROPOSED_DAYS = 14;

/**
 * Lifecycle order. Two copies of one record (the Decision Log's old blob
 * and the workspace row a hand-off wrote beside it) keep the later status;
 * deprecated and superseded are both the end of a record's life.
 */
export const STATUS_RANK: Readonly<Record<DecisionStatus, number>> = {
  proposed: 0,
  accepted: 1,
  deprecated: 2,
  superseded: 2,
};

/** The number prefix per template: ADR-0003, DACI-0004, RAPID-0005. */
export const DECISION_PREFIX: Readonly<Record<DecisionTemplate, string>> = {
  adr: "ADR",
  daci: "DACI",
  rapid: "RAPID",
};

const isStatus = (v: unknown): v is DecisionStatus =>
  (DECISION_STATUSES as readonly unknown[]).includes(v);
const isTemplate = (v: unknown): v is DecisionTemplate =>
  (DECISION_TEMPLATES as readonly unknown[]).includes(v);

/** Decided: accepted, or decided and since deprecated or superseded. A hand-off's "done". */
export function isDecided(status: DecisionStatus | undefined): boolean {
  return status === "accepted" || status === "deprecated" || status === "superseded";
}

/** The form a record uses: absent (every record from before templates) or unknown is "adr". */
export function templateOf(d: Pick<Decision, "template">): DecisionTemplate {
  return isTemplate(d.template) ? d.template : "adr";
}

/**
 * The options a record weighed. A pre-template ADR kept them as
 * `alternatives`, one per line: those read as options (blank lines
 * dropped), with ids made from the record's id and their place, so the
 * same line keeps the same id until the options are first saved.
 */
export function optionsOf(d: Pick<Decision, "id" | "options" | "alternatives">): DecisionOption[] {
  if (d.options) return d.options;
  return (d.alternatives ?? [])
    .map((text) => (typeof text === "string" ? text.trim() : ""))
    .filter(Boolean)
    .map((text, i) => ({ id: `${d.id}-a${i}`, text }));
}

/** Who holds `role` on a record (roster spellings), or none. */
export function roleHolders(d: Pick<Decision, "roles">, role: DecisionRole): string[] {
  return d.roles?.[role] ?? [];
}

/** Where "Open" goes for one record: the Decision Log, scrolled to it. */
export function decisionHref(id: string): string {
  return `/decision-log?id=${encodeURIComponent(id)}`;
}

/* ── Reading stored rows ─────────────────────────────────────────────── */

const DAY = /^\d{4}-\d{2}-\d{2}$/;

/**
 * A stored day as "YYYY-MM-DD", or undefined. DACI and RAPID stamped
 * `new Date().toISOString()`, and agents could store a timestamp through the
 * generic CRUD: a timestamp reads as its first ten characters (its UTC
 * day), the same on the page and on the server, as mood check-ins do.
 */
function dayOf(v: unknown): string | undefined {
  return typeof v === "string" && isIsoDate(v) ? v.slice(0, 10) : undefined;
}

/** Whole days from one day to another, or null when either isn't a day. */
function daysFrom(from: string | undefined, to: string | undefined): number | null {
  const a = isoDayNumber(from);
  const b = isoDayNumber(to);
  return a === null || b === null ? null : b - a;
}

/** A stored text field, trimmed, or undefined when it isn't a string or is blank. */
function textOf(v: unknown): string | undefined {
  return typeof v === "string" && v.trim() ? v.trim() : undefined;
}

/** Names in a stored list, trimmed, with blanks and repeats (in any case) dropped. */
function namesOf(v: unknown): string[] {
  if (!Array.isArray(v)) return [];
  const seen = new Set<string>();
  const names: string[] = [];
  for (const x of v) {
    if (typeof x !== "string") continue;
    const key = nameKey(x);
    if (!key || seen.has(key)) continue;
    seen.add(key);
    names.push(x.trim());
  }
  return names;
}

/** The named roles in a stored value: known roles only, single roles held by one person. */
function rolesOf(v: unknown): Decision["roles"] {
  if (!v || typeof v !== "object") return undefined;
  const raw = v as Record<string, unknown>;
  const roles: Partial<Record<DecisionRole, string[]>> = {};
  for (const role of DECISION_ROLES) {
    const names = namesOf(raw[role]);
    if (names.length > 0) roles[role] = SINGLE_ROLES.has(role) ? names.slice(0, 1) : names;
  }
  return Object.keys(roles).length > 0 ? roles : undefined;
}

function refOf(v: unknown): HandoffRef | undefined {
  if (!v || typeof v !== "object") return undefined;
  const r = v as Record<string, unknown>;
  if (typeof r.tool !== "string" || !r.tool || typeof r.id !== "string" || !r.id) return undefined;
  return { tool: r.tool, id: r.id, ...(typeof r.doc === "string" && r.doc ? { doc: r.doc } : {}) };
}

/** A stored options list (blank options and repeated ids dropped), or undefined when there is none. */
function optionListOf(v: unknown): DecisionOption[] | undefined {
  if (!Array.isArray(v)) return undefined;
  const seen = new Set<string>();
  const options: DecisionOption[] = [];
  for (const o of v) {
    if (!o || typeof o !== "object") continue;
    const { id, text, note } = o as Record<string, unknown>;
    const t = textOf(text);
    if (typeof id !== "string" || !id || !t || seen.has(id)) continue;
    seen.add(id);
    const n = textOf(note);
    options.push({ id, text: t, ...(n ? { note: n } : {}) });
  }
  return options;
}

/**
 * A stored record in today's shape, or null when it can't be one (no id).
 * For the Decision Log's old blob rows and rows read on the server: a
 * status outside the lifecycle reads as proposed, a timestamp as its day
 * (a date that isn't one as "", unknown), blank alternatives are dropped,
 * and only known roles are kept. Every Phase 7 field carries over when
 * present.
 */
export function normalizeDecision(raw: unknown): Decision | null {
  if (!raw || typeof raw !== "object") return null;
  const r = raw as Record<string, unknown>;
  const id = typeof r.id === "string" && r.id.trim() ? r.id : null;
  if (!id) return null;
  const context = textOf(r.context);
  const consequences = textOf(r.consequences);
  const alternatives = Array.isArray(r.alternatives)
    ? r.alternatives.map(textOf).filter((a): a is string => a !== undefined)
    : [];
  const sourceRef = refOf(r.sourceRef);
  const number =
    typeof r.number === "number" && Number.isInteger(r.number) && r.number > 0
      ? r.number
      : undefined;
  const options = optionListOf(r.options);
  const chosenOptionId = textOf(r.chosenOptionId);
  const recommendation = textOf(r.recommendation);
  const decider = textOf(r.decider);
  const roles = rolesOf(r.roles);
  const decidedAt = dayOf(r.decidedAt);
  const implementedAt = dayOf(r.implementedAt);
  const reopenedAt = dayOf(r.reopenedAt);
  const supersededBy = textOf(r.supersededBy);
  return {
    id,
    title: typeof r.title === "string" ? r.title.trim() : "",
    ...(context ? { context } : {}),
    decision: typeof r.decision === "string" ? r.decision.trim() : "",
    ...(consequences ? { consequences } : {}),
    ...(alternatives.length > 0 ? { alternatives } : {}),
    status: isStatus(r.status) ? r.status : "proposed",
    date: dayOf(r.date) ?? "",
    ...(sourceRef ? { sourceRef } : {}),
    ...(isTemplate(r.template) ? { template: r.template } : {}),
    ...(number !== undefined ? { number } : {}),
    ...(options ? { options } : {}),
    ...(chosenOptionId ? { chosenOptionId } : {}),
    ...(recommendation ? { recommendation } : {}),
    ...(decider ? { decider } : {}),
    ...(roles ? { roles } : {}),
    ...(decidedAt ? { decidedAt } : {}),
    ...(implementedAt ? { implementedAt } : {}),
    ...(reopenedAt ? { reopenedAt } : {}),
    ...(supersededBy ? { supersededBy } : {}),
  };
}

const DATE_FIELDS = ["decidedAt", "implementedAt", "reopenedAt"] as const;

/**
 * A workspace row with its dates read as days (an agent may have stored a
 * timestamp through the generic CRUD). The row itself when they already
 * are, so a list read twice holds the same objects.
 */
function storedRow(d: Decision): Decision {
  const odd = (v: string | undefined) => typeof v === "string" && v !== "" && !DAY.test(v);
  if (!odd(d.date) && !DATE_FIELDS.some((f) => odd(d[f]))) return d;
  const next: Decision = { ...d, date: odd(d.date) ? (dayOf(d.date) ?? "") : d.date };
  for (const f of DATE_FIELDS) {
    if (!odd(d[f])) continue;
    const day = dayOf(d[f]);
    if (day) next[f] = day;
    else delete next[f];
  }
  return next;
}

/** Option texts as options with ids made from the record's id and their place. */
function optionsFromTexts(id: string, texts: readonly unknown[] | undefined): DecisionOption[] {
  return (texts ?? [])
    .map(textOf)
    .filter((t): t is string => t !== undefined)
    .map((text, i) => ({ id: `${id}-o${i}`, text: text.slice(0, DECISION_TEXT_MAX) }));
}

/**
 * An old DACI row as a decision record under its own id. Open is proposed
 * and decided is accepted; implemented is accepted with `implementedAt`,
 * and revisit is proposed with `reopenedAt`, both set to the row's day (the
 * only day it kept). The Approver is the decider; Driver, Contributors and
 * Informed are roles. A decided row keeps an empty outcome: the old form
 * had no field for it, and the Driver's recommendation isn't guessed to be
 * what was decided.
 */
export function fromDaci(d: DACIDecision): Decision {
  const day = dayOf(d.date) ?? "";
  const context = textOf(d.context);
  const recommendation = textOf(d.recommendation);
  const decider = textOf(d.approver);
  const options = optionsFromTexts(d.id, d.options);
  const roles = rolesOf({
    driver: d.driver === undefined ? [] : [d.driver],
    contributor: d.contributors,
    informed: d.informed,
  });
  const decided = d.status === "decided" || d.status === "implemented";
  return {
    id: d.id,
    title: typeof d.title === "string" ? d.title.trim() : "",
    ...(context ? { context } : {}),
    decision: "",
    status: decided ? "accepted" : "proposed",
    date: day,
    template: "daci",
    ...(options.length > 0 ? { options } : {}),
    ...(recommendation ? { recommendation } : {}),
    ...(decider ? { decider } : {}),
    ...(roles ? { roles } : {}),
    ...(d.status === "implemented" && day ? { implementedAt: day } : {}),
    ...(d.status === "revisit" && day ? { reopenedAt: day } : {}),
  };
}

/**
 * An old RAPID row as a decision record under its own id. Open is
 * proposed, decided is accepted, and implemented is accepted with
 * `implementedAt` set to the row's day. Decide (D) is the decider;
 * Recommend, Agree, Perform and Input are roles. The outcome starts empty,
 * as the old form had no field for it.
 */
export function fromRapid(r: RAPIDDecision): Decision {
  const day = dayOf(r.date) ?? "";
  const context = textOf(r.context);
  const decider = textOf(r.decide);
  const roles = rolesOf({
    recommend: r.recommend === undefined ? [] : [r.recommend],
    agree: r.agree,
    perform: r.perform,
    input: r.input,
  });
  const decided = r.status === "decided" || r.status === "implemented";
  return {
    id: r.id,
    title: typeof r.title === "string" ? r.title.trim() : "",
    ...(context ? { context } : {}),
    decision: "",
    status: decided ? "accepted" : "proposed",
    date: day,
    template: "rapid",
    ...(decider ? { decider } : {}),
    ...(roles ? { roles } : {}),
    ...(r.status === "implemented" && day ? { implementedAt: day } : {}),
  };
}

/**
 * Every decision record: the stored ones first, then the old DACI and RAPID
 * rows no stored record has replaced (a record with the same id wins).
 */
export function allDecisions(
  decisions: readonly Decision[] | undefined,
  daci: readonly DACIDecision[] | undefined,
  rapid: readonly RAPIDDecision[] | undefined
): Decision[] {
  const list = (decisions ?? []).map(storedRow);
  const ids = new Set(list.map((d) => d.id));
  for (const d of daci ?? []) {
    if (ids.has(d.id)) continue;
    ids.add(d.id);
    list.push(fromDaci(d));
  }
  for (const r of rapid ?? []) {
    if (ids.has(r.id)) continue;
    ids.add(r.id);
    list.push(fromRapid(r));
  }
  return list;
}

/**
 * Whether `id` is an old DACI or RAPID row that no stored record has
 * replaced yet: its first edit writes a Decision under the same id.
 */
export function legacyKindOf(
  id: string,
  decisions: readonly Decision[] | undefined,
  daci: readonly DACIDecision[] | undefined,
  rapid: readonly RAPIDDecision[] | undefined
): "daci" | "rapid" | null {
  if ((decisions ?? []).some((d) => d.id === id)) return null;
  if ((daci ?? []).some((d) => d.id === id)) return "daci";
  if ((rapid ?? []).some((r) => r.id === id)) return "rapid";
  return null;
}

/* ── Numbers ─────────────────────────────────────────────────────────── */

function hasNumber<T extends Pick<Decision, "number">>(d: T): d is T & { number: number } {
  return typeof d.number === "number" && Number.isInteger(d.number) && d.number > 0;
}

/**
 * The number the next record gets: one past the highest in the log, across
 * every template. Example rows don't count: they carry their own numbers
 * and go when the example is cleared, so the team's own sequence never
 * skips past them.
 */
export function nextDecisionNumber(list: readonly Pick<Decision, "id" | "number">[]): number {
  let max = 0;
  for (const d of list) if (!isExampleId(d.id) && hasNumber(d) && d.number > max) max = d.number;
  return max + 1;
}

/**
 * Numbers for the records that have none (rows from before numbering,
 * DACI/RAPID rows copied in, records an agent or the generic CRUD created),
 * oldest day first, then by id, after the highest number in use: a number
 * already given is never changed or reused. Records with no known day go
 * last. Returns only the records it numbered, ready to save. Example rows
 * are left as they are.
 */
export function numberUnnumbered(list: readonly Decision[]): Decision[] {
  let next = nextDecisionNumber(list);
  return list
    .filter((d) => !hasNumber(d) && !isExampleId(d.id))
    .sort((a, b) => {
      const da = DAY.test(a.date) ? a.date : "￿";
      const db = DAY.test(b.date) ? b.date : "￿";
      if (da !== db) return da < db ? -1 : 1;
      return a.id < b.id ? -1 : a.id > b.id ? 1 : 0;
    })
    .map((d) => ({ ...d, number: next++ }));
}

/** "ADR-0003", "DACI-0004", or "Unnumbered" for a record not numbered yet. */
export function decisionLabel(d: Pick<Decision, "template" | "number">): string {
  if (!hasNumber(d)) return "Unnumbered";
  return `${DECISION_PREFIX[templateOf(d)]}-${String(d.number).padStart(4, "0")}`;
}

/* ── Building and changing a record ──────────────────────────────────── */

const clip = (v: string | undefined, max: number) => (v ?? "").trim().slice(0, max);

/** A copy of `d` without the given lifecycle fields. */
function without(
  d: Decision,
  ...keys: ("reopenedAt" | "implementedAt" | "supersededBy")[]
): Decision {
  const next = { ...d };
  for (const key of keys) delete next[key];
  return next;
}

/**
 * The proposed record a hand-off creates: the item's title, its
 * description as the context, and the outcome left for the team to write.
 * `src.decision` adds the form to raise it with (absent: "adr"), the
 * options weighed in order and the proposal (a weighted matrix's ranked
 * options and its leader). `number` is the record's place in the log;
 * without it the record is numbered when it is saved (lib/decisions/store
 * createDecision) or by the Decision Log's move.
 */
export function buildDecision(
  src: HandoffSource,
  id: string,
  number?: number,
  today: string = todayLocalISO()
): Decision {
  const context = clip(src.description, DECISION_TEXT_MAX);
  const recommendation = clip(src.decision?.recommendation, DECISION_TEXT_MAX);
  const options = optionsFromTexts(id, src.decision?.options);
  return {
    id,
    title: clip(src.title, DECISION_TITLE_MAX),
    ...(context ? { context } : {}),
    decision: "",
    status: "proposed",
    date: today,
    sourceRef: src.sourceRef,
    template: templateOf({ template: src.decision?.template }),
    ...(number !== undefined && hasNumber({ number }) ? { number } : {}),
    ...(options.length > 0 ? { options } : {}),
    ...(recommendation ? { recommendation } : {}),
  };
}

export interface DecideInput {
  /** What was decided ("We will …"). */
  outcome: string;
  /** The option the outcome picked (an id from `optionsOf`). */
  chosenOptionId?: string;
  /** Who made the call; absent: the record's decider stays. */
  decider?: string;
  /** "YYYY-MM-DD" it was decided (can be backdated). */
  date: string;
}

/**
 * Why `decide(d, input)` can't be saved, or null. The outcome is required;
 * DACI and RAPID need their decider (the Approver, the D) named first,
 * since the role is the point of the form; a chosen option must be one of
 * the record's.
 */
export function decideError(d: Decision, input: DecideInput): string | null {
  const outcome = input.outcome.trim();
  if (!outcome) return "Write down what was decided.";
  if (outcome.length > DECISION_TEXT_MAX) {
    return `Keep the outcome to ${DECISION_TEXT_MAX} characters.`;
  }
  if (!isIsoDate(input.date) || !DAY.test(input.date)) return "Pick the day it was decided.";
  const spec = TEMPLATES[templateOf(d)];
  if (spec.deciderRequiredToDecide && !textOf(input.decider) && !textOf(d.decider)) {
    return `Name the ${spec.deciderLabel} before deciding.`;
  }
  if (input.chosenOptionId && !optionsOf(d).some((o) => o.id === input.chosenOptionId)) {
    return "Pick one of the record's options.";
  }
  return null;
}

/**
 * The record accepted with its outcome, on `date`. Choosing an option of a
 * pre-template ADR saves its alternatives as options, so the choice keeps
 * pointing at the same one. A reopened record is no longer "revisit", and
 * one decided again is in force, so it names no replacement any more.
 */
export function decide(
  d: Decision,
  { outcome, chosenOptionId, decider, date }: DecideInput
): Decision {
  const rest = without(d, "reopenedAt", "supersededBy");
  const options = optionsOf(d);
  const chosen = chosenOptionId && options.some((o) => o.id === chosenOptionId);
  const who = textOf(decider);
  return {
    ...rest,
    status: "accepted",
    decision: clip(outcome, DECISION_TEXT_MAX),
    decidedAt: date,
    ...(chosen ? { chosenOptionId, ...(d.options ? {} : { options }) } : {}),
    ...(who ? { decider: who } : {}),
  };
}

/**
 * The record replaced by `byId`: superseded, naming its replacement. Null
 * when it already is (so a repeat is a no-op), or when `byId` is the record
 * itself.
 */
export function supersede(old: Decision, byId: string): Decision | null {
  if (byId === old.id) return null;
  if (old.status === "superseded" && old.supersededBy === byId) return null;
  return { ...old, status: "superseded", supersededBy: byId };
}

/**
 * A decided record back to proposed on `today` (DACI's "revisit"). It is
 * no longer carried out or replaced; the outcome written stays, as what is
 * being revisited. A proposed record is returned as it is.
 */
export function reopen(d: Decision, today: string): Decision {
  if (d.status === "proposed") return d;
  return { ...without(d, "implementedAt", "supersededBy"), status: "proposed", reopenedAt: today };
}

/** The DACI and RAPID tools' old status vocabulary (RAPID's is the same without "revisit"). */
export type LegacyDecisionStatus = DACIDecision["status"];

/**
 * A record's status in the DACI or RAPID vocabulary, for their agent
 * aliases: open is proposed (revisit when it was reopened, DACI only),
 * decided is accepted, deprecated or superseded, and implemented is any of
 * those with `implementedAt`.
 */
export function legacyStatusOf(d: Decision, kind: "daci" | "rapid"): LegacyDecisionStatus {
  if (d.status === "proposed") return kind === "daci" && d.reopenedAt ? "revisit" : "open";
  return d.implementedAt ? "implemented" : "decided";
}

/**
 * The record with a DACI/RAPID status set, as their agent aliases do it:
 * open is proposed; revisit reopens it today; decided is accepted (dated
 * today unless it already has a day); implemented is accepted and carried
 * out today (unless already dated). A record already in that status (any
 * proposed one, for open) is returned as it is.
 */
export function withLegacyStatus(
  d: Decision,
  status: LegacyDecisionStatus,
  today: string
): Decision {
  const now = legacyStatusOf(d, "daci");
  if (now === status || (status === "open" && d.status === "proposed")) return d;
  const rest = without(d, "reopenedAt", "implementedAt", "supersededBy");
  switch (status) {
    case "open":
      return { ...rest, status: "proposed" };
    case "revisit":
      return { ...rest, status: "proposed", reopenedAt: today };
    case "decided":
      return { ...rest, status: "accepted", decidedAt: d.decidedAt ?? today };
    case "implemented":
      return {
        ...rest,
        status: "accepted",
        decidedAt: d.decidedAt ?? today,
        implementedAt: d.implementedAt ?? today,
      };
  }
}

/* ── Checks and the verdict ──────────────────────────────────────────── */

export type DecisionIssueKind =
  | "no_decider"
  | "no_driver"
  | "no_recommend"
  | "many_agree"
  | "accepted_no_outcome"
  | "stale_proposed";

export interface DecisionIssue {
  kind: DecisionIssueKind;
  message: string;
}

const plural = (n: number, word: string) => `${n} ${word}${n === 1 ? "" : "s"}`;

/**
 * Days a proposed record has been waiting: since it was reopened, or since
 * it was raised. Null when it isn't proposed or has no day.
 */
export function daysWaiting(d: Decision, today: string): number | null {
  if (d.status !== "proposed") return null;
  const days = daysFrom(d.reopenedAt ?? d.date, today);
  return days === null ? null : Math.max(0, days);
}

/**
 * What a record still needs, most useful first. A proposal: its decider
 * (DACI's Approver, RAPID's D), DACI's Driver, RAPID's Recommender, an
 * Agree list short enough to work (each one is a veto), and a decision
 * once it has waited over STALE_PROPOSED_DAYS. An accepted record: its
 * outcome written down. Deprecated and superseded records need nothing.
 */
export function decisionIssues(d: Decision, today: string = todayLocalISO()): DecisionIssue[] {
  const issues: DecisionIssue[] = [];
  const template = templateOf(d);
  if (d.status === "accepted" && !d.decision.trim()) {
    issues.push({
      kind: "accepted_no_outcome",
      message: "Accepted, but what was decided isn't written down.",
    });
  }
  if (d.status !== "proposed") return issues;
  const spec = TEMPLATES[template];
  if (spec.deciderRequiredToDecide && !textOf(d.decider)) {
    issues.push({
      kind: "no_decider",
      message: `No ${spec.deciderLabel} named: name the one person who makes the call.`,
    });
  }
  if (template === "daci" && roleHolders(d, "driver").length === 0) {
    issues.push({
      kind: "no_driver",
      message: "No Driver named: name the person who runs the decision.",
    });
  }
  if (template === "rapid" && roleHolders(d, "recommend").length === 0) {
    issues.push({
      kind: "no_recommend",
      message: "No Recommend (R) named: name the person who makes the proposal.",
    });
  }
  const agree = roleHolders(d, "agree").length;
  if (template === "rapid" && agree > MANY_AGREE) {
    issues.push({
      kind: "many_agree",
      message: `${agree} people must agree, and each one is a veto: keep it to ${MANY_AGREE} or fewer.`,
    });
  }
  const waiting = daysWaiting(d, today);
  if (waiting !== null && waiting > STALE_PROPOSED_DAYS) {
    issues.push({
      kind: "stale_proposed",
      message: `Proposed ${plural(waiting, "day")} ago and still not decided.`,
    });
  }
  return issues;
}

/**
 * The log in one sentence: "12 decisions: 3 proposed (oldest waiting 21
 * days), 8 accepted, 1 superseded." Accepted records without an outcome
 * written are counted in brackets.
 */
export function decisionVerdict(list: readonly Decision[], today: string): string {
  if (list.length === 0) return "No decisions recorded yet.";
  const of = (s: DecisionStatus) => list.filter((d) => d.status === s);
  const parts: string[] = [];

  const proposed = of("proposed");
  if (proposed.length > 0) {
    const waits = proposed.map((d) => daysWaiting(d, today)).filter((n): n is number => n !== null);
    const oldest = waits.length > 0 ? Math.max(...waits) : 0;
    const wait =
      oldest >= 1
        ? ` (${proposed.length === 1 ? "waiting" : "oldest waiting"} ${plural(oldest, "day")})`
        : "";
    parts.push(`${proposed.length} proposed${wait}`);
  }
  const accepted = of("accepted");
  if (accepted.length > 0) {
    const blank = accepted.filter((d) => !d.decision.trim()).length;
    parts.push(
      `${accepted.length} accepted${blank > 0 ? ` (${blank} without the outcome written down)` : ""}`
    );
  }
  for (const s of ["deprecated", "superseded"] as const) {
    const n = of(s).length;
    if (n > 0) parts.push(`${n} ${s}`);
  }
  return `${plural(list.length, "decision")}: ${parts.join(", ")}.`;
}

export interface TimeToDecide {
  /** The median of decidedAt − date, in whole days. */
  medianDays: number;
  /** How many decided records carried both days. */
  n: number;
}

/**
 * How long decisions take: the median days from raised to decided over the
 * decided records that carry both days (a decided day before the raised one
 * is left out). Null below MIN_SAMPLE.average such records.
 */
export function timeToDecide(list: readonly Decision[]): TimeToDecide | null {
  const days = list
    .filter((d) => isDecided(d.status))
    .map((d) => daysFrom(d.date, d.decidedAt))
    .filter((n): n is number => n !== null && n >= 0)
    .sort((a, b) => a - b);
  if (!enoughData(days.length, "average")) return null;
  const mid = Math.floor(days.length / 2);
  const medianDays = days.length % 2 === 1 ? days[mid] : (days[mid - 1] + days[mid]) / 2;
  return { medianDays, n: days.length };
}
