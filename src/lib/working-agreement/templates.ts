/**
 * The Working Agreement's charter templates: an urgency ladder, core hours,
 * focus time and AI use. Each turns a few answers into two or three plain
 * rules (eight at most for all four, so the charter stays at five to ten
 * rules), and remembers its answers in `WorkingAgreement.templates`, so the
 * team can change them and apply again.
 *
 *   - A template's rules carry `template: {id, slot}`. Applying again
 *     matches them by slot: the same rule is updated in place (its consent
 *     stays as it is), a new slot is added, a slot no longer written goes.
 *   - A slot whose text is already in the charter (any rule, a Kickoff one
 *     included) is skipped and reported, never doubled.
 *   - A rule edited by hand loses its `template` (model `withRuleText`): it
 *     is the team's own from then on, and applying again won't touch it.
 *
 * Every sentence here is our own words. Pure and server-safe: the page and
 * tool.working_agreement.apply_template write the same rules.
 */

import {
  CHARTER_TEMPLATE_MAX,
  type AiUseNeverIn,
  type AiUseReview,
  type CharterRule,
  type CharterRuleCategory,
  type CharterTemplateId,
  type CharterTemplates,
  type CoreHoursPurpose,
  type CoreHoursTemplate,
  type TeamTimePerson,
  type UrgencyLevel,
  type WorkingAgreement,
} from "@/lib/stores/workspace-types";
import { WEEKDAY_LABEL } from "@/lib/sprints/cadence";
import { isoDayNumber, isoFromDayNumber, weekdayOf } from "@/lib/sprints/calendar";
import { clockText, daysLabel, minuteOf } from "@/lib/team-time/format";
import { officeGroups, type OfficeGroup } from "@/lib/team-time/office";
import { bestSharedWindow } from "@/lib/team-time/overlap";
import { burden } from "@/lib/team-time/slots";
import { canonicalZone, localClock, wallToUtc, zoneLabel } from "@/lib/team-time/zones";
import { RULE_DESCRIPTION_MAX, RULE_TEXT_MAX, ruleKey } from "./model";
import {
  TEMPLATE_KEY,
  validateTemplateValues,
  type AiUseValues,
  type CoreHoursValues,
  type FocusTimeValues,
  type TemplateValuesById,
  type UrgencyLadderValues,
} from "./template-values";

export {
  TEMPLATE_KEY,
  isTemplateId,
  normalizeTemplates,
  readTemplateRef,
  type AiUseValues,
  type CoreHoursValues,
  type FocusTimeValues,
  type TemplateErrors,
  type TemplateValuesById,
  type UrgencyLadderValues,
} from "./template-values";

/** One line a template writes: its slot, the category the rule goes under, and whether it can be left out. */
export interface TemplateSlot {
  id: string;
  category: CharterRuleCategory;
  /** What the line is, for the form's preview. */
  label: string;
  optional: boolean;
}

export interface CharterTemplateDef {
  id: CharterTemplateId;
  name: string;
  /** One line on what it is for. */
  summary: string;
  slots: TemplateSlot[];
}

export const CHARTER_TEMPLATES: readonly CharterTemplateDef[] = [
  {
    id: "urgency-ladder",
    name: "Urgency ladder",
    summary: "How to reach each other for each kind of request, and how fast a reply comes.",
    slots: [
      { id: "ladder", category: "communication", label: "The ladder", optional: false },
      { id: "after-hours", category: "communication", label: "After hours", optional: true },
    ],
  },
  {
    id: "core-hours",
    name: "Core hours",
    summary: "The hours everyone is around for meetings and quick replies; the rest is written.",
    slots: [
      { id: "core", category: "meetings", label: "Core hours", optional: false },
      { id: "anchor-days", category: "work", label: "Office days", optional: true },
    ],
  },
  {
    id: "focus-time",
    name: "Focus time",
    summary: "Protected time with no meetings, where messages wait.",
    slots: [{ id: "focus", category: "work", label: "Focus time", optional: false }],
  },
  {
    id: "ai-use",
    name: "AI use",
    summary: "What never goes into an AI tool, and how AI-assisted work is reviewed.",
    slots: [
      { id: "never-in", category: "work", label: "Never into AI", optional: false },
      { id: "review", category: "work", label: "Review", optional: false },
      { id: "customer-facing", category: "work", label: "Customer-facing", optional: true },
    ],
  },
];

