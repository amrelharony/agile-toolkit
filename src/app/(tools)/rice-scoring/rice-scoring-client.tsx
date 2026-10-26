"use client";

import dynamic from "next/dynamic";
import { Calculator } from "lucide-react";
import {
  MethodTool,
  shortName,
  type MethodToolConfig,
} from "@/components/prioritization/method-tool";
import { AdvancedAnalysis } from "@/components/shared/advanced-analysis";
import { ChartFigure } from "@/components/shared/chart-card";
import { NotEnoughData } from "@/components/shared/not-enough-data";
import { SectionCard } from "@/components/shared/section-card";
import { TooltipProvider } from "@/components/ui/tooltip";
import { generateRicePrompts } from "@/lib/ai-prompts/rice-scoring";
import type { RankedItem } from "@/lib/analytics/scoring-rubric";
import type { ChartText } from "@/lib/charts/chart-text";
import { RICE_ACTIONS } from "@/lib/history/event-actions";
import { RICE } from "@/lib/prioritization/methods";
import { toChoice, toNumber } from "@/lib/prioritization/methods/fields";
import {
  REACH_PERIODS,
  REACH_PERIOD_LABEL,
  reachPerQuarter,
} from "@/lib/prioritization/methods/rice";
import type { RankedRow } from "@/lib/prioritization/rank";
import { OUTLIER_MIN, outliersOf, scoredRows } from "./analysis";
import { buildExample } from "./example";
import { toMarkdown } from "./markdown";
import { RiceInputs, RiceRowValues } from "./rice-inputs";
import { riceVerdict } from "./verdict";

// Recharts loads with the chart, not the page; the placeholder fills the
// chart's fixed-height box while it does.
const RiceScoreChart = dynamic(() => import("./charts").then((m) => m.RiceScoreChart), {
  ssr: false,
  loading: () => (
    <div className="h-full w-full animate-pulse rounded-lg bg-muted/30" aria-hidden="true" />
  ),
});

/** The chart shows this many initiatives, highest first. */
const CHART_TOP = 10;

/** A number for a CSV cell: rounded, never a display string ("2,133.3" sorts as text). */
const csvNumber = (n: number, digits: number) => Math.round(n * 10 ** digits) / 10 ** digits;

/**
 * The scored rows as the AI prompts read them (rank and score from the
 * registry). The prompt's table has one Reach column next to the score, so
 * it gets the reach per quarter the score used (2,000 a month reads 6,000),
 * and the confidence as read through (an agent row's `confidencePct`).
 */
function promptItems(rows: readonly RankedRow[]): RankedItem<Record<string, number | string>>[] {
  const scored = scoredRows(rows);
  const last = scored.reduce((n, r) => Math.max(n, r.rank ?? 0), 0);
  return scored.map((r) => ({
    id: r.row.id,
    title: r.row.title,
    fields: {
      reach: csvNumber(toNumber(r.result.extra?.reachPerQuarter) ?? 0, 1),
      impact: toNumber(r.values.impact) ?? 0,
      confidence: toNumber(r.values.confidence) ?? 0,
      effort: toNumber(r.values.effort) ?? 0,
    },
    score: r.result.score as number,
    rank: r.rank as number,
    percentile: last <= 1 ? 1 : (last - (r.rank as number) + 1) / last,
  }));
}

/** The chart's summary sentence and its rows as a table. */
function chartText(top: readonly RankedRow[]): ChartText {
  const [first, second] = top;
  const name = (r: RankedRow) => `“${shortName(r.row.title)}”`;
  const at = (r: RankedRow) => RICE.format(r.result.score as number);
  const summary = second
    ? `${name(first)} leads at RICE ${at(first)}; ${name(second)} follows at ${at(second)}.`
    : `${name(first)} scores RICE ${at(first)}.`;
  return {
    summary,
    table: {
      columns: ["Rank", "Initiative", "RICE"],
      rows: top.map((r) => [r.rank ?? "—", r.row.title, at(r)]),
      caption: "Top initiatives by RICE",
    },
  };
}

