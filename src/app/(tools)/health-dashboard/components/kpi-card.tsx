"use client";

/**
 * A single KPI card: icon, name, status badge, big value + trend arrow, an
 * optional Mann-Kendall chip, the metric description, and a link to the source
 * tool. Renders a muted "No data yet" state when the KPI value is null.
 */

import Link from "next/link";
import { ExternalLink } from "lucide-react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import type { KPI } from "../types";
import { STATUS_BG, STATUS_BORDER, STATUS_COLOR, STATUS_LABEL } from "../status-config";
import { MannKendallChip, TrendIcon } from "./kpi-indicators";

export function KpiCard({ kpi }: { kpi: KPI }) {
  const Icon = kpi.icon;
  const hasData = kpi.value !== null;
  return (
    <Card
      className="border-border bg-surface-deep relative overflow-hidden"
      style={{
        borderColor: hasData ? STATUS_BORDER[kpi.status] : "rgba(255,255,255,0.07)",
      }}
    >
      {/* Glow accent */}
      {hasData && (
        <div
          className="absolute inset-0 opacity-5 pointer-events-none"
          style={{ background: STATUS_COLOR[kpi.status] }}
        />
      )}
      <CardHeader className="pb-2 pt-4 px-4">
        <div className="flex items-start justify-between">
          <div className="flex items-center gap-2">
            <div className="p-1.5 rounded-lg" style={{ background: `${kpi.iconColor}1a` }}>
              <Icon className="w-4 h-4" style={{ color: kpi.iconColor }} />
            </div>
            <CardTitle className="text-sm font-medium text-text/80">{kpi.name}</CardTitle>
          </div>
          {hasData && (
            <Badge
              className="text-[10px] font-medium px-1.5 py-0.5 border-0"
              style={{
                background: STATUS_BG[kpi.status],
                color: STATUS_COLOR[kpi.status],
              }}
            >
              {STATUS_LABEL[kpi.status]}
            </Badge>
          )}
        </div>
      </CardHeader>
      <CardContent className="px-4 pb-4">
        {hasData ? (
          <>
            <div className="flex items-end gap-2 mb-2">
              <span
                className="text-4xl font-data font-bold leading-none"
                style={{ color: STATUS_COLOR[kpi.status] }}
              >
                {kpi.value}
              </span>
              <span className="text-sm text-sub mb-1">{kpi.unit}</span>
              <div className="ml-auto mb-1">
                <TrendIcon trend={kpi.trend} positiveIsUp={kpi.positiveIsGood ?? true} />
              </div>
            </div>
            {kpi.series && kpi.series.length >= 5 && (
              <div className="mb-2">
                <MannKendallChip series={kpi.series} positiveIsGood={kpi.positiveIsGood ?? true} />
              </div>
            )}
            <p className="text-xs text-sub mb-3">{kpi.description}</p>
            <Link
              href={kpi.sourcePath}
              className="inline-flex items-center gap-1 text-xs text-sub hover:text-accent transition-colors"
            >
              <ExternalLink className="w-3 h-3" />
              {kpi.sourceName}
            </Link>
          </>
        ) : (
          <div className="py-2">
            <p className="text-2xl font-data text-sub/50 mb-1">—</p>
            <p className="text-xs text-sub/70 mb-3">No data yet</p>
            <Link
              href={kpi.sourcePath}
              className="inline-flex items-center gap-1 text-xs text-accent/60 hover:text-accent transition-colors"
            >
              <ExternalLink className="w-3 h-3" />
              Open {kpi.sourceName}
            </Link>
          </div>
        )}
      </CardContent>
    </Card>
  );
}
