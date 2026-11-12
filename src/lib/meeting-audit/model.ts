/**
 * Meeting Audit's reading of its records (workspace.meetingAudits): what each
 * recurring meeting costs the team in person-hours a week, how the team
 * rates it, its verdict (keep, change or drop) and the ritual reset plan
 * those verdicts add up to. The page, its agent verbs, its export, the AI
 * task's fallback and its next step all read the records through here.
 *
 * Pure: no store, no React. The agent's server handlers import it.
 */

import {
  MEETING_CADENCES,
  MEETING_VERDICTS,
  TOOL_LIST_MAX,
  TOOL_TEXT_MAX,
  type MeetingAudit,
  type MeetingCadence,
  type MeetingVerdict,
} from "@/lib/stores/workspace-types";
import type { Validation } from "@/lib/utils/form";
import { isExampleId } from "@/lib/utils/example-id";

/* ── The questions ───────────────────────────────────────────────────── */

/**
 * What the team rates each meeting on, in our own words. A rating is stored
 * under the question's id (MeetingAudit.ratings), 1 to 5.
 */
export const AUDIT_QUESTIONS = [
  {
    id: "purpose",
    label: "Clear purpose",
    question: "Everyone knows what this meeting is for.",
  },
  {
    id: "people",
    label: "Right people",
    question: "The people it needs are there, and nobody who isn't needed.",
  },
  {
    id: "outcome",
    label: "Useful outcome",
    question: "We leave with a decision, a plan or something learned.",
  },
  {
    id: "length",
    label: "Right length",
    question: "It takes the time it needs, and no more.",
  },
  {
    id: "energy",
    label: "Energy",
    question: "People take part, and leave with energy rather than drained.",
  },
] as const;

export type AuditQuestionId = (typeof AUDIT_QUESTIONS)[number]["id"];
export const AUDIT_QUESTION_IDS = AUDIT_QUESTIONS.map((q) => q.id) as AuditQuestionId[];

export const RATING_MIN = 1;
export const RATING_MAX = 5;
/** A rating this low or lower is a problem the fallback suggestions act on. */
export const LOW_RATING = 2;

/** The rating scale, as a ScalePicker reads it. */
export const RATING_SCALE: readonly { value: number; meaning: string }[] = [
  { value: 1, meaning: "Not at all" },
  { value: 2, meaning: "Rarely" },
  { value: 3, meaning: "Sometimes" },
  { value: 4, meaning: "Mostly" },
  { value: 5, meaning: "Always" },
];

/* ── Cadence and cost ────────────────────────────────────────────────── */

/** How many times a week each cadence meets: five working days, 52 weeks a year. */
export const CADENCE_PER_WEEK: Readonly<Record<MeetingCadence, number>> = {
  daily: 5,
  weekly: 1,
  fortnightly: 0.5,
  monthly: 12 / 52,
  quarterly: 4 / 52,
};

export const CADENCE_LABEL: Readonly<Record<MeetingCadence, string>> = {
  daily: "Daily",
  weekly: "Weekly",
  fortnightly: "Every two weeks",
  monthly: "Monthly",
  quarterly: "Quarterly",
};

/** One occurrence's span, for "try it for two …". */
const CADENCE_SPAN: Readonly<Record<MeetingCadence, string>> = {
  daily: "weeks",
  weekly: "weeks",
  fortnightly: "sprints",
  monthly: "months",
  quarterly: "quarters",
};

export const VERDICT_LABEL: Readonly<Record<MeetingVerdict, string>> = {
  keep: "Keep",
  change: "Change",
  drop: "Drop",
};

export const isCadence = (v: unknown): v is MeetingCadence =>
  typeof v === "string" && (MEETING_CADENCES as readonly string[]).includes(v);

export const isVerdict = (v: unknown): v is MeetingVerdict =>
  typeof v === "string" && (MEETING_VERDICTS as readonly string[]).includes(v);

/** The longest meeting the agents' schema takes: a whole day. */
export const MINUTES_MAX = 24 * 60;
export const ATTENDEES_MAX = 1000;