const DEF_BY_ID = new Map(CHARTER_TEMPLATES.map((t) => [t.id, t]));

export function templateDef(id: CharterTemplateId): CharterTemplateDef {
  return DEF_BY_ID.get(id) as CharterTemplateDef;
}

/** "Urgency ladder" for "urgency-ladder". */
export const templateName = (id: CharterTemplateId): string => templateDef(id).name;

/** The most rules all four templates write together. */
export const TEMPLATE_RULES_MAX = CHARTER_TEMPLATES.reduce((n, t) => n + t.slots.length, 0);

/* ── Defaults ───────────────────────────────────────────────────────── */

const DEFAULT_LEVELS: UrgencyLevel[] = [
  {
    id: "level-1",
    label: "Emergency",
    when: "Production is down or customers are blocked",
    channel: "Phone or page the on-call",
    replyWithin: "15 minutes, any time",
  },
  {
    id: "level-2",
    label: "Urgent today",
    when: "It blocks someone's work today",
    channel: "Direct message",
    replyWithin: "2 working hours",
  },
  {
    id: "level-3",
    label: "Normal",
    when: "Questions and reviews",
    channel: "A thread in the team channel",
    replyWithin: "1 working day",
  },
  {
    id: "level-4",
    label: "No rush",
    when: "Updates and ideas",
    channel: "A thread or email",
    replyWithin: "No reply needed",
  },
];

/**
 * Where a form starts for a template nobody applied yet. `timeZone` is the
 * browser's (core hours default to it, canonical); UTC without one.
 */
export function templateDefaults<Id extends CharterTemplateId>(
  id: Id,
  { timeZone }: { timeZone?: string } = {}
): TemplateValuesById[Id] {
  const zone = (timeZone && canonicalZone(timeZone)) || "UTC";
  const values: { [K in CharterTemplateId]: TemplateValuesById[K] } = {
    "urgency-ladder": { levels: DEFAULT_LEVELS.map((l) => ({ ...l })), afterHours: true },
    "core-hours": {
      start: "13:00",
      end: "15:00",
      timeZone: zone,
      days: [1, 2, 3, 4],
      purposes: ["meetings", "quick-replies"],
    },
    "focus-time": { days: [2, 4], start: "09:00", end: "12:00", timeZone: null },
    "ai-use": {
      tools: [],
      neverIn: ["customer-data", "secrets", "confidential"],
      review: "as-any-work",
      customerFacing: true,
    },
  };
  return values[id];
}

/** The template's values as the agreement holds them (when it was applied), or undefined. */
export function appliedValues<Id extends CharterTemplateId>(
  doc: Pick<WorkingAgreement, "templates">,
  id: Id
): (TemplateValuesById[Id] & { appliedAt: string }) | undefined {
  const stored = doc.templates?.[TEMPLATE_KEY[id]];
  return stored as (TemplateValuesById[Id] & { appliedAt: string }) | undefined;
}

/** A template's values checked and cleaned, or its problems by field. */
export const validateTemplate = validateTemplateValues;

/* ── The rules a template writes ────────────────────────────────────── */

export interface TemplateRule {
  slot: string;
  category: CharterRuleCategory;
  /** At most RULE_TEXT_MAX. */
  text: string;
  /** At most RULE_DESCRIPTION_MAX. */
  description?: string;
}

