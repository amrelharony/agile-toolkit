/**
 * The DORA Scorecard's samples: one per quarter in the workspace singleton
 * `doraScorecards` / DORA_DOC_ID, ordered by quarter, checked the same way
 * on the page and in tool.dora_scorecard (add, update), and summed up the
 * same way for both (the latest quarter, its bands, the averages). Pure,
 * and safe for the agent's server bundle.
 */

import type { DoraSample, DoraScorecard } from "@/lib/stores/workspace-types";
import { dashQuarter, isDashQuarter, quarterBounds, quarterIndex } from "@/lib/roadmap/quarters";
import {
  DORA_BANDS,
  DORA_METRICS,
  bandRank,
  doraBand,
  type DoraBand,
  type DoraMetric,
} from "./bands";

/** The one scorecard document (MUST match what the page and the agent read). */
export const DORA_DOC_ID = "doraScorecard:current";

/** The longest description a sample keeps. */
export const DORA_DESCRIPTION_MAX = 2000;

/**
 * Whether a row came from "Load an example" (`example-` ids, the
 * components/tool-frame/example-data rule, held to it by a test). Not
 * imported: that module is "use client", which the agent's server bundle
 * can't call into.
 */
export const isExampleSample = (s: { id?: string } | null | undefined) =>
  typeof s?.id === "string" && s.id.startsWith("example-");

/** The stored samples that are objects with a quarter, examples left out unless asked for. */
export function usableSamples(
  doc: DoraScorecard | null | undefined,
  { includeExamples = false }: { includeExamples?: boolean } = {}
): DoraSample[] {
  const raw: unknown = doc?.samples;
  if (!Array.isArray(raw)) return [];
  return raw.filter(
    (s): s is DoraSample =>
      typeof s === "object" &&
      s !== null &&
      typeof (s as DoraSample).id === "string" &&
      (includeExamples || !isExampleSample(s as DoraSample))
  );
}

/**
 * Oldest quarter first. A quarter that can't be read (an agent's old free
 * text, "Q1 2026") sorts after the readable ones, by its text; two samples
 * for one quarter keep their stored order.
 */
export function sortSamples(samples: readonly DoraSample[]): DoraSample[] {
  return samples
    .map((s, i) => ({ s, i, q: quarterIndex(s.quarter) }))
    .sort((a, b) => {
      if (a.q !== b.q) {
        if (a.q === 0) return 1;
        if (b.q === 0) return -1;
        return a.q - b.q;
      }
      if (a.q === 0) {
        const t = String(a.s.quarter ?? "").localeCompare(String(b.s.quarter ?? ""));
        if (t !== 0) return t;
      }
      return a.i - b.i;
    })
    .map(({ s }) => s);
}

/** The sample for the latest quarter (not the last one added), or null. */
export function latestSample(samples: readonly DoraSample[]): DoraSample | null {
  const readable = sortSamples(samples).filter((s) => quarterIndex(s.quarter) !== 0);
  return readable[readable.length - 1] ?? null;
}

/** The sample already logged for `quarter`, other than `exceptId`. */
export function sampleFor(
  samples: readonly DoraSample[],
  quarter: string,
  exceptId?: string
): DoraSample | undefined {
  const q = quarterIndex(quarter);
  if (q === 0) return undefined;
  return samples.find((s) => s.id !== exceptId && quarterIndex(s.quarter) === q);
}

/**
 * The quarters that have a sample, in the dash form the picker lists
 * ("2026 Q3" from an older write reads as "2026-Q3"), other than `exceptId`'s.
 */
export function loggedQuarters(samples: readonly DoraSample[], exceptId?: string): Set<string> {
  const out = new Set<string>();
  for (const s of samples) {
    if (s.id === exceptId) continue;
    const q = quarterIndex(s.quarter);
    if (q !== 0) out.add(dashQuarter(q));
  }
  return out;
}

/** A sample's four numbers, any of which may be missing or wrong (a draft, an agent's patch). */
export type DoraNumbers = Partial<Record<DoraMetric, number>>;

export type DoraField = DoraMetric | "quarter" | "description";

