"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { AreaChart, Area, CartesianGrid, XAxis, YAxis, Tooltip, Legend } from "recharts";
import { ToolPageWrapper } from "@/components/layout/tool-page-wrapper";
import { ExportButton } from "@/components/shared/export-button";
import { AiPromptGenerator } from "@/components/shared/ai-prompt-generator";
import { ActionRow } from "@/components/shared/action-row";
import { KpiGrid } from "@/components/shared/kpi-grid";
import { StatCard } from "@/components/shared/stat-card";
import { SectionCard } from "@/components/shared/section-card";
import { ChartCard } from "@/components/shared/chart-card";
import { EmptyState } from "@/components/shared/empty-state";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Badge } from "@/components/ui/badge";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Plus, Trash2, Bug, AlertTriangle, Clock, ShieldOff } from "lucide-react";
import { chartTheme } from "@/components/charts/chart-theme";
import { CausalLine, type CausalAnnotationData } from "@/components/charts/causal-annotation";
import { SmartInput } from "@/components/shared/smart-input";
import { cusum } from "@/lib/analytics/changepoint";
import { mannKendall } from "@/lib/analytics/trend-test";
import { usePredictedDefault } from "@/lib/predictions/use-predicted-default";
import { generateVulnPrompts } from "@/lib/ai-prompts/vuln-burndown";
import { useShallow } from "zustand/react/shallow";
import { useWorkspaceStore } from "@/lib/stores/workspace-store";
import type {
  Vulnerability as Vuln,
  VulnSeverity as Severity,
  VulnStatus as Status,
} from "@/lib/stores/workspace-types";
import { useHistoryLogger } from "@/lib/history/use-history-logger";
import { VULN_ACTIONS } from "@/lib/history/event-actions";
import { todayLocalISO } from "@/lib/utils/formatters";

/* ── Types ──────────────────────────────────────────────────────────────── */

interface VulnState {
  vulns: Vuln[];
}

const DEFAULT_STATE: VulnState = { vulns: [] };

const VB_ID = "vulnBurndown:current"; // MUST match VB_ID in vuln-burndown.ts.

// Synced workspace singleton (was isolated usePersisted/localStorage), so MCP
// vuln writes round-trip into the UI. Drop-in [state, setState].
function useVulnBurndown(): [VulnState, (u: VulnState | ((p: VulnState) => VulnState)) => void] {
  const doc = useWorkspaceStore(
    useShallow((s) => (s.vulnBurndowns ?? []).find((d) => d.id === VB_ID))
  );
  const upsert = useWorkspaceStore((s) => s.upsertVulnBurndown);
  const state: VulnState = doc ? { vulns: doc.vulns } : DEFAULT_STATE;
  const setState = (u: VulnState | ((p: VulnState) => VulnState)) => {
    const cur = (useWorkspaceStore.getState().vulnBurndowns ?? []).find((d) => d.id === VB_ID);
    const curState: VulnState = cur ? { vulns: cur.vulns } : DEFAULT_STATE;
    const next = typeof u === "function" ? u(curState) : u;
    upsert({ id: VB_ID, vulns: next.vulns });
  };
  return [state, setState];
}

const SEVERITY_OPTIONS: { value: Severity; label: string }[] = [
  { value: "critical", label: "Critical" },
  { value: "high", label: "High" },
  { value: "medium", label: "Medium" },
  { value: "low", label: "Low" },
];

const SEVERITY_COLOR: Record<Severity, string> = {
  critical: "#ef4444",
  high: "#f59e0b",
  medium: "#facc15",
  low: "#34d399",
};

const SEVERITY_DEFAULT_SLA: Record<Severity, number> = {
  critical: 7,
  high: 30,
  medium: 60,
  low: 90,
};

const STATUS_OPTIONS: { value: Status; label: string }[] = [
  { value: "open", label: "Open" },
  { value: "in_progress", label: "In Progress" },
  { value: "resolved", label: "Resolved" },
  { value: "accepted", label: "Accepted" },
];

