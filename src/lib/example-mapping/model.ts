/**
 * Example Mapping: the rules every reader shares (the page, its next step,
 * Amr's verbs in the browser and on the server). An example map
 * (workspace.exampleMaps) holds one story's rules, a concrete example or
 * two under each, and the questions nobody can answer yet.
 *
 * Pure: no store, no browser globals, no "use client" module. Every write
 * goes through the caps the workspace CRUD validates against
 * (TOOL_TEXT_MAX, TOOL_LIST_MAX), so a map the page saved is always one an
 * agent can update, and the other way round.
 */

import {
  ENTITY_ROW_MAX_BYTES,
  EXAMPLE_MAP_VERDICTS,
  EXAMPLE_QUESTION_STATUSES,
  HANDOFF_ROUTE_IDS,
  TOOL_LIST_MAX,
  TOOL_TEXT_MAX,
  type ExampleMap,
  type ExampleMapExample,
  type ExampleMapQuestion,
  type ExampleMapRule,
  type ExampleMapVerdict,
  type ExampleQuestionStatus,
  type HandoffLink,
  type Story,
  type StoryGwt,
} from "@/lib/stores/workspace-types";
import {
  GWT_PART_MAX,
  STORY_CRITERIA_MAX,
  STORY_GWT_MAX,
  gwtSentence,
  newGwtId,
  withStoryGwt,
} from "@/lib/stories/fields";
import type { Validation } from "@/lib/utils/form";
import { jsonBytes } from "@/lib/utils/json-bytes";

/** Every map id starts with this, as the workspace CRUD makes them. */
export const EXAMPLE_MAP_ID_PREFIX = "exmap_";

/** The tool id a sent item names in its sourceRef. */
export const EXAMPLE_MAPPING_TOOL = "example-mapping";

/** The page's own address, which the docked timer and next steps point at. */
export const EXAMPLE_MAPPING_PATH = "/example-mapping";

export const RULES_MAX = TOOL_LIST_MAX.mapRules;
export const EXAMPLES_MAX = TOOL_LIST_MAX.mapExamples;
export const QUESTIONS_MAX = TOOL_LIST_MAX.mapQuestions;
/** Examples under one rule, at most. More than a handful hides a second rule. */
export const EXAMPLES_PER_RULE_MAX = 10;
/** A card's text: a rule, an example or a question. */
export const CARD_TEXT_MAX = TOOL_TEXT_MAX.short;
/** A question's answer. */
export const ANSWER_MAX = TOOL_TEXT_MAX.text;
/** Given, When and Then, each. */
export const GWT_MAX = GWT_PART_MAX;

export const TIMEBOX_DEFAULT = 25;
export const TIMEBOX_MIN = 5;
export const TIMEBOX_MAX = 60;

/** The longest a split story's title can be (a backlog story's cap). */
export const SPLIT_TITLE_MAX = 200;
/** How much of the story a split title keeps before the rule (as Backlog Health's splits). */
const SPLIT_STORY_PART = 150;

export const VERDICT_LABEL: Record<ExampleMapVerdict, string> = {
  ready: "Ready to build",
  split: "Split by rule",
  "not-yet": "Not yet",
};

export const QUESTION_STATUS_LABEL: Record<ExampleQuestionStatus, string> = {
  open: "Open",
  answered: "Answered",
  dropped: "Dropped",
};

/* ── Text ────────────────────────────────────────────────────────────── */

const cut = (t: string, max: number) => (t.length > max ? `${t.slice(0, max - 1).trimEnd()}…` : t);

/** One line, trimmed and capped (an ellipsis marks a cut). */
export function cleanLine(value: unknown, max: number): string {
  if (typeof value !== "string") return "";
  return cut(value.replace(/\s+/g, " ").trim(), max);
}

/** Text that may hold line breaks, trimmed and capped. */
export function cleanText(value: unknown, max: number): string {
  if (typeof value !== "string") return "";
  return cut(value.replace(/\r\n?/g, "\n").trim(), max);
}

/** A short form of a card's text for a label or an announcement. */
export function shortText(text: string, max = 60): string {
  return cleanLine(text, max);
}

/** Text compared as the same rule or question: case, spacing, list markers and a closing stop aside. */
export function sameKey(text: string): string {
  return text
    .replace(/^\s*(?:[-*•]|\d+[.)])\s+/, "")
    .replace(/\s+/g, " ")
    .trim()
    .replace(/[.!?]+$/, "")
    .toLowerCase();
}