/** Person-minutes a week: attendees × minutes × how many times a week it meets. */
export function weeklyMinutes(a: Pick<MeetingAudit, "attendees" | "minutes" | "cadence">): number {
  const perWeek = CADENCE_PER_WEEK[a.cadence] ?? 0;
  const minutes = Number.isFinite(a.minutes) && a.minutes > 0 ? a.minutes : 0;
  const people = Number.isFinite(a.attendees) && a.attendees > 0 ? a.attendees : 0;
  return people * minutes * perWeek;
}

/** Person-hours a week. */
export const weeklyHours = (a: Pick<MeetingAudit, "attendees" | "minutes" | "cadence">): number =>
  weeklyMinutes(a) / 60;

/** Hours to one decimal, as the page writes them: "7.5", "12". */
export function hoursText(hours: number): string {
  const r = Math.round(hours * 10) / 10;
  return String(Object.is(r, -0) ? 0 : r);
}

/** "7.5 person-hours a week" */
export const weeklyText = (hours: number): string =>
  `${hoursText(hours)} person-${Math.round(hours * 10) === 10 ? "hour" : "hours"} a week`;

/* ── Ratings ─────────────────────────────────────────────────────────── */

/** The rating a meeting has on a question, or null when it is unrated (or off the scale). */
export function ratingOf(a: Pick<MeetingAudit, "ratings">, id: string): number | null {
  const v = a.ratings?.[id];
  return typeof v === "number" && Number.isInteger(v) && v >= RATING_MIN && v <= RATING_MAX
    ? v
    : null;
}

/** How many of the questions a meeting has a rating for. */
export const ratedCount = (a: Pick<MeetingAudit, "ratings">): number =>
  AUDIT_QUESTION_IDS.filter((id) => ratingOf(a, id) !== null).length;

/** The average of its ratings on the questions, or null with none. */
export function meetingScore(a: Pick<MeetingAudit, "ratings">): number | null {
  const values = AUDIT_QUESTION_IDS.map((id) => ratingOf(a, id)).filter(
    (v): v is number => v !== null
  );
  if (values.length === 0) return null;
  return values.reduce((s, v) => s + v, 0) / values.length;
}

/** The ratings with `id` set to `value` (null clears it), within TOOL_LIST_MAX.ratings. */
export function withRating(
  ratings: Readonly<Record<string, number>> | undefined,
  id: string,
  value: number | null
): Record<string, number> {
  const next: Record<string, number> = { ...(ratings ?? {}) };
  if (value === null) delete next[id];
  else next[id] = value;
  return next;
}

/* ── Reading ─────────────────────────────────────────────────────────── */

/**
 * A stored row as the page reads it, or null for one with no id or name.
 * Rows come from the page and the agents' CRUD (which checks them), and from
 * sync: an unknown cadence reads as weekly, a length or headcount that isn't
 * a positive number reads as 0 minutes or 1 person (so it costs nothing it
 * didn't say), and only numeric ratings are kept.
 */
export function normalizeMeetingAudit(raw: unknown): MeetingAudit | null {
  if (!raw || typeof raw !== "object") return null;
  const r = raw as Record<string, unknown>;
  const id = typeof r.id === "string" ? r.id.trim() : "";
  const meeting = typeof r.meeting === "string" ? r.meeting.trim() : "";
  if (!id || !meeting) return null;
  const minutes = typeof r.minutes === "number" && Number.isFinite(r.minutes) && r.minutes > 0;
  const attendees =
    typeof r.attendees === "number" && Number.isFinite(r.attendees) && r.attendees >= 1;
  const ratings: Record<string, number> = {};
  if (r.ratings && typeof r.ratings === "object" && !Array.isArray(r.ratings)) {
    for (const [k, v] of Object.entries(r.ratings as Record<string, unknown>)) {
      if (Object.keys(ratings).length >= TOOL_LIST_MAX.ratings) break;
      if (typeof v === "number" && Number.isFinite(v)) ratings[k] = v;
    }
  }
  const notes = typeof r.notes === "string" && r.notes.trim() ? r.notes : undefined;
  return {
    id,
    meeting,
    cadence: isCadence(r.cadence) ? r.cadence : "weekly",
    minutes: minutes ? (r.minutes as number) : 0,
    attendees: attendees ? Math.floor(r.attendees as number) : 1,
    purpose: typeof r.purpose === "string" ? r.purpose : "",
    ratings,
    ...(isVerdict(r.verdict) ? { verdict: r.verdict } : {}),
    ...(notes ? { notes } : {}),
    createdAt: typeof r.createdAt === "string" ? r.createdAt : "",
    updatedAt: typeof r.updatedAt === "string" ? r.updatedAt : "",
  };
}

