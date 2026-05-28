"use client";

import { useMemo, useRef, useState } from "react";
import {
  LineChart,
  Line,
  CartesianGrid,
  XAxis,
  YAxis,
  Tooltip,
  Legend,
  ReferenceLine,
} from "recharts";
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
import { Plus, Trash2, Eye, Clock, Layers } from "lucide-react";
import { chartTheme } from "@/components/charts/chart-theme";
import { CausalLine, type CausalAnnotationData } from "@/components/charts/causal-annotation";
import { xmrLimits } from "@/lib/analytics/control-chart";
import { cusum } from "@/lib/analytics/changepoint";
import { mannKendall } from "@/lib/analytics/trend-test";
import { generateA11yPrompts } from "@/lib/ai-prompts/a11y-tracker";
import { useShallow } from "zustand/react/shallow";
import { useWorkspaceStore } from "@/lib/stores/workspace-store";
import type {
  A11yIssue,
  A11ySeverity as Severity,
  A11yStatus as Status,
} from "@/lib/stores/workspace-types";
import { useHistoryLogger } from "@/lib/history/use-history-logger";
import { A11Y_ACTIONS } from "@/lib/history/event-actions";
import { todayLocalISO } from "@/lib/utils/formatters";

/* ── Types ──────────────────────────────────────────────────────────────── */

interface A11yState {
  issues: A11yIssue[];
}

const DEFAULT_STATE: A11yState = { issues: [] };

const AT_ID = "a11yTracker:current"; // MUST match AT_ID in a11y-tracker.ts.

// Synced workspace singleton (was isolated usePersisted/localStorage), so MCP
// issue writes round-trip into the UI. Drop-in [state, setState].
function useA11yTracker(): [A11yState, (u: A11yState | ((p: A11yState) => A11yState)) => void] {
  const doc = useWorkspaceStore(
    useShallow((s) => (s.a11yTrackers ?? []).find((d) => d.id === AT_ID))
  );
  const upsert = useWorkspaceStore((s) => s.upsertA11yTracker);
  const state: A11yState = doc ? { issues: doc.issues } : DEFAULT_STATE;
  const setState = (u: A11yState | ((p: A11yState) => A11yState)) => {
    const cur = (useWorkspaceStore.getState().a11yTrackers ?? []).find((d) => d.id === AT_ID);
    const curState: A11yState = cur ? { issues: cur.issues } : DEFAULT_STATE;
    const next = typeof u === "function" ? u(curState) : u;
    upsert({ id: AT_ID, issues: next.issues });
  };
  return [state, setState];
}

const SEVERITY_OPTIONS: { value: Severity; label: string }[] = [
  { value: "critical", label: "Critical" },
  { value: "serious", label: "Serious" },
  { value: "moderate", label: "Moderate" },
  { value: "minor", label: "Minor" },
];

const SEVERITY_COLOR: Record<Severity, string> = {
  critical: "#ef4444",
  serious: "#f59e0b",
  moderate: "#facc15",
  minor: "#34d399",
};

const SEVERITY_RANK: Record<Severity, number> = {
  critical: 4,
  serious: 3,
  moderate: 2,
  minor: 1,
};

const STATUS_OPTIONS: { value: Status; label: string }[] = [
  { value: "open", label: "Open" },
  { value: "in_progress", label: "In Progress" },
  { value: "resolved", label: "Resolved" },
];

/* ── Helpers ────────────────────────────────────────────────────────────── */

function dayDiff(fromIso: string, toIso?: string): number {
  const m1 = /^(\d{4})-(\d{2})-(\d{2})/.exec(fromIso);
  let from: number;
  if (m1) {
    from = new Date(Number(m1[1]), Number(m1[2]) - 1, Number(m1[3])).getTime();
  } else {
    from = Date.parse(fromIso);
    if (Number.isNaN(from)) return 0;
  }
  let to: number;
  if (toIso) {
    const m2 = /^(\d{4})-(\d{2})-(\d{2})/.exec(toIso);
    if (m2) {
      to = new Date(Number(m2[1]), Number(m2[2]) - 1, Number(m2[3])).getTime();
    } else {
      to = Date.parse(toIso);
      if (Number.isNaN(to)) return 0;
    }
  } else {
    const now = new Date();
    to = new Date(now.getFullYear(), now.getMonth(), now.getDate()).getTime();
  }
  if (!Number.isFinite(from) || !Number.isFinite(to)) return 0;
  return Math.max(0, Math.round((to - from) / (1000 * 60 * 60 * 24)));
}

function ageDays(i: A11yIssue): number {
  return dayDiff(i.openedAt, i.resolvedAt);
}