/* ── Reading ─────────────────────────────────────────────────────────── */

const isRouteId = (v: unknown): v is HandoffLink["route"] =>
  typeof v === "string" && (HANDOFF_ROUTE_IDS as readonly string[]).includes(v);

const isVerdict = (v: unknown): v is ExampleMapVerdict =>
  typeof v === "string" && (EXAMPLE_MAP_VERDICTS as readonly string[]).includes(v);

const isStatus = (v: unknown): v is ExampleQuestionStatus =>
  typeof v === "string" && (EXAMPLE_QUESTION_STATUSES as readonly string[]).includes(v);

const isId = (v: unknown): v is string => typeof v === "string" && v.length > 0 && v.length <= 64;

/** Stored hand-off links rebuilt from known fields, one per route; undefined for none. */
export function readLinks(raw: unknown): HandoffLink[] | undefined {
  if (!Array.isArray(raw)) return undefined;
  const out: HandoffLink[] = [];
  for (const l of raw) {
    const o = l as Record<string, unknown> | null;
    if (!o || typeof o !== "object") continue;
    if (!isRouteId(o.route) || typeof o.targetId !== "string" || !o.targetId) continue;
    if (typeof o.at !== "string") continue;
    const link = { route: o.route, targetId: o.targetId, at: o.at };
    const at = out.findIndex((x) => x.route === link.route);
    if (at >= 0) out[at] = link;
    else out.push(link);
  }
  return out.length > 0 ? out : undefined;
}

/** The three parts of an example, all set or none (undefined). */
function readGwt(o: Record<string, unknown>): Pick<StoryGwt, "given" | "when" | "then"> | null {
  const given = cleanText(o.given, GWT_MAX);
  const when = cleanText(o.when, GWT_MAX);
  const then = cleanText(o.then, GWT_MAX);
  return given && when && then ? { given, when, then } : null;
}

/**
 * A stored map made safe to read: every field rebuilt from what it should
 * be, text capped, lists cut to their caps, an example kept only under a
 * rule the map has (however many it has: the per-rule cap is for adding
 * one), Given/When/Then
 * all three or none, a question's rule dropped when the rule is gone, and
 * links rebuilt. A synced row can hold anything; this keeps the page from
 * drawing what the CRUD would refuse, or crashing on it. Null for
 * something that isn't a map at all.
 */
