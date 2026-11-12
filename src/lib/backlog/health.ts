/**
 * Backlog Health: is the backlog DEEP? Four checks on the backlog's stories
 * (status "backlog", in no sprint), in the shared backlog order
 * (lib/sprints/plan `compareBacklogOrder`, with the items' live ranks):
 *
 *   - Detailed appropriately: the top stories (DEEP_TOP_N) say enough to be
 *     built: acceptance criteria (free text or Given/When/Then) and a title
 *     that isn't vague. Stories further down may stay rough.
 *   - Estimated: the top stories have points, none of them too big.
 *   - Emergent: the backlog keeps changing: stories were added or touched
 *     in the last STALE_WEEKS weeks, and few are left untouched.
 *   - Prioritized: an order exists (a decided rank or a priority score) and
 *     no two stories share a place.
 *
 * Each check is a share from 0 to 1 with plain reasons, or null when it
 * can't be told (no dates to read); the overall score is their mean, as a
 * whole percentage. Per-story flags say what to fix: a vague title, no
 * acceptance criteria and no points (the top stories only), too big, stale.
 *
 * Pure; server-safe. Example stories ("example-" ids) are the caller's to
 * leave out (`backlogForHealth` does in the workspace).
 */

import type { BacklogItem, Story } from "@/lib/stores/workspace-types";
import { compareBacklogOrder, storyPoints, withLiveBacklogRank } from "@/lib/sprints/plan";
import { SPLIT_PATTERNS, type SplitPattern } from "@/app/(tools)/refinement/invest";
import { isExampleId } from "@/lib/utils/example-id";

/** How many stories count as "the top of the backlog". */
export const DEEP_TOP_N = 10;
/** Points above which a story is too big for a sprint (Fibonacci's 13 is the last that fits). */
export const TOO_BIG_POINTS = 13;
/** A story untouched this many weeks is stale. */
export const STALE_WEEKS = 8;
/** "Recently added" for the Emergent check's reasons. */
export const RECENT_DAYS = 30;

export interface HealthOptions {
  /** "YYYY-MM-DD". */
  today: string;
  topN?: number;
  tooBigPoints?: number;
  staleWeeks?: number;
}

export type StoryFlagId = "vague" | "no-criteria" | "no-points" | "too-big" | "stale";

export const STORY_FLAG_LABEL: Record<StoryFlagId, string> = {
  vague: "Vague title",
  "no-criteria": "No acceptance criteria",
  "no-points": "No points",
  "too-big": "Too big",
  stale: "Stale",
};

export interface StoryFlag {
  id: StoryFlagId;
  /** Why, from the story: "21 points, above 13". */
  reason: string;
}

export interface StoryHealth {
  story: Story;
  /** 1-based place in the backlog order. */
  place: number;
  /** Among the top DEEP_TOP_N. */
  top: boolean;
  flags: StoryFlag[];
  /** "YYYY-MM-DD" it was last touched, or null with no date on it. */
  touched: string | null;
}

export type DeepCheckId = "detailed" | "estimated" | "emergent" | "prioritized";

export const DEEP_LABEL: Record<DeepCheckId, string> = {
  detailed: "Detailed appropriately",
  estimated: "Estimated",
  emergent: "Emergent",
  prioritized: "Prioritized",
};

export interface DeepCheck {
  id: DeepCheckId;
  label: string;
  /** 0–1, or null when it can't be told. */
  score: number | null;
  /** Plain sentences on what it found. */
  reasons: string[];
}

export type HealthVerdict = "healthy" | "needs-work" | "unhealthy" | "empty";

export interface BacklogHealth {
  total: number;
  topN: number;
  checks: DeepCheck[];
  /** 0–100, the mean of the checks that could be told; null with none. */
  score: number | null;
  verdict: HealthVerdict;
  /** One sentence for the top of the page. */
  summary: string;
  stories: StoryHealth[];
  /** How many stories have at least one flag. */
  flagged: number;
}

const DAY_MS = 86_400_000;

const plural = (n: number, one: string, many = `${one}s`) => `${n} ${n === 1 ? one : many}`;
const pct = (share: number) => `${Math.round(share * 100)}%`;

/** The backlog's stories, in the shared order: not done, in no sprint, no example rows. */
export function backlogForHealth(
  stories: readonly Story[],
  backlogItems?: readonly Pick<BacklogItem, "id" | "rank">[]
): Story[] {
  return withLiveBacklogRank(
    stories.filter((s) => !s.sprintId && s.status === "backlog" && !isExampleId(s.id)),
    backlogItems
  ).sort(compareBacklogOrder);
}