/* ── Helpers ────────────────────────────────────────────────────────────── */

function dayDiff(fromIso: string, toIso?: string): number {
  // Local-calendar day diff (rounded). Avoids the UTC drift bug from raw ISO
  // parsing + setHours combos.
  const m1 = /^(\d{4})-(\d{2})-(\d{2})/.exec(fromIso);
  if (!m1) return 0;
  const from = new Date(Number(m1[1]), Number(m1[2]) - 1, Number(m1[3])).getTime();
  let to: number;
  if (toIso) {
    const m2 = /^(\d{4})-(\d{2})-(\d{2})/.exec(toIso);
    if (!m2) return 0;
    to = new Date(Number(m2[1]), Number(m2[2]) - 1, Number(m2[3])).getTime();
  } else {
    const now = new Date();
    to = new Date(now.getFullYear(), now.getMonth(), now.getDate()).getTime();
  }
  if (!Number.isFinite(from) || !Number.isFinite(to)) return 0;
  return Math.max(0, Math.round((to - from) / (1000 * 60 * 60 * 24)));
}

// `resolvedAt` is deliberately PRESERVED across a resolved→open transition
// (see `setStatus`) so a misclick doesn't destroy the original resolution
// date. That makes `status` — not the presence of `resolvedAt` — the only
// valid "is this closed?" test. Keying off the timestamp froze a re-opened
// vuln's age at the old resolution date, so it never counted as an SLA
// breach and vanished from the burn-down chart while the "Open" KPI still
// counted it.
function isResolved(v: Vuln): boolean {
  return v.status === "resolved";
}

function ageDays(v: Vuln): number {
  return dayDiff(v.openedAt, isResolved(v) ? v.resolvedAt : undefined);
}

/* ── Main client ────────────────────────────────────────────────────────── */

