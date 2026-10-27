/**
 * The Flaky Test Scoreboard: tests that pass and fail on the same code,
 * how often they fail, and how long they have sat in quarantine. One
 * workspace document (FLAKY_BOARD_ID) that the page and tool.flaky_tests.*
 * read through these functions, so a person and an agent get the same rate,
 * the same worst offenders and the same quarantine ages.
 *
 * Pure and server-safe: no React, nothing from components (the agent's
 * server bundle imports it).
 *
 *   - A test's rate is failures ÷ runs. Rows from before Phase 8 hold only
 *     a rate (`failureRate`); they keep it, are ranked by it, and are left
 *     out of the weighted rate (Σ failures ÷ Σ runs), which counts them
 *     instead ("2 tests without run counts"), since a bare rate has no
 *     weight to add.
 *   - Fixed tests are out of every rate and ranking: they no longer flake.
 *   - Quarantine age is whole days since `quarantinedAt`, stamped when a
 *     test goes into quarantine. A legacy quarantined row without one reads
 *     "date unknown" and never raises the alert. A day one ahead of the
 *     reader's (an agent's stamp on a server whose day is ahead of the
 *     person's) reads as today, and a status change stamps that day rather
 *     than one before it (flakyStampDay).
 *   - `fixedAt` is the day of the latest fix: stamped each time a test
 *     becomes fixed, kept when it is reopened (the audit trail).
 */

import type { FlakyStatus, FlakyTest } from "@/lib/stores/workspace-types";
import { isIsoDate, isoDayNumber } from "@/lib/sprints/calendar";
import { bucketByPeriod, periodOf } from "@/lib/analytics/periods";
import { parseNumber, type FormErrors } from "@/lib/utils/form";

/** The singleton document's id (the page and the agent's writes share it). */
export const FLAKY_BOARD_ID = "flakyTestBoard:current";
/** Its entity kind on the server (registerCollection("flakyTestBoard", …)). */
export const FLAKY_BOARD_KIND = "workspace:flakyTestBoard";

export const FLAKY_STATUSES: readonly FlakyStatus[] = ["active", "quarantined", "fixed"];

export const FLAKY_STATUS_LABEL: Record<FlakyStatus, string> = {
  active: "Active",
  quarantined: "Quarantined",
  fixed: "Fixed",
};

/** Above this failure rate a test is a high-rate offender (the page's danger tone). */
export const FLAKY_HIGH_RATE = 0.2;

/** A test quarantined this many days or more raises the "quarantined N days" alert (two weeks). */
export const QUARANTINE_ALERT_DAYS = 14;

/** Below this many runs a rate carries a "few runs" note: one more failure moves it a lot. */
export const FEW_RUNS = 10;

/** Text bounds shared by the page and the agent (the larger of the old two, so nothing saved before is refused). */
export const FLAKY_NAME_MAX = 300;
export const FLAKY_SUITE_MAX = 200;
export const FLAKY_OWNER_MAX = 200;
export const FLAKY_DESCRIPTION_MAX = 4000;

const isWhole = (v: unknown, min: number): v is number =>
  typeof v === "number" && Number.isInteger(v) && v >= min;

/** Whether the test carries usable run counts: whole failures ≥ 0, runs ≥ 1, failures ≤ runs. */
export function hasRunCounts(t: FlakyTest): t is FlakyTest & { failures: number; runs: number } {
  return isWhole(t.failures, 0) && isWhole(t.runs, 1) && t.failures <= t.runs;
}

/** failures ÷ runs, else the legacy stored rate (0..1), else null when neither can be read. */
export function flakyRate(t: FlakyTest): number | null {
  if (hasRunCounts(t)) return t.failures / t.runs;
  const r = t.failureRate;
  return typeof r === "number" && Number.isFinite(r) && r >= 0 && r <= 1 ? r : null;
}

/** Whether the rate rests on fewer than FEW_RUNS runs (shown with a note, never hidden). */
export function fewRuns(t: FlakyTest): boolean {
  return hasRunCounts(t) && t.runs < FEW_RUNS;
}

/** The test with its run counts set and `failureRate` kept equal to failures ÷ runs. */
export function withRunCounts(t: FlakyTest, failures: number, runs: number): FlakyTest {
  return { ...t, failures, runs, failureRate: failures / runs };
}

const open = (tests: readonly FlakyTest[]) => tests.filter((t) => t.status !== "fixed");

export interface WeightedFailureRate {
  /** Σ failures ÷ Σ runs over the open tests with run counts; null without any. */
  rate: number | null;
  failures: number;
  runs: number;
  /** Open tests counted in the rate. */
  counted: number;
  /** Open tests with only a legacy rate: left out of the rate, counted here. */
  rateOnly: number;
}