/** The latest day a story was written to: created, moved, refined or ticked. */
export function lastTouched(story: Story): string | null {
  const dates: string[] = [];
  const push = (v: unknown) => {
    if (typeof v === "string" && /^\d{4}-\d{2}-\d{2}/.test(v)) dates.push(v.slice(0, 10));
  };
  push(story.createdAt);
  for (const h of story.statusHistory ?? []) push(h.at);
  for (const h of story.sprintHistory ?? []) push(h.at);
  push(story.readiness?.updatedAt);
  push(story.dodChecks?.updatedAt);
  if (dates.length === 0) return null;
  return dates.sort().at(-1) ?? null;
}

function daysBetween(from: string, to: string): number | null {
  const a = Date.parse(`${from}T00:00:00Z`);
  const b = Date.parse(`${to}T00:00:00Z`);
  if (Number.isNaN(a) || Number.isNaN(b)) return null;
  return Math.round((b - a) / DAY_MS);
}

const GENERIC =
  /^(fix(es)?|update[sd]?|improve(ments?)?|changes?|refactor(ing)?|misc(ellaneous)?|stuff|tbd|todo|various|bugs?|tweaks?|clean ?up|tidy ?up|polish|work|tasks?|items?|ui|ux|backend|frontend|api|performance|tech debt)\b/i;

/**
 * Whether a title is too vague to build from: fewer than three words, or a
 * short one that only names an area or a kind of work ("Fix bugs",
 * "Improvements", "Update UI").
 */
