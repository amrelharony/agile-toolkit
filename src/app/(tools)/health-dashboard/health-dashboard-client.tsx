"use client";

import { useMemo, useRef, useState } from "react";
import Link from "next/link";
import {
  Activity,
  AlertCircle,
  AlertTriangle,
  Clock,
  HeartPulse,
  LayoutDashboard,
  Mic,
  SlidersHorizontal,
  type LucideIcon,
} from "lucide-react";
import { ToolPageWrapper } from "@/components/layout/tool-page-wrapper";
import { AiPromptGenerator } from "@/components/shared/ai-prompt-generator";
import { ExportButton } from "@/components/shared/export-button";
import { ActionRow } from "@/components/shared/action-row";
import { SectionCard } from "@/components/shared/section-card";
import { EmptyState } from "@/components/shared/empty-state";
import { useAnnounce } from "@/components/a11y/live-announcer";
import { ExampleNotice, LoadExampleButton } from "@/components/tool-frame/example-data";
import { generateHealthDashboardPrompts } from "@/lib/ai-prompts/health-dashboard";
import { useHistoryLogger } from "@/lib/history/use-history-logger";
import { HEALTH_DASHBOARD_ACTIONS } from "@/lib/history/event-actions";
import { useWorkspaceStore } from "@/lib/stores/workspace-store";
import type { HealthDashboardConfig } from "@/lib/stores/workspace-types";
import { useWorkspaceHydrated } from "@/lib/team/use-team-roster";
import { todayIso } from "@/lib/sprints/series";
import { undoable } from "@/lib/utils/undoable";
import { cn } from "@/lib/utils";
import {
  HEALTH_DASHBOARD_ID,
  configFor,
  isDefaultSettings,
  settingsOf,
  type HealthKpiId,
  type HealthSettings,
  type TrafficStatus,
} from "@/lib/health-dashboard/settings";
import { dashboardKpis, overallHealth, type HealthKpi } from "@/lib/health-dashboard/kpis";
import { healthVerdict } from "@/lib/health-dashboard/verdict";
import { FullInsightsPanel } from "./components/full-insights-panel";
import { KpiCard } from "./components/kpi-card";
import { TrafficCircle } from "./components/kpi-indicators";
import { ThresholdsForm } from "./components/thresholds-form";
import { DashboardAdvanced } from "./components/advanced";
import { buildExample, type DashboardExample } from "./example";
import { toMarkdown } from "./markdown";
import { useCrossToolSignals } from "./signals";
import { STATUS_LABEL, STATUS_SURFACE, STATUS_TEXT } from "./status-config";

export const TOOL_ID = "health-dashboard";

const ICON: Record<HealthKpiId, LucideIcon> = {
  predictability: Activity,
  "team-health": HeartPulse,
  "open-impediments": AlertTriangle,
  "critical-impediments": AlertCircle,
  "open-blockers": Mic,
  "cycle-time-p85": Clock,
};

/** Where to start when nothing has data yet. */
const START_HERE = [
  { href: "/sprint", label: "Sprint Cockpit" },
  { href: "/health-check", label: "Health Check" },
  { href: "/impediments", label: "Impediments" },
  { href: "/standup", label: "Standup" },
  { href: "/kanban", label: "Kanban" },
];

/** Writes the team's dashboard settings (the agent's set_thresholds writes the same doc). */
function writeConfig(next: HealthDashboardConfig | null) {
  const { upsertHealthDashboard, removeHealthDashboard } = useWorkspaceStore.getState();
  if (next) upsertHealthDashboard(next);
  else removeHealthDashboard(HEALTH_DASHBOARD_ID);
}

/**
 * Team Dashboard: six KPIs worked out by lib/health-dashboard from the
 * synced workspace (the numbers tool.health_dashboard.get_summary returns),
 * each lit against the team's own thresholds, with a one-sentence verdict,
 * an overall score and a Markdown report. Nothing here reads another tool's
 * device-local store: cycle time comes from the Sprint and Flow boards.
 */
