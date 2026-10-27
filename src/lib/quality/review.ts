/**
 * Code Review Metrics: how long pull requests wait for a first review and
 * take to merge, in the team's working hours, by PR size. One workspace
 * document (CODE_REVIEW_LOG_ID) that the page and tool.code_review_metrics.*
 * read through these functions, so a person and an agent quote the same
 * median.
 *
 * Pure and server-safe: no React, nothing from components (the agent's
 * server bundle imports it).
 *
 *   - Times are wall-clock "YYYY-MM-DDTHH:MM" (the page's datetime-local
 *     values), read as written, never through the host's time zone, so the
 *     browser and the server agree (lib/sprints/calendar parseWallClock). A
 *     zone suffix on a stored value is ignored.
 *   - Working hours count the team's working days (the ceremony cadence's
 *     weekdays, minus its holidays), clipped to the log's working window
 *     when one is set; whole working days otherwise. Elapsed hours count
 *     every hour.
 *   - The headline is a median (nearest rank, lib/sprints/metrics
 *     percentile through lib/flow/cycle cycleSummary, as Cycle Time and
 *     DORA use), quoted from MIN_SAMPLE.average PRs; P85 from
 *     MIN_SAMPLE.distribution. Below those it is null, never a mean.
 *   - The view is the team's, by PR size: no ranking of authors.
 *   - A row whose dates can't be read or merge before they open (possible
 *     before Phase 8) is "invalid": counted, never timed, never "open".
 */

import { nanoid } from "nanoid";
import type { CodeReviewWorkingWindow, PrSample } from "@/lib/stores/workspace-types";
import {
  DEFAULT_CALENDAR,
  isoDayNumber,
  parseClockTime,
  parseWallClock,
  workingHoursBetween,
  type WorkingCalendar,
  type WorkingWindowMinutes,
} from "@/lib/sprints/calendar";
import { cycleSummary, type CycleSummary } from "@/lib/flow/cycle";
import { percentile } from "@/lib/sprints/metrics";
import { enoughData, needMore } from "@/lib/analytics/min-sample";
import { bucketByPeriod } from "@/lib/analytics/periods";
import { headerKey, parseCsvRows, sniffDelimiter } from "@/lib/utils/csv";
import { parseNumber, type FormErrors } from "@/lib/utils/form";

/** The singleton document's id (the page and the agent's writes share it). */
export const CODE_REVIEW_LOG_ID = "codeReviewLog:current";
/** Its entity kind on the server (registerCollection("codeReviewLog", …)). */
export const CODE_REVIEW_LOG_KIND = "workspace:codeReviewLog";

export type SizeBandId = "small" | "medium" | "large";

/** PR size bands by lines changed: up to 100, 101–400, over 400. */
export const SIZE_BANDS: readonly { id: SizeBandId; label: string; maxLines: number }[] = [
  { id: "small", label: "Up to 100 lines", maxLines: 100 },
  { id: "medium", label: "101–400 lines", maxLines: 400 },
  { id: "large", label: "Over 400 lines", maxLines: Infinity },
];

/** Text bounds shared by the page, the import and the agent. */
export const REVIEW_AUTHOR_MAX = 200;
export const REVIEW_PR_NUMBER_MAX = 50;
export const REVIEW_DESCRIPTION_MAX = 2000;
/** At most this many rows are read from one CSV import. */
export const REVIEW_IMPORT_MAX = 1000;

const MINUTES_PER_DAY = 1440;
const pad2 = (n: number) => String(n).padStart(2, "0");

/** The size band of a PR, or null when its line count isn't a number of 0 or more. */
export function sizeBandOf(lines: number): SizeBandId | null {
  if (typeof lines !== "number" || !Number.isFinite(lines) || lines < 0) return null;
  return (SIZE_BANDS.find((b) => lines <= b.maxLines) ?? SIZE_BANDS[SIZE_BANDS.length - 1]).id;
}

/** An author as stored: trimmed, without the leading "@" people type. */
export function cleanAuthor(author: string): string {
  return author.trim().replace(/^@+/, "").trim();
}

/**
 * The log's working window as minutes of the day, or undefined for whole
 * working days (absent, or not a readable "HH:MM" pair with start first).
 */
