/**
 * Readings from the toolkit's own data for the EBM Dashboard's measures,
 * one function per `METRIC_SOURCE_IDS` entry, each the same number the
 * source's own tool quotes. Example rows are left out everywhere. A
 * reading is only ever a suggestion: the page writes it when the person
 * presses "Add this reading" (Amr: `accept_source_reading`).
 *
 * Rows still in Tech Debt's old browser blob count once the Tech Debt page
 * has moved them into the workspace.
 *
 * Pure; server-safe (the MCP route calls it).
 */

import {
  KANBAN_BOARD_ID,
  type DoraScorecard,
  type KanbanBoard,
  type MetricSourceId,
  type NpsResponse,
  type Story,
  type TechDebtItem,
} from "@/lib/stores/workspace-types";
import { MIN_SAMPLE } from "@/lib/analytics/min-sample";
import { cycleSummary } from "@/lib/flow";
import { boardRows } from "@/app/(tools)/cycle-time/helpers";
import { DORA_DOC_ID, latestSample, usableSamples } from "@/lib/dora/samples";
import { quarterBounds } from "@/lib/roadmap/quarters";
import { realResponses, summarizeNps } from "@/lib/nps/score";
import { recentResponses } from "@/app/(tools)/nps-csat/tags";
import { isOpenDebt } from "@/lib/tech-debt/model";
import { isoDayNumber, isoFromDayNumber } from "@/lib/sprints/calendar";
import { isExampleId } from "@/lib/utils/example-id";

/** What the sources read, wherever it lives (the browser's workspace or the user's rows). */
export interface SourceData {
  stories?: readonly Story[];
  boards?: readonly KanbanBoard[];
  dora?: readonly DoraScorecard[];
  nps?: readonly NpsResponse[];
  techDebt?: readonly TechDebtItem[];
}

export interface SourceReading {
  value: number;
  /** YYYY-MM-DD. */
  date: string;
  /** Where it comes from, in words, with its n. */
  basis: string;
}

export { SOURCE_INFO, type SourceInfo } from "./source-info";

/** The days the cycle time looks back over, today included. */
export const CYCLE_WINDOW_DAYS = 90;

const one = (n: number) => Math.round(n * 10) / 10;
const finite = (n: unknown): n is number => typeof n === "number" && Number.isFinite(n);

/** The median cycle time of the stories and Flow-board cards finished in the last 90 days. */
export function cycleTimeMedian(data: SourceData, today: string): SourceReading | null {
  const end = isoDayNumber(today);
  if (end === null) return null;
  const from = isoFromDayNumber(end - (CYCLE_WINDOW_DAYS - 1));
  const board = (data.boards ?? []).find((b) => b && b.id === KANBAN_BOARD_ID);
  const rows = boardRows(data.stories ?? [], board?.cards ?? []).filter(
    (r) => r.doneOn >= from && r.doneOn <= today
  );
  if (rows.length < MIN_SAMPLE.distribution) return null;
  const median = cycleSummary(rows.map((r) => r.days)).median;
  if (median === null) return null;
  return {
    value: one(median),
    date: today,
    basis: `the median of ${rows.length} items finished in the last ${CYCLE_WINDOW_DAYS} days`,
  };
}

/** The DORA Scorecard's latest quarter (examples left out), and its reading's day. */
function doraSample(data: SourceData, today: string) {
  const doc = (data.dora ?? []).find((d) => d && d.id === DORA_DOC_ID) ?? null;
  const sample = latestSample(usableSamples(doc));
  if (!sample) return null;
  const end = quarterBounds(sample.quarter)?.end;
  return { sample, date: end && end < today ? end : today };
}

export function doraLeadTime(data: SourceData, today: string): SourceReading | null {
  const s = doraSample(data, today);
  if (!s || !finite(s.sample.leadTimeHours)) return null;
  return {
    value: one(s.sample.leadTimeHours / 24),
    date: s.date,
    basis: `the DORA Scorecard's ${s.sample.quarter} sample`,
  };
}

export function doraDeploys(data: SourceData, today: string): SourceReading | null {
  const s = doraSample(data, today);
  if (!s || !finite(s.sample.deployFreqPerWeek)) return null;
  return {
    value: one(s.sample.deployFreqPerWeek),
    date: s.date,
    basis: `the DORA Scorecard's ${s.sample.quarter} sample`,
  };
}

export function doraChangeFail(data: SourceData, today: string): SourceReading | null {
  const s = doraSample(data, today);
  if (!s || !finite(s.sample.changeFailRate)) return null;
  return {
    value: one(s.sample.changeFailRate * 100),
    date: s.date,
    basis: `the DORA Scorecard's ${s.sample.quarter} sample`,
  };
}

/** The NPS of the last 90 days' answers, from MIN_SAMPLE.surveyPeriod of them. */
export function npsRecent(data: SourceData, today: string): SourceReading | null {
  const s = summarizeNps(recentResponses(realResponses(data.nps ?? []), today));
  if (s.n < MIN_SAMPLE.surveyPeriod || s.score === null) return null;
  return { value: s.score, date: today, basis: `NPS from ${s.n} answers in the last 90 days` };
}

/** How many tech debt items are open; null with no tech debt logged at all. */
export function openTechDebt(data: SourceData, today: string): SourceReading | null {
  const rows = (data.techDebt ?? []).filter((t) => t && !isExampleId(t.id));
  if (rows.length === 0) return null;
  const open = rows.filter(isOpenDebt).length;
  return {
    value: open,
    date: today,
    basis: `${open} open of ${rows.length} items in Tech Debt`,
  };
}

const READERS: Record<MetricSourceId, (data: SourceData, today: string) => SourceReading | null> = {
  "cycle-time-median": cycleTimeMedian,
  "dora-lead-time": doraLeadTime,
  "dora-deploys": doraDeploys,
  "dora-change-fail": doraChangeFail,
  "nps-90d": npsRecent,
  "open-tech-debt": openTechDebt,
};

/** One source's reading today, or null when its tool doesn't have enough data. */
export function readSource(
  id: MetricSourceId,
  data: SourceData,
  today: string
): SourceReading | null {
  const read = READERS[id];
  return read ? read(data, today) : null;
}

export const isSourceId = (id: unknown): id is MetricSourceId =>
  typeof id === "string" && id in READERS;