/** A field as part of a sentence: one line, no closing full stop or semicolon. */
const part = (s: string) =>
  s
    .replace(/\s*[\r\n]+\s*/g, " ")
    .trim()
    .replace(/[.;:,]+$/, "");

const cut = (s: string, max: number) => (s.length > max ? `${s.slice(0, max - 1).trimEnd()}…` : s);

/** "Tue and Thu", "Mon–Thu", "Mon, Wed and Fri". */
export function daysWords(days: readonly number[]): string {
  const label = daysLabel(days);
  const at = label.lastIndexOf(", ");
  return at < 0 ? label : `${label.slice(0, at)} and ${label.slice(at + 2)}`;
}

/** "UTC", or "London time". */
function zoneWords(zone: string): string {
  const label = zoneLabel(zone);
  return label === "UTC" ? "UTC" : `${label} time`;
}

const listOr = (parts: readonly string[]) =>
  parts.length <= 1
    ? (parts[0] ?? "")
    : `${parts.slice(0, -1).join(", ")} or ${parts[parts.length - 1]}`;
const listAnd = (parts: readonly string[]) =>
  parts.length <= 1
    ? (parts[0] ?? "")
    : `${parts.slice(0, -1).join(", ")} and ${parts[parts.length - 1]}`;

export const PURPOSE_LABEL: Record<CoreHoursPurpose, string> = {
  meetings: "meetings",
  "quick-replies": "quick replies",
  pairing: "pairing",
};

export const NEVER_IN_LABEL: Record<AiUseNeverIn, string> = {
  "customer-data": "Customer personal data",
  secrets: "Passwords, keys and tokens",
  confidential: "Confidential material",
};

export const REVIEW_LABEL: Record<AiUseReview, string> = {
  "as-any-work": "Review it like any other work",
  "closer-look": "Tell the reviewer, who looks closer",
  "not-production": "Not used for production work yet",
};

const REVIEW_SENTENCE: Record<AiUseReview, string> = {
  "as-any-work": "We review AI-assisted work like any other work",
  "closer-look": "We tell the reviewer when AI helped, and they look closer",
  "not-production": "We don't use AI for production work yet",
};

/** One rung of the ladder on one line: "Emergency: Production is down. Phone the on-call. 15 minutes, any time." */
export function levelLine(
  l: Pick<UrgencyLevel, "label" | "when" | "channel" | "replyWithin">
): string {
  return `${part(l.label)}: ${part(l.when)}. ${part(l.channel)}. ${part(l.replyWithin)}.`;
}

function ladderRules(v: UrgencyLadderValues): TemplateRule[] {
  const rules: TemplateRule[] = [
    {
      slot: "ladder",
      category: "communication",
      text: "We use the urgency ladder to choose how to reach each other and how fast to answer.",
      description: v.levels.map(levelLine).join("\n"),
    },
  ];
  const first = v.levels[0];
  if (v.afterHours && first) {
    rules.push({
      slot: "after-hours",
      category: "communication",
      text: `Outside someone's working hours, only ${part(first.label)} can't wait.`,
    });
  }
  return rules;
}

function coreRules(v: CoreHoursValues): TemplateRule[] {
  const purposes = listAnd(v.purposes.map((p) => PURPOSE_LABEL[p]));
  const rules: TemplateRule[] = [
    {
      slot: "core",
      category: "meetings",
      text: `Our core hours are ${v.start}–${v.end} ${zoneWords(v.timeZone)}, ${daysLabel(v.days)}: we keep ${purposes} inside them.`,
      description: "Outside them we work in writing.",
    },
  ];
  const anchors = (v.anchorDays ?? []).filter((a) => a.days.length > 0);
  if (anchors.length > 0) {
    rules.push({
      slot: "anchor-days",
      category: "work",
      text: `In the office: ${anchors.map((a) => `${part(a.site)} on ${daysWords(a.days)}`).join("; ")}.`,
    });
  }
  return rules;
}

