"use client";

import dynamic from "next/dynamic";
import { BarChart3, Clock } from "lucide-react";
import {
  MethodTool,
  shortName,
  type MethodToolConfig,
} from "@/components/prioritization/method-tool";
import { ChartFigure } from "@/components/shared/chart-card";
import { NotEnoughData } from "@/components/shared/not-enough-data";
import { SectionCard } from "@/components/shared/section-card";
import { TooltipProvider } from "@/components/ui/tooltip";
import type { ChartText } from "@/lib/charts/chart-text";
import { COD_ACTIONS } from "@/lib/history/event-actions";
import { COST_OF_DELAY } from "@/lib/prioritization/methods";
import { formatNumber } from "@/lib/prioritization/methods/fields";
import { COD_URGENCY_LABEL, type CodUrgency } from "@/lib/prioritization/methods/cost-of-delay";
import type { RankedRow } from "@/lib/prioritization/rank";
import { todayIso } from "@/lib/sprints/series";
import { CodInputs, CodRowValues } from "./cod-inputs";
import { buildExample } from "./example";
import { codGroups, fixedDateStart, laneOf, waitingPerWeek } from "./lanes";
import { toMarkdown } from "./markdown";
import { generateCd3Prompts } from "./prompts";
import { codVerdict } from "./verdict";

// Recharts loads with the chart, not the page; the placeholder fills the
// chart's fixed-height box while it does.
const CostOfDelayChart = dynamic(() => import("./charts").then((m) => m.CostOfDelayChart), {
  ssr: false,
  loading: () => (
    <div className="h-full w-full animate-pulse rounded-lg bg-muted/30" aria-hidden="true" />
  ),
});

/** The chart shows this many initiatives, highest CD3 first. */
const CHART_TOP = 10;

/** A lane's name for the chart table and the CSV. */
function laneName(r: RankedRow): string {
  const id = laneOf(r);
  return id === "unscored"
    ? "Not scored"
    : id === "none"
      ? "No profile yet"
      : COD_URGENCY_LABEL[id as CodUrgency];
}

/** The chart's summary sentence and its rows as a table. */
function chartText(top: readonly RankedRow[]): ChartText {
  const [first, second] = top;
  const name = (r: RankedRow) => `“${shortName(r.row.title)}”`;
  const at = (r: RankedRow) => COST_OF_DELAY.format(r.result.score as number);
  return {
    summary: second
      ? `${name(first)} has the highest CD3 at ${at(first)}; ${name(second)} follows at ${at(second)}. The list orders by lane first, so an expedite or a fixed date can come before a higher CD3.`
      : `${name(first)} has a CD3 of ${at(first)}.`,
    table: {
      columns: ["Initiative", "CD3", "Lane"],
      rows: top.map((r) => [r.row.title, at(r), laneName(r)]),
      caption: "Initiatives by CD3",
    },
  };
}

/**
 * Under the lanes: what waiting costs per week across the scored
 * initiatives (in place of the old "total cost of delay", which summed
 * different delays), and the CD3 chart.
 */
function CodPanels({ rows }: { rows: readonly RankedRow[] }) {
  const scored = rows.filter((r) => r.result.score !== null);
  // The chart compares CD3 alone, highest first (the list's lanes say what goes first).
  const top = [...scored]
    .sort((a, b) => (b.result.score as number) - (a.result.score as number))
    .slice(0, CHART_TOP);
  const text = top.length >= 2 ? chartText(top) : null;
  const { perWeek, count } = waitingPerWeek(rows);
  return (
    <SectionCard title={`Top ${CHART_TOP} by CD3`} icon={BarChart3}>
      <div className="space-y-4">
        {count > 0 && (
          <p className="text-sm text-text">
            Waiting costs <span className="font-mono font-medium">${formatNumber(perWeek, 2)}</span>{" "}
            per week across {count} scored {count === 1 ? "initiative" : "initiatives"}.
          </p>
        )}
        {text ? (
          <ChartFigure
            label={`Top ${CHART_TOP} by CD3`}
            summary={text.summary}
            table={text.table}
            caption="Initiatives by CD3"
            plotClassName="h-72"
          >
            <CostOfDelayChart
              data={top.map((r) => {
                const t = r.row.title.length > 18 ? `${r.row.title.slice(0, 18)}…` : r.row.title;
                return { title: t, cd3: Number((r.result.score as number).toFixed(2)) };
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
      </div>
    </SectionCard>
  );
}

/**
 * Cost of Delay on the shared method-tool shell, scored as CD3 (cost of
 * delay per week ÷ duration): add, edit in place, Undo, the example, the
 * export and the backlog link come from MethodTool; CD3, the lanes and the
 * latest starts from the method registry. The list groups by lane in the
 * order work should start.
 */
export const COD_TOOL: MethodToolConfig = {
  methodId: "cost-of-delay",
  toolId: "cost-of-delay",
  title: "Cost-of-Delay Tracker",
  description:
    "CD3 = cost of delay per week ÷ duration in weeks, ordered by urgency profile: expedite now, fixed dates by latest start, then standard and intangible work by CD3.",
  icon: Clock,
  noun: { one: "initiative", many: "initiatives" },
  titleLabel: "Initiative title",
  titlePlaceholder: "e.g. One-tap wallet checkout",
  submitLabel: "Add",
  listLabel: "Initiatives by lane",
  emptyText:
    "No initiatives yet. Add one above, or load an example queue with every urgency profile.",
  history: COD_ACTIONS,
  buildExample: () => buildExample(),
  verdict: (rows) => codVerdict(rows),
  toMarkdown: (rows) => toMarkdown(rows),
  csv: (rows) => {
    const today = todayIso();
    return {
      headers: [
        "Lane",
        "Title",
        "Cost of delay per week ($)",
        "Duration (weeks)",
        "CD3",
        "Must land by",
        "Latest start",
      ],
      rows: rows.map((r) => {
        const start = fixedDateStart(r, today);
        return [
          laneName(r),
          r.row.title,
          r.values.perWeekUsd ?? "",
          r.values.durationWeeks ?? "",
          // A number, rounded as on screen: "4,000" would import as text.
          r.result.score === null ? "" : Math.round(r.result.score * 100) / 100,
          start?.fixedDate ?? "",
          start?.latestStart ?? "",
        ];
      }),
    };
  },
  prompts: (rows, workspace) => generateCd3Prompts(rows, workspace),
  Inputs: CodInputs,
  RowValues: CodRowValues,
  groups: codGroups,
  Panels: CodPanels,
};

export function CostOfDelayClient() {
  return (
    // The app root has a provider; this one keeps the rows' icon-button
    // tooltips working wherever the page renders on its own.
    <TooltipProvider delayDuration={300}>
      <MethodTool config={COD_TOOL} />
    </TooltipProvider>
  );
}