export function VulnBurndownClient() {
  const [state, setState] = useVulnBurndown();
  const { log } = useHistoryLogger("vuln-burndown");
  const chartRef = useRef<HTMLDivElement>(null);

  // Add-form draft state (string-draft for numeric SLA).
  const [cve, setCve] = useState("");
  const [severity, setSeverity] = useState<Severity>("high");
  const [slaDraft, setSlaDraft] = useState<string>(String(SEVERITY_DEFAULT_SLA.high));
  const [owner, setOwner] = useState("");
  const [description, setDescription] = useState("");

  // Track explicit user edits to SLA so severity-change auto-snap doesn't
  // clobber an intentional value. The previous heuristic (compare to set of
  // default values) collided whenever a user picked a value that happened to
  // match another severity's default (e.g. typed 30 under "low").
  //
  // R11-fix: track which severities have a user-set override instead of
  // a single bool. The previous code reset the bool to false after one
  // severity change — so picking custom for one severity, switching to
  // another, then BACK to the first re-clobbered the custom value.
  // Now: a per-severity Set survives across switches; the override
  // sticks until the user explicitly switches back to the default.
  const slaOverriddenRef = useRef<Set<typeof severity>>(new Set());

  useEffect(() => {
    if (slaOverriddenRef.current.has(severity)) return;
    setSlaDraft(String(SEVERITY_DEFAULT_SLA[severity]));
  }, [severity]);

  const addVuln = () => {
    const sla = Number(slaDraft);
    if (!Number.isFinite(sla) || sla < 1) return;
    const v: Vuln = {
      id: crypto.randomUUID(),
      cve: cve.trim() || undefined,
      severity,
      status: "open",
      openedAt: todayLocalISO(),
      slaTargetDays: Math.round(sla),
      owner: owner.trim() || undefined,
      description: description.trim() || undefined,
    };
    setState((s) => ({ vulns: [v, ...s.vulns] }));
    log(VULN_ACTIONS.VULN_ADDED, {
      vulnId: v.id,
      cve: v.cve,
      severity: v.severity,
      slaTargetDays: v.slaTargetDays,
      owner: v.owner,
      description: v.description,
    });
    setCve("");
    setOwner("");
    setDescription("");
  };

  const update = (id: string, patch: Partial<Vuln>) => {
    setState((s) => ({
      vulns: s.vulns.map((v) => (v.id === id ? { ...v, ...patch } : v)),
    }));
  };

  const setStatus = (id: string, status: Status) => {
    const prev = state.vulns.find((v) => v.id === id);
    // BUG-T9-vuln-burndown-1: PRESERVE the original resolvedAt across
    // non-resolved transitions, mirroring threat-model's preserve-on-
    // transition-out pattern. The prior `undefined` reset wiped the
    // original resolution date when a user clicked Open→Resolved
    // immediately after misclicking Resolved→Open, silently corrupting
    // the burn-down chart (item appeared to just resolve today instead
    // of N days ago).
    const resolvedAt =
      status === "resolved" ? (prev?.resolvedAt ?? todayLocalISO()) : prev?.resolvedAt;
    update(id, { status, resolvedAt });
    if (status === "resolved") {
      const stamp = prev?.resolvedAt ?? todayLocalISO();
      log(VULN_ACTIONS.VULN_RESOLVED, {
        vulnId: id,
        cve: prev?.cve,
        ageDays: prev ? ageDays({ ...prev, status, resolvedAt: stamp }) : undefined,
      });
    } else {
      log(VULN_ACTIONS.VULN_UPDATED, { vulnId: id, fields: ["status"] });
    }
  };

  const remove = (id: string) => {
    const v = state.vulns.find((x) => x.id === id);
    setState((s) => ({ vulns: s.vulns.filter((x) => x.id !== id) }));
    log(VULN_ACTIONS.VULN_REMOVED, { vulnId: id, cve: v?.cve });
  };

  /* ── Aggregations ───────────────────────────────────────────────────── */

  const totalOpen = useMemo(
    () => state.vulns.filter((v) => v.status === "open" || v.status === "in_progress").length,
    [state.vulns]
  );

  const slaBreaches = useMemo(
    () =>
      state.vulns.filter((v) => {
        if (v.status === "resolved" || v.status === "accepted") return false;
        return ageDays(v) > v.slaTargetDays;
      }).length,
    [state.vulns]
  );

  // BUG-T9-vuln-burndown-3: separately count vulns that were ACCEPTED
  // (risk-acknowledged, no fix) but are now ≥2× past their SLA target.
  // Surfacing this prevents accepted vulns from aging silently forever
  // when the original acceptance assumed a much shorter exposure
  // window than what actually transpired.
  const acceptedStale = useMemo(
    () =>
      state.vulns.filter((v) => v.status === "accepted" && ageDays(v) > v.slaTargetDays * 2).length,
    [state.vulns]
  );

  const avgResolveDays = useMemo<number | null>(() => {
    const resolved = state.vulns.filter((v) => v.status === "resolved" && v.resolvedAt);
    if (resolved.length === 0) return null;
    const sum = resolved.reduce((acc, v) => acc + ageDays(v), 0);
    return sum / resolved.length;
  }, [state.vulns]);

  const criticalHigh = useMemo(
    () =>
      state.vulns.filter(
        (v) =>
          (v.severity === "critical" || v.severity === "high") &&
          (v.status === "open" || v.status === "in_progress")
      ).length,
    [state.vulns]
  );

  /* ── Burndown chart data: open vulns over time, by severity ─────────── */

  const chartData = useMemo(() => {
    if (state.vulns.length === 0) return [];
    // Build a sorted list of unique date keys (open-day + resolve-day for each
    // vuln). For each date we count the vulns whose [open, resolve) interval
    // contains it, broken down by severity.
    const dateSet = new Set<string>();
    for (const v of state.vulns) {
      dateSet.add(v.openedAt);
      if (v.resolvedAt) dateSet.add(v.resolvedAt);
    }
    // Always include "today" so the trailing edge of the chart reflects
    // current state even when nothing has changed today.
    dateSet.add(todayLocalISO());
    const dates = Array.from(dateSet).sort();
    return dates.map((d) => {
      const counts: Record<Severity, number> = {
        critical: 0,
        high: 0,
        medium: 0,
        low: 0,
      };
      for (const v of state.vulns) {
        if (v.status === "accepted") continue;
        const opened = v.openedAt <= d;
        // Gate on status, not on the preserved timestamp — a re-opened vuln
        // still carries its old `resolvedAt` and was dropping off the chart.
        const resolved = isResolved(v) && v.resolvedAt ? v.resolvedAt <= d : false;
        if (opened && !resolved) counts[v.severity]++;
      }
      const total = counts.critical + counts.high + counts.medium + counts.low;
      return { date: d, ...counts, total };
    });
  }, [state.vulns]);

  /* ── Phase-15 analytics ───────────────────────────────────────────────── */
  // Total open over time, used as the underlying series for CUSUM and the
  // Mann-Kendall trend chip. We operate on the existing chartData ticks so
  // the markers align 1:1 with the area chart's x-axis.
  const openSeries = useMemo(() => chartData.map((d) => d.total), [chartData]);

  const openChangepoints = useMemo<CausalAnnotationData[]>(() => {
    if (openSeries.length < 4) return [];
    // Drop changepoints whose chartData row is missing — using a synthetic
    // String(cp.index) fallback puts a non-date value on a date axis, which
    // recharts then expands the domain to fit (`ifOverflow="extendDomain"`),
    // distorting the chart.
    return cusum(openSeries)
      .map((cp): CausalAnnotationData | null => {
        const date = chartData[cp.index]?.date;
        if (!date) return null;
        return {
          x: date,
          label: `Open vulns ${cp.direction === "up" ? "↑ regime" : "↓ regime"}`,
          detail: `CUSUM detected a sustained ${cp.direction === "up" ? "increase" : "decrease"} in open vulnerabilities at ${date}.`,
          confidence: cp.cumulativeStat >= 6 ? "strong" : "moderate",
        };
      })
      .filter((a): a is CausalAnnotationData => a !== null);
  }, [openSeries, chartData]);

  const openTrend = useMemo(
    () => (openSeries.length >= 5 ? mannKendall(openSeries) : null),
    [openSeries]
  );

  // Smart-default predictor for the SLA-days-for-critical input. The
  // predictor (when registered) suggests a target based on workspace history;
  // the fallback mirrors the static default for critical so chip appears with
  // confidence "none" silently when no predictor is registered.
  const slaCriticalPrediction = usePredictedDefault<number>(
    "vuln-burndown",
    "slaDaysCritical",
    SEVERITY_DEFAULT_SLA.critical
  );

  const promptConfig = useMemo(
    () => ({
      toolName: "Vulnerability Burn-Down",
      prompts: generateVulnPrompts({
        vulns: state.vulns.map((v) => ({
          cve: v.cve,
          severity: v.severity,
          status: v.status,
          ageDays: ageDays(v),
          slaTargetDays: v.slaTargetDays,
          slaBreached:
            (v.status === "open" || v.status === "in_progress") && ageDays(v) > v.slaTargetDays,
          owner: v.owner,
          description: v.description,
        })),
        totalOpen,
        slaBreaches,
        avgResolveDays,
        criticalHigh,
      }),
    }),
    [state.vulns, totalOpen, slaBreaches, avgResolveDays, criticalHigh]
  );

  return (
    <ToolPageWrapper
      toolId="vuln-burndown"
      title="Vulnerability Burn-Down"
      description="Track open vulnerabilities by severity over time with SLA aging and stacked-area burn-down chart."
      category="Security & Compliance"
    >
      <ActionRow>
        <AiPromptGenerator config={promptConfig} />
        <ExportButton
          filename="vuln-burndown"
          csvData={{
            headers: [
              "CVE",
              "Severity",
              "Status",
              "Opened",
              "Resolved",
              "Age (d)",
              "SLA Target (d)",
              "SLA Breached",
              "Owner",
              "Description",
            ],
            rows: state.vulns.map((v) => [
              v.cve ?? "",
              v.severity,
              v.status,
              v.openedAt,
              v.resolvedAt ?? "",
              ageDays(v),
              v.slaTargetDays,
              (v.status === "open" || v.status === "in_progress") && ageDays(v) > v.slaTargetDays
                ? "YES"
                : "no",
              v.owner ?? "",
              v.description ?? "",
            ]),
          }}
          jsonData={state}
          targetRef={chartRef}
        />
      </ActionRow>

      <KpiGrid cols={4}>
        <StatCard
          variant="compact"
          icon={Bug}
          label="Open"
          value={totalOpen}
          valueClassName="text-accent"
        />
        <StatCard
          variant="compact"
          icon={ShieldOff}
          label="SLA breaches"
          value={slaBreaches}
          tone={slaBreaches > 0 ? "danger" : "default"}
        />
        <StatCard
          variant="compact"
          icon={Clock}
          label="Avg time-to-resolve"
          value={avgResolveDays !== null ? `${avgResolveDays.toFixed(1)}d` : "—"}
        />
        <StatCard
          variant="compact"
          icon={AlertTriangle}
          label="Critical + high open"
          value={criticalHigh}
          tone={criticalHigh > 0 ? "warning" : "default"}
        />
        {/* BUG-T9-vuln-burndown-3: surface accepted-past-SLA so a
            risk acceptance doesn't quietly age past the original
            assumption (2× the SLA target days). */}
        {acceptedStale > 0 && (
          <StatCard
            variant="compact"
            icon={AlertTriangle}
            label="Accepted, past 2× SLA"
            value={acceptedStale}
            tone="warning"
          />
        )}
      </KpiGrid>

      <SectionCard title="Log a vulnerability" icon={Bug} className="mb-6 bg-surface border-border">
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-3">
          <div className="space-y-1">
            <Label className="text-xs text-sub">CVE (optional)</Label>
            <Input
              value={cve}
              onChange={(e) => setCve(e.target.value)}
              placeholder="CVE-2024-12345"
              className="bg-bg border-border font-data"
            />
          </div>
          <div className="space-y-1">
            <Label className="text-xs text-sub">Severity</Label>
            <Select value={severity} onValueChange={(v) => setSeverity(v as Severity)}>
              <SelectTrigger className="bg-bg border-border capitalize">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {SEVERITY_OPTIONS.map((o) => (
                  <SelectItem key={o.value} value={o.value}>
                    {o.label}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
          <div className="space-y-1">
            <Label className="text-xs text-sub">SLA target (days)</Label>
            {severity === "critical" ? (
              <SmartInput<number>
                predicted={slaCriticalPrediction}
                onAccept={(v) => {
                  slaOverriddenRef.current.add(severity);
                  setSlaDraft(String(v));
                }}
                render={({ ghost, chip, accept }) => (
                  <>
                    <Input
                      type="text"
                      inputMode="numeric"
                      value={slaDraft}
                      placeholder={ghost ?? "e.g. 7"}
                      onKeyDown={(e) => {
                        if (e.key === "Tab" && slaDraft === "") {
                          e.preventDefault();
                          accept();
                        }
                      }}
                      onChange={(e) => {
                        slaOverriddenRef.current.add(severity);
                        setSlaDraft(e.target.value);
                      }}
                      onBlur={() => {
                        const n = Number(slaDraft);
                        if (!Number.isFinite(n) || n < 1) {
                          slaOverriddenRef.current.delete(severity);
                          setSlaDraft(String(SEVERITY_DEFAULT_SLA[severity]));
                        } else {
                          setSlaDraft(String(Math.round(n)));
                        }
                      }}
                      className="bg-bg border-border font-data"
                    />
                    {chip}
                  </>
                )}
              />
            ) : (
              <Input
                type="text"
                inputMode="numeric"
                value={slaDraft}
                onChange={(e) => {
                  slaOverriddenRef.current.add(severity);
                  setSlaDraft(e.target.value);
                }}
                onBlur={() => {
                  const n = Number(slaDraft);
                  if (!Number.isFinite(n) || n < 1) {
                    // Reset to severity default and treat as unmodified again.
                    slaOverriddenRef.current.delete(severity);
                    setSlaDraft(String(SEVERITY_DEFAULT_SLA[severity]));
                  } else {
                    setSlaDraft(String(Math.round(n)));
                  }
                }}
                placeholder="e.g. 30"
                className="bg-bg border-border font-data"
              />
            )}
          </div>
          <div className="space-y-1">
            <Label className="text-xs text-sub">Owner (optional)</Label>
            <Input
              value={owner}
              onChange={(e) => setOwner(e.target.value)}
              placeholder="Team or DRI"
              className="bg-bg border-border"
            />
          </div>
          <div className="sm:col-span-2 lg:col-span-3 space-y-1">
            <Label className="text-xs text-sub">Description (optional)</Label>
            <Textarea
              rows={2}
              value={description}
              onChange={(e) => setDescription(e.target.value)}
              placeholder="Affected component, exploit details, observed impact..."
              className="bg-bg border-border text-sm"
            />
          </div>
          <div className="flex items-end">
            <Button onClick={addVuln} className="gap-2 w-full bg-accent text-bg hover:bg-accent/90">
              <Plus className="w-4 h-4" />
              Add vuln
            </Button>
          </div>
        </div>
      </SectionCard>

      {chartData.length > 0 && (
        <ChartCard
          title="Open vulns over time (by severity)"
          icon={Bug}
          height={300}
          chartContainerRef={chartRef}
          className="mb-6"
          headerExtras={
            openTrend?.significant ? (
              <span
                className={`text-[10px] font-mono uppercase tracking-wider px-1.5 py-0.5 rounded border ${
                  // For open vulns, "down" is good (closing them out), "up" is bad.
                  openTrend.trend === "down"
                    ? "border-accent-green/40 text-accent-green bg-accent-green/10"
                    : "border-warning/40 text-warning bg-warning/10"
                }`}
                aria-label={`Open-vuln trend ${openTrend.trend} (Mann-Kendall p=${openTrend.pValue.toFixed(3)})`}
                title={`Mann-Kendall p=${openTrend.pValue.toFixed(3)}`}
              >
                {openTrend.trend === "up" ? "↗ trend" : "↘ trend"}
              </span>
            ) : undefined
          }
        >
          <AreaChart data={chartData} margin={{ top: 10, right: 16, left: 0, bottom: 0 }}>
            <CartesianGrid strokeDasharray="3 3" stroke={chartTheme.gridColor} vertical={false} />
            <XAxis
              dataKey="date"
              tick={{ fill: chartTheme.axisColor, fontSize: 11 }}
              axisLine={{ stroke: chartTheme.gridColor }}
              tickLine={false}
            />
            <YAxis
              tick={{ fill: chartTheme.axisColor, fontSize: 11 }}
              axisLine={false}
              tickLine={false}
              allowDecimals={false}
            />
            <Tooltip contentStyle={chartTheme.tooltipStyle} />
            <Legend wrapperStyle={chartTheme.legendStyle} />
            <Area
              type="monotone"
              dataKey="critical"
              stackId="1"
              stroke={SEVERITY_COLOR.critical}
              fill={SEVERITY_COLOR.critical}
              fillOpacity={0.45}
              name="Critical"
            />
            <Area
              type="monotone"
              dataKey="high"
              stackId="1"
              stroke={SEVERITY_COLOR.high}
              fill={SEVERITY_COLOR.high}
              fillOpacity={0.45}
              name="High"
            />
            <Area
              type="monotone"
              dataKey="medium"
              stackId="1"
              stroke={SEVERITY_COLOR.medium}
              fill={SEVERITY_COLOR.medium}
              fillOpacity={0.45}
              name="Medium"
            />
            <Area
              type="monotone"
              dataKey="low"
              stackId="1"
              stroke={SEVERITY_COLOR.low}
              fill={SEVERITY_COLOR.low}
              fillOpacity={0.45}
              name="Low"
            />
            {openChangepoints.map((cp, i) => (
              <CausalLine key={`cusum-${i}`} annotation={cp} />
            ))}
          </AreaChart>
        </ChartCard>
      )}

      <div className="space-y-2">
        {state.vulns
          .slice()
          .sort((a, b) => {
            // Open + breaching first, then by severity rank.
            const sevRank: Record<Severity, number> = {
              critical: 4,
              high: 3,
              medium: 2,
              low: 1,
            };
            const aBreach =
              (a.status === "open" || a.status === "in_progress") && ageDays(a) > a.slaTargetDays
                ? 1
                : 0;
            const bBreach =
              (b.status === "open" || b.status === "in_progress") && ageDays(b) > b.slaTargetDays
                ? 1
                : 0;
            if (aBreach !== bBreach) return bBreach - aBreach;
            return sevRank[b.severity] - sevRank[a.severity];
          })
          .map((v) => {
            const age = ageDays(v);
            const breaching =
              (v.status === "open" || v.status === "in_progress") && age > v.slaTargetDays;
            return (
              <Card key={v.id} className="bg-surface border-border">
                <CardContent className="p-3 space-y-2">
                  <div className="flex flex-wrap items-center gap-2">
                    <Badge
                      variant="outline"
                      className="font-data uppercase tracking-wider text-[10px]"
                      style={{
                        color: SEVERITY_COLOR[v.severity],
                        borderColor: `${SEVERITY_COLOR[v.severity]}66`,
                      }}
                    >
                      {v.severity}
                    </Badge>
                    {v.cve && <span className="font-data text-xs text-text">{v.cve}</span>}
                    <span
                      className={"font-data text-xs " + (breaching ? "text-danger" : "text-sub")}
                      title={`Age ${age}d / SLA ${v.slaTargetDays}d`}
                    >
                      {age}d / {v.slaTargetDays}d
                    </span>
                    {v.owner && <span className="text-xs text-sub">@{v.owner}</span>}
                    <div className="ml-auto flex items-center gap-2">
                      <Select value={v.status} onValueChange={(s) => setStatus(v.id, s as Status)}>
                        <SelectTrigger
                          className="h-8 w-36 bg-bg border-border text-xs capitalize"
                          aria-label={`Status for ${v.cve ?? "vuln"}`}
                        >
                          <SelectValue />
                        </SelectTrigger>
                        <SelectContent>
                          {STATUS_OPTIONS.map((o) => (
                            <SelectItem key={o.value} value={o.value}>
                              {o.label}
                            </SelectItem>
                          ))}
                        </SelectContent>
                      </Select>
                      <Button
                        variant="ghost"
                        size="sm"
                        onClick={() => remove(v.id)}
                        className="text-sub hover:text-danger min-touch-coarse"
                        aria-label="Remove vuln"
                      >
                        <Trash2 className="w-3.5 h-3.5" />
                      </Button>
                    </div>
                  </div>
                  {v.description && (
                    <div className="text-xs text-sub whitespace-pre-wrap break-words">
                      {v.description}
                    </div>
                  )}
                </CardContent>
              </Card>
            );
          })}
        {state.vulns.length === 0 && (
          <EmptyState icon={Bug}>
            No vulnerabilities tracked. Log one above to start the burn-down.
          </EmptyState>
        )}
      </div>
    </ToolPageWrapper>
  );
}
