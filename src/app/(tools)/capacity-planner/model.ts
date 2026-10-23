/**
 * The Capacity Planner's model, pure: how long the sprint is in working
 * days, which plan a new sprint can start from, where the hours go, and the
 * checks on typed numbers. The totals themselves come from
 * lib/sprints/capacity (`planCapacity`), so Sprint Planning shows the same
 * hours to the tenth.
 *
 * The hours model, in the order the deductions are made:
 *
 *   full time      people × sprint days × hours per day
 *   − days off     each person's days off (at most the sprint's days)
 *   − availability the share of their remaining days they aren't on this
 *                  team (part-time, shared with another team)
 *   − ceremonies   `ceremonyOverhead` % of the hours they are here: the
 *                  Scrum events (planning, daily, refinement, review, retro)
 *   − interruptions what the focus factor takes from the hours left after
 *                  the ceremonies: support, other meetings, switching
 *   = capacity     the hours left for sprint work
 *
 * That is `effectiveHours` in lib/sprints/capacity multiplied out; the
 * focus factor covers time outside the ceremonies, so the two are not one
 * discount counted twice.
 */

import type {
  CapacityConfig,
  CapacityMember,
  CapacityPlan,
  Sprint,
} from "@/lib/stores/workspace-types";
import { capacityPlanIdFor, planCapacity, pointsForecast } from "@/lib/sprints/capacity";
import {
  countWorkingDays,
  isoDayNumber,
  isoFromDayNumber,
  weekdayOf,
} from "@/lib/sprints/calendar";
import { cadenceCalendar, type CeremonyCadence } from "@/lib/sprints/cadence";
import { hasSyntheticDates, sprintsNewestFirst } from "@/lib/sprints/series";
import { isExampleId } from "@/components/tool-frame/example-data";
import type { Validation } from "@/lib/utils/form";

const round1 = (n: number) => {
  const r = Math.round(n * 10) / 10;
  return Object.is(r, -0) ? 0 : r;
};

/** A number for display: whole numbers as is, others to one decimal. */
export function fmt(n: number): string {
  return String(round1(n));
}

/** The longest sprint the planner takes, in working days (a 60-day sprint is about 43). */
export const MAX_SPRINT_DAYS = 60;

/** The settings a new plan starts with; the sprint length comes from the sprint or cadence. */
export function defaultConfig(sprintDays: number): CapacityConfig {
  return {
    sprintDays,
    ceremonyOverhead: 15,
    focusFactor: 0.8,
    hoursPerDay: 8,
    pointsCommitted: "",
  };
}

/* ── Sprint length ───────────────────────────────────────────────────── */

export interface SprintLength {
  /** Working days: the team's working weekdays, less team holidays. At least 1. */
  workingDays: number;
  /** Working weekdays before the holidays come off. */
  weekdays: number;
  /** Team holidays on a working weekday inside the sprint, "YYYY-MM-DD". */
  holidays: string[];
  /** From the sprint's own dates, or from the cadence's sprint length. */
  source: "dates" | "cadence";
  /** Calendar days from the first day to the last: the sprint's, or the cadence's. */
  calendarDays: number;
}

/**
 * How many working days the sprint has. With real dates: the team's working
 * days (the cadence's working week and holidays, lib/sprints/calendar) from
 * the first day up to the last, which is the convention the burndown's
 * working-day axis uses (`sprintWorkingDays`): the last day is the review
 * and retro. Without real dates, the cadence's sprint length scaled to the
 * working week (a 14-day sprint on Monday to Friday is 10 days).
 */
