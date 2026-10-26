/**
 * One way to read a squad health check, shared by every tool that reads it:
 * the Health Check page and its agent actions, Sprint Comparison's quality,
 * the Health Dashboard's team health and the Sprint cockpit's rating. Pure
 * and server-safe (agent actions import it), so the page, the dashboard and
 * `tool.health_check.*` give one number for the same check.
 *
 * A light is worth 1 for green, ½ for yellow and 0 for red, as the Health
 * Dashboard already counted it (green 2, yellow 1, red 0 out of 2), so a
 * squad that is "a bit worried" about a dimension doesn't score the same
 * as one in trouble.
 *
 * The draft in progress (`HealthCheck.current`) holds a light for every
 * built-in dimension, because the stored type needs one, so a placeholder
 * green sits on every dimension nobody has rated. `rated` lists the keys
 * that really were; a draft saved before that list existed reads yellow and
 * red as rated and green as not (a green was the placeholder). Every reader
 * of the draft goes through `isRated`, never the raw light.
 */

import type {
  HandoffLink,
  HealthCheck,
  HealthCheckEntry,
  HealthCheckSnapshot,
  HealthCustomDimension,
  HealthDimension,
  HealthDimensionScore,
  HealthTrafficLight,
  HealthTrend,
  HealthVotes,
  Sprint,
} from "@/lib/stores/workspace-types";
import { HEALTH_CHECK_DIMENSIONS, HEALTH_CHECK_ID } from "@/lib/stores/workspace-types";
import { isExampleId } from "@/lib/utils/example-id";
import { retroSprintFor } from "@/lib/retro/board";
import { MIN_SAMPLE } from "@/lib/analytics/min-sample";
import { nameKey } from "@/lib/team/names";
import type { VoteRoundResult } from "@/lib/realtime/vote-room/aggregate";
import type { Questionnaire, VoteScale } from "@/lib/realtime/vote-room/protocol";

export { HEALTH_CHECK_ID };

export const LIGHT_VALUE: Readonly<Record<HealthTrafficLight, number>> = {
  green: 1,
  yellow: 0.5,
  red: 0,
};

/** The lights, best first, as the page offers them. */
export const HEALTH_LIGHTS: readonly HealthTrafficLight[] = ["green", "yellow", "red"];

export function isLight(v: unknown): v is HealthTrafficLight {
  return v === "green" || v === "yellow" || v === "red";
}

/** The dimensions that speak to quality: the code and how easily it ships. */
export const QUALITY_DIMENSIONS: readonly HealthDimension[] = [
  "Health of Codebase",
  "Easy to Release",
];

/**
 * What each built-in dimension asks, in our own words: the hint under a
 * vote-room question and under a dimension's row on the page.
 */
export const DIMENSION_MEANINGS: Readonly<Record<HealthDimension, string>> = {
  "Delivering Value": "What we ship matters to the people we build for, and we can tell.",
  "Easy to Release": "Getting our work to users is simple, safe and mostly automatic.",
  Fun: "We enjoy the work and working together.",
  "Health of Codebase": "The code is clean, tested and easy to change.",
  Learning: "We keep learning, from the work and from each other.",
  Mission: "We know why we are here, and it motivates us.",
  Speed: "We get things done quickly, without waiting or getting stuck.",
  Teamwork: "We work well together and help each other out.",
};

/** A note on a dimension: what the team said about it. */
export const HEALTH_NOTE_MAX = 500;
/** A custom dimension's name and description. */
export const DIMENSION_NAME_MAX = 60;
export const DIMENSION_DESCRIPTION_MAX = 200;

/* ── Scores ───────────────────────────────────────────────────────────── */

/**
 * The share of health, 0 to 1, over `dims` (all eight by default): the mean
 * light value of the dimensions that were scored. Null when none of them was.
 */
export function healthShare(
  scores: Partial<Record<HealthDimension, HealthDimensionScore>> | undefined,
  dims: readonly HealthDimension[] = HEALTH_CHECK_DIMENSIONS
): number | null {
  let sum = 0;
  let n = 0;
  for (const d of dims) {
    const light = scores?.[d]?.light;
    if (!isLight(light)) continue;
    sum += LIGHT_VALUE[light];
    n++;
  }
  return n === 0 ? null : sum / n;
}

