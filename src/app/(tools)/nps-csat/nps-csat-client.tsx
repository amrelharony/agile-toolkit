"use client";

import dynamic from "next/dynamic";
import Link from "@/components/motion/transition-link";
import { useId, useMemo, useRef, useState } from "react";
import { BarChart3, MessageSquareQuote, Plus, Tags, Upload, X } from "lucide-react";
import { useAnnounce } from "@/components/a11y/live-announcer";
import { ToolPageWrapper } from "@/components/layout/tool-page-wrapper";
import { ActionRow } from "@/components/shared/action-row";
import { AdvancedAnalysis } from "@/components/shared/advanced-analysis";
import { AiPromptGenerator } from "@/components/shared/ai-prompt-generator";
import { ChartFigure } from "@/components/shared/chart-card";
import { DataTable, type DataTableColumn } from "@/components/shared/data-table";
import { EmptyState } from "@/components/shared/empty-state";
import { ExportButton } from "@/components/shared/export-button";
import { KpiGrid } from "@/components/shared/kpi-grid";
import { NotEnoughData } from "@/components/shared/not-enough-data";
import { ResetButton } from "@/components/shared/reset-button";
import { ResortChip } from "@/components/shared/resort-chip";
import { SectionCard } from "@/components/shared/section-card";
import { StatCard } from "@/components/shared/stat-card";
import {
  ExampleNotice,
  LoadExampleButton,
  hasExampleItems,
  isExampleId,
} from "@/components/tool-frame/example-data";
import { Button } from "@/components/ui/button";
import { ToggleGroup } from "@/components/ui/toggle-group";
import { TooltipProvider } from "@/components/ui/tooltip";
import { useStableOrder } from "@/hooks/use-stable-order";
import { useVisibilityTick } from "@/lib/hooks/use-visibility-tick";
import { generateNpsCsatPrompts } from "@/lib/ai-prompts/nps-csat";
import { MIN_SAMPLE, enoughData } from "@/lib/analytics/min-sample";
import { cusum } from "@/lib/analytics/changepoint";
import { mannKendall } from "@/lib/analytics/trend-test";
import { NPS_CSAT_ACTIONS } from "@/lib/history/event-actions";
import { useHistoryLogger } from "@/lib/history/use-history-logger";
import {
  csatCategory,
  hasTag,
  latestEnough,
  npsCategory,
  periodSeries,
  summarizeCsat,
  summarizeNps,
  tagCounts,
  type SurveyPeriod,
  type TagCount,
} from "@/lib/nps/score";
import { emit as sonify } from "@/lib/sonification/emit";
import { useWorkspaceStore } from "@/lib/stores/workspace-store";
import type { NpsResponse } from "@/lib/stores/workspace-types";
import { todayLocalISO } from "@/lib/utils/formatters";
import { removeWithUndo, undoable } from "@/lib/utils/undoable";
import { usePersistedLocal } from "@/lib/utils/use-persisted";
import { nanoid } from "nanoid";
import { focusAfterRemoval, focusSoon } from "@/app/(tools)/sprint-goal/focus";
import { CHART_MIN_PERIODS, periodTrendText } from "./chart-text";
import { buildExample } from "./example";
import { emptyResponse, newResponse, withResponseValues, type ResponseValues } from "./form";
import { ImportPanel } from "./import-panel";
import type { ImportRow } from "./import";
import { toMarkdown } from "./markdown";
import { ResponseForm } from "./response-form";
import { DELETE_SELECTOR, ResponseRow, categoryOf } from "./response-row";
import { RECENT_DAYS, hypothesisTag, tagCsatText, tagNpsText } from "./tags";
import { surveyVerdict, thinPeriodWarning } from "./verdict";

// Recharts loads with the score trend chart, not the page. The placeholder
// matches the chart's fixed 240px height so the card doesn't jump.
const ScoreTrendChart = dynamic(() => import("./charts").then((m) => m.ScoreTrendChart), {
  ssr: false,
  loading: () => (
    <div className="h-[240px] w-full animate-pulse rounded-lg bg-muted/30" aria-hidden="true" />
  ),
});

