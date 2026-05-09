"use client";

import { useState, useCallback, useMemo } from "react";
import Link from "next/link";
import { ToolPageWrapper } from "@/components/layout/tool-page-wrapper";
import { AiPromptGenerator } from "@/components/shared/ai-prompt-generator";
import { InsightsEngine } from "@/components/shared/insights-engine";
import { generateHealthDashboardPrompts } from "@/lib/ai-prompts/health-dashboard";
import { useHistoryLogger } from "@/lib/history/use-history-logger";
import { HEALTH_DASHBOARD_ACTIONS } from "@/lib/history/event-actions";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { SectionCard } from "@/components/shared/section-card";
import { Badge } from "@/components/ui/badge";
import {
  Activity,
  HeartPulse,
  AlertTriangle,
  Mic,
  Clock,
  LayoutDashboard,
  RefreshCw,
  TrendingUp,
  TrendingDown,
  Minus,
  CheckCircle2,
  AlertCircle,
  ExternalLink,
  FileText,
  Copy,
  Check,
} from "lucide-react";
import { todayLocalISO } from "@/lib/utils/formatters";

function FullInsightsPanel() {
  return (
    <div className="mb-6 rounded-xl border border-accent/20 bg-accent/5 p-4">
      <div className="flex items-center gap-2 mb-3">
        <Activity className="w-4 h-4 text-accent" />
        <h2 className="text-sm font-semibold text-text">Active Signals</h2>
        <span className="text-xs text-sub">&mdash; cross-tool intelligence from your workspace</span>
      </div>
      <InsightsEngine limit={6} compact />
    </div>
  );
}

/* -------------------------------------------------------------------------- */
/*  Types                                                                     */
/* -------------------------------------------------------------------------- */

type TrafficStatus = "green" | "amber" | "red";
type TrendDir = "up" | "down" | "same";

interface KPI {
  id: string;
  name: string;
  value: number | null;
  unit: string;
  status: TrafficStatus;
  trend: TrendDir;
  sourcePath: string;
  sourceName: string;
  icon: React.ElementType;
  iconColor: string;
  description: string;
}

interface DataSourceStatus {
  key: string;
  label: string;
  path: string;
  hasData: boolean;
}

/* -------------------------------------------------------------------------- */
/*  localStorage parsing helpers                                              */
/* -------------------------------------------------------------------------- */

function readStore<T>(key: string): T | null {
  if (typeof window === "undefined") return null;
  try {
    const raw = localStorage.getItem(key);
    if (!raw) return null;
    const parsed = JSON.parse(raw);
    // zustand persist wraps state in { state: {...}, version: N }
    return (parsed?.state ?? parsed) as T;
  } catch {
    return null;
  }
}

/* --- Velocity --- */
interface VelocitySprint {
  id: string;
  committed: number;
  completed: number;
}

function extractVelocityKPIs(): { avgVelocity: number | null; predictability: number | null; trend: TrendDir } {
  const data = readStore<{ sprints: VelocitySprint[] }>("agile-toolkit:velocity");
  if (!data?.sprints?.length) return { avgVelocity: null, predictability: null, trend: "same" };

  const sprints = data.sprints;
  const completed = sprints.map((s) => s.completed);
  const avg = completed.reduce((a, b) => a + b, 0) / completed.length;
  const predictable = sprints.filter((s) => s.completed >= s.committed).length;
  const predictability = (predictable / sprints.length) * 100;

  let trend: TrendDir = "same";
  if (completed.length >= 4) {
    const half = Math.floor(completed.length / 2);
    const firstHalf = completed.slice(0, half).reduce((a, b) => a + b, 0) / half;
    const secondHalf = completed.slice(-half).reduce((a, b) => a + b, 0) / half;
    const diff = secondHalf - firstHalf;
    if (diff > 1) trend = "up";
    else if (diff < -1) trend = "down";
  }

  return { avgVelocity: Math.round(avg * 10) / 10, predictability: Math.round(predictability), trend };
}

/* --- Health Check --- */
type HealthLight = "green" | "yellow" | "red";
type HealthTrend = "up" | "same" | "down";

