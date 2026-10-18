"use client";

import { useState, useEffect, useCallback, useMemo } from "react";
import Link from "next/link";
import { ToolPageWrapper } from "@/components/layout/tool-page-wrapper";
import { AiPromptGenerator } from "@/components/shared/ai-prompt-generator";
import { generateHealthDashboardPrompts } from "@/lib/ai-prompts/health-dashboard";
import { useHistoryLogger } from "@/lib/history/use-history-logger";
import { HEALTH_DASHBOARD_ACTIONS } from "@/lib/history/event-actions";
import { useHistoryStore } from "@/lib/history/history-store";
import { correlateEventStreams } from "@/lib/history/selectors";
import {
  CausalAnnotationList,
  type CausalAnnotationData,
} from "@/components/charts/causal-annotation-list";
import { Button } from "@/components/ui/button";
import { SectionCard } from "@/components/shared/section-card";
import {
  Activity,
  HeartPulse,
  AlertTriangle,
  Mic,
  Clock,
  LayoutDashboard,
  RefreshCw,
  CheckCircle2,
  AlertCircle,
  FileText,
  Copy,
  Check,
  Network,
} from "lucide-react";
import type { DataSourceStatus, KPI, TrafficStatus, TrendDir } from "./types";
import { extractCycleTimeKPIs } from "./extractors";
import { velocityKPIs, healthCheckKPIs, impedimentKPIs, standupKPIs } from "./synced-kpis";
import { useWorkspaceStore } from "@/lib/stores/workspace-store";
import {
  predictabilityStatus,
  healthPctStatus,
  openImpedimentsStatus,
  criticalImpedimentsStatus,
  openBlockersStatus,
  cycleTimeP85Status,
  STATUS_COLOR,
  STATUS_BG,
  STATUS_BORDER,
  TRAFFIC_SCORE,
} from "./status-config";
import { FullInsightsPanel } from "./components/full-insights-panel";
import { TrafficCircle } from "./components/kpi-indicators";
import { KpiCard } from "./components/kpi-card";

