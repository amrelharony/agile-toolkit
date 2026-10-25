"use client";

/**
 * One KPI: its name and light, the value (or what is missing for one),
 * where it comes from, the team's limits, and a link to the source tool.
 * Theme tokens only; the light's name is always written beside its colour.
 */

import Link from "next/link";
import { ExternalLink, type LucideIcon } from "lucide-react";
import { NotEnoughData } from "@/components/shared/not-enough-data";
import type { HealthKpi } from "@/lib/health-dashboard/kpis";
import { limitText } from "@/lib/health-dashboard/settings";
import { cn } from "@/lib/utils";
import { STATUS_LABEL, STATUS_SURFACE, STATUS_TEXT } from "../status-config";

const UNIT: Record<HealthKpi["unit"], (v: number) => string> = {
  percent: () => "%",
  count: () => "",
  days: (v) => (v === 1 ? " day" : " days"),
};

export function KpiCard({ kpi, icon: Icon }: { kpi: HealthKpi; icon: LucideIcon }) {
  const lit = kpi.status !== null;
  const titleId = `kpi-${kpi.id}`;
  return (
    <article
      aria-labelledby={titleId}
      className={cn(
        "flex min-w-0 flex-col rounded-xl border p-4",
        lit ? STATUS_SURFACE[kpi.status!] : "border-border bg-surface-deep"
      )}
    >
      <div className="flex flex-wrap items-start justify-between gap-2">
        <div className="flex min-w-0 items-center gap-2">
          <Icon className="h-4 w-4 shrink-0 text-sub" aria-hidden="true" />
          <h3 id={titleId} className="text-sm font-medium text-text">
            {kpi.name}
          </h3>
        </div>
        <span
          className={cn(
            "rounded px-1.5 py-0.5 text-xs font-medium",
            lit ? STATUS_TEXT[kpi.status!] : "text-sub"
          )}
        >
          {lit ? STATUS_LABEL[kpi.status!] : kpi.hasData ? "Not enough data" : "No data"}
        </span>
      </div>

      <div className="mt-3 min-h-[2.5rem]">
        {kpi.value !== null ? (
          <p className={cn("font-data text-4xl font-bold leading-none", STATUS_TEXT[kpi.status!])}>
            {kpi.value}
            <span className="ml-1 text-sm font-normal text-sub">{UNIT[kpi.unit](kpi.value)}</span>
          </p>
        ) : kpi.need ? (
          <NotEnoughData
            have={kpi.need.have}
            need={kpi.need.need}
            unit={kpi.need.unit}
            action={kpi.need.action}
            what={kpi.need.what}
          />
        ) : (
          // aria-label on a <p> is ignored by screen readers: the dash is
          // hidden from them and the words are read instead.
          <p className="font-data text-2xl text-sub">
            <span aria-hidden="true">—</span>
            <span className="sr-only">No value</span>
          </p>
        )}
      </div>

      <p className="mt-3 text-xs text-sub">{kpi.basis}</p>
      {kpi.detail && <p className="mt-1 text-xs text-text">{kpi.detail}</p>}
      <p className="mt-2 text-xs text-sub">
        Green {limitText(kpi.id, kpi.threshold.green)} · amber{" "}
        {limitText(kpi.id, kpi.threshold.amber)}
      </p>
      <Link
        href={kpi.source.href}
        className="mt-3 inline-flex items-center gap-1 self-start text-xs font-medium text-accent hover:underline"
      >
        <ExternalLink className="h-3 w-3" aria-hidden="true" />
        {kpi.hasData ? kpi.source.label : `Open ${kpi.source.label}`}
      </Link>
    </article>
  );
}