interface HealthDimensionScore {
  light: HealthLight;
  trend: HealthTrend;
}

interface HealthCheckHistoryEntry {
  id: string;
  sprintName: string;
  date: string;
  scores: Record<string, HealthDimensionScore>;
}

function extractHealthCheckKPIs(): { healthPct: number | null; trend: TrendDir } {
  const data = readStore<{
    current: { scores: Record<string, HealthDimensionScore> };
    history: HealthCheckHistoryEntry[];
  }>("agile-toolkit:health-check");

  if (!data?.current?.scores) return { healthPct: null, trend: "same" };

  const scoreMap: Record<HealthLight, number> = { green: 2, yellow: 1, red: 0 };
  const scores = Object.values(data.current.scores);
  if (scores.length === 0) return { healthPct: null, trend: "same" };

  const total = scores.reduce((sum, s) => sum + scoreMap[s.light], 0);
  const maxTotal = scores.length * 2;
  const pct = Math.round((total / maxTotal) * 100);

  // Trend: compare current to last history entry
  let trend: TrendDir = "same";
  const history = data.history ?? [];
  if (history.length > 0) {
    const last = history[history.length - 1];
    const lastScores = Object.values(last.scores);
    if (lastScores.length > 0) {
      const lastTotal = lastScores.reduce((sum, s) => sum + scoreMap[s.light], 0);
      const lastPct = (lastTotal / (lastScores.length * 2)) * 100;
      const diff = pct - lastPct;
      if (diff > 5) trend = "up";
      else if (diff < -5) trend = "down";
    }
  }

  return { healthPct: pct, trend };
}

/* --- Impediments --- */
interface Impediment {
  id: string;
  severity: string;
  status: string;
  raisedDate: string;
  resolvedDate?: string;
}

function extractImpedimentKPIs(): {
  openCount: number | null;
  criticalCount: number | null;
  avgResolutionDays: number | null;
} {
  const data = readStore<{ impediments: Impediment[] }>("agile-toolkit:impediments");
  if (!data?.impediments) return { openCount: null, criticalCount: null, avgResolutionDays: null };

  const imps = data.impediments;
  const open = imps.filter((i) => i.status !== "Resolved");
  const critical = open.filter((i) => i.severity === "Critical");

  const resolved = imps.filter((i) => i.status === "Resolved" && i.resolvedDate && i.raisedDate);
  let avgDays: number | null = null;
  if (resolved.length > 0) {
    const totalDays = resolved.reduce((sum, i) => {
      const start = new Date(i.raisedDate).getTime();
      const end = new Date(i.resolvedDate!).getTime();
      return sum + Math.max(0, (end - start) / (1000 * 60 * 60 * 24));
    }, 0);
    avgDays = Math.round((totalDays / resolved.length) * 10) / 10;
  }

  return {
    openCount: open.length,
    criticalCount: critical.length,
    avgResolutionDays: avgDays,
  };
}

/* --- Standup --- */
interface StandupEntry {
  id: string;
  member: string;
  date: string;
  blockers: string;
  timestamp: number;
}

function extractStandupKPIs(): {
  openBlockers: number | null;
  participationRate: number | null;
} {
  const data = readStore<{
    members: string[];
    entries: StandupEntry[];
    resolvedBlockers: string[];
  }>("agile-toolkit:standup");

  if (!data?.entries) return { openBlockers: null, participationRate: null };

  const today = todayLocalISO();
  const allEntries = data.entries;
  const resolvedBlockers = data.resolvedBlockers ?? [];

  const entriesWithBlockers = allEntries.filter(
    (e) => e.blockers?.trim() && !resolvedBlockers.includes(e.id)
  );
  const openBlockers = entriesWithBlockers.length;

  // Participation: today's entries vs total members
  const members = data.members ?? [];
  const todayEntries = allEntries.filter((e) => e.date === today);
  const participationRate =
    members.length > 0 ? Math.round((todayEntries.length / members.length) * 100) : null;

  return { openBlockers, participationRate };
}