export function readMap(raw: unknown): ExampleMap | null {
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) return null;
  const r = raw as Record<string, unknown>;
  if (typeof r.id !== "string" || !r.id) return null;

  const rules: ExampleMapRule[] = [];
  const ruleIds = new Set<string>();
  for (const x of Array.isArray(r.rules) ? r.rules : []) {
    if (rules.length >= RULES_MAX) break;
    const o = x as Record<string, unknown> | null;
    if (!o || typeof o !== "object" || !isId(o.id) || ruleIds.has(o.id)) continue;
    const text = cleanLine(o.text, CARD_TEXT_MAX);
    if (!text) continue;
    const rule: ExampleMapRule = { id: o.id, text };
    const sentTo = readLinks(o.sentTo);
    if (sentTo) rule.sentTo = sentTo;
    rules.push(rule);
    ruleIds.add(o.id);
  }

  // Every valid example is kept up to the map's cap, however many its rule
  // has: the CRUD caps only the map's total, and every write starts from
  // what this returns, so dropping one here would delete it for good on the
  // next save. EXAMPLES_PER_RULE_MAX holds for adding one (exampleRoomProblem).
  const examples: ExampleMapExample[] = [];
  const exampleIds = new Set<string>();
  for (const x of Array.isArray(r.examples) ? r.examples : []) {
    if (examples.length >= EXAMPLES_MAX) break;
    const o = x as Record<string, unknown> | null;
    if (!o || typeof o !== "object" || !isId(o.id) || exampleIds.has(o.id)) continue;
    if (!isId(o.ruleId) || !ruleIds.has(o.ruleId)) continue;
    const gwt = readGwt(o);
    const text =
      cleanLine(o.text, CARD_TEXT_MAX) || (gwt ? cleanLine(gwtSentence(gwt), CARD_TEXT_MAX) : "");
    if (!text) continue;
    examples.push({ id: o.id, ruleId: o.ruleId, text, ...(gwt ?? {}) });
    exampleIds.add(o.id);
  }

  const questions: ExampleMapQuestion[] = [];
  const questionIds = new Set<string>();
  for (const x of Array.isArray(r.questions) ? r.questions : []) {
    if (questions.length >= QUESTIONS_MAX) break;
    const o = x as Record<string, unknown> | null;
    if (!o || typeof o !== "object" || !isId(o.id) || questionIds.has(o.id)) continue;
    const text = cleanLine(o.text, CARD_TEXT_MAX);
    if (!text) continue;
    const q: ExampleMapQuestion = {
      id: o.id,
      text,
      status: isStatus(o.status) ? o.status : "open",
    };
    if (isId(o.ruleId) && ruleIds.has(o.ruleId)) q.ruleId = o.ruleId;
    const owner = cleanLine(o.owner, CARD_TEXT_MAX);
    if (owner) q.owner = owner;
    const answer = cleanText(o.answer, ANSWER_MAX);
    if (answer) q.answer = answer;
    questions.push(q);
    questionIds.add(o.id);
  }

  const updatedAt = typeof r.updatedAt === "string" ? r.updatedAt : "";
  const map: ExampleMap = {
    id: r.id,
    title: cleanLine(r.title, CARD_TEXT_MAX) || "Untitled story",
    rules,
    examples,
    questions,
    createdAt: typeof r.createdAt === "string" ? r.createdAt : updatedAt,
    updatedAt,
  };
  if (typeof r.storyId === "string" && r.storyId && r.storyId.length <= TOOL_TEXT_MAX.short) {
    map.storyId = r.storyId;
  }
  if (isVerdict(r.verdict)) map.verdict = r.verdict;
  if (
    typeof r.timeboxMinutes === "number" &&
    Number.isInteger(r.timeboxMinutes) &&
    r.timeboxMinutes >= TIMEBOX_MIN &&
    r.timeboxMinutes <= TIMEBOX_MAX
  ) {
    map.timeboxMinutes = r.timeboxMinutes;
  }
  if (typeof r.sentAt === "string" && !Number.isNaN(Date.parse(r.sentAt))) map.sentAt = r.sentAt;
  const sentTo = readLinks(r.sentTo);
  if (sentTo) map.sentTo = sentTo;
  return map;
}

/** The stored maps made safe to read, each id once; what isn't a map is dropped. */
export function readMaps(raw: unknown): ExampleMap[] {
  if (!Array.isArray(raw)) return [];
  const seen = new Set<string>();
  const out: ExampleMap[] = [];
  for (const x of raw) {
    const m = readMap(x);
    if (!m || seen.has(m.id)) continue;
    seen.add(m.id);
    out.push(m);
  }
  return out;
}

/** Newest change first (ties: newest made first). */
export function newestFirst(maps: readonly ExampleMap[]): ExampleMap[] {
  return [...maps].sort(
    (a, b) => b.updatedAt.localeCompare(a.updatedAt) || b.createdAt.localeCompare(a.createdAt)
  );
}

/* ── Writing ─────────────────────────────────────────────────────────── */

export interface NewMap {
  title: string;
  storyId?: string;
  timeboxMinutes?: number;
}

/** A map with no cards yet. */
export function blankMap(input: NewMap, id: string, now: string): ExampleMap {
  const map: ExampleMap = {
    id,
    title: cleanLine(input.title, CARD_TEXT_MAX) || "Untitled story",
    rules: [],
    examples: [],
    questions: [],
    createdAt: now,
    updatedAt: now,
  };
  if (input.storyId) map.storyId = input.storyId;
  const tb = input.timeboxMinutes;
  if (typeof tb === "number" && Number.isInteger(tb) && tb >= TIMEBOX_MIN && tb <= TIMEBOX_MAX) {
    map.timeboxMinutes = tb;
  }
  return map;
}

/** `map` with `patch` and a fresh `updatedAt`. */
export function touched(map: ExampleMap, patch: Partial<ExampleMap>, now: string): ExampleMap {
  return { ...map, ...patch, updatedAt: now };
}

/** What the page and Amr say when a change would take a map past one synced row. */
export const MAP_TOO_BIG =
  "This example map is too big to save. Shorten or remove some lines. Nothing was saved.";

/**
 * Whether writing `next` over `prev` would grow a map past one synced row
 * (ENTITY_ROW_MAX_BYTES of JSON), as the workspace CRUD refuses it. A
 * change that shrinks a map, or keeps its size, always goes through, so a
 * map stored over the limit can still be cut back.
 */
