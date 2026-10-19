"use client";

/**
 * Small visual primitives for KPI cards: a direction-aware trend arrow, a
 * Mann-Kendall monotonic-trend chip (rendered only for series of length >= 5
 * with a detectable trend), and the traffic-light circle. The arrow and a
 * labelled circle are images with a text name, so the colour isn't the only
 * cue.
 */

import { useMemo } from "react";
import { TrendingUp, TrendingDown, Minus } from "lucide-react";
import { mannKendall } from "@/lib/analytics/trend-test";
import type { TrafficStatus, TrendDir } from "../types";
import { STATUS_COLOR, STATUS_LABEL } from "../status-config";

const TREND_LABEL: Record<TrendDir, string> = {
  up: "Trending up",
  down: "Trending down",
  same: "No change",
};

export function TrendIcon({
  trend,
  positiveIsUp = true,
}: {
  trend: TrendDir;
  positiveIsUp?: boolean;
}) {
  let icon: React.ReactNode;
  if (trend === "up") {
    const color = positiveIsUp ? "#22c55e" : "#ef4444";
    icon = <TrendingUp className="w-4 h-4" style={{ color }} aria-hidden="true" />;
  } else if (trend === "down") {
    const color = positiveIsUp ? "#ef4444" : "#22c55e";
    icon = <TrendingDown className="w-4 h-4" style={{ color }} aria-hidden="true" />;
  } else {
    icon = <Minus className="w-4 h-4 text-sub/70" aria-hidden="true" />;
  }
  return (
    <span role="img" aria-label={TREND_LABEL[trend]} className="inline-flex">
      {icon}
    </span>
  );
}

export function MannKendallChip({
  series,
  positiveIsGood,
}: {
  series: number[];
  positiveIsGood: boolean;
}) {
  // Hooks are not allowed in this leaf; the cost is bounded by series length.
  // Mann-Kendall is O(n^2) but n here is at most a few dozen — cheap.
  const result = useMemo(() => mannKendall(series), [series]);
  if (series.length < 5 || result.trend === "none") return null;
  // A trend in the metric is "good" or "bad" depending on the metric.
  // For positive-is-good (predictability, health), an "up" trend is good.
  // For positive-is-bad (open impediments), an "up" trend is bad.
  const trendUp = result.trend === "up";
  const isGood = trendUp === positiveIsGood;
  const color = isGood ? "#22c55e" : "#ef4444";
  return (
    <span
      className="inline-flex items-center gap-1 text-xs font-mono uppercase tracking-wider px-1.5 py-0.5 rounded border"
      style={{
        color,
        borderColor: `${color}55`,
        background: `${color}1a`,
      }}
      title={`Mann-Kendall p=${result.pValue.toFixed(3)} — distribution-free monotonic trend test`}
    >
      {trendUp ? "↑" : "↓"} {isGood ? "trending up" : "trending down"}
    </span>
  );
}

export function TrafficCircle({
  status,
  size = 48,
  labelled = false,
}: {
  status: TrafficStatus;
  size?: number;
  /** Name the circle by its status ("On Track"); otherwise it's decoration. */
  labelled?: boolean;
}) {
  const color = STATUS_COLOR[status];
  return (
    <div
      {...(labelled
        ? { role: "img", "aria-label": STATUS_LABEL[status] }
        : { "aria-hidden": true })}
      className="rounded-full flex-shrink-0"
      style={{
        width: size,
        height: size,
        background: color,
        boxShadow: `0 0 12px ${color}88`,
      }}
    />
  );
}