export function isVagueTitle(title: string): boolean {
  const words = title
    // Punctuation and symbols are not words (letters with accents are).
    .replace(/[!-&(-,./:-@[-`{-~]/g, " ")
    .split(/\s+/)
    .filter(Boolean);
  if (words.length < 3) return true;
  return words.length <= 4 && GENERIC.test(title.trim());
}

/** Whether the story says how to tell it's done: free-text criteria or a scenario. */
export function hasCriteria(story: Pick<Story, "acceptanceCriteria" | "gwt">): boolean {
  return Boolean(story.acceptanceCriteria?.trim()) || (story.gwt?.length ?? 0) > 0;
}

/** The flags on one story, at `place` in the backlog. */
export function storyFlags(
  story: Story,
  {
    top,
    today,
    tooBigPoints = TOO_BIG_POINTS,
    staleWeeks = STALE_WEEKS,
  }: {
    top: boolean;
    today: string;
    tooBigPoints?: number;
    staleWeeks?: number;
  }
): StoryFlag[] {
  const flags: StoryFlag[] = [];
  if (isVagueTitle(story.title)) {
    flags.push({ id: "vague", reason: "The title is too short or general to build from." });
  }
  if (top && !hasCriteria(story)) {
    flags.push({
      id: "no-criteria",
      reason: "Near the top, with no acceptance criteria to say when it is done.",
    });
  }
  const pts = storyPoints(story);
  if (top && pts <= 0) {
    flags.push({ id: "no-points", reason: "Near the top, with no points yet." });
  }
  if (pts > tooBigPoints) {
    flags.push({
      id: "too-big",
      reason: `${plural(pts, "point")}, above ${tooBigPoints}: split it before a sprint takes it.`,
    });
  }
  const touched = lastTouched(story);
  const age = touched ? daysBetween(touched, today) : null;
  if (age !== null && age > staleWeeks * 7) {
    flags.push({
      id: "stale",
      reason: `Not touched for ${plural(Math.floor(age / 7), "week")}. Refine it or drop it.`,
    });
  }
  return flags;
}

/** The DEEP scan of `backlog` (already in the backlog order). */
export function backlogHealth(backlog: readonly Story[], options: HealthOptions): BacklogHealth {
  const topN = options.topN ?? DEEP_TOP_N;
  const tooBig = options.tooBigPoints ?? TOO_BIG_POINTS;
  const staleWeeks = options.staleWeeks ?? STALE_WEEKS;
  const { today } = options;
  const stories: StoryHealth[] = backlog.map((story, i) => ({
    story,
    place: i + 1,
    top: i < topN,
    touched: lastTouched(story),
    flags: storyFlags(story, { top: i < topN, today, tooBigPoints: tooBig, staleWeeks }),
  }));
  const total = stories.length;
  if (total === 0) {
    return {
      total,
      topN,
      checks: [],
      score: null,
      verdict: "empty",
      summary: "The backlog is empty: there is nothing to check yet.",
      stories,
      flagged: 0,
    };
  }
  const top = stories.slice(0, topN);
  const checks = [
    detailedCheck(top),
    estimatedCheck(top, tooBig),
    emergentCheck(stories, today, staleWeeks),
    prioritizedCheck(stories),
  ];
  const told = checks.filter((c) => c.score !== null) as (DeepCheck & { score: number })[];
  const score =
    told.length === 0
      ? null
      : Math.round((told.reduce((n, c) => n + c.score, 0) / told.length) * 100);
  const verdict: HealthVerdict =
    score === null
      ? "needs-work"
      : score >= 80
        ? "healthy"
        : score >= 50
          ? "needs-work"
          : "unhealthy";
  const flagged = stories.filter((s) => s.flags.length > 0).length;
  const weakest = told.slice().sort((a, b) => a.score - b.score)[0];
  const summary =
    score === null
      ? `${plural(total, "story", "stories")} in the backlog.`
      : verdict === "healthy"
        ? `${score}% DEEP: the backlog is in good shape. ${flagged > 0 ? `${plural(flagged, "story", "stories")} still ${flagged === 1 ? "has" : "have"} a flag.` : "No story is flagged."}`
        : `${score}% DEEP. Start with “${weakest.label}”: ${weakest.reasons[0] ?? ""}`.trim();
  return { total, topN, checks, score, verdict, summary, stories, flagged };
}

function detailedCheck(top: readonly StoryHealth[]): DeepCheck {
  const ok = top.filter(
    (s) => hasCriteria(s.story) && !s.flags.some((f) => f.id === "vague")
  ).length;
  const noCriteria = top.filter((s) => !hasCriteria(s.story)).length;
  const vague = top.filter((s) => s.flags.some((f) => f.id === "vague")).length;
  const reasons = [
    `${ok} of the top ${plural(top.length, "story", "stories")} have acceptance criteria and a clear title.`,
  ];
  if (noCriteria > 0) {
    reasons.push(`${noCriteria} ${noCriteria === 1 ? "has" : "have"} no acceptance criteria.`);
  }
  if (vague > 0) {
    reasons.push(
      `${plural(vague, "title")} ${vague === 1 ? "is" : "are"} too vague to build from.`
    );
  }
  return { id: "detailed", label: DEEP_LABEL.detailed, score: ok / top.length, reasons };
}

function estimatedCheck(top: readonly StoryHealth[], tooBig: number): DeepCheck {
  const sized = top.filter((s) => storyPoints(s.story) > 0);
  const fits = sized.filter((s) => storyPoints(s.story) <= tooBig).length;
  const unsized = top.length - sized.length;
  const big = sized.length - fits;
  const reasons = [
    `${fits} of the top ${plural(top.length, "story", "stories")} have points that fit a sprint.`,
  ];
  if (unsized > 0) reasons.push(`${unsized} ${unsized === 1 ? "has" : "have"} no points yet.`);
  if (big > 0)
    reasons.push(
      `${big} ${big === 1 ? "is" : "are"} above ${tooBig} points: split ${big === 1 ? "it" : "them"}.`
    );
  return { id: "estimated", label: DEEP_LABEL.estimated, score: fits / top.length, reasons };
}

function emergentCheck(
  stories: readonly StoryHealth[],
  today: string,
  staleWeeks: number
): DeepCheck {
  const dated = stories.filter((s) => s.touched !== null);
  if (dated.length === 0) {
    return {
      id: "emergent",
      label: DEEP_LABEL.emergent,
      score: null,
      reasons: ["No story says when it was added or changed, so this can't be told yet."],
    };
  }
  const fresh = dated.filter((s) => {
    const d = daysBetween(s.touched as string, today);
    return d !== null && d <= staleWeeks * 7;
  }).length;
  const recent = stories.filter((s) => {
    const created = typeof s.story.createdAt === "string" ? s.story.createdAt.slice(0, 10) : null;
    const d = created ? daysBetween(created, today) : null;
    return d !== null && d >= 0 && d <= RECENT_DAYS;
  }).length;
  const stale = dated.length - fresh;
  const share = fresh / dated.length;
  const reasons = [
    `${pct(share)} of the dated stories were added or changed in the last ${staleWeeks} weeks.`,
  ];
  reasons.push(
    recent > 0
      ? `${plural(recent, "story", "stories")} joined in the last ${RECENT_DAYS} days.`
      : `Nothing joined in the last ${RECENT_DAYS} days.`
  );
  if (stale > 0)
    reasons.push(
      `${plural(stale, "story", "stories")} ${stale === 1 ? "is" : "are"} stale: refine or drop ${stale === 1 ? "it" : "them"}.`
    );
  return { id: "emergent", label: DEEP_LABEL.emergent, score: share, reasons };
}

function prioritizedCheck(stories: readonly StoryHealth[]): DeepCheck {
  const ranked = stories.filter(
    (s) => typeof s.story.backlogRank === "number" && Number.isFinite(s.story.backlogRank)
  );
  const scored = stories.filter(
    (s) =>
      !ranked.includes(s) &&
      typeof s.story.priorityScore === "number" &&
      Number.isFinite(s.story.priorityScore)
  );
  const ordered = ranked.length + scored.length;
  const ties =
    tiedCount(ranked.map((s) => s.story.backlogRank as number)) +
    tiedCount(scored.map((s) => s.story.priorityScore as number));
  const share = ordered / stories.length;
  const score = Math.max(0, share - ties / stories.length);
  const reasons = [
    ordered === stories.length
      ? "Every story has a place in the order."
      : `${ordered} of ${plural(stories.length, "story", "stories")} have a rank or a priority score; the rest have no place yet.`,
  ];
  if (ties > 0)
    reasons.push(
      `${plural(ties, "story", "stories")} share a place with another: decide which comes first.`
    );
  return { id: "prioritized", label: DEEP_LABEL.prioritized, score, reasons };
}

/** How many values repeat another (each value beyond its first). */
function tiedCount(values: readonly number[]): number {
  const seen = new Map<number, number>();
  for (const v of values) seen.set(v, (seen.get(v) ?? 0) + 1);
  let ties = 0;
  seen.forEach((n) => {
    if (n > 1) ties += n;
  });
  return ties;
}

/* ── Splits and scenarios, without AI ────────────────────────────────── */

const cap = (s: string, max: number) => (s.length > max ? `${s.slice(0, max - 1).trimEnd()}…` : s);

/** Two split patterns that suit the title: by its words, else Path and Spike. */
export function splitPatternsFor(title: string): SplitPattern[] {
  const t = title.toLowerCase();
  const ids: SplitPattern["id"][] = [];
  if (/\b(and|or|plus|with)\b|,/.test(t)) ids.push("path");
  if (
    /\b(import|export|file|files|currency|currencies|types?|formats?|languages?|countries|banks?|cards?)\b/.test(
      t
    )
  )
    ids.push("data");
  if (/\b(rules?|limits?|discounts?|permissions?|roles?|validation|policy|policies)\b/.test(t))
    ids.push("rules");
  if (/\b(screens?|pages?|mobile|app|web|desktop|devices?|dashboard|ui)\b/.test(t))
    ids.push("interface");
  if (/\b(research|investigate|unknown|explore|integrat\w*|new)\b/.test(t)) ids.push("spike");
  for (const fill of ["path", "spike"] as const) if (!ids.includes(fill)) ids.push(fill);
  return ids.slice(0, 2).map((id) => SPLIT_PATTERNS.find((p) => p.id === id) as SplitPattern);
}

const SPLIT_SUFFIX: Record<SplitPattern["id"], [string, string]> = {
  spike: ["Spike: find out what it needs", "the rest, once the spike is done"],
  path: ["the main path only", "errors and rare cases"],
  interface: ["the plainest screen first", "the other screens and devices"],
  data: ["one kind of data first", "the other kinds of data"],
  rules: ["the basic rule only", "the extra rules and limits"],
};

/** Smaller stories for a too-big one, from a split pattern: titles to edit before adding. */
export function splitTitles(title: string, pattern: SplitPattern["id"]): string[] {
  const base = cap(title.replace(/\s+/g, " ").trim(), 150);
  const [a, b] = SPLIT_SUFFIX[pattern];
  return pattern === "spike"
    ? [`${a}: ${base}`, `${base}: ${b}`]
    : [`${base}: ${a}`, `${base}: ${b}`];
}

const USER_STORY =
  /^as an? (.+?),?\s+i (?:want|need|would like|can)(?: to)?\s+(.+?)(?:,?\s+so (?:that )?(.+))?[.!]?$/i;

/**
 * Starting scenarios for a story with no criteria: from a user story's
 * "As a…, I want…, so that…" when it has one, else from the title. They
 * are drafts to correct, never criteria on their own.
 */
export function draftScenarios(title: string): { given: string; when: string; then: string }[] {
  const t = title.replace(/\s+/g, " ").trim();
  const m = USER_STORY.exec(t);
  if (m) {
    const [, role, want, why] = m;
    return [
      {
        given: cap(`I am ${/^(a|an|the)\b/i.test(role) ? role : `a ${role}`}`, 200),
        when: cap(`I ${want}`, 200),
        then: cap(why ? `${why}` : "I can see it worked", 200),
      },
    ];
  }
  const action = t.charAt(0).toLowerCase() + t.slice(1);
  return [
    {
      given: "the starting situation for this story",
      when: cap(`someone tries to ${action}`, 200),
      then: "it works, and they can see that it did",
    },
    {
      given: "something goes wrong on the way",
      when: cap(`someone tries to ${action}`, 200),
      then: "they are told what happened and what to do next",
    },
  ];
}
