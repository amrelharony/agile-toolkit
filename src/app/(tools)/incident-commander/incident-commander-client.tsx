"use client";

import { useEffect, useMemo, useState } from "react";
import { ToolPageWrapper } from "@/components/layout/tool-page-wrapper";
import { ExportButton } from "@/components/shared/export-button";
import { AiPromptGenerator } from "@/components/shared/ai-prompt-generator";
import { ActionRow } from "@/components/shared/action-row";
import { KpiGrid } from "@/components/shared/kpi-grid";
import { StatCard } from "@/components/shared/stat-card";
import { SectionCard } from "@/components/shared/section-card";
import { EmptyState } from "@/components/shared/empty-state";
import { Button } from "@/components/ui/button";
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
import {
  Plus,
  Trash2,
  Siren,
  Activity,
  Clock,
  CheckCircle2,
  ShieldAlert,
  TrendingUp,
} from "lucide-react";
import {
  ResponsiveContainer,
  LineChart,
  Line,
  CartesianGrid,
  XAxis,
  YAxis,
  Tooltip,
} from "recharts";
import { useHistoryLogger } from "@/lib/history/use-history-logger";
import { INCIDENT_ACTIONS } from "@/lib/history/event-actions";
import { generateIncidentCommanderPrompts } from "@/lib/ai-prompts/incident-commander";
import { chartTheme } from "@/components/charts/chart-theme";
import { kaplanMeier, medianSurvivalTime } from "@/lib/analytics/survival";
import { bootstrapQuantile } from "@/lib/analytics/bootstrap";
import { mannKendall } from "@/lib/analytics/trend-test";
import type { Incident, IncidentStatus, Severity, TimelineEntry } from "./types";
import {
  SEVERITY_BADGE_CLASS,
  SEVERITY_LABEL,
  SEVERITY_MATRIX,
  STATUS_BADGE_CLASS,
} from "./constants";
import { mttrHours, nowIso } from "./helpers";
import { useIncidentCommander } from "./use-incident-commander";
import { ActiveIncidentCard } from "./components/active-incident-card";

interface IncidentDraft {
  title: string;
  severity: Severity;
  commander: string;
  scribe: string;
  description: string;
}

function emptyDraft(): IncidentDraft {
  return {
    title: "",
    severity: "sev3",
    commander: "",
    scribe: "",
    description: "",
  };
}