export function rowTooBig(next: ExampleMap, prev: ExampleMap): boolean {
  const size = jsonBytes(next);
  return size > ENTITY_ROW_MAX_BYTES && size > jsonBytes(prev);
}

export function ruleOf(map: ExampleMap, ruleId: string): ExampleMapRule | undefined {
  return map.rules.find((r) => r.id === ruleId);
}

export function examplesOf(map: ExampleMap, ruleId: string): ExampleMapExample[] {
  return map.examples.filter((e) => e.ruleId === ruleId);
}

/** Whether an example is written as Given, When and Then. */
export function isStructured(e: ExampleMapExample): boolean {
  return Boolean(e.given && e.when && e.then);
}

/** Why a rule can't be added now, or null. */
export function ruleRoomProblem(map: ExampleMap): string | null {
  return map.rules.length >= RULES_MAX
    ? `A map holds ${RULES_MAX} rules at most. More rules than that is several stories: split it.`
    : null;
}

/** Why an example can't go under `ruleId` now, or null. */
export function exampleRoomProblem(map: ExampleMap, ruleId: string): string | null {
  if (!ruleOf(map, ruleId)) return "That rule is no longer on the map.";
  if (map.examples.length >= EXAMPLES_MAX) return `A map holds ${EXAMPLES_MAX} examples at most.`;
  if (examplesOf(map, ruleId).length >= EXAMPLES_PER_RULE_MAX) {
    return `A rule holds ${EXAMPLES_PER_RULE_MAX} examples at most. So many may hide a second rule.`;
  }
  return null;
}

/** Why a question can't be added now, or null. */
export function questionRoomProblem(map: ExampleMap): string | null {
  return map.questions.length >= QUESTIONS_MAX
    ? `A map holds ${QUESTIONS_MAX} questions at most.`
    : null;
}

/** `map` with a new rule at the end, or null when it is blank or the map is full. */
export function withRule(
  map: ExampleMap,
  text: string,
  id: string,
  now: string
): ExampleMap | null {
  const clean = cleanLine(text, CARD_TEXT_MAX);
  if (!clean || ruleRoomProblem(map)) return null;
  return touched(map, { rules: [...map.rules, { id, text: clean }] }, now);
}

/** `map` with a rule's text changed; null when it is blank or the rule is gone. */
export function withRuleText(
  map: ExampleMap,
  ruleId: string,
  text: string,
  now: string
): ExampleMap | null {
  const clean = cleanLine(text, CARD_TEXT_MAX);
  if (!clean || !ruleOf(map, ruleId)) return null;
  return touched(
    map,
    { rules: map.rules.map((r) => (r.id === ruleId ? { ...r, text: clean } : r)) },
    now
  );
}

/** `map` without a rule and its examples; a question about it stays, about no rule. */
export function withoutRule(map: ExampleMap, ruleId: string, now: string): ExampleMap {
  return touched(
    map,
    {
      rules: map.rules.filter((r) => r.id !== ruleId),
      examples: map.examples.filter((e) => e.ruleId !== ruleId),
      questions: map.questions.map((q) => {
        if (q.ruleId !== ruleId) return q;
        const rest = { ...q };
        delete rest.ruleId;
        return rest;
      }),
    },
    now
  );
}

/** What deleting a rule takes with it: for its Undo. */
export interface RuleRemoval {
  rule: ExampleMapRule;
  index: number;
  examples: { example: ExampleMapExample; index: number }[];
  /** Questions that were about it. */
  questionIds: string[];
}

/** What `withoutRule` would take, or null when the rule is gone. */
export function ruleRemoval(map: ExampleMap, ruleId: string): RuleRemoval | null {
  const index = map.rules.findIndex((r) => r.id === ruleId);
  if (index < 0) return null;
  return {
    rule: map.rules[index],
    index,
    examples: map.examples.flatMap((example, i) =>
      example.ruleId === ruleId ? [{ example, index: i }] : []
    ),
    questionIds: map.questions.filter((q) => q.ruleId === ruleId).map((q) => q.id),
  };
}

/** Put items back at their places, skipping ids already there; changes since are kept. */
function putBack<T extends { id: string }>(
  list: readonly T[],
  items: { item: T; index: number }[]
) {
  const out = [...list];
  for (const { item, index } of items) {
    if (out.some((x) => x.id === item.id)) continue;
    out.splice(Math.min(index, out.length), 0, item);
  }
  return out;
}