type Lights = Pick<HealthCheckEntry, "scores" | "customScores">;

/** A dimension's stored score (built-in by name, custom by id), if any. */
export function scoreOf(s: Lights | undefined, key: string): HealthDimensionScore | undefined {
  if (!s) return undefined;
  const builtIn = (HEALTH_CHECK_DIMENSIONS as readonly string[]).includes(key);
  const map = builtIn ? s.scores : s.customScores;
  const score = map && typeof map === "object" ? (map as Record<string, unknown>)[key] : undefined;
  return score && typeof score === "object" ? (score as HealthDimensionScore) : undefined;
}

/** A dimension's stored light, or null (missing or malformed). */
export function storedLight(s: Lights | undefined, key: string): HealthTrafficLight | null {
  const light = scoreOf(s, key)?.light;
  return isLight(light) ? light : null;
}

/** Every key a check holds a light for: the built-ins it has, then its custom ones. */
function lightKeys(e: Lights): string[] {
  const keys: string[] = HEALTH_CHECK_DIMENSIONS.filter((d) => storedLight(e, d) !== null);
  for (const key of Object.keys(e.customScores ?? {})) {
    if (storedLight(e, key) !== null) keys.push(key);
  }
  return keys;
}

/**
 * The share of health, 0 to 1, of a check: built-in and custom dimensions
 * alike, yellow counting half. `keys` limits it to those dimensions (a
 * draft passes the ones it rated: `ratedKeys`); by default every light the
 * check holds counts, which is right for a saved check, whose lights were
 * all rated. Null when no light counts.
 */
export function entryShare(e: Lights | undefined, keys?: readonly string[]): number | null {
  if (!e) return null;
  let sum = 0;
  let n = 0;
  for (const key of keys ?? lightKeys(e)) {
    const light = storedLight(e, key);
    if (!light) continue;
    sum += LIGHT_VALUE[light];
    n++;
  }
  return n === 0 ? null : sum / n;
}

/** A share as a whole percentage, or null. */
export function sharePct(share: number | null): number | null {
  return share === null ? null : Math.round(share * 100);
}

/* ── Trends ───────────────────────────────────────────────────────────── */

const RANK: Readonly<Record<HealthTrafficLight, number>> = { red: 0, yellow: 1, green: 2 };

/**
 * A dimension's trend: its light against the previous saved check's. "same"
 * when either is missing (a first check, a dimension added since), so a
 * trend is never guessed.
 */
export function trendFor(
  prev: HealthTrafficLight | null | undefined,
  cur: HealthTrafficLight | null | undefined
): HealthTrend {
  if (!prev || !cur || RANK[prev] === RANK[cur]) return "same";
  return RANK[cur] > RANK[prev] ? "up" : "down";
}

/* ── Votes ────────────────────────────────────────────────────────────── */

const count = (n: unknown) => (typeof n === "number" && Number.isFinite(n) && n > 0 ? n : 0);

/** How many voted on a dimension. */
export function votesTotal(v: HealthVotes | undefined | null): number {
  return v ? count(v.green) + count(v.yellow) + count(v.red) : 0;
}

/** The mean light value of the votes (green 1, yellow ½, red 0), or null with none. */
export function votesMean(v: HealthVotes | undefined | null): number | null {
  const n = votesTotal(v);
  if (!v || n === 0) return null;
  return (count(v.green) + count(v.yellow) * 0.5) / n;
}

/**
 * The light a dimension's votes give it: green from a mean of ¾, red below
 * ¼, yellow between. Null below `minN` votes, when the light would say what
 * one or two people think.
 */
export function lightFromVotes(
  v: HealthVotes | undefined | null,
  minN: number = MIN_SAMPLE.anonymous
): HealthTrafficLight | null {
  if (votesTotal(v) < minN) return null;
  const mean = votesMean(v);
  if (mean === null) return null;
  if (mean >= 0.75) return "green";
  if (mean < 0.25) return "red";
  return "yellow";
}

/** Votes that split the team: some green and some red, worth talking about whatever the light. */
export function isSplit(v: HealthVotes | undefined | null): boolean {
  return Boolean(v && count(v.green) > 0 && count(v.red) > 0);
}

