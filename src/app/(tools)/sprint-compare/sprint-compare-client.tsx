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
  ResponsiveContainer,
  Tooltip,
} from "recharts";
import { ToolPageWrapper } from "@/components/layout/tool-page-wrapper";
import { ExportButton } from "@/components/shared/export-button";
import { AiPromptGenerator } from "@/components/shared/ai-prompt-generator";
import { generateSprintComparePrompts } from "@/lib/ai-prompts/sprint-compare";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Plus, Trash2, GitCompare } from "lucide-react";

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
  // Parse hex color to use in rgba
  const r = parseInt(color.slice(1, 3), 16);
  const g = parseInt(color.slice(3, 5), 16);
  const b = parseInt(color.slice(5, 7), 16);
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
  const { sprints, addSprint, removeSprint, updateSprint, updateScore, reset } =
    useSprintCompareStore();

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
      title="Sprint Comparison"
      description="Compare sprints across 6 key dimensions using a radar chart."
      category="Metrics & Dashboards"
    >
      <div ref={exportRef} className="space-y-6">

        {/* ---- Radar Chart ---- */}
        <Card className="bg-surface border-border">
          <CardHeader className="pb-2">
            <div className="flex items-center justify-between">
              <CardTitle className="flex items-center gap-2 text-lg font-display text-text">
                <GitCompare className="w-5 h-5 text-accent" />
                Sprint Radar
              </CardTitle>
              <div className="flex items-center gap-2">
                <AiPromptGenerator config={promptConfig} />
                <ExportButton
                  filename="sprint-comparison"
                  jsonData={jsonData}
                  targetRef={exportRef}
                />
              </div>
            </div>
          </CardHeader>
          <CardContent>
            <ResponsiveContainer width="100%" height={400}>
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
            </ResponsiveContainer>
          </CardContent>
        </Card>

        {/* ---- Score Input ---- */}
        <Card className="bg-surface border-border">
          <CardHeader className="pb-4">
            <div className="flex items-center justify-between">
              <CardTitle className="text-lg font-display text-text">
                Sprint Scores
              </CardTitle>
              <div className="flex items-center gap-2">
                <Button
                  variant="ghost"
                  size="sm"
                  onClick={reset}
                  className="text-sub hover:text-red-400 hover:bg-red-400/10"
                >
                  Reset
                </Button>
                <Button
                  size="sm"
                  onClick={addSprint}
                  disabled={sprints.length >= MAX_SPRINTS}
                  className="gap-1.5 bg-accent/10 text-accent border border-accent/20 hover:bg-accent/20 hover:border-accent/40 disabled:opacity-40"
                >
                  <Plus className="w-4 h-4" />
                  Add Sprint
                </Button>
              </div>
            </div>
          </CardHeader>
          <CardContent className="space-y-6">
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
                      className="bg-surface-deep border-border text-text focus:border-accent/50 focus:ring-accent/20 max-w-xs"
                    />
                    <Button
                      variant="ghost"
                      size="icon"
                      disabled={sprints.length <= 1}
                      onClick={() => removeSprint(sp.id)}
                      className="h-8 w-8 text-sub hover:text-red-400 hover:bg-red-400/10 disabled:opacity-30 ml-auto"
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
          </CardContent>
        </Card>

        {/* ---- Comparison Table ---- */}
        <Card className="bg-surface border-border">
          <CardHeader className="pb-4">
            <CardTitle className="text-lg font-display text-text">
              Dimension Comparison
            </CardTitle>
          </CardHeader>
          <CardContent className="overflow-x-auto">
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
          </CardContent>
        </Card>
      </div>
    </ToolPageWrapper>
  );
}
