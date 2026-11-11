"use client";

import { useId, useMemo, type Ref } from "react";
import dynamic from "next/dynamic";
import Link from "@/components/motion/transition-link";
import { ArrowRight, BarChart3, Calendar, Target, TrendingUp } from "lucide-react";
import { SectionCard } from "@/components/shared/section-card";
import { ChartFigure } from "@/components/shared/chart-card";
import { StatCard } from "@/components/shared/stat-card";
import { DataTable, type DataTableColumn } from "@/components/shared/data-table";
import { NotEnoughData } from "@/components/shared/not-enough-data";
import { AdvancedAnalysis } from "@/components/shared/advanced-analysis";
import { CalloutAlert } from "@/components/shared/callout-alert";
import { MIN_SAMPLE } from "@/lib/analytics/min-sample";
import { fmt, plural } from "@/lib/charts/chart-text";
import { simulationHistogramText } from "./chart-text";
import { formatDay, ITERATIONS, MAX_SPRINTS } from "@/lib/sprints/release-forecast";
import { bootstrapCrossCheck, recentShift } from "./advanced";
import { releaseNextStep } from "./next-step";
import { sampleText } from "./describe";
import type { ConfidenceRow, ReleasePlan, TargetAnswer } from "./plan";
import { releaseVerdict } from "./verdict";

// Recharts loads with the chart, not the page; the placeholder holds the
// chart's 350px height while it does.
const SimulationHistogramChart = dynamic(
  () => import("./charts").then((m) => m.SimulationHistogramChart),
  {
    ssr: false,
    loading: () => (
      <div className="h-[350px] w-full animate-pulse rounded-lg bg-muted/30" aria-hidden="true" />
    ),
  }
);

const TONE: Record<ConfidenceRow["pct"], string> = {
  50: "text-accent",
  75: "text-accent-green",
  85: "text-warning",
  95: "text-danger",
};

const CONFIDENCE_COLUMNS: DataTableColumn<ConfidenceRow>[] = [
  {
    key: "pct",
    header: "Confidence",
    primary: true,
    cell: (r) => <span className={`font-data font-bold ${TONE[r.pct]}`}>{r.pct}% confident</span>,
  },
  {
    key: "sprints",
    header: "Sprints",
    align: "right",
    cell: (r) => <span className="font-data text-text">{r.sprints ?? "—"}</span>,
  },
  {
    key: "date",
    header: "Finished by",
    cell: (r) =>
      r.sprints === null ? (
        <span className="text-sub">Not within {MAX_SPRINTS} sprints</span>
      ) : (
        <span className="font-semibold text-text">{formatDay(r.date)}</span>
      ),
  },
];

/** The target date's answers: the chance of finishing (with a forecast) and the scope to promise. */
function TargetPanel({ target, id }: { target: TargetAnswer; id: string }) {
  return (
    <div
      className="rounded-lg border border-border bg-surface-deep p-4"
      aria-labelledby={id}
      role="group"
    >
      <h3 id={id} className="flex items-center gap-2 text-sm font-semibold text-text">
        <Target className="h-4 w-4 text-accent" aria-hidden="true" />
        By {formatDay(target.date)}
        <span className="font-normal text-sub">
          ({plural(target.sprints, "sprint")} from the start)
        </span>
      </h3>
      {target.sprints === 0 ? (
        <p className="mt-2 text-sm text-sub">
          No full sprint fits before then. Pick a later date or an earlier start.
        </p>
      ) : (
        <dl className="mt-3 grid gap-3 sm:grid-cols-2">
          {target.chance !== null && (
            <div>
              <dt className="text-xs text-sub">Probability of finishing by then</dt>
              <dd className="font-data text-2xl text-text">{Math.round(target.chance * 100)}%</dd>
            </div>
          )}
          {target.deliverable && (
            <div>
              <dt className="text-xs text-sub">Scope we can deliver by then</dt>
              <dd className="text-sm text-text">
                <span className="font-data text-2xl">
                  {fmt(Math.floor(target.deliverable.p85), 0)}
                </span>{" "}
                pts to promise (P85) ·{" "}
                <span className="font-data">{fmt(Math.floor(target.deliverable.p50), 0)}</span>{" "}
                likely (P50)
              </dd>
            </div>
          )}
        </dl>
      )}
    </div>
  );
}