/* ── Dimensions ───────────────────────────────────────────────────────── */

export interface HealthDimensionInfo {
  /** The key its lights use: the built-in name, or the custom dimension's id. */
  key: string;
  name: string;
  custom: boolean;
  description?: string;
  archived?: boolean;
}

function customDimensions(doc: HealthCheck | undefined | null): HealthCustomDimension[] {
  return (Array.isArray(doc?.customDimensions) ? doc.customDimensions : []).filter(
    (d) => d && typeof d.id === "string" && typeof d.name === "string"
  );
}

const BUILT_INS: HealthDimensionInfo[] = HEALTH_CHECK_DIMENSIONS.map((d) => ({
  key: d,
  name: d,
  custom: false,
  description: DIMENSION_MEANINGS[d],
}));

function customInfo(d: HealthCustomDimension): HealthDimensionInfo {
  return {
    key: d.id,
    name: d.name,
    custom: true,
    ...(d.description ? { description: d.description } : {}),
    ...(d.archived ? { archived: true } : {}),
  };
}

/** The dimensions a new check rates: the eight built-ins, then the team's own, not archived. */
export function activeDimensions(doc: HealthCheck | undefined | null): HealthDimensionInfo[] {
  return [
    ...BUILT_INS,
    ...customDimensions(doc)
      .filter((d) => !d.archived)
      .map(customInfo),
  ];
}

/** Every dimension, archived ones included: saved checks keep their lights. */
export function allDimensions(doc: HealthCheck | undefined | null): HealthDimensionInfo[] {
  return [...BUILT_INS, ...customDimensions(doc).map(customInfo)];
}

/**
 * The dimension an agent or a person names: a built-in by name, a custom
 * one by id or by name (trimmed, any case). Archived ones only when asked.
 */
export function findDimension(
  doc: HealthCheck | undefined | null,
  keyOrName: string,
  { includeArchived = false }: { includeArchived?: boolean } = {}
): HealthDimensionInfo | undefined {
  const dims = includeArchived ? allDimensions(doc) : activeDimensions(doc);
  return (
    dims.find((d) => d.key === keyOrName) ??
    dims.find((d) => nameKey(d.name) === nameKey(keyOrName))
  );
}

/**
 * Why a custom dimension's name can't be used, or null: blank, too long, or
 * already a dimension (built-in or the team's, archived ones included, so a
 * name always means one dimension in the history). `exceptId` is the one
 * being renamed.
 */
export function dimensionNameProblem(
  doc: HealthCheck | undefined | null,
  name: string,
  exceptId?: string
): string | null {
  const clean = name.trim();
  if (!clean) return "Name the dimension.";
  if (clean.length > DIMENSION_NAME_MAX) return `Keep it to ${DIMENSION_NAME_MAX} characters.`;
  const clash = allDimensions(doc).find(
    (d) => d.key !== exceptId && nameKey(d.name) === nameKey(clean)
  );
  if (!clash) return null;
  return clash.archived
    ? `“${clash.name}” is an archived dimension. Restore it instead.`
    : `“${clash.name}” is already a dimension.`;
}

/* ── The draft ────────────────────────────────────────────────────────── */

/** A placeholder light for a dimension nobody has rated (see the file comment). */
const PLACEHOLDER: HealthDimensionScore = { light: "green", trend: "same" };

export function emptySnapshot(): HealthCheckSnapshot {
  return {
    sprintName: "",
    scores: Object.fromEntries(
      HEALTH_CHECK_DIMENSIONS.map((d) => [d, { ...PLACEHOLDER }])
    ) as Record<HealthDimension, HealthDimensionScore>,
    rated: [],
  };
}

export function emptyHealthCheck(): HealthCheck {
  return { id: HEALTH_CHECK_ID, current: emptySnapshot(), history: [] };
}

/** The stored doc with a usable draft and history, whatever an older build or an agent left. */
export function normalizeHealthCheck(doc: HealthCheck | undefined | null): HealthCheck {
  if (!doc || typeof doc !== "object") return emptyHealthCheck();
  const current = doc.current && typeof doc.current === "object" ? doc.current : emptySnapshot();
  return {
    ...doc,
    id: doc.id || HEALTH_CHECK_ID,
    current: {
      ...current,
      sprintName: typeof current.sprintName === "string" ? current.sprintName : "",
      scores: { ...emptySnapshot().scores, ...(current.scores ?? {}) },
    },
    history: Array.isArray(doc.history)
      ? doc.history.filter((e) => e && typeof e === "object" && typeof e.id === "string")
      : [],
  };
}