export function IncidentCommanderClient() {
  const [state, setState] = useIncidentCommander();
  const { log } = useHistoryLogger("incident-commander");
  const [draft, setDraft] = useState<IncidentDraft>(emptyDraft);
  const [now, setNow] = useState<number>(() => Date.now());

  // Live MTTR ticker for active incidents — updates every 10s.
  useEffect(() => {
    const id = setInterval(() => setNow(Date.now()), 10_000);
    return () => clearInterval(id);
  }, []);

  const addIncident = () => {
    // Bound user-controlled strings before persisting. Incident commander
    // boards run live; a runaway paste could trash multi-week incident
    // history if localStorage's 5 MB quota is exceeded.
    const title = draft.title.trim().slice(0, 240);
    if (!title) return;
    const incident: Incident = {
      id: crypto.randomUUID(),
      title,
      severity: draft.severity,
      status: "active",
      openedAt: nowIso(),
      commander: draft.commander.trim().slice(0, 120) || undefined,
      scribe: draft.scribe.trim().slice(0, 120) || undefined,
      description: draft.description.trim().slice(0, 4000) || undefined,
      timeline: [],
    };
    setState((s) => ({ incidents: [incident, ...s.incidents] }));
    log(INCIDENT_ACTIONS.INCIDENT_OPENED, {
      incidentId: incident.id,
      title: incident.title,
      severity: incident.severity,
      commander: incident.commander,
      scribe: incident.scribe,
      description: incident.description,
    });
    setDraft(emptyDraft());
  };

  const markStatus = (id: string, status: IncidentStatus) => {
    setState((s) => ({
      incidents: s.incidents.map((i) => {
        if (i.id !== id) return i;
        const patch: Partial<Incident> = { status };
        if (status === "resolved" && !i.resolvedAt) patch.resolvedAt = nowIso();
        return { ...i, ...patch };
      }),
    }));
    if (status === "resolved") {
      log(INCIDENT_ACTIONS.INCIDENT_RESOLVED, { incidentId: id });
    } else {
      log(INCIDENT_ACTIONS.INCIDENT_UPDATED, { incidentId: id, status });
    }
  };

  const removeIncident = (id: string) => {
    const inc = state.incidents.find((i) => i.id === id);
    setState((s) => ({ incidents: s.incidents.filter((i) => i.id !== id) }));
    log(INCIDENT_ACTIONS.INCIDENT_RESET, {
      incidentId: id,
      title: inc?.title,
    });
  };

  const assignRole = (id: string, role: "commander" | "scribe", value: string) => {
    const trimmed = value.trim();
    setState((s) => ({
      incidents: s.incidents.map((i) => (i.id === id ? { ...i, [role]: trimmed || undefined } : i)),
    }));
    log(INCIDENT_ACTIONS.ROLE_ASSIGNED, {
      incidentId: id,
      role,
      value: trimmed || null,
    });
  };

  const addTimelineEntry = (id: string, author: string, text: string) => {
    // Cap each timeline entry — long incidents can accumulate hundreds, and
    // a paste-bomb in one entry would otherwise pin the timeline scroll
    // view and dominate the export.
    const trimmedText = text.trim().slice(0, 2000);
    if (!trimmedText) return;
    const entry: TimelineEntry = {
      id: crypto.randomUUID(),
      ts: nowIso(),
      author: author.trim().slice(0, 80) || "anonymous",
      text: trimmedText,
    };
    setState((s) => ({
      incidents: s.incidents.map((i) =>
        i.id === id ? { ...i, timeline: [...i.timeline, entry] } : i
      ),
    }));
    log(INCIDENT_ACTIONS.TIMELINE_LOGGED, {
      incidentId: id,
      entryId: entry.id,
      author: entry.author,
    });
  };

  const active = useMemo(
    () => state.incidents.filter((i) => i.status !== "resolved"),
    [state.incidents]
  );
  const recent = useMemo(
    () =>
      [...state.incidents]
        .sort((a, b) => new Date(b.openedAt).getTime() - new Date(a.openedAt).getTime())
        .slice(0, 10),
    [state.incidents]
  );

  // Bucket `now` to the hour so avgMttr/bySeverity recompute only when the
  // hour rolls over, not every 10s tick (which would invalidate downstream
  // memos like promptConfig on every interval fire).
  const nowHourBucket = Math.floor(now / 3600000);

  // Avg MTTR over the last 7 days of resolved incidents.
  const avgMttrHours = useMemo(() => {
    const cutoff = nowHourBucket * 3600000 - 7 * 24 * 60 * 60 * 1000;
    const samples = state.incidents
      .filter((i) => i.resolvedAt)
      .filter((i) => new Date(i.resolvedAt!).getTime() >= cutoff)
      .map(mttrHours)
      .filter((v): v is number => v !== null);
    if (samples.length === 0) return null;
    return samples.reduce((a, b) => a + b, 0) / samples.length;
  }, [state.incidents, nowHourBucket]);

  // Severity counts over the last 30 days.
  const bySeverity = useMemo<Record<Severity, number>>(() => {
    const cutoff = nowHourBucket * 3600000 - 30 * 24 * 60 * 60 * 1000;
    const counts: Record<Severity, number> = {
      sev1: 0,
      sev2: 0,
      sev3: 0,
      sev4: 0,
    };
    for (const i of state.incidents) {
      if (new Date(i.openedAt).getTime() >= cutoff) counts[i.severity] += 1;
    }
    return counts;
  }, [state.incidents, nowHourBucket]);

  // ── Tier-2: KM survival on MTTR (minutes) + bootstrap CI on median ──
  // We treat each resolved incident as an event observation and report MTTR
  // in minutes (industry-typical for incident KPIs).
  const mttrMinutesResolved = useMemo(() => {
    return state.incidents
      .filter((i) => i.resolvedAt)
      .map((i) => {
        const ms = new Date(i.resolvedAt!).getTime() - new Date(i.openedAt).getTime();
        return Math.max(0, Math.round(ms / 60000));
      })
      .filter((m) => Number.isFinite(m));
  }, [state.incidents]);

  // BUG-T4-incident-commander-1: the prior implementation included
  // active (right-censored) incidents bucketed at hour resolution.
  // When the hour rolled over, every active incident's duration
  // jumped by 60 minutes simultaneously, redistributing the KM
  // curve discontinuously even with no new resolutions. Fix: only
  // include RESOLVED incidents (true events with known end times) —
  // the KM curve is therefore a Kaplan-Meier estimator without right-
  // censoring, equivalent to the empirical CDF of resolution times.
  // Statistically less rich but visually stable across the hour
  // boundary, which matches what the user expects from a "median
  // MTTR" panel.
  const survivalCurve = useMemo(() => {
    if (mttrMinutesResolved.length < 4) return [];
    const obs = state.incidents
      .filter((i) => i.resolvedAt)
      .map((i) => {
        const start = new Date(i.openedAt).getTime();
        const end = new Date(i.resolvedAt!).getTime();
        const duration = Math.max(0, Math.round((end - start) / 60000));
        return { duration, event: true };
      });
    return kaplanMeier(obs.filter((o) => Number.isFinite(o.duration)));
  }, [state.incidents, mttrMinutesResolved.length]);

  const survivalChartData = useMemo(
    () => survivalCurve.map((p) => ({ t: p.t, survival: Math.round(p.survival * 1000) / 1000 })),
    [survivalCurve]
  );

  const medianMttrMinutes = useMemo(() => medianSurvivalTime(survivalCurve), [survivalCurve]);

  const medianMttrCI = useMemo(() => {
    if (mttrMinutesResolved.length < 3) return null;
    return bootstrapQuantile(mttrMinutesResolved, 0.5);
  }, [mttrMinutesResolved]);

  // Mann-Kendall on weekly incident count (monotonic-trend chip).
  const weeklyIncidentCount = useMemo(() => {
    if (state.incidents.length === 0) return [];
    // Build weekly buckets covering the MOST RECENT 26 weeks (or fewer if the
    // history is shorter). The previous code anchored weekStart at the EARLIEST
    // incident and kept the FIRST 26 weeks, so once history exceeded 26 weeks
    // every recent incident landed at index >= 26 and was dropped — the
    // Mann-Kendall chip then analyzed stale history instead of current activity.
    const opens = state.incidents
      .map((i) => new Date(i.openedAt).getTime())
      .filter((t) => Number.isFinite(t));
    if (opens.length === 0) return [];
    const WEEKS = 26;
    // R5: spread-Math.min RangeError on lists >~100k. Use reduce.
    const earliestWeekStart = new Date(opens.reduce((m, t) => Math.min(m, t), Infinity));
    earliestWeekStart.setUTCDate(earliestWeekStart.getUTCDate() - earliestWeekStart.getUTCDay());
    earliestWeekStart.setUTCHours(0, 0, 0, 0);
    // Current week's Sunday (UTC), then the trailing 26-week window start.
    const curWeekStart = new Date(nowHourBucket * 3600000);
    curWeekStart.setUTCDate(curWeekStart.getUTCDate() - curWeekStart.getUTCDay());
    curWeekStart.setUTCHours(0, 0, 0, 0);
    const windowStart = new Date(curWeekStart);
    windowStart.setUTCDate(curWeekStart.getUTCDate() - (WEEKS - 1) * 7);
    // Don't start before the first incident — keeps the series short for sparse
    // histories so the Mann-Kendall length<5 guard still suppresses noise.
    const weekStart = new Date(Math.max(earliestWeekStart.getTime(), windowStart.getTime()));
    const totalWeeks = Math.max(
      1,
      Math.round((curWeekStart.getTime() - weekStart.getTime()) / (7 * 86_400_000)) + 1
    );
    const series = new Array(totalWeeks).fill(0) as number[];
    for (const ts of opens) {
      const w = Math.floor((ts - weekStart.getTime()) / (7 * 86_400_000));
      if (w >= 0 && w < totalWeeks) series[w] += 1;
    }
    return series;
  }, [state.incidents, nowHourBucket]);

  const incidentTrend = useMemo(() => {
    if (weeklyIncidentCount.length < 5) return null;
    return mannKendall(weeklyIncidentCount);
  }, [weeklyIncidentCount]);

  const promptConfig = useMemo(
    () => ({
      toolName: "Incident Commander",
      prompts: generateIncidentCommanderPrompts({
        incidents: state.incidents.map((i) => ({
          title: i.title,
          severity: i.severity,
          status: i.status,
          openedAt: i.openedAt,
          resolvedAt: i.resolvedAt,
          commander: i.commander,
          scribe: i.scribe,
          description: i.description,
          timelineCount: i.timeline.length,
        })),
        openCount: active.length,
        avgMttrHours,
        bySeverity,
      }),
    }),
    [state.incidents, active.length, avgMttrHours, bySeverity]
  );

  return (
    <ToolPageWrapper
      toolId="incident-commander"
      title="Incident Commander"
      description="Live-incident scaffolding with severity matrix, comms templates, and timeline log. Built for engineering leaders."
      category="Incidents & Reliability"
    >
      <ActionRow>
        <AiPromptGenerator config={promptConfig} />
        <ExportButton
          filename="incident-commander"
          csvData={{
            headers: [
              "Title",
              "Severity",
              "Status",
              "Opened",
              "Resolved",
              "Commander",
              "Scribe",
              "Timeline #",
              "MTTR (h)",
              "Description",
            ],
            rows: state.incidents.map((i) => [
              i.title,
              i.severity,
              i.status,
              i.openedAt,
              i.resolvedAt ?? "",
              i.commander ?? "",
              i.scribe ?? "",
              i.timeline.length,
              mttrHours(i)?.toFixed(2) ?? "",
              i.description ?? "",
            ]),
          }}
          jsonData={state}
        />
      </ActionRow>

      <KpiGrid cols={4} gap="lg">
        <StatCard
          variant="compact"
          icon={Siren}
          label="Open"
          value={active.length}
          hint="active or mitigated"
          tone={active.length > 0 ? "danger" : "default"}
        />
        <StatCard
          variant="compact"
          icon={Clock}
          label={medianMttrMinutes !== null ? "Median MTTR" : "Avg MTTR (7d)"}
          value={
            medianMttrMinutes !== null
              ? `${medianMttrMinutes}m`
              : avgMttrHours === null
                ? "—"
                : `${avgMttrHours.toFixed(1)}h`
          }
          hint={
            medianMttrCI && medianMttrMinutes !== null
              ? `95% CI [${Math.round(medianMttrCI.lower)}, ${Math.round(medianMttrCI.upper)}]`
              : avgMttrHours === null
                ? "No resolutions"
                : "resolved"
          }
        />
        <StatCard
          variant="compact"
          icon={ShieldAlert}
          label="SEV-1/2 (30d)"
          value={bySeverity.sev1 + bySeverity.sev2}
          hint={`${bySeverity.sev1} sev1 · ${bySeverity.sev2} sev2`}
          tone={bySeverity.sev1 + bySeverity.sev2 > 0 ? "warning" : "default"}
        />
        <StatCard
          variant="compact"
          icon={Activity}
          label="Total (30d)"
          value={bySeverity.sev1 + bySeverity.sev2 + bySeverity.sev3 + bySeverity.sev4}
          hint="all severities"
        />
      </KpiGrid>

      {incidentTrend && (
        <div className="flex flex-wrap items-center gap-2 mb-4">
          {incidentTrend.significant ? (
            <span
              className={`inline-flex items-center gap-1.5 text-[11px] font-mono uppercase tracking-wider px-2 py-1 rounded-md border ${
                incidentTrend.trend === "up"
                  ? "border-danger/40 text-danger bg-danger/10"
                  : "border-emerald-500/40 text-emerald-300 bg-emerald-500/10"
              }`}
            >
              <TrendingUp
                className={`w-3 h-3 ${incidentTrend.trend === "down" ? "rotate-180" : ""}`}
              />
              Weekly incidents trending {incidentTrend.trend} significantly
              <span className="opacity-60">· p={incidentTrend.pValue.toFixed(3)}</span>
            </span>
          ) : (
            <span className="inline-flex items-center gap-1.5 text-[11px] font-mono uppercase tracking-wider px-2 py-1 rounded-md border border-border text-sub bg-surface">
              <TrendingUp className="w-3 h-3" />
              Weekly incident trend: no significant change
            </span>
          )}
        </div>
      )}

      {survivalChartData.length > 1 && (
        <SectionCard
          title="MTTR survival curve"
          icon={Activity}
          titleSuffix={
            medianMttrMinutes !== null
              ? `Median ${medianMttrMinutes}m${
                  medianMttrCI
                    ? ` · 95% CI [${Math.round(medianMttrCI.lower)}, ${Math.round(medianMttrCI.upper)}]`
                    : ""
                }`
              : undefined
          }
          className="mb-6"
        >
          <div className="h-40 -mx-2">
            <ResponsiveContainer width="100%" height="100%">
              <LineChart
                data={survivalChartData}
                margin={{ top: 8, right: 16, left: 0, bottom: 0 }}
              >
                <CartesianGrid stroke={chartTheme.gridColor} strokeDasharray="3 3" />
                <XAxis
                  dataKey="t"
                  tick={{ fill: chartTheme.axisColor, fontSize: 11 }}
                  axisLine={{ stroke: chartTheme.gridColor }}
                  label={{
                    value: "minutes",
                    fill: chartTheme.axisColor,
                    fontSize: 10,
                    position: "insideBottom",
                    offset: -2,
                  }}
                />
                <YAxis
                  domain={[0, 1]}
                  tick={{ fill: chartTheme.axisColor, fontSize: 11 }}
                  axisLine={{ stroke: chartTheme.gridColor }}
                  tickFormatter={(v) => `${Math.round(v * 100)}%`}
                />
                <Tooltip
                  contentStyle={chartTheme.tooltipStyle}
                  formatter={(v) => [`${(Number(v) * 100).toFixed(1)}%`, "still open"]}
                  labelFormatter={(v) => `${v}m`}
                />
                <Line
                  type="stepAfter"
                  dataKey="survival"
                  stroke={chartTheme.colors.cyan}
                  strokeWidth={2}
                  dot={false}
                  isAnimationActive={false}
                />
              </LineChart>
            </ResponsiveContainer>
          </div>
          <p className="text-[11px] text-sub mt-2">
            {/* BUG-RD3-incident-commander-1: drop the misleading
                "right-censored" claim. The code now only feeds RESOLVED
                incidents into the K-M estimator (each marked
                `event: true`), so this is mathematically the empirical
                CDF of resolution times, not a censored survival curve.
                The earlier caption made it sound like active incidents
                were also informing the curve. */}
            Empirical resolution-time distribution over {mttrMinutesResolved.length} resolved
            incident{mttrMinutesResolved.length === 1 ? "" : "s"}. Active incidents are not
            included. Y-axis: probability the incident takes longer than N minutes to resolve.
          </p>
        </SectionCard>
      )}

      <div className="grid grid-cols-1 xl:grid-cols-2 gap-6 mb-6">
        <SectionCard title="Declare an incident" icon={Plus} titleSize="lg">
          <div className="space-y-3">
            <div>
              <Label htmlFor="ic-title" className="text-xs text-sub">
                Title
              </Label>
              <Input
                id="ic-title"
                value={draft.title}
                onChange={(e) => setDraft((d) => ({ ...d, title: e.target.value }))}
                onKeyDown={(e) => {
                  if (e.key === "Enter") addIncident();
                }}
                placeholder="e.g. Checkout 500s spiking"
                className="bg-surface border-border"
              />
            </div>
            <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
              <div>
                <Label htmlFor="ic-sev" className="text-xs text-sub">
                  Severity
                </Label>
                <Select
                  value={draft.severity}
                  onValueChange={(v) => setDraft((d) => ({ ...d, severity: v as Severity }))}
                >
                  <SelectTrigger id="ic-sev" className="bg-surface border-border">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    {(Object.keys(SEVERITY_LABEL) as Severity[]).map((s) => (
                      <SelectItem key={s} value={s}>
                        {SEVERITY_LABEL[s]}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
              <div>
                <Label htmlFor="ic-cmd" className="text-xs text-sub">
                  Commander
                </Label>
                <Input
                  id="ic-cmd"
                  value={draft.commander}
                  onChange={(e) => setDraft((d) => ({ ...d, commander: e.target.value }))}
                  placeholder="optional"
                  className="bg-surface border-border"
                />
              </div>
              <div>
                <Label htmlFor="ic-scribe" className="text-xs text-sub">
                  Scribe
                </Label>
                <Input
                  id="ic-scribe"
                  value={draft.scribe}
                  onChange={(e) => setDraft((d) => ({ ...d, scribe: e.target.value }))}
                  placeholder="optional"
                  className="bg-surface border-border"
                />
              </div>
            </div>
            <div>
              <Label htmlFor="ic-desc" className="text-xs text-sub">
                Description (optional)
              </Label>
              <Textarea
                id="ic-desc"
                value={draft.description}
                onChange={(e) => setDraft((d) => ({ ...d, description: e.target.value }))}
                rows={2}
                placeholder="What's the user-visible symptom? Any blast-radius hints?"
                className="bg-surface border-border resize-none text-xs"
              />
            </div>
            <Button
              onClick={addIncident}
              className="gap-2 bg-accent text-bg hover:bg-accent/90 w-full"
            >
              <Siren className="w-4 h-4" aria-hidden="true" />
              Declare incident
            </Button>
          </div>
        </SectionCard>

        <SectionCard title="Severity matrix" icon={ShieldAlert} titleSize="lg">
          <ul className="space-y-2 text-xs">
            {SEVERITY_MATRIX.map((m) => (
              <li
                key={m.sev}
                className="flex items-start gap-2 p-2 rounded-md border border-border bg-bg"
              >
                <Badge
                  variant="outline"
                  className={`${SEVERITY_BADGE_CLASS[m.sev]} font-data shrink-0`}
                >
                  {SEVERITY_LABEL[m.sev]}
                </Badge>
                <span className="text-sub">{m.rule}</span>
              </li>
            ))}
          </ul>
        </SectionCard>
      </div>

      {active.length === 0 ? (
        <EmptyState icon={CheckCircle2} className="mb-6">
          No active incidents. When a new one is declared it will appear here with timeline log and
          comms templates.
        </EmptyState>
      ) : (
        <div className="space-y-4 mb-6">
          {active.map((incident) => (
            <ActiveIncidentCard
              key={incident.id}
              incident={incident}
              now={now}
              onMarkStatus={markStatus}
              onAssignRole={assignRole}
              onRemove={removeIncident}
              onAddTimelineEntry={addTimelineEntry}
            />
          ))}
        </div>
      )}

      {recent.length > 0 && (
        <SectionCard title="Recent incidents" titleSize="lg">
          <div className="overflow-x-auto -mx-4 px-4">
            <table className="w-full text-xs min-w-full md:min-w-[640px]">
              <thead>
                <tr className="text-left text-sub border-b border-border">
                  <th className="py-2 pr-3">Title</th>
                  <th className="py-2 pr-3">Severity</th>
                  <th className="py-2 pr-3">Status</th>
                  <th className="py-2 pr-3">Opened</th>
                  <th className="py-2 pr-3">MTTR</th>
                  <th className="py-2 pr-3">Commander</th>
                  <th className="py-2 pr-3 w-10"></th>
                </tr>
              </thead>
              <tbody>
                {recent.map((i) => {
                  const m = mttrHours(i);
                  return (
                    <tr key={i.id} className="border-b border-border/40">
                      <td className="py-2 pr-3 text-text">
                        <span className="line-clamp-1">{i.title}</span>
                      </td>
                      <td className="py-2 pr-3">
                        <Badge
                          variant="outline"
                          className={`${SEVERITY_BADGE_CLASS[i.severity]} font-data`}
                        >
                          {SEVERITY_LABEL[i.severity]}
                        </Badge>
                      </td>
                      <td className="py-2 pr-3">
                        <Badge variant="outline" className={STATUS_BADGE_CLASS[i.status]}>
                          {i.status}
                        </Badge>
                      </td>
                      <td className="py-2 pr-3 font-data text-sub">
                        {new Date(i.openedAt).toLocaleString()}
                      </td>
                      <td className="py-2 pr-3 font-data">
                        {m === null ? "—" : `${m.toFixed(2)}h`}
                      </td>
                      <td className="py-2 pr-3 text-sub">{i.commander ?? "—"}</td>
                      <td className="py-2 pr-3 text-right">
                        <Button
                          variant="ghost"
                          size="sm"
                          onClick={() => removeIncident(i.id)}
                          aria-label={`Remove ${i.title}`}
                          className="h-7 w-7 p-0 text-sub hover:text-danger"
                        >
                          <Trash2 className="w-3.5 h-3.5" aria-hidden="true" />
                        </Button>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        </SectionCard>
      )}
    </ToolPageWrapper>
  );
}
