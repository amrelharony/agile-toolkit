/**
 * The fields three formats carry beside their boxes, read as the page reads
 * them, with the words the page and Amr show for them:
 *   - an idea in the inbox: its intake (who asked, where from, how many,
 *     its status and the idea it was merged into);
 *   - a lean business case: its decision (the verdict, a note, when);
 *   - a Shape Up pitch: its appetite and its bet (the cycle, its start and
 *     weeks, and the bet's status on the betting table).
 * Also the cycle's dates, and the near-duplicate finder the inbox and the
 * gap rules share (the Audience Wall's `duplicateGroups`, used as it is).
 *
 * Pure and server-safe: no zod, no React, no store, no "use client"
 * import. It imports nothing from the canvas model, which reads through it.
 */

import { duplicateGroups } from "@/lib/audience-wall/words";
import { addDays } from "@/lib/flow/days";
import { isIsoDay } from "@/lib/product-goal/model";
import {
  PRODUCT_BET_STATUSES,
  PRODUCT_CANVAS_MAX,
  PRODUCT_CASE_VERDICTS,
  PRODUCT_IDEA_SOURCES,
  PRODUCT_IDEA_STATUSES,
  TOOL_LIST_MAX,
  TOOL_TEXT_MAX,
  type ProductBetStatus,
  type ProductCanvas,
  type ProductCaseDecision,
  type ProductCaseVerdict,
  type ProductIdeaIntake,
  type ProductIdeaSource,
  type ProductIdeaStatus,
  type ProductPitchBet,
} from "@/lib/stores/workspace-types";
import { cutText } from "@/lib/utils/cut-text";

/** How many asked for an idea, at most. */
export const DEMAND_MAX = PRODUCT_CANVAS_MAX.demand;
/** Who asked, at most this many kept; past it only the demand grows. */
export const REQUESTERS_MAX = TOOL_LIST_MAX.requesters;
/** One requester's name or role. */
export const REQUESTER_MAX = TOOL_TEXT_MAX.short;
/** An idea's or a decision's note. */
export const NOTE_MAX = TOOL_TEXT_MAX.text;
/** A cycle's number, 1 to this. */
export const CYCLE_MAX = PRODUCT_CANVAS_MAX.cycle;
/** A cycle's or an appetite's weeks, 1 to this. */
export const WEEKS_MAX = PRODUCT_CANVAS_MAX.weeks;
/** The appetite chips: a small batch, two weeks, a big batch. */
export const APPETITE_CHIPS: readonly number[] = [1, 2, 6];
/** A new cycle's weeks, unless the team says otherwise. */
export const DEFAULT_CYCLE_WEEKS = 6;

const isRecord = (v: unknown): v is Record<string, unknown> =>
  typeof v === "object" && v !== null && !Array.isArray(v);
const oneLine = (text: string) => text.replace(/\s+/g, " ").trim();
const has = <T extends string>(list: readonly T[], v: unknown): v is T =>
  typeof v === "string" && (list as readonly string[]).includes(v);

/** A whole number from `min` to `max`, or undefined. */
function wholeIn(v: unknown, min: number, max: number): number | undefined {
  return typeof v === "number" && Number.isInteger(v) && v >= min && v <= max ? v : undefined;
}

/* ── Words ────────────────────────────────────────────────────────── */

export const IDEA_SOURCE_LABEL: Record<ProductIdeaSource, string> = {
  customer: "A customer",
  stakeholder: "A stakeholder",
  team: "The team",
  data: "The data",
  other: "Somewhere else",
};

export const IDEA_STATUS_LABEL: Record<ProductIdeaStatus, string> = {
  new: "New",
  assessing: "Assessing",
  accepted: "Accepted",
  declined: "Declined",
  merged: "Merged",
};

export const VERDICT_LABEL: Record<ProductCaseVerdict, string> = {
  pending: "Not decided yet",
  go: "Go",
  "no-go": "No go",
  change: "Change and come back",
};

/** The options a business case's record in the Decision Log weighs, in order. */
export const CASE_OPTIONS: readonly string[] = ["Go", "No go", "Change and come back"];