/** Every readable row, the costliest first (then by name, then id). */
export function meetingAudits(raw: readonly unknown[] | undefined): MeetingAudit[] {
  return (raw ?? [])
    .map(normalizeMeetingAudit)
    .filter((x): x is MeetingAudit => x !== null)
    .sort(byCost);
}

/** Costliest first, then by name, then id. */
export function byCost(a: MeetingAudit, b: MeetingAudit): number {
  return (
    weeklyMinutes(b) - weeklyMinutes(a) ||
    a.meeting.localeCompare(b.meeting) ||
    a.id.localeCompare(b.id)
  );
}

/** The team's own meetings: the example's only while there are no others. */
export function countedAudits(audits: readonly MeetingAudit[]): MeetingAudit[] {
  const own = audits.filter((a) => !isExampleId(a.id));
  return own.length > 0 ? own : [...audits];
}

/* ── Summary and the ritual reset plan ───────────────────────────────── */

export interface AuditSummary {
  meetings: number;
  /** Person-hours a week, every meeting. */
  weeklyHours: number;
  /** Meetings with at least one rating. */
  rated: number;
  /** Meetings with a rating on every question. */
  fullyRated: number;
  verdicts: Record<MeetingVerdict | "none", number>;
  /** Person-hours a week of the meetings marked to drop. */
  hoursFreed: number;
  /** Person-hours a week of the meetings marked to change. */
  hoursToChange: number;
}

export function auditSummary(audits: readonly MeetingAudit[]): AuditSummary {
  const out: AuditSummary = {
    meetings: audits.length,
    weeklyHours: 0,
    rated: 0,
    fullyRated: 0,
    verdicts: { keep: 0, change: 0, drop: 0, none: 0 },
    hoursFreed: 0,
    hoursToChange: 0,
  };
  for (const a of audits) {
    const hours = weeklyHours(a);
    out.weeklyHours += hours;
    const n = ratedCount(a);
    if (n > 0) out.rated += 1;
    if (n === AUDIT_QUESTION_IDS.length) out.fullyRated += 1;
    out.verdicts[a.verdict ?? "none"] += 1;
    if (a.verdict === "drop") out.hoursFreed += hours;
    if (a.verdict === "change") out.hoursToChange += hours;
  }
  return out;
}

const plural = (n: number, one: string, many = `${one}s`) => `${n} ${n === 1 ? one : many}`;

/** The page's one sentence about the audit. */
export function auditVerdict(s: AuditSummary): string {
  if (s.meetings === 0) return "No meetings audited yet.";
  const cost = `${plural(s.meetings, "recurring meeting")} ${
    s.meetings === 1 ? "takes" : "take"
  } ${weeklyText(s.weeklyHours)}.`;
  const { keep, change, drop, none } = s.verdicts;
  // Verdicts the team already gave make the plan, rated or not.
  if (change + drop > 0) {
    const parts = [
      change > 0 ? `${plural(change, "meeting")} to change` : null,
      drop > 0 ? `${plural(drop, "meeting")} to drop` : null,
    ]
      .filter(Boolean)
      .join(" and ");
    const frees = drop > 0 ? `, which frees ${weeklyText(s.hoursFreed)}` : "";
    const left = none > 0 ? ` ${plural(none, "meeting")} still to decide.` : "";
    return `${cost} The plan: ${parts}${frees}.${left}`;
  }
  const unrated = s.meetings - s.rated;
  if (s.rated === 0 && keep === 0) return `${cost} Rate each one with the team.`;
  if (unrated > 0 && none > 0) return `${cost} ${plural(unrated, "meeting")} still to rate.`;
  if (none === s.meetings) return `${cost} Give each one a verdict: keep, change or drop.`;
  return none > 0
    ? `${cost} Every verdict so far is keep; ${plural(none, "meeting")} still to decide.`
    : `${cost} The team keeps every one as it is.`;
}