export function windowMinutes(
  window: CodeReviewWorkingWindow | null | undefined
): WorkingWindowMinutes | undefined {
  if (!window) return undefined;
  const startMinute = parseClockTime(window.start);
  const endMinute = parseClockTime(window.end);
  if (startMinute === null || endMinute === null || endMinute <= startMinute) return undefined;
  return { startMinute, endMinute };
}

/** Why a working window can't be saved, or null: both "HH:MM", the end after the start. */
export function workingWindowError(start: string, end: string): string | null {
  const a = parseClockTime(start);
  const b = parseClockTime(end);
  if (a === null || b === null) return 'Enter both times as "HH:MM" (24-hour).';
  if (b <= a) return "The window must end after it starts.";
  return null;
}

/** A wall-clock value as minutes from day 0, for ordering; null when it isn't one. */
function wallMinutes(value: string | null | undefined): number | null {
  const w = parseWallClock(value);
  return w === null ? null : (isoDayNumber(w.day) as number) * MINUTES_PER_DAY + w.minute;
}

/** Every hour from `start` to `end`, read as wall-clock; null when either can't be read or end comes first. */
export function elapsedHours(start: string, end: string): number | null {
  const a = wallMinutes(start);
  const b = wallMinutes(end);
  return a === null || b === null || b < a ? null : (b - a) / 60;
}

const formatWallClock = (y: number, mo: number, d: number, h: number, mi: number) =>
  `${y}-${pad2(mo)}-${pad2(d)}T${pad2(h)}:${pad2(mi)}`;

/** `d` as the host's local wall-clock "YYYY-MM-DDTHH:MM" (the page's "now"). */
export function nowWallClock(d: Date = new Date()): string {
  return formatWallClock(
    d.getFullYear(),
    d.getMonth() + 1,
    d.getDate(),
    d.getHours(),
    d.getMinutes()
  );
}

/**
 * The latest wall-clock time anyone could be writing as "now": UTC + 14
 * hours, the furthest-ahead zone. An agent on the server doesn't know the
 * person's zone, so it refuses only what is in the future everywhere.
 */
export function latestWallClock(now: Date = new Date()): string {
  const d = new Date(now.getTime() + 14 * 3_600_000);
  return formatWallClock(
    d.getUTCFullYear(),
    d.getUTCMonth() + 1,
    d.getUTCDate(),
    d.getUTCHours(),
    d.getUTCMinutes()
  );
}

const ZONE_SUFFIX = /(?:Z|[+-]\d{2}(?::?\d{2})?)$/i;

/**
 * A date or time as the stored wall-clock "YYYY-MM-DDTHH:MM" (a bare date
 * is its midnight; seconds are dropped), or null when it can't be read.
 * With `localize`, a time carrying a zone ("…Z", "…+02:00") is converted
 * to the host's local time (the page's import, in the person's browser);
 * otherwise the zone is dropped and the written time kept (the agent's
 * server, which doesn't know the person's zone).
 */
export function toWallClock(
  value: string | null | undefined,
  { localize = false }: { localize?: boolean } = {}
): string | null {
  const v = typeof value === "string" ? value.trim() : "";
  const w = parseWallClock(v);
  if (w === null) return null;
  const hasTime = /^\d{4}-\d{2}-\d{2}[T ]\d{2}:\d{2}/.test(v);
  if (localize && hasTime && ZONE_SUFFIX.test(v)) {
    const d = new Date(v.replace(" ", "T"));
    if (Number.isFinite(d.getTime())) return nowWallClock(d);
  }
  return `${w.day}T${pad2(Math.floor(w.minute / 60))}:${pad2(w.minute % 60)}`;
}

export type ReviewStatus = "merged" | "open" | "invalid";

export interface ReviewTimes {
  /** "invalid": openedAt or mergedAt can't be read, or the merge comes before the open. */
  status: ReviewStatus;
  /** The first review can't be read or sits outside opened … merged: its times are left out. */
  reviewOutOfOrder: boolean;
  toFirstReviewH: number | null;
  toFirstReviewWorkingH: number | null;
  cycleH: number | null;
  cycleWorkingH: number | null;
}