/** Whether the draft's dimension `key` was really rated (see the file comment). */
export function isRated(
  s: Pick<HealthCheckSnapshot, "scores" | "customScores" | "rated"> | undefined,
  key: string
): boolean {
  if (!s) return false;
  const light = storedLight(s, key);
  if (!light) return false;
  if (Array.isArray(s.rated)) return s.rated.includes(key);
  return light !== "green";
}

/** The draft's light for `key`, or null while it isn't rated. */
export function draftLight(
  s: Pick<HealthCheckSnapshot, "scores" | "customScores" | "rated"> | undefined,
  key: string
): HealthTrafficLight | null {
  return isRated(s, key) ? storedLight(s, key) : null;
}

/** The active dimensions the draft rated, in page order. */
export function ratedKeys(doc: HealthCheck | undefined | null): string[] {
  const s = doc?.current;
  return activeDimensions(doc)
    .filter((d) => isRated(s, d.key))
    .map((d) => d.key);
}

/** The active dimensions still to rate before the draft can be saved. */
export function unratedDimensions(doc: HealthCheck | undefined | null): HealthDimensionInfo[] {
  const s = doc?.current;
  return activeDimensions(doc).filter((d) => !isRated(s, d.key));
}

/** The draft's share of health over what it rated so far (null until one is rated). */
export function draftShare(doc: HealthCheck | undefined | null): number | null {
  return entryShare(doc?.current, ratedKeys(doc));
}

/** A copy of the draft with one dimension's score changed (`patch`), keeping the rest. */
function withScore(
  s: HealthCheckSnapshot,
  key: string,
  patch: Partial<HealthDimensionScore>,
  rate?: boolean
): HealthCheckSnapshot {
  const builtIn = (HEALTH_CHECK_DIMENSIONS as readonly string[]).includes(key);
  const prev = scoreOf(s, key) ?? PLACEHOLDER;
  const next: HealthDimensionScore = { ...prev, ...patch };
  // A patch of `undefined` (a cleared note) removes the field.
  for (const k of Object.keys(next) as (keyof HealthDimensionScore)[]) {
    if (next[k] === undefined) delete next[k];
  }
  // Older drafts have no `rated`: carry over what they read as rated.
  const rated = Array.isArray(s.rated) ? s.rated : activeKeysOf(s).filter((k) => isRated(s, k));
  const nextRated =
    rate === undefined
      ? rated
      : rate
        ? rated.includes(key)
          ? rated
          : [...rated, key]
        : rated.filter((k) => k !== key);
  return builtIn
    ? { ...s, scores: { ...s.scores, [key]: next }, rated: nextRated }
    : { ...s, customScores: { ...(s.customScores ?? {}), [key]: next }, rated: nextRated };
}

/** Keys a legacy draft could hold: the built-ins and whatever custom scores it has. */
function activeKeysOf(s: HealthCheckSnapshot): string[] {
  return [...HEALTH_CHECK_DIMENSIONS, ...Object.keys(s.customScores ?? {})];
}

/** The draft with `key` rated `light` (a click, an agent, or the votes' light). */
export function withRating(doc: HealthCheck, key: string, light: HealthTrafficLight): HealthCheck {
  return { ...doc, current: withScore(doc.current, key, { light }, true) };
}

/** The draft with `key` back to unrated (its note and votes stay). */
export function withoutRating(doc: HealthCheck, key: string): HealthCheck {
  return { ...doc, current: withScore(doc.current, key, {}, false) };
}

/** The draft with a dimension's note (trimmed, up to HEALTH_NOTE_MAX; blank removes it). */
export function withNote(doc: HealthCheck, key: string, note: string): HealthCheck {
  const clean = note.trim().slice(0, HEALTH_NOTE_MAX);
  if (clean === (scoreOf(doc.current, key)?.note ?? "")) return doc;
  return { ...doc, current: withScore(doc.current, key, { note: clean || undefined }) };
}