export function HealthDashboardClient() {
  const hydrated = useWorkspaceHydrated();
  const sprints = useWorkspaceStore((s) => s.sprints);
  const stories = useWorkspaceStore((s) => s.stories);
  const kanbanBoards = useWorkspaceStore((s) => s.kanbanBoards);
  const healthChecks = useWorkspaceStore((s) => s.healthChecks);
  const impediments = useWorkspaceStore((s) => s.impediments);
  const standupEntries = useWorkspaceStore((s) => s.standupEntries);
  const asyncUpdates = useWorkspaceStore((s) => s.asyncUpdates);
  const config = useWorkspaceStore((s) =>
    (s.healthDashboards ?? []).find((c) => c.id === HEALTH_DASHBOARD_ID)
  );
  const { log } = useHistoryLogger(TOOL_ID);
  const announce = useAnnounce();
  const signals = useCrossToolSignals();
  const [today] = useState(() => todayIso());
  // The example lives here only: nothing in it reaches the workspace.
  const [example, setExample] = useState<DashboardExample | null>(null);
  const preview = example !== null;

  const settings = useMemo(() => settingsOf(config), [config]);
  const kpis = useMemo(
    () =>
      dashboardKpis(
        example
          ? { ...example, config, today }
          : {
              sprints,
              stories,
              kanbanBoards,
              healthChecks,
              impediments,
              standupEntries,
              asyncUpdates,
              config,
              today,
            },
        { includeExamples: preview }
      ),
    [
      example,
      preview,
      sprints,
      stories,
      kanbanBoards,
      healthChecks,
      impediments,
      standupEntries,
      asyncUpdates,
      config,
      today,
    ]
  );
  const overall = overallHealth(kpis);
  const verdict = healthVerdict(kpis);
  const markdown = toMarkdown({ kpis, overall, verdict, settings, today });
  const anyData = kpis.some((k) => k.hasData);

  /* ── Settings ─────────────────────────────────────────────────────── */

  // Bumped after a save, a reset or its Undo, so the form shows the stored values.
  const [formKey, setFormKey] = useState(0);
  const before = useRef<HealthDashboardConfig | null>(null);

  const saveSettings = (next: HealthSettings) => {
    const prev = config ?? null;
    const doc = configFor(next, new Date().toISOString());
    undoable({
      label: "Saved the dashboard thresholds",
      apply: () => {
        writeConfig(doc);
        log(HEALTH_DASHBOARD_ACTIONS.THRESHOLDS_UPDATED, {
          thresholds: doc.thresholds ?? {},
          sprintWindow: next.windows.sprintWindow,
          blockerWindowDays: next.windows.blockerWindowDays,
          cycleWindowDays: next.windows.cycleWindowDays,
        });
      },
      revert: () => {
        writeConfig(prev);
        setFormKey((k) => k + 1);
      },
    });
    announce("Saved the thresholds. The lights now follow them.");
  };

  const resetSettings = () => {
    before.current = config ?? null;
    writeConfig(configFor(settingsOf(null), new Date().toISOString()));
    log(HEALTH_DASHBOARD_ACTIONS.THRESHOLDS_UPDATED, { reset: true });
    setFormKey((k) => k + 1);
    announce("Reset the thresholds to the defaults.");
  };

  const undoReset = () => {
    writeConfig(before.current);
    before.current = null;
    setFormKey((k) => k + 1);
  };

  const promptConfig = useMemo(
    () => ({
      toolName: "Health Dashboard",
      prompts: generateHealthDashboardPrompts({
        kpis: kpis
          .filter(
            (k): k is HealthKpi & { value: number; status: TrafficStatus } =>
              k.value !== null && k.status !== null
          )
          .map((k) => ({
            name: k.name,
            value: k.value,
            unit: k.unit === "percent" ? "%" : k.unit === "days" ? " days" : "",
            status: k.status,
            trend: "same" as const,
            sourceName: k.source.label,
            description: k.basis,
          })),
      }),
    }),
    [kpis]
  );

  if (!hydrated) {
    return (
      <ToolPageWrapper
        toolId={TOOL_ID}
        title="Team Dashboard"
        description="Six team KPIs from your sprints, health checks, impediments, standups and boards, against your own thresholds."
        category="Metrics & Dashboards"
        showInsights={false}
      >
        <p
          role="status"
          className="rounded-lg border border-border bg-card px-4 py-10 text-center text-sm text-sub"
        >
          Loading the dashboard…
        </p>
      </ToolPageWrapper>
    );
  }

  return (
    <ToolPageWrapper
      toolId={TOOL_ID}
      title="Team Dashboard"
      description="Six team KPIs from your sprints, health checks, impediments, standups and boards, against your own thresholds."
      category="Metrics & Dashboards"
      showInsights={false}
    >
      {preview && (
        <div>
          <ExampleNotice onClear={() => setExample(null)} />
          <p className="-mt-2 mb-4 text-xs text-sub">
            Example: a checkout team two weeks into Sprint 15, read with your thresholds. Nothing in
            it is saved, and your own tools stay as they are.
          </p>
        </div>
      )}

      {!anyData && !preview ? (
        <EmptyState
          icon={LayoutDashboard}
          action={<LoadExampleButton onLoad={() => setExample(buildExample())} />}
        >
          <p>
            Nothing to show yet. The dashboard reads your sprints, saved health checks, impediments,
            standups and the Sprint and Flow boards; start with any of them:
          </p>
          <ul className="mt-3 flex flex-wrap justify-center gap-x-4 gap-y-1">
            {START_HERE.map((s) => (
              <li key={s.href}>
                <Link href={s.href} className="font-medium text-accent hover:underline">
                  {s.label}
                </Link>
              </li>
            ))}
          </ul>
        </EmptyState>
      ) : (
        <>
          <div className="mb-4 flex flex-wrap items-start justify-between gap-3">
            <p className="min-w-0 flex-1 text-sm font-medium text-text" aria-live="polite">
              {verdict}
            </p>
            <ActionRow>
              <AiPromptGenerator config={promptConfig} />
              <ExportButton filename="team-health" markdown={markdown} clipboardText={markdown} />
            </ActionRow>
          </div>

          <div className="mb-6 grid grid-cols-1 gap-3 sm:grid-cols-2 sm:gap-4 lg:grid-cols-3">
            {kpis.map((k) => (
              <KpiCard key={k.id} kpi={k} icon={ICON[k.id]} />
            ))}
          </div>

          <SectionCard title="Traffic lights" className="mb-6 border-border bg-surface-deep">
            <ul className="mb-5 flex flex-wrap gap-4" aria-label="Each KPI's light">
              {kpis.map((k) => (
                <li key={k.id} className="flex w-20 flex-col items-center gap-2">
                  <TrafficCircle status={k.status} labelled />
                  <span className="text-center text-xs leading-tight text-sub">{k.name}</span>
                </li>
              ))}
            </ul>
            <div
              className={cn(
                "flex flex-col items-start justify-between gap-3 rounded-xl border p-4 sm:flex-row sm:items-center",
                overall.status ? STATUS_SURFACE[overall.status] : "border-border bg-surface"
              )}
            >
              <div>
                <p className="text-xs uppercase tracking-wider text-sub">Overall</p>
                <p className="text-xs text-sub">
                  {overall.counted === 0
                    ? "No KPI has a light yet."
                    : `Average of ${overall.counted} ${overall.counted === 1 ? "KPI" : "KPIs"} (green 100, amber 50, red 0)${
                        overall.counted < overall.total
                          ? `; ${overall.total - overall.counted} without data`
                          : ""
                      }.`}
                </p>
              </div>
              {overall.score !== null && overall.status && (
                <div className="flex items-center gap-3">
                  <TrafficCircle status={overall.status} size="lg" />
                  <div className="text-right">
                    <p
                      className={cn(
                        "font-data text-4xl font-bold leading-none",
                        STATUS_TEXT[overall.status]
                      )}
                    >
                      {overall.score}%
                    </p>
                    <p className={cn("mt-1 text-sm", STATUS_TEXT[overall.status])}>
                      {STATUS_LABEL[overall.status]}
                    </p>
                  </div>
                </div>
              )}
            </div>
          </SectionCard>

          <SectionCard
            title="Thresholds and windows"
            icon={SlidersHorizontal}
            className="mb-6 border-border bg-surface-deep"
          >
            <p className="mb-3 text-xs text-sub">
              Where each light turns amber and red, for your team. The agent&apos;s summary uses the
              same limits.
            </p>
            <ThresholdsForm
              key={formKey}
              settings={settings}
              custom={!isDefaultSettings(settings)}
              onSave={saveSettings}
              onReset={resetSettings}
              onUndoReset={undoReset}
            />
          </SectionCard>

          <div className="mb-6">
            <DashboardAdvanced kpis={kpis} signals={signals} />
          </div>
        </>
      )}

      <FullInsightsPanel />
    </ToolPageWrapper>
  );
}