export interface ResetPlan {
  keep: MeetingAudit[];
  change: MeetingAudit[];
  drop: MeetingAudit[];
  undecided: MeetingAudit[];
  hoursNow: number;
  hoursFreed: number;
  /** What the meetings take once the drops go (changes not counted: their new length isn't known). */
  hoursAfter: number;
}

/** The ritual reset the verdicts add up to, each group the costliest first. */
export function resetPlan(audits: readonly MeetingAudit[]): ResetPlan {
  const sorted = [...audits].sort(byCost);
  const s = auditSummary(audits);
  return {
    keep: sorted.filter((a) => a.verdict === "keep"),
    change: sorted.filter((a) => a.verdict === "change"),
    drop: sorted.filter((a) => a.verdict === "drop"),
    undecided: sorted.filter((a) => !a.verdict),
    hoursNow: s.weeklyHours,
    hoursFreed: s.hoursFreed,
    hoursAfter: s.weeklyHours - s.hoursFreed,
  };
}

/* ── Suggested changes, without AI ───────────────────────────────────── */

export interface MeetingChange {
  meetingId: string;
  /** What to change, as an instruction: "Timebox it to 15 minutes". */
  change: string;
  /** Why, from the meeting's numbers and ratings. */
  why: string;
}

/** How many changes a suggestion list holds (the AI task's cap too). */
export const MEETING_CHANGES_MAX = 5;

const round5 = (n: number) => Math.round(n / 5) * 5;

interface Candidate extends MeetingChange {
  weight: number;
}

/**
 * A Scrum event, by its name: the fallback suggests running it better,
 * never dropping it (the guide's tip: change how you run one first).
 */
export const isScrumEvent = (name: string): boolean =>
  /\b(sprint planning|planning|daily scrum|daily stand-?up|stand-?up|sprint review|review|retro|retrospective)\b/i.test(
    name
  );

const isLow = (a: MeetingAudit, id: AuditQuestionId) => {
  const v = ratingOf(a, id);
  return v !== null && v <= LOW_RATING;
};

