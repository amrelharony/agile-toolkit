"use client";

import { useId, useMemo, useRef, useState } from "react";
import dynamic from "next/dynamic";
import { AlertTriangle, BarChart2, ListChecks, Trash2, TrendingUp } from "lucide-react";
import { ToolPageWrapper } from "@/components/layout/tool-page-wrapper";
import { AiPromptGenerator } from "@/components/shared/ai-prompt-generator";
import { ChartCard } from "@/components/shared/chart-card";
import { ConfirmDialog } from "@/components/shared/confirm-dialog";
import { EmptyState } from "@/components/shared/empty-state";
import { ExportButton } from "@/components/shared/export-button";
import { SectionCard } from "@/components/shared/section-card";
import { ExampleNotice, LoadExampleButton } from "@/components/tool-frame/example-data";
import { Button } from "@/components/ui/button";
import { IconButton } from "@/components/ui/icon-button";
import { useChartHeight } from "@/hooks/use-chart-height";
import { generateBurnupPrompts } from "@/lib/ai-prompts/burnup";
import { BURNUP_ACTIONS } from "@/lib/history/event-actions";
import { useHistoryLogger, type HistoryLogger } from "@/lib/history/use-history-logger";
import { useToolSonification } from "@/lib/sonification/use-sonification";
import {
  burnSeries,
  burnStatus,
  churnLine,
  offDayRanges,
  type BurnSeries,
} from "@/lib/sprints/burn";
import { fmt } from "@/lib/sprints/hub-view";
import { dayDate } from "@/lib/sprints/series";
import type { Sprint, SprintDay } from "@/lib/stores/workspace-types";
import { undoable } from "@/lib/utils/undoable";
import { BurnAdvanced } from "../burndown/advanced";
import { BurnTiles, SourceBadge, SourceBar, offLabel } from "../burndown/burn-ui";
import {
  clearDay,
  clearLog,
  restoreDay,
  restoreLog,
  writeBurnupDay,
} from "../burndown/series-writes";
import {
  DerivedCaption,
  DraftInput,
  SprintSettings,
  SprintToolShell,
  formatPoints,
  shortDate,
  type SprintSettingsChange,
  type SprintToolContext,
} from "../burndown/sprint-shell";
import { burnupChartText, type BurnupTextRow } from "./chart-text";
import { exampleBurnup } from "./example";
import { burnupMarkdown } from "./markdown";
import { burnupTiles } from "./tiles";
import { completedWarning, validateCompleted, validateScope } from "./validate";
import { burnupView } from "./view";

// Recharts loads with the chart, not the page. ChartCard reserves the
// chart's height while the chunk loads.
const BurnupChart = dynamic(() => import("./charts").then((m) => m.BurnupChart), {
  ssr: false,
});

type Log = HistoryLogger["log"];

/* -------------------------------------------------------------------------- */
/*  The typed daily log                                                        */
/* -------------------------------------------------------------------------- */