/** The ladder's top two levels, for what may interrupt focus time ("Emergency or Urgent today"). */
function urgentWords(ladder: UrgencyLadderValues | undefined): string {
  const labels = (ladder?.levels ?? [])
    .slice(0, 2)
    .map((l) => part(l.label))
    .filter(Boolean);
  return labels.length > 0 ? listOr(labels) : "urgent";
}

function focusRules(v: FocusTimeValues, ladder: UrgencyLadderValues | undefined): TemplateRule[] {
  const clock = v.timeZone ? zoneWords(v.timeZone) : "on each person's own clock";
  const minimum =
    v.weeklyMinHours !== undefined
      ? `; each of us keeps at least ${v.weeklyMinHours} ${v.weeklyMinHours === 1 ? "hour" : "hours"} of it a week`
      : "";
  return [
    {
      slot: "focus",
      category: "work",
      text: `Focus time is ${daysWords(v.days)}, ${v.start}–${v.end} ${clock}: no meetings, and messages wait unless they are ${urgentWords(ladder)}${minimum}.`,
    },
  ];
}

function aiRules(v: AiUseValues): TemplateRule[] {
  const items = [
    ...v.neverIn.map((k) => NEVER_IN_LABEL[k]),
    ...(v.neverInOther ? [part(v.neverInOther)] : []),
  ];
  const rules: TemplateRule[] = [];
  if (items.length > 0) {
    rules.push({
      slot: "never-in",
      category: "work",
      text: "We never put these into an AI tool.",
      description: items.map((i) => `- ${i}`).join("\n"),
    });
  }
  rules.push({
    slot: "review",
    category: "work",
    text: `${REVIEW_SENTENCE[v.review]}: we say when AI wrote a large part, and whoever ships it owns it.`,
  });
  if (v.customerFacing) {
    rules.push({
      slot: "customer-facing",
      category: "work",
      text: "A person reads anything customer-facing before it goes out.",
    });
  }
  return rules;
}

/**
 * The rules a template writes from its (checked) values, in slot order.
 * Focus time names the ladder's top two levels when `ladder` is given (the
 * charter's own urgency ladder), else "urgent". Texts and descriptions are
 * cut to the rule caps (they fit at every template cap).
 */
export function templateRules<Id extends CharterTemplateId>(
  id: Id,
  values: TemplateValuesById[Id],
  { ladder }: { ladder?: UrgencyLadderValues } = {}
): TemplateRule[] {
  let rules: TemplateRule[];
  switch (id) {
    case "urgency-ladder":
      rules = ladderRules(values as UrgencyLadderValues);
      break;
    case "core-hours":
      rules = coreRules(values as CoreHoursValues);
      break;
    case "focus-time":
      rules = focusRules(values as FocusTimeValues, ladder);
      break;
    default:
      rules = aiRules(values as AiUseValues);
  }
  return rules.map((r) => ({
    ...r,
    text: cut(r.text, RULE_TEXT_MAX),
    ...(r.description !== undefined
      ? { description: cut(r.description, RULE_DESCRIPTION_MAX) }
      : {}),
  }));
}

/* ── Applying ───────────────────────────────────────────────────────── */

export interface SkippedSlot {
  slot: string;
  /** The text that is already in the charter. */
  text: string;
  reason: "duplicate";
  /** The rule that already says it. */
  ruleId: string;
}

export interface ApplyResult {
  doc: WorkingAgreement;
  /** Rule ids, as written. */
  added: string[];
  updated: string[];
  removed: string[];
  skipped: SkippedSlot[];
  /** Every rule the template has in the charter now, in charter order. */
  ruleIds: string[];
}

/** The template's rules in the charter, in charter order. */
export function templateRuleIds(
  doc: Pick<WorkingAgreement, "rules">,
  id: CharterTemplateId
): string[] {
  return doc.rules.filter((r) => r.template?.id === id).map((r) => r.id);
}

