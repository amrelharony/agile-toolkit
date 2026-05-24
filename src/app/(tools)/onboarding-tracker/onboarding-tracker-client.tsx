"use client";

import { useEffect, useMemo, useState } from "react";
import {
  ResponsiveContainer,
  LineChart,
  Line,
  XAxis,
  YAxis,
  CartesianGrid,
  Tooltip,
} from "recharts";
import { ToolPageWrapper } from "@/components/layout/tool-page-wrapper";
import { ExportButton } from "@/components/shared/export-button";
import { AiPromptGenerator } from "@/components/shared/ai-prompt-generator";
import { ActionRow } from "@/components/shared/action-row";
import { StatCard } from "@/components/shared/stat-card";
import { KpiGrid } from "@/components/shared/kpi-grid";
import { CalloutAlert } from "@/components/shared/callout-alert";
import { EmptyState } from "@/components/shared/empty-state";
import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { BlurInput } from "@/components/shared/blur-fields";
import { Textarea } from "@/components/ui/textarea";
import { Label } from "@/components/ui/label";
import { Plus, Trash2, UserPlus, Check, Clock, TrendingUp, AlertTriangle } from "lucide-react";
import { usePersisted } from "@/lib/utils/use-persisted";
import { todayLocalISO } from "@/lib/utils/formatters";
import { useHistoryLogger } from "@/lib/history/use-history-logger";
import { ONBOARDING_TRACKER_ACTIONS } from "@/lib/history/event-actions";
import { generateOnboardingTrackerPrompts } from "@/lib/ai-prompts/onboarding-tracker";
import { useShallow } from "zustand/react/shallow";
import { useWorkspaceStore } from "@/lib/stores/workspace-store";
import type { Workspace } from "@/lib/stores/workspace-types";
import { chartTheme } from "@/components/charts/chart-theme";
import { cn } from "@/lib/utils";

interface Milestone {
  id: string;
  name: string;
  targetDays: number;
  completedAt?: string;
  notes?: string;
}

interface Onboardee {
  id: string;
  name: string;
  role?: string;
  startDate: string;
  milestones: Milestone[];
  description?: string;
}

const DEFAULT_MILESTONE_TEMPLATES: { name: string; targetDays: number }[] = [
  { name: "First commit", targetDays: 3 },
  { name: "First PR", targetDays: 7 },
  { name: "First merge", targetDays: 14 },
  { name: "First production deploy", targetDays: 30 },
  { name: "Independent feature", targetDays: 60 },
  { name: "Mentor a peer", targetDays: 90 },
];

const FIRST_PR_NAME = "First PR";
const PRODUCTIVITY_NAME = "Independent feature";

function buildDefaultMilestones(): Milestone[] {
  return DEFAULT_MILESTONE_TEMPLATES.map((m) => ({
    id: crypto.randomUUID(),
    name: m.name,
    targetDays: m.targetDays,
  }));
}

function parseLocalDate(iso: string): Date | null {
  const m = /^(\d{4})-(\d{2})-(\d{2})/.exec(iso);
  if (!m) return null;
  return new Date(Number(m[1]), Number(m[2]) - 1, Number(m[3]));
}

function daysBetween(a: string, b: string): number {
  const aDate = parseLocalDate(a);
  const bDate = parseLocalDate(b);
  if (!aDate || !bDate) return 0;
  return Math.round((bDate.getTime() - aDate.getTime()) / 86400000);
}

function daysSince(iso: string): number {
  const start = parseLocalDate(iso);
  if (!start) return 0;
  const today = new Date();
  const todayLocal = new Date(today.getFullYear(), today.getMonth(), today.getDate());
  return Math.round((todayLocal.getTime() - start.getTime()) / 86400000);
}

/**
 * Centralized at-risk check. A milestone is at-risk if it's incomplete and
 * the elapsed days since the person's start are >50% of the target.
 * Mirrored in `src/lib/ai-prompts/onboarding-tracker.ts` — keep in sync.
 */