function BurnupLog({
  sprint,
  series,
  burn,
  readOnly,
  log,
  announce,
}: Pick<SprintToolContext, "sprint" | "series" | "readOnly"> & {
  burn: BurnSeries;
  log: Log;
  announce: (message: string) => void;
}) {
  const sonify = useToolSonification("burnup");
  const rowsId = useId();
  const [confirmClearOpen, setConfirmClearOpen] = useState(false);
  const view = useMemo(() => burnupView(sprint, series), [sprint, series]);
  const { entries } = view;
  const loggedDays = entries.filter((e) => e.stored).length;
  const ignored = burn.source === "stories";

  const setScope = (day: number, raw: string, scopeBefore: number) => {
    if (readOnly) return null;
    const parsed = validateScope(raw);
    if (!parsed.ok) return parsed.error;
    const n = parsed.value;
    if (!writeBurnupDay(sprint.id, day, { scope: n })) return null;
    log(BURNUP_ACTIONS.SCOPE_CHANGED, { sprintId: sprint.id, day, scope: n });
    if (n !== null && n > scopeBefore) sonify("scope-increase");
    announce(
      n === null ? `Day ${day}'s scope cleared.` : `Day ${day}: scope ${formatPoints(n)} points.`
    );
    return null;
  };

  const setCompleted = (day: number, raw: string) => {
    if (readOnly) return null;
    const parsed = validateCompleted(raw);
    if (!parsed.ok) return parsed.error;
    const n = parsed.value;
    const write = writeBurnupDay(sprint.id, day, { completed: n });
    if (write && n !== null && write.before?.completed == null) {
      log(BURNUP_ACTIONS.DAY_LOGGED, { sprintId: sprint.id, day, completed: n });
      sonify("day-logged");
    }
    announce(n === null ? `Day ${day} cleared.` : `Day ${day}: ${formatPoints(n)} points done.`);
    return null;
  };

  const setNote = (day: number, note: string) => {
    if (!readOnly) writeBurnupDay(sprint.id, day, { note });
  };

  const clearOneDay = (day: number) => {
    if (readOnly) return;
    let removed: SprintDay | undefined;
    undoable({
      label: `Cleared day ${day}`,
      apply: () => {
        removed = clearDay(sprint.id, day);
        if (removed) log(BURNUP_ACTIONS.DAY_REMOVED, { sprintId: sprint.id, day });
      },
      revert: () => {
        if (removed) restoreDay(sprint.id, removed);
      },
    });
  };

  const clearWholeLog = () => {
    if (readOnly) return;
    let previous: SprintDay[] = [];
    undoable({
      label: `Cleared the log of ${sprint.name}`,
      apply: () => {
        previous = clearLog(sprint.id);
        log(BURNUP_ACTIONS.BURNUP_RESET, { sprintId: sprint.id, days: previous.length });
      },
      revert: () => restoreLog(sprint.id, previous),
    });
  };

  return (
    <div>
      <div className="mb-3 flex flex-wrap items-center justify-between gap-2">
        <p className="max-w-prose text-xs text-sub">
          {ignored
            ? "Used only while the sprint has no pointed stories: numbers typed here are not used while the board has them."
            : "At the end of each day, log the points done so far. Day 0 is the first day of the sprint."}
        </p>
        <Button
          variant="danger-ghost"
          size="sm"
          disabled={readOnly || loggedDays === 0}
          onClick={() => setConfirmClearOpen(true)}
        >
          Clear log
        </Button>
      </div>

      {/* One compact row per day; the note is a single-line input to keep
          the rhythm of the tracker. */}
      <div className="mb-2 hidden grid-cols-[96px_1fr_1fr_1.2fr_auto] gap-3 border-b border-border px-1 pb-2 sm:grid">
        <span className="text-xs font-medium uppercase tracking-wider text-sub">Day</span>
        <span className="text-xs font-medium uppercase tracking-wider text-sub">
          Scope (total pts)
        </span>
        <span className="text-xs font-medium uppercase tracking-wider text-sub">
          Completed (pts)
        </span>
        <span className="text-xs font-medium uppercase tracking-wider text-sub">Note</span>
        <span className="w-9" />
      </div>

      <div className="space-y-2">
        {entries.map((e) => {
          const scopeCaptionId = `${rowsId}-scope-${e.day}`;
          const doneCaptionId = `${rowsId}-done-${e.day}`;
          const warningId = `${rowsId}-warn-${e.day}`;
          const ignoredId = `${rowsId}-ignored-${e.day}`;
          const planScope = e.day === 0 && e.typedScope === null;
          const date = shortDate(dayDate(sprint, e.day));
          const off = burn.days[e.day] ? offLabel(burn.days[e.day]) : null;
          const warning = completedWarning(entries, e.day);
          const typedSomething = e.typedCompleted !== null || e.typedScope !== null;
          const doneDescribedBy =
            [
              e.derivedCompleted !== null ? doneCaptionId : null,
              warning ? warningId : null,
              ignored && typedSomething ? ignoredId : null,
            ]
              .filter(Boolean)
              .join(" ") || undefined;
          return (
            <div
              key={e.id}
              className="grid grid-cols-[1fr_auto] gap-2 rounded-md border border-border p-2 sm:grid-cols-[96px_1fr_1fr_1.2fr_auto] sm:items-start sm:gap-3 sm:border-0 sm:p-0"
            >
              <div className="flex flex-col sm:pt-1.5">
                <span className="font-data text-sm font-semibold text-accent">Day {e.day}</span>
                <span className="text-xs text-sub">
                  {e.afterEnd ? `${date}, after the end` : date}
                  {off ? ` · ${off}` : ""}
                </span>
              </div>

              <IconButton
                label={`Clear day ${e.day}`}
                icon={<Trash2 className="h-4 w-4" aria-hidden="true" />}
                variant="danger-ghost"
                disabled={readOnly || !e.stored}
                onClick={() => clearOneDay(e.day)}
                className="min-touch-coarse h-9 w-9 justify-self-end disabled:opacity-30 sm:order-last"
              />

              <div className="col-span-2 sm:col-span-1">
                <DraftInput
                  type="number"
                  inputMode="decimal"
                  min={0}
                  aria-label={`Scope points on day ${e.day}`}
                  aria-describedby={planScope ? scopeCaptionId : undefined}
                  // A blank day carries the scope forward; show it dimmed.
                  placeholder={formatPoints(e.scopeInForce)}
                  value={e.typedScope === null ? "" : String(e.typedScope)}
                  readOnly={readOnly}
                  onCommit={(v) => setScope(e.day, v, e.scopeInForce)}
                  className="font-data focus:border-accent-magenta/50 focus:ring-accent-magenta/20"
                />
                {planScope && (
                  <DerivedCaption id={scopeCaptionId} value={e.scopeInForce} from="the plan" />
                )}
              </div>

              <div className="col-span-2 sm:col-span-1">
                <DraftInput
                  type="number"
                  inputMode="decimal"
                  min={0}
                  aria-label={`Completed points on day ${e.day}`}
                  aria-describedby={doneDescribedBy}
                  placeholder={
                    e.derivedCompleted !== null
                      ? formatPoints(e.derivedCompleted)
                      : e.day === 0
                        ? "0"
                        : "— pts"
                  }
                  value={e.typedCompleted === null ? "" : String(e.typedCompleted)}
                  readOnly={readOnly}
                  onCommit={(v) => setCompleted(e.day, v)}
                  className="font-data"
                />
                {e.derivedCompleted !== null && (
                  <DerivedCaption id={doneCaptionId} value={e.derivedCompleted} from="Burndown" />
                )}
                {warning && (
                  <p id={warningId} className="mt-1 text-xs text-warning">
                    {warning}
                  </p>
                )}
                {ignored && typedSomething && (
                  <p id={ignoredId} className="mt-1 text-xs text-sub">
                    Not used while the board has pointed stories
                  </p>
                )}
              </div>

              {ignored ? (
                // The note is the day's, shared: while the board is the
                // source it is edited in the board's rows above.
                <p className="col-span-2 text-xs text-sub sm:col-span-1 sm:pt-2.5">
                  {e.description ?? ""}
                </p>
              ) : (
                <DraftInput
                  type="text"
                  placeholder="Optional note"
                  aria-label={`Note for day ${e.day}`}
                  value={e.description ?? ""}
                  readOnly={readOnly}
                  maxLength={280}
                  onCommit={(v) => setNote(e.day, v)}
                  wrapperClassName="col-span-2 sm:col-span-1"
                  className="text-xs"
                />
              )}
            </div>
          );
        })}
      </div>

      <p className="mt-4 text-xs text-sub">
        Completed is a running total. Enter scope only on days it changes: the chart carries it
        forward from the planned points. A dimmed number was logged in Burndown; type over it to use
        your own.
      </p>

      <ConfirmDialog
        open={confirmClearOpen}
        onOpenChange={setConfirmClearOpen}
        title="Clear the log?"
        description={`The ${loggedDays} logged day${loggedDays === 1 ? "" : "s"} of ${sprint.name} ${
          loggedDays === 1 ? "is" : "are"
        } cleared, here and in Burndown. The sprint and its settings stay.`}
        confirmLabel="Clear log"
        onConfirm={clearWholeLog}
      />
    </div>
  );
}