export function sprintLength(
  sprint: Pick<Sprint, "startDate" | "endDate"> | undefined,
  cadence: Pick<CeremonyCadence, "sprintLengthDays" | "workingDays" | "holidays">
): SprintLength {
  const calendar = cadenceCalendar(cadence);
  if (sprint && !hasSyntheticDates(sprint)) {
    const a = isoDayNumber(sprint.startDate) as number;
    const b = isoDayNumber(sprint.endDate) as number;
    if (b > a) {
      const holidays = calendar.holidays.filter((h) => {
        const n = isoDayNumber(h);
        const weekday = weekdayOf(h);
        return (
          n !== null &&
          n >= a &&
          n < b &&
          weekday !== null &&
          calendar.workingDays.includes(weekday)
        );
      });
      return {
        workingDays: Math.max(1, countWorkingDays(a, b, calendar)),
        weekdays: countWorkingDays(a, b, { ...calendar, holidays: [] }),
        holidays,
        source: "dates",
        calendarDays: b - a,
      };
    }
  }
  const days = cadence.sprintLengthDays;
  const perWeek = calendar.workingDays.length;
  const working = Math.max(1, Math.round((days * perWeek) / 7));
  return {
    workingDays: working,
    weekdays: working,
    holidays: [],
    source: "cadence",
    calendarDays: days,
  };
}

/** "Mon 12 Oct" for a "YYYY-MM-DD" date. */
export function shortDay(iso: string): string {
  const n = isoDayNumber(iso);
  if (n === null) return iso;
  return new Date(`${isoFromDayNumber(n)}T00:00:00Z`).toLocaleDateString("en-GB", {
    weekday: "short",
    day: "numeric",
    month: "short",
    timeZone: "UTC",
  });
}

/** How the working days were counted, for the hint under "Sprint length". */
export function sprintLengthText(length: SprintLength, sprintName?: string): string {
  if (length.source === "cadence") {
    return `Your cadence's ${length.calendarDays}-day sprint is about ${length.workingDays} working ${
      length.workingDays === 1 ? "day" : "days"
    }.`;
  }
  const who = sprintName ?? "The sprint";
  const n = length.holidays.length;
  if (n === 0) {
    return `${who}'s dates give ${length.workingDays} working ${length.workingDays === 1 ? "day" : "days"}.`;
  }
  return `${who}'s dates give ${length.weekdays} working days, less ${n} team ${
    n === 1 ? "holiday" : "holidays"
  } (${length.holidays.map(shortDay).join(", ")}): ${length.workingDays}.`;
}

/* ── Starting a sprint's plan ────────────────────────────────────────── */

/** A member with nothing typed in: the blank row older plans started with. */
export function isBlankMember(m: CapacityMember): boolean {
  return !m.name.trim() && !m.role.trim() && !m.description?.trim();
}

/** A plan with at least one real (not blank, not example) member. */
const hasTeam = (plan: CapacityPlan) =>
  plan.members.some((m) => !isBlankMember(m) && !isExampleId(m.id));

export interface PlanSource {
  plan: CapacityPlan;
  /** "Sprint 6's plan" or "your general plan". */
  label: string;
}

/**
 * The plan a sprint with none yet can copy: the newest other sprint's plan
 * that started before it (else any other sprint's), else the general
 * `capacity-planner:current` plan. Only plans with a real team count.
 */
export function lastPlanFor(
  plans: readonly CapacityPlan[],
  sprints: readonly Sprint[],
  sprint: Sprint
): PlanSource | null {
  const byId = new Map(plans.map((p) => [p.id, p]));
  const others = sprintsNewestFirst(sprints).filter((s) => s.id !== sprint.id);
  const start = isoDayNumber(sprint.startDate);
  const earlier = others.filter((s) => {
    const n = isoDayNumber(s.startDate);
    return start === null || n === null || n <= start;
  });
  for (const s of [...earlier, ...others]) {
    const plan = byId.get(capacityPlanIdFor(s.id));
    if (plan && hasTeam(plan)) return { plan, label: `${s.name}'s plan` };
  }
  const general = byId.get(capacityPlanIdFor(undefined));
  return general && hasTeam(general) ? { plan: general, label: "your general plan" } : null;
}

/**
 * A sprint's plan copied from `source`: the same people, availability and
 * settings. Days off and the commitment belong to one sprint, so they start
 * at 0 and blank; the length comes from the new sprint. Example and blank
 * rows stay behind.
 */
export function planFromSource(
  source: CapacityPlan,
  sprintId: string,
  sprintDays: number
): CapacityPlan {
  return {
    id: capacityPlanIdFor(sprintId),
    sprintId,
    members: source.members
      .filter((m) => !isExampleId(m.id) && !isBlankMember(m))
      .map((m) => ({ ...m, daysOff: 0 })),
    config: { ...source.config, sprintDays, pointsCommitted: "" },
  };
}