/** The failure rate of the open (not fixed) tests, weighted by their runs. */
export function weightedFailureRate(tests: readonly FlakyTest[]): WeightedFailureRate {
  let failures = 0;
  let runs = 0;
  let counted = 0;
  let rateOnly = 0;
  for (const t of open(tests)) {
    if (hasRunCounts(t)) {
      failures += t.failures;
      runs += t.runs;
      counted += 1;
    } else {
      rateOnly += 1;
    }
  }
  return { rate: runs > 0 ? failures / runs : null, failures, runs, counted, rateOnly };
}

/**
 * The plain mean of the open tests' rates, legacy rows included; null
 * without any. Kept for readers from before the weighted rate (the agent's
 * avgFailureRate); a 1-of-2 test counts as much as a 30-of-200 one here.
 */
export function meanFailureRate(tests: readonly FlakyTest[]): number | null {
  const rates = open(tests)
    .map(flakyRate)
    .filter((r): r is number => r !== null);
  return rates.length ? rates.reduce((a, b) => a + b, 0) / rates.length : null;
}

/**
 * How many days a stored day may run ahead of the reader's today and still
 * read as today: one. An agent's day over MCP is the server's (UTC on a
 * typical deploy), which is already tomorrow for a person west of UTC in
 * their evening, so a test the agent logged or quarantined "today" can
 * carry the person's tomorrow; and the agent takes the day after the
 * server's for a person ahead of UTC. A day further ahead is never today.
 */
const DAY_AHEAD = 1;

const isDay = (v: unknown): v is string =>
  typeof v === "string" && /^\d{4}-\d{2}-\d{2}$/.test(v) && isIsoDate(v);

/**
 * Whole days a quarantined test has been in quarantine on `today` (local
 * "YYYY-MM-DD"); 0 on the day it went in, and on the day before it (a
 * quarantine stamped on a clock a day ahead, DAY_AHEAD). Null when it
 * isn't quarantined, has no readable quarantinedAt (a legacy row: "date
 * unknown"), or the date is more than a day after today.
 */
export function quarantinedDays(t: FlakyTest, today: string): number | null {
  if (t.status !== "quarantined" || !isIsoDate(t.quarantinedAt)) return null;
  const from = isoDayNumber(t.quarantinedAt);
  const to = isoDayNumber(today);
  if (from === null || to === null || from - to > DAY_AHEAD) return null;
  return Math.max(0, to - from);
}

/** The tests quarantined `days` days or more, longest first. */
export function longQuarantined(
  tests: readonly FlakyTest[],
  today: string,
  days: number = QUARANTINE_ALERT_DAYS
): { id: string; name: string; days: number }[] {
  const out: { id: string; name: string; days: number }[] = [];
  for (const t of tests) {
    const d = quarantinedDays(t, today);
    if (d !== null && d >= days) out.push({ id: t.id, name: t.name, days: d });
  }
  return out.sort((a, b) => b.days - a.days || a.name.localeCompare(b.name));
}

/**
 * The day a status change on `today` is stamped with: today, or the latest
 * day the test already carries (first seen, quarantined, fixed) when that
 * is after today by a day at most (DAY_AHEAD: a day an agent stamped on a
 * server ahead of the person's clock), so a quarantine or a fix never reads
 * as before the test was first seen. The page, add_test and set_status
 * stamp by it.
 */
export function flakyStampDay(
  t: Pick<FlakyTest, "firstSeenAt" | "quarantinedAt" | "fixedAt">,
  today: string
): string {
  const to = isoDayNumber(today);
  let day = today;
  for (const v of [t.firstSeenAt, t.quarantinedAt, t.fixedAt]) {
    if (!isDay(v) || v <= day || to === null) continue;
    const from = isoDayNumber(v);
    if (from !== null && from - to <= DAY_AHEAD) day = v;
  }
  return day;
}

/**
 * The test with its status changed on `today`, the one rule for the page and
 * the agent. Entering quarantine stamps quarantinedAt (a fresh quarantine
 * restarts the count); leaving it clears it. Becoming fixed stamps fixedAt,
 * the latest fix; reopening keeps it. The stamp is today, or the test's own
 * day when that is a day ahead (flakyStampDay). The same status again
 * changes nothing.
 */
export function applyFlakyStatus(t: FlakyTest, status: FlakyStatus, today: string): FlakyTest {
  if (t.status === status) return t;
  const day = flakyStampDay(t, today);
  const next: FlakyTest = { ...t, status };
  if (status === "quarantined") next.quarantinedAt = day;
  else delete next.quarantinedAt;
  if (status === "fixed") next.fixedAt = day;
  return next;
}

/** Whether a fixed test was fixed in the quarter `today` falls in. */
export function fixedInQuarter(t: FlakyTest, today: string): boolean {
  if (t.status !== "fixed") return false;
  const q = periodOf(t.fixedAt, "quarter");
  return q !== null && q === periodOf(today, "quarter");
}