/** One PR's times: elapsed and working hours to its first review and to its merge. */
export function reviewTimes(
  s: PrSample,
  calendar: WorkingCalendar = DEFAULT_CALENDAR,
  window?: WorkingWindowMinutes
): ReviewTimes {
  const opened = wallMinutes(s.openedAt);
  const hasMerge = typeof s.mergedAt === "string" && s.mergedAt.trim() !== "";
  const merged = hasMerge ? wallMinutes(s.mergedAt) : null;
  const status: ReviewStatus =
    opened === null || (hasMerge && (merged === null || merged < opened))
      ? "invalid"
      : hasMerge
        ? "merged"
        : "open";
  const none = {
    toFirstReviewH: null,
    toFirstReviewWorkingH: null,
    cycleH: null,
    cycleWorkingH: null,
  };
  if (status === "invalid") return { status, reviewOutOfOrder: false, ...none };
  const hasReview = typeof s.firstReviewAt === "string" && s.firstReviewAt.trim() !== "";
  const review = hasReview ? wallMinutes(s.firstReviewAt) : null;
  const reviewOutOfOrder =
    hasReview &&
    (review === null || review < (opened as number) || (merged !== null && review > merged));
  const reviewOk = hasReview && !reviewOutOfOrder;
  return {
    status,
    reviewOutOfOrder,
    toFirstReviewH: reviewOk ? elapsedHours(s.openedAt, s.firstReviewAt as string) : null,
    toFirstReviewWorkingH: reviewOk
      ? workingHoursBetween(s.openedAt, s.firstReviewAt as string, calendar, window)
      : null,
    cycleH: status === "merged" ? elapsedHours(s.openedAt, s.mergedAt as string) : null,
    cycleWorkingH:
      status === "merged"
        ? workingHoursBetween(s.openedAt, s.mergedAt as string, calendar, window)
        : null,
  };
}

/** A median or P85 worth quoting: null below MIN_SAMPLE.average (median) or .distribution (P85). */
const quoted = (value: number | null, n: number, kind: "average" | "distribution") =>
  enoughData(n, kind) ? value : null;

const finite = (xs: readonly (number | null)[]) =>
  xs.filter((x): x is number => typeof x === "number" && Number.isFinite(x));

export interface ReviewBand {
  band: SizeBandId;
  label: string;
  /** Valid PRs in the band (merged or open). */
  n: number;
  merged: number;
  /** Medians, each from MIN_SAMPLE.average values (else null). */
  medianCycleWorkingH: number | null;
  medianFirstReviewWorkingH: number | null;
  medianComments: number | null;
}

export interface ReviewSummary {
  /** total = merged + open + invalid. */
  total: number;
  merged: number;
  open: number;
  invalid: number;
  /** Open PRs with no first review recorded. */
  awaitingReview: number;
  /** Working hours, opened → merged, over merged PRs (unquoted: gate with `headline`). */
  cycle: CycleSummary;
  /** Elapsed hours, opened → merged. */
  cycleElapsed: CycleSummary;
  /** Working hours, opened → first review, over PRs with one recorded. */
  firstReview: CycleSummary;
  firstReviewElapsed: CycleSummary;
  /** The quoted numbers: medians from MIN_SAMPLE.average PRs, P85 from .distribution; else null. */
  headline: {
    medianCycleWorkingH: number | null;
    medianFirstReviewWorkingH: number | null;
    medianCycleH: number | null;
    medianFirstReviewH: number | null;
    p85CycleWorkingH: number | null;
    p85FirstReviewWorkingH: number | null;
  };
  bySize: ReviewBand[];
  /** Large PRs (over 400 lines) merged with no review comment. */
  largeNoComments: number;
  /**
   * Median working cycle per ISO week of the merge, oldest first, quiet
   * weeks with n 0. Each median is quoted from MIN_SAMPLE.average merges
   * in its week, as the headline and the bands are; a thinner week is a
   * gap (null) with its n, never one PR's time read as the week's median.
   */
  weekly: { week: string; n: number; medianCycleWorkingH: number | null }[];
}