/* --- Cycle Time --- */
interface WorkItem {
  id: string;
  startDate: string;
  endDate: string;
}

function extractCycleTimeKPIs(): { p85: number | null } {
  const data = readStore<{ items: WorkItem[] }>("agile-toolkit:cycle-time");
  if (!data?.items?.length) return { p85: null };

  const cycleTimes: number[] = data.items
    .map((item) => {
      if (!item.startDate || !item.endDate) return null;
      const s = new Date(item.startDate).getTime();
      const e = new Date(item.endDate).getTime();
      if (isNaN(s) || isNaN(e) || e < s) return null;
      return Math.round((e - s) / (1000 * 60 * 60 * 24));
    })
    .filter((v): v is number => v !== null)
    .sort((a, b) => a - b);

  if (cycleTimes.length === 0) return { p85: null };

  const idx = Math.ceil((cycleTimes.length * 85) / 100) - 1;
  const p85 = cycleTimes[Math.max(0, Math.min(idx, cycleTimes.length - 1))];

  return { p85 };
}

/* -------------------------------------------------------------------------- */
/*  Threshold helpers                                                         */
/* -------------------------------------------------------------------------- */

function predictabilityStatus(v: number | null): TrafficStatus {
  if (v === null) return "red";
  if (v >= 80) return "green";
  if (v >= 60) return "amber";
  return "red";
}

function healthPctStatus(v: number | null): TrafficStatus {
  if (v === null) return "red";
  if (v >= 75) return "green";
  if (v >= 50) return "amber";
  return "red";
}

function openImpedimentsStatus(v: number | null): TrafficStatus {
  if (v === null) return "red";
  if (v === 0) return "green";
  if (v <= 3) return "amber";
  return "red";
}

function criticalImpedimentsStatus(v: number | null): TrafficStatus {
  if (v === null) return "red";
  if (v === 0) return "green";
  return "red";
}

function openBlockersStatus(v: number | null): TrafficStatus {
  if (v === null) return "red";
  if (v === 0) return "green";
  if (v <= 2) return "amber";
  return "red";
}

function cycleTimeP85Status(v: number | null): TrafficStatus {
  if (v === null) return "red";
  if (v <= 7) return "green";
  if (v <= 14) return "amber";
  return "red";
}

/* -------------------------------------------------------------------------- */
/*  Colors                                                                    */
/* -------------------------------------------------------------------------- */

const STATUS_COLOR: Record<TrafficStatus, string> = {
  green: "#22c55e",
  amber: "#eab308",
  red: "#ef4444",
};

const STATUS_BG: Record<TrafficStatus, string> = {
  green: "rgba(34,197,94,0.1)",
  amber: "rgba(234,179,8,0.1)",
  red: "rgba(239,68,68,0.1)",
};

const STATUS_BORDER: Record<TrafficStatus, string> = {
  green: "rgba(34,197,94,0.25)",
  amber: "rgba(234,179,8,0.25)",
  red: "rgba(239,68,68,0.25)",
};

const STATUS_LABEL: Record<TrafficStatus, string> = {
  green: "On Track",
  amber: "Needs Attention",
  red: "At Risk",
};

/* -------------------------------------------------------------------------- */
/*  Score weights for overall health                                          */
/* -------------------------------------------------------------------------- */

const TRAFFIC_SCORE: Record<TrafficStatus, number> = { green: 2, amber: 1, red: 0 };

/* -------------------------------------------------------------------------- */
/*  Trend icon                                                                */
/* -------------------------------------------------------------------------- */

function TrendIcon({ trend, positiveIsUp = true }: { trend: TrendDir; positiveIsUp?: boolean }) {
  if (trend === "up") {
    const color = positiveIsUp ? "#22c55e" : "#ef4444";
    return <TrendingUp className="w-4 h-4" style={{ color }} />;
  }
  if (trend === "down") {
    const color = positiveIsUp ? "#ef4444" : "#22c55e";
    return <TrendingDown className="w-4 h-4" style={{ color }} />;
  }
  return <Minus className="w-4 h-4 text-sub/70" />;
}