export function HealthDashboardClient() {
  const [refreshKey, setRefreshKey] = useState(0);
  const [summaryText, setSummaryText] = useState<string | null>(null);
  const [copied, setCopied] = useState(false);
  const { log } = useHistoryLogger("health-dashboard");
  // Subscribe to history events so cross-tool correlations recompute when new
  // events arrive (sprint completed, impediment raised, mood logged, etc.).
  const events = useHistoryStore((s) => s.events);

  /* -- Build all KPIs — memoized, refreshed only when refreshKey changes ---- */
  // R5: depend on `events` too so a fresh history event (sprint completed,
  // impediment raised, mood logged, etc.) refreshes the KPIs without
  // requiring a manual click on the refresh button. Previously the
  // dashboard could show stale KPIs that disagreed with the live
  // Active Signals panel directly above.
  //
  // R11-fix: gate the localStorage-reading extractors behind a `hydrated`
  // flag. On the SSR pass, `readStore` returns null (no window) — but
  // the very first client render would already see localStorage data,
  // producing a hydration mismatch every time the user has any tools
  // populated. We now match the SSR null-state on first paint, then
  // flip `hydrated=true` in a useEffect to trigger a real recompute.
  const [hydrated, setHydrated] = useState(false);
  useEffect(() => {
    setHydrated(true);
  }, []);
  // BUG-T3-health-dashboard-1: gate the extractor body, not just deps.
  // SSR returns null defaults (no window); first client render must do
  // the same so the markup matches and React doesn't warn about a
  // hydration mismatch. Flip to real values once `hydrated` is set.
  // Synced workspace entities — the authoritative source the agent's
  // tool.health_dashboard.get_summary also reads. These selectors are
  // reactive: an agent or cross-device write lands in the store and the
  // dashboard recomputes automatically (no manual Refresh needed).
  const sprints = useWorkspaceStore((s) => s.sprints);
  const healthChecks = useWorkspaceStore((s) => s.healthChecks);
  const impediments = useWorkspaceStore((s) => s.impediments);
  const standupEntries = useWorkspaceStore((s) => s.standupEntries);
  const teamMembers = useWorkspaceStore((s) => s.teamMembers);

  const velocityData = useMemo(
    () =>
      hydrated
        ? velocityKPIs(sprints ?? [])
        : { avgVelocity: null, predictability: null, trend: "same" as TrendDir, series: [] },
    [hydrated, sprints]
  );
  const healthCheckData = useMemo(
    () =>
      hydrated
        ? healthCheckKPIs(healthChecks ?? [])
        : { healthPct: null, trend: "same" as TrendDir, series: [] as number[] },
    [hydrated, healthChecks]
  );
  const impedimentData = useMemo(
    () =>
      hydrated
        ? impedimentKPIs(impediments ?? [])
        : { openCount: null, criticalCount: null, avgResolutionDays: null },
    [hydrated, impediments]
  );
  const standupData = useMemo(
    () =>
      hydrated
        ? standupKPIs(standupEntries ?? [], (teamMembers ?? []).length)
        : { openBlockers: null, participationRate: null },
    [hydrated, standupEntries, teamMembers]
  );
  const cycleTimeData = useMemo(
    () => (hydrated ? extractCycleTimeKPIs() : { p85: null }),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [hydrated, refreshKey, events]
  );

  /* -- Causal annotations from cross-tool event streams --------------------- */
  // Each correlation is a best-effort: when the source streams are too sparse
  // we silently skip the annotation rather than rendering noise. Confidence
  // tier is derived from `withinLagCount` and `pairs` thresholds.
  const annotations = useMemo<CausalAnnotationData[]>(() => {
    // `events` is in the dep array even though selectors read from getState();
    // including the reference here forces recomputation on every history mutation.
    void events;
    const out: CausalAnnotationData[] = [];

    // 1) Velocity dip ↔ blocker spike (lag −3 days)
    const velImp = correlateEventStreams(
      { toolId: "impediments", action: "impediment_raised" },
      { toolId: "velocity", action: "sprint_added" },
      3
    );
    if (velImp.withinLagCount >= 3 && velImp.pairs >= 6) {
      const conf =
        velImp.withinLagCount >= 8 ? "strong" : velImp.withinLagCount >= 5 ? "moderate" : "weak";
      out.push({
        x: 0,
        label: "Velocity dip aligned with blocker spike",
        detail: `Across ${velImp.pairs} sampled pairs, ${velImp.withinLagCount} blockers were raised within 3 days of a velocity update (mean lag ${velImp.meanLagDays.toFixed(1)} days). Inspect the Impediments and Velocity tools for the underlying sprints.`,
        link: { toolId: "impediments" },
        confidence: conf,
      });
    }

    // 2) Tech-debt added correlates with mood/NPS dip (lag −14 days)
    const debtMood = correlateEventStreams(
      { toolId: "tech-debt", action: "item_added" },
      { toolId: "mood-tracker", action: "mood_logged" },
      14
    );
    if (debtMood.withinLagCount >= 3 && debtMood.pairs >= 6) {
      const conf =
        debtMood.withinLagCount >= 8
          ? "strong"
          : debtMood.withinLagCount >= 5
            ? "moderate"
            : "weak";
      out.push({
        x: 1,
        label: "Tech-debt spike correlates with team mood / NPS dip",
        detail: `${debtMood.withinLagCount} of ${debtMood.pairs} tech-debt entries fell within 14 days of a mood log (mean lag ${debtMood.meanLagDays.toFixed(1)} days). Long-term debt accrual often precedes morale signals — worth exploring in the Tech Debt and Mood Tracker tools.`,
        link: { toolId: "tech-debt" },
        confidence: conf,
      });
    }

    // 3) Open risks spike preceded by missed sprint goal — best-effort.
    // We approximate "missed sprint goal" via `sprint_updated` (closest signal
    // available without sprint-goal coupling) and "open risks spike" via
    // `risk_added`. If either stream is empty the correlation collapses to 0.
    const goalRisk = correlateEventStreams(
      { toolId: "sprint-goal", action: "goal_saved" },
      { toolId: "risk-register", action: "risk_added" },
      14
    );
    if (goalRisk.withinLagCount >= 3 && goalRisk.pairs >= 6) {
      const conf =
        goalRisk.withinLagCount >= 8
          ? "strong"
          : goalRisk.withinLagCount >= 5
            ? "moderate"
            : "weak";
      out.push({
        x: 2,
        label: "Open risks rose after sprint-goal events",
        detail: `${goalRisk.withinLagCount} of ${goalRisk.pairs} new risks landed within 14 days of a sprint-goal save (mean lag ${goalRisk.meanLagDays.toFixed(1)} days). Sprint-goal pressure may be surfacing latent risks earlier — inspect the Risk Register for context.`,
        link: { toolId: "risk-register" },
        confidence: conf,
      });
    }

    return out;
  }, [events]);

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
        series: velocityData.series,
        positiveIsGood: true,
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
        series: healthCheckData.series,
        positiveIsGood: true,
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
        positiveIsGood: false,
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
        positiveIsGood: false,
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
        positiveIsGood: false,
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
        positiveIsGood: false,
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
    overallScore === null
      ? "red"
      : overallScore >= 75
        ? "green"
        : overallScore >= 50
          ? "amber"
          : "red";

  const promptConfig = useMemo(
    () => ({
      toolName: "Health Dashboard",
      prompts: generateHealthDashboardPrompts({
        kpis: kpis
          .filter((k) => k.value !== null)
          .map((k) => ({
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
      lines.push(`Velocity predictability is ${velocityData.predictability}% (target: 80%).`);
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
      lines.push(
        `Cycle time P85 is ${cycleTimeData.p85} day${cycleTimeData.p85 !== 1 ? "s" : ""}.`
      );
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
  }, [
    velocityData,
    healthCheckData,
    impedimentData,
    standupData,
    cycleTimeData,
    overallStatus,
    log,
  ]);

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
      title="Team Dashboard"
      description="Insights hub with cross-tool anti-pattern detection, forecasts, and aggregate KPIs from your entire workspace."
      category="Metrics & Dashboards"
      showInsights={false}
    >
      <FullInsightsPanel />

      {/* Cross-tool causal signals — only renders when at least one
          correlation crosses the confidence threshold. */}
      {annotations.length > 0 && (
        <SectionCard
          title="Cross-tool signals"
          icon={Network}
          className="border-border bg-surface-deep mb-6"
          titleSuffix={`(${annotations.length})`}
        >
          <p className="text-xs text-sub mb-1">
            Correlations the dashboard detected across your workspace event history. Click an item
            to expand, then drill into the source tool.
          </p>
          <CausalAnnotationList annotations={annotations} />
        </SectionCard>
      )}

      {/* Header controls */}
      <div className="flex items-center justify-between mb-6">
        <div className="flex items-center gap-2">
          <LayoutDashboard className="w-5 h-5 text-accent" />
          <span className="text-sm text-sub">
            {dataSources.filter((d) => d.hasData).length} of {dataSources.length} data sources
            connected
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
      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-3 sm:gap-4 mb-8">
        {kpis.map((kpi) => (
          <KpiCard key={kpi.id} kpi={kpi} />
        ))}
      </div>

      {/* Traffic Light Summary */}
      <SectionCard title="Traffic Light Summary" className="border-border bg-surface-deep mb-8">
        <div className="flex flex-wrap gap-6 mb-6">
          {kpis.map((kpi) => (
            <div key={kpi.id} className="flex flex-col items-center gap-2 min-w-[80px]">
              {kpi.value !== null ? (
                <TrafficCircle status={kpi.status} size={40} />
              ) : (
                <div className="w-10 h-10 rounded-full border-2 border-dashed border-border" />
              )}
              <span className="text-xs text-sub text-center leading-tight max-w-[80px]">
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
              Weighted average of {connectedKpis.length} connected KPI
              {connectedKpis.length !== 1 ? "s" : ""}
              {connectedKpis.length < kpis.length &&
                ` (${kpis.length - connectedKpis.length} awaiting data)`}
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
                    {overallStatus === "green"
                      ? "GOOD"
                      : overallStatus === "amber"
                        ? "MODERATE"
                        : "AT RISK"}
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
                    <Check className="w-3.5 h-3.5 text-success" />
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
            <Button size="sm" variant="toolkit" onClick={handleGenerateSummary} className="text-xs">
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
            Click &ldquo;Generate Summary&rdquo; to produce a formatted sprint health report from
            your connected data sources.
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
                    <CheckCircle2 className="w-4 h-4 text-success flex-shrink-0" />
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
