"use client";

import { useEffect, useMemo } from "react";
import dynamic from "next/dynamic";
import Link from "next/link";
import { ArrowRight, TrendingDown } from "lucide-react";
import { ChartCard } from "@/components/shared/chart-card";
import { useItemForm } from "@/components/shared/item-form";
import { Button } from "@/components/ui/button";
import { Field } from "@/components/ui/field";
import { Input } from "@/components/ui/input";
import type { Sprint, SprintSeries } from "@/lib/stores/workspace-types";
import { dayDate, dayEntry } from "@/lib/sprints/series";
import { points } from "@/lib/sprints/hub-view";
import { isExampleSprintId } from "@/lib/sprints/example";
import { sprintHref } from "@/lib/sprints/use-selected-sprint";
import {
  cockpitChartText,
  loggableDays,
  validateDayLog,
  type CockpitBurndown,
  type DayLogDraft,
  type DayLogValues,
} from "../view";

// Recharts loads with the chart, not the page (see components/charts/lazy-chart.tsx).
const BurndownChart = dynamic(
  () => import("@/app/(tools)/burndown/charts").then((m) => m.BurndownChart),
  { ssr: false, loading: () => null }
);

const SELECT_CLASS =
  "flex h-10 w-full rounded-md border border-input bg-background px-3 py-2 text-sm text-text focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring";

const asText = (n: number | null | undefined) => (n == null ? "" : String(n));

/** "Day 7 · today", "Day 5 · Mon 19 Oct" */
function dayOption(sprint: Sprint, day: number, todayDay: number | null): string {
  if (day === todayDay) return `Day ${day} · today`;
  const iso = dayDate(sprint, day);
  const m = /^(\d{4})-(\d{2})-(\d{2})/.exec(iso ?? "");
  if (!m) return `Day ${day}`;
  const date = new Date(Number(m[1]), Number(m[2]) - 1, Number(m[3]));
  return `Day ${day} · ${date.toLocaleDateString("en-GB", { weekday: "short", day: "numeric", month: "short" })}`;
}

/**
 * The sprint's burndown at a glance, and where its numbers come from. With
 * pointed stories it is read off the sprint board and nothing is asked;
 * without, "points left" is typed per day (today, or a missed earlier day)
 * into the shared sprint log, so Burndown, Sprint Metrics and the forecasts
 * all see it. A closed sprint shows its daily log and the points confirmed
 * when it closed, and asks nothing.
 */