/* -------------------------------------------------------------------------- */
/*  The board's days                                                           */
/* -------------------------------------------------------------------------- */

/** The days as the board tells them, read-only; the shared note stays editable. */
function BoardDays({
  sprint,
  burn,
  readOnly,
}: {
  sprint: Sprint;
  burn: BurnSeries;
  readOnly: boolean;
}) {
  const shown = burn.days.filter((d) => d.done !== null);
  if (shown.length === 0) {
    return (
      <p className="text-sm text-sub">
        {burn.phase === "before"
          ? "The sprint hasn't started: its days fill in from the board once it does."
          : "Nothing on the board to read by day yet."}
      </p>
    );
  }
  return (
    <ul className="space-y-2" aria-label="Scope and points done by day, from the board">
      {shown.map((d) => {
        const off = offLabel(d);
        const moves = [
          d.added > 0 ? `+${fmt(d.added)} added` : "",
          d.removed > 0 ? `−${fmt(d.removed)} removed` : "",
        ].filter(Boolean);
        return (
          <li
            key={d.day}
            className="grid grid-cols-1 gap-2 rounded-md border border-border p-2 sm:grid-cols-[120px_1fr_1.2fr] sm:items-center sm:gap-3"
          >
            <div className="flex flex-col">
              <span className="font-data text-sm font-semibold text-accent">Day {d.day}</span>
              <span className="text-xs text-sub">
                {shortDate(d.date)}
                {off ? ` · ${off}` : ""}
              </span>
            </div>
            <p className="text-sm text-text">
              <span className="font-data font-semibold">{fmt(d.done ?? 0)}</span> of{" "}
              {fmt(d.scope ?? 0)} done
              {moves.length > 0 && <span className="text-sub"> · {moves.join(", ")}</span>}
            </p>
            <DraftInput
              type="text"
              placeholder="Optional note"
              aria-label={`Note for day ${d.day}`}
              value={d.note ?? ""}
              readOnly={readOnly}
              maxLength={280}
              onCommit={(v) => {
                if (!readOnly) writeBurnupDay(sprint.id, d.day, { note: v });
              }}
              className="text-xs"
            />
          </li>
        );
      })}
    </ul>
  );
}

