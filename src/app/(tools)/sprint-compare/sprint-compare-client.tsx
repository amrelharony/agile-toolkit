"use client";

import { useRef, useMemo } from "react";
import { create } from "zustand";
import { persist } from "zustand/middleware";
import {
  RadarChart,
  Radar,
  PolarGrid,
  PolarAngleAxis,
  PolarRadiusAxis,
  Legend,
  Tooltip,
} from "recharts";
import { ToolPageWrapper } from "@/components/layout/tool-page-wrapper";
import { ExportButton } from "@/components/shared/export-button";
import { AiPromptGenerator } from "@/components/shared/ai-prompt-generator";
import { generateSprintComparePrompts } from "@/lib/ai-prompts/sprint-compare";
import { useHistoryLogger } from "@/lib/history/use-history-logger";
import { SPRINT_COMPARE_ACTIONS } from "@/lib/history/event-actions";
import { Button } from "@/components/ui/button";
import { SectionCard } from "@/components/shared/section-card";
import { ChartCard } from "@/components/shared/chart-card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Plus, Trash2, GitCompare } from "lucide-react";
import { parseHex } from "@/lib/utils";

/* -------------------------------------------------------------------------- */
/*  Constants                                                                 */
/* -------------------------------------------------------------------------- */

const CHART_COLORS = ["#00f0ff", "#ff00aa", "#00ff88", "#ffaa00", "#8b5cf6"] as const;

const DIMENSIONS = [
  "Velocity",
  "Quality",
  "Scope Stability",
  "Team Happiness",
  "Goal Achievement",
  "Predictability",
] as const;

type Dimension = (typeof DIMENSIONS)[number];

const MAX_SPRINTS = 5;

/* -------------------------------------------------------------------------- */
/*  Types                                                                     */
/* -------------------------------------------------------------------------- */

type DimensionScores = Record<Dimension, number>;

interface SprintEntry {
  id: string;
  name: string;
  scores: DimensionScores;
}

interface SprintCompareStore {
  sprints: SprintEntry[];
  addSprint: () => void;
  removeSprint: (id: string) => void;
  updateSprint: (id: string, updates: Partial<Pick<SprintEntry, "name">>) => void;
  updateScore: (id: string, dimension: Dimension, value: number) => void;
  reset: () => void;
}

/* -------------------------------------------------------------------------- */
/*  Helpers                                                                  */
/* -------------------------------------------------------------------------- */

function defaultScores(): DimensionScores {
  return {
    Velocity: 7,
    Quality: 6,
    "Scope Stability": 8,
    "Team Happiness": 7,
    "Goal Achievement": 8,
    Predictability: 6,
  };
}

function createSprint(name: string): SprintEntry {
  return {
    id: crypto.randomUUID(),
    name,
    scores: defaultScores(),
  };
}

const DEFAULT_SPRINTS: SprintEntry[] = [
  {
    id: "sp1",
    name: "Sprint 1",
    scores: {
      Velocity: 7,
      Quality: 6,
      "Scope Stability": 8,
      "Team Happiness": 7,
      "Goal Achievement": 8,
      Predictability: 6,
    },
  },
  {
    id: "sp2",
    name: "Sprint 2",
    scores: {
      Velocity: 8,
      Quality: 7,
      "Scope Stability": 6,
      "Team Happiness": 8,
      "Goal Achievement": 9,
      Predictability: 7,
    },
  },
];

/* -------------------------------------------------------------------------- */
/*  Store                                                                     */
/* -------------------------------------------------------------------------- */

const useSprintCompareStore = create<SprintCompareStore>()(
  persist(
    (set) => ({
      sprints: DEFAULT_SPRINTS,

      addSprint: () =>
        set((s) => {
          if (s.sprints.length >= MAX_SPRINTS) return s;
          return {
            sprints: [
              ...s.sprints,
              createSprint(`Sprint ${s.sprints.length + 1}`),
            ],
          };
        }),

      removeSprint: (id) =>
        set((s) => ({
          sprints: s.sprints.filter((sp) => sp.id !== id),
        })),

      updateSprint: (id, updates) =>
        set((s) => ({
          sprints: s.sprints.map((sp) =>
            sp.id === id ? { ...sp, ...updates } : sp
          ),
        })),

      updateScore: (id, dimension, value) =>
        set((s) => ({
          sprints: s.sprints.map((sp) =>
            sp.id === id
              ? { ...sp, scores: { ...sp.scores, [dimension]: value } }
              : sp
          ),
        })),

      reset: () => set({ sprints: DEFAULT_SPRINTS }),
    }),
    { name: "agile-toolkit:sprint-compare" }
  )
);

