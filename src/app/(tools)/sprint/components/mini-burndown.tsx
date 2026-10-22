"use client";

import { useEffect, useMemo, useState } from "react";
import dynamic from "next/dynamic";
import { TrendingDown } from "lucide-react";
import { ChartCard } from "@/components/shared/chart-card";
import { Button } from "@/components/ui/button";
import { Field } from "@/components/ui/field";
import { Input } from "@/components/ui/input";
import type { Sprint, SprintSeries } from "@/lib/stores/workspace-types";
import { dayEntry, dayForDate, sprintLengthDays } from "@/lib/sprints/series";
import { burndownView } from "@/app/(tools)/burndown/view";
import { burndownChartText } from "@/app/(tools)/burndown/chart-text";
import type { BurndownChartRow } from "@/app/(tools)/burndown/charts";

// Recharts loads with the chart, not the page (see components/charts/lazy-chart.tsx).
const BurndownChart = dynamic(
  () => import("@/app/(tools)/burndown/charts").then((m) => m.BurndownChart),
  { ssr: false, loading: () => null }
);

const round1 = (n: number) => Math.round(n * 10) / 10;

/** The chart's rows: the ideal line and what Burndown and Burnup logged. */
export function miniBurndownRows(sprint: Sprint, series: SprintSeries | undefined) {
  const length = sprintLengthDays(sprint);
  const view = burndownView(sprint, series);
  const rows: BurndownChartRow[] = view.entries
    .filter((e) => e.day <= length)
    .map((e) => ({
      day: e.day,
      ideal: round1(length > 0 ? sprint.pointsPlanned * (1 - e.day / length) : 0),
      actual: e.remaining,
    }));
  return { rows, scopeChangeDays: view.scopeChangeDays, length };
}

/**
 * The sprint's burndown at a glance, with today's "points left" input under
 * it. The number goes to the shared sprint log, so Burndown, Sprint Metrics
 * and the forecasts all see it.
 */
export function MiniBurndown({
  sprint,
  series,
  today,
  onLog,
}: {
  sprint: Sprint;
  series: SprintSeries | undefined;
  today: string;
  /** Absent in a read-only preview. */
  onLog?: (remaining: number) => void;
}) {
  const { rows, scopeChangeDays, length } = useMemo(
    () => miniBurndownRows(sprint, series),
    [sprint, series]
  );
  const text = useMemo(() => burndownChartText(rows), [rows]);
  const todayDay = useMemo(() => {
    const d = dayForDate(sprint, today);
    return d !== null && d >= 0 && d <= length ? d : null;
  }, [sprint, today, length]);
  const stored = todayDay === null ? undefined : dayEntry(series, todayDay)?.remaining;
  const [draft, setDraft] = useState(stored == null ? "" : String(stored));
  const [error, setError] = useState<string | undefined>();
  useEffect(() => setDraft(stored == null ? "" : String(stored)), [stored]);

  const submit = (e: React.FormEvent) => {
    e.preventDefault();
    const n = draft.trim() === "" ? NaN : Number(draft);
    if (!Number.isFinite(n) || n < 0) {
      setError("Enter 0 or more points.");
      return;
    }
    setError(undefined);
    onLog?.(n);
  };

  return (
    <ChartCard
      title="Burndown"
      icon={TrendingDown}
      height={200}
      summary={text.summary}
      table={text.table}
      footer={
        onLog && todayDay !== null ? (
          <form onSubmit={submit} noValidate className="flex flex-wrap items-end gap-2">
            <Field
              label={`Points left today (day ${todayDay})`}
              error={error}
              className="min-w-[12rem] flex-1"
            >
              {(control) => (
                <Input
                  {...control}
                  type="number"
                  inputMode="decimal"
                  min={0}
                  step="any"
                  value={draft}
                  onChange={(e) => setDraft(e.target.value)}
                />
              )}
            </Field>
            <Button type="submit" size="sm">
              Log
            </Button>
          </form>
        ) : undefined
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
