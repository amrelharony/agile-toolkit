"use client";

import { useId, useMemo, useRef, useState } from "react";
import dynamic from "next/dynamic";
import { BarChart3, ChevronDown, Flag, ListChecks, Trash2, TrendingDown } from "lucide-react";
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
import { generateBurndownPrompts } from "@/lib/ai-prompts/burndown";
import { BURNDOWN_ACTIONS } from "@/lib/history/event-actions";
import { useHistoryLogger, type HistoryLogger } from "@/lib/history/use-history-logger";
import { useToolSonification } from "@/lib/sonification/use-sonification";
import { burnSeries, burnStatus, offDayRanges, type BurnSeries } from "@/lib/sprints/burn";
import { fmt } from "@/lib/sprints/hub-view";
import { dayDate } from "@/lib/sprints/series";
import type { Sprint, SprintDay } from "@/lib/stores/workspace-types";
import { undoable } from "@/lib/utils/undoable";
import { BurnAdvanced } from "./advanced";
import { BurnTiles, SourceBadge, SourceBar, offLabel } from "./burn-ui";
import { burnChartText, type BurndownTextRow } from "./chart-text";
import { exampleBurndown } from "./example";
import { burndownMarkdown, sourceLine } from "./markdown";
import {
  clearDay,
  clearLog,
  restoreDay,
  restoreLog,
  toggleScopeChange,
  writeBurndownDay,
} from "./series-writes";
import {
  DerivedCaption,
  DraftInput,
  SprintSettings,
  SprintToolShell,
  formatPoints,
  shortDate,
  type SprintSettingsChange,
  type SprintToolContext,
} from "./sprint-shell";
import { burndownTiles } from "./tiles";
import { validateRemaining } from "./validate";
import { burndownView } from "./view";

// Recharts loads with the chart, not the page. ChartCard reserves the
// chart's height while the chunk loads.
const BurndownChart = dynamic(() => import("./charts").then((m) => m.BurndownChart), {
  ssr: false,
});

type Log = HistoryLogger["log"];

/* -------------------------------------------------------------------------- */
/*  The typed daily log                                                        */
/* -------------------------------------------------------------------------- */