/** The period grouping, remembered per viewer on this device. */
export const PERIOD_KEY = "agile-toolkit:nps-csat:period";

/** Responses listed before "Show more": an import of 1000 rows stays quick to scroll. */
export const LIST_PAGE = 50;

// A stable empty list: zustand re-renders forever on a selector that
// returns a fresh array each call.
const NONE: NpsResponse[] = [];

const PERIODS: { value: SurveyPeriod; label: string }[] = [
  { value: "month", label: "Month" },
  { value: "week", label: "Week" },
];

const signed = (v: number) => (v > 0 ? `+${v}` : String(v));
const responsesText = (n: number) => (n === 1 ? "1 response" : `${n} responses`);

/** Newest first; the same day keeps the order the answers were added in. */
const newestFirst = (a: NpsResponse, b: NpsResponse) =>
  a.date < b.date ? 1 : a.date > b.date ? -1 : 0;

/** Replace the responses slice through a function of it (bulk import, undo). */
const setResponses = (update: (list: readonly NpsResponse[]) => NpsResponse[]) =>
  useWorkspaceStore.setState((s) => ({ npsResponses: update(s.npsResponses ?? []) }));

export function NpsCsatClient() {
  return (
    // The app root has a provider; this one keeps the rows' icon-button
    // tooltips working wherever the page renders on its own.
    <TooltipProvider delayDuration={300}>
      <NpsCsatTracker />
    </TooltipProvider>
  );
}

/**
 * NPS / CSAT: survey answers typed in or imported from a CSV, read per
 * calendar week or month with each period's n, CSAT as % satisfied, and
 * theme tags on the verbatims. Every number comes from lib/nps, which the
 * agent's tool.nps_csat.list_state reads too.
 */