/** Under the list: the top-10 chart, and the outlier check behind Advanced analysis. */
function RicePanels({ rows }: { rows: readonly RankedRow[] }) {
  const scored = scoredRows(rows);
  const top = scored.slice(0, CHART_TOP);
  const outliers = outliersOf(rows);
  const flagged = outliers ? scored.filter((r) => outliers.has(r.row.id)) : [];
  const text = top.length >= 2 ? chartText(top) : null;
  return (
    <>
      <SectionCard title={`Top ${CHART_TOP} by RICE`} icon={Calculator}>
        {text ? (
          <ChartFigure
            label={`Top ${CHART_TOP} by RICE`}
            summary={text.summary}
            table={text.table}
            caption="Top initiatives by RICE"
            plotClassName="h-72"
          >
            <RiceScoreChart
              data={top.map((r) => {
                // Rank-prefixed, so two initiatives with the same (or the
                // same truncated) title stay two bars.
                const t = r.row.title.length > 16 ? `${r.row.title.slice(0, 16)}…` : r.row.title;
                return {
                  title: `#${r.rank} ${t}`,
                  score: Number((r.result.score as number).toFixed(1)),
                };
              })}
            />
          </ChartFigure>
        ) : (
          <NotEnoughData
            have={scored.length}
            need={2}
            unit={["scored initiative", "scored initiatives"]}
            action="Score"
            what="them side by side"
          />
        )}
      </SectionCard>
      <AdvancedAnalysis summary="Advanced analysis: outlier scores">
        {outliers === null ? (
          <NotEnoughData
            have={scored.length}
            need={OUTLIER_MIN}
            unit={["scored initiative", "scored initiatives"]}
            action="Score"
            what="which scores sit far from the rest"
          />
        ) : flagged.length === 0 ? (
          <p className="text-sm text-sub">
            No score sits far from the rest (more than 1.5 times the spread of the middle half).
          </p>
        ) : (
          <div className="space-y-2 text-sm">
            <p className="text-text">
              {flagged.length === 1 ? "This score sits" : "These scores sit"} far from the rest:
              re-check the inputs before acting on {flagged.length === 1 ? "it" : "them"}. A typo in
              reach or effort is the usual cause.
            </p>
            <ul className="list-disc space-y-1 pl-5 text-sub">
              {flagged.map((r) => (
                <li key={r.row.id}>
                  <span className="text-text">{r.row.title}</span>: RICE{" "}
                  {RICE.format(r.result.score as number)}
                </li>
              ))}
            </ul>
          </div>
        )}
      </AdvancedAnalysis>
    </>
  );
}

/**
 * One CSV row: the inputs as shown, the reach per quarter the score used,
 * the score. Numbers go in as numbers (rounded as the screen rounds them),
 * so a spreadsheet sorts them as numbers.
 */
function csvRow(r: RankedRow): (string | number)[] {
  const reach = toNumber(r.values.reach);
  const period = toChoice(REACH_PERIODS, r.values.reachPeriod) ?? "quarter";
  return [
    r.rank ?? "",
    r.row.title,
    reach ?? "",
    REACH_PERIOD_LABEL[period],
    reach === undefined ? "" : csvNumber(reachPerQuarter(reach, period), 1),
    r.values.impact ?? "",
    r.values.confidence ?? "",
    r.values.effort ?? "",
    r.result.score === null ? "" : csvNumber(r.result.score, 1),
  ];
}

/**
 * RICE on the shared method-tool shell: add (the reach period remembered
 * from the last initiative), edit in place, Undo, the example, the export
 * and the live backlog binding come from MethodTool; every score and rank
 * from the method registry.
 */
export const RICE_TOOL: MethodToolConfig = {
  methodId: "rice",
  toolId: "rice-scoring",
  title: "RICE Scoring Calculator",
  description:
    "Score initiatives by Reach × Impact × Confidence ÷ Effort. Reach counts per week, month, quarter or year and is compared per quarter.",
  icon: Calculator,
  noun: { one: "initiative", many: "initiatives" },
  titleLabel: "Initiative title",
  titlePlaceholder: "e.g. Saved searches",
  listLabel: "Initiatives, highest RICE first",
  emptyText: "No initiatives yet. Add one above, or load an example to see a ranked backlog.",
  history: RICE_ACTIONS,
  // The period is a unit, shown and editable, never a score: it starts on
  // the last initiative's, else per quarter (what Reach always meant).
  initialDraft: { reachPeriod: "quarter" },
  remember: ["reachPeriod"],
  buildExample: () => buildExample(),
  verdict: riceVerdict,
  toMarkdown: (rows) => toMarkdown(rows),
  csv: (rows) => ({
    headers: [
      "Rank",
      "Title",
      "Reach",
      "Reach period",
      "Reach per quarter",
      "Impact",
      "Confidence %",
      "Effort (person-months)",
      "RICE",
    ],
    rows: rows.map(csvRow),
  }),
  prompts: (rows, workspace) =>
    generateRicePrompts(
      { items: promptItems(rows), outliers: Array.from(outliersOf(rows) ?? []) },
      workspace
    ),
  Inputs: RiceInputs,
  RowValues: RiceRowValues,
  Panels: RicePanels,
};

export function RiceScoringClient() {
  return (
    // The app root has a provider; this one keeps the rows' icon-button
    // tooltips working wherever the page renders on its own.
    <TooltipProvider delayDuration={300}>
      <MethodTool config={RICE_TOOL} />
    </TooltipProvider>
  );
}