/**
 * The Undo of a rule's delete: the rule and its examples back at their
 * places, and the questions that were about it about it again. Anything
 * added since stays; past the caps, nothing comes back.
 */
export function withRuleRestored(map: ExampleMap, removal: RuleRemoval, now: string): ExampleMap {
  if (map.rules.some((r) => r.id === removal.rule.id) || map.rules.length >= RULES_MAX) return map;
  const room = EXAMPLES_MAX - map.examples.length;
  const examples = removal.examples.slice(0, Math.max(0, room));
  const ids = new Set(removal.questionIds);
  return touched(
    map,
    {
      rules: putBack(map.rules, [{ item: removal.rule, index: removal.index }]),
      examples: putBack(
        map.examples,
        examples.map(({ example, index }) => ({ item: example, index }))
      ),
      questions: map.questions.map((q) =>
        ids.has(q.id) && !q.ruleId ? { ...q, ruleId: removal.rule.id } : q
      ),
    },
    now
  );
}

/** The Undo of an example's or a question's delete: back at its place, room allowing. */
export function withCardRestored(
  map: ExampleMap,
  card:
    | { kind: "example"; item: ExampleMapExample; index: number }
    | { kind: "question"; item: ExampleMapQuestion; index: number },
  now: string
): ExampleMap {
  if (card.kind === "example") {
    if (exampleRoomProblem(map, card.item.ruleId)) return map;
    return touched(map, { examples: putBack(map.examples, [card]) }, now);
  }
  if (questionRoomProblem(map)) return map;
  const item = { ...card.item };
  if (item.ruleId && !ruleOf(map, item.ruleId)) delete item.ruleId;
  return touched(map, { questions: putBack(map.questions, [{ item, index: card.index }]) }, now);
}

/** A rule's links set to `links` (none left removes the key). */
export function withRuleLinks(
  map: ExampleMap,
  ruleId: string,
  links: HandoffLink[],
  now: string
): ExampleMap {
  return touched(
    map,
    {
      rules: map.rules.map((r) => {
        if (r.id !== ruleId) return r;
        const next = { ...r };
        if (links.length > 0) next.sentTo = links;
        else delete next.sentTo;
        return next;
      }),
    },
    now
  );
}

export interface NewExample {
  ruleId: string;
  text: string;
  given?: string;
  when?: string;
  then?: string;
}

/** The example as stored: its line (or its Given/When/Then as a sentence) and all three parts or none. */
function cleanExample(
  input: Omit<NewExample, "ruleId">
): Omit<ExampleMapExample, "id" | "ruleId"> | null {
  const gwt = readGwt(input as unknown as Record<string, unknown>);
  const text =
    cleanLine(input.text, CARD_TEXT_MAX) || (gwt ? cleanLine(gwtSentence(gwt), CARD_TEXT_MAX) : "");
  if (!text) return null;
  return { text, ...(gwt ?? {}) };
}

/** `map` with a new example under a rule, or null when it is blank or there is no room. */
export function withExample(
  map: ExampleMap,
  input: NewExample,
  id: string,
  now: string
): ExampleMap | null {
  if (exampleRoomProblem(map, input.ruleId)) return null;
  const clean = cleanExample(input);
  if (!clean) return null;
  return touched(map, { examples: [...map.examples, { id, ruleId: input.ruleId, ...clean }] }, now);
}

/**
 * `map` with an example rewritten: its line and, when `gwt` is given, its
 * Given/When/Then (null takes them off). Null when it is gone or left blank.
 */
export function withExampleEdit(
  map: ExampleMap,
  exampleId: string,
  edit: { text?: string; gwt?: Pick<StoryGwt, "given" | "when" | "then"> | null },
  now: string
): ExampleMap | null {
  const current = map.examples.find((e) => e.id === exampleId);
  if (!current) return null;
  const parts =
    edit.gwt === undefined
      ? { given: current.given, when: current.when, then: current.then }
      : (edit.gwt ?? {});
  const clean = cleanExample({ text: edit.text ?? current.text, ...parts });
  if (!clean) return null;
  return touched(
    map,
    {
      examples: map.examples.map((e) =>
        e.id === exampleId ? { id: e.id, ruleId: e.ruleId, ...clean } : e
      ),
    },
    now
  );
}

