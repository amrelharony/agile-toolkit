/**
 * The values each charter template holds (an urgency ladder, core hours,
 * focus time, AI use): how a stored one is read back, and how a form's or
 * an agent's values are checked before a template is applied. Pure and
 * server-safe, with nothing from the agreement's model, so the model can
 * read `WorkingAgreement.templates` through it (lib/working-agreement/
 * templates.ts holds the templates themselves and re-exports these).
 */

import {
  AI_USE_NEVER_IN,
  AI_USE_REVIEW,
  CHARTER_TEMPLATE_IDS,
  CHARTER_TEMPLATE_MAX,
  CORE_HOURS_PURPOSES,
  type AiUseNeverIn,
  type AiUseReview,
  type AiUseTemplate,
  type CharterTemplateId,
  type CharterTemplates,
  type CoreHoursPurpose,
  type CoreHoursTemplate,
  type FocusTimeTemplate,
  type UrgencyLadderTemplate,
  type UrgencyLevel,
} from "@/lib/stores/workspace-types";
import { TIME_PATTERN } from "@/lib/sprints/cadence";
import { canonicalZone } from "@/lib/team-time/zones";
import type { Validation } from "@/lib/utils/form";

/** A template's values as a form or an agent gives them: everything but when it was applied. */
export type UrgencyLadderValues = Omit<UrgencyLadderTemplate, "appliedAt">;
export type CoreHoursValues = Omit<CoreHoursTemplate, "appliedAt">;
export type FocusTimeValues = Omit<FocusTimeTemplate, "appliedAt">;
export type AiUseValues = Omit<AiUseTemplate, "appliedAt">;

export interface TemplateValuesById {
  "urgency-ladder": UrgencyLadderValues;
  "core-hours": CoreHoursValues;
  "focus-time": FocusTimeValues;
  "ai-use": AiUseValues;
}

/** Where each template's values sit in `WorkingAgreement.templates`. */
export const TEMPLATE_KEY = {
  "urgency-ladder": "urgencyLadder",
  "core-hours": "coreHours",
  "focus-time": "focusTime",
  "ai-use": "aiUse",
} as const satisfies Record<CharterTemplateId, keyof CharterTemplates>;

const M = CHARTER_TEMPLATE_MAX;

type Row = Record<string, unknown>;
const isRow = (v: unknown): v is Row => typeof v === "object" && v !== null && !Array.isArray(v);

/** One line, trimmed: a typed newline doesn't split a rule. */
const oneLine = (v: unknown): string =>
  typeof v === "string" ? v.replace(/\s*[\r\n]+\s*/g, " ").trim() : "";

const isTime = (v: unknown): v is string => typeof v === "string" && TIME_PATTERN.test(v);

/** Weekdays (0 Sunday to 6 Saturday), each once, in order. */
export function weekdaysOf(v: unknown): number[] {
  if (!Array.isArray(v)) return [];
  const days = v.filter((d): d is number => Number.isInteger(d) && d >= 0 && d <= 6);
  return Array.from(new Set(days)).sort((a, b) => a - b);
}

const oneOf = <T extends string>(list: readonly T[], v: unknown): v is T =>
  typeof v === "string" && (list as readonly string[]).includes(v);

export const isTemplateId = (v: unknown): v is CharterTemplateId => oneOf(CHARTER_TEMPLATE_IDS, v);

/** A rule's `template` as stored, or null when it isn't one a template wrote. */
export function readTemplateRef(raw: unknown): { id: CharterTemplateId; slot: string } | null {
  if (!isRow(raw) || !isTemplateId(raw.id)) return null;
  const slot = typeof raw.slot === "string" ? raw.slot.trim() : "";
  if (!slot || slot.length > M.slot) return null;
  return { id: raw.id, slot };
}

/* ── Reading stored values (lenient: cut to the caps, never invent) ──── */

function readLevels(raw: unknown): UrgencyLevel[] {
  if (!Array.isArray(raw)) return [];
  const out: UrgencyLevel[] = [];
  raw.forEach((l: unknown, i) => {
    if (!isRow(l)) return;
    const label = oneLine(l.label).slice(0, M.levelLabel);
    if (!label) return;
    const id =
      typeof l.id === "string" && l.id.trim() ? l.id.trim().slice(0, 64) : `level-${i + 1}`;
    out.push({
      id: out.some((x) => x.id === id) ? `${id}-${i + 1}` : id,
      label,
      when: oneLine(l.when).slice(0, M.levelWhen),
      channel: oneLine(l.channel).slice(0, M.levelChannel),
      replyWithin: oneLine(l.replyWithin).slice(0, M.levelReplyWithin),
    });
  });
  return out.slice(0, M.levels);
}

const appliedAtOf = (raw: Row) => (typeof raw.appliedAt === "string" ? raw.appliedAt : "");