/* -------------------------------------------------------------------------- */
/*  One sprint                                                                 */
/* -------------------------------------------------------------------------- */

function BurnupSprint({
  sprint,
  series,
  stories,
  calendar,
  today,
  readOnly,
  log,
}: SprintToolContext & { log: Log }) {
  const chartRef = useRef<HTMLDivElement>(null);
  const chartHeight = useChartHeight({ min: 260, max: 420 });
  const [prefer, setPrefer] = useState<"stories" | "log" | undefined>(undefined);
  const [announcement, setAnnouncement] = useState("");

  const burn = useMemo(
    () => burnSeries({ sprint, series, stories, calendar, today, prefer }),
    [sprint, series, stories, calendar, today, prefer]
  );
  const status = useMemo(() => burnStatus(burn, sprint), [burn, sprint]);

  const chooseSource = (source: "stories" | "log") => {
    if (source === burn.source) return;
    setPrefer(source);
    if (!readOnly) log(BURNUP_ACTIONS.SOURCE_SWITCHED, { sprintId: sprint.id, source });
    setAnnouncement(source === "stories" ? "Showing the sprint board." : "Showing the typed log.");
  };

  const onSettingsChanged = (change: SprintSettingsChange) =>
    log(BURNUP_ACTIONS.CONFIG_UPDATED, { sprintId: sprint.id, ...change });

  /* -- Chart --------------------------------------------------------------- */

  const rows = useMemo<BurnupTextRow[]>(
    () =>
      burn.days.map((d) => ({
        day: d.day,
        scope: d.scope,
        // The log's day 0 counts nothing done yet; a blank later day stays blank.
        completed: d.done,
        off: d.off,
        added: d.added,
        removed: d.removed,
      })),
    [burn]
  );
  const chartText = useMemo(() => burnupChartText(rows), [rows]);
  const offDays = useMemo(() => offDayRanges(burn), [burn]);
  const scopeMoves = useMemo(
    () =>
      burn.days
        .filter((d) => d.added > 0 || d.removed > 0)
        .map((d) => ({ day: d.day, added: d.added, removed: d.removed })),
    [burn]
  );
  const churned = burn.scopeAdded > 0 || burn.scopeRemoved > 0;

  /* -- Export -------------------------------------------------------------- */

  const csvData = useMemo(
    () => ({
      headers: [
        "Day",
        "Date",
        "Day off",
        "Source",
        "Scope (pts)",
        "Completed (pts)",
        "Added",
        "Removed",
        "Note",
      ],
      rows: burn.days.map((d) => [
        d.day,
        d.date ?? "",
        offLabel(d) ?? "",
        d.from ?? "",
        d.scope ?? "",
        d.done ?? "",
        d.added || "",
        d.removed || "",
        d.note ?? "",
      ]),
    }),
    [burn]
  );
  const markdown = useMemo(() => burnupMarkdown({ sprint, burn, status }), [sprint, burn, status]);
  const promptConfig = useMemo(() => {
    const config = burnupView(sprint, series).config;
    const entries = burn.days.map((d) => ({
      id: `${sprint.id}:day-${d.day}`,
      day: d.day,
      scope: d.scope,
      completed: d.done,
      ...(d.note ? { description: d.note } : {}),
    }));
    return { toolName: "Burnup Chart", prompts: generateBurnupPrompts({ config, entries }) };
  }, [sprint, series, burn]);

  /* -- Render -------------------------------------------------------------- */

  const churn = churnLine(burn);
  return (
    <div className="space-y-6">
      <p data-burn-verdict aria-live="polite" className="text-sm font-medium text-text">
        {status.scopeVerdict}
      </p>
      <p aria-live="polite" className="sr-only">
        {announcement}
      </p>

      <SourceBar burn={burn} sprint={sprint} onChoose={chooseSource} />

      <BurnTiles tiles={burnupTiles(sprint, burn, status)} />

      <ChartCard
        title="Burnup chart"
        icon={BarChart2}
        badge={<SourceBadge source={burn.source} />}
        height={chartHeight}
        chartContainerRef={chartRef}
        summary={chartText.summary}
        table={chartText.table}
        headerExtras={
          <>
            <AiPromptGenerator config={promptConfig} />
            <ExportButton
              filename="burnup-chart"
              csvData={csvData}
              markdown={markdown}
              targetRef={chartRef}
            />
          </>
        }
        footer={
          churned ? (
            <div className="flex items-center gap-2 rounded-md border border-accent-amber/20 bg-accent-amber/8 px-3 py-2 text-xs text-accent-amber">
              <AlertTriangle className="h-3.5 w-3.5 shrink-0" aria-hidden="true" />
              {`${churn.charAt(0).toUpperCase()}${churn.slice(1)} (${fmt(burn.initialScope)} → ${fmt(
                burn.scopeNow
              )}).`}
            </div>
          ) : null
        }
      >
        <BurnupChart
          data={rows}
          todayDay={burn.todayDay}
          offDays={offDays}
          scopeMoves={scopeMoves}
        />
      </ChartCard>

      <BurnAdvanced burn={burn} pick="done" trend />

      {burn.source === "stories" ? (
        <SectionCard title="Daily data" icon={TrendingUp} titleSize="lg" headerClassName="pb-4">
          <BoardDays sprint={sprint} burn={burn} readOnly={readOnly} />
          <details className="group mt-4 rounded-lg border border-border">
            <summary className="flex min-h-11 cursor-pointer select-none list-none items-center gap-2 px-3 py-2 text-sm font-medium text-text [&::-webkit-details-marker]:hidden">
              <ListChecks className="h-4 w-4 text-sub" aria-hidden="true" />
              Daily log (fallback)
            </summary>
            <div className="border-t border-border p-3">
              <BurnupLog
                sprint={sprint}
                series={series}
                burn={burn}
                readOnly={readOnly}
                log={log}
                announce={setAnnouncement}
              />
            </div>
          </details>
        </SectionCard>
      ) : (
        <SectionCard title="Daily data" icon={TrendingUp} titleSize="lg" headerClassName="pb-4">
          <BurnupLog
            sprint={sprint}
            series={series}
            burn={burn}
            readOnly={readOnly}
            log={log}
            announce={setAnnouncement}
          />
        </SectionCard>
      )}

      <SprintSettings
        tool="burnup"
        sprint={sprint}
        calendar={calendar}
        readOnly={readOnly}
        onChanged={onSettingsChanged}
      />
    </div>
  );
}