/**
 * The draft with a dimension's votes and the light they give: rated when
 * there are at least `minN` votes; below that the votes are kept but the
 * dimension stays as it was (a light from one or two votes isn't the team's).
 */
export function withVotes(
  doc: HealthCheck,
  key: string,
  votes: HealthVotes,
  minN: number = MIN_SAMPLE.anonymous
): HealthCheck {
  const clean: HealthVotes = {
    green: Math.floor(count(votes.green)),
    yellow: Math.floor(count(votes.yellow)),
    red: Math.floor(count(votes.red)),
  };
  const light = lightFromVotes(clean, minN);
  return {
    ...doc,
    current: light
      ? withScore(doc.current, key, { votes: clean, light }, true)
      : withScore(doc.current, key, { votes: clean }),
  };
}

/** The draft for `sprint` (its id and name), or back to no sprint. */
export function withSprint(
  doc: HealthCheck,
  sprint: Pick<Sprint, "id" | "name"> | null
): HealthCheck {
  const current = { ...doc.current };
  if (sprint) {
    current.sprintId = sprint.id;
    current.sprintName = sprint.name;
  } else {
    delete current.sprintId;
  }
  return { ...doc, current };
}

/** The draft with a typed name (teams without shared sprints name the check). */
export function withSprintName(doc: HealthCheck, name: string): HealthCheck {
  return { ...doc, current: { ...doc.current, sprintName: name.slice(0, 200) } };
}

const DAY_RE = /^\d{4}-\d{2}-\d{2}$/;

/** A YYYY-MM-DD day that exists, or null. */
export function validDay(day: string | undefined | null): string | null {
  if (typeof day !== "string" || !DAY_RE.test(day)) return null;
  const [y, m, d] = day.split("-").map(Number);
  const t = new Date(Date.UTC(y, m - 1, d));
  return t.getUTCFullYear() === y && t.getUTCMonth() === m - 1 && t.getUTCDate() === d ? day : null;
}

/** Why `day` can't date a check, or null: not a real day, or after `today`. */
export function checkDateProblem(day: string | undefined | null, today: string): string | null {
  if (!validDay(day)) return "Pick a day.";
  if ((day as string) > today) return "A check can't be dated in the future.";
  return null;
}

/** The draft dated `day` (backdated); null goes back to "the day it is saved". */
export function withDate(doc: HealthCheck, day: string | null): HealthCheck {
  const current = { ...doc.current };
  if (day) current.date = day;
  else delete current.date;
  return { ...doc, current };
}

/* ── Saved checks ─────────────────────────────────────────────────────── */

export interface CheckOptions {
  /** Count example checks too (the page's example preview does). */
  includeExamples?: boolean;
}

/**
 * The saved checks, oldest first by date (stable: of two on one day, the one
 * saved later is last). The history, never the draft; examples left out
 * unless asked.
 */
export function checksByDate(
  doc: HealthCheck | undefined | null,
  { includeExamples = false }: CheckOptions = {}
): HealthCheckEntry[] {
  const history = Array.isArray(doc?.history) ? doc.history : [];
  return history
    .filter((e) => e && typeof e === "object" && (includeExamples || !isExampleId(e.id)))
    .map((e, i) => ({ e, i }))
    .sort((a, b) => {
      const da = a.e.date ?? "";
      const db = b.e.date ?? "";
      return da === db ? a.i - b.i : da < db ? -1 : 1;
    })
    .map(({ e }) => e);
}

/** The newest saved check (by its date, then its place in the history), or null. */
export function latestSavedCheck(
  doc: HealthCheck | undefined | null,
  opts: CheckOptions = {}
): HealthCheckEntry | null {
  const checks = checksByDate(doc, opts);
  return checks[checks.length - 1] ?? null;
}

/**
 * The saved check just before `before`: the one ahead of it by date when it
 * is saved (`id`), else the newest dated on or before `date` (the draft).
 */
export function previousSavedCheck(
  doc: HealthCheck | undefined | null,
  before: { date: string; id?: string },
  opts: CheckOptions = {}
): HealthCheckEntry | null {
  const checks = checksByDate(doc, opts);
  if (before.id) {
    const at = checks.findIndex((e) => e.id === before.id);
    if (at >= 0) return checks[at - 1] ?? null;
  }
  let best: HealthCheckEntry | null = null;
  for (const e of checks) {
    if (e.id !== before.id && (e.date ?? "") <= before.date) best = e;
  }
  return best;
}