function readLadder(raw: unknown): UrgencyLadderTemplate | null {
  if (!isRow(raw)) return null;
  const levels = readLevels(raw.levels);
  if (levels.length < M.levelsMin) return null;
  return { levels, afterHours: raw.afterHours === true, appliedAt: appliedAtOf(raw) };
}

function readAnchorDays(raw: unknown): { site: string; days: number[] }[] {
  if (!Array.isArray(raw)) return [];
  return raw
    .filter(isRow)
    .map((a) => ({ site: oneLine(a.site).slice(0, M.site), days: weekdaysOf(a.days) }))
    .filter((a) => a.site && a.days.length > 0)
    .slice(0, M.anchorDays);
}

function readCore(raw: unknown): CoreHoursTemplate | null {
  if (!isRow(raw) || !isTime(raw.start) || !isTime(raw.end) || raw.start === raw.end) return null;
  const timeZone = typeof raw.timeZone === "string" ? canonicalZone(raw.timeZone) : null;
  const days = weekdaysOf(raw.days);
  const purposes = (Array.isArray(raw.purposes) ? raw.purposes : []).filter(
    (p): p is CoreHoursPurpose => oneOf(CORE_HOURS_PURPOSES, p)
  );
  if (!timeZone || days.length === 0 || purposes.length === 0) return null;
  const anchorDays = readAnchorDays(raw.anchorDays);
  return {
    start: raw.start,
    end: raw.end,
    timeZone,
    days,
    purposes: CORE_HOURS_PURPOSES.filter((p) => purposes.includes(p)),
    ...(anchorDays.length > 0 ? { anchorDays } : {}),
    appliedAt: appliedAtOf(raw),
  };
}

const inHoursRange = (v: unknown): v is number =>
  typeof v === "number" && Number.isFinite(v) && v >= M.weeklyMinHoursMin && v <= M.weeklyMinHours;

function readFocus(raw: unknown): FocusTimeTemplate | null {
  if (!isRow(raw) || !isTime(raw.start) || !isTime(raw.end) || raw.start === raw.end) return null;
  const days = weekdaysOf(raw.days);
  if (days.length === 0) return null;
  let timeZone: string | null = null;
  if (raw.timeZone !== null && raw.timeZone !== undefined) {
    timeZone = typeof raw.timeZone === "string" ? canonicalZone(raw.timeZone) : null;
    if (!timeZone) return null;
  }
  return {
    days,
    start: raw.start,
    end: raw.end,
    timeZone,
    ...(inHoursRange(raw.weeklyMinHours) ? { weeklyMinHours: raw.weeklyMinHours } : {}),
    appliedAt: appliedAtOf(raw),
  };
}

function readAiUse(raw: unknown): AiUseTemplate | null {
  if (!isRow(raw) || !oneOf(AI_USE_REVIEW, raw.review)) return null;
  const neverIn = AI_USE_NEVER_IN.filter(
    (k) => Array.isArray(raw.neverIn) && raw.neverIn.includes(k)
  );
  const neverInOther = oneLine(raw.neverInOther).slice(0, M.aiNote);
  const shareWhere = oneLine(raw.shareWhere).slice(0, M.aiNote);
  const tools = cleanTools(raw.tools);
  return {
    tools,
    neverIn,
    ...(neverInOther ? { neverInOther } : {}),
    review: raw.review,
    customerFacing: raw.customerFacing === true,
    ...(shareWhere ? { shareWhere } : {}),
    appliedAt: appliedAtOf(raw),
  };
}

/** The AI tools named, one line each, cut to the cap, each once (by case), at most five. */
function cleanTools(raw: unknown): string[] {
  if (!Array.isArray(raw)) return [];
  const seen = new Set<string>();
  const out: string[] = [];
  for (const t of raw) {
    const name = oneLine(t).slice(0, M.aiTool);
    if (!name || seen.has(name.toLowerCase())) continue;
    seen.add(name.toLowerCase());
    out.push(name);
  }
  return out.slice(0, M.aiTools);
}

/**
 * The templates an agreement has applied, read back from whatever was
 * stored: a template that can't be used (a ladder with one level, core
 * hours in a zone this runtime doesn't know) is left out, text is cut to
 * its caps. Undefined when none is left.
 */
export function normalizeTemplates(raw: unknown): CharterTemplates | undefined {
  if (!isRow(raw)) return undefined;
  const out: CharterTemplates = {};
  const ladder = readLadder(raw.urgencyLadder);
  const core = readCore(raw.coreHours);
  const focus = readFocus(raw.focusTime);
  const ai = readAiUse(raw.aiUse);
  if (ladder) out.urgencyLadder = ladder;
  if (core) out.coreHours = core;
  if (focus) out.focusTime = focus;
  if (ai) out.aiUse = ai;
  return Object.keys(out).length > 0 ? out : undefined;
}