/** New flaky tests per ISO week of firstSeenAt, oldest first, quiet weeks as 0. */
export function weeklyNewFlakies(tests: readonly FlakyTest[]): { week: string; count: number }[] {
  return bucketByPeriod(tests, (t) => t.firstSeenAt, "week").map((b) => ({
    week: b.period,
    count: b.items.length,
  }));
}

export interface FlakyOffender {
  id: string;
  name: string;
  status: FlakyStatus;
  /** The rate it is ranked by (flakyRate). */
  failureRate: number;
  failures: number | null;
  runs: number | null;
  fewRuns: boolean;
}

/**
 * The open tests with the highest rate, `limit` of them. A tie goes to the
 * one with more runs (more evidence), then by name.
 */
export function worstOffenders(tests: readonly FlakyTest[], limit = 5): FlakyOffender[] {
  return open(tests)
    .map((t) => ({ t, rate: flakyRate(t) }))
    .filter((x): x is { t: FlakyTest; rate: number } => x.rate !== null)
    .sort(
      (a, b) =>
        b.rate - a.rate ||
        (hasRunCounts(b.t) ? b.t.runs : 0) - (hasRunCounts(a.t) ? a.t.runs : 0) ||
        a.t.name.localeCompare(b.t.name)
    )
    .slice(0, Math.max(0, limit))
    .map(({ t, rate }) => ({
      id: t.id,
      name: t.name,
      status: t.status,
      failureRate: rate,
      failures: hasRunCounts(t) ? t.failures : null,
      runs: hasRunCounts(t) ? t.runs : null,
      fewRuns: fewRuns(t),
    }));
}

export interface FlakySummary {
  total: number;
  byStatus: Record<FlakyStatus, number>;
  fixedThisQuarter: number;
  weighted: WeightedFailureRate;
  /** The plain mean of the open tests' rates (see meanFailureRate). */
  meanRate: number | null;
  /** Open tests above FLAKY_HIGH_RATE. */
  highRate: number;
  /** Open tests whose rate rests on fewer than FEW_RUNS runs. */
  fewRuns: number;
  /** Quarantined QUARANTINE_ALERT_DAYS or more, longest first. */
  longQuarantined: { id: string; name: string; days: number }[];
  /**
   * Quarantined rows whose quarantine age can't be read, so they say "date
   * unknown" (quarantinedDays is null): no date (from before Phase 8), or
   * one more than a day after today.
   */
  quarantineDateUnknown: number;
  worstOffenders: FlakyOffender[];
}

/** Everything the page's KPIs and the agent's list_state report, on `today`. */
export function flakySummary(tests: readonly FlakyTest[], today: string): FlakySummary {
  const byStatus: Record<FlakyStatus, number> = { active: 0, quarantined: 0, fixed: 0 };
  let fixedThisQuarter = 0;
  let quarantineDateUnknown = 0;
  for (const t of tests) {
    if (t.status in byStatus) byStatus[t.status] += 1;
    if (fixedInQuarter(t, today)) fixedThisQuarter += 1;
    if (t.status === "quarantined" && quarantinedDays(t, today) === null) {
      quarantineDateUnknown += 1;
    }
  }
  const openTests = open(tests);
  return {
    total: tests.length,
    byStatus,
    fixedThisQuarter,
    weighted: weightedFailureRate(tests),
    meanRate: meanFailureRate(tests),
    highRate: openTests.filter((t) => (flakyRate(t) ?? 0) > FLAKY_HIGH_RATE).length,
    fewRuns: openTests.filter(fewRuns).length,
    longQuarantined: longQuarantined(tests, today),
    quarantineDateUnknown,
    worstOffenders: worstOffenders(tests),
  };
}

const plural = (n: number, one: string, many = `${one}s`) => `${n} ${n === 1 ? one : many}`;
const thousands = (n: number) => String(n).replace(/\B(?=(\d{3})+(?!\d))/g, ",");
/** A rate as a percent with one decimal, without a trailing ".0". */
export const ratePercent = (rate: number) => `${(rate * 100).toFixed(1).replace(/\.0$/, "")}%`;

/**
 * The verdict, e.g. "5 open flaky tests fail 7.4% of 1,240 runs (2 more
 * tests without run counts); 2 have been quarantined 14 days or more."
 * The rate names only the tests it is worked out from (weighted.counted);
 * the open rate-only rows are named beside it, never folded into it.
 */
