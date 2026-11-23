"use client";

/**
 * Product Metrics' four views: the North Star with its inputs, HEART by
 * feature, the AARRR funnel's latest period, and every metric. Each reads
 * lib/product-metrics/model; the page passes the writes in.
 */

import Link from "next/link";
import { Pencil, Plus, Star, Trash2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { IconButton } from "@/components/ui/icon-button";
import { ChartFigure } from "@/components/shared/chart-card";
import {
  HEART_CATEGORIES,
  type HeartCategory,
  type ProductMetric,
} from "@/lib/stores/workspace-types";
import { formatMetric } from "@/lib/hypotheses/model";
import { testFixHref } from "@/lib/product-metrics/next-steps";
import {
  AARRR_LABEL,
  AARRR_MEANING,
  HEART_LABEL,
  HEART_MEANING,
  NORTH_STAR_CHECKS,
  changeText,
  isEbmExample,
  latestReading,
  latestText,
  metricChange,
  metricChips,
  metricProgress,
  metricTrend,
  pctText,
  pointsText,
  progressText,
  sortedReadings,
  trendText,
  type FunnelView,
  type HeartFeature,
} from "@/lib/product-metrics/model";
import { cn } from "@/lib/utils";

/** A tiny line of the readings; the text beside it says the trend. */
export function Sparkline({ metric, className }: { metric: ProductMetric; className?: string }) {
  const values = sortedReadings(metric).map((r) => r.value);
  if (values.length < 2) return null;
  const min = Math.min(...values);
  const max = Math.max(...values);
  const span = max - min || 1;
  const points = values
    .map((v, i) => `${(i / (values.length - 1)) * 100},${28 - ((v - min) / span) * 24}`)
    .join(" ");
  return (
    <svg
      viewBox="0 0 100 30"
      preserveAspectRatio="none"
      className={cn("h-6 w-20 shrink-0", className)}
      aria-hidden="true"
    >
      <polyline
        points={points}
        fill="none"
        stroke="var(--accent)"
        strokeWidth={2}
        vectorEffect="non-scaling-stroke"
      />
    </svg>
  );
}

/** Progress as a bar with its words; "not measured" has no bar. */
export function ProgressLine({ metric }: { metric: ProductMetric }) {
  const p = metricProgress(metric);
  return (
    <div className="flex min-w-0 items-center gap-2 text-xs text-sub">
      {p !== null && (
        <span
          className="h-1.5 w-20 shrink-0 overflow-hidden rounded-full bg-border"
          aria-hidden="true"
        >
          <span className="block h-full bg-accent" style={{ width: `${Math.round(p * 100)}%` }} />
        </span>
      )}
      <span>
        {p === null ? "Progress: not measured" : `${progressText(p)} of the way to the target`}
      </span>
    </div>
  );
}

const changeClass = (m: ProductMetric) => {
  const c = metricChange(m);
  return c?.better === true ? "text-success" : c?.better === false ? "text-danger" : "text-sub";
};

/** One metric's numbers: latest reading, change, target, progress and trend. */
export function MetricNumbers({
  metric,
  large = false,
}: {
  metric: ProductMetric;
  large?: boolean;
}) {
  const latest = latestReading(metric);
  const change = changeText(metric);
  return (
    <div className="min-w-0 space-y-1">
      <p className={cn("flex flex-wrap items-baseline gap-x-2", large ? "text-2xl" : "text-base")}>
        <span className="font-data font-semibold text-text">{latestText(metric)}</span>
        {latest && <span className="text-xs text-sub">on {latest.date}</span>}
        {change && <span className={cn("text-xs", changeClass(metric))}>{change}</span>}
      </p>
      <p className="text-xs text-sub">
        Target {metric.target !== undefined ? formatMetric(metric.target, metric.unit) : "not set"}
      </p>
      <ProgressLine metric={metric} />
      <div className="flex items-center gap-2 text-xs text-sub">
        <Sparkline metric={metric} />
        <span>{trendText(metricTrend(metric))}</span>
      </div>
    </div>
  );
}

export interface MetricActions {
  onReading: (m: ProductMetric) => void;
  onEdit: (m: ProductMetric) => void;
  onSetNorthStar?: (m: ProductMetric) => void;
  onDelete?: (m: ProductMetric) => void;
}

function RowActions({ metric, actions }: { metric: ProductMetric; actions: MetricActions }) {
  return (
    <div className="flex flex-wrap gap-1">
      <Button type="button" size="sm" variant="outline" onClick={() => actions.onReading(metric)}>
        <Plus aria-hidden="true" />
        Reading <span className="sr-only">for “{metric.name}”</span>
      </Button>
      <IconButton
        label={`Edit “${metric.name}”`}
        icon={<Pencil className="h-4 w-4" aria-hidden="true" />}
        onClick={() => actions.onEdit(metric)}
      />
      {actions.onSetNorthStar && metric.role !== "north-star" && (
        <IconButton
          label={`Set “${metric.name}” as the North Star`}
          icon={<Star className="h-4 w-4" aria-hidden="true" />}
          onClick={() => actions.onSetNorthStar?.(metric)}
        />
      )}
      {actions.onDelete && (
        <IconButton
          label={`Delete “${metric.name}”`}
          icon={<Trash2 className="h-4 w-4" aria-hidden="true" />}
          onClick={() => actions.onDelete?.(metric)}
        />
      )}
    </div>
  );
}

/* ── North Star ─────────────────────────────────────────────────────── */

export function NorthStarPanel({
  northStar,
  inputs,
  productGoal,
  actions,
  onNew,
  readOnly = false,
}: {
  northStar: ProductMetric | null;
  inputs: readonly ProductMetric[];
  productGoal: string | null;
  actions?: MetricActions;
  onNew?: (role: "north-star" | "input") => void;
  readOnly?: boolean;
}) {
  return (
    <div className="space-y-4">
      <p className="break-words text-sm text-sub">
        {productGoal ? (
          <>
            <span className="font-medium text-text">Product Goal: </span>
            {productGoal}
          </>
        ) : readOnly ? (
          "No Product Goal yet."
        ) : (
          <>
            No Product Goal yet.{" "}
            <Link href="/product-goal" className="text-accent hover:underline">
              Write one
            </Link>{" "}
            so the North Star has something to serve.
          </>
        )}
      </p>
      {northStar ? (
        <section aria-label="North Star" className="rounded-lg border border-border p-3">
          <div className="flex flex-wrap items-start justify-between gap-2">
            <div className="min-w-0">
              <p className="text-xs font-medium text-sub">North Star</p>
              <h3 className="break-words font-display text-lg font-semibold text-text">
                {northStar.name}
              </h3>
              {northStar.definition && (
                <p className="break-words text-sm text-sub">{northStar.definition}</p>
              )}
              {northStar.owner && <p className="text-xs text-sub">Owner: {northStar.owner}</p>}
            </div>
            {!readOnly && actions && <RowActions metric={northStar} actions={actions} />}
          </div>
          <div className="mt-3">
            <MetricNumbers metric={northStar} large />
          </div>
        </section>
      ) : (
        <div className="rounded-lg border border-dashed border-border p-3 text-sm text-sub">
          <p>No North Star yet: the one number that counts the value people get.</p>
          {!readOnly && onNew && (
            <Button type="button" size="sm" className="mt-2" onClick={() => onNew("north-star")}>
              <Plus aria-hidden="true" />
              Add the North Star
            </Button>
          )}
        </div>
      )}
      <section aria-label="Inputs" className="space-y-2">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <h3 className="text-sm font-medium text-text">Inputs ({inputs.length} of 5)</h3>
          {!readOnly && onNew && inputs.length < 5 && (
            <Button type="button" size="sm" variant="outline" onClick={() => onNew("input")}>
              <Plus aria-hidden="true" />
              Add an input
            </Button>
          )}
        </div>
        {inputs.length === 0 ? (
          <p className="text-sm text-sub">
            No inputs yet: the few numbers a team can move that move it.
          </p>
        ) : (
          <ul className="grid grid-cols-1 gap-2 md:grid-cols-2">
            {inputs.map((m) => (
              <li key={m.id} className="min-w-0 rounded-lg border border-border p-3">
                <div className="flex flex-wrap items-start justify-between gap-2">
                  <div className="min-w-0">
                    <p className="break-words text-sm font-medium text-text">{m.name}</p>
                    {m.owner && <p className="text-xs text-sub">Owner: {m.owner}</p>}
                  </div>
                  {!readOnly && actions && <RowActions metric={m} actions={actions} />}
                </div>
                <div className="mt-2">
                  <MetricNumbers metric={m} />
                </div>
              </li>
            ))}
          </ul>
        )}
      </section>
      {!readOnly && (
        <section aria-label="Check list" className="rounded-lg bg-surface-deep p-3">
          <h3 className="text-xs font-medium text-sub">A good North Star</h3>
          <ul className="mt-1 list-disc space-y-0.5 pl-5 text-sm text-text">
            {NORTH_STAR_CHECKS.map((c) => (
              <li key={c}>{c}</li>
            ))}
          </ul>
        </section>
      )}
    </div>
  );
}

/* ── HEART ──────────────────────────────────────────────────────────── */

export function HeartPanel({
  features,
  actions,
  onNew,
}: {
  features: readonly HeartFeature[];
  actions: MetricActions;
  onNew: (preset: { category: HeartCategory; feature: string }) => void;
}) {
  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <p className="text-sm text-sub">
          Goals, signals and a metric for each feature. You don&apos;t need all five.
        </p>
        <Button
          type="button"
          size="sm"
          variant="outline"
          onClick={() => onNew({ category: "happiness", feature: "" })}
        >
          <Plus aria-hidden="true" />
          Add a HEART goal
        </Button>
      </div>
      {features.length === 0 && (
        <p className="text-sm text-sub">
          No HEART goals yet. Add one for the feature you care about most.
        </p>
      )}
      {features.map((g) => (
        <section key={g.key} aria-label={`HEART for ${g.feature}`} className="space-y-2">
          <h3 className="break-words font-display text-base font-semibold text-text">
            {g.feature}
          </h3>
          <table className="hidden w-full text-left text-sm md:table">
            <thead className="text-xs text-sub">
              <tr>
                <th className="py-1 pr-2 font-medium">Category</th>
                <th className="py-1 pr-2 font-medium">Goal</th>
                <th className="py-1 pr-2 font-medium">Signal</th>
                <th className="py-1 pr-2 font-medium">Metric</th>
                <th className="py-1 pr-2 font-medium">Latest</th>
                <th className="py-1 font-medium">
                  <span className="sr-only">Actions</span>
                </th>
              </tr>
            </thead>
            <tbody className="divide-y divide-border">
              {HEART_CATEGORIES.map((c) => {
                const m = g.rows[c];
                return (
                  <tr key={c}>
                    <th scope="row" className="py-2 pr-2 align-top font-medium text-text">
                      {HEART_LABEL[c]}
                    </th>
                    <td className="break-words py-2 pr-2 align-top">{m?.heart?.goal ?? "—"}</td>
                    <td className="break-words py-2 pr-2 align-top">{m?.heart?.signal ?? "—"}</td>
                    <td className="break-words py-2 pr-2 align-top">{m?.name ?? "—"}</td>
                    <td className="py-2 pr-2 align-top font-data">{m ? latestText(m) : "—"}</td>
                    <td className="py-2 align-top">
                      {m ? (
                        <RowActions metric={m} actions={actions} />
                      ) : (
                        <Button
                          type="button"
                          size="sm"
                          variant="ghost"
                          onClick={() => onNew({ category: c, feature: g.feature })}
                        >
                          Add
                          <span className="sr-only">
                            {" "}
                            {HEART_LABEL[c]} for {g.feature}
                          </span>
                        </Button>
                      )}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
          <ul className="space-y-2 md:hidden">
            {HEART_CATEGORIES.map((c) => {
              const m = g.rows[c];
              return (
                <li key={c} className="rounded-lg border border-border p-3">
                  <p className="text-sm font-medium text-text">{HEART_LABEL[c]}</p>
                  <p className="text-xs text-sub">{HEART_MEANING[c]}</p>
                  {m ? (
                    <div className="mt-2 space-y-1 text-sm">
                      {m.heart?.goal && <p className="break-words">Goal: {m.heart.goal}</p>}
                      {m.heart?.signal && <p className="break-words">Signal: {m.heart.signal}</p>}
                      <p className="break-words">
                        {m.name}: <span className="font-data">{latestText(m)}</span>
                      </p>
                      <RowActions metric={m} actions={actions} />
                    </div>
                  ) : (
                    <Button
                      type="button"
                      size="sm"
                      variant="outline"
                      className="mt-2"
                      onClick={() => onNew({ category: c, feature: g.feature })}
                    >
                      Add {HEART_LABEL[c]}
                    </Button>
                  )}
                </li>
              );
            })}
          </ul>
        </section>
      ))}
    </div>
  );
}

/* ── The funnel ─────────────────────────────────────────────────────── */

export function FunnelPanel({
  funnel,
  missingStages,
  onSetUp,
  periodForm,
}: {
  funnel: FunnelView;
  missingStages: number;
  onSetUp: () => void;
  periodForm: React.ReactNode;
}) {
  const leak = funnel.leakiest ? funnel.stages.find((s) => s.stage === funnel.leakiest) : undefined;
  const acquired = funnel.stages[0]?.count ?? null;
  const table = {
    columns: ["Stage", "Count", "Of the stage before", "Of everyone acquired"],
    rows: funnel.stages.map((s) => [
      AARRR_LABEL[s.stage],
      s.count ?? "—",
      s.stage === "acquisition"
        ? "—"
        : // Referral and Revenue are shares of Retention, not of the stage listed before them.
          `${pctText(s.ofBefore)}${s.stage === "referral" || s.stage === "revenue" ? " of Retention" : ""}`,
      pctText(s.ofAcquired),
    ]),
  };
  return (
    <div className="space-y-4">
      {missingStages > 0 && (
        <div className="flex flex-wrap items-center gap-2 text-sm text-sub">
          <p>
            {missingStages === 5
              ? "No funnel yet: one metric for each of the five stages."
              : `${missingStages} of the five stages have no metric yet.`}
          </p>
          <Button type="button" size="sm" variant="outline" onClick={onSetUp}>
            Set up the funnel
          </Button>
        </div>
      )}
      {funnel.date ? (
        <ChartFigure
          label="The funnel's latest period"
          summary={`Period of ${funnel.date}. ${
            funnel.nested
              ? leak
                ? `${AARRR_LABEL[leak.stage]} is the leakiest stage, at ${pctText(leak.ofBefore)} of the stage before.`
                : "Add counts for Activation and Retention to find the leakiest stage."
              : "These counts don't nest: check the period's numbers."
          }`}
          table={table}
        >
          <ul className="space-y-3">
            {funnel.stages.map((s) => {
              const width =
                acquired && s.count !== null ? Math.min(100, (s.count / acquired) * 100) : 0;
              return (
                <li key={s.stage} className="min-w-0">
                  <div className="flex flex-wrap items-baseline justify-between gap-x-2 text-sm">
                    <span className="font-medium text-text">
                      {AARRR_LABEL[s.stage]}
                      <span className="sr-only">: {AARRR_MEANING[s.stage]}</span>
                    </span>
                    <span className="font-data text-text">{s.count ?? "—"}</span>
                  </div>
                  <div
                    className="mt-1 h-3 w-full overflow-hidden rounded bg-border"
                    aria-hidden="true"
                  >
                    <div
                      className={cn(
                        "h-full",
                        s.stage === funnel.leakiest ? "bg-warning" : "bg-accent"
                      )}
                      style={{ width: `${width}%` }}
                    />
                  </div>
                  {s.stage !== "acquisition" && (
                    <p className="mt-0.5 text-xs text-sub">
                      {pctText(s.ofBefore)}{" "}
                      {s.stage === "referral" || s.stage === "revenue"
                        ? "of Retention"
                        : "of the stage before"}{" "}
                      · {pctText(s.ofAcquired)} of everyone acquired
                      {s.change !== null && ` · ${pointsText(s.change)}`}
                    </p>
                  )}
                </li>
              );
            })}
          </ul>
        </ChartFigure>
      ) : (
        <p className="text-sm text-sub">
          No period yet: add a day&apos;s counts for Acquisition and at least one other stage.
        </p>
      )}
      {funnel.date && !funnel.nested && (
        <p className="text-sm text-danger" role="status">
          These counts don&apos;t nest: check the period&apos;s numbers.
        </p>
      )}
      {leak && leak.metric && (
        <p className="flex flex-wrap items-center gap-2 text-sm text-text">
          <span>
            Leakiest stage: <span className="font-medium">{AARRR_LABEL[leak.stage]}</span>, at{" "}
            {pctText(leak.ofBefore)} of the stage before
            {leak.change !== null ? ` (${pointsText(leak.change)} since the period before)` : ""}.
          </span>
          <Link href={testFixHref(leak.metric.id)} className="text-accent hover:underline">
            Test a fix
          </Link>
        </p>
      )}
      {periodForm}
    </div>
  );
}

/* ── All metrics ────────────────────────────────────────────────────── */

export function AllMetricsPanel({
  metrics,
  actions,
  onNew,
}: {
  metrics: readonly ProductMetric[];
  actions: MetricActions;
  onNew: () => void;
}) {
  return (
    <div className="space-y-3">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <p className="text-sm text-sub">
          Every metric, with the views it sits in. The numbers come from your own analytics, typed
          or pasted.
        </p>
        <Button type="button" size="sm" variant="outline" onClick={onNew}>
          <Plus aria-hidden="true" />
          Add a metric
        </Button>
      </div>
      <ul className="space-y-2">
        {metrics.map((m) => {
          const chips = metricChips(m);
          return (
            <li key={m.id} className="min-w-0 rounded-lg border border-border p-3">
              <div className="flex flex-wrap items-start justify-between gap-2">
                <div className="min-w-0">
                  <p className="break-words text-sm font-medium text-text">{m.name}</p>
                  <p className="flex flex-wrap gap-1 pt-1">
                    {chips.map((c) => (
                      <span
                        key={c}
                        className="rounded-full border border-border px-2 py-0.5 text-xs text-sub"
                      >
                        {c}
                      </span>
                    ))}
                    {isEbmExample(m.id) && (
                      <span className="px-1 text-xs text-sub">from the EBM example</span>
                    )}
                  </p>
                </div>
                <RowActions metric={m} actions={actions} />
              </div>
              <div className="mt-2">
                <MetricNumbers metric={m} />
              </div>
            </li>
          );
        })}
      </ul>
    </div>
  );
}