/** The trend of every dimension of a check against the check before it (derived, never typed). */
export function trendsFor(
  e: Lights,
  prev: Lights | null | undefined,
  keys: readonly string[]
): Record<string, HealthTrend> {
  return Object.fromEntries(
    keys.map((k) => [k, trendFor(storedLight(prev ?? undefined, k), storedLight(e, k))])
  );
}

/** The red dimensions of a saved check, in page order (archived custom ones included). */
export function redDimensions(
  e: Lights | undefined | null,
  doc: HealthCheck | undefined | null
): HealthDimensionInfo[] {
  if (!e) return [];
  const known = allDimensions(doc);
  const reds = known.filter((d) => storedLight(e, d.key) === "red");
  // A custom light whose dimension was removed from the doc still counts.
  for (const key of Object.keys(e.customScores ?? {})) {
    if (!known.some((d) => d.key === key) && storedLight(e, key) === "red") {
      reds.push({ key, name: key, custom: true });
    }
  }
  return reds;
}

/** A saved check's name for lists: its sprint, else the day it was taken. */
export function checkLabel(e: Pick<HealthCheckEntry, "sprintName" | "date">): string {
  const name = (e.sprintName ?? "").trim();
  return name || `Check of ${(e.date ?? "").slice(0, 10) || "an unknown day"}`;
}

export type SaveCheckResult =
  | { ok: true; doc: HealthCheck; entry: HealthCheckEntry }
  | { ok: false; unrated: HealthDimensionInfo[]; dateProblem?: string };

/**
 * Save the draft as a check: refused while an active dimension is unrated
 * (a placeholder green must never be saved as the team's) or its date is
 * in the future. Trends are stamped from the previous saved check; the
 * draft starts again, keeping nothing but its sprint-less blank.
 */
export function saveDraft(
  doc: HealthCheck,
  { id, today, sprints = [] }: { id: string; today: string; sprints?: readonly Sprint[] }
): SaveCheckResult {
  const unrated = unratedDimensions(doc);
  const date = doc.current.date ?? today;
  const dateProblem = checkDateProblem(date, today) ?? undefined;
  if (unrated.length > 0 || dateProblem) {
    return { ok: false, unrated, ...(dateProblem ? { dateProblem } : {}) };
  }
  const s = doc.current;
  const prev = previousSavedCheck(doc, { date });
  const stamp = (key: string): HealthDimensionScore => {
    const score = scoreOf(s, key) ?? PLACEHOLDER;
    const light = storedLight(s, key) ?? "green";
    const out: HealthDimensionScore = {
      ...score,
      light,
      trend: trendFor(storedLight(prev ?? undefined, key), light),
    };
    return out;
  };
  const custom = activeDimensions(doc).filter((d) => d.custom);
  const sprint = s.sprintId ? sprints.find((x) => x.id === s.sprintId) : undefined;
  const entry: HealthCheckEntry = {
    id,
    sprintName: (sprint?.name ?? s.sprintName ?? "").trim(),
    date,
    scores: Object.fromEntries(HEALTH_CHECK_DIMENSIONS.map((d) => [d, stamp(d)])) as Record<
      HealthDimension,
      HealthDimensionScore
    >,
    ...(s.sprintId ? { sprintId: s.sprintId } : {}),
    ...(custom.length > 0
      ? { customScores: Object.fromEntries(custom.map((d) => [d.key, stamp(d.key)])) }
      : {}),
    ...(s.source ? { source: s.source } : {}),
    ...(typeof s.responses === "number" ? { responses: s.responses } : {}),
  };
  return {
    ok: true,
    entry,
    doc: { ...doc, history: [...doc.history, entry], current: emptySnapshot() },
  };
}

/**
 * A saved check with one dimension's hand-off links changed (a red sent to
 * the retro). Null when the check or its light is gone.
 */