/* -------------------------------------------------------------------------- */
/*  Traffic light circle                                                      */
/* -------------------------------------------------------------------------- */

function TrafficCircle({ status, size = 48 }: { status: TrafficStatus; size?: number }) {
  const color = STATUS_COLOR[status];
  return (
    <div
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

/* -------------------------------------------------------------------------- */
/*  Main component                                                            */
/* -------------------------------------------------------------------------- */

export function HealthDashboardClient() {
  const [refreshKey, setRefreshKey] = useState(0);
  const [summaryText, setSummaryText] = useState<string | null>(null);
  const [copied, setCopied] = useState(false);
  const { log } = useHistoryLogger("health-dashboard");

  /* -- Build all KPIs — memoized, refreshed only when refreshKey changes ---- */
  // eslint-disable-next-line react-hooks/exhaustive-deps
  const velocityData = useMemo(() => extractVelocityKPIs(), [refreshKey]);
  // eslint-disable-next-line react-hooks/exhaustive-deps
  const healthCheckData = useMemo(() => extractHealthCheckKPIs(), [refreshKey]);
  // eslint-disable-next-line react-hooks/exhaustive-deps
  const impedimentData = useMemo(() => extractImpedimentKPIs(), [refreshKey]);
  // eslint-disable-next-line react-hooks/exhaustive-deps
  const standupData = useMemo(() => extractStandupKPIs(), [refreshKey]);
  // eslint-disable-next-line react-hooks/exhaustive-deps
  const cycleTimeData = useMemo(() => extractCycleTimeKPIs(), [refreshKey]);

  const kpis: KPI[] = useMemo(
    () => [
      {
        id: "predictability",
        name: "Velocity Predictability",
        value: velocityData.predictability,
        unit: "%",
        status: predictabilityStatus(velocityData.predictability),
        trend: velocityData.trend,
        sourcePath: "/velocity",
        sourceName: "Velocity Tracker",
        icon: Activity,
        iconColor: "#00f0ff",
        description: "% of sprints where completed ≥ committed",
      },
      {
        id: "team-health",
        name: "Team Health Score",
        value: healthCheckData.healthPct,
        unit: "%",
        status: healthPctStatus(healthCheckData.healthPct),
        trend: healthCheckData.trend,
        sourcePath: "/health-check",
        sourceName: "Squad Health Check",
        icon: HeartPulse,
        iconColor: "#ff00aa",
        description: "Overall squad health across all dimensions",
      },
      {
        id: "open-impediments",
        name: "Open Impediments",
        value: impedimentData.openCount,
        unit: "",
        status: openImpedimentsStatus(impedimentData.openCount),
        trend: "same",
        sourcePath: "/impediments",
        sourceName: "Impediment Tracker",
        icon: AlertTriangle,
        iconColor: "#eab308",
        description: "Total unresolved impediments",
      },
      {
        id: "critical-impediments",
        name: "Critical Impediments",
        value: impedimentData.criticalCount,
        unit: "",
        status: criticalImpedimentsStatus(impedimentData.criticalCount),
        trend: "same",
        sourcePath: "/impediments",
        sourceName: "Impediment Tracker",
        icon: AlertCircle,
        iconColor: "#ef4444",
        description: "Impediments at Critical severity",
      },
      {
        id: "open-blockers",
        name: "Open Standup Blockers",
        value: standupData.openBlockers,
        unit: "",
        status: openBlockersStatus(standupData.openBlockers),
        trend: "same",
        sourcePath: "/standup",
        sourceName: "Standup Tracker",
        icon: Mic,
        iconColor: "#8b5cf6",
        description: "Unresolved blockers from standup logs",
      },
      {
        id: "cycle-time-p85",
        name: "Cycle Time P85",
        value: cycleTimeData.p85,
        unit: " days",
        status: cycleTimeP85Status(cycleTimeData.p85),
        trend: "same",
        sourcePath: "/cycle-time",
        sourceName: "Cycle Time Analyzer",
        icon: Clock,
        iconColor: "#f97316",
        description: "85th percentile cycle time in days",
      },
    ],
    [velocityData, healthCheckData, impedimentData, standupData, cycleTimeData]
  );

  const dataSources: DataSourceStatus[] = useMemo(
    () => [
      {
        key: "agile-toolkit:velocity",
        label: "Velocity Tracker",
        path: "/velocity",
        hasData: velocityData.predictability !== null,
      },
      {
        key: "agile-toolkit:health-check",
        label: "Squad Health Check",
        path: "/health-check",
        hasData: healthCheckData.healthPct !== null,
      },
      {
        key: "agile-toolkit:impediments",
        label: "Impediment Tracker",
        path: "/impediments",
        hasData: impedimentData.openCount !== null,
      },
      {
        key: "agile-toolkit:standup",
        label: "Standup Tracker",
        path: "/standup",
        hasData: standupData.openBlockers !== null,
      },
      {
        key: "agile-toolkit:cycle-time",
        label: "Cycle Time Analyzer",
        path: "/cycle-time",
        hasData: cycleTimeData.p85 !== null,
      },
    ],
    [velocityData, healthCheckData, impedimentData, standupData, cycleTimeData]
  );

  /* -- Overall score ------------------------------------------------------- */
  const connectedKpis = kpis.filter((k) => k.value !== null);
  const overallScore =
    connectedKpis.length > 0
      ? Math.round(
          (connectedKpis.reduce((sum, k) => sum + TRAFFIC_SCORE[k.status], 0) /
            (connectedKpis.length * 2)) *
            100
        )
      : null;

  const overallStatus: TrafficStatus =
    overallScore === null ? "red" : overallScore >= 75 ? "green" : overallScore >= 50 ? "amber" : "red";

  const promptConfig = useMemo(
    () => ({
      toolName: "Health Dashboard",
      prompts: generateHealthDashboardPrompts({
        kpis: kpis.filter((k) => k.value !== null).map((k) => ({
          name: k.name,
          value: k.value ?? 0,
          unit: k.unit,
          status: k.status,
          trend: k.trend,
          sourceName: k.sourceName,
          description: k.description,
        })),
      }),
    }),
    // Refresh both when the user explicitly clicks Refresh AND when any
    // upstream extractor output changes — kpis is now memoized and tracks
    // those primitives, so it's safe to depend on directly.
    [refreshKey, kpis]
  );

  /* -- Refresh ------------------------------------------------------------- */
  const handleRefresh = useCallback(() => {
    setSummaryText(null);
    setRefreshKey((k) => k + 1);
    log(HEALTH_DASHBOARD_ACTIONS.DASHBOARD_REFRESHED, {});
  }, [log]);

  /* -- Generate summary ---------------------------------------------------- */
  const handleGenerateSummary = useCallback(() => {
    const date = new Date().toLocaleDateString("en-GB", {
      day: "2-digit",
      month: "short",
      year: "numeric",
    });

    const overallLabel =
      overallStatus === "green" ? "GOOD" : overallStatus === "amber" ? "MODERATE" : "AT RISK";

    const lines: string[] = [
      `Sprint Health Report — ${date}`,
      `Overall team health is ${overallLabel}.`,
      "",
    ];

    if (velocityData.predictability !== null) {
      lines.push(
        `Velocity predictability is ${velocityData.predictability}% (target: 80%).`
      );
    } else {
      lines.push("Velocity data is not yet available.");
    }

    if (healthCheckData.healthPct !== null) {
      lines.push(
        `Team health score is ${healthCheckData.healthPct}% based on the latest squad check.`
      );
    } else {
      lines.push("Squad health check data is not yet available.");
    }

    if (impedimentData.openCount !== null) {
      lines.push(
        `${impedimentData.openCount} impediment${impedimentData.openCount !== 1 ? "s" : ""} are open, ${impedimentData.criticalCount ?? 0} are critical.`
      );
    } else {
      lines.push("Impediment data is not yet available.");
    }

    if (standupData.openBlockers !== null) {
      lines.push(
        `${standupData.openBlockers} blocker${standupData.openBlockers !== 1 ? "s" : ""} ${standupData.openBlockers === 1 ? "is" : "are"} unresolved from standup.`
      );
    } else {
      lines.push("Standup data is not yet available.");
    }

    if (cycleTimeData.p85 !== null) {
      lines.push(`Cycle time P85 is ${cycleTimeData.p85} day${cycleTimeData.p85 !== 1 ? "s" : ""}.`);
    } else {
      lines.push("Cycle time data is not yet available.");
    }

    setSummaryText(lines.join("\n"));
    log(HEALTH_DASHBOARD_ACTIONS.SUMMARY_GENERATED, {
      overallStatus,
      predictability: velocityData.predictability,
      healthPct: healthCheckData.healthPct,
      openImpediments: impedimentData.openCount,
    });
  }, [velocityData, healthCheckData, impedimentData, standupData, cycleTimeData, overallStatus, log]);

  /* -- Copy to clipboard --------------------------------------------------- */
  const handleCopy = useCallback(() => {
    if (!summaryText) return;
    navigator.clipboard.writeText(summaryText).then(() => {
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
      log(HEALTH_DASHBOARD_ACTIONS.SUMMARY_COPIED, {});
    });
  }, [summaryText, log]);

  /* -- Render -------------------------------------------------------------- */
  return (
    <ToolPageWrapper
      toolId="health-dashboard"
      title="Agile Health Dashboard"
      description="Insights hub with cross-tool anti-pattern detection, forecasts, and aggregate KPIs from your entire workspace."
      category="Metrics & Dashboards"
      showInsights={false}
    >
      <FullInsightsPanel />
      {/* Header controls */}
      <div className="flex items-center justify-between mb-6">
        <div className="flex items-center gap-2">
          <LayoutDashboard className="w-5 h-5 text-accent" />
          <span className="text-sm text-sub">
            {dataSources.filter((d) => d.hasData).length} of {dataSources.length} data sources connected
          </span>
        </div>
        <div className="flex items-center gap-2">
          <AiPromptGenerator config={promptConfig} />
          <Button
            variant="outline"
            size="sm"
            onClick={handleRefresh}
            className="border-border text-text/80 hover:text-text hover:border-border gap-2"
          >
            <RefreshCw className="w-4 h-4" />
            Refresh
          </Button>
        </div>
      </div>

      {/* KPI Cards — 2x3 grid */}
      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4 mb-8">
        {kpis.map((kpi) => {
          const Icon = kpi.icon;
          const hasData = kpi.value !== null;
          return (
            <Card
              key={kpi.id}
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
                    <div
                      className="p-1.5 rounded-lg"
                      style={{ background: `${kpi.iconColor}1a` }}
                    >
                      <Icon className="w-4 h-4" style={{ color: kpi.iconColor }} />
                    </div>
                    <CardTitle className="text-sm font-medium text-text/80">
                      {kpi.name}
                    </CardTitle>
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
                        <TrendIcon trend={kpi.trend} positiveIsUp={kpi.id !== "open-impediments" && kpi.id !== "critical-impediments" && kpi.id !== "open-blockers" && kpi.id !== "cycle-time-p85"} />
                      </div>
                    </div>
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
        })}
      </div>

      {/* Traffic Light Summary */}
      <SectionCard
        title="Traffic Light Summary"
        className="border-border bg-surface-deep mb-8"
      >
        <div className="flex flex-wrap gap-6 mb-6">
          {kpis.map((kpi) => (
            <div key={kpi.id} className="flex flex-col items-center gap-2 min-w-[80px]">
              {kpi.value !== null ? (
                <TrafficCircle status={kpi.status} size={40} />
              ) : (
                <div
                  className="w-10 h-10 rounded-full border-2 border-dashed border-border"
                />
              )}
              <span className="text-[10px] text-sub text-center leading-tight max-w-[80px]">
                {kpi.name}
              </span>
            </div>
          ))}
        </div>

        {/* Overall score */}
        <div
          className="rounded-xl p-4 flex flex-col sm:flex-row items-start sm:items-center justify-between gap-4"
          style={{
            background: overallScore !== null ? STATUS_BG[overallStatus] : "rgba(255,255,255,0.04)",
            border: `1px solid ${overallScore !== null ? STATUS_BORDER[overallStatus] : "rgba(255,255,255,0.07)"}`,
          }}
        >
          <div>
            <p className="text-xs text-sub uppercase tracking-wider mb-1">Overall Health Score</p>
            <p className="text-xs text-sub/70">
              Weighted average of {connectedKpis.length} connected KPI{connectedKpis.length !== 1 ? "s" : ""}
              {connectedKpis.length < kpis.length && ` (${kpis.length - connectedKpis.length} awaiting data)`}
            </p>
          </div>
          <div className="flex items-center gap-3">
            {overallScore !== null ? (
              <>
                <TrafficCircle status={overallStatus} size={52} />
                <div className="text-right">
                  <p
                    className="text-4xl font-data font-bold leading-none"
                    style={{ color: STATUS_COLOR[overallStatus] }}
                  >
                    {overallScore}%
                  </p>
                  <p className="text-sm mt-1" style={{ color: STATUS_COLOR[overallStatus] }}>
                    {overallStatus === "green" ? "GOOD" : overallStatus === "amber" ? "MODERATE" : "AT RISK"}
                  </p>
                </div>
              </>
            ) : (
              <p className="text-sub/70 text-sm">No data connected yet</p>
            )}
          </div>
        </div>
      </SectionCard>

      {/* Executive Summary Generator */}
      <SectionCard
        title="Executive Summary"
        icon={FileText}
        className="border-border bg-surface-deep mb-8"
        actions={
          <>
            {summaryText && (
              <Button
                variant="outline"
                size="sm"
                onClick={handleCopy}
                className="border-border text-sub hover:text-text hover:border-border gap-1.5 text-xs"
              >
                {copied ? (
                  <>
                    <Check className="w-3.5 h-3.5 text-[#22c55e]" />
                    Copied
                  </>
                ) : (
                  <>
                    <Copy className="w-3.5 h-3.5" />
                    Copy
                  </>
                )}
              </Button>
            )}
            <Button
              size="sm"
              variant="toolkit"
              onClick={handleGenerateSummary}
              className="text-xs"
            >
              Generate Summary
            </Button>
          </>
        }
      >
        {summaryText ? (
          <pre className="font-mono text-sm text-text whitespace-pre-wrap bg-card rounded-lg p-4 border border-border leading-relaxed">
            {summaryText}
          </pre>
        ) : (
          <p className="text-sm text-sub/70 italic">
            Click &ldquo;Generate Summary&rdquo; to produce a formatted sprint health report from your connected data sources.
          </p>
        )}
      </SectionCard>

      {/* Data Source Status */}
      <div>
        <h2 className="text-sm font-medium text-sub uppercase tracking-wider mb-3">
          Data Source Status
        </h2>
        <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-5 gap-3">
          {dataSources.map((src) => (
            <Link key={src.key} href={src.path}>
              <div
                className="rounded-lg p-3 border transition-colors hover:border-border cursor-pointer"
                style={{
                  background: src.hasData ? "rgba(34,197,94,0.05)" : "rgba(255,255,255,0.03)",
                  borderColor: src.hasData ? "rgba(34,197,94,0.2)" : "rgba(255,255,255,0.08)",
                }}
              >
                <div className="flex items-center gap-2 mb-1.5">
                  {src.hasData ? (
                    <CheckCircle2 className="w-4 h-4 text-[#22c55e] flex-shrink-0" />
                  ) : (
                    <AlertCircle className="w-4 h-4 text-sub/60 flex-shrink-0" />
                  )}
                  <span
                    className="text-xs font-medium truncate"
                    style={{ color: src.hasData ? "#22c55e" : "rgba(255,255,255,0.3)" }}
                  >
                    {src.hasData ? "Connected" : "No data"}
                  </span>
                </div>
                <p className="text-xs text-sub leading-tight">{src.label}</p>
              </div>
            </Link>
          ))}
        </div>
      </div>
    </ToolPageWrapper>
  );
}