/**
 * An empty plan (a sprint's, or the general one): nobody yet, the default
 * settings. No blank starter row: an unnamed row at 100% counted a full
 * person's hours that nobody had.
 */
export function emptyPlan(sprintId: string | undefined, sprintDays: number): CapacityPlan {
  return {
    id: capacityPlanIdFor(sprintId),
    ...(sprintId ? { sprintId } : {}),
    members: [],
    config: defaultConfig(sprintDays),
  };
}

/* ── Adding a member ─────────────────────────────────────────────────── */

export interface MemberDraft {
  name: string;
  role: string;
  /** As typed. */
  availability: string;
  daysOff: string;
}

export type MemberField = keyof MemberDraft;

/** Shown filled in, so the usual case is one name away; both can be changed before adding. */
export const EMPTY_MEMBER_DRAFT: MemberDraft = {
  name: "",
  role: "",
  availability: "100",
  daysOff: "0",
};

export const AVAILABILITY_RULE: NumberRule = { name: "availability", min: 0, max: 100, unit: "%" };

/** Days off run from 0 to the sprint's working days. */
export function daysOffRule(sprintDays: number): NumberRule {
  return { name: "number of days off", min: 0, max: sprintDays, unit: " days", one: " day" };
}

export type MemberValues = Pick<CapacityMember, "name" | "role" | "availability" | "daysOff">;

/** A new member needs a name, and numbers in range; nothing is added until it has them. */
export function validateMember(
  d: MemberDraft,
  sprintDays: number
): Validation<MemberValues, MemberField> {
  const errors: Partial<Record<MemberField, string>> = {};
  const name = d.name.trim().replace(/\s+/g, " ");
  if (!name) errors.name = "Enter the person's name.";
  const availability = validateNumber(d.availability, AVAILABILITY_RULE);
  if (!availability.ok) errors.availability = availability.error;
  const daysOff = validateNumber(d.daysOff, daysOffRule(sprintDays));
  if (!daysOff.ok) errors.daysOff = daysOff.error;
  if (!availability.ok || !daysOff.ok || errors.name) return { ok: false, errors };
  return {
    ok: true,
    values: { name, role: d.role.trim(), availability: availability.value, daysOff: daysOff.value },
  };
}

/* ── Where the hours go ──────────────────────────────────────────────── */

export interface HoursBreakdown {
  people: number;
  sprintDays: number;
  hoursPerDay: number;
  /** Everyone, every working day, full hours. */
  fullTime: number;
  /** Days off taken, in days and in hours. */
  daysOff: number;
  daysOffHours: number;
  /** Hours people spend off this team on the days they're in. */
  availabilityHours: number;
  /** Scrum events: `ceremonyOverhead` % of the hours people are here. */
  ceremonyHours: number;
  /** The focus factor's share of what's left after the events. */
  interruptionHours: number;
  /** What's left for sprint work: `planCapacity(plan).totalHours`. */
  capacity: number;
}

/**
 * The hours from full time down to capacity, each deduction to one decimal.
 * The last deduction is whatever makes the column add up to the headline
 * total, so rounding never leaves the table 0.1 off.
 */
export function hoursBreakdown(plan: Pick<CapacityPlan, "members" | "config">): HoursBreakdown {
  const { sprintDays, hoursPerDay, ceremonyOverhead, focusFactor } = plan.config;
  let daysOff = 0;
  let off = 0;
  let away = 0;
  let events = 0;
  for (const m of plan.members) {
    const offDays = Math.min(Math.max(m.daysOff, 0), Math.max(sprintDays, 0));
    const inDays = Math.max(sprintDays - offDays, 0);
    const here = inDays * hoursPerDay * (m.availability / 100);
    daysOff += offDays;
    off += offDays * hoursPerDay;
    away += inDays * hoursPerDay - here;
    events += here * (ceremonyOverhead / 100);
  }
  const fullTime = round1(plan.members.length * Math.max(sprintDays, 0) * hoursPerDay);
  const capacity = planCapacity(plan).totalHours;
  const daysOffHours = round1(off);
  const availabilityHours = round1(away);
  const ceremonyHours = round1(events);
  const rest = round1(fullTime - daysOffHours - availabilityHours - ceremonyHours - capacity);
  // Focus factor 1 leaves nothing here; rounding mustn't show "−0.1 h".
  const interruptionHours = focusFactor >= 1 ? 0 : Math.max(0, rest);
  return {
    people: plan.members.length,
    sprintDays,
    hoursPerDay,
    fullTime,
    daysOff: round1(daysOff),
    daysOffHours,
    availabilityHours,
    ceremonyHours,
    interruptionHours,
    capacity,
  };
}