/* ── Main client ────────────────────────────────────────────────────────── */

export function A11yTrackerClient() {
  const [state, setState] = useA11yTracker();
  const { log } = useHistoryLogger("a11y-tracker");
  const chartRef = useRef<HTMLDivElement>(null);

  // Add-form draft state.
  const [component, setComponent] = useState("");
  const [wcagCriterion, setWcagCriterion] = useState("");
  const [severity, setSeverity] = useState<Severity>("serious");
  const [description, setDescription] = useState("");

  const addIssue = () => {
    if (!component.trim() || !wcagCriterion.trim()) return;
    const issue: A11yIssue = {
      id: crypto.randomUUID(),
      component: component.trim(),
      wcagCriterion: wcagCriterion.trim(),
      severity,
      status: "open",
      openedAt: todayLocalISO(),
      description: description.trim() || undefined,
    };
    setState((s) => ({ issues: [issue, ...s.issues] }));
    log(A11Y_ACTIONS.ISSUE_ADDED, {
      issueId: issue.id,
      component: issue.component,
      wcagCriterion: issue.wcagCriterion,
      severity: issue.severity,
      description: issue.description,
    });
    setComponent("");
    setWcagCriterion("");
    setDescription("");
    setSeverity("serious");
  };

  const setStatus = (id: string, status: Status) => {
    const prev = state.issues.find((i) => i.id === id);
    setState((s) => ({
      issues: s.issues.map((i) =>
        i.id === id
          ? {
              ...i,
              status,
              resolvedAt: status === "resolved" ? (i.resolvedAt ?? todayLocalISO()) : undefined,
            }
          : i
      ),
    }));
    if (status === "resolved") {
      log(A11Y_ACTIONS.ISSUE_RESOLVED, {
        issueId: id,
        component: prev?.component,
        wcagCriterion: prev?.wcagCriterion,
        ageDays: prev ? ageDays({ ...prev, status, resolvedAt: todayLocalISO() }) : undefined,
      });
    } else {
      log(A11Y_ACTIONS.ISSUE_UPDATED, { issueId: id, fields: ["status"] });
    }
  };

  const remove = (id: string) => {
    const i = state.issues.find((x) => x.id === id);
    setState((s) => ({ issues: s.issues.filter((x) => x.id !== id) }));
    log(A11Y_ACTIONS.ISSUE_REMOVED, {
      issueId: id,
      component: i?.component,
      wcagCriterion: i?.wcagCriterion,
    });
  };

  /* ── Aggregations ───────────────────────────────────────────────────── */

  const totalOpen = useMemo(
    () => state.issues.filter((i) => i.status !== "resolved").length,
    [state.issues]
  );

  const bySeverity = useMemo(() => {
    const counts: Record<Severity, number> = {
      critical: 0,
      serious: 0,
      moderate: 0,
      minor: 0,
    };
    for (const i of state.issues) {
      if (i.status === "resolved") continue;
      counts[i.severity]++;
    }
    return counts;
  }, [state.issues]);

  const componentsAffected = useMemo(
    () => new Set(state.issues.filter((i) => i.status !== "resolved").map((i) => i.component)).size,
    [state.issues]
  );

  const avgAge = useMemo(() => {
    const open = state.issues.filter((i) => i.status !== "resolved");
    if (open.length === 0) return 0;
    return open.reduce((acc, i) => acc + ageDays(i), 0) / open.length;
  }, [state.issues]);

  // Per-component coverage table (group by component, list issue count + worst severity).
  const componentRollup = useMemo(() => {
    const map = new Map<string, { count: number; worst: Severity }>();
    for (const i of state.issues) {
      if (i.status === "resolved") continue;
      const cur = map.get(i.component);
      if (!cur) {
        map.set(i.component, { count: 1, worst: i.severity });
      } else {
        cur.count++;
        if (SEVERITY_RANK[i.severity] > SEVERITY_RANK[cur.worst]) {
          cur.worst = i.severity;
        }
      }
    }
    return Array.from(map.entries())
      .map(([component, v]) => ({ component, ...v }))
      .sort((a, b) => {
        const r = SEVERITY_RANK[b.worst] - SEVERITY_RANK[a.worst];
        if (r !== 0) return r;
        return b.count - a.count;
      });
  }, [state.issues]);

  // Open issues over time, by severity (line chart).
  const chartData = useMemo(() => {
    if (state.issues.length === 0) return [];
    const dateSet = new Set<string>();
    for (const i of state.issues) {
      dateSet.add(i.openedAt);
      if (i.resolvedAt) dateSet.add(i.resolvedAt);
    }
    dateSet.add(todayLocalISO());
    let dates = Array.from(dateSet).sort();
    // Empty-state buffer: if only one tick, prepend "today minus 7 days" so
    // the line chart isn't a single dot.
    if (dates.length < 2) {
      const now = new Date();
      const seven = new Date(now.getFullYear(), now.getMonth(), now.getDate() - 7);
      dates = [todayLocalISO(seven), ...dates];
    }
    return dates.map((d) => {
      const counts: Record<Severity, number> = {
        critical: 0,
        serious: 0,
        moderate: 0,
        minor: 0,
      };
      for (const i of state.issues) {
        const opened = i.openedAt <= d;
        const resolved = i.resolvedAt ? i.resolvedAt <= d : false;
        if (opened && !resolved) counts[i.severity]++;
      }
      const total = counts.critical + counts.serious + counts.moderate + counts.minor;
      return { date: d, ...counts, total };
    });
  }, [state.issues]);

  /* ── Phase-15 analytics: per-week open-issue count series ─────────────── */
  // Bucket the snapshot series by ISO week (YYYY-Www). Each bucket holds
  // the latest snapshot's total for that week, so XmR / CUSUM / Mann-Kendall
  // operate on a single observation per period (the canonical XmR setup).
  const weeklyOpen = useMemo(() => {
    if (chartData.length === 0) return [] as { weekKey: string; date: string; total: number }[];
    const map = new Map<string, { date: string; total: number }>();
    for (const row of chartData) {
      const m = /^(\d{4})-(\d{2})-(\d{2})/.exec(row.date);
      if (!m) continue;
      const d = new Date(Date.UTC(Number(m[1]), Number(m[2]) - 1, Number(m[3])));
      d.setUTCDate(d.getUTCDate() + 4 - (d.getUTCDay() || 7));
      const yearStart = new Date(Date.UTC(d.getUTCFullYear(), 0, 1));
      const week = Math.ceil(((d.getTime() - yearStart.getTime()) / 86400000 + 1) / 7);
      const key = `${d.getUTCFullYear()}-W${String(week).padStart(2, "0")}`;
      // Latest snapshot in week wins (chartData is already date-sorted).
      map.set(key, { date: row.date, total: row.total });
    }
    return Array.from(map.entries())
      .sort(([a], [b]) => a.localeCompare(b))
      .map(([weekKey, v]) => ({ weekKey, ...v }));
  }, [chartData]);

  const weeklyTotals = useMemo(() => weeklyOpen.map((w) => w.total), [weeklyOpen]);

  // XmR control limits on the weekly open-issue series.
  const openControl = useMemo(
    // Open-issue counts cannot be negative; clamp LCL at 0.
    () => (weeklyTotals.length >= 4 ? xmrLimits(weeklyTotals, true) : null),
    [weeklyTotals]
  );

  // CUSUM regime-shift markers for the open-issue total.
  const openChangepoints = useMemo<CausalAnnotationData[]>(() => {
    if (weeklyTotals.length < 4) return [];
    return cusum(weeklyTotals).map((cp) => ({
      x: weeklyOpen[cp.index]?.date ?? String(cp.index),
      label: `Open issues ${cp.direction === "up" ? "↑ regime" : "↓ regime"}`,
      detail: `CUSUM detected a sustained ${cp.direction === "up" ? "increase" : "decrease"} in open a11y issues at week ${weeklyOpen[cp.index]?.weekKey}.`,
      confidence: cp.cumulativeStat >= 6 ? "strong" : "moderate",
    }));
  }, [weeklyTotals, weeklyOpen]);

  // Mann-Kendall trend chip on the weekly series.
  const openTrend = useMemo(
    () => (weeklyTotals.length >= 5 ? mannKendall(weeklyTotals) : null),
    [weeklyTotals]
  );

  const promptConfig = useMemo(
    () => ({
      toolName: "Accessibility Audit Tracker",
      prompts: generateA11yPrompts({
        issues: state.issues.map((i) => ({
          component: i.component,
          wcagCriterion: i.wcagCriterion,
          severity: i.severity,
          status: i.status,
          ageDays: ageDays(i),
          description: i.description,
        })),
        totalOpen,
        bySeverity: { ...bySeverity },
        componentsAffected,
        avgAge,
      }),
    }),
    [state.issues, totalOpen, bySeverity, componentsAffected, avgAge]
  );

  return (
    <ToolPageWrapper
      toolId="a11y-tracker"
      title="Accessibility Audit Tracker"
      description="Log WCAG issues by severity, track per-component coverage, and watch the burn-down line chart over time."
      category="Security & Compliance"
    >
      <ActionRow>
        <AiPromptGenerator config={promptConfig} />
        <ExportButton
          filename="a11y-tracker"
          csvData={{
            headers: [
              "Component",
              "WCAG Criterion",
              "Severity",
              "Status",
              "Opened",
              "Resolved",
              "Age (d)",
              "Description",
            ],
            rows: state.issues.map((i) => [
              i.component,
              i.wcagCriterion,
              i.severity,
              i.status,
              i.openedAt,
              i.resolvedAt ?? "",
              ageDays(i),
              i.description ?? "",
            ]),
          }}
          jsonData={state}
          targetRef={chartRef}
        />
      </ActionRow>

      <KpiGrid cols={4}>
        <StatCard
          variant="compact"
          icon={Eye}
          label="Open issues"
          value={totalOpen}
          valueClassName="text-accent"
        />
        <StatCard
          variant="compact"
          label="Critical / Serious"
          value={bySeverity.critical + bySeverity.serious}
          tone={bySeverity.critical + bySeverity.serious > 0 ? "danger" : "default"}
        />
        <StatCard variant="compact" icon={Clock} label="Avg age" value={`${avgAge.toFixed(1)}d`} />
        <StatCard
          variant="compact"
          icon={Layers}
          label="Components affected"
          value={componentsAffected}
        />
      </KpiGrid>

      <SectionCard title="Log a11y issue" icon={Eye} className="mb-6 bg-surface border-border">
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-3">
          <div className="space-y-1">
            <Label className="text-xs text-sub">Component</Label>
            <Input
              value={component}
              onChange={(e) => setComponent(e.target.value)}
              placeholder="Header, ProductCard, Modal..."
              className="bg-bg border-border"
            />
          </div>
          <div className="space-y-1">
            <Label className="text-xs text-sub">WCAG criterion</Label>
            <Input
              value={wcagCriterion}
              onChange={(e) => setWcagCriterion(e.target.value)}
              placeholder="1.4.3, 2.1.1..."
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
          <div className="flex items-end">
            <Button
              onClick={addIssue}
              disabled={!component.trim() || !wcagCriterion.trim()}
              className="gap-2 w-full bg-accent text-bg hover:bg-accent/90 disabled:opacity-40"
            >
              <Plus className="w-4 h-4" />
              Add issue
            </Button>
          </div>
          <div className="sm:col-span-2 lg:col-span-4 space-y-1">
            <Label className="text-xs text-sub">Description (optional)</Label>
            <Textarea
              rows={2}
              value={description}
              onChange={(e) => setDescription(e.target.value)}
              placeholder="What fails, who's affected, repro steps..."
              className="bg-bg border-border text-sm"
            />
          </div>
        </div>
      </SectionCard>

      {chartData.length > 0 && (
        <ChartCard
          title="Open issues over time (by severity)"
          icon={Eye}
          height={280}
          chartContainerRef={chartRef}
          className="mb-6"
          headerExtras={
            openTrend?.significant ? (
              <span
                className={`text-[10px] font-mono uppercase tracking-wider px-1.5 py-0.5 rounded border ${
                  // For open-issue count, "down" trend is good (fewer open), "up" is bad.
                  openTrend.trend === "down"
                    ? "border-[#00ff88]/40 text-[#00ff88] bg-[#00ff88]/10"
                    : "border-amber-400/40 text-amber-400 bg-amber-400/10"
                }`}
                aria-label={`Weekly open-issue trend ${openTrend.trend} (Mann-Kendall p=${openTrend.pValue.toFixed(3)})`}
                title={`Mann-Kendall p=${openTrend.pValue.toFixed(3)}`}
              >
                {openTrend.trend === "up" ? "↗ trend" : "↘ trend"}
              </span>
            ) : undefined
          }
        >
          <LineChart data={chartData} margin={{ top: 10, right: 16, left: 0, bottom: 0 }}>
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
            <Line
              type="monotone"
              dataKey="critical"
              stroke={SEVERITY_COLOR.critical}
              strokeWidth={2}
              dot={false}
              name="Critical"
            />
            <Line
              type="monotone"
              dataKey="serious"
              stroke={SEVERITY_COLOR.serious}
              strokeWidth={2}
              dot={false}
              name="Serious"
            />
            <Line
              type="monotone"
              dataKey="moderate"
              stroke={SEVERITY_COLOR.moderate}
              strokeWidth={2}
              dot={false}
              name="Moderate"
            />
            <Line
              type="monotone"
              dataKey="minor"
              stroke={SEVERITY_COLOR.minor}
              strokeWidth={2}
              dot={false}
              name="Minor"
            />
            <Line
              type="monotone"
              dataKey="total"
              stroke={chartTheme.colors.cyan}
              strokeWidth={1.5}
              strokeOpacity={0.55}
              dot={false}
              name="Total open"
            />
            {openControl && (
              <>
                <ReferenceLine
                  y={openControl.centerLine}
                  stroke={chartTheme.colors.cyan}
                  strokeDasharray="2 4"
                  strokeOpacity={0.55}
                  label={{
                    value: "X̄",
                    fill: chartTheme.colors.cyan,
                    fontSize: 10,
                    position: "right",
                  }}
                  ifOverflow="extendDomain"
                />
                <ReferenceLine
                  y={openControl.ucl}
                  stroke={chartTheme.colors.red}
                  strokeDasharray="2 4"
                  strokeOpacity={0.55}
                  label={{
                    value: "UCL",
                    fill: chartTheme.colors.red,
                    fontSize: 10,
                    position: "right",
                  }}
                  ifOverflow="extendDomain"
                />
                <ReferenceLine
                  y={openControl.lcl}
                  stroke={chartTheme.colors.green}
                  strokeDasharray="2 4"
                  strokeOpacity={0.55}
                  label={{
                    value: "LCL",
                    fill: chartTheme.colors.green,
                    fontSize: 10,
                    position: "right",
                  }}
                  ifOverflow="extendDomain"
                />
              </>
            )}
            {openChangepoints.map((cp, i) => (
              <CausalLine key={`cusum-${i}`} annotation={cp} />
            ))}
          </LineChart>
        </ChartCard>
      )}

      {componentRollup.length > 0 && (
        <SectionCard
          title="Per-component coverage"
          icon={Layers}
          className="mb-6 bg-surface border-border"
        >
          <ul className="divide-y divide-border">
            {componentRollup.map((c) => (
              <li key={c.component} className="flex items-center justify-between py-2 text-xs">
                <span className="text-text font-medium truncate">{c.component}</span>
                <span className="flex items-center gap-2 shrink-0">
                  <span className="font-data text-sub">{c.count} open</span>
                  <Badge
                    variant="outline"
                    className="font-data text-[10px] capitalize"
                    style={{
                      color: SEVERITY_COLOR[c.worst],
                      borderColor: `${SEVERITY_COLOR[c.worst]}66`,
                    }}
                  >
                    worst: {c.worst}
                  </Badge>
                </span>
              </li>
            ))}
          </ul>
        </SectionCard>
      )}

      <div className="space-y-2">
        {state.issues
          .slice()
          .sort((a, b) => {
            // Open + worst severity first.
            const aOpen = a.status === "resolved" ? 0 : 1;
            const bOpen = b.status === "resolved" ? 0 : 1;
            if (aOpen !== bOpen) return bOpen - aOpen;
            return SEVERITY_RANK[b.severity] - SEVERITY_RANK[a.severity];
          })
          .map((i) => (
            <Card key={i.id} className="bg-surface border-border">
              <CardContent className="p-3 space-y-2">
                <div className="flex flex-wrap items-center gap-2">
                  <Badge
                    variant="outline"
                    className="font-data uppercase tracking-wider text-[10px]"
                    style={{
                      color: SEVERITY_COLOR[i.severity],
                      borderColor: `${SEVERITY_COLOR[i.severity]}66`,
                    }}
                  >
                    {i.severity}
                  </Badge>
                  <span className="font-data text-xs text-text">WCAG {i.wcagCriterion}</span>
                  <span className="text-text font-medium text-sm flex-1 min-w-0 truncate">
                    {i.component}
                  </span>
                  <span className="text-xs text-sub font-data">{ageDays(i)}d</span>
                  <Select value={i.status} onValueChange={(v) => setStatus(i.id, v as Status)}>
                    <SelectTrigger
                      className="h-8 w-32 bg-bg border-border text-xs capitalize"
                      aria-label={`Status for ${i.component}`}
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
                    onClick={() => remove(i.id)}
                    className="text-sub hover:text-danger min-touch-coarse"
                    aria-label="Remove issue"
                  >
                    <Trash2 className="w-3.5 h-3.5" />
                  </Button>
                </div>
                {i.description && (
                  <div className="text-xs text-sub whitespace-pre-wrap break-words">
                    {i.description}
                  </div>
                )}
              </CardContent>
            </Card>
          ))}
        {state.issues.length === 0 && (
          <EmptyState icon={Eye}>
            No accessibility issues logged. Add a component + WCAG criterion above to start tracking
            remediation.
          </EmptyState>
        )}
      </div>
    </ToolPageWrapper>
  );
}