/* -------------------------------------------------------------------------- */
/*  Page                                                                       */
/* -------------------------------------------------------------------------- */

export function BurnupClient() {
  const { log } = useHistoryLogger("burnup");

  return (
    <ToolPageWrapper
      toolId="burnup"
      title="Burnup Generator"
      description="Visualise completed work climbing toward total scope. Scope creep is immediately visible when the scope line rises."
      category="Metrics & Dashboards"
    >
      <SprintToolShell
        tool="burnup"
        example={exampleBurnup}
        renderEmpty={({ onCreate, onLoadExample }) => (
          <EmptyState
            icon={TrendingUp}
            padding="xl"
            action={
              <div className="flex flex-wrap justify-center gap-2">
                <Button type="button" variant="toolkit" onClick={onCreate}>
                  Create your first sprint
                </Button>
                <LoadExampleButton onLoad={onLoadExample} />
              </div>
            }
          >
            <h2 className="font-display text-lg text-text">No sprints yet</h2>
            <p className="mx-auto mt-2 max-w-prose text-sm">
              Burnup charts a shared sprint&apos;s scope and the points done, read off its stories
              on the sprint board (or a typed daily log). Create one and Burndown, Velocity, Sprint
              Metrics and the Sprint cockpit see it too.
            </p>
          </EmptyState>
        )}
        renderNotice={({ onStart, onClear }) => (
          <div>
            <ExampleNotice onClear={onClear} />
            <div className="-mt-2 flex flex-wrap items-center gap-3">
              <p className="min-w-0 flex-1 text-xs text-sub">
                Example sprint: a read-only preview. Nothing in it can be changed or saved, and your
                own sprints stay as they are.
              </p>
              <Button type="button" size="sm" variant="toolkit" onClick={onStart}>
                Start your own
              </Button>
            </div>
          </div>
        )}
        onSettingsChanged={(sprintId, change) =>
          log(BURNUP_ACTIONS.CONFIG_UPDATED, { sprintId, ...change })
        }
      >
        {(ctx) => <BurnupSprint key={ctx.sprint.id} {...ctx} log={log} />}
      </SprintToolShell>
    </ToolPageWrapper>
  );
}