const sameRule = (a: CharterRule, b: TemplateRule) =>
  a.text === b.text && (a.description ?? "") === (b.description ?? "") && a.category === b.category;

/**
 * `doc` with template `id` applied with `values` (already checked; see
 * validateTemplate) at `now`: its answers saved in `templates`, and its
 * rules matched by slot (updated in place, keeping their id and consent),
 * added (new ids from `newId`) or removed. A slot whose text another rule
 * already says (case, spacing and a closing full stop aside) is skipped.
 */
export function applyTemplate<Id extends CharterTemplateId>(
  doc: WorkingAgreement,
  id: Id,
  values: TemplateValuesById[Id],
  newId: () => string,
  now: string
): ApplyResult {
  const ladder =
    id === "urgency-ladder" ? (values as UrgencyLadderValues) : doc.templates?.urgencyLadder;
  const wanted = templateRules(id, values, { ladder });
  const own = new Map<string, CharterRule>();
  for (const r of doc.rules)
    if (r.template?.id === id && !own.has(r.template.slot)) own.set(r.template.slot, r);
  const wantedSlots = new Set(wanted.map((w) => w.slot));

  const added: string[] = [];
  const updated: string[] = [];
  const removed: string[] = [];
  const skipped: SkippedSlot[] = [];

  // Another rule (not this one) that already says `text`.
  const sayer = (text: string, self: string | null, rules: readonly CharterRule[]) =>
    rules.find((r) => r.id !== self && ruleKey(r.text) === ruleKey(text));

  // Rules this template no longer writes go first, so a slot can take back their words.
  let rules = doc.rules.filter((r) => {
    if (r.template?.id !== id) return true;
    const keep = wantedSlots.has(r.template.slot) && own.get(r.template.slot)?.id === r.id;
    if (!keep) removed.push(r.id);
    return keep;
  });

  for (const w of wanted) {
    const current = own.get(w.slot);
    const dup = sayer(w.text, current?.id ?? null, rules);
    if (dup) {
      skipped.push({ slot: w.slot, text: w.text, reason: "duplicate", ruleId: dup.id });
      continue;
    }
    if (current) {
      if (sameRule(current, w)) continue;
      const next: CharterRule = { ...current, category: w.category, text: w.text };
      if (w.description) next.description = w.description;
      else delete next.description;
      rules = rules.map((r) => (r.id === current.id ? next : r));
      updated.push(current.id);
    } else {
      const rule: CharterRule = {
        id: newId(),
        category: w.category,
        text: w.text,
        agreedBy: [],
        consent: [],
        ...(w.description ? { description: w.description } : {}),
        template: { id, slot: w.slot },
      };
      rules = [...rules, rule];
      added.push(rule.id);
    }
  }

  const templates: CharterTemplates = {
    ...(doc.templates ?? {}),
    [TEMPLATE_KEY[id]]: { ...values, appliedAt: now },
  };
  const next: WorkingAgreement = { ...doc, rules, templates };
  return { doc: next, added, updated, removed, skipped, ruleIds: templateRuleIds(next, id) };
}

/**
 * What applying would do, for the form's preview: the rules it writes, and
 * which would be added, updated, removed or skipped (applyTemplate on a
 * copy; nothing is written).
 */
export function previewTemplate<Id extends CharterTemplateId>(
  doc: WorkingAgreement,
  id: Id,
  values: TemplateValuesById[Id]
): Omit<ApplyResult, "doc"> & { rules: TemplateRule[] } {
  let n = 0;
  const { doc: _ignored, ...rest } = applyTemplate(doc, id, values, () => `preview-${++n}`, "");
  void _ignored;
  const ladder =
    id === "urgency-ladder" ? (values as UrgencyLadderValues) : doc.templates?.urgencyLadder;
  return { ...rest, rules: templateRules(id, values, { ladder }) };
}