/** Everything the page's KPIs, the team view and the agent's list_state report. */
export function reviewSummary(
  samples: readonly PrSample[],
  calendar: WorkingCalendar = DEFAULT_CALENDAR,
  window?: WorkingWindowMinutes
): ReviewSummary {
  const rows = samples.map((s) => ({ s, t: reviewTimes(s, calendar, window) }));
  const valid = rows.filter((r) => r.t.status !== "invalid");
  const merged = rows.filter((r) => r.t.status === "merged");
  const cycle = cycleSummary(finite(merged.map((r) => r.t.cycleWorkingH)));
  const cycleElapsed = cycleSummary(finite(merged.map((r) => r.t.cycleH)));
  const firstReview = cycleSummary(finite(valid.map((r) => r.t.toFirstReviewWorkingH)));
  const firstReviewElapsed = cycleSummary(finite(valid.map((r) => r.t.toFirstReviewH)));
  const bySize = SIZE_BANDS.map((b): ReviewBand => {
    const inBand = valid.filter((r) => sizeBandOf(r.s.linesChanged) === b.id);
    const cycles = finite(inBand.map((r) => r.t.cycleWorkingH));
    const reviews = finite(inBand.map((r) => r.t.toFirstReviewWorkingH));
    const comments = finite(inBand.map((r) => r.s.commentCount));
    return {
      band: b.id,
      label: b.label,
      n: inBand.length,
      merged: inBand.filter((r) => r.t.status === "merged").length,
      medianCycleWorkingH: quoted(percentile(cycles, 50), cycles.length, "average"),
      medianFirstReviewWorkingH: quoted(percentile(reviews, 50), reviews.length, "average"),
      medianComments: quoted(percentile(comments, 50), comments.length, "average"),
    };
  });
  return {
    total: rows.length,
    merged: merged.length,
    open: rows.filter((r) => r.t.status === "open").length,
    invalid: rows.length - valid.length,
    awaitingReview: valid.filter((r) => r.t.status === "open" && !(r.s.firstReviewAt ?? "").trim())
      .length,
    cycle,
    cycleElapsed,
    firstReview,
    firstReviewElapsed,
    headline: {
      medianCycleWorkingH: quoted(cycle.median, cycle.count, "average"),
      medianFirstReviewWorkingH: quoted(firstReview.median, firstReview.count, "average"),
      medianCycleH: quoted(cycleElapsed.median, cycleElapsed.count, "average"),
      medianFirstReviewH: quoted(firstReviewElapsed.median, firstReviewElapsed.count, "average"),
      p85CycleWorkingH: quoted(cycle.p85, cycle.count, "distribution"),
      p85FirstReviewWorkingH: quoted(firstReview.p85, firstReview.count, "distribution"),
    },
    bySize,
    largeNoComments: merged.filter(
      (r) => sizeBandOf(r.s.linesChanged) === "large" && r.s.commentCount === 0
    ).length,
    weekly: bucketByPeriod(merged, (r) => r.s.mergedAt, "week").map((b) => {
      const xs = finite(b.items.map((r) => r.t.cycleWorkingH));
      return {
        week: b.period,
        n: b.items.length,
        medianCycleWorkingH: quoted(percentile(xs, 50), xs.length, "average"),
      };
    }),
  };
}

const DAY_SHORT = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];
/** Weekdays in the order people read a week: Monday first. */
const WEEK_ORDER = [1, 2, 3, 4, 5, 6, 0];

/**
 * What "working hours" counts, to show next to the KPI: "Mon–Fri, holidays
 * excluded, 09:00–17:00", or "…, whole days" without a window.
 */
export function workingBasisLabel(
  calendar: WorkingCalendar = DEFAULT_CALENDAR,
  window?: CodeReviewWorkingWindow | null
): string {
  const days = new Set(calendar.workingDays);
  const runs: number[][] = [];
  for (const d of WEEK_ORDER) {
    if (!days.has(d)) continue;
    const last = runs[runs.length - 1];
    const prev = last?.[last.length - 1];
    if (last && prev !== undefined && WEEK_ORDER.indexOf(prev) === WEEK_ORDER.indexOf(d) - 1) {
      last.push(d);
    } else runs.push([d]);
  }
  const dayText = runs
    .map((r) =>
      r.length >= 3
        ? `${DAY_SHORT[r[0]]}–${DAY_SHORT[r[r.length - 1]]}`
        : r.map((d) => DAY_SHORT[d]).join(", ")
    )
    .join(", ");
  const parts = [dayText];
  if (calendar.holidays.length > 0) parts.push("holidays excluded");
  const w = windowMinutes(window);
  parts.push(w && window ? `${window.start}–${window.end}` : "whole days");
  return parts.join(", ");
}

