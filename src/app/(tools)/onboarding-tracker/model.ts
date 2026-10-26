/**
 * The Onboarding Tracker's data and its numbers: new joiners with their
 * milestones, the milestone template new people start from, and the ramp.
 * Pure, so the page, the example, the Markdown export and the tests share
 * one definition of each number.
 *
 * People stay a blob under STORAGE_KEY and the template a second one under
 * TEMPLATES_KEY (null means the built-ins). `normalizeOnboardees` reads
 * every shape saved so far: a legacy milestone has only a name, so it is
 * linked to the built-in template of that exact name, and the KPIs find
 * "first PR" and "productive" by that link (and the template's mark), never
 * by the name, which can now be edited.
 */

import { MIN_SAMPLE } from "@/lib/analytics/min-sample";
import { isIsoDate, isoDayNumber } from "@/lib/sprints/calendar";

export const STORAGE_KEY = "agile-toolkit:onboarding-tracker";
/** The milestone template; null (or nothing saved) means the built-ins. */
export const TEMPLATES_KEY = "agile-toolkit:onboarding-tracker:templates";

/** What a milestone tells the KPIs: the first PR, or being productive. */
export type MilestoneMark = "first-pr" | "productive";

export const MARK_LABELS: Record<MilestoneMark, string> = {
  "first-pr": "First PR",
  productive: "Productive",
};

export interface MilestoneTemplate {
  id: string;
  name: string;
  targetDays: number;
  marks?: MilestoneMark;
}

export const BUILT_IN_TEMPLATES: readonly MilestoneTemplate[] = [
  { id: "first-commit", name: "First commit", targetDays: 3 },
  { id: "first-pr", name: "First PR", targetDays: 7, marks: "first-pr" },
  { id: "first-merge", name: "First merge", targetDays: 14 },
  { id: "first-deploy", name: "First production deploy", targetDays: 30 },
  { id: "independent-feature", name: "Independent feature", targetDays: 60, marks: "productive" },
  { id: "mentor-peer", name: "Mentor a peer", targetDays: 90 },
];

export interface Milestone {
  id: string;
  /** The template it was copied from (a legacy one is linked by its name). */
  templateId?: string;
  name: string;
  targetDays: number;
  /** The template's mark when it was copied; the person keeps their copy. */
  marks?: MilestoneMark;
  /** "YYYY-MM-DD": the day it was reached, backdatable. */
  completedAt?: string;
  notes?: string;
}

export interface Onboardee {
  id: string;
  name: string;
  /** TeamMember.id when the name is on the Team roster. */
  memberId?: string;
  role?: string;
  /** The teammate who shows them around. */
  buddy?: string;
  buddyMemberId?: string;
  /** "YYYY-MM-DD". */
  startDate: string;
  milestones: Milestone[];
  description?: string;
}

/** The longest target a milestone can have, in days. */
export const TARGET_MAX = 365;

const MARKS: readonly MilestoneMark[] = ["first-pr", "productive"];
const isObject = (v: unknown): v is Record<string, unknown> =>
  typeof v === "object" && v !== null && !Array.isArray(v);
const str = (v: unknown): string | undefined => (typeof v === "string" ? v : undefined);

/** A whole number of days from 1 to TARGET_MAX. */
export const isTarget = (n: unknown): n is number =>
  typeof n === "number" && Number.isInteger(n) && n >= 1 && n <= TARGET_MAX;

/** A "YYYY-MM-DD" that exists. */
export const isIsoDay = (v: unknown): v is string =>
  typeof v === "string" && /^\d{4}-\d{2}-\d{2}$/.test(v) && isIsoDate(v);

/**
 * The saved template, or null for the built-ins (nothing saved, or a value
 * that isn't a list). Rows that aren't templates are dropped, and a second
 * template with a mark already taken loses it, so each mark is one milestone.
 */