function isAtRisk(
  startDate: string,
  milestone: { targetDays: number; completedAt?: string },
  todayMs: number
): boolean {
  if (milestone.completedAt) return false;
  // Guard against targetDays <= 0 (legacy / imported data, or an accidental
  // 0-day milestone). Without this, `elapsed > 0` triggers "at risk" the
  // instant the person starts.
  if (!Number.isFinite(milestone.targetDays) || milestone.targetDays <= 0) return false;
  const start = parseLocalDate(startDate);
  if (!start) return false;
  const elapsed = (todayMs - start.getTime()) / 86400000;
  return elapsed > milestone.targetDays * 0.5;
}

export function OnboardingTrackerClient() {
  const [onboardees, setOnboardees] = usePersisted<Onboardee[]>(
    "agile-toolkit:onboarding-tracker",
    []
  );
  const { log } = useHistoryLogger("onboarding-tracker");
  const workspace = useWorkspaceStore(
    useShallow(
      (s): Workspace => ({
        teamMembers: s.teamMembers,
        sprints: s.sprints,
        stories: s.stories,
        impediments: s.impediments,
        risks: s.risks,
        okrs: s.okrs,
        decisions: s.decisions,
        techDebt: s.techDebt,
        maturityLevel: s.maturityLevel,
        teamName: s.teamName,
      })
    )
  );

  const [name, setName] = useState("");
  const [role, setRole] = useState("");
  const [startDate, setStartDate] = useState(todayLocalISO());
  const [description, setDescription] = useState("");

  const addOnboardee = () => {
    const trimmedName = name.trim();
    if (!trimmedName) return;
    const trimmedRole = role.trim() || undefined;
    const trimmedDescription = description.trim() || undefined;
    const person: Onboardee = {
      id: crypto.randomUUID(),
      name: trimmedName,
      role: trimmedRole,
      startDate: startDate || todayLocalISO(),
      milestones: buildDefaultMilestones(),
      description: trimmedDescription,
    };
    setOnboardees((prev) => [person, ...prev]);
    log(ONBOARDING_TRACKER_ACTIONS.PERSON_ADDED, {
      personId: person.id,
      name: person.name,
      role: person.role,
    });
    setName("");
    setRole("");
    setStartDate(todayLocalISO());
    setDescription("");
  };

  const removePerson = (id: string) => {
    const person = onboardees.find((p) => p.id === id);
    setOnboardees((prev) => prev.filter((p) => p.id !== id));
    log(ONBOARDING_TRACKER_ACTIONS.PERSON_REMOVED, {
      personId: id,
      name: person?.name,
    });
  };

  const toggleMilestone = (personId: string, milestoneId: string) => {
    // Pre-compute target/log info from the current snapshot so we don't
    // mutate inside setState. If the person/milestone vanished mid-render,
    // the functional update below will still no-op.
    const person = onboardees.find((p) => p.id === personId);
    const milestone = person?.milestones.find((m) => m.id === milestoneId);
    if (!milestone) return;
    const wasCompleted = Boolean(milestone.completedAt);
    const completedAt = wasCompleted ? undefined : todayLocalISO();
    setOnboardees((prev) =>
      prev.map((p) =>
        p.id !== personId
          ? p
          : {
              ...p,
              milestones: p.milestones.map((m) =>
                m.id === milestoneId ? { ...m, completedAt } : m
              ),
            }
      )
    );
    if (!wasCompleted) {
      log(ONBOARDING_TRACKER_ACTIONS.MILESTONE_LOGGED, {
        personId,
        milestoneId,
        milestoneName: milestone.name,
        completedAt,
      });
    } else {
      // BUG-T5-onboarding-tracker-2: log un-complete too so the audit
      // trail captures rollback events.
      log(ONBOARDING_TRACKER_ACTIONS.MILESTONE_UNCOMPLETED, {
        personId,
        milestoneId,
        milestoneName: milestone.name,
      });
    }
  };

  const updateNote = (personId: string, milestoneId: string, notes: string) => {
    const trimmed = notes.trim() || undefined;
    setOnboardees((prev) =>
      prev.map((p) =>
        p.id !== personId
          ? p
          : {
              ...p,
              milestones: p.milestones.map((m) =>
                m.id === milestoneId ? { ...m, notes: trimmed } : m
              ),
            }
      )
    );
  };

  // BUG-T5-onboarding-tracker-4: tick a `now` clock every minute so the
  // at-risk KPI invalidates as real time passes. Without this, the
  // stats memo only re-runs when onboardees mutate; a fresh-loaded
  // dashboard left open across midnight shows the at-risk count from
  // when the page loaded.
  const [nowTick, setNowTick] = useState(() => Date.now());
  useEffect(() => {
    const i = setInterval(() => setNowTick(Date.now()), 60_000);
    return () => clearInterval(i);
  }, []);

  const stats = useMemo(() => {
    let firstPRTotal = 0;
    let firstPRCount = 0;
    let productivityTotal = 0;
    let productivityCount = 0;
    let atRisk = 0;
    const today = nowTick;
    for (const p of onboardees) {
      for (const m of p.milestones) {
        if (!m.completedAt) {
          if (isAtRisk(p.startDate, m, today)) atRisk += 1;
          continue;
        }
        const days = daysBetween(p.startDate, m.completedAt);
        if (m.name === FIRST_PR_NAME) {
          firstPRTotal += days;
          firstPRCount += 1;
        }
        if (m.name === PRODUCTIVITY_NAME) {
          productivityTotal += days;
          productivityCount += 1;
        }
      }
    }
    return {
      avgFirstPR: firstPRCount > 0 ? firstPRTotal / firstPRCount : null,
      avgProductivity: productivityCount > 0 ? productivityTotal / productivityCount : null,
      atRiskCount: atRisk,
    };
  }, [onboardees, nowTick]);

  const rampCurveData = useMemo(() => {
    // Build an avg "% milestones complete by day X" curve across people.
    if (onboardees.length === 0) return [];
    const maxDay = 90;
    const out: { day: number; avgPct: number }[] = [];
    for (let d = 0; d <= maxDay; d += 5) {
      let pctSum = 0;
      let counted = 0;
      for (const p of onboardees) {
        if (p.milestones.length === 0) continue;
        const completedByDay = p.milestones.filter((m) => {
          if (!m.completedAt) return false;
          return daysBetween(p.startDate, m.completedAt) <= d;
        }).length;
        pctSum += (completedByDay / p.milestones.length) * 100;
        counted += 1;
      }
      out.push({ day: d, avgPct: counted > 0 ? pctSum / counted : 0 });
    }
    return out;
  }, [onboardees]);

  const promptConfig = useMemo(
    () => ({
      toolName: "Onboarding Speed Tracker",
      prompts: generateOnboardingTrackerPrompts(
        {
          onboardees: onboardees.map((p) => ({
            name: p.name,
            role: p.role,
            startDate: p.startDate,
            description: p.description,
            milestones: p.milestones.map((m) => ({
              name: m.name,
              targetDays: m.targetDays,
              completedAt: m.completedAt,
              notes: m.notes,
            })),
          })),
          avgTimeToFirstPR: stats.avgFirstPR,
          avgTimeToProductivity: stats.avgProductivity,
          atRiskCount: stats.atRiskCount,
        },
        workspace
      ),
    }),
    [onboardees, stats, workspace]
  );

  return (
    <ToolPageWrapper
      toolId="onboarding-tracker"
      title="Onboarding Speed Tracker"
      description="Track milestones, time-to-first-PR, and time-to-productivity for each new hire's ramp."
      category="Team Health & Maturity"
    >
      <ActionRow>
        <AiPromptGenerator config={promptConfig} />
        <ExportButton
          filename="onboarding-tracker"
          csvData={{
            headers: [
              "Name",
              "Role",
              "Start date",
              "Description",
              "Milestone",
              "Target days",
              "Completed at",
              "Days to complete",
              "Notes",
            ],
            rows: onboardees.flatMap((p) =>
              p.milestones.map((m) => [
                p.name,
                p.role ?? "",
                p.startDate,
                p.description ?? "",
                m.name,
                m.targetDays,
                m.completedAt ?? "",
                m.completedAt ? daysBetween(p.startDate, m.completedAt) : "",
                m.notes ?? "",
              ])
            ),
          }}
          jsonData={onboardees}
        />
      </ActionRow>

      <KpiGrid cols={4} gap="lg">
        <StatCard
          variant="compact"
          icon={UserPlus}
          label="Active onboardees"
          value={onboardees.length}
          valueClassName="text-accent"
        />
        <StatCard
          variant="compact"
          icon={Clock}
          label="Avg time-to-first-PR"
          value={stats.avgFirstPR !== null ? `${stats.avgFirstPR.toFixed(1)}d` : "—"}
        />
        <StatCard
          variant="compact"
          icon={TrendingUp}
          label="Avg time-to-productivity"
          value={stats.avgProductivity !== null ? `${stats.avgProductivity.toFixed(1)}d` : "—"}
          hint="Independent feature"
        />
        <StatCard
          variant="compact"
          icon={AlertTriangle}
          label="At-risk milestones"
          value={stats.atRiskCount}
          tone={stats.atRiskCount > 0 ? "warning" : "default"}
        />
      </KpiGrid>

      {stats.atRiskCount > 0 && (
        <CalloutAlert tone="warning" className="mb-4">
          <strong>{stats.atRiskCount}</strong> milestone
          {stats.atRiskCount === 1 ? " is" : "s are"} more than 50% past their target days without
          completion. Consider a check-in.
        </CalloutAlert>
      )}

      {/* Add-onboardee form */}
      <Card className="bg-surface border-border mb-4">
        <CardContent className="p-4">
          <div className="grid grid-cols-1 sm:grid-cols-[1fr_1fr_180px_auto] gap-2">
            <div>
              <Label className="text-xs text-sub">Name</Label>
              <Input
                value={name}
                onChange={(e) => setName(e.target.value)}
                placeholder="Jane Doe"
                className="bg-bg border-border"
                aria-label="Onboardee name"
              />
            </div>
            <div>
              <Label className="text-xs text-sub">Role</Label>
              <Input
                value={role}
                onChange={(e) => setRole(e.target.value)}
                placeholder="Software Engineer"
                className="bg-bg border-border"
                aria-label="Onboardee role"
              />
            </div>
            <div>
              <Label className="text-xs text-sub">Start date</Label>
              <Input
                type="date"
                value={startDate}
                onChange={(e) => setStartDate(e.target.value)}
                className="bg-bg border-border"
                aria-label="Start date"
              />
            </div>
            <div className="flex items-end">
              <Button
                onClick={addOnboardee}
                className="gap-2 bg-accent text-bg hover:bg-accent/90 w-full"
              >
                <Plus className="w-4 h-4" />
                Add
              </Button>
            </div>
          </div>
          <div className="mt-2">
            <Textarea
              value={description}
              onChange={(e) => setDescription(e.target.value)}
              placeholder="Description (optional)..."
              rows={2}
              className="bg-bg border-border resize-none text-xs"
              aria-label="Description"
            />
          </div>
        </CardContent>
      </Card>

      {onboardees.length === 0 ? (
        <EmptyState icon={UserPlus}>
          No onboardees yet. Add your first new joiner above to start tracking their ramp.
        </EmptyState>
      ) : (
        <div className="space-y-3 mb-6">
          {onboardees.map((p) => {
            const ageDays = daysSince(p.startDate);
            const completedCount = p.milestones.filter((m) => m.completedAt).length;
            return (
              <Card key={p.id} className="bg-surface border-border">
                <CardContent className="p-4 space-y-3">
                  <div className="flex flex-col xs:flex-row xs:items-start xs:justify-between gap-2">
                    <div className="min-w-0">
                      <div className="text-sm font-semibold text-text">
                        {p.name}
                        {p.role && <span className="text-sub font-normal ml-2">· {p.role}</span>}
                      </div>
                      <div className="text-xs text-sub mt-0.5">
                        Started {p.startDate} · Day {ageDays} · {completedCount}/
                        {p.milestones.length} milestones
                      </div>
                      {p.description && (
                        <div className="text-xs text-sub mt-1 whitespace-pre-wrap">
                          {p.description}
                        </div>
                      )}
                    </div>
                    <Button
                      variant="ghost"
                      size="sm"
                      onClick={() => removePerson(p.id)}
                      className="text-sub hover:text-danger"
                      aria-label={`Remove ${p.name}`}
                    >
                      <Trash2 className="w-3.5 h-3.5" />
                    </Button>
                  </div>

                  <div className="space-y-2">
                    {p.milestones.map((m) => {
                      const completed = Boolean(m.completedAt);
                      const elapsed = ageDays;
                      const overdue = !completed && elapsed > m.targetDays;
                      const atRisk = !completed && elapsed > m.targetDays * 0.5;
                      const completedDays = completed
                        ? daysBetween(p.startDate, m.completedAt!)
                        : null;
                      return (
                        <div
                          key={m.id}
                          className={cn(
                            "rounded-md border p-2",
                            completed
                              ? "border-emerald-500/40 bg-emerald-500/5"
                              : overdue
                                ? "border-danger/40 bg-danger/5"
                                : atRisk
                                  ? "border-amber-500/40 bg-amber-500/5"
                                  : "border-border bg-bg"
                          )}
                        >
                          <div className="flex items-start gap-2">
                            <button
                              type="button"
                              onClick={() => toggleMilestone(p.id, m.id)}
                              className={cn(
                                "mt-0.5 w-5 h-5 rounded border flex items-center justify-center shrink-0 transition",
                                completed
                                  ? "bg-emerald-500/30 border-emerald-500/60 text-emerald-200"
                                  : "border-border bg-surface text-transparent hover:text-sub"
                              )}
                              aria-label={
                                completed ? `Mark ${m.name} incomplete` : `Mark ${m.name} complete`
                              }
                            >
                              <Check className="w-3 h-3" />
                            </button>
                            <div className="min-w-0 flex-1">
                              <div className="flex flex-wrap items-baseline gap-x-2 gap-y-0.5">
                                <span className="text-sm font-medium text-text">{m.name}</span>
                                <span className="text-[11px] text-sub font-data">
                                  target {m.targetDays}d
                                </span>
                                {completed && completedDays !== null && (
                                  <span className="text-[11px] text-emerald-300 font-data">
                                    done in {completedDays}d
                                  </span>
                                )}
                                {!completed && overdue && (
                                  <span className="text-[11px] text-danger font-data">overdue</span>
                                )}
                                {!completed && atRisk && !overdue && (
                                  <span className="text-[11px] text-amber-300 font-data">
                                    at risk
                                  </span>
                                )}
                              </div>
                              {/* BUG-T5-onboarding-tracker-3:
                                  commit on blur instead of every
                                  keystroke. The prior pattern wrote
                                  to localStorage per character. */}
                              <BlurInput
                                value={m.notes ?? ""}
                                onCommit={(v) => updateNote(p.id, m.id, v)}
                                placeholder="Note (optional)"
                                className="mt-1 bg-surface border-border h-7 text-xs"
                                aria-label={`Note for ${m.name}`}
                              />
                            </div>
                          </div>
                        </div>
                      );
                    })}
                  </div>
                </CardContent>
              </Card>
            );
          })}
        </div>
      )}

      {/* Ramp curve */}
      {onboardees.length > 0 && rampCurveData.length > 0 && (
        <Card className="bg-surface border-border">
          <CardContent className="p-4">
            <div className="text-sm font-semibold text-text mb-3 flex items-center gap-2">
              <TrendingUp className="w-4 h-4 text-accent" />
              Avg ramp curve (milestones completed over time)
            </div>
            <div className="h-64 -mx-2">
              <ResponsiveContainer width="100%" height="100%">
                <LineChart data={rampCurveData}>
                  <CartesianGrid strokeDasharray="3 3" stroke={chartTheme.gridColor} />
                  <XAxis
                    dataKey="day"
                    tick={{ fill: chartTheme.axisColor, fontSize: 11 }}
                    tickFormatter={(v) => `${v}d`}
                    axisLine={{ stroke: chartTheme.gridColor }}
                  />
                  <YAxis
                    tick={{ fill: chartTheme.axisColor, fontSize: 11 }}
                    axisLine={{ stroke: chartTheme.gridColor }}
                    domain={[0, 100]}
                    tickFormatter={(v) => `${v}%`}
                  />
                  <Tooltip
                    contentStyle={chartTheme.tooltipStyle}
                    labelFormatter={(v) => `Day ${v}`}
                    formatter={(v) => [
                      typeof v === "number" ? `${v.toFixed(1)}%` : String(v),
                      "% complete",
                    ]}
                  />
                  <Line
                    type="monotone"
                    dataKey="avgPct"
                    stroke={chartTheme.colors.cyan}
                    strokeWidth={2}
                    dot={false}
                  />
                </LineChart>
              </ResponsiveContainer>
            </div>
          </CardContent>
        </Card>
      )}
    </ToolPageWrapper>
  );
}