/** Hours with one decimal at most ("3.5", "9"). */
export const formatReviewHours = (h: number) => String(Math.round(h * 10) / 10);

/**
 * The verdict, e.g. "Half of pull requests get a first review within 3.5
 * working hours and merge within 9; large ones take 3× longer to merge."
 */
export function reviewVerdict(summary: ReviewSummary): string {
  const { medianCycleWorkingH: cycle, medianFirstReviewWorkingH: review } = summary.headline;
  if (summary.total === 0) return "No pull requests logged yet.";
  if (cycle === null && review === null) {
    const more = needMore(summary.merged, "average");
    return `Log ${more} more merged pull request${more === 1 ? "" : "s"} to see the typical review time.`;
  }
  const head =
    review !== null && cycle !== null
      ? `Half of pull requests get a first review within ${formatReviewHours(review)} working hours and merge within ${formatReviewHours(cycle)}`
      : review !== null
        ? `Half of pull requests get a first review within ${formatReviewHours(review)} working hours`
        : `Half of pull requests merge within ${formatReviewHours(cycle as number)} working hours`;
  const small = summary.bySize.find((b) => b.band === "small")?.medianCycleWorkingH ?? null;
  const large = summary.bySize.find((b) => b.band === "large")?.medianCycleWorkingH ?? null;
  const ratio = small !== null && large !== null && small > 0 ? large / small : null;
  const tail =
    ratio !== null && ratio >= 1.5
      ? `; large ones take ${formatReviewHours(ratio)}× longer to merge than small ones`
      : "";
  return `${head}${tail}.`;
}

/* ── Drafts ────────────────────────────────────────────────────────────── */

export type SampleField =
  | "author"
  | "prNumber"
  | "openedAt"
  | "firstReviewAt"
  | "mergedAt"
  | "reviewerCount"
  | "commentCount"
  | "linesChanged"
  | "description";

/** The fields in the form's order: the order errors are listed in. */
export const SAMPLE_FIELDS: readonly SampleField[] = [
  "prNumber",
  "author",
  "openedAt",
  "firstReviewAt",
  "mergedAt",
  "reviewerCount",
  "commentCount",
  "linesChanged",
  "description",
];

/** A draft's errors as one line naming each field ("openedAt: …"), for an agent or an import row. */
export function sampleErrorMessage(errors: FormErrors<SampleField>): string {
  return SAMPLE_FIELDS.filter((f) => errors[f])
    .map((f) => `${f}: ${errors[f]}`)
    .join(" ");
}

export interface SampleDraft {
  author?: string | null;
  prNumber?: string | null;
  openedAt?: string | null;
  firstReviewAt?: string | null;
  mergedAt?: string | null;
  reviewerCount?: string | number | null;
  commentCount?: string | number | null;
  linesChanged?: string | number | null;
  description?: string | null;
}

const COUNT_FIELDS = [
  ["reviewerCount", "Enter the number of reviewers."],
  ["commentCount", "Enter the number of review comments."],
  ["linesChanged", "Enter the lines changed."],
] as const;

/**
 * Why a PR draft can't be saved, the one rule for the page's form, its
 * import and the agent: an author; an openedAt; firstReviewAt and mergedAt
 * optional, in the order opened ≤ first review ≤ merged, none after `now`
 * (a wall-clock "YYYY-MM-DDTHH:MM"); whole counts of 0 or more.
 */