export function withoutExample(map: ExampleMap, exampleId: string, now: string): ExampleMap {
  return touched(map, { examples: map.examples.filter((e) => e.id !== exampleId) }, now);
}

export interface NewQuestion {
  text: string;
  ruleId?: string;
  owner?: string;
}

/** `map` with a new open question, or null when it is blank or the map is full. */
export function withQuestion(
  map: ExampleMap,
  input: NewQuestion,
  id: string,
  now: string
): ExampleMap | null {
  const text = cleanLine(input.text, CARD_TEXT_MAX);
  if (!text || questionRoomProblem(map)) return null;
  const q: ExampleMapQuestion = { id, text, status: "open" };
  if (input.ruleId && ruleOf(map, input.ruleId)) q.ruleId = input.ruleId;
  const owner = cleanLine(input.owner, CARD_TEXT_MAX);
  if (owner) q.owner = owner;
  return touched(map, { questions: [...map.questions, q] }, now);
}

export interface QuestionPatch {
  text?: string;
  owner?: string;
  status?: ExampleQuestionStatus;
  /** "" clears it. */
  answer?: string;
}

/** `map` with a question changed; null when it is gone or its text left blank. */
export function withQuestionPatch(
  map: ExampleMap,
  questionId: string,
  patch: QuestionPatch,
  now: string
): ExampleMap | null {
  const current = map.questions.find((q) => q.id === questionId);
  if (!current) return null;
  const next: ExampleMapQuestion = { ...current };
  if (patch.text !== undefined) {
    const text = cleanLine(patch.text, CARD_TEXT_MAX);
    if (!text) return null;
    next.text = text;
  }
  if (patch.owner !== undefined) {
    const owner = cleanLine(patch.owner, CARD_TEXT_MAX);
    if (owner) next.owner = owner;
    else delete next.owner;
  }
  if (patch.answer !== undefined) {
    const answer = cleanText(patch.answer, ANSWER_MAX);
    if (answer) next.answer = answer;
    else delete next.answer;
  }
  if (patch.status !== undefined) next.status = patch.status;
  return touched(
    map,
    { questions: map.questions.map((q) => (q.id === questionId ? next : q)) },
    now
  );
}

export function withoutQuestion(map: ExampleMap, questionId: string, now: string): ExampleMap {
  return touched(map, { questions: map.questions.filter((q) => q.id !== questionId) }, now);
}

/**
 * The rule an answered question becomes ("Make it a rule"): its answer's
 * first line, or the question itself when it has no answer.
 */
export function ruleFromQuestion(q: ExampleMapQuestion): string {
  const first = (q.answer ?? "").split("\n").find((l) => l.trim()) ?? "";
  return cleanLine(first || q.text, CARD_TEXT_MAX);
}

/** `map` with the verdict set (null clears it). */
export function withVerdict(
  map: ExampleMap,
  verdict: ExampleMapVerdict | null,
  now: string
): ExampleMap {
  const next = touched(map, {}, now);
  if (verdict) next.verdict = verdict;
  else delete next.verdict;
  return next;
}

/* ── What the map says ───────────────────────────────────────────────── */

export interface MapCounts {
  rules: number;
  examples: number;
  structured: number;
  open: number;
  answered: number;
  dropped: number;
}

export function mapCounts(map: ExampleMap): MapCounts {
  return {
    rules: map.rules.length,
    examples: map.examples.length,
    structured: map.examples.filter(isStructured).length,
    open: map.questions.filter((q) => q.status === "open").length,
    answered: map.questions.filter((q) => q.status === "answered").length,
    dropped: map.questions.filter((q) => q.status === "dropped").length,
  };
}

export type SignalTone = "ready" | "warn" | "info";

export interface MapSignal {
  id: string;
  tone: SignalTone;
  text: string;
  /** The rule it is about, for a rule's own signal. */
  ruleId?: string;
}

/** Rules past this many mean the story is probably several. */
export const SPLIT_RULES_AT = 4;
/** Examples past this many under one rule may hide a second rule. */
export const BUSY_RULE_AT = 4;
/** This many open questions (or more than there are rules) mean not ready yet. */
export const NOT_READY_QUESTIONS = 3;

const plural = (n: number, one: string, many: string) => `${n} ${n === 1 ? one : many}`;