/** Each template, applied or not, for tool.working_agreement.list_templates. */
export function templatesSummary(doc: Pick<WorkingAgreement, "rules" | "templates">) {
  return CHARTER_TEMPLATES.map((t) => {
    const stored = appliedValues(doc, t.id);
    const ruleIds = templateRuleIds(doc, t.id);
    if (!stored) return { id: t.id, name: t.name, applied: false, ruleIds };
    const { appliedAt, ...values } = stored;
    return {
      id: t.id,
      name: t.name,
      applied: true,
      ...(appliedAt ? { appliedAt } : {}),
      values,
      ruleIds,
    };
  });
}

/* ── Core hours on each person's clock ──────────────────────────────── */

type Person = Pick<TeamTimePerson, "id" | "name" | "timeZone" | "start" | "end" | "workingDays">;

export interface LocalCoreHours {
  id: string;
  name: string;
  zone: string;
  /** "HH:MM" on their clock. */
  start: string;
  end: string;
  /** Their weekday at the start (0 Sunday). */
  weekday: number;
  /** -1, 0 or 1: their day at the start against the core hours' own day. */
  dayShift: number;
  /** The core hours aren't all inside their working hours. */
  outside: boolean;
}

export interface CoreHoursOnClocks {
  /** The core-hours day it was read on ("YYYY-MM-DD" in the template's zone), null when none. */
  day: string | null;
  people: LocalCoreHours[];
  /** Names of those it falls outside, in the order given. */
  outside: string[];
}

/**
 * The core hours on each Team Time person's own clock, on the first core
 * day on or after `date` (so the clock changes of that day count), and who
 * they fall outside. Shown live in the form and never stored: a clock
 * change would make stored local times wrong.
 */
export function coreHoursFor(
  core: Pick<CoreHoursTemplate, "start" | "end" | "timeZone" | "days">,
  people: readonly Person[],
  date: Date | number
): CoreHoursOnClocks {
  const zone = canonicalZone(core.timeZone);
  const startMinute = minuteOf(core.start);
  const endMinute = minuteOf(core.end);
  if (!zone || startMinute === null || endMinute === null || core.days.length === 0) {
    return { day: null, people: [], outside: [] };
  }
  const today = isoDayNumber(localClock(zone, date).day);
  if (today === null) return { day: null, people: [], outside: [] };
  let day: string | null = null;
  for (let k = 0; k < 7 && !day; k++) {
    const candidate = isoFromDayNumber(today + k);
    if (core.days.includes(weekdayOf(candidate) ?? -1)) day = candidate;
  }
  if (!day) return { day: null, people: [], outside: [] };
  const dayNumber = isoDayNumber(day) as number;
  const endDay = endMinute <= startMinute ? isoFromDayNumber(dayNumber + 1) : day;
  const start = wallToUtc(day, core.start, zone);
  const end = wallToUtc(endDay, core.end, zone);
  if (!start || !end) return { day, people: [], outside: [] };
  const rows: LocalCoreHours[] = [];
  for (const p of people) {
    try {
      const a = localClock(p.timeZone, start);
      const b = localClock(p.timeZone, end);
      const outside = burden(p, start, end) > 0;
      rows.push({
        id: p.id,
        name: p.name,
        zone: p.timeZone,
        start: clockText(a.minute),
        end: clockText(b.minute),
        weekday: a.weekday,
        dayShift: (isoDayNumber(a.day) ?? dayNumber) - dayNumber,
        outside,
      });
    } catch {
      /* a zone this runtime doesn't know: left out */
    }
  }
  return { day, people: rows, outside: rows.filter((r) => r.outside).map((r) => r.name) };
}

/** "Tue 19:00–21:00" for one person's local core hours (the day only when it isn't the core day). */
export function localCoreText(r: LocalCoreHours): string {
  return `${r.dayShift !== 0 ? `${WEEKDAY_LABEL[r.weekday]} ` : ""}${r.start}–${r.end}`;
}