export const BET_STATUS_LABEL: Record<ProductBetStatus, string> = {
  table: "On the table",
  bet: "Bet",
  passed: "Not this time",
  shipped: "Shipped",
  cut: "Cut",
};

/** A cycle as people say it. */
export const cycleName = (n: number) => `Cycle ${n}`;

/* ── An idea's intake ─────────────────────────────────────────────── */

/** An idea still in play: not merged into another, not declined. */
const OPEN_STATUSES: ReadonlySet<ProductIdeaStatus> = new Set<ProductIdeaStatus>([
  "new",
  "assessing",
  "accepted",
]);
export const isOpenStatus = (s: ProductIdeaStatus) => OPEN_STATUSES.has(s);

/** The intake a new idea starts with, and what a row with none reads as. */
export const NEW_INTAKE: Readonly<ProductIdeaIntake> = {
  requesters: [],
  source: "other",
  demand: 1,
  status: "new",
};

/** Requesters trimmed, each once (case aside), blanks dropped, at most REQUESTERS_MAX. */
export function cleanRequesters(raw: unknown): string[] {
  if (!Array.isArray(raw)) return [];
  const out: string[] = [];
  const seen = new Set<string>();
  for (const r of raw) {
    if (out.length >= REQUESTERS_MAX) break;
    if (typeof r !== "string") continue;
    const name = cutText(oneLine(r), REQUESTER_MAX).trim();
    const key = name.toLowerCase();
    if (!name || seen.has(key)) continue;
    seen.add(key);
    out.push(name);
  }
  return out;
}

/**
 * An idea's intake as the page reads it: requesters cleaned, the source
 * and status known ones (else "other" and "new"), the demand a whole
 * number from 1 to DEMAND_MAX (else 1), the idea it was merged into only
 * while it is merged (and never itself; a merged idea naming none reads as
 * new), and a note cut to NOTE_MAX. Every idea reads with one.
 */
export function readIntake(raw: unknown, selfId?: string): ProductIdeaIntake {
  if (!isRecord(raw)) return { ...NEW_INTAKE, requesters: [] };
  const demand =
    typeof raw.demand === "number" && Number.isFinite(raw.demand)
      ? Math.min(DEMAND_MAX, Math.max(1, Math.floor(raw.demand)))
      : 1;
  let status: ProductIdeaStatus = has(PRODUCT_IDEA_STATUSES, raw.status) ? raw.status : "new";
  const into =
    typeof raw.mergedInto === "string" ? cutText(raw.mergedInto.trim(), TOOL_TEXT_MAX.short) : "";
  const mergedInto = status === "merged" && into && into !== selfId ? into : undefined;
  if (status === "merged" && !mergedInto) status = "new";
  const out: ProductIdeaIntake = {
    requesters: cleanRequesters(raw.requesters),
    source: has(PRODUCT_IDEA_SOURCES, raw.source) ? raw.source : "other",
    demand,
    status,
  };
  if (mergedInto) out.mergedInto = mergedInto;
  const note = typeof raw.note === "string" ? cutText(raw.note.trim(), NOTE_MAX).trim() : "";
  if (note) out.note = note;
  return out;
}

/* ── A business case's decision ───────────────────────────────────── */

/** A decision as the page reads it; undefined for none (the case is pending). */
export function readDecision(raw: unknown): ProductCaseDecision | undefined {
  if (!isRecord(raw) || !has(PRODUCT_CASE_VERDICTS, raw.verdict)) return undefined;
  const out: ProductCaseDecision = { verdict: raw.verdict };
  const note = typeof raw.note === "string" ? cutText(raw.note.trim(), NOTE_MAX).trim() : "";
  if (note) out.note = note;
  if (typeof raw.decidedAt === "string" && raw.decidedAt) out.decidedAt = raw.decidedAt;
  return out;
}

/** A case's verdict: pending until one is set. */
export const verdictOf = (c: Pick<ProductCanvas, "decision">): ProductCaseVerdict =>
  c.decision?.verdict ?? "pending";

/* ── A Shape Up pitch: appetite and bet ───────────────────────────── */

/** An appetite or a cycle's weeks: a whole number from 1 to WEEKS_MAX, or undefined. */
export const readWeeks = (raw: unknown): number | undefined => wholeIn(raw, 1, WEEKS_MAX);