/**
 * The one-sentence answer: how much of full time is left, and what takes
 * the most. "191.5 of 400 full-time hours are left for sprint work (48%);
 * days off take the most, 64 hours."
 */
export function capacityVerdict(b: HoursBreakdown): string {
  if (b.fullTime <= 0) return "Add the team to see the sprint's capacity.";
  const share = Math.round((b.capacity / b.fullTime) * 100);
  const lead = `${fmt(b.capacity)} of ${fmt(b.fullTime)} full-time hours are left for sprint work (${share}%)`;
  const costs: [string, number][] = [
    ["days off take", b.daysOffHours],
    ["time away from the team (availability) takes", b.availabilityHours],
    ["the Scrum events take", b.ceremonyHours],
    ["interruptions outside the Scrum events take", b.interruptionHours],
  ];
  const [what, hours] = costs.reduce((best, c) => (c[1] > best[1] ? c : best));
  if (hours <= 0) return `${lead}.`;
  return `${lead}; ${what} the most, ${fmt(hours)} hours.`;
}

/* ── Points forecast ─────────────────────────────────────────────────── */

/** "Capacity is 90% of a normal sprint, so plan about 27 points (velocity 30 × 90%)." */
export function forecastSentence(
  plan: Pick<CapacityPlan, "members" | "config">,
  velocity: number | null
): string {
  const { ratio, points } = pointsForecast(plan, velocity);
  if (ratio === null) {
    return plan.members.length === 0
      ? "Add the team to see how many points this sprint can take."
      : "These settings leave no working hours: check the focus factor and the ceremony overhead.";
  }
  const pct = `${Math.round(ratio * 100)}%`;
  if (velocity === null) {
    return `Capacity is ${pct} of a normal sprint (everyone in, no days off). Finish a sprint with points to turn that into a points forecast.`;
  }
  if (ratio === 0) return "Nobody is available this sprint, so there is no room to plan.";
  return `Capacity is ${pct} of a normal sprint (everyone in, no days off), so plan about ${
    points ?? 0
  } ${points === 1 ? "point" : "points"} (velocity ${fmt(velocity)} × ${pct}).`;
}

/* ── Typed numbers ───────────────────────────────────────────────────── */

export interface NumberRule {
  /** Lower case, for messages: "availability", "days off". */
  name: string;
  min: number;
  max: number;
  /** Shown after numbers in messages: "%", " days". */
  unit?: string;
  /** The unit after exactly 1, when it differs: " day". */
  one?: string;
}

/** A value with its unit, for messages: "80%", "1 day", "2.5 days". */
export function withUnit(n: number, rule: Pick<NumberRule, "unit" | "one">): string {
  return `${fmt(n)}${n === 1 && rule.one !== undefined ? rule.one : (rule.unit ?? "")}`;
}

/**
 * A typed number checked against its range: the value, or the message to
 * show under the field. A blank field is an error, never a silent 0 (that
 * zeroed a member's hours before).
 */
export function validateNumber(
  raw: string,
  rule: NumberRule
): { ok: true; value: number } | { ok: false; error: string } {
  const unit = rule.unit ?? "";
  if (raw.trim() === "") {
    return { ok: false, error: `Enter the ${rule.name}, ${rule.min}–${rule.max}${unit}.` };
  }
  const n = Number(raw);
  if (!Number.isFinite(n)) return { ok: false, error: `The ${rule.name} is a number.` };
  if (n < rule.min || n > rule.max) {
    return {
      ok: false,
      error: `The ${rule.name} runs from ${rule.min} to ${rule.max}${unit}.`,
    };
  }
  return { ok: true, value: n };
}