/** Every rule that fits one meeting, most severe first. */
function candidatesFor(a: MeetingAudit): Candidate[] {
  const out: Candidate[] = [];
  const hours = weeklyHours(a);
  const add = (severity: number, change: string, why: string) =>
    out.push({ meetingId: a.id, change, why, weight: hours * severity + severity / 10 });
  const lows = AUDIT_QUESTION_IDS.filter((id) => isLow(a, id));
  let lengthCovered = false;

  if (a.cadence === "daily" && a.minutes > 15) {
    lengthCovered = true;
    add(
      3,
      "Timebox it to 15 minutes",
      `A ${a.minutes}-minute daily meeting takes ${weeklyText(hours)}; at 15 minutes it would take ${hoursText(
        weeklyHours({ ...a, minutes: 15 })
      )}.`
    );
  }
  if (isLow(a, "outcome") && a.minutes >= 30 && !lengthCovered) {
    lengthCovered = true;
    const to = Math.max(15, round5(a.minutes / 2));
    add(
      3,
      `Cut it to ${to} minutes and end with a decision or a next step`,
      `It rarely ends with an outcome, and it takes ${a.minutes} minutes each time.`
    );
  }
  if (lows.length >= 3 && a.cadence !== "daily" && !isScrumEvent(a.meeting)) {
    add(
      2.5,
      `Try dropping it for two ${CADENCE_SPAN[a.cadence]} and see what the team misses`,
      `It is rated low on ${lows.length} of ${AUDIT_QUESTION_IDS.length} questions.`
    );
  }
  if (isLow(a, "people") && a.attendees >= 6) {
    add(
      2,
      "Invite only the people it needs, and send notes to the rest",
      `${a.attendees} people attend, and the team says they aren't the right ones.`
    );
  }
  if (isLow(a, "purpose")) {
    add(
      2,
      "Write its purpose in one line at the top of the invite",
      "People aren't sure what it is for, so it drifts."
    );
  }
  if (
    /\b(status|updates?|report(?:ing)?|sync)\b/i.test(`${a.meeting} ${a.purpose}`) &&
    (isLow(a, "outcome") || isLow(a, "energy"))
  ) {
    add(
      2,
      "Share the updates in writing, and meet only for what needs a conversation",
      "It is mostly updates, and the team gets little out of hearing them read out."
    );
  }
  if (isLow(a, "length") && !lengthCovered && a.minutes >= 20) {
    const to = round5((a.minutes * 2) / 3);
    if (to < a.minutes) {
      add(
        2,
        `Shorten it to ${to} minutes`,
        `The team says it runs longer than it needs; it takes ${a.minutes} minutes now.`
      );
    }
  }
  if (isLow(a, "energy")) {
    add(
      1,
      "Change the format: rotate who facilitates, or try a Liberating Structure",
      "People leave it drained rather than ready to act."
    );
  }
  return out.sort((x, y) => y.weight - x.weight);
}

/**
 * Up to five concrete changes from the rules (the AI task's fallback and the
 * agent's suggest_changes): one per meeting first, the costliest problems
 * first, then a second for the same meetings while there is room. Meetings
 * already marked to drop are left out, and so are rules a meeting's notes
 * already hold.
 */
export function ruleChanges(audits: readonly MeetingAudit[]): MeetingChange[] {
  const lists = audits
    .filter((a) => a.verdict !== "drop")
    .map((a) =>
      candidatesFor(a).filter(
        (c) => !(a.notes ?? "").toLowerCase().includes(c.change.toLowerCase())
      )
    )
    .filter((l) => l.length > 0);
  const firsts = lists.map((l) => l[0]).sort((x, y) => y.weight - x.weight);
  const rest = lists.flatMap((l) => l.slice(1)).sort((x, y) => y.weight - x.weight);
  return [...firsts, ...rest]
    .slice(0, MEETING_CHANGES_MAX)
    .map(({ meetingId, change, why }) => ({ meetingId, change, why }));
}

/**
 * The suggested changes that apply to `audits`: an id the answer made up, a
 * meeting already marked to drop, or the same change twice is left out; at
 * most MEETING_CHANGES_MAX, in the answer's order.
 */
export function matchChanges<C extends MeetingChange>(
  changes: readonly C[],
  audits: readonly MeetingAudit[]
): C[] {
  const byId = new Map(audits.map((a) => [a.id, a]));
  const seen = new Set<string>();
  const out: C[] = [];
  for (const c of changes) {
    const a = byId.get(c.meetingId);
    const key = `${c.meetingId}\u0000${c.change.trim().toLowerCase()}`;
    if (!a || a.verdict === "drop" || !c.change.trim() || seen.has(key)) continue;
    seen.add(key);
    out.push(c);
    if (out.length >= MEETING_CHANGES_MAX) break;
  }
  return out;
}

/**
 * The meeting with a change accepted: the change added to its notes (on a
 * line of its own, within TOOL_TEXT_MAX.long) and its verdict set to change
 * unless the team already marked it to drop. Stamps updatedAt.
 */
