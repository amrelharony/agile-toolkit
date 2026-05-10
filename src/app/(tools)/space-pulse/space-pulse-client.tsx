"use client";

import { useMemo, useState } from "react";
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
import { KpiGrid } from "@/components/shared/kpi-grid";
import { StatCard } from "@/components/shared/stat-card";
import { SectionCard } from "@/components/shared/section-card";
import { ChartCard } from "@/components/shared/chart-card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Slider } from "@/components/ui/slider";
import { Plus, Trash2, ArrowUp, ArrowDown, Minus } from "lucide-react";
import { chartTheme } from "@/components/charts/chart-theme";
import { generateSpacePrompts } from "@/lib/ai-prompts/space-pulse";
import { usePersisted } from "@/lib/utils/use-persisted";
import { useHistoryLogger } from "@/lib/history/use-history-logger";
import { SPACE_ACTIONS } from "@/lib/history/event-actions";
import { toast } from "@/lib/utils/toast";
import { useWorkspaceStore } from "@/lib/stores/workspace-store";
import type { Workspace } from "@/lib/stores/workspace-types";

// Quarter must be `YYYY-Q[1-4]` so localeCompare yields chronological order.
// Anything else slips through, but we warn the user at write-time.
const QUARTER_FORMAT = /^\d{4}-Q[1-4]$/;

type SpaceDimensionKey =
  | "satisfaction"
  | "performance"
  | "activity"
  | "communication"
  | "efficiency";

interface SpaceScore {
  id: string;
  quarter: string;
  satisfaction: number; // 1-5
  performance: number;
  activity: number;
  communication: number;
  efficiency: number;
  description?: string;
}

interface SpaceState {
  scores: SpaceScore[];
}

const DEFAULT_STATE: SpaceState = { scores: [] };

const DIMENSIONS: { key: SpaceDimensionKey; label: string }[] = [
  { key: "satisfaction", label: "Satisfaction" },
  { key: "performance", label: "Performance" },
  { key: "activity", label: "Activity" },
  { key: "communication", label: "Communication" },
  { key: "efficiency", label: "Efficiency" },
];

function defaultQuarter(): string {
  const d = new Date();
  const q = Math.floor(d.getMonth() / 3) + 1;
  return `${d.getFullYear()}-Q${q}`;
}

interface DraftState {
  quarter: string;
  satisfaction: number;
  performance: number;
  activity: number;
  communication: number;
  efficiency: number;
  description: string;
}

function makeDraft(): DraftState {
  return {
    quarter: defaultQuarter(),
    satisfaction: 3,
    performance: 3,
    activity: 3,
    communication: 3,
    efficiency: 3,
    description: "",
  };
}