/* ── Checking values before a template is applied ───────────────────── */

/** A form's or an agent's values as given: loose shapes, checked by `validateTemplateValues`. */
export type TemplateErrors = Partial<Record<string, string>>;

const fail = <V>(errors: TemplateErrors): Validation<V> => ({ ok: false, errors });

function checkLadder(raw: unknown): Validation<UrgencyLadderValues> {
  const r = isRow(raw) ? raw : {};
  const list = Array.isArray(r.levels) ? r.levels : [];
  const errors: TemplateErrors = {};
  if (list.length < M.levelsMin) errors.levels = `Give the ladder at least ${M.levelsMin} levels.`;
  else if (list.length > M.levels) errors.levels = `Keep the ladder to ${M.levels} levels.`;
  const levels: UrgencyLevel[] = [];
  const labels = new Set<string>();
  const ids = new Set<string>();
  list.slice(0, M.levels).forEach((raw, i) => {
    const l = isRow(raw) ? raw : {};
    const label = oneLine(l.label);
    const when = oneLine(l.when);
    const channel = oneLine(l.channel);
    const replyWithin = oneLine(l.replyWithin);
    const at = `levels.${i}`;
    if (!label) errors[`${at}.label`] = "Name the level.";
    else if (label.length > M.levelLabel)
      errors[`${at}.label`] = `Keep it to ${M.levelLabel} characters.`;
    else if (labels.has(label.toLowerCase())) errors[`${at}.label`] = "Two levels have this name.";
    if (!when) errors[`${at}.when`] = "Say when to use it.";
    else if (when.length > M.levelWhen)
      errors[`${at}.when`] = `Keep it to ${M.levelWhen} characters.`;
    if (!channel) errors[`${at}.channel`] = "Say where to send it.";
    else if (channel.length > M.levelChannel) {
      errors[`${at}.channel`] = `Keep it to ${M.levelChannel} characters.`;
    }
    if (!replyWithin) errors[`${at}.replyWithin`] = "Say how fast a reply comes.";
    else if (replyWithin.length > M.levelReplyWithin) {
      errors[`${at}.replyWithin`] = `Keep it to ${M.levelReplyWithin} characters.`;
    }
    labels.add(label.toLowerCase());
    let id = typeof l.id === "string" && l.id.trim() ? l.id.trim().slice(0, 64) : `level-${i + 1}`;
    if (ids.has(id)) id = `level-${i + 1}`;
    while (ids.has(id)) id = `${id}-x`;
    ids.add(id);
    levels.push({ id, label, when, channel, replyWithin });
  });
  if (Object.keys(errors).length > 0) return fail(errors);
  return { ok: true, values: { levels, afterHours: r.afterHours === true } };
}

function checkTimes(r: Row, errors: TemplateErrors): { start: string; end: string } {
  const start = typeof r.start === "string" ? r.start.trim() : "";
  const end = typeof r.end === "string" ? r.end.trim() : "";
  if (!isTime(start)) errors.start = "Pick a start time.";
  if (!isTime(end)) errors.end = "Pick an end time.";
  else if (start === end) errors.end = "End at another time than the start.";
  return { start, end };
}

function checkDays(r: Row, errors: TemplateErrors, word: string): number[] {
  const days = weekdaysOf(r.days);
  if (days.length === 0) errors.days = `Pick at least one day ${word}.`;
  return days;
}

function checkZone(raw: unknown, errors: TemplateErrors): string {
  const zone = typeof raw === "string" ? canonicalZone(raw.trim()) : null;
  if (!zone) errors.timeZone = "Pick a time zone from the list, such as Europe/London.";
  return zone ?? "";
}

function checkCore(raw: unknown): Validation<CoreHoursValues> {
  const r = isRow(raw) ? raw : {};
  const errors: TemplateErrors = {};
  const { start, end } = checkTimes(r, errors);
  const timeZone = checkZone(r.timeZone, errors);
  const days = checkDays(r, errors, "for core hours");
  const given = Array.isArray(r.purposes) ? r.purposes : [];
  const purposes = CORE_HOURS_PURPOSES.filter((p) => given.includes(p));
  if (purposes.length === 0) errors.purposes = "Pick what the core hours are for.";
  const anchors = Array.isArray(r.anchorDays) ? r.anchorDays : [];
  const anchorDays: { site: string; days: number[] }[] = [];
  if (anchors.length > M.anchorDays) {
    errors.anchorDays = `Keep it to ${M.anchorDays} offices.`;
  }
  const sites = new Set<string>();
  anchors.slice(0, M.anchorDays).forEach((a, i) => {
    const row = isRow(a) ? a : {};
    const site = oneLine(row.site);
    const ds = weekdaysOf(row.days);
    if (!site) errors[`anchorDays.${i}.site`] = "Name the office.";
    else if (site.length > M.site)
      errors[`anchorDays.${i}.site`] = `Keep it to ${M.site} characters.`;
    else if (sites.has(site.toLowerCase()))
      errors[`anchorDays.${i}.site`] = "This office is listed twice.";
    if (ds.length === 0) errors[`anchorDays.${i}.days`] = "Pick at least one day in the office.";
    sites.add(site.toLowerCase());
    anchorDays.push({ site, days: ds });
  });
  if (Object.keys(errors).length > 0) return fail(errors);
  return {
    ok: true,
    values: {
      start,
      end,
      timeZone,
      days,
      purposes,
      ...(anchorDays.length > 0 ? { anchorDays } : {}),
    },
  };
}