/**
 * Why a quarter can't take a new sample, or null when it can: it must be a
 * "YYYY-Qn" quarter that has started, with no sample yet (other than
 * `exceptId`, the one being edited).
 */
export function quarterError(
  quarter: string,
  samples: readonly DoraSample[],
  today: string,
  exceptId?: string
): string | null {
  if (!quarter) return "Pick a quarter.";
  if (!isDashQuarter(quarter)) return "Use a quarter like 2026-Q3.";
  const bounds = quarterBounds(quarter);
  if (bounds && bounds.start > today) return `${quarter} hasn't started yet.`;
  if (sampleFor(samples, quarter, exceptId)) return `${quarter} already has a sample.`;
  return null;
}

const NEEDS: Record<DoraMetric, string> = {
  deployFreqPerWeek: "Enter the deploys a week, 0 or more.",
  leadTimeHours: "Enter the lead time in hours, 0 or more.",
  changeFailRate: "Enter the change failure rate.",
  mttrHours: "Enter the time to restore in hours, 0 or more.",
};

/**
 * Why each of the four numbers can't be saved: missing, not a number,
 * negative, or (change failure) over 100%. A rate is never clamped: 140%
 * is an error to fix, not a silent 100%.
 */
export function numberErrors(values: DoraNumbers): Partial<Record<DoraMetric, string>> {
  const errors: Partial<Record<DoraMetric, string>> = {};
  for (const m of DORA_METRICS) {
    const v = values[m];
    if (typeof v !== "number" || !Number.isFinite(v) || v < 0) errors[m] = NEEDS[m];
    else if (m === "changeFailRate" && v > 1) errors[m] = "Use a rate from 0% to 100%.";
  }
  return errors;
}

/** Each metric's band for a sample. */
export function sampleBands(s: Pick<DoraSample, DoraMetric>): Record<DoraMetric, DoraBand | null> {
  const out = {} as Record<DoraMetric, DoraBand | null>;
  for (const m of DORA_METRICS) out[m] = doraBand(m, s[m]);
  return out;
}

/**
 * The weakest metrics of a sample: those in its worst band, in the
 * scorecard's order. Empty when no metric has a band.
 */
export function weakestMetrics(s: Pick<DoraSample, DoraMetric>): {
  metrics: DoraMetric[];
  band: DoraBand | null;
} {
  const bands = sampleBands(s);
  let worst = -1;
  for (const m of DORA_METRICS) {
    const b = bands[m];
    if (b) worst = Math.max(worst, bandRank(b));
  }
  if (worst < 0) return { metrics: [], band: null };
  const metrics = DORA_METRICS.filter((m) => bands[m] !== null && bandRank(bands[m]!) === worst);
  return { metrics, band: bands[metrics[0]] };
}

const round2 = (n: number) => Math.round(n * 100) / 100;

/**
 * The scorecard as tool.dora_scorecard.list_state reports it: the samples
 * by quarter, the latest quarter's sample and bands, the averages (null
 * with no samples), and whose bands they are.
 */
export function scorecardSummary(doc: DoraScorecard | null | undefined) {
  const all = usableSamples(doc, { includeExamples: true });
  const samples = sortSamples(all.filter((s) => !isExampleSample(s)));
  const latest = latestSample(samples);
  const avg = (m: DoraMetric) => {
    const xs = samples.map((s) => s[m]).filter((v) => typeof v === "number" && Number.isFinite(v));
    return xs.length ? round2(xs.reduce((a, b) => a + b, 0) / xs.length) : null;
  };
  return {
    exists: doc !== null && doc !== undefined,
    total: samples.length,
    latest,
    averages: {
      deployFreqPerWeek: avg("deployFreqPerWeek"),
      leadTimeHours: avg("leadTimeHours"),
      changeFailRate: avg("changeFailRate"),
      mttrHours: avg("mttrHours"),
    },
    bands: latest ? sampleBands(latest) : null,
    bandsSource: {
      report: DORA_BANDS.report,
      publisher: DORA_BANDS.publisher,
      year: DORA_BANDS.year,
      note: DORA_BANDS.note,
    },
    samples,
    examplesLeftOut: all.length - samples.length,
  };
}