export function normalizeTemplates(raw: unknown): MilestoneTemplate[] | null {
  if (!Array.isArray(raw)) return null;
  const seen = new Set<string>();
  const marked = new Set<MilestoneMark>();
  const out: MilestoneTemplate[] = [];
  for (const t of raw) {
    if (!isObject(t)) continue;
    const id = str(t.id);
    const name = str(t.name)?.trim();
    if (!id || !name || seen.has(id) || !isTarget(t.targetDays)) continue;
    seen.add(id);
    const mark = MARKS.includes(t.marks as MilestoneMark) ? (t.marks as MilestoneMark) : undefined;
    const template: MilestoneTemplate = { id, name, targetDays: t.targetDays };
    if (mark && !marked.has(mark)) {
      template.marks = mark;
      marked.add(mark);
    }
    out.push(template);
  }
  return out;
}

/** The template new people start from. */
export function templatesOf(raw: unknown): readonly MilestoneTemplate[] {
  return normalizeTemplates(raw) ?? BUILT_IN_TEMPLATES;
}

const BUILT_IN_BY_NAME = new Map(BUILT_IN_TEMPLATES.map((t) => [t.name, t]));
const BUILT_IN_BY_ID = new Map(BUILT_IN_TEMPLATES.map((t) => [t.id, t]));

function normalizeMilestone(raw: unknown, i: number): Milestone | null {
  if (!isObject(raw)) return null;
  const name = str(raw.name) ?? "";
  // Spread first: a field a later version adds survives a write from this one.
  const m: Milestone = {
    ...(raw as Partial<Milestone>),
    id: str(raw.id) || `milestone-${i}`,
    name,
    targetDays: typeof raw.targetDays === "number" ? raw.targetDays : Number(raw.targetDays) || 0,
  };
  // A legacy milestone had only its name: link it to the built-in of that name.
  if (!str(m.templateId)) {
    delete m.templateId;
    const builtIn = BUILT_IN_BY_NAME.get(name);
    if (builtIn) m.templateId = builtIn.id;
  }
  if (m.marks !== undefined && !MARKS.includes(m.marks)) delete m.marks;
  for (const k of ["completedAt", "notes"] as const) {
    if (m[k] !== undefined && typeof m[k] !== "string") delete m[k];
  }
  return m;
}

/**
 * The people in any shape saved so far. Rows that aren't people are
 * dropped; nothing else changes, so it is safe on every read and write.
 */
export function normalizeOnboardees(raw: unknown): Onboardee[] {
  if (!Array.isArray(raw)) return [];
  const out: Onboardee[] = [];
  raw.forEach((p, i) => {
    if (!isObject(p)) return;
    const person: Onboardee = {
      ...(p as Partial<Onboardee>),
      id: str(p.id) || `person-${i}`,
      name: str(p.name) ?? "",
      startDate: str(p.startDate) ?? "",
      milestones: Array.isArray(p.milestones)
        ? p.milestones.flatMap((m, j) => normalizeMilestone(m, j) ?? [])
        : [],
    };
    for (const k of ["memberId", "role", "buddy", "buddyMemberId", "description"] as const) {
      if (person[k] !== undefined && typeof person[k] !== "string") delete person[k];
    }
    out.push(person);
  });
  return out;
}

/** A person's own copy of the template, with fresh ids. */
export function milestonesFrom(
  templates: readonly MilestoneTemplate[],
  newId: () => string
): Milestone[] {
  return templates.map((t) => ({
    id: newId(),
    templateId: t.id,
    name: t.name,
    targetDays: t.targetDays,
    ...(t.marks ? { marks: t.marks } : {}),
  }));
}

/**
 * The milestone's mark: its own copy, else (a legacy milestone) the mark of
 * the built-in it is linked to. Never read from the name.
 */
export function markOf(m: Pick<Milestone, "marks" | "templateId">): MilestoneMark | undefined {
  return m.marks ?? (m.templateId ? BUILT_IN_BY_ID.get(m.templateId)?.marks : undefined);
}