function checkFocus(raw: unknown): Validation<FocusTimeValues> {
  const r = isRow(raw) ? raw : {};
  const errors: TemplateErrors = {};
  const days = checkDays(r, errors, "for focus time");
  const { start, end } = checkTimes(r, errors);
  const timeZone =
    r.timeZone === null || r.timeZone === undefined || r.timeZone === ""
      ? null
      : checkZone(r.timeZone, errors);
  let weeklyMinHours: number | undefined;
  const hours = r.weeklyMinHours;
  if (hours !== undefined && hours !== null && hours !== "") {
    const n = typeof hours === "number" ? hours : Number(String(hours).trim());
    if (!Number.isFinite(n) || n < M.weeklyMinHoursMin || n > M.weeklyMinHours) {
      errors.weeklyMinHours = `Use ${M.weeklyMinHoursMin} to ${M.weeklyMinHours} hours, or leave it empty.`;
    } else weeklyMinHours = n;
  }
  if (Object.keys(errors).length > 0) return fail(errors);
  return {
    ok: true,
    values: {
      days,
      start,
      end,
      timeZone: timeZone || null,
      ...(weeklyMinHours !== undefined ? { weeklyMinHours } : {}),
    },
  };
}

function checkAiUse(raw: unknown): Validation<AiUseValues> {
  const r = isRow(raw) ? raw : {};
  const errors: TemplateErrors = {};
  const given = Array.isArray(r.neverIn) ? r.neverIn : [];
  const neverIn: AiUseNeverIn[] = AI_USE_NEVER_IN.filter((k) => given.includes(k));
  const neverInOther = oneLine(r.neverInOther);
  if (neverInOther.length > M.aiNote) errors.neverInOther = `Keep it to ${M.aiNote} characters.`;
  if (neverIn.length === 0 && !neverInOther) {
    errors.neverIn = "Pick at least one thing that never goes into an AI tool.";
  }
  const review = r.review;
  if (!oneOf(AI_USE_REVIEW, review)) errors.review = "Pick how AI-assisted work is reviewed.";
  const rawTools = (Array.isArray(r.tools) ? r.tools : []).map(oneLine).filter(Boolean);
  if (rawTools.length > M.aiTools) errors.tools = `Name up to ${M.aiTools} tools.`;
  else if (rawTools.some((t) => t.length > M.aiTool)) {
    errors.tools = `Keep each tool's name to ${M.aiTool} characters.`;
  }
  const shareWhere = oneLine(r.shareWhere);
  if (shareWhere.length > M.aiNote) errors.shareWhere = `Keep it to ${M.aiNote} characters.`;
  if (Object.keys(errors).length > 0) return fail(errors);
  return {
    ok: true,
    values: {
      tools: cleanTools(rawTools),
      neverIn,
      ...(neverInOther ? { neverInOther } : {}),
      review: review as AiUseReview,
      customerFacing: r.customerFacing === true,
      ...(shareWhere ? { shareWhere } : {}),
    },
  };
}

/**
 * A template's values checked and cleaned (trimmed, days in order, the
 * zone in its canonical spelling), or the plain-English problems by field
 * ("levels.1.label", "start", "timeZone"…). The forms and
 * tool.working_agreement.apply_template check with this one rule.
 */
export function validateTemplateValues<Id extends CharterTemplateId>(
  id: Id,
  values: unknown
): Validation<TemplateValuesById[Id]> {
  switch (id) {
    case "urgency-ladder":
      return checkLadder(values) as Validation<TemplateValuesById[Id]>;
    case "core-hours":
      return checkCore(values) as Validation<TemplateValuesById[Id]>;
    case "focus-time":
      return checkFocus(values) as Validation<TemplateValuesById[Id]>;
    case "ai-use":
      return checkAiUse(values) as Validation<TemplateValuesById[Id]>;
    default:
      return fail({ template: "Pick one of the four templates." });
  }
}