export function withChange(
  a: MeetingAudit,
  change: string,
  now: string = new Date().toISOString()
): MeetingAudit {
  const line = change.trim();
  const notes = (a.notes ?? "").trim();
  const has = notes.toLowerCase().includes(line.toLowerCase());
  const nextNotes = has || !line ? notes : notes ? `${notes}\n${line}` : line;
  return {
    ...a,
    ...(nextNotes ? { notes: nextNotes.slice(0, TOOL_TEXT_MAX.long) } : {}),
    verdict: a.verdict === "drop" ? "drop" : "change",
    updatedAt: now,
  };
}

/* ── The add and edit form ───────────────────────────────────────────── */

export interface MeetingDraft {
  meeting: string;
  cadence: MeetingCadence | null;
  /** As typed. */
  minutes: string;
  /** As typed. */
  attendees: string;
  purpose: string;
  notes: string;
}

export type MeetingField = keyof MeetingDraft;

export interface MeetingValues {
  meeting: string;
  cadence: MeetingCadence;
  minutes: number;
  attendees: number;
  purpose: string;
  notes?: string;
}

export const EMPTY_MEETING_DRAFT: MeetingDraft = {
  meeting: "",
  cadence: null,
  minutes: "",
  attendees: "",
  purpose: "",
  notes: "",
};

/** The draft an edit form starts from. */
export function draftOf(a: MeetingAudit): MeetingDraft {
  return {
    meeting: a.meeting,
    cadence: a.cadence,
    minutes: String(a.minutes),
    attendees: String(a.attendees),
    purpose: a.purpose,
    notes: a.notes ?? "",
  };
}

const wholeNumber = (raw: string): number | undefined => {
  const t = raw.trim();
  if (!t) return undefined;
  return /^\d+$/.test(t) ? Number(t) : NaN;
};

/**
 * Check a meeting before it is saved. Name, how often, how long and how many
 * are required, with no default: a blank length is an error, never 0. The
 * caps are the agents' schema's, so a meeting the page saved is always one
 * an agent can update.
 */
export function validateMeetingDraft(d: MeetingDraft): Validation<MeetingValues, MeetingField> {
  const errors: Partial<Record<MeetingField, string>> = {};
  const meeting = d.meeting.replace(/\s*[\r\n]+\s*/g, " ").trim();
  const purpose = d.purpose.trim();
  const notes = d.notes.trim();
  const minutes = wholeNumber(d.minutes);
  const attendees = wholeNumber(d.attendees);
  if (!meeting) errors.meeting = "Name the meeting.";
  else if (meeting.length > TOOL_TEXT_MAX.short) {
    errors.meeting = `Keep the name to ${TOOL_TEXT_MAX.short} characters.`;
  }
  if (!d.cadence) errors.cadence = "Pick how often it meets.";
  if (minutes === undefined) errors.minutes = "Say how many minutes it takes.";
  else if (!Number.isFinite(minutes) || minutes < 1) {
    errors.minutes = "Enter whole minutes, 1 or more.";
  } else if (minutes > MINUTES_MAX) errors.minutes = `Keep it to ${MINUTES_MAX} minutes or less.`;
  if (attendees === undefined) errors.attendees = "Say how many people attend.";
  else if (!Number.isFinite(attendees) || attendees < 1) {
    errors.attendees = "Enter a whole number of people, 1 or more.";
  } else if (attendees > ATTENDEES_MAX) {
    errors.attendees = `Keep it to ${ATTENDEES_MAX} people or fewer.`;
  }
  if (purpose.length > TOOL_TEXT_MAX.text) {
    errors.purpose = `Keep the purpose to ${TOOL_TEXT_MAX.text} characters.`;
  }
  if (notes.length > TOOL_TEXT_MAX.long) {
    errors.notes = `Keep the notes to ${TOOL_TEXT_MAX.long} characters.`;
  }
  if (Object.keys(errors).length > 0 || !d.cadence) return { ok: false, errors };
  return {
    ok: true,
    values: {
      meeting,
      cadence: d.cadence,
      minutes: minutes as number,
      attendees: attendees as number,
      purpose,
      ...(notes ? { notes } : {}),
    },
  };
}