/**
 * What the cards say, in plain words: too many open questions to build,
 * too many rules for one story, a rule with no example or with so many it
 * may be two, or every rule with an example and nothing left open. Pure
 * signals for the team to weigh: the verdict stays theirs.
 */
export function mapSignals(map: ExampleMap): MapSignal[] {
  const c = mapCounts(map);
  const out: MapSignal[] = [];
  if (c.rules === 0) {
    out.push({
      id: "no-rules",
      tone: "info",
      text: "No rules yet: start with what the story must always do, or never do.",
    });
  }
  if (c.open >= NOT_READY_QUESTIONS || (c.open > 0 && c.open > c.rules)) {
    out.push({
      id: "not-ready",
      tone: "warn",
      text: `${plural(c.open, "open question", "open questions")}: the story isn't ready yet. Find the answers first.`,
    });
  }
  if (c.rules > SPLIT_RULES_AT) {
    out.push({
      id: "too-big",
      tone: "warn",
      text: `${plural(c.rules, "rule", "rules")}: probably several stories. Split it by rule.`,
    });
  }
  for (const r of map.rules) {
    const n = examplesOf(map, r.id).length;
    if (n === 0) {
      out.push({
        id: `no-example:${r.id}`,
        ruleId: r.id,
        tone: "info",
        text: `“${shortText(r.text)}” has no example yet: give it one.`,
      });
    } else if (n > BUSY_RULE_AT) {
      out.push({
        id: `busy-rule:${r.id}`,
        ruleId: r.id,
        tone: "info",
        text: `“${shortText(r.text)}” has ${n} examples: it may hide two rules.`,
      });
    }
  }
  if (c.rules > 0 && c.open === 0 && map.rules.every((r) => examplesOf(map, r.id).length > 0)) {
    out.push({
      id: "looks-ready",
      tone: "ready",
      text: "Every rule has an example and no question is open: it looks ready.",
    });
  }
  return out;
}

/** The verdict the signals point to, or null when they don't point anywhere yet. */
export function suggestedVerdict(map: ExampleMap): ExampleMapVerdict | null {
  const ids = new Set(mapSignals(map).map((s) => s.id));
  if (ids.has("not-ready")) return "not-yet";
  if (ids.has("too-big")) return "split";
  if (ids.has("looks-ready")) return "ready";
  return null;
}

/* ── Sending ─────────────────────────────────────────────────────────── */

/** A link a send recorded is live while its target still exists. */
export type LinkIsLive = (link: HandoffLink) => boolean;

/** The story link a map or a rule holds ("backlog-story"), when it is live. */
export function storyLink(
  links: readonly HandoffLink[] | undefined,
  isLive: LinkIsLive
): HandoffLink | undefined {
  const link = (links ?? []).find((l) => l.route === "backlog-story");
  return link && isLive(link) ? link : undefined;
}

/**
 * A split story's title, "<story>: <rule>", at most SPLIT_TITLE_MAX. The
 * story part is cut first (to 150 characters, as Backlog Health's splits
 * are, and shorter when the rule needs the room), so the rule stays
 * readable; only a very long rule is cut too.
 */
export function splitTitle(story: string, rule: string): string {
  const r = cleanLine(rule, SPLIT_TITLE_MAX);
  const s = cleanLine(story, SPLIT_TITLE_MAX);
  if (!s) return r;
  if (!r) return cut(s, SPLIT_TITLE_MAX);
  const room = SPLIT_TITLE_MAX - 2;
  const storyPart = cut(s, Math.min(SPLIT_STORY_PART, Math.max(40, room - r.length)));
  return `${storyPart}: ${cut(r, room - storyPart.length)}`;
}

/** A split story's notes: the rule's examples, one "- " line each (at most 2,000 characters). */
export function splitDescription(map: ExampleMap, ruleId: string): string | undefined {
  const lines = examplesOf(map, ruleId).map((e) => `- ${e.text}`);
  if (lines.length === 0) return undefined;
  return cleanText(lines.join("\n"), STORY_CRITERIA_MAX);
}

/** What "Send to the story" would write, or why it can't. */
export type StoryWritePlan =
  | {
      ok: true;
      next: Story;
      /** Rule lines added to the acceptance criteria. */
      rules: number;
      /** Examples added as Given/When/Then. */
      examples: number;
      /** Structured examples left out: already on the story, or past its 20 scenarios. */
      notSent: string[];
      /** Nothing new to add. */
      unchanged: boolean;
    }
  | { ok: false; problem: string };