/* -------------------------------------------------------------------------- */
/*  Score cell with color intensity                                           */
/* -------------------------------------------------------------------------- */

function ScoreCell({
  value,
  color,
}: {
  value: number;
  color: string;
}) {
  const intensity = value / 10;
  const { r, g, b } = parseHex(color);
  return (
    <td
      className="px-4 py-2 text-center text-sm font-data font-semibold"
      style={{
        background: `rgba(${r},${g},${b},${intensity * 0.25})`,
        color: value >= 7 ? color : "#94a3b8",
        borderBottom: "1px solid rgba(255,255,255,0.05)",
      }}
    >
      {value}
    </td>
  );
}

const TOOLTIP_STYLE = {
  backgroundColor: "#1a1f36",
  border: "1px solid rgba(255,255,255,0.1)",
  borderRadius: "8px",
  color: "#e2e8f0",
};

/* -------------------------------------------------------------------------- */
/*  Main component                                                            */
/* -------------------------------------------------------------------------- */

export function SprintCompareClient() {
  const {
    sprints,
    addSprint: addSprintRaw,
    removeSprint: removeSprintRaw,
    updateSprint,
    updateScore,
    reset: resetRaw,
  } = useSprintCompareStore();
  const { log } = useHistoryLogger("sprint-compare");

  const addSprint = () => {
    addSprintRaw();
    const list = useSprintCompareStore.getState().sprints;
    const created = list[list.length - 1];
    log(SPRINT_COMPARE_ACTIONS.SPRINT_PINNED, {
      sprintId: created?.id,
      name: created?.name,
    });
  };
  const removeSprint: typeof removeSprintRaw = (id) => {
    const sprint = sprints.find((s) => s.id === id);
    removeSprintRaw(id);
    log(SPRINT_COMPARE_ACTIONS.SPRINT_UNPINNED, {
      sprintId: id,
      name: sprint?.name,
    });
  };
  const reset = () => {
    resetRaw();
    log(SPRINT_COMPARE_ACTIONS.COMPARE_RESET, {});
  };

  const exportRef = useRef<HTMLDivElement>(null);

  /* -- Build radar chart data ---------------------------------------------- */

  const radarData = useMemo(
    () =>
      DIMENSIONS.map((dim) => {
        const entry: Record<string, string | number> = { dimension: dim };
        sprints.forEach((sp) => {
          // Use id as key to prevent collision when two sprints share the same name
          entry[sp.id] = sp.scores[dim];
        });
        return entry;
      }),
    [sprints]
  );

  /* -- Export data --------------------------------------------------------- */

  const jsonData = useMemo(
    () => ({
      sprints: sprints.map((sp) => ({ name: sp.name, scores: sp.scores })),
    }),
    [sprints]
  );

  const promptConfig = useMemo(() => ({
    toolName: "Sprint Comparison",
    prompts: generateSprintComparePrompts({ sprints: sprints.map((s) => ({ name: s.name, scores: s.scores })) }),
  }), [sprints]);

  /* -- Render -------------------------------------------------------------- */

  return (
    <ToolPageWrapper
      toolId="sprint-compare"
      title="Sprint Comparison"
      description="Compare sprints across 6 key dimensions using a radar chart."
      category="Metrics & Dashboards"
    >
      <div ref={exportRef} className="space-y-6">

        {/* ---- Radar Chart ---- */}
        <ChartCard
          title="Sprint Radar"
          icon={GitCompare}
          height={400}
          headerExtras={
            <>
              <AiPromptGenerator config={promptConfig} />
              <ExportButton
                filename="sprint-comparison"
                jsonData={jsonData}
                targetRef={exportRef}
              />
            </>
          }
        >
          <RadarChart data={radarData} margin={{ top: 10, right: 30, left: 30, bottom: 10 }}>
            <PolarGrid stroke="rgba(255,255,255,0.1)" />
            <PolarAngleAxis
              dataKey="dimension"
              tick={{ fill: "#94a3b8", fontSize: 12 }}
            />
            <PolarRadiusAxis
              domain={[0, 10]}
              tick={{ fill: "#94a3b8", fontSize: 10 }}
              tickCount={6}
              stroke="rgba(255,255,255,0.05)"
            />
            <Tooltip contentStyle={TOOLTIP_STYLE} />
            {sprints.map((sp, i) => (
              <Radar
                key={sp.id}
                name={sp.name}
                dataKey={sp.id}
                stroke={CHART_COLORS[i % CHART_COLORS.length]}
                fill={CHART_COLORS[i % CHART_COLORS.length]}
                fillOpacity={0.15}
                strokeWidth={2}
              />
            ))}
            <Legend
              wrapperStyle={{ paddingTop: "12px", color: "#94a3b8", fontSize: 12 }}
            />
          </RadarChart>
        </ChartCard>

        {/* ---- Score Input ---- */}
        <SectionCard
          title="Sprint Scores"
          titleSize="lg"
          headerClassName="pb-4"
          contentClassName="space-y-6"
          actions={
            <>
              <Button
                variant="danger-ghost"
                size="sm"
                onClick={reset}
              >
                Reset
              </Button>
              <Button
                size="sm"
                variant="toolkit"
                onClick={addSprint}
                disabled={sprints.length >= MAX_SPRINTS}
                className="gap-1.5"
              >
                <Plus className="w-4 h-4" />
                Add Sprint
              </Button>
            </>
          }
        >
            {sprints.map((sp, idx) => {
              const color = CHART_COLORS[idx % CHART_COLORS.length];
              return (
                <div key={sp.id} className="space-y-3">
                  {/* Sprint header */}
                  <div className="flex items-center gap-3">
                    <div
                      className="w-3 h-3 rounded-full flex-shrink-0"
                      style={{ background: color }}
                    />
                    <Input
                      value={sp.name}
                      onChange={(e) => updateSprint(sp.id, { name: e.target.value })}
                      className="input-toolkit focus:ring-accent/20 max-w-xs"
                    />
                    <Button
                      variant="danger-ghost"
                      size="icon"
                      disabled={sprints.length <= 1}
                      onClick={() => removeSprint(sp.id)}
                      className="min-touch-coarse h-8 w-8 disabled:opacity-30 ml-auto"
                    >
                      <Trash2 className="w-4 h-4" />
                    </Button>
                  </div>

                  {/* Dimension scores */}
                  <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-6 gap-3">
                    {DIMENSIONS.map((dim) => (
                      <div key={dim} className="space-y-1.5">
                        <Label className="text-sub text-xs leading-tight block">
                          {dim}
                        </Label>
                        <Input
                          type="number"
                          min={1}
                          max={10}
                          value={sp.scores[dim]}
                          onChange={(e) =>
                            updateScore(
                              sp.id,
                              dim,
                              Math.min(10, Math.max(1, Number(e.target.value)))
                            )
                          }
                          className="bg-surface-deep border-border text-text font-data focus:ring-0"
                          style={{
                            borderColor: `${color}40`,
                          }}
                        />
                      </div>
                    ))}
                  </div>
                </div>
              );
            })}
        </SectionCard>

        {/* ---- Comparison Table ---- */}
        <SectionCard
          title="Dimension Comparison"
          titleSize="lg"
          headerClassName="pb-4"
          contentClassName="overflow-x-auto"
        >
            <table className="w-full text-sm">
              <thead>
                <tr>
                  <th className="text-left px-4 py-2 text-sub font-medium text-xs uppercase tracking-wider border-b border-border">
                    Dimension
                  </th>
                  {sprints.map((sp, i) => (
                    <th
                      key={sp.id}
                      className="px-4 py-2 text-center text-xs font-medium uppercase tracking-wider border-b border-border"
                      style={{ color: CHART_COLORS[i % CHART_COLORS.length] }}
                    >
                      {sp.name}
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {DIMENSIONS.map((dim) => (
                  <tr key={dim} className="hover:bg-card-hover">
                    <td className="px-4 py-2 text-sub text-sm border-b border-border">
                      {dim}
                    </td>
                    {sprints.map((sp, i) => (
                      <ScoreCell
                        key={sp.id}
                        value={sp.scores[dim]}
                        color={CHART_COLORS[i % CHART_COLORS.length]}
                      />
                    ))}
                  </tr>
                ))}
                {/* Average row */}
                <tr className="bg-card-hover">
                  <td className="px-4 py-2 text-text font-semibold text-sm">
                    Average
                  </td>
                  {sprints.map((sp, i) => {
                    const avg =
                      DIMENSIONS.reduce((sum, d) => sum + sp.scores[d], 0) /
                      DIMENSIONS.length;
                    return (
                      <td
                        key={sp.id}
                        className="px-4 py-2 text-center text-sm font-data font-bold"
                        style={{ color: CHART_COLORS[i % CHART_COLORS.length] }}
                      >
                        {avg.toFixed(1)}
                      </td>
                    );
                  })}
                </tr>
              </tbody>
            </table>
        </SectionCard>
      </div>
    </ToolPageWrapper>
  );
}
