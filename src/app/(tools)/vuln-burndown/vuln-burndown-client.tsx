"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import {
  AreaChart,
  Area,
  CartesianGrid,
  XAxis,
  YAxis,
  Tooltip,
  Legend,
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
import { Plus, Trash2, Bug, AlertTriangle, Clock, ShieldOff } from "lucide-react";
import { chartTheme } from "@/components/charts/chart-theme";
import { generateVulnPrompts } from "@/lib/ai-prompts/vuln-burndown";
import { usePersisted } from "@/lib/utils/use-persisted";
import { useHistoryLogger } from "@/lib/history/use-history-logger";
import { VULN_ACTIONS } from "@/lib/history/event-actions";
import { todayLocalISO } from "@/lib/utils/formatters";

/* ── Types ──────────────────────────────────────────────────────────────── */

type Severity = "critical" | "high" | "medium" | "low";
type Status = "open" | "in_progress" | "resolved" | "accepted";

interface Vuln {
  id: string;
  cve?: string;
  severity: Severity;
  status: Status;
  openedAt: string; // YYYY-MM-DD
  resolvedAt?: string;
  slaTargetDays: number;
  owner?: string;
  description?: string;
}

interface VulnState {
  vulns: Vuln[];
}

const DEFAULT_STATE: VulnState = { vulns: [] };

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
  const from = new Date(
    Number(m1[1]),
    Number(m1[2]) - 1,
    Number(m1[3])
  ).getTime();
  let to: number;
  if (toIso) {
    const m2 = /^(\d{4})-(\d{2})-(\d{2})/.exec(toIso);
    if (!m2) return 0;
    to = new Date(
      Number(m2[1]),
      Number(m2[2]) - 1,
      Number(m2[3])
    ).getTime();
  } else {
    const now = new Date();
    to = new Date(now.getFullYear(), now.getMonth(), now.getDate()).getTime();
  }
  if (!Number.isFinite(from) || !Number.isFinite(to)) return 0;
  return Math.max(0, Math.round((to - from) / (1000 * 60 * 60 * 24)));
}

function ageDays(v: Vuln): number {
  return dayDiff(v.openedAt, v.resolvedAt);
}

/* ── Main client ────────────────────────────────────────────────────────── */

export function VulnBurndownClient() {
  const [state, setState] = usePersisted<VulnState>(
    "agile-toolkit:vuln-burndown",
    DEFAULT_STATE
  );
  const { log } = useHistoryLogger("vuln-burndown");
  const chartRef = useRef<HTMLDivElement>(null);

  // Add-form draft state (string-draft for numeric SLA).
  const [cve, setCve] = useState("");
  const [severity, setSeverity] = useState<Severity>("high");
  const [slaDraft, setSlaDraft] = useState<string>(
    String(SEVERITY_DEFAULT_SLA.high)
  );
  const [owner, setOwner] = useState("");
  const [description, setDescription] = useState("");

  // When severity changes, default SLA target — but never overwrite a user
  // edit. We snap to default whenever the previous value matched the default.
  useEffect(() => {
    setSlaDraft((d) => {
      const n = Number(d);
      const wasDefault = Object.values(SEVERITY_DEFAULT_SLA).includes(n);
      if (!d || wasDefault) return String(SEVERITY_DEFAULT_SLA[severity]);
      return d;
    });
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
    update(id, {
      status,
      resolvedAt:
        status === "resolved"
          ? prev?.resolvedAt ?? todayLocalISO()
          : status === "accepted"
            ? prev?.resolvedAt
            : undefined,
    });
    if (status === "resolved") {
      log(VULN_ACTIONS.VULN_RESOLVED, {
        vulnId: id,
        cve: prev?.cve,
        ageDays: prev ? ageDays({ ...prev, status, resolvedAt: todayLocalISO() }) : undefined,
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
    () =>
      state.vulns.filter(
        (v) => v.status === "open" || v.status === "in_progress"
      ).length,
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

  const avgResolveDays = useMemo<number | null>(() => {
    const resolved = state.vulns.filter(
      (v) => v.status === "resolved" && v.resolvedAt
    );
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
        const resolved = v.resolvedAt ? v.resolvedAt <= d : false;
        if (opened && !resolved) counts[v.severity]++;
      }
      return { date: d, ...counts };
    });
  }, [state.vulns]);

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
            (v.status === "open" || v.status === "in_progress") &&
            ageDays(v) > v.slaTargetDays,
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
              (v.status === "open" || v.status === "in_progress") &&
              ageDays(v) > v.slaTargetDays
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
            <Input
              type="text"
              inputMode="numeric"
              value={slaDraft}
              onChange={(e) => setSlaDraft(e.target.value)}
              onBlur={() => {
                const n = Number(slaDraft);
                if (!Number.isFinite(n) || n < 1) {
                  setSlaDraft(String(SEVERITY_DEFAULT_SLA[severity]));
                } else {
                  setSlaDraft(String(Math.round(n)));
                }
              }}
              placeholder="e.g. 30"
              className="bg-bg border-border font-data"
            />
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
            <Button
              onClick={addVuln}
              className="gap-2 w-full bg-accent text-bg hover:bg-accent/90"
            >
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
              (a.status === "open" || a.status === "in_progress") &&
              ageDays(a) > a.slaTargetDays
                ? 1
                : 0;
            const bBreach =
              (b.status === "open" || b.status === "in_progress") &&
              ageDays(b) > b.slaTargetDays
                ? 1
                : 0;
            if (aBreach !== bBreach) return bBreach - aBreach;
            return sevRank[b.severity] - sevRank[a.severity];
          })
          .map((v) => {
            const age = ageDays(v);
            const breaching =
              (v.status === "open" || v.status === "in_progress") &&
              age > v.slaTargetDays;
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
                    {v.cve && (
                      <span className="font-data text-xs text-text">{v.cve}</span>
                    )}
                    <span
                      className={
                        "font-data text-xs " +
                        (breaching ? "text-danger" : "text-sub")
                      }
                      title={`Age ${age}d / SLA ${v.slaTargetDays}d`}
                    >
                      {age}d / {v.slaTargetDays}d
                    </span>
                    {v.owner && (
                      <span className="text-xs text-sub">@{v.owner}</span>
                    )}
                    <div className="ml-auto flex items-center gap-2">
                      <Select
                        value={v.status}
                        onValueChange={(s) => setStatus(v.id, s as Status)}
                      >
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
                        className="text-sub hover:text-danger"
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