/**
 * The story with the map's rules appended to its acceptance criteria as
 * "- rule" lines (one already there, by its words, is skipped) and the
 * structured examples appended to its Given/When/Then (one already there,
 * by its sentence, is skipped; past STORY_GWT_MAX the rest are listed as
 * not sent). Refused when the criteria would pass STORY_CRITERIA_MAX.
 */
export function storyWritePlan(story: Story, map: ExampleMap): StoryWritePlan {
  const criteria = (story.acceptanceCriteria ?? "").replace(/\r\n?/g, "\n").trimEnd();
  const have = new Set(criteria.split("\n").map(sameKey).filter(Boolean));
  const newRules: string[] = [];
  for (const r of map.rules) {
    const key = sameKey(r.text);
    if (!key || have.has(key)) continue;
    have.add(key);
    newRules.push(`- ${r.text}`);
  }
  const nextCriteria = [criteria, ...newRules].filter(Boolean).join("\n");
  if (nextCriteria.length > STORY_CRITERIA_MAX) {
    return {
      ok: false,
      problem: `The rules would take the story's acceptance criteria past ${STORY_CRITERIA_MAX.toLocaleString("en")} characters. Shorten the criteria or the rules first. Nothing was sent.`,
    };
  }

  const gwt = story.gwt ?? [];
  const sentences = new Set(gwt.map((g) => gwtSentence(g).toLowerCase()));
  const taken = new Set(gwt.map((g) => g.id));
  const rows: StoryGwt[] = [];
  const notSent: string[] = [];
  for (const e of map.examples) {
    if (!isStructured(e)) continue;
    const row = { given: e.given as string, when: e.when as string, then: e.then as string };
    const sentence = gwtSentence(row).toLowerCase();
    if (sentences.has(sentence) || gwt.length + rows.length >= STORY_GWT_MAX) {
      notSent.push(e.id);
      continue;
    }
    sentences.add(sentence);
    const id = newGwtId(taken);
    taken.add(id);
    rows.push({ id, ...row });
  }

  let next: Story = { ...story };
  if (nextCriteria) next.acceptanceCriteria = nextCriteria;
  if (rows.length > 0) next = withStoryGwt(next, [...gwt, ...rows]);
  return {
    ok: true,
    next,
    rules: newRules.length,
    examples: rows.length,
    notSent,
    unchanged: newRules.length === 0 && rows.length === 0,
  };
}

/* ── Forms ───────────────────────────────────────────────────────────── */

const required = (what: string) => `Write the ${what}.`;
const tooLong = (what: string, max: number) =>
  `Keep the ${what} to ${max.toLocaleString("en")} characters.`;

export interface MapDraft {
  title: string;
  storyId: string;
}

/** A new map: a story picked, or typed. */
export function validateMapDraft(d: MapDraft): Validation<NewMap, "title"> {
  const title = d.title.replace(/\s+/g, " ").trim();
  if (!d.storyId && !title) return { ok: false, errors: { title: "Pick a story or type one." } };
  if (title.length > CARD_TEXT_MAX)
    return { ok: false, errors: { title: tooLong("story", CARD_TEXT_MAX) } };
  return { ok: true, values: { title, ...(d.storyId ? { storyId: d.storyId } : {}) } };
}

/** One card's line: a rule, an example or a question. */
export function validateCardText(
  text: string,
  what: "rule" | "example" | "question"
): Validation<{ text: string }, "text"> {
  const t = text.replace(/\s+/g, " ").trim();
  if (!t) return { ok: false, errors: { text: required(what) } };
  if (t.length > CARD_TEXT_MAX)
    return { ok: false, errors: { text: tooLong(what, CARD_TEXT_MAX) } };
  return { ok: true, values: { text: t } };
}

export interface AnswerDraft {
  answer: string;
}

export function validateAnswerDraft(d: AnswerDraft): Validation<{ answer: string }, "answer"> {
  const answer = d.answer.replace(/\r\n?/g, "\n").trim();
  if (!answer) return { ok: false, errors: { answer: required("answer") } };
  if (answer.length > ANSWER_MAX)
    return { ok: false, errors: { answer: tooLong("answer", ANSWER_MAX) } };
  return { ok: true, values: { answer } };
}

/** The ids a page mints for its cards: short, and unlike the map's own. */
export const CARD_ID_PREFIX = { rule: "rule_", example: "ex_", question: "q_" } as const;