export function sampleErrors(draft: SampleDraft, now: string): FormErrors<SampleField> {
  const errors: FormErrors<SampleField> = {};
  const author = cleanAuthor(draft.author ?? "");
  if (!author) errors.author = "Enter who opened the pull request.";
  else if (author.length > REVIEW_AUTHOR_MAX) {
    errors.author = `Keep the author to ${REVIEW_AUTHOR_MAX} characters.`;
  }
  if ((draft.prNumber ?? "").trim().length > REVIEW_PR_NUMBER_MAX) {
    errors.prNumber = `Keep the PR number to ${REVIEW_PR_NUMBER_MAX} characters.`;
  }
  if ((draft.description ?? "").trim().length > REVIEW_DESCRIPTION_MAX) {
    errors.description = `Keep the description to ${REVIEW_DESCRIPTION_MAX} characters.`;
  }
  const latest = wallMinutes(now);
  const time = (field: "openedAt" | "firstReviewAt" | "mergedAt", required: string | null) => {
    const raw = (draft[field] ?? "").trim();
    if (!raw) {
      if (required) errors[field] = required;
      return null;
    }
    const m = wallMinutes(raw);
    if (m === null) {
      errors[field] = "Enter a date and time as YYYY-MM-DDTHH:MM.";
      return null;
    }
    if (latest !== null && m > latest) {
      errors[field] = "That's in the future.";
      return null;
    }
    return m;
  };
  const opened = time("openedAt", "Enter when it was opened.");
  const review = time("firstReviewAt", null);
  const merged = time("mergedAt", null);
  if (opened !== null && merged !== null && merged < opened) {
    errors.mergedAt = "It can't be merged before it was opened.";
  }
  if (review !== null) {
    if (opened !== null && review < opened) {
      errors.firstReviewAt = "The first review can't come before it was opened.";
    } else if (merged !== null && review > merged) {
      errors.firstReviewAt = "The first review can't come after the merge.";
    }
  }
  for (const [field, blank] of COUNT_FIELDS) {
    const n = parseNumber(draft[field] ?? undefined);
    if (n === undefined) errors[field] = blank;
    else if (!Number.isInteger(n) || n < 0) errors[field] = "Enter a whole number of 0 or more.";
  }
  return errors;
}

/**
 * A checked draft as the sample to store: the author without "@", times as
 * wall-clock (`localize` as toWallClock), blank optional fields left out.
 * Call it only once sampleErrors found nothing.
 */
export function sampleFromDraft(
  draft: SampleDraft,
  id: string,
  { localize = false }: { localize?: boolean } = {}
): PrSample {
  const opt = (v: string | null | undefined) => {
    const t = (v ?? "").trim();
    return t ? t : undefined;
  };
  const firstReviewAt = toWallClock(opt(draft.firstReviewAt), { localize }) ?? undefined;
  const mergedAt = toWallClock(opt(draft.mergedAt), { localize }) ?? undefined;
  const prNumber = opt(draft.prNumber);
  const description = opt(draft.description);
  return {
    id,
    author: cleanAuthor(draft.author ?? ""),
    openedAt: toWallClock(draft.openedAt, { localize }) as string,
    reviewerCount: Number(parseNumber(draft.reviewerCount ?? undefined)),
    commentCount: Number(parseNumber(draft.commentCount ?? undefined)),
    linesChanged: Number(parseNumber(draft.linesChanged ?? undefined)),
    ...(prNumber ? { prNumber } : {}),
    ...(firstReviewAt ? { firstReviewAt } : {}),
    ...(mergedAt ? { mergedAt } : {}),
    ...(description ? { description } : {}),
  };
}

/** A new sample's id. */
export function newSampleId(): string {
  return `pr_${nanoid(8)}`;
}

/* ── CSV import ────────────────────────────────────────────────────────── */

/** The columns an import reads, by headerKey; the first name of each is the documented one. */
const CSV_COLUMNS: Record<SampleField, readonly string[]> = {
  prNumber: ["prnumber", "pr", "number"],
  author: ["author"],
  openedAt: ["openedat", "opened"],
  firstReviewAt: ["firstreviewat", "firstreview"],
  mergedAt: ["mergedat", "merged"],
  reviewerCount: ["reviewercount", "reviewers"],
  commentCount: ["commentcount", "comments"],
  linesChanged: ["lineschanged", "lines"],
  description: ["description"],
};

const REQUIRED_COLUMNS: readonly SampleField[] = [
  "author",
  "openedAt",
  "reviewerCount",
  "commentCount",
  "linesChanged",
];

/** A headerless file's columns, in the order the old page documented (first review last). */
const POSITIONAL: readonly SampleField[] = [
  "prNumber",
  "author",
  "openedAt",
  "mergedAt",
  "reviewerCount",
  "commentCount",
  "linesChanged",
  "description",
  "firstReviewAt",
];

export interface ReviewCsvResult {
  /** The rows that passed, ready to store. */
  samples: PrSample[];
  /** One per row that didn't (by its line in the file), or for the file as a whole (row 0 / the header's line). */
  errors: { row: number; message: string }[];
  /** Rows skipped because their PR number is logged already or came earlier in the file. */
  duplicates: { row: number; prNumber: string }[];
  /** Data rows past REVIEW_IMPORT_MAX that weren't read. */
  notRead: number;
}