export function withEntryLinks(
  doc: HealthCheck,
  entryId: string,
  key: string,
  update: (links: readonly HandoffLink[] | undefined) => HandoffLink[]
): HealthCheck | null {
  const at = doc.history.findIndex((e) => e.id === entryId);
  if (at < 0) return null;
  const entry = doc.history[at];
  const score = scoreOf(entry, key);
  if (!score) return null;
  const next: HealthDimensionScore = { ...score, sentTo: update(score.sentTo) };
  if (next.sentTo?.length === 0) delete next.sentTo;
  const builtIn = (HEALTH_CHECK_DIMENSIONS as readonly string[]).includes(key);
  const nextEntry: HealthCheckEntry = builtIn
    ? { ...entry, scores: { ...entry.scores, [key]: next } }
    : { ...entry, customScores: { ...(entry.customScores ?? {}), [key]: next } };
  return { ...doc, history: doc.history.map((e, i) => (i === at ? nextEntry : e)) };
}

/** The retro topic a red dimension becomes: what, for which sprint, and the team's note. */
export function redTopicTitle(
  e: Pick<HealthCheckEntry, "sprintName" | "date">,
  dim: Pick<HealthDimensionInfo, "name">,
  note?: string
): string {
  const sprint = (e.sprintName ?? "").trim();
  const said = (note ?? "").trim();
  return `Health check: ${dim.name} is red${sprint ? ` (${sprint})` : ""}${said ? ` — ${said}` : ""}`;
}

/** The doc without saved check `id` (null when there is no such check). */
export function withoutCheck(doc: HealthCheck, id: string): HealthCheck | null {
  if (!doc.history.some((e) => e.id === id)) return null;
  return { ...doc, history: doc.history.filter((e) => e.id !== id) };
}

/* ── Custom dimensions ────────────────────────────────────────────────── */

export function withCustomDimension(doc: HealthCheck, dim: HealthCustomDimension): HealthCheck {
  return { ...doc, customDimensions: [...customDimensions(doc), dim] };
}

/** Rename (or re-describe) a custom dimension; its id, and so its saved lights, stay. */
export function withDimensionPatch(
  doc: HealthCheck,
  id: string,
  patch: Partial<Pick<HealthCustomDimension, "name" | "description" | "archived">>
): HealthCheck | null {
  const dims = customDimensions(doc);
  if (!dims.some((d) => d.id === id)) return null;
  return {
    ...doc,
    customDimensions: dims.map((d) => {
      if (d.id !== id) return d;
      const next: HealthCustomDimension = { ...d, ...patch };
      if (!next.description) delete next.description;
      if (!next.archived) delete next.archived;
      return next;
    }),
  };
}

/* ── Matching a check to a sprint ─────────────────────────────────────── */

/**
 * The saved check for `sprint`: one saved for it (its `sprintId`); else,
 * among checks that name no sprint (older ones), one named like it (case
 * and spaces aside), else one taken on a day whose retro looks back on it
 * (the retro window: the sprint's first day to a week after its last). A
 * check saved for another sprint never matches by name or date. The newest
 * if several match.
 */
export function healthCheckFor(
  doc: HealthCheck | undefined | null,
  sprint: Pick<Sprint, "id" | "name">,
  sprints: readonly Sprint[]
): HealthCheckEntry | undefined {
  const checks = checksByDate(doc);
  const newest = (xs: HealthCheckEntry[]) => xs[xs.length - 1];
  const tagged = checks.filter((e) => e.sprintId === sprint.id);
  if (tagged.length > 0) return newest(tagged);
  const untagged = checks.filter((e) => !e.sprintId);
  const key = nameKey(sprint.name);
  const named = key ? untagged.filter((e) => nameKey(e.sprintName) === key) : [];
  if (named.length > 0) return newest(named);
  return newest(
    untagged.filter((e) => e.date && retroSprintFor(e.date.slice(0, 10), sprints)?.id === sprint.id)
  );
}

/* ── The vote room ────────────────────────────────────────────────────── */

/** Red 0, yellow 1, green 2: the order a person reads the lights in, worst first. */
export const HEALTH_VOTE_SCALE: VoteScale = {
  id: "health-light",
  points: [
    { value: 0, label: "Red" },
    { value: 1, label: "Yellow" },
    { value: 2, label: "Green" },
  ],
};

const VALUE_LIGHT: Readonly<Record<number, HealthTrafficLight>> = {
  0: "red",
  1: "yellow",
  2: "green",
};