/** The forecast: verdict, headline dates, the target-date answers, chart, table and extras. */
export function ForecastView({
  plan,
  plotRef,
}: {
  plan: ReleasePlan;
  plotRef: Ref<HTMLDivElement>;
}) {
  const titleId = useId();
  const verdict = releaseVerdict(plan);
  const step = releaseNextStep(plan);
  const f = plan.forecast;
  const showForecast = plan.blocked === null && f !== null;
  const targetSprints = plan.target && plan.target.sprints >= 1 ? plan.target.sprints : null;

  const histogramText = useMemo(
    () =>
      f && f.p50 !== null
        ? simulationHistogramText({
            histogram: f.histogram,
            total: f.iterations,
            p50: f.p50,
            p85: f.p85,
            p95: f.p95,
            target: targetSprints,
          })
        : null,
    [f, targetSprints]
  );
  const crossCheck = useMemo(
    () =>
      showForecast && plan.effective
        ? bootstrapCrossCheck(plan.effective, plan.sample.points)
        : null,
    [showForecast, plan.effective, plan.sample.points]
  );
  const shift = useMemo(() => recentShift(plan.sample.points), [plan.sample.points]);
  const p50 = plan.rows.find((r) => r.pct === 50);
  const p85 = plan.rows.find((r) => r.pct === 85);
  // "Close 2 more sprints": a completed sprint can't be closed again.
  const unit: readonly [string, string] =
    plan.velocitySource === "sprints" ? ["sprint", "sprints"] : ["velocity", "velocities"];

  return (
    <SectionCard title={<span id={titleId}>Forecast</span>} icon={BarChart3} titleSize="lg">
      <div className="space-y-5">
        {/* Short of the minimum sample, NotEnoughData is the verdict: the
            two said the same thing one above the other. */}
        {plan.blocked === "small-sample" ? (
          <NotEnoughData
            have={plan.sample.points.length}
            need="forecast"
            unit={unit}
            action={plan.velocitySource === "sprints" ? "Close" : "Type"}
            what="a forecast"
          />
        ) : (
          <p className="text-sm font-medium text-text" data-testid="release-verdict">
            {verdict}
          </p>
        )}

        {/* Without a forecast (no scope, or out of reach) the date's answers
            still stand: what the team can deliver by then. */}
        {plan.target && !showForecast && (
          <TargetPanel target={plan.target} id={`${titleId}-target`} />
        )}

        {showForecast && f && (
          <>
            {/* Labels short enough for one line in a 2-up phone row (about
                90 px at 360 wide): one that wrapped put its value a line
                lower than its neighbour's. */}
            <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
              <StatCard
                variant="compact"
                label="Coin flip (P50)"
                icon={Calendar}
                value={p50?.sprints ? formatDay(p50.date) : "—"}
                hint={p50?.sprints ? plural(p50.sprints, "sprint") : undefined}
              />
              <StatCard
                variant="compact"
                label="Commit (P85)"
                icon={Calendar}
                value={p85?.sprints ? formatDay(p85.date) : "—"}
                hint={
                  p85?.sprints ? plural(p85.sprints, "sprint") : `Not within ${MAX_SPRINTS} sprints`
                }
                valueClassName="text-warning"
              />
              <StatCard
                variant="compact"
                label="Total scope"
                icon={BarChart3}
                value={`${fmt(plan.effective ?? 0)} pts`}
              />
              <StatCard
                variant="compact"
                label="Velocity"
                icon={TrendingUp}
                value={plan.headline.average === null ? "—" : `${fmt(plan.headline.average)} pts`}
                hint={
                  plan.headline.count > 0
                    ? `per sprint, last ${plural(plan.headline.count, "sprint")}`
                    : undefined
                }
              />
            </div>

            {plan.target && <TargetPanel target={plan.target} id={`${titleId}-target`} />}

            {histogramText && (
              <ChartFigure
                label="Sprints needed across the simulated runs"
                summary={histogramText.summary}
                table={histogramText.table}
                plotRef={plotRef}
                plotClassName="w-full pt-2"
              >
                <SimulationHistogramChart
                  histogram={f.histogram}
                  total={f.iterations}
                  p50={f.p50}
                  p85={f.p85}
                  p95={f.p95}
                  target={targetSprints}
                />
              </ChartFigure>
            )}

            <DataTable
              columns={CONFIDENCE_COLUMNS}
              rows={plan.rows}
              rowKey={(r) => String(r.pct)}
            />

            <p className="text-xs text-sub">
              {ITERATIONS.toLocaleString("en-US")} simulated runs, each replaying random sprints
              from {sampleText(plan)}. A sprint that delivered 0 counts like any other.
            </p>
          </>
        )}

        <AdvancedAnalysis>
          <div className="space-y-2 text-sm">
            <h3 className="font-medium text-text">Bootstrap cross-check</h3>
            {crossCheck ? (
              <p className="text-sub">
                Resampling the velocities puts the 85% forecast at{" "}
                <span className="font-data text-text">{plural(crossCheck.point, "sprint")}</span>{" "}
                {crossCheck.pessimistic === null
                  ? `(at least ${crossCheck.optimistic}; a 0-point sprint in the sample leaves no upper bound)`
                  : `(between ${crossCheck.optimistic} and ${crossCheck.pessimistic})`}
                {f?.p85 && crossCheck.point !== f.p85
                  ? `; the simulation says ${plural(f.p85, "sprint")}.`
                  : ", in line with the simulation."}
              </p>
            ) : plan.sample.points.length < MIN_SAMPLE.distribution ? (
              <NotEnoughData
                have={plan.sample.points.length}
                need="distribution"
                unit={unit}
                action={plan.velocitySource === "sprints" ? "Close" : "Type"}
                what="the cross-check"
              />
            ) : (
              <p className="text-sub">
                {showForecast
                  ? "The slowest sprints delivered 0 points, so the cross-check has no pace to divide by."
                  : "Runs once there's a forecast."}
              </p>
            )}
          </div>
          <div className="space-y-2 text-sm">
            <h3 className="font-medium text-text">Change in pace (CUSUM)</h3>
            {shift === null ? (
              <NotEnoughData
                have={plan.sample.points.length}
                need="changePoint"
                unit={unit}
                action={plan.velocitySource === "sprints" ? "Close" : "Type"}
                what="whether the pace has shifted"
              />
            ) : shift ? (
              <CalloutAlert tone="warning">
                <div className="text-sub">
                  The velocity shifted within the last three sprints, so the sample mixes an old
                  pace with a new one. Re-forecast once the new pace settles, or type only the
                  sprints since the change.
                </div>
              </CalloutAlert>
            ) : (
              <p className="text-sub">No shift in pace in the last three sprints.</p>
            )}
          </div>
        </AdvancedAnalysis>

        {step && (
          <aside
            aria-labelledby={`${titleId}-next`}
            className="flex flex-col gap-3 rounded-lg border border-accent/30 bg-accent/5 p-4 sm:flex-row sm:items-center"
          >
            <div className="min-w-0 flex-1">
              <p className="text-xs font-semibold uppercase tracking-wide text-accent">Next step</p>
              <h3 id={`${titleId}-next`} className="mt-0.5 text-sm font-semibold text-text">
                {step.label}
              </h3>
              {step.detail && <p className="mt-0.5 text-sm text-sub">{step.detail}</p>}
            </div>
            <Link
              href={step.href}
              className="inline-flex min-h-9 shrink-0 items-center gap-1.5 self-start rounded-md border border-accent/40 bg-card px-3 text-sm font-medium text-accent transition-colors hover:bg-accent/10 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent sm:self-center"
            >
              Go<span className="sr-only">: {step.label}</span>
              <ArrowRight className="h-4 w-4" aria-hidden="true" />
            </Link>
          </aside>
        )}
      </div>
    </SectionCard>
  );
}