/**
 * A bet as the page reads it; undefined for none (the pitch is on the
 * table). A cycle number from 1 to CYCLE_MAX, a start day and its weeks are
 * kept when sound, and never on a pitch back on the table.
 */
export function readBet(raw: unknown): ProductPitchBet | undefined {
  if (!isRecord(raw) || !has(PRODUCT_BET_STATUSES, raw.status)) return undefined;
  const out: ProductPitchBet = { status: raw.status };
  if (out.status !== "table") {
    const cycle = wholeIn(raw.cycle, 1, CYCLE_MAX);
    if (cycle !== undefined) out.cycle = cycle;
    if (typeof raw.start === "string" && isIsoDay(raw.start)) out.start = raw.start;
    const weeks = readWeeks(raw.weeks);
    if (weeks !== undefined) out.weeks = weeks;
  }
  if (typeof raw.decidedAt === "string" && raw.decidedAt) out.decidedAt = raw.decidedAt;
  return out;
}

/** A pitch's bet status: on the table until it has one. */
export const betStatusOf = (c: Pick<ProductCanvas, "bet">): ProductBetStatus =>
  c.bet?.status ?? "table";

/** The last day of a cycle that starts on `start` and runs `weeks` weeks: start + weeks × 7 − 1. */
export function cycleEnd(start: string | undefined, weeks: number | undefined): string | null {
  if (!start || !isIsoDay(start) || readWeeks(weeks) === undefined) return null;
  return addDays(start, (weeks as number) * 7 - 1);
}

/** A bet still running after its cycle ended: the circuit breaker is due. */
export function isOutOfTime(bet: ProductPitchBet | undefined, today: string): boolean {
  if (bet?.status !== "bet") return false;
  const end = cycleEnd(bet.start, bet.weeks);
  return end !== null && end < today;
}

/* ── Ideas that look alike ────────────────────────────────────────── */

/** An idea as the duplicate finder reads it. */
export interface IdeaLike {
  id: string;
  title: string;
  intake?: Pick<ProductIdeaIntake, "demand" | "status">;
}

/** No idea's id: the typed title's place in the finder. */
const DRAFT = "\u0000draft";
/** At most this many look-alikes show while typing. */
export const LIKELY_MAX = 3;

const isOpenIdea = (i: IdeaLike) => isOpenStatus(i.intake?.status ?? "new");

/**
 * The open ideas that look like `title`, most asked for first, at most
 * LIKELY_MAX: the Audience Wall's duplicate finder, with the typed title
 * ranked first so its group holds exactly the ideas close to it (the same
 * words, or most of their counted words in common). `exclude` leaves an
 * idea out (the one being checked).
 */
export function likelyDuplicates(
  title: string,
  ideas: readonly IdeaLike[],
  opts: { exclude?: string } = {}
): IdeaLike[] {
  if (!title.trim()) return [];
  const open = ideas.filter((i) => i.id !== opts.exclude && isOpenIdea(i));
  if (open.length === 0) return [];
  const groups = duplicateGroups([
    { id: DRAFT, text: title, votes: Number.MAX_SAFE_INTEGER },
    ...open.map((i) => ({ id: i.id, text: i.title, votes: i.intake?.demand ?? 1 })),
  ]);
  const mine = groups.find((g) => g.keep === DRAFT);
  if (!mine) return [];
  const byId = new Map(open.map((i) => [i.id, i]));
  return mine.merge.flatMap((id) => byId.get(id) ?? []).slice(0, LIKELY_MAX);
}

/** Open ideas that look alike, each group led by its most asked-for idea: "These look alike". */
export function possibleDuplicates(
  ideas: readonly IdeaLike[]
): { keep: IdeaLike; merge: IdeaLike[] }[] {
  const open = ideas.filter(isOpenIdea);
  const byId = new Map(open.map((i) => [i.id, i]));
  return duplicateGroups(
    open.map((i) => ({ id: i.id, text: i.title, votes: i.intake?.demand ?? 1 }))
  ).flatMap((g) => {
    const keep = byId.get(g.keep);
    const merge = g.merge.flatMap((id) => byId.get(id) ?? []);
    return keep && merge.length > 0 ? [{ keep, merge }] : [];
  });
}