/** A new meeting from checked values, unrated, stamped `now`. */
export function newMeetingAudit(values: MeetingValues, id: string, now: string): MeetingAudit {
  return {
    id,
    meeting: values.meeting,
    cadence: values.cadence,
    minutes: values.minutes,
    attendees: values.attendees,
    purpose: values.purpose,
    ratings: {},
    ...(values.notes ? { notes: values.notes } : {}),
    createdAt: now,
    updatedAt: now,
  };
}

/** The meeting with checked values from its edit form; ratings and verdict stay. */
export function editedMeetingAudit(
  a: MeetingAudit,
  values: MeetingValues,
  now: string
): MeetingAudit {
  const next: MeetingAudit = {
    ...a,
    meeting: values.meeting,
    cadence: values.cadence,
    minutes: values.minutes,
    attendees: values.attendees,
    purpose: values.purpose,
    updatedAt: now,
  };
  delete next.notes;
  if (values.notes) next.notes = values.notes;
  return next;
}

/* ── Next step ───────────────────────────────────────────────────────── */

/** The audit is a quarterly ritual: after this many days it is due again. */
export const AUDIT_STALE_DAYS = 90;

export interface AuditStep {
  id: string;
  label: string;
  detail?: string;
  href: string;
}

/**
 * Where the audit should go next (lib/tools/next-steps reads it): rate the
 * meetings not rated yet, give the rated ones a verdict, take the changes to
 * the next retro, and run it again once a quarter has passed. Example
 * meetings are left out; nothing when there are none.
 */
export function meetingAuditSteps(
  raw: readonly unknown[] | undefined,
  now: Date = new Date()
): AuditStep[] {
  const audits = meetingAudits(raw).filter((a) => !isExampleId(a.id));
  if (audits.length === 0) return [];
  const steps: AuditStep[] = [];
  const unrated = audits.filter((a) => ratedCount(a) === 0);
  if (unrated.length > 0) {
    steps.push({
      id: "meeting-audit-rate",
      label:
        unrated.length === 1
          ? `Rate “${unrated[0].meeting}” with the team`
          : `Rate the ${unrated.length} meetings not rated yet`,
      detail: "Five quick questions each: purpose, people, outcome, length and energy.",
      href: "/meeting-audit",
    });
  }
  const undecided = audits.filter((a) => ratedCount(a) > 0 && !a.verdict);
  if (undecided.length > 0) {
    steps.push({
      id: "meeting-audit-verdict",
      label:
        undecided.length === 1
          ? `Decide whether to keep, change or drop “${undecided[0].meeting}”`
          : `Give the ${undecided.length} rated meetings a verdict`,
      detail: "Keep, change or drop: the verdicts make the ritual reset plan.",
      href: "/meeting-audit",
    });
  }
  const s = auditSummary(audits);
  if (s.verdicts.change + s.verdicts.drop > 0) {
    const parts = [
      s.verdicts.change > 0 ? plural(s.verdicts.change, "meeting") + " to change" : null,
      s.verdicts.drop > 0 ? plural(s.verdicts.drop, "meeting") + " to drop" : null,
    ]
      .filter(Boolean)
      .join(" and ");
    steps.push({
      id: "meeting-audit-retro",
      label: "Agree the meeting changes at the next retro",
      detail: `The audit has ${parts}${
        s.hoursFreed > 0 ? `, freeing ${weeklyText(s.hoursFreed)}` : ""
      }. Agree them with the team, and try each change for a few weeks before judging it.`,
      href: "/retro",
    });
  }
  const newest = Math.max(...audits.map((a) => Date.parse(a.updatedAt || a.createdAt) || 0));
  if (newest > 0 && now.getTime() - newest >= AUDIT_STALE_DAYS * 86_400_000) {
    steps.push({
      id: "meeting-audit-again",
      label: "Run the meeting audit again",
      detail:
        "It has been a quarter since the last one: rate each meeting again as a ritual reset.",
      href: "/meeting-audit",
    });
  }
  return steps;
}