export function flakyVerdict(summary: FlakySummary): string {
  if (summary.total === 0) return "No flaky tests logged yet.";
  const openCount = summary.byStatus.active + summary.byStatus.quarantined;
  if (openCount === 0) {
    return `No flaky tests open: ${summary.total === 1 ? "the one logged is" : `all ${summary.total} are`} fixed.`;
  }
  const { rate, runs, counted, rateOnly } = summary.weighted;
  const uncounted = rateOnly > 0 ? ` (${plural(rateOnly, "more test")} without run counts)` : "";
  const head =
    rate === null
      ? `${plural(openCount, "open flaky test")}, none with run counts yet`
      : `${plural(counted, "open flaky test")} ${counted === 1 ? "fails" : "fail"} ${ratePercent(rate)} of ${thousands(runs)} runs${uncounted}`;
  const long = summary.longQuarantined.length;
  const tail =
    long === 0
      ? ""
      : `; ${long === 1 ? "1 has" : `${long} have`} been quarantined ${QUARANTINE_ALERT_DAYS} days or more`;
  return `${head}${tail}.`;
}

/* ── Drafts ────────────────────────────────────────────────────────────── */

export type FlakyField = "name" | "failures" | "runs" | "firstSeenAt";

/**
 * Why a draft day can't be saved, or null: not a date, or after `today`
 * (the latest day allowed: the page's today; the agent on the server
 * passes the day after its own, which can be behind the person's).
 * Blank is fine here (the caller decides what blank means).
 */
export function flakyDayError(day: string | null | undefined, today: string): string | null {
  const d = typeof day === "string" ? day.trim() : "";
  if (!d) return null;
  if (!/^\d{4}-\d{2}-\d{2}$/.test(d) || !isIsoDate(d)) return "Enter a date as YYYY-MM-DD.";
  if (d > today) return "The day can't be after today.";
  return null;
}

/**
 * Why `firstSeenAt` can't go with the days a test already carries, or
 * null: a test can't be first seen after it went into quarantine or was
 * fixed (a fixedAt kept from before a reopen included). The other side of
 * the order add_test checks on a new test's status day.
 */
export function firstSeenOrderError(
  firstSeenAt: string,
  t: { quarantinedAt?: string | null; fixedAt?: string | null }
): string | null {
  const day = firstSeenAt.trim();
  if (isIsoDate(t.quarantinedAt) && day > (t.quarantinedAt as string)) {
    return `It can't come after the day it went into quarantine (${t.quarantinedAt}).`;
  }
  if (isIsoDate(t.fixedAt) && day > (t.fixedAt as string)) {
    return `It can't come after the day it was fixed (${t.fixedAt}).`;
  }
  return null;
}

/**
 * Why a test's draft can't be saved: a name, whole failures (0 or more) and
 * runs (1 or more) with no more failures than runs, and a first-seen day
 * that isn't after `today` (blank is allowed: the caller fills it in) nor
 * after the edited test's quarantinedAt or fixedAt, when the draft carries
 * them (firstSeenOrderError). With `allowBlankCounts` (editing a row from
 * before Phase 8, which holds only a rate), failures and runs may both be
 * left blank: the row keeps its rate, so fixing a typo in its name doesn't
 * demand numbers nobody has. One without the other is still an error.
 */
export function flakyTestErrors(
  draft: {
    name?: string | null;
    failures?: string | number | null;
    runs?: string | number | null;
    firstSeenAt?: string | null;
    /** The edited test's stored days, for the order check; absent on a new test. */
    quarantinedAt?: string | null;
    fixedAt?: string | null;
  },
  today: string,
  { allowBlankCounts = false }: { allowBlankCounts?: boolean } = {}
): FormErrors<FlakyField> {
  const errors: FormErrors<FlakyField> = {};
  const name = (draft.name ?? "").trim();
  if (!name) errors.name = "Enter the test's name.";
  else if (name.length > FLAKY_NAME_MAX) {
    errors.name = `Keep the name to ${FLAKY_NAME_MAX} characters.`;
  }
  const failures = parseNumber(draft.failures ?? undefined);
  const runs = parseNumber(draft.runs ?? undefined);
  const blank = (v: string | number | null | undefined) => String(v ?? "").trim() === "";
  const keepsRate = allowBlankCounts && blank(draft.failures) && blank(draft.runs);
  if (!keepsRate) {
    if (failures === undefined) errors.failures = "Enter how many runs failed.";
    else if (!isWhole(failures, 0)) errors.failures = "Enter a whole number of 0 or more.";
    if (runs === undefined) errors.runs = "Enter how many times it ran.";
    else if (!isWhole(runs, 1)) errors.runs = "Enter a whole number of 1 or more.";
    if (!errors.failures && !errors.runs && (failures as number) > (runs as number)) {
      errors.failures = "It can't fail more often than it ran.";
    }
  }
  const firstSeen = (draft.firstSeenAt ?? "").trim();
  const day =
    flakyDayError(firstSeen, today) ?? (firstSeen ? firstSeenOrderError(firstSeen, draft) : null);
  if (day) errors.firstSeenAt = day;
  return errors;
}