function NpsCsatTracker() {
  const responses = useWorkspaceStore((s) => s.npsResponses) ?? NONE;
  const upsert = useWorkspaceStore((s) => s.upsertNpsResponse);
  const { log } = useHistoryLogger("nps-csat");
  const announce = useAnnounce();
  const [now, setNow] = useState(() => new Date());
  const today = todayLocalISO(now);
  // A page left open past midnight moves on to the new day: the forms and
  // the import would otherwise refuse today's answers as "in the future".
  useVisibilityTick(true, 60_000, () => {
    const next = new Date();
    if (todayLocalISO(next) !== today) setNow(next);
  });
  const [storedBy, setBy] = usePersistedLocal<unknown>(PERIOD_KEY, "month");
  const by: SurveyPeriod = storedBy === "week" ? "week" : "month";
  const [tag, setTag] = useState<string | null>(null);
  const [importing, setImporting] = useState(false);
  const [limit, setLimit] = useState(LIST_PAGE);
  const chartRef = useRef<HTMLDivElement>(null);
  const listRef = useRef<HTMLUListElement>(null);
  const importRef = useRef<HTMLButtonElement>(null);
  const addRef = useRef<HTMLDivElement>(null);
  const chartTitleId = useId();
  const cleared = useRef<NpsResponse[]>([]);

  const tags = useMemo(() => tagCounts(responses), [responses]);
  const pointer = useMemo(() => hypothesisTag(responses, today), [responses, today]);
  const activeTag = tag && tags.some((t) => t.tag === tag) ? tag : null;
  const shown = useMemo(
    () => (activeTag ? responses.filter((r) => hasTag(r, activeTag)) : responses),
    [responses, activeTag]
  );
  const series = useMemo(() => periodSeries(shown, by, { through: today }), [shown, by, today]);
  const nps = useMemo(() => summarizeNps(shown), [shown]);
  const csat = useMemo(() => summarizeCsat(shown), [shown]);
  const npsHead = latestEnough(series.points, "nps");
  const csatHead = latestEnough(series.points, "csat");
  const latest = series.points[series.points.length - 1];
  const warning = thinPeriodWarning(latest);
  // Filtered, every headline number reads the tag's answers alone: say so first.
  const verdict = `${activeTag ? `Tagged “${activeTag}”: ` : ""}${surveyVerdict(series.points, { nps, csat })}`;
  const tagged = (hint: string) => (activeTag ? `“${activeTag}” only. ${hint}` : hint);
  const trendText = useMemo(() => periodTrendText(series.points, by), [series.points, by]);
  const showChart = series.points.length >= CHART_MIN_PERIODS;

  // Trend tests run only on the periods that meet the minimum: a period of
  // three answers would swing them on its own.
  const steadyNps = series.points
    .filter((p) => p.enoughNps && p.nps.score !== null)
    .map((p) => p.nps.score as number);
  const steadyCsat = series.points
    .filter((p) => p.enoughCsat && p.csat.satisfiedPct !== null)
    .map((p) => p.csat.satisfiedPct as number);
  const mkNps = enoughData(steadyNps.length, "trend") ? mannKendall(steadyNps) : null;
  const mkCsat = enoughData(steadyCsat.length, "trend") ? mannKendall(steadyCsat) : null;
  const shiftsNps = enoughData(steadyNps.length, "changePoint") ? cusum(steadyNps) : null;
  const shiftsCsat = enoughData(steadyCsat.length, "changePoint") ? cusum(steadyCsat) : null;

  const order = useStableOrder(shown, (r) => r.id, newestFirst);
  const listed = order.ordered.slice(0, limit);

  const markdown = useMemo(
    () => toMarkdown(shown, by, { now, today, tag: activeTag }),
    [shown, by, now, today, activeTag]
  );
  const promptConfig = useMemo(
    () => ({
      toolName: "NPS/CSAT Tracker",
      // The page's own numbers (lib/nps): no NPS answers reads "No NPS responses", never 0.
      // The tag table counts every response, as the page's does, the filter aside.
      prompts: generateNpsCsatPrompts({
        responses: shown,
        tags,
        by,
        today,
        tag: activeTag,
        verdict,
      }),
    }),
    [shown, tags, by, today, activeTag, verdict]
  );

  /** History for the team's own answers; the example's aren't the team's work. */
  const record = (r: Pick<NpsResponse, "id">, action: string, payload: Record<string, unknown>) => {
    if (!isExampleId(r.id)) log(action, payload);
  };

  /* ── Changes ──────────────────────────────────────────────────────── */

  const add = (values: ResponseValues) => {
    const r = newResponse(values);
    upsert(r);
    const category = r.kind === "nps" ? npsCategory(r.score) : csatCategory(r.score);
    sonify(
      "nps-csat",
      category === "promoter" || category === "satisfied"
        ? "score-promoter"
        : category === "passive" || category === "neutral"
          ? "score-passive"
          : "score-detractor"
    );
    log(NPS_CSAT_ACTIONS.SURVEY_ADDED, { kind: r.kind, score: r.score, date: r.date });
    announce(
      `Added ${r.kind.toUpperCase()} ${r.score} (${categoryOf(r).toLowerCase()}) for ${r.date}`
    );
  };

  const edit = (before: NpsResponse, values: ResponseValues) => {
    const after = withResponseValues(before, values);
    upsert(after);
    const fields = (["kind", "score", "date", "respondent", "verbatim"] as const).filter(
      (k) => before[k] !== after[k]
    ) as string[];
    if ((before.tags ?? []).join(",") !== (after.tags ?? []).join(",")) fields.push("tags");
    if (fields.length > 0) {
      record(after, NPS_CSAT_ACTIONS.RESPONSE_UPDATED, { responseId: after.id, fields });
    }
    announce(`Saved the ${after.kind.toUpperCase()} response of ${after.date}`);
  };

  const remove = (r: NpsResponse) => {
    const kind = r.kind.toUpperCase();
    const index = listed.findIndex((x) => x.id === r.id);
    removeWithUndo<NpsResponse>({
      label: `Deleted the ${kind} ${r.score} of ${String(r.date).slice(0, 10) || "no date"}`,
      update: setResponses,
      match: (x) => x.id === r.id,
    });
    record(r, NPS_CSAT_ACTIONS.SURVEY_REMOVED, { kind: r.kind, score: r.score });
    announce(`Deleted the ${kind} response`);
    // The pressed button went with its row: the next row's delete takes focus,
    // or the add form's survey when none is left.
    focusAfterRemoval(listRef, DELETE_SELECTOR, Math.max(0, index), () =>
      addRef.current?.querySelector<HTMLElement>('[role="radio"][tabindex="0"]')
    );
  };

  /** Close the import panel, focus back on the button that opens it. */
  const closeImport = () => {
    setImporting(false);
    focusSoon(() => importRef.current);
  };

  const importRows = (rows: ImportRow[], duplicates: number) => {
    const created = rows.map((row): NpsResponse => ({ id: `nps_${nanoid(8)}`, ...row.response }));
    const ids = new Set(created.map((r) => r.id));
    undoable({
      label: `Imported ${responsesText(created.length)}`,
      description: duplicates > 0 ? `${duplicates} already saved, skipped.` : undefined,
      apply: () => {
        setResponses((list) => [...list, ...created]);
        log(NPS_CSAT_ACTIONS.RESPONSES_IMPORTED, { added: created.length, skipped: duplicates });
      },
      revert: () => setResponses((list) => list.filter((r) => !ids.has(r.id))),
    });
    closeImport();
    announce(`Imported ${responsesText(created.length)}`);
  };

  // Example answers are written like any other but never logged, and
  // "Clear example" takes out exactly those.
  const loadExample = () => setResponses((list) => [...list, ...buildExample(now)]);
  const clearExample = () => {
    setResponses((list) => list.filter((r) => !isExampleId(r.id)));
    setTag(null);
  };

  const chooseTag = (next: string | null) => {
    setTag(next);
    setLimit(LIST_PAGE);
    announce(next ? `Showing responses tagged ${next}` : "Showing every response");
  };

  /* ── Cards ────────────────────────────────────────────────────────── */

  const npsCard = npsHead
    ? {
        value: signed(npsHead.nps.score as number),
        hint: `${npsHead.label}, ${responsesText(npsHead.nps.n)}. All-time ${signed(nps.score as number)} from ${nps.n}.`,
      }
    : nps.score !== null
      ? {
          value: signed(nps.score),
          hint: `All-time, ${responsesText(nps.n)}: no ${by} has ${MIN_SAMPLE.surveyPeriod} yet.`,
        }
      : { value: "—", hint: "No NPS responses" };
  const csatCard = csatHead
    ? {
        value: `${csatHead.csat.satisfiedPct}%`,
        hint: `Satisfied (4–5) in ${csatHead.label}, ${responsesText(csatHead.csat.n)}. All-time ${csat.satisfiedPct}% from ${csat.n}.`,
      }
    : csat.satisfiedPct !== null
      ? {
          value: `${csat.satisfiedPct}%`,
          hint: `Satisfied (4–5), all-time, ${responsesText(csat.n)}: no ${by} has ${MIN_SAMPLE.surveyPeriod} yet.`,
        }
      : { value: "—", hint: "No CSAT responses" };
  const latestN = latest ? latest.nps.n + latest.csat.n : 0;

  const tagColumns: DataTableColumn<TagCount>[] = [
    {
      key: "tag",
      header: "Tag",
      primary: true,
      cell: (t) => (
        <button
          type="button"
          className="text-left font-medium text-accent hover:underline"
          onClick={() => chooseTag(t.tag)}
        >
          {t.tag}
        </button>
      ),
      sortValue: (t) => t.tag,
    },
    { key: "n", header: "Responses", align: "right", cell: (t) => t.n, sortValue: (t) => t.n },
    {
      key: "unhappy",
      header: "Unhappy",
      align: "right",
      cell: (t) => t.unhappy,
      sortValue: (t) => t.unhappy,
    },
    {
      key: "nps",
      header: "NPS",
      align: "right",
      cell: tagNpsText,
      sortValue: (t) => (t.nps.n >= MIN_SAMPLE.surveyPeriod ? t.nps.score : null),
    },
    {
      key: "csat",
      header: "CSAT satisfied",
      align: "right",
      cell: tagCsatText,
      sortValue: (t) => (t.csat.n >= MIN_SAMPLE.surveyPeriod ? t.csat.satisfiedPct : null),
    },
  ];

  return (
    <ToolPageWrapper
      toolId="nps-csat"
      title="NPS / CSAT Tracker"
      description="Net Promoter Score and CSAT (% satisfied) per week or month, with each period's response count, imports from CSV and theme tags on what customers wrote."
      category="Outcomes & Pulse"
    >
      {hasExampleItems(responses) && <ExampleNotice onClear={clearExample} />}
      <ActionRow>
        <AiPromptGenerator config={promptConfig} />
        <ExportButton
          filename="nps-csat"
          csvData={{
            headers: ["Date", "Kind", "Score", "Category", "Respondent", "Verbatim", "Tags"],
            rows: shown.map((r) => [
              String(r.date ?? "").slice(0, 10),
              r.kind,
              r.score,
              categoryOf(r),
              r.respondent ?? "",
              r.verbatim ?? "",
              (r.tags ?? []).join(", "),
            ]),
          }}
          jsonData={responses}
          markdown={markdown}
          // The PNG item shows only while the chart is on screen.
          targetRef={showChart ? chartRef : undefined}
        />
        <Button
          ref={importRef}
          type="button"
          variant="outline"
          className="gap-2"
          aria-expanded={importing}
          onClick={() => setImporting((v) => !v)}
        >
          <Upload className="h-4 w-4" aria-hidden="true" />
          Import CSV
        </Button>
        {responses.length > 0 && (
          <ResetButton
            label="Clear all"
            title="Clear every response?"
            description={`All ${responsesText(responses.length)} go, imported ones included. You can undo it for a few seconds.`}
            confirmLabel="Clear responses"
            doneLabel={`Cleared ${responsesText(responses.length)}`}
            onReset={() => {
              cleared.current = useWorkspaceStore.getState().npsResponses ?? [];
              setResponses(() => []);
              setTag(null);
              log(NPS_CSAT_ACTIONS.SURVEY_RESET, { removed: cleared.current.length });
            }}
            onUndo={() =>
              setResponses((list) => {
                // Answers added since the clear stay; the cleared ones come back first.
                const added = new Set(list.map((r) => r.id));
                return [...cleared.current.filter((r) => !added.has(r.id)), ...list];
              })
            }
          />
        )}
      </ActionRow>

      <div className="space-y-4">
        {importing && (
          <SectionCard title="Import responses" icon={Upload}>
            <ImportPanel
              existing={responses}
              today={today}
              onImport={importRows}
              onClose={closeImport}
            />
          </SectionCard>
        )}

        {responses.length > 0 && (
          <>
            {activeTag && (
              <div className="flex flex-wrap items-center gap-2 rounded-md border border-accent/40 bg-accent/10 px-3 py-2 text-sm text-text">
                <Tags className="h-4 w-4 shrink-0 text-accent" aria-hidden="true" />
                <span className="min-w-0 flex-1">
                  Showing only responses tagged “{activeTag}”: every number below reads them alone.
                </span>
                <Button
                  type="button"
                  size="sm"
                  variant="ghost"
                  className="gap-1"
                  onClick={() => chooseTag(null)}
                >
                  <X className="h-3.5 w-3.5" aria-hidden="true" />
                  Show every response
                </Button>
              </div>
            )}
            <p className="text-sm font-medium text-text">{verdict}</p>
            <KpiGrid cols={3} gap="lg">
              <StatCard
                variant="compact"
                label="NPS"
                value={npsCard.value}
                hint={tagged(npsCard.hint)}
                valueClassName="text-4xl text-accent"
              />
              <StatCard
                variant="compact"
                label="CSAT satisfied"
                value={csatCard.value}
                hint={tagged(csatCard.hint)}
                valueClassName="text-4xl text-accent"
              />
              <StatCard
                variant="compact"
                label={by === "week" ? "This week" : "This month"}
                value={latestN}
                hint={tagged(
                  latest
                    ? `${latest.label}: ${latest.nps.n} NPS, ${latest.csat.n} CSAT`
                    : "No dated responses"
                )}
                valueClassName="text-4xl text-text"
              />
            </KpiGrid>
            {warning && (
              <p
                role="status"
                className="rounded-md border border-warning/40 bg-warning/10 px-3 py-2 text-sm text-text"
              >
                {warning}
              </p>
            )}
            {(series.undated > 0 || series.offScale > 0) && (
              <p className="text-xs text-sub">
                {series.undated > 0 &&
                  `${series.undated === 1 ? "1 response has" : `${series.undated} responses have`} no valid date: counted in the totals, in no ${by}. `}
                {series.offScale > 0 &&
                  `${series.offScale === 1 ? "1 response has a score" : `${series.offScale} responses have scores`} off the scale, left out of every number.`}
              </p>
            )}
          </>
        )}

        <SectionCard title="Add a response" icon={Plus}>
          <div ref={addRef}>
            <ResponseForm
              initial={emptyResponse(today)}
              today={today}
              submitLabel="Add response"
              onSave={add}
            />
          </div>
        </SectionCard>

        {responses.length === 0 ? (
          <EmptyState
            icon={MessageSquareQuote}
            action={
              <div className="flex flex-wrap justify-center gap-2">
                <LoadExampleButton onLoad={loadExample} />
                <Button
                  type="button"
                  variant="outline"
                  size="sm"
                  className="gap-1"
                  onClick={() => setImporting(true)}
                >
                  <Upload className="h-4 w-4" aria-hidden="true" />
                  Import a CSV
                </Button>
              </div>
            }
          >
            No responses yet. Add one above, import a survey export, or load an example to see
            months of answers.
          </EmptyState>
        ) : (
          <>
            <SectionCard title="Score trend" icon={BarChart3}>
              <div className="mb-3 flex flex-wrap items-center gap-3">
                <span className="text-sm text-sub" aria-hidden="true">
                  Group by
                </span>
                <ToggleGroup
                  label="Group by"
                  size="sm"
                  options={PERIODS}
                  value={by}
                  onValueChange={(v) => {
                    setBy(v);
                    announce(`Grouped by ${v}`);
                  }}
                />
              </div>
              <h3 id={chartTitleId} className="sr-only">
                NPS and CSAT by {by}
              </h3>
              {showChart ? (
                <>
                  <ChartFigure
                    labelledBy={chartTitleId}
                    summary={trendText.summary}
                    table={trendText.table}
                    plotRef={chartRef}
                    plotClassName="h-[240px]"
                  >
                    <ScoreTrendChart points={series.points} />
                  </ChartFigure>
                  <p className="mt-2 text-xs text-sub">
                    A hollow dot is a {by} with fewer than {MIN_SAMPLE.surveyPeriod} responses of
                    its kind: one answer moves it by 100 ÷ n points.
                  </p>
                </>
              ) : (
                <NotEnoughData
                  have={series.points.length}
                  need={CHART_MIN_PERIODS}
                  unit={
                    by === "week"
                      ? ["week of answers", "weeks of answers"]
                      : ["month of answers", "months of answers"]
                  }
                  action="Collect"
                  what="the trend"
                />
              )}
            </SectionCard>

            {(mkNps || mkCsat) && (
              <AdvancedAnalysis>
                {[
                  { label: "NPS", mk: mkNps, shifts: shiftsNps, n: steadyNps.length },
                  {
                    label: "CSAT % satisfied",
                    mk: mkCsat,
                    shifts: shiftsCsat,
                    n: steadyCsat.length,
                  },
                ].map(
                  (s) =>
                    s.mk && (
                      <div key={s.label} className="space-y-1 text-sm">
                        <p className="text-text">
                          {s.label}:{" "}
                          {s.mk.significant && s.mk.trend !== "none"
                            ? `trending ${s.mk.trend} across ${s.n} ${by}s with enough responses (Mann-Kendall, p = ${s.mk.pValue.toFixed(3)}).`
                            : `no clear trend across ${s.n} ${by}s with enough responses (Mann-Kendall, p = ${s.mk.pValue.toFixed(3)}).`}
                        </p>
                        {s.shifts !== null && (
                          <p className="text-xs text-sub">
                            {s.shifts.length === 0
                              ? "No sustained shift (CUSUM)."
                              : `CUSUM marks ${s.shifts.length === 1 ? "a sustained shift" : `${s.shifts.length} sustained shifts`}: ${s.shifts.map((c) => `${c.direction === "up" ? "a lift" : "a drop"} at the ${ordinal(c.index + 1)} of those ${by}s`).join(", ")}.`}
                          </p>
                        )}
                      </div>
                    )
                )}
                <p className="text-xs text-sub">
                  Only {by}s with {MIN_SAMPLE.surveyPeriod}+ responses count; the trend test needs{" "}
                  {MIN_SAMPLE.trend} of them and the shift test {MIN_SAMPLE.changePoint}.
                </p>
              </AdvancedAnalysis>
            )}

            {tags.length > 0 && (
              <SectionCard title="Themes" icon={Tags}>
                <div role="group" aria-label="Filter by tag" className="mb-3 flex flex-wrap gap-1">
                  <Button
                    type="button"
                    size="sm"
                    variant={activeTag === null ? "default" : "outline"}
                    aria-pressed={activeTag === null}
                    onClick={() => chooseTag(null)}
                  >
                    All
                    <span className="ml-1 font-mono text-xs opacity-80">{responses.length}</span>
                  </Button>
                  {tags.map((t) => (
                    <Button
                      key={t.tag}
                      type="button"
                      size="sm"
                      variant={activeTag === t.tag ? "default" : "outline"}
                      aria-pressed={activeTag === t.tag}
                      onClick={() => chooseTag(activeTag === t.tag ? null : t.tag)}
                    >
                      {t.tag}
                      <span className="ml-1 font-mono text-xs opacity-80">{t.n}</span>
                    </Button>
                  ))}
                </div>
                <DataTable
                  caption="Responses per tag"
                  columns={tagColumns}
                  rows={tags}
                  rowKey={(t) => t.tag}
                />
                <p className="mt-2 text-xs text-sub">
                  Unhappy: NPS detractors (0–6) and CSAT 1–2. A tag&apos;s score shows from{" "}
                  {MIN_SAMPLE.surveyPeriod} responses.{" "}
                  {pointer && (
                    <>
                      In the last {RECENT_DAYS} days, most unhappy answers mention “{pointer.tag}” (
                      {pointer.unhappy}):{" "}
                      <Link
                        href="/hypothesis-tracker"
                        className="font-medium text-accent hover:underline"
                      >
                        test a fix in the Hypothesis Tracker
                      </Link>
                      .
                    </>
                  )}
                </p>
              </SectionCard>
            )}

            <section aria-labelledby={`${chartTitleId}-list`} className="space-y-2">
              <div className="flex flex-wrap items-center justify-between gap-2">
                <h2 id={`${chartTitleId}-list`} className="text-sm font-semibold text-text">
                  {activeTag ? `Responses tagged “${activeTag}”` : "Responses"}{" "}
                  <span className="font-normal text-sub">({shown.length})</span>
                </h2>
                {activeTag && (
                  <Button
                    type="button"
                    size="sm"
                    variant="ghost"
                    className="gap-1"
                    onClick={() => chooseTag(null)}
                  >
                    <X className="h-3.5 w-3.5" aria-hidden="true" />
                    Show every response
                  </Button>
                )}
              </div>
              <ResortChip isStale={order.isStale} onResort={order.resort} what="Dates" />
              <ul ref={listRef} className="space-y-2">
                {listed.map((r) => (
                  <ResponseRow
                    key={r.id}
                    response={r}
                    today={today}
                    onEdit={(values) => edit(r, values)}
                    onDelete={() => remove(r)}
                    onTag={(t) => chooseTag(t)}
                  />
                ))}
              </ul>
              {order.ordered.length > limit && (
                <Button
                  type="button"
                  variant="outline"
                  size="sm"
                  onClick={() => setLimit((l) => l + LIST_PAGE)}
                >
                  Show {Math.min(LIST_PAGE, order.ordered.length - limit)} more of{" "}
                  {order.ordered.length - limit}
                </Button>
              )}
            </section>
          </>
        )}
      </div>
    </ToolPageWrapper>
  );
}

/** "1st", "2nd", "3rd", "4th"… */
function ordinal(n: number): string {
  const s = n % 100 >= 11 && n % 100 <= 13 ? "th" : (["th", "st", "nd", "rd"][n % 10] ?? "th");
  return `${n}${s}`;
}
