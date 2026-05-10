"use client";

import { useMemo } from "react";
import {
  RadarChart,
  PolarGrid,
  PolarAngleAxis,
  PolarRadiusAxis,
  Radar,
  Tooltip,
} from "recharts";
import { ToolPageWrapper } from "@/components/layout/tool-page-wrapper";
import { ExportButton } from "@/components/shared/export-button";
import { AiPromptGenerator } from "@/components/shared/ai-prompt-generator";
import { ActionRow } from "@/components/shared/action-row";
import { SectionCard } from "@/components/shared/section-card";
import { ChartCard } from "@/components/shared/chart-card";
import { CalloutAlert } from "@/components/shared/callout-alert";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Slider } from "@/components/ui/slider";
import { Layers, ChevronRight, Save, RotateCcw } from "lucide-react";
import { chartTheme } from "@/components/charts/chart-theme";
import { generatePlatformMaturityPrompts } from "@/lib/ai-prompts/platform-maturity";
import { usePersisted } from "@/lib/utils/use-persisted";
import { useHistoryLogger } from "@/lib/history/use-history-logger";
import { PLATFORM_MATURITY_ACTIONS } from "@/lib/history/event-actions";
import { useShallow } from "zustand/react/shallow";
import { useWorkspaceStore } from "@/lib/stores/workspace-store";
import type { Workspace } from "@/lib/stores/workspace-types";

type DimensionId =
  | "goldenPaths"
  | "internalDevPlatform"
  | "runbookHygiene"
  | "onCallMaturity"
  | "selfServiceProvisioning"
  | "observabilityDefaults"
  | "deploymentAutomation"
  | "cognitiveLoadReduction";

interface DimensionDef {
  id: DimensionId;
  label: string;
  /** Brief next-level criteria, indexed by the level the team would
   *  be "leveling up to" (1-5). e.g. nextLevelCriteria[3] is the
   *  description of what L3 looks like for that dimension. */
  nextLevelCriteria: Record<2 | 3 | 4 | 5, string>;
}

const DIMENSIONS: DimensionDef[] = [
  {
    id: "goldenPaths",
    label: "Golden paths",
    nextLevelCriteria: {
      2: "Document the recommended path for one common task; engineers can find it.",
      3: "≥3 golden paths exist with starter templates; ≥50% of new services use them.",
      4: "Golden paths are treated as products with owners; usage is tracked.",
      5: "Engineers default to golden paths; deviations require justification.",
    },
  },
  {
    id: "internalDevPlatform",
    label: "Internal Developer Platform",
    nextLevelCriteria: {
      2: "Some shared tooling exists ad hoc; teams cobble it together.",
      3: "An IDP MVP serves the most common dev workflows.",
      4: "IDP has a roadmap, owners, and SLAs; ≥75% of teams adopt it.",
      5: "IDP is the obvious default; bypassing it is rare and tracked.",
    },
  },
  {
    id: "runbookHygiene",
    label: "Runbook hygiene",
    nextLevelCriteria: {
      2: "Some services have runbooks; quality varies wildly.",
      3: "Every on-call service has a runbook; reviewed yearly.",
      4: "Runbooks are reviewed quarterly; freshness is tracked.",
      5: "Runbook quality is measured (drill outcomes, time-to-page-resolution).",
    },
  },
  {
    id: "onCallMaturity",
    label: "On-call maturity",
    nextLevelCriteria: {
      2: "Rotation exists; expectations vary by team.",
      3: "Standardized handover; alerts have actionable runbook links.",
      4: "Page volume is tracked; toil is regularly cleaned up.",
      5: "On-call is sustainable: low page volume, high signal, fast resolution.",
    },
  },
  {
    id: "selfServiceProvisioning",
    label: "Self-service provisioning",
    nextLevelCriteria: {
      2: "Provisioning takes hours-days, requires platform team.",
      3: "Common resources can be self-served via templates / IaC.",
      4: "Most resources are self-serve in <1 hour; cost is shown up-front.",
      5: "Self-serve covers >90% of needs; platform team handles only edge cases.",
    },
  },
  {
    id: "observabilityDefaults",
    label: "Observability defaults",
    nextLevelCriteria: {
      2: "Logs/metrics exist but quality varies; tracing is sporadic.",
      3: "Default dashboards + structured logs ship with every service.",
      4: "Distributed tracing is the norm; SLOs are defined for tier-1 services.",
      5: "Observability quality gates exist; missing telemetry blocks deploys.",
    },
  },
  {
    id: "deploymentAutomation",
    label: "Deployment automation",
    nextLevelCriteria: {
      2: "Pipelines exist; some manual steps remain.",
      3: "Push-button deploys for most services; rollbacks are practiced.",
      4: "Trunk-based + progressive delivery (canary, feature flags) common.",
      5: "Deploys are continuous, low-risk, and routinely safe to do mid-day.",
    },
  },
  {
    id: "cognitiveLoadReduction",
    label: "Cognitive load reduction",
    nextLevelCriteria: {
      2: "Onboarding takes weeks; engineers rely on tribal knowledge.",
      3: "Onboarding has a defined path; common tasks are documented.",
      4: "Engineers can ship to production within their first week.",
      5: "Team topologies and platform abstractions are deliberately tuned to reduce load.",
    },
  },
];