function DailyLog({
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
  const sonify = useToolSonification("burndown");
  const rowsId = useId();
  const [confirmClearOpen, setConfirmClearOpen] = useState(false);
  const view = useMemo(() => burndownView(sprint, series), [sprint, series]);
  const loggedDays = view.entries.filter((e) => e.stored).length;
  const ignored = burn.source === "stories";

  const setRemaining = (day: number, raw: string) => {
    if (readOnly) return null;
    const parsed = validateRemaining(raw);
    if (!parsed.ok) return parsed.error;
    const n = parsed.value;
    const write = writeBurndownDay(sprint.id, day, { remaining: n });
    if (write && n !== null && write.before?.remaining == null) {
      log(BURNDOWN_ACTIONS.DAY_LOGGED, { sprintId: sprint.id, day, remaining: n });
      sonify("day-logged");
    }
    announce(n === null ? `Day ${day} cleared.` : `Day ${day}: ${formatPoints(n)} points left.`);
    return null;
  };

  const setNote = (day: number, note: string) => {
    if (!readOnly) writeBurndownDay(sprint.id, day, { note });
  };

  const flipScopeChange = (day: number) => {
    if (readOnly) return;
    const write = toggleScopeChange(sprint.id, day);
    if (!write) return;
    const on = Boolean(write.after?.scopeChange);
    log(BURNDOWN_ACTIONS.SCOPE_CHANGED, {
      sprintId: sprint.id,
      day,
      scopeChange: on,
      scope: write.after?.scope ?? null,
    });
    announce(
      on ? `Day ${day} marked as a scope change.` : `Day ${day} is no longer a scope change.`
    );
    if (on) sonify("scope-change");
  };

  const inputId = (day: number) => `${rowsId}-input-${day}`;

  const clearOneDay = (day: number) => {
    if (readOnly) return;
    // The button disables once its day is empty: focus goes to the day's input, not the page top.
    document.getElementById(inputId(day))?.focus();
    let removed: SprintDay | undefined;
    undoable({
      label: `Cleared day ${day}`,
      apply: () => {
        removed = clearDay(sprint.id, day);
        if (removed) log(BURNDOWN_ACTIONS.DAY_REMOVED, { sprintId: sprint.id, day });
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
        log(BURNDOWN_ACTIONS.BURNDOWN_RESET, { sprintId: sprint.id, days: previous.length });
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
            : "At the end of each day, log the points still to do. Day 0 is the first day of the sprint."}
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
      <div className="mb-2 hidden grid-cols-[96px_1fr_1.2fr_140px_auto] gap-3 border-b border-border px-1 pb-2 sm:grid">
        <span className="text-xs font-medium uppercase tracking-wider text-sub">Day</span>
        <span className="text-xs font-medium uppercase tracking-wider text-sub">
          Points remaining
        </span>
        <span className="text-xs font-medium uppercase tracking-wider text-sub">Note</span>
        <span className="flex items-center gap-1 text-xs font-medium uppercase tracking-wider text-sub">
          <Flag className="h-3 w-3" aria-hidden="true" /> Scope change
        </span>
        <span className="w-9" />
      </div>

      <div className="space-y-2">
        {view.entries.map((e) => {
          const captionId = `${rowsId}-day-${e.day}`;
          const ignoredId = `${rowsId}-ignored-${e.day}`;
          const from = e.source === "derived" ? "Burnup" : e.source === "plan" ? "the plan" : null;
          const date = shortDate(dayDate(sprint, e.day));
          const off = burn.days[e.day] ? offLabel(burn.days[e.day]) : null;
          const describedBy =
            [
              from && e.remaining !== null ? captionId : null,
              ignored && e.typed !== null ? ignoredId : null,
            ]
              .filter(Boolean)
              .join(" ") || undefined;
          return (
            <div
              key={e.id}
              className="grid grid-cols-[1fr_auto] gap-2 rounded-md border border-border p-2 sm:grid-cols-[96px_1fr_1.2fr_140px_auto] sm:items-start sm:gap-3 sm:border-0 sm:p-0"
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
                  id={inputId(e.day)}
                  type="number"
                  inputMode="decimal"
                  min={0}
                  badInputMessage="Enter the points left as a number."
                  aria-label={`Remaining points on day ${e.day}`}
                  aria-describedby={describedBy}
                  placeholder={from && e.remaining !== null ? formatPoints(e.remaining) : "— pts"}
                  value={e.typed === null ? "" : String(e.typed)}
                  readOnly={readOnly}
                  onCommit={(v) => setRemaining(e.day, v)}
                  className="font-data"
                />
                {from && e.remaining !== null && (
                  <DerivedCaption id={captionId} value={e.remaining} from={from} />
                )}
                {ignored && e.typed !== null && (
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

              <button
                type="button"
                disabled={readOnly}
                aria-pressed={e.scopeChange}
                onClick={() => flipScopeChange(e.day)}
                className={`col-span-2 h-9 rounded-md border px-3 text-xs font-medium transition-colors disabled:cursor-not-allowed sm:col-span-1 ${
                  e.scopeChange
                    ? "border-accent-amber/40 bg-accent-amber/15 text-accent-amber"
                    : "border-border bg-card text-sub hover:border-accent-amber/30 hover:text-accent-amber"
                }`}
              >
                {e.scopeChange ? "Scope changed" : "Mark change"}{" "}
                <span className="sr-only">on day {e.day}</span>
              </button>
            </div>
          );
        })}
      </div>

      <p className="mt-4 text-xs text-sub">
        Leave a day blank until you reach it. A dimmed number was logged in Burnup; type over it to
        use your own. Mark a scope change on a day the points went up because work was added, and
        Burnup&apos;s scope line rises with it.
      </p>

      <ConfirmDialog
        open={confirmClearOpen}
        onOpenChange={setConfirmClearOpen}
        title="Clear the log?"
        description={`The ${loggedDays} logged day${loggedDays === 1 ? "" : "s"} of ${sprint.name} ${
          loggedDays === 1 ? "is" : "are"
        } cleared, here and in Burnup. The sprint and its settings stay.`}
        confirmLabel="Clear log"
        onConfirm={clearWholeLog}
      />
    </div>
  );
}

/* -------------------------------------------------------------------------- */
/*  The board's days                                                           */
/* -------------------------------------------------------------------------- */

/**
 * The days as the board tells them, read-only: points left, done that day,
 * and scope that joined or left. The note is the shared log's, so it stays
 * editable.
 */
function BoardDays({
  sprint,
  burn,
  readOnly,
}: {
  sprint: Sprint;
  burn: BurnSeries;
  readOnly: boolean;
}) {
  const shown = burn.days.filter((d) => d.remaining !== null);
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
    <ul className="space-y-2" aria-label="Points left by day, from the board">
      {shown.map((d, i) => {
        const prevDone = i > 0 ? (shown[i - 1].done ?? 0) : 0;
        const doneToday = d.day > 0 ? Math.max(0, (d.done ?? 0) - prevDone) : 0;
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
              <span className="font-data font-semibold">{fmt(d.remaining ?? 0)}</span> left
              {doneToday > 0 && <span className="text-sub"> · {fmt(doneToday)} done that day</span>}
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
                if (!readOnly) writeBurndownDay(sprint.id, d.day, { note: v });
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

function BurndownSprint({
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
    if (!readOnly) log(BURNDOWN_ACTIONS.SOURCE_SWITCHED, { sprintId: sprint.id, source });
    setAnnouncement(source === "stories" ? "Showing the sprint board." : "Showing the typed log.");
  };

  const onSettingsChanged = (change: SprintSettingsChange) =>
    log(BURNDOWN_ACTIONS.CONFIG_UPDATED, { sprintId: sprint.id, ...change });

  /* -- Chart --------------------------------------------------------------- */

  const rows = useMemo<BurndownTextRow[]>(
    () =>
      burn.days.map((d) => ({
        day: d.day,
        ideal: d.ideal,
        actual: d.remaining,
        gap: d.gap,
        off: d.off,
        added: d.added,
        removed: d.removed,
      })),
    [burn]
  );
  const chartText = useMemo(
    () =>
      burnChartText(rows, {
        source: burn.source,
        dated: burn.dated,
        unpointedOpen: burn.unpointedOpen,
        done: burn.done ?? 0,
        scope: burn.scopeNow,
      }),
    [rows, burn]
  );
  const offDays = useMemo(() => offDayRanges(burn), [burn]);
  const scopeMoves = useMemo(
    () =>
      burn.days
        .filter((d) => d.added > 0 || d.removed > 0)
        .map((d) => ({ day: d.day, added: d.added, removed: d.removed })),
    [burn]
  );
  const flagged = useMemo(
    () => burn.days.filter((d) => d.scopeChangeFlag).map((d) => d.day),
    [burn]
  );

  /* -- Export -------------------------------------------------------------- */

  const csvData = useMemo(
    () => ({
      headers: [
        "Day",
        "Date",
        "Day off",
        "Source",
        "Ideal (pts)",
        "Remaining (pts)",
        "Done (pts)",
        "Scope (pts)",
        "Added",
        "Removed",
        "Note",
      ],
      rows: burn.days.map((d) => [
        d.day,
        d.date ?? "",
        offLabel(d) ?? "",
        d.from ?? "",
        d.ideal,
        d.remaining ?? "",
        d.done ?? "",
        d.scope ?? "",
        d.added || "",
        d.removed || "",
        d.note ?? "",
      ]),
    }),
    [burn]
  );
  const markdown = useMemo(
    () => burndownMarkdown({ sprint, burn, status }),
    [sprint, burn, status]
  );
  const promptConfig = useMemo(() => {
    const config = burndownView(sprint, series).config;
    const entries = burn.days.map((d) => ({
      day: d.day,
      remaining: d.remaining,
      scopeChange: Boolean(d.scopeChangeFlag || d.added || d.removed),
      ideal: d.ideal,
      gap: d.gap,
      ...(d.note ? { description: d.note } : {}),
    }));
    return {
      toolName: "Burndown Chart",
      prompts: generateBurndownPrompts({ config, entries, source: sourceLine(burn.source) }),
    };
  }, [sprint, series, burn]);

  /* -- Render -------------------------------------------------------------- */

  return (
    <div className="space-y-6">
      <p data-burn-verdict aria-live="polite" className="text-sm font-medium text-text">
        {status.verdict}
      </p>
      <p aria-live="polite" className="sr-only">
        {announcement}
      </p>

      <SourceBar burn={burn} sprint={sprint} onChoose={chooseSource} />

      <BurnTiles tiles={burndownTiles(sprint, burn, status)} />

      <ChartCard
        title="Burndown chart"
        icon={BarChart3}
        badge={<SourceBadge source={burn.source} />}
        height={chartHeight}
        chartContainerRef={chartRef}
        summary={chartText.summary}
        table={chartText.table}
        headerExtras={
          <>
            <AiPromptGenerator config={promptConfig} />
            <ExportButton
              filename="burndown-chart"
              csvData={csvData}
              markdown={markdown}
              targetRef={chartRef}
            />
          </>
        }
        footer={
          burn.onWorkingDays && offDays.length > 0 ? (
            <p className="text-xs text-sub">
              The ideal line counts the team&apos;s {burn.workingDays} working days; it stays flat
              on the shaded weekends and holidays.
            </p>
          ) : null
        }
      >
        <BurndownChart
          data={rows}
          scopeChangeDays={flagged}
          scopeMoves={burn.source === "stories" ? scopeMoves : undefined}
          todayDay={burn.todayDay}
          offDays={offDays}
        />
      </ChartCard>

      <BurnAdvanced burn={burn} pick="remaining" />

      {burn.source === "stories" ? (
        <SectionCard
          title="Daily progress"
          icon={TrendingDown}
          titleSize="lg"
          headerClassName="pb-4"
        >
          <BoardDays sprint={sprint} burn={burn} readOnly={readOnly} />
          <details className="group mt-4 rounded-lg border border-border">
            <summary className="flex min-h-11 cursor-pointer select-none list-none items-center gap-2 px-3 py-2 text-sm font-medium text-text [&::-webkit-details-marker]:hidden">
              <ListChecks className="h-4 w-4 text-sub" aria-hidden="true" />
              Daily log (fallback)
              <ChevronDown
                className="ml-auto h-4 w-4 shrink-0 text-sub transition-transform group-open:rotate-180"
                aria-hidden="true"
              />
            </summary>
            <div className="border-t border-border p-3">
              <DailyLog
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
        <SectionCard title="Daily log" icon={TrendingDown} titleSize="lg" headerClassName="pb-4">
          <DailyLog
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
        tool="burndown"
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

export function BurndownClient() {
  const { log } = useHistoryLogger("burndown");

  return (
    <ToolPageWrapper
      toolId="burndown"
      title="Burndown Generator"
      description="Track sprint progress with ideal vs. actual remaining points, today marker, and scope change annotations."
      category="Metrics & Dashboards"
    >
      <SprintToolShell
        tool="burndown"
        example={exampleBurndown}
        renderEmpty={({ onCreate, onLoadExample }) => (
          <EmptyState
            icon={TrendingDown}
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
              Burndown charts a shared sprint, read off its stories on the sprint board (or a typed
              daily log). Create one and Burnup, Velocity, Sprint Metrics and the Sprint cockpit see
              it too.
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
          log(BURNDOWN_ACTIONS.CONFIG_UPDATED, { sprintId, ...change })
        }
      >
        {(ctx) => <BurndownSprint key={ctx.sprint.id} {...ctx} log={log} />}
      </SprintToolShell>
    </ToolPageWrapper>
  );
}