export function SpacePulseClient() {
  const [state, setState] = usePersisted<SpaceState>(
    "agile-toolkit:space-pulse",
    DEFAULT_STATE
  );
  const [draft, setDraft] = useState<DraftState>(makeDraft);
  const { log } = useHistoryLogger("space-pulse");

  const addScore = () => {
    const quarter = draft.quarter.trim();
    if (!quarter) return;
    if (!QUARTER_FORMAT.test(quarter)) {
      toast.warning(
        "Quarter should be formatted as YYYY-Q1..Q4 (e.g. 2026-Q1) — sort order may be off otherwise.",
      );
    }
    const score: SpaceScore = {
      id: crypto.randomUUID(),
      quarter,
      satisfaction: draft.satisfaction,
      performance: draft.performance,
      activity: draft.activity,
      communication: draft.communication,
      efficiency: draft.efficiency,
      description: draft.description.trim() || undefined,
    };
    // De-dup: replace an existing entry for the same quarter so users don't
    // end up with two pulses for 2026-Q1 (the radar would silently show the
    // last-added one and the trend chip would compare against itself).
    const existingIdx = state.scores.findIndex((x) => x.quarter === quarter);
    if (existingIdx >= 0) {
      setState((s) => ({
        scores: s.scores.map((x) => (x.quarter === quarter ? score : x)),
      }));
      toast.warning(`Replaced existing entry for ${quarter}`);
    } else {
      setState((s) => ({ scores: [...s.scores, score] }));
    }
    log(SPACE_ACTIONS.SCORE_LOGGED, {
      scoreId: score.id,
      quarter: score.quarter,
      satisfaction: score.satisfaction,
      performance: score.performance,
      activity: score.activity,
      communication: score.communication,
      efficiency: score.efficiency,
      description: score.description,
    });
    setDraft(makeDraft());
  };

  const removeScore = (id: string) => {
    const score = state.scores.find((s) => s.id === id);
    setState((s) => ({ scores: s.scores.filter((x) => x.id !== id) }));
    log(SPACE_ACTIONS.SCORE_REMOVED, {
      scoreId: id,
      quarter: score?.quarter,
      description: score?.description,
    });
  };

  const sorted = useMemo(
    () => [...state.scores].sort((a, b) => a.quarter.localeCompare(b.quarter)),
    [state.scores]
  );
  const latest = sorted[sorted.length - 1];
  const prior = sorted.length >= 2 ? sorted[sorted.length - 2] : undefined;

  const radarData = useMemo(() => {
    if (!latest) {
      return DIMENSIONS.map((d) => ({ subject: d.label, value: 0, fullMark: 5 }));
    }
    return DIMENSIONS.map((d) => ({
      subject: d.label,
      value: latest[d.key],
      fullMark: 5,
    }));
  }, [latest]);

  const workspace = useWorkspaceStore<Workspace>((s) => ({
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
  }));

  const promptConfig = useMemo(
    () => ({
      toolName: "SPACE Pulse",
      prompts: generateSpacePrompts({ scores: sorted }, workspace),
    }),
    [sorted, workspace]
  );

  return (
    <ToolPageWrapper
      toolId="space-pulse"
      title="SPACE Pulse"
      description="Self-rate the team across the SPACE framework — satisfaction, performance, activity, communication, efficiency — to surface investment areas."
      category="Engineering Excellence"
    >
      <ActionRow>
        <AiPromptGenerator config={promptConfig} />
        <ExportButton
          filename="space-pulse"
          csvData={{
            headers: [
              "Quarter",
              "Satisfaction",
              "Performance",
              "Activity",
              "Communication",
              "Efficiency",
              "Description",
            ],
            rows: sorted.map((s) => [
              s.quarter,
              s.satisfaction,
              s.performance,
              s.activity,
              s.communication,
              s.efficiency,
              s.description ?? "",
            ]),
          }}
          jsonData={state}
        />
      </ActionRow>

      {latest ? (
        <KpiGrid cols={5} gap="md">
          {DIMENSIONS.map((d) => (
            <DimensionStat
              key={d.key}
              label={d.label}
              current={latest[d.key]}
              prior={prior?.[d.key]}
            />
          ))}
        </KpiGrid>
      ) : (
        <KpiGrid cols={5} gap="md">
          {DIMENSIONS.map((d) => (
            <StatCard
              key={d.key}
              variant="compact"
              label={d.label}
              value="—"
              hint="No data"
            />
          ))}
        </KpiGrid>
      )}

      <div className="grid grid-cols-1 xl:grid-cols-2 gap-6">
        <SectionCard title="Log a quarterly pulse" icon={Plus} titleSize="lg">
          <div className="space-y-4">
            <div>
              <Label htmlFor="space-quarter" className="text-xs text-sub">
                Quarter
              </Label>
              <Input
                id="space-quarter"
                value={draft.quarter}
                onChange={(e) =>
                  setDraft((d) => ({ ...d, quarter: e.target.value }))
                }
                placeholder="2026-Q1"
                className="bg-surface border-border"
              />
            </div>
            {DIMENSIONS.map((dim) => (
              <div key={dim.key} className="space-y-2">
                <div className="flex items-center justify-between">
                  <span className="text-sm font-medium text-text">
                    {dim.label}
                  </span>
                  <span className="text-xs font-data text-accent">
                    {draft[dim.key]} / 5
                  </span>
                </div>
                <Slider
                  min={1}
                  max={5}
                  step={1}
                  value={[draft[dim.key]]}
                  onValueChange={([v]) =>
                    setDraft((d) => ({ ...d, [dim.key]: v }))
                  }
                  className="w-full"
                />
              </div>
            ))}
            <div>
              <Label htmlFor="space-desc" className="text-xs text-sub">
                Description (optional)
              </Label>
              <Textarea
                id="space-desc"
                value={draft.description}
                onChange={(e) =>
                  setDraft((d) => ({ ...d, description: e.target.value }))
                }
                placeholder="Context about the survey period..."
                rows={3}
                className="bg-surface border-border resize-none text-xs"
              />
            </div>
            <Button
              onClick={addScore}
              className="gap-2 bg-accent text-bg hover:bg-accent/90 w-full"
            >
              <Plus className="w-4 h-4" aria-hidden="true" />
              Add pulse
            </Button>
          </div>
        </SectionCard>

        <ChartCard
          title={latest ? `Radar — ${latest.quarter}` : "Radar"}
          height={360}
        >
          <RadarChart
            data={radarData}
            margin={{ top: 16, right: 24, bottom: 16, left: 24 }}
          >
            <PolarGrid stroke={chartTheme.gridColor} />
            <PolarAngleAxis
              dataKey="subject"
              tick={{ fill: chartTheme.axisColor, fontSize: 11 }}
            />
            <PolarRadiusAxis
              angle={90}
              domain={[0, 5]}
              tick={{ fill: chartTheme.axisColor, fontSize: 10 }}
            />
            <Radar
              name="SPACE"
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

      {sorted.length > 0 && (
        <SectionCard title="Pulses" titleSize="lg" className="mt-6">
          <div className="overflow-x-auto -mx-4 px-4">
            <table className="w-full text-xs min-w-[640px]">
              <thead>
                <tr className="text-left text-sub border-b border-border">
                  <th className="py-2 pr-3">Quarter</th>
                  {DIMENSIONS.map((d) => (
                    <th key={d.key} className="py-2 pr-3">
                      {d.label.slice(0, 4)}
                    </th>
                  ))}
                  <th className="py-2 pr-3">Description</th>
                  <th className="py-2 pr-3 w-10"></th>
                </tr>
              </thead>
              <tbody>
                {[...sorted].reverse().map((s) => (
                  <tr key={s.id} className="border-b border-border/40">
                    <td className="py-2 pr-3 font-data text-text">{s.quarter}</td>
                    {DIMENSIONS.map((d) => (
                      <td key={d.key} className="py-2 pr-3 font-data">
                        {s[d.key]}
                      </td>
                    ))}
                    <td className="py-2 pr-3 text-sub max-w-[260px]">
                      <span className="line-clamp-2 break-words whitespace-pre-wrap">
                        {s.description ?? "—"}
                      </span>
                    </td>
                    <td className="py-2 pr-3 text-right">
                      <Button
                        variant="ghost"
                        size="sm"
                        onClick={() => removeScore(s.id)}
                        aria-label={`Remove pulse for ${s.quarter}`}
                        className="h-7 w-7 p-0 text-sub hover:text-danger"
                      >
                        <Trash2 className="w-3.5 h-3.5" aria-hidden="true" />
                      </Button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </SectionCard>
      )}
    </ToolPageWrapper>
  );
}

/**
 * Per-dimension stat card with a trend arrow vs the prior pulse.
 *
 * Tone is set by absolute value (3+ neutral, 4+ success, ≤2 danger). The
 * trend chip uses an icon plus a colour so it's redundantly encoded for
 * users who don't perceive colour cues.
 */
function DimensionStat({
  label,
  current,
  prior,
}: {
  label: string;
  current: number;
  prior?: number;
}) {
  const delta = prior === undefined ? undefined : current - prior;
  const ArrowIcon =
    delta === undefined || delta === 0 ? Minus : delta > 0 ? ArrowUp : ArrowDown;
  const trendColor =
    delta === undefined || delta === 0
      ? "text-sub"
      : delta > 0
        ? "text-emerald-300"
        : "text-danger";
  const tone: "default" | "success" | "danger" =
    current >= 4 ? "success" : current <= 2 ? "danger" : "default";

  return (
    <StatCard
      variant="compact"
      label={label}
      value={
        <span className="inline-flex items-center gap-1.5">
          <span>{current}</span>
          <ArrowIcon className={`w-3.5 h-3.5 ${trendColor}`} aria-hidden="true" />
        </span>
      }
      tone={tone}
      hint={
        delta === undefined
          ? "First pulse"
          : delta === 0
            ? "No change"
            : `${delta > 0 ? "+" : ""}${delta} vs prior`
      }
    />
  );
}