interface PlatformAssessment {
  dimensions: Record<string, number>;
  /** Per-dimension free-text notes — described in the spec. */
  notes: Record<string, string>;
}

const DEFAULT_STATE: PlatformAssessment = {
  dimensions: Object.fromEntries(DIMENSIONS.map((d) => [d.id, 1])),
  notes: {},
};

export function PlatformMaturityClient() {
  const [state, setState] = usePersisted<PlatformAssessment>(
    "agile-toolkit:platform-maturity",
    DEFAULT_STATE
  );
  const { log } = useHistoryLogger("platform-maturity");

  const setScore = (id: DimensionId, score: number) => {
    setState((s) => ({
      ...s,
      dimensions: { ...s.dimensions, [id]: score },
    }));
    log(PLATFORM_MATURITY_ACTIONS.RATING_CHANGED, {
      dimension: id,
      score,
    });
  };

  const setNote = (id: DimensionId, note: string) => {
    setState((s) => ({
      ...s,
      notes: { ...s.notes, [id]: note },
    }));
  };

  const saveAssessment = () => {
    // Use the same clamp as the radar / KPI so the snapshot matches what's
    // shown on screen (corrupt imports can't poison the avg).
    const clamped = DIMENSIONS.map((d) =>
      Math.min(5, Math.max(1, state.dimensions[d.id] ?? 1))
    );
    log(
      PLATFORM_MATURITY_ACTIONS.ASSESSMENT_SAVED,
      {
        avg: clamped.reduce((a, v) => a + v, 0) / DIMENSIONS.length,
        dimensions: { ...state.dimensions },
        notes: { ...state.notes },
      },
      { milestone: true }
    );
  };

  const resetAssessment = () => {
    setState(DEFAULT_STATE);
    log(PLATFORM_MATURITY_ACTIONS.PLATFORM_RESET, {});
  };

  // Clamp persisted scores into [1, 5] at read time so a corrupted import
  // can't push the radar dataKey out-of-domain (would render an empty axis).
  const radarData = useMemo(
    () =>
      DIMENSIONS.map((d) => ({
        subject: d.label,
        value: Math.min(5, Math.max(1, state.dimensions[d.id] ?? 1)),
        fullMark: 5,
      })),
    [state.dimensions]
  );

  const avg = useMemo(
    () =>
      DIMENSIONS.reduce(
        (a, d) => a + Math.min(5, Math.max(1, state.dimensions[d.id] ?? 1)),
        0
      ) / DIMENSIONS.length,
    [state.dimensions]
  );

  const roadmap = useMemo(
    () =>
      DIMENSIONS.map((d) => {
        const cur = Math.min(5, Math.max(1, state.dimensions[d.id] ?? 1));
        if (cur >= 3) return null;
        // The "next level" we'd target is cur + 1 (clamped to 5).
        const nextLevel = Math.min(5, cur + 1) as 2 | 3 | 4 | 5;
        return { dim: d, current: cur, nextLevel, criteria: d.nextLevelCriteria[nextLevel] };
      }).filter((x): x is NonNullable<typeof x> => x !== null),
    [state.dimensions]
  );

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

  const promptConfig = useMemo(
    () => ({
      toolName: "Platform Engineering Maturity",
      prompts: generatePlatformMaturityPrompts(
        {
          dimensions: DIMENSIONS.map((d) => ({
            id: d.id,
            label: d.label,
            score: Math.min(5, Math.max(1, state.dimensions[d.id] ?? 1)),
            description: state.notes[d.id]?.trim() || undefined,
          })),
        },
        workspace
      ),
    }),
    [state.dimensions, state.notes, workspace]
  );

  return (
    <ToolPageWrapper
      toolId="platform-maturity"
      title="Platform Engineering Maturity"
      description="Self-assess across 8 platform-engineering dimensions, visualise on a radar, and surface a roadmap for the weakest areas."
      category="Engineering Excellence"
    >
      <ActionRow>
        <AiPromptGenerator config={promptConfig} />
        <ExportButton
          filename="platform-maturity"
          csvData={{
            headers: ["Dimension", "Score", "Description"],
            rows: DIMENSIONS.map((d) => [
              d.label,
              Math.min(5, Math.max(1, state.dimensions[d.id] ?? 1)),
              state.notes[d.id] ?? "",
            ]),
          }}
          jsonData={state}
        />
        <Button
          variant="outline"
          size="sm"
          onClick={saveAssessment}
          className="gap-2 border-border hover:border-accent/40 text-sub hover:text-accent"
        >
          <Save className="w-4 h-4" aria-hidden="true" />
          Save snapshot
        </Button>
        <Button
          variant="outline"
          size="sm"
          onClick={resetAssessment}
          className="gap-2 border-border hover:border-danger/40 text-sub hover:text-danger"
        >
          <RotateCcw className="w-4 h-4" aria-hidden="true" />
          Reset
        </Button>
      </ActionRow>

      <CalloutAlert tone="info" className="mb-4">
        Average maturity:{" "}
        <span className="font-data text-text">{avg.toFixed(2)}</span> / 5 across
        {" "}
        {DIMENSIONS.length} dimensions. Click <strong>Save snapshot</strong> to
        log this assessment to history.
      </CalloutAlert>

      <div className="grid grid-cols-1 xl:grid-cols-2 gap-6">
        <SectionCard title="Dimension scores" icon={Layers} titleSize="lg">
          <div className="space-y-5">
            {DIMENSIONS.map((d) => {
              const score = Math.min(5, Math.max(1, state.dimensions[d.id] ?? 1));
              return (
                <div key={d.id} className="space-y-2">
                  <div className="flex items-center justify-between">
                    <span className="text-sm font-medium text-text">
                      {d.label}
                    </span>
                    <span className="text-xs font-data text-accent">
                      {score} / 5
                    </span>
                  </div>
                  <Slider
                    min={1}
                    max={5}
                    step={1}
                    value={[score]}
                    onValueChange={(vals) => setScore(d.id, vals[0] ?? 1)}
                    className="w-full"
                    aria-label={`${d.label} maturity score`}
                  />
                  <div>
                    <Label
                      htmlFor={`platform-note-${d.id}`}
                      className="text-xs text-sub sr-only"
                    >
                      {d.label} description
                    </Label>
                    <Input
                      id={`platform-note-${d.id}`}
                      value={state.notes[d.id] ?? ""}
                      onChange={(e) => setNote(d.id, e.target.value)}
                      placeholder="Brief description / evidence (optional)"
                      className="bg-surface border-border text-xs"
                    />
                  </div>
                </div>
              );
            })}
          </div>
        </SectionCard>

        <ChartCard title="Maturity radar" height={360}>
          <RadarChart
            data={radarData}
            margin={{ top: 16, right: 24, bottom: 16, left: 24 }}
          >
            <PolarGrid stroke={chartTheme.gridColor} />
            <PolarAngleAxis
              dataKey="subject"
              tick={{ fill: chartTheme.axisColor, fontSize: 10 }}
            />
            <PolarRadiusAxis
              angle={90}
              domain={[0, 5]}
              tick={{ fill: chartTheme.axisColor, fontSize: 10 }}
            />
            <Radar
              name="Maturity"
              dataKey="value"
              stroke={chartTheme.colors.cyan}
              fill={chartTheme.colors.cyan}
              fillOpacity={0.2}
              strokeWidth={2}
            />
            <Tooltip contentStyle={chartTheme.tooltipStyle} />
          </RadarChart>
        </ChartCard>
      </div>

      <SectionCard
        title="Improvement roadmap"
        icon={ChevronRight}
        titleSize="lg"
        className="mt-6"
      >
        {roadmap.length === 0 ? (
          <p className="text-sm text-sub">
            All 8 dimensions are at level 3 or above — nice work. Raise the bar
            by lifting any dimension towards level 4 or 5.
          </p>
        ) : (
          <div className="space-y-3">
            {roadmap.map(({ dim, current, nextLevel, criteria }) => (
              <div
                key={dim.id}
                className="rounded-lg border border-border bg-surface p-3"
              >
                <div className="flex items-start gap-2 flex-wrap">
                  <ChevronRight
                    className="w-4 h-4 text-accent shrink-0 mt-0.5"
                    aria-hidden="true"
                  />
                  <div className="min-w-0 flex-1">
                    <div className="text-sm font-medium text-text">
                      {dim.label}{" "}
                      <span className="text-xs text-sub font-normal">
                        (level {current} → {nextLevel})
                      </span>
                    </div>
                    <p className="text-xs text-sub mt-1 leading-relaxed">
                      {criteria}
                    </p>
                  </div>
                </div>
              </div>
            ))}
          </div>
        )}
      </SectionCard>
    </ToolPageWrapper>
  );
}