/** Calendar days from `from` to `to`; null when either isn't a day. */
export function daysBetween(from: string, to: string): number | null {
  const a = isoDayNumber(from);
  const b = isoDayNumber(to);
  return a === null || b === null ? null : b - a;
}

/** "Day N" since the start; negative before it; null without a start date. */
export function dayOf(person: Pick<Onboardee, "startDate">, today: string): number | null {
  return daysBetween(person.startDate, today);
}

export type MilestoneStatus = "done" | "overdue" | "at-risk" | "on-track";

/**
 * Where a milestone stands, used by both the KPIs and the milestone cards so
 * they always agree. An incomplete milestone is "overdue" once the days
 * since start pass its target, and "at risk" once more than half of its
 * target time has passed, until it becomes overdue. At-risk and overdue
 * never overlap. The AI prompt lists both together as at-risk.
 */
export function milestoneStatus(
  elapsedDays: number,
  milestone: Pick<Milestone, "targetDays" | "completedAt">
): MilestoneStatus {
  if (milestone.completedAt) return "done";
  // A missing or non-positive target (legacy data) can't be late.
  if (!Number.isFinite(milestone.targetDays) || milestone.targetDays <= 0) return "on-track";
  if (elapsedDays > milestone.targetDays) return "overdue";
  if (elapsedDays > milestone.targetDays * 0.5) return "at-risk";
  return "on-track";
}

/** Finished = every milestone done. Someone with no milestones is still active. */
export function isFinished(person: Pick<Onboardee, "milestones">): boolean {
  return person.milestones.length > 0 && person.milestones.every((m) => Boolean(m.completedAt));
}

/** Days from the start to the day it was reached (0 when reached before the start). */
export function daysToComplete(
  person: Pick<Onboardee, "startDate">,
  m: Pick<Milestone, "completedAt">
): number | null {
  if (!m.completedAt) return null;
  const d = daysBetween(person.startDate, m.completedAt);
  return d === null ? null : Math.max(0, d);
}

/** A KPI over people: how many reached it, and the mean once MIN_SAMPLE.average did. */
export interface MarkStat {
  n: number;
  /** Mean days, from MIN_SAMPLE.average people; null below. */
  avg: number | null;
  /** Each person's days, in people order. */
  values: { name: string; days: number }[];
}

export interface OnboardingStats {
  active: number;
  finished: number;
  overdue: number;
  atRisk: number;
  firstPr: MarkStat;
  productive: MarkStat;
}

function markStat(people: readonly Onboardee[], mark: MilestoneMark): MarkStat {
  const values: { name: string; days: number }[] = [];
  for (const p of people) {
    // The earliest reached milestone with the mark, if a person has two.
    const days = p.milestones
      .filter((m) => markOf(m) === mark)
      .map((m) => daysToComplete(p, m))
      .filter((d): d is number => d !== null);
    if (days.length > 0) values.push({ name: p.name, days: Math.min(...days) });
  }
  const avg =
    values.length >= MIN_SAMPLE.average
      ? values.reduce((s, v) => s + v.days, 0) / values.length
      : null;
  return { n: values.length, avg, values };
}

export function onboardingStats(people: readonly Onboardee[], today: string): OnboardingStats {
  let overdue = 0;
  let atRisk = 0;
  let finished = 0;
  for (const p of people) {
    if (isFinished(p)) finished++;
    const elapsed = dayOf(p, today) ?? 0;
    for (const m of p.milestones) {
      const s = milestoneStatus(elapsed, m);
      if (s === "overdue") overdue++;
      else if (s === "at-risk") atRisk++;
    }
  }
  return {
    active: people.length - finished,
    finished,
    overdue,
    atRisk,
    firstPr: markStat(people, "first-pr"),
    productive: markStat(people, "productive"),
  };
}