const QUESTION_ID_RE = /^[A-Za-z0-9:_-]{1,64}$/;

/** A dimension's question id: the vote room carries short ids only, so built-in names become slugs. */
export function dimensionQuestionId(d: HealthDimensionInfo, index: number): string {
  if (!d.custom) return d.key.toLowerCase().replace(/[^a-z0-9]+/g, "-");
  return QUESTION_ID_RE.test(d.key) ? d.key : `dimension-${index}`;
}

/**
 * The vote-room questionnaire: one optional question per active dimension
 * (people may skip one they can't judge), on red / yellow / green, with
 * the dimension's meaning as the hint. Null with nothing to ask.
 */
export function healthQuestionnaire(doc: HealthCheck | undefined | null): Questionnaire | null {
  const dims = activeDimensions(doc);
  if (dims.length === 0) return null;
  return {
    id: "health-check",
    title: "Squad health check",
    scale: HEALTH_VOTE_SCALE,
    questions: dims.map((d, i) => ({
      id: dimensionQuestionId(d, i),
      text: d.name,
      ...(d.description ? { hint: d.description } : {}),
      optional: true,
    })),
  };
}

/** A question's distribution as votes (by each point's value, whatever order the scale lists). */
export function votesFromDistribution(
  distribution: readonly number[] | null,
  scale: VoteScale
): HealthVotes | null {
  if (!distribution) return null;
  const votes: HealthVotes = { green: 0, yellow: 0, red: 0 };
  scale.points.forEach((p, i) => {
    const light = VALUE_LIGHT[p.value];
    if (light) votes[light] += count(distribution[i]);
  });
  return votes;
}

/**
 * A saved vote round on the draft: each dimension with a distribution gets
 * its votes and the light they give, and is rated; a dimension withheld
 * (fewer than minN answers) is left exactly as it was, never read as zero
 * votes. Only totals arrive here, and only totals are kept. Returns the new
 * doc and the keys it changed, for Undo.
 */
export function applyHealthRound(
  doc: HealthCheck,
  result: VoteRoundResult
): { doc: HealthCheck; keys: string[] } {
  const dims = activeDimensions(doc);
  let next = doc;
  const keys: string[] = [];
  result.questions.forEach((q) => {
    const votes = votesFromDistribution(q.distribution, result.scale);
    if (!votes) return;
    const dim =
      dims.find((d, i) => dimensionQuestionId(d, i) === q.id) ??
      dims.find((d) => nameKey(d.name) === nameKey(q.text));
    if (!dim) return;
    const before = next;
    next = withVotes(next, dim.key, votes, result.minN);
    if (next !== before) keys.push(dim.key);
  });
  if (keys.length === 0) return { doc, keys };
  return {
    doc: {
      ...next,
      current: {
        ...next.current,
        source: result.source === "live" ? "room" : "facilitator",
        responses: result.ballots,
      },
    },
    keys,
  };
}

/**
 * Undo a saved round: the round's dimensions get back their scores and
 * rated state from `before`, and the draft its source; anything else
 * changed since stays.
 */
export function revertHealthRound(
  doc: HealthCheck,
  before: HealthCheckSnapshot,
  keys: readonly string[]
): HealthCheck {
  let current: HealthCheckSnapshot = { ...doc.current };
  for (const key of keys) {
    const prev = scoreOf(before, key);
    const builtIn = (HEALTH_CHECK_DIMENSIONS as readonly string[]).includes(key);
    if (builtIn) {
      current = { ...current, scores: { ...current.scores, [key]: prev ?? { ...PLACEHOLDER } } };
    } else {
      const custom = { ...(current.customScores ?? {}) };
      if (prev) custom[key] = prev;
      else delete custom[key];
      current = { ...current, customScores: custom };
    }
    const wasRated = isRated(before, key);
    const rated = Array.isArray(current.rated) ? current.rated : [];
    current.rated = wasRated
      ? rated.includes(key)
        ? rated
        : [...rated, key]
      : rated.filter((k) => k !== key);
  }
  if (before.source) current.source = before.source;
  else delete current.source;
  if (typeof before.responses === "number") current.responses = before.responses;
  else delete current.responses;
  return { ...doc, current };
}