/**
 * Pull requests from a pasted or uploaded CSV (comma, tab or semicolon).
 * With a header row the columns go by name (any order; "Opened at",
 * "opened_at" and "openedAt" all match); without one, by position. A row
 * is imported only when it passes sampleErrors: a blank number is an
 * error, never 0, and dates must read and be in order. Options: `existing`
 * samples whose PR numbers are skipped as duplicates, `now` (wall-clock)
 * to refuse future times, `localize` zone-suffixed times (true in the
 * browser), `newId` for the ids.
 */
export function parseReviewCsv(
  csv: string,
  {
    existing = [],
    now,
    localize = false,
    newId = newSampleId,
  }: {
    existing?: readonly PrSample[];
    now?: string;
    localize?: boolean;
    newId?: () => string;
  } = {}
): ReviewCsvResult {
  const result: ReviewCsvResult = { samples: [], errors: [], duplicates: [], notRead: 0 };
  const rows = parseCsvRows(csv ?? "", sniffDelimiter(csv ?? ""));
  if (rows.length === 0) return result;
  const keys = rows[0].cells.map(headerKey);
  const hasHeader = keys.includes("author") || keys.includes("openedat") || keys.includes("opened");
  const index: Partial<Record<SampleField, number>> = {};
  if (hasHeader) {
    for (const field of Object.keys(CSV_COLUMNS) as SampleField[]) {
      const k = keys.findIndex((key) => CSV_COLUMNS[field].includes(key));
      if (k >= 0) index[field] = k;
    }
    const missing = REQUIRED_COLUMNS.filter((f) => index[f] === undefined);
    if (missing.length > 0) {
      result.errors.push({
        row: rows[0].line,
        message: `The header has no ${missing.join(", ")} column${missing.length === 1 ? "" : "s"}.`,
      });
      return result;
    }
  } else {
    POSITIONAL.forEach((f, k) => (index[f] = k));
  }
  const body = hasHeader ? rows.slice(1) : rows;
  result.notRead = Math.max(0, body.length - REVIEW_IMPORT_MAX);
  const seen = new Set(existing.map((s) => (s.prNumber ?? "").trim()).filter((n) => n !== ""));
  // Far in the future by default, so nothing is refused for being after "now".
  const latest = now ?? "9999-12-31T23:59";
  for (const row of body.slice(0, REVIEW_IMPORT_MAX)) {
    if (!hasHeader && row.cells.length < 7) {
      result.errors.push({
        row: row.line,
        message:
          "Expected at least 7 columns: prNumber, author, openedAt, mergedAt, reviewerCount, commentCount, linesChanged.",
      });
      continue;
    }
    const cell = (f: SampleField) => {
      const k = index[f];
      return k === undefined ? "" : (row.cells[k] ?? "").trim();
    };
    // Times are localised before they are checked, so the order is judged
    // on the values stored; one that can't be read stays as typed for its error.
    const time = (f: "openedAt" | "firstReviewAt" | "mergedAt") => {
      const raw = cell(f);
      return raw && localize ? (toWallClock(raw, { localize }) ?? raw) : raw;
    };
    const draft: SampleDraft = {
      prNumber: cell("prNumber"),
      author: cell("author"),
      openedAt: time("openedAt"),
      firstReviewAt: time("firstReviewAt"),
      mergedAt: time("mergedAt"),
      reviewerCount: cell("reviewerCount"),
      commentCount: cell("commentCount"),
      linesChanged: cell("linesChanged"),
      description: cell("description"),
    };
    const message = sampleErrorMessage(sampleErrors(draft, latest));
    if (message) {
      result.errors.push({ row: row.line, message });
      continue;
    }
    const prNumber = (draft.prNumber ?? "").trim();
    if (prNumber && seen.has(prNumber)) {
      result.duplicates.push({ row: row.line, prNumber });
      continue;
    }
    if (prNumber) seen.add(prNumber);
    // Already localised above: the zone is gone, so this keeps the times.
    result.samples.push(sampleFromDraft(draft, newId()));
  }
  return result;
}