export interface RampPoint {
  day: number;
  /** Mean % of milestones reached by that day; null below MIN_SAMPLE.average people. */
  avgPct: number | null;
  /** People who have reached the day (started at least that many days ago). */
  reached: number;
}

/** How far the ramp runs: the longest target among the people's milestones. */
export function rampLength(people: readonly Onboardee[]): number {
  let max = 0;
  for (const p of people) for (const m of p.milestones) if (m.targetDays > max) max = m.targetDays;
  return max;
}

/**
 * The average share of milestones reached by each day since the start,
 * counting at day d only the people who started at least d days ago.
 * (Everyone used to count at every day, so a joiner of three days dragged
 * the day-60 point down with their day-3 progress.) A point needs
 * MIN_SAMPLE.average people; the curve runs to the longest target.
 */
export function rampCurve(
  people: readonly Onboardee[],
  today: string,
  opts: { step?: number; maxDay?: number } = {}
): RampPoint[] {
  const step = Math.max(1, Math.floor(opts.step ?? 5));
  const longest = opts.maxDay ?? rampLength(people);
  if (longest <= 0) return [];
  const maxDay = Math.ceil(longest / step) * step;
  const out: RampPoint[] = [];
  for (let d = 0; d <= maxDay; d += step) {
    let sum = 0;
    let reached = 0;
    for (const p of people) {
      const since = dayOf(p, today);
      if (p.milestones.length === 0 || since === null || since < d) continue;
      reached++;
      const done = p.milestones.filter((m) => {
        const days = daysToComplete(p, m);
        return days !== null && days <= d;
      }).length;
      sum += (done / p.milestones.length) * 100;
    }
    out.push({
      day: d,
      avgPct: reached >= MIN_SAMPLE.average ? sum / reached : null,
      reached,
    });
  }
  return out;
}

const plural = (n: number, one: string, many: string) => (n === 1 ? one : many);

/** "Ana", "Ana and Ben", "Ana, Ben and Cleo", "4 people". */
function names(list: readonly string[]): string {
  if (list.length > 3) return `${list.length} people`;
  if (list.length <= 1) return list[0] ?? "";
  return `${list.slice(0, -1).join(", ")} and ${list[list.length - 1]}`;
}

/**
 * The one sentence over the people: who has milestones overdue, else what
 * is at risk, else that everyone is on track.
 */
export function onboardingVerdict(people: readonly Onboardee[], today: string): string {
  if (people.length === 0) return "No new joiners yet.";
  const active = people.filter((p) => !isFinished(p));
  if (active.length === 0) {
    return people.length === 1
      ? `${people[0].name} has reached every milestone.`
      : `All ${people.length} new joiners have reached every milestone.`;
  }
  const late = active
    .map((p) => {
      const elapsed = dayOf(p, today) ?? 0;
      return {
        name: p.name,
        n: p.milestones.filter((m) => milestoneStatus(elapsed, m) === "overdue").length,
      };
    })
    .filter((x) => x.n > 0)
    .sort((a, b) => b.n - a.n);
  const onTrack = active.filter((p) => !late.some((l) => l.name === p.name)).map((p) => p.name);
  if (late.length > 0) {
    const head =
      late.length === 1
        ? `${late[0].name} has ${late[0].n} ${plural(late[0].n, "milestone", "milestones")} overdue`
        : `${names(late.map((l) => `${l.name} (${l.n})`))} have milestones overdue`;
    const tail =
      onTrack.length > 0
        ? `; ${names(onTrack)} ${plural(onTrack.length, "is", "are")} on track`
        : "";
    return `${head}${tail}.`;
  }
  const stats = onboardingStats(active, today);
  if (stats.atRisk > 0) {
    return `No milestone is overdue; ${stats.atRisk} ${plural(stats.atRisk, "is", "are")} at risk.`;
  }
  return active.length === 1
    ? `${active[0].name} is on track.`
    : `All ${active.length} new joiners are on track.`;
}
