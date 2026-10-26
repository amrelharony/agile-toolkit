"use client";

import { useEffect, useRef, useState } from "react";
import dynamic from "next/dynamic";
import { Columns3, PiSquare } from "lucide-react";
import { useAnnounce } from "@/components/a11y/live-announcer";
import {
  MethodTool,
  shortName,
  useMethodActions,
  type MethodToolConfig,
} from "@/components/prioritization/method-tool";
import { ChartFigure } from "@/components/shared/chart-card";
import { NotEnoughData } from "@/components/shared/not-enough-data";
import { SectionCard } from "@/components/shared/section-card";
import { Button } from "@/components/ui/button";
import { TooltipProvider } from "@/components/ui/tooltip";
import { generateWsjfPrompts } from "@/lib/ai-prompts/wsjf";
import type { RankedItem } from "@/lib/analytics/scoring-rubric";
import type { ChartText } from "@/lib/charts/chart-text";
import { WSJF_ACTIONS } from "@/lib/history/event-actions";
import { WSJF } from "@/lib/prioritization/methods";
import { WSJF_KEYS, WSJF_LABEL, type WsjfKey } from "@/lib/prioritization/methods/wsjf";
import type { RankedRow } from "@/lib/prioritization/rank";
import { ColumnScoring, type SaveCell } from "./column-mode";
import { buildExample } from "./example";
import { toMarkdown } from "./markdown";
import { columnsMissingOne, relativeHint, wsjfVerdict } from "./verdict";
import { WsjfInputs, WsjfRowValues } from "./wsjf-inputs";

// Recharts loads with the chart, not the page; the placeholder fills the
// chart's fixed-height box while it does.
const WsjfScoreChart = dynamic(() => import("./charts").then((m) => m.WsjfScoreChart), {
  ssr: false,
  loading: () => (
    <div className="h-full w-full animate-pulse rounded-lg bg-muted/30" aria-hidden="true" />
  ),
});

/** The chart shows this many features, highest first. */
const CHART_TOP = 10;

const scoredRows = (rows: readonly RankedRow[]) => rows.filter((r) => r.result.score !== null);

/** The scored rows as the AI prompts read them (rank and score from the registry). */
function promptItems(rows: readonly RankedRow[]): RankedItem<Record<string, number | string>>[] {
  const scored = scoredRows(rows);
  const last = scored.reduce((n, r) => Math.max(n, r.rank ?? 0), 0);
  return scored.map((r) => ({
    id: r.row.id,
    title: r.row.title,
    fields: WSJF.write(r.row.fields, r.values),
    score: r.result.score as number,
    rank: r.rank as number,
    percentile: last <= 1 ? 1 : (last - (r.rank as number) + 1) / last,
  }));
}

/** The chart's summary sentence and its rows as a table. */
function chartText(top: readonly RankedRow[]): ChartText {
  const [first, second] = top;
  const name = (r: RankedRow) => `“${shortName(r.row.title)}”`;
  const at = (r: RankedRow) => WSJF.format(r.result.score as number);
  return {
    summary: second
      ? `${name(first)} leads at WSJF ${at(first)}; ${name(second)} follows at ${at(second)}.`
      : `${name(first)} scores WSJF ${at(first)}.`,
    table: {
      columns: ["Rank", "Feature", "WSJF"],
      rows: top.map((r) => [r.rank ?? "—", r.row.title, at(r)]),
      caption: "Top features by WSJF",
    },
  };
}

/** The first part some feature hasn't got yet (where column scoring should start). */
function firstBlankColumn(rows: readonly RankedRow[]): WsjfKey | null {
  return WSJF_KEYS.find((k) => rows.some((r) => r.values[k] === undefined)) ?? null;
}

/** Whether a feature still misses a part (what column scoring is for). */
const hasBlank = (r: RankedRow) => WSJF_KEYS.some((k) => r.values[k] === undefined);

/**
 * Under the list: the relative-scoring hint, column-by-column scoring and
 * the top-10 chart. Column scoring opens on its own while some feature is
 * missing a part (a title-only add waits there, also one added after the
 * stepper was closed), and the hint's buttons open it on the column that
 * has no 1.
 */