/** What "Use Team Time's shared hours" found. */
export type SharedHoursFill =
  | { kind: "no-people" }
  | { kind: "none" }
  | {
      kind: "everyone" | "all-but-one";
      start: string;
      end: string;
      days: number[];
      timeZone: string;
      /** Who the window leaves out (all-but-one), by the name the page shows. */
      leftOut: string | null;
      /** Team Time's office anchor days per site (at most CHARTER_TEMPLATE_MAX.anchorDays). */
      anchorDays: { site: string; days: number[] }[];
    };

/**
 * Team Time's anchor days, one per office name (at most
 * CHARTER_TEMPLATE_MAX.anchorDays). A site and a zone city can share a name
 * (people at the "London" site, and people in London who name no site):
 * the template lists an office once, so the named site wins.
 */
function anchorDaysByName(
  people: readonly Pick<TeamTimePerson, "id" | "timeZone" | "workingDays" | "officeDays" | "site">[]
): { site: string; days: number[] }[] {
  const byName = new Map<string, OfficeGroup>();
  for (const g of officeGroups(people)) {
    if (g.anchorDays.length === 0) continue;
    const key = g.label.trim().toLowerCase();
    const had = byName.get(key);
    if (!had || (had.site === null && g.site !== null)) byName.set(key, g);
  }
  return Array.from(byName.values())
    .map((g) => ({ site: g.label, days: g.anchorDays }))
    .slice(0, CHARTER_TEMPLATE_MAX.anchorDays);
}

/**
 * Core hours from Team Time: this week's window with everyone in, on a
 * clock in `zone`, else the all-but-one window (naming who is left out),
 * with the offices' anchor days (each office name once). People are Team
 * Time rows, example rows already dropped, with the names the page shows.
 */
export function coreHoursFromTeamTime(
  people: readonly (Person & Pick<TeamTimePerson, "officeDays" | "site">)[],
  zone: string,
  now: Date | number
): SharedHoursFill {
  if (people.length === 0) return { kind: "no-people" };
  const clock = canonicalZone(zone) ?? "UTC";
  const best = bestSharedWindow(people, clock, now);
  if (!best) return { kind: "none" };
  const end = best.end === "24:00" ? "00:00" : best.end;
  return {
    kind: best.kind,
    start: best.start,
    end,
    days: best.days,
    timeZone: clock,
    leftOut: best.leftOut ? (people.find((p) => p.id === best.leftOut)?.name ?? null) : null,
    anchorDays: anchorDaysByName(people),
  };
}

/**
 * Undo of an apply: `current` with what the apply did taken back, using
 * the agreement as it was `before` (the rules it added go, the rules it
 * updated or removed come back as they were, and the template's answers
 * go back to what they were, or go). Other changes made since stay.
 */
export function revertTemplate(
  current: WorkingAgreement,
  before: WorkingAgreement,
  id: CharterTemplateId,
  done: Pick<ApplyResult, "added" | "updated" | "removed">
): WorkingAgreement {
  const was = new Map(before.rules.map((r) => [r.id, r]));
  const added = new Set(done.added);
  const updated = new Set(done.updated);
  let rules = current.rules
    .filter((r) => !added.has(r.id))
    .map((r) => (updated.has(r.id) ? (was.get(r.id) ?? r) : r));
  for (const ruleId of done.removed) {
    const old = was.get(ruleId);
    if (!old || rules.some((r) => r.id === ruleId)) continue;
    const at = before.rules.findIndex((r) => r.id === ruleId);
    rules = [...rules.slice(0, at), old, ...rules.slice(at)];
  }
  const key = TEMPLATE_KEY[id];
  const templates: CharterTemplates = { ...(current.templates ?? {}) };
  const prior = before.templates?.[key];
  if (prior) Object.assign(templates, { [key]: prior });
  else delete templates[key];
  const next: WorkingAgreement = { ...current, rules };
  if (Object.keys(templates).length > 0) next.templates = templates;
  else delete next.templates;
  return next;
}