export function MiniBurndown({
  sprint,
  series,
  burndown,
  today,
  onLog,
}: {
  sprint: Sprint;
  series: SprintSeries | undefined;
  burndown: CockpitBurndown;
  today: string;
  /** Absent in a read-only preview. */
  onLog?: (day: number, remaining: number) => void;
}) {
  const { rows, scopeChangeDays, todayDay, source, remaining } = burndown;
  const text = useMemo(() => cockpitChartText(burndown), [burndown]);
  const board = source === "stories";
  // A closed sprint keeps what was recorded; its log is changed in Burndown, not here.
  const closed = sprint.status === "completed";
  const days = useMemo(
    () => (board || closed ? [] : loggableDays(sprint, today)),
    [board, closed, sprint, today]
  );
  const lastDay = days.length > 0 ? days[days.length - 1] : null;
  const storedAt = (day: number | null) =>
    day === null ? undefined : dayEntry(series, day)?.remaining;

  const form = useItemForm<DayLogDraft, DayLogValues, keyof DayLogDraft>({
    initial: () => ({ day: asText(lastDay), remaining: asText(storedAt(lastDay)) }),
    validate: (draft) => validateDayLog(draft, days),
    resetOnSave: false,
    onSave: ({ day, remaining: left }) => onLog?.(day, left),
  });
  const chosen = form.draft.day === "" ? null : Number(form.draft.day);
  const stored = storedAt(chosen);
  // Show what the chosen day already holds: after a save, after another
  // tool's write, or when a different day is picked. Typing is never
  // overwritten, since the stored number doesn't change while typing.
  useEffect(() => {
    form.update({ remaining: asText(stored) });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [stored]);
  // A new day (midnight, or the sprint's dates edited) moves the choice on.
  useEffect(() => {
    form.update({ day: asText(lastDay) });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [lastDay]);

  const boardHref = isExampleSprintId(sprint.id) ? "/kanban" : sprintHref("/kanban", sprint.id);
  const sourceLine = closed ? (
    <p className="text-sm text-sub">
      {typeof sprint.pointsCompleted === "number"
        ? `Closed with ${points(sprint.pointsCompleted)} done. `
        : "Closed. "}
      A closed sprint&apos;s chart is its daily log, since closing can move its unfinished stories
      off the board{source === "log" ? "." : "; none was typed for this one."}
    </p>
  ) : board ? (
    <p className="text-sm text-sub">
      {remaining.remaining === 0
        ? "Every pointed story on the sprint board is done."
        : `${points(remaining.remaining ?? 0)} left on the sprint board today.`}{" "}
      <Link
        href={boardHref}
        className="inline-flex items-center gap-1 font-medium text-accent hover:underline"
      >
        Move stories on the board
        <ArrowRight className="h-3.5 w-3.5" aria-hidden="true" />
      </Link>
    </p>
  ) : source === "log" ? (
    <p className="text-sm text-sub">
      {`${points(remaining.remaining ?? 0)} left on day ${remaining.day ?? 0}, typed in the daily log.`}{" "}
      Pointed stories on the sprint board would fill this in for you.
    </p>
  ) : (
    <p className="text-sm text-sub">
      Nothing logged yet. Point the sprint&apos;s stories and move them on the board, or type the
      points left each day.
    </p>
  );

  const label =
    chosen !== null && chosen === todayDay
      ? `Points left today (day ${chosen})`
      : `Points left on day ${chosen ?? "—"}`;

  return (
    <ChartCard
      title="Burndown"
      icon={TrendingDown}
      badge={
        <span className="rounded-md border border-border px-1.5 py-0.5 text-xs font-medium text-sub">
          {board
            ? "From the sprint board"
            : source === "log"
              ? "Typed in the daily log"
              : closed
                ? "No daily log"
                : "Nothing recorded yet"}
        </span>
      }
      height={200}
      summary={text.summary}
      table={text.table}
      footer={
        <div className="space-y-3">
          {sourceLine}
          {onLog && days.length > 0 && (
            <form
              ref={form.formRef}
              onSubmit={form.submit}
              noValidate
              className="flex flex-wrap items-end gap-2"
            >
              {days.length > 1 && (
                <Field label="Day" error={form.errors.day} className="w-40">
                  {(control) => (
                    <select
                      {...control}
                      className={SELECT_CLASS}
                      value={form.draft.day}
                      onChange={(e) => form.update({ day: e.target.value })}
                    >
                      {[...days].reverse().map((d) => (
                        <option key={d} value={String(d)}>
                          {dayOption(sprint, d, todayDay)}
                        </option>
                      ))}
                    </select>
                  )}
                </Field>
              )}
              <Field label={label} error={form.errors.remaining} className="min-w-[12rem] flex-1">
                {(control) => (
                  <Input
                    {...control}
                    type="number"
                    inputMode="decimal"
                    min={0}
                    step="any"
                    value={form.draft.remaining}
                    onChange={(e) => form.update({ remaining: e.target.value })}
                  />
                )}
              </Field>
              <Button type="submit" size="sm">
                Log
              </Button>
            </form>
          )}
        </div>
      }
    >
      <BurndownChart
        data={rows}
        scopeChangeDays={scopeChangeDays}
        todayDay={todayDay}
        changepointDays={[]}
      />
    </ChartCard>
  );
}