function WsjfPanels({ rows }: { rows: readonly RankedRow[] }) {
  const actions = useMethodActions(WSJF_TOOL);
  const announce = useAnnounce();
  const [column, setColumn] = useState<WsjfKey | null>(() => firstBlankColumn(rows));
  const headingRef = useRef<HTMLHeadingElement>(null);
  const startRef = useRef<HTMLButtonElement>(null);
  // Where focus goes once the column change renders: the column's heading
  // (a hint button, Previous / Next) or, after Done, the button that
  // reopens the stepper. Null: it stays where it is.
  const moved = useRef<"heading" | "start" | null>(null);
  const missingOne = columnsMissingOne(rows);

  const open = (key: WsjfKey) => {
    moved.current = "heading";
    setColumn(key);
  };
  const done = () => {
    moved.current = "start";
    setColumn(null);
  };
  // A column picked from a button or the stepper takes focus to its
  // heading, so the keyboard user lands on the column they asked for; Done
  // hands it to "Score by column", never to the page.
  useEffect(() => {
    const to = moved.current;
    moved.current = null;
    if (to === "heading" && column !== null) {
      headingRef.current?.scrollIntoView?.({ block: "nearest" });
      headingRef.current?.focus();
    } else if (to === "start" && column === null) {
      startRef.current?.focus();
    }
  }, [column]);

  // A feature added with a part missing waits in column scoring: open it
  // (focus stays on the add form) and say where it is. The rows on screen
  // when the panel mounts are not news.
  const seen = useRef(new Set(rows.map((r) => r.row.id)));
  useEffect(() => {
    const fresh = rows.filter((r) => !seen.current.has(r.row.id));
    for (const r of fresh) seen.current.add(r.row.id);
    const waiting = fresh.filter(hasBlank);
    if (waiting.length === 0) return;
    setColumn((c) => c ?? firstBlankColumn(rows));
    announce(
      waiting.length === 1
        ? `“${shortName(waiting[0].row.title)}” waits in Score by column, below the list.`
        : `${waiting.length} features wait in Score by column, below the list.`
    );
  }, [rows, announce]);

  const save: SaveCell = (row, key, value) =>
    actions.save(row.id, { title: row.title, [key]: value });

  const scored = scoredRows(rows);
  const top = scored.slice(0, CHART_TOP);
  const text = top.length >= 2 ? chartText(top) : null;

  return (
    <>
      {missingOne.length > 0 && (
        <div
          role="note"
          className="space-y-2 rounded-lg border border-warning/30 bg-warning/10 px-4 py-3 text-sm text-text"
        >
          <p>{relativeHint(missingOne)}</p>
          <div className="flex flex-wrap gap-2">
            {missingOne.map((k) => (
              <Button
                key={k}
                type="button"
                variant="outline"
                size="sm"
                // A part's full name (55 characters for RR/OE) is wider than a
                // phone: the label wraps inside the button instead.
                className="h-auto max-w-full whitespace-normal py-1.5 text-left md:h-auto"
                onClick={() => open(k)}
              >
                Score {WSJF_LABEL[k]} by column
              </Button>
            ))}
          </div>
        </div>
      )}

      <SectionCard title="Score by column" icon={Columns3}>
        {column === null ? (
          <div className="flex flex-wrap items-center justify-between gap-3">
            <p className="min-w-0 flex-1 text-sm text-sub">
              Score one part across every feature at a time: find the smallest, give it a 1, and
              size the others against it.
            </p>
            <Button
              ref={startRef}
              type="button"
              variant="toolkit"
              size="sm"
              onClick={() => open(WSJF_KEYS[0])}
            >
              Score by column
            </Button>
          </div>
        ) : (
          <ColumnScoring
            ref={headingRef}
            rows={rows}
            column={column}
            onColumn={open}
            onSwitch={setColumn}
            onDone={done}
            save={save}
            missingOne={missingOne}
          />
        )}
      </SectionCard>

      <SectionCard title={`Top ${CHART_TOP} by WSJF`} icon={PiSquare}>
        {text ? (
          <ChartFigure
            label={`Top ${CHART_TOP} by WSJF`}
            summary={text.summary}
            table={text.table}
            caption="Top features by WSJF"
            plotClassName="h-72"
          >
            <WsjfScoreChart
              data={top.map((r) => {
                // Rank-prefixed, so two features with the same (or the same
                // truncated) title stay two bars.
                const t = r.row.title.length > 16 ? `${r.row.title.slice(0, 16)}…` : r.row.title;
                return {
                  title: `#${r.rank} ${t}`,
                  score: Number((r.result.score as number).toFixed(2)),
                };
              })}
            />
          </ChartFigure>
        ) : (
          <NotEnoughData
            have={scored.length}
            need={2}
            unit={["scored feature", "scored features"]}
            action="Score"
            what="them side by side"
          />
        )}
      </SectionCard>
    </>
  );
}

/**
 * WSJF on the shared method-tool shell: add (a title alone is allowed,
 * for column scoring), edit in place, Undo, the example, the export and
 * the live backlog binding come from MethodTool; every score, floor and
 * rank from the method registry.
 */
export const WSJF_TOOL: MethodToolConfig = {
  methodId: "wsjf",
  toolId: "wsjf",
  title: "WSJF Calculator",
  description:
    "Weighted Shortest Job First: (Business Value + Time Criticality + Risk Reduction/Opportunity Enablement) ÷ Job Size, each part sized against the others on 1, 2, 3, 5, 8, 13, 20.",
  icon: PiSquare,
  noun: { one: "feature", many: "features" },
  titleLabel: "Feature title",
  titlePlaceholder: "e.g. Single sign-on",
  listLabel: "Features, highest WSJF first",
  emptyText:
    "No features yet. Add one above (a title is enough to score it column by column), or load an example.",
  history: WSJF_ACTIONS,
  allowTitleOnly: true,
  buildExample: () => buildExample(),
  verdict: wsjfVerdict,
  toMarkdown: (rows) => toMarkdown(rows),
  csv: (rows) => ({
    headers: ["Rank", "Title", "BV", "TC", "RR/OE", "Size", "WSJF"],
    rows: rows.map((r) => [
      r.rank ?? "",
      r.row.title,
      r.values.businessValue ?? "",
      r.values.timeCriticality ?? "",
      r.values.rrOe ?? "",
      r.values.jobSize ?? "",
      r.result.score === null ? "" : WSJF.format(r.result.score),
    ]),
  }),
  prompts: (rows, workspace) => generateWsjfPrompts({ items: promptItems(rows) }, workspace),
  Inputs: WsjfInputs,
  RowValues: WsjfRowValues,
  Panels: WsjfPanels,
};

export function WsjfClient() {
  return (
    // The app root has a provider; this one keeps the rows' icon-button
    // tooltips working wherever the page renders on its own.
    <TooltipProvider delayDuration={300}>
      <MethodTool config={WSJF_TOOL} />
    </TooltipProvider>
  );
}
