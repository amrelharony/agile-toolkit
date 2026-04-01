"use client";

import { useRef, useMemo } from "react";
import { create } from "zustand";
import { persist } from "zustand/middleware";
import {
  ComposedChart,
  Bar,
  Line,
  XAxis,
  YAxis,
  CartesianGrid,
  Tooltip,
  Legend,
  ResponsiveContainer,
} from "recharts";
import { ToolPageWrapper } from "@/components/layout/tool-page-wrapper";
import { ExportButton } from "@/components/shared/export-button";
import { AiPromptGenerator } from "@/components/shared/ai-prompt-generator";
import { generateVelocityPrompts } from "@/lib/ai-prompts/velocity";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Plus, Trash2, Activity, TrendingUp, TrendingDown, Minus } from "lucide-react";

/* -------------------------------------------------------------------------- */
/*  Types                                                                     */
/* -------------------------------------------------------------------------- */

interface Sprint {
  id: string;
  name: string;
  committed: number;
  completed: number;
}

interface VelocityStore {
  sprints: Sprint[];
  addSprint: () => void;
  removeSprint: (id: string) => void;
  updateSprint: (id: string, updates: Partial<Sprint>) => void;
  reset: () => void;
}

/* -------------------------------------------------------------------------- */
/*  Default data                                                              */
/* -------------------------------------------------------------------------- */

const DEFAULT_SPRINTS: Sprint[] = [
  { id: "s1", name: "Sprint 1", committed: 34, completed: 28 },
  { id: "s2", name: "Sprint 2", committed: 30, completed: 32 },
  { id: "s3", name: "Sprint 3", committed: 36, completed: 35 },
];

const createSprint = (count: number): Sprint => ({
  id: crypto.randomUUID(),
  name: `Sprint ${count + 1}`,
  committed: 30,
  completed: 28,
});

/* -------------------------------------------------------------------------- */
/*  Store                                                                     */
/* -------------------------------------------------------------------------- */

const useVelocityStore = create<VelocityStore>()(
  persist(
    (set) => ({
      sprints: DEFAULT_SPRINTS,

      addSprint: () =>
        set((s) => ({ sprints: [...s.sprints, createSprint(s.sprints.length)] })),

      removeSprint: (id) =>
        set((s) => ({ sprints: s.sprints.filter((sp) => sp.id !== id) })),

      updateSprint: (id, updates) =>
        set((s) => ({
          sprints: s.sprints.map((sp) =>
            sp.id === id ? { ...sp, ...updates } : sp
          ),
        })),

      reset: () => set({ sprints: DEFAULT_SPRINTS }),
    }),
    { name: "agile-toolkit:velocity" }
  )
);

/* -------------------------------------------------------------------------- */
/*  Math helpers                                                              */
/* -------------------------------------------------------------------------- */

function rollingAverage(values: number[], window = 3): (number | null)[] {
  return values.map((_, i) => {
    if (i < window - 1) return null;
    const slice = values.slice(i - window + 1, i + 1);
    return slice.reduce((a, b) => a + b, 0) / slice.length;
  });
}

function linearRegression(values: number[]): number[] {
  const n = values.length;
  if (n < 2) return values.map(() => values[0] ?? 0);
  const xs = values.map((_, i) => i);
  const xMean = (n - 1) / 2;
  const yMean = values.reduce((a, b) => a + b, 0) / n;
  const ssXX = xs.reduce((sum, x) => sum + (x - xMean) ** 2, 0);
  const ssXY = xs.reduce((sum, x, i) => sum + (x - xMean) * (values[i] - yMean), 0);
  const slope = ssXY / ssXX;
  const intercept = yMean - slope * xMean;
  return xs.map((x) => Math.max(0, slope * x + intercept));
}

function stdDev(values: number[]): number {
  if (values.length < 2) return 0;
  const mean = values.reduce((a, b) => a + b, 0) / values.length;
  const variance = values.reduce((sum, v) => sum + (v - mean) ** 2, 0) / values.length;
  return Math.sqrt(variance);
}

function round(v: number, d = 1) {
  return Math.round(v * 10 ** d) / 10 ** d;
}

/* -------------------------------------------------------------------------- */
/*  Sub-components                                                            */
/* -------------------------------------------------------------------------- */

function StatCard({
  label,
  value,
  unit,
  icon: Icon,
  iconColor = "#00f0ff",
}: {
  label: string;
  value: string | number;
  unit?: string;
  icon: React.ElementType;
  iconColor?: string;
}) {
  return (
    <Card className="bg-surface border-border">
      <CardContent className="p-5">
        <div className="flex items-center gap-3 mb-3">
          <div className="p-2 rounded-lg" style={{ background: `${iconColor}1a` }}>
            <Icon className="w-5 h-5" style={{ color: iconColor }} />
          </div>
          <span className="text-sm text-sub">{label}</span>
        </div>
        <div className="flex items-baseline gap-1.5">
          <span className="text-3xl font-data font-bold text-text">{value}</span>
          {unit && <span className="text-sm text-sub">{unit}</span>}
        </div>
      </CardContent>
    </Card>
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

export function VelocityClient() {
  const { sprints, addSprint, removeSprint, updateSprint, reset } =
    useVelocityStore();

  const exportRef = useRef<HTMLDivElement>(null);

  /* -- Derived chart data -------------------------------------------------- */

  const { chartData, stats } = useMemo(() => {
    const completedValues = sprints.map((s) => s.completed);
    const rolling = rollingAverage(completedValues, 3);
    const trendLine = linearRegression(completedValues);

    const data = sprints.map((sp, i) => ({
      name: sp.name,
      committed: sp.committed,
      completed: sp.completed,
      rollingAvg: rolling[i] !== null ? round(rolling[i]!, 1) : undefined,
      trend: round(trendLine[i], 1),
    }));

    const n = sprints.length;
    const avgVelocity = n > 0 ? completedValues.reduce((a, b) => a + b, 0) / n : 0;
    const predictable = sprints.filter((s) => s.completed >= s.committed).length;
    const predictability = n > 0 ? (predictable / n) * 100 : 0;
    const sd = stdDev(completedValues);

    // Trend direction: compare last 2 trend values
    let trendDir: "up" | "down" | "stable" = "stable";
    if (trendLine.length >= 2) {
      const diff = trendLine[trendLine.length - 1] - trendLine[trendLine.length - 2];
      if (Math.abs(diff) < 0.5) trendDir = "stable";
      else if (diff > 0) trendDir = "up";
      else trendDir = "down";
    }

    return {
      chartData: data,
      stats: { avgVelocity, predictability, sd, trendDir },
    };
  }, [sprints]);

  /* -- Export data --------------------------------------------------------- */

  const csvData = useMemo(() => ({
    headers: ["Sprint", "Committed", "Completed"],
    rows: sprints.map((s) => [s.name, s.committed, s.completed]),
  }), [sprints]);

  const promptConfig = useMemo(() => ({
    toolName: "Velocity Tracker",
    prompts: generateVelocityPrompts({ sprints, stats }),
  }), [sprints, stats]);

  /* -- Trend icon ---------------------------------------------------------- */

  const TrendIcon =
    stats.trendDir === "up"
      ? TrendingUp
      : stats.trendDir === "down"
      ? TrendingDown
      : Minus;

  const trendColor =
    stats.trendDir === "up"
      ? "#00f0ff"
      : stats.trendDir === "down"
      ? "#ff00aa"
      : "#94a3b8";

  /* -- Render -------------------------------------------------------------- */

  return (
    <ToolPageWrapper
      title="Velocity Tracker"
      description="Track your team's sprint velocity with rolling averages and trend analysis."
      category="Metrics & Dashboards"
    >
      <div ref={exportRef} className="space-y-6">

        {/* ---- Stats Cards ---- */}
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
          <StatCard
            label="Average Velocity"
            value={round(stats.avgVelocity)}
            unit="pts"
            icon={Activity}
            iconColor="#00f0ff"
          />
          <StatCard
            label="Predictability"
            value={round(stats.predictability, 0)}
            unit="%"
            icon={Activity}
            iconColor="#00ff88"
          />
          <StatCard
            label="Std Deviation"
            value={round(stats.sd)}
            unit="pts"
            icon={Activity}
            iconColor="#ffaa00"
          />
          <StatCard
            label="Trend"
            value={stats.trendDir.charAt(0).toUpperCase() + stats.trendDir.slice(1)}
            icon={TrendIcon}
            iconColor={trendColor}
          />
        </div>

        {/* ---- Chart ---- */}
        <Card className="bg-surface border-border">
          <CardHeader className="pb-2">
            <div className="flex items-center justify-between">
              <CardTitle className="flex items-center gap-2 text-lg font-display text-text">
                <Activity className="w-5 h-5 text-accent" />
                Velocity Chart
              </CardTitle>
              <div className="flex items-center gap-2">
                <AiPromptGenerator config={promptConfig} />
                <ExportButton
                  filename="velocity-tracker"
                  csvData={csvData}
                  targetRef={exportRef}
                />
              </div>
            </div>
          </CardHeader>
          <CardContent>
            <ResponsiveContainer width="100%" height={350}>
              <ComposedChart
                data={chartData}
                margin={{ top: 10, right: 20, left: 0, bottom: 0 }}
              >
                <CartesianGrid
                  strokeDasharray="3 3"
                  stroke="rgba(255,255,255,0.06)"
                  vertical={false}
                />
                <XAxis
                  dataKey="name"
                  tick={{ fill: "#94a3b8", fontSize: 12 }}
                  axisLine={{ stroke: "rgba(255,255,255,0.1)" }}
                  tickLine={false}
                />
                <YAxis
                  tick={{ fill: "#94a3b8", fontSize: 12 }}
                  axisLine={false}
                  tickLine={false}
                />
                <Tooltip
                  contentStyle={TOOLTIP_STYLE}
                  cursor={{ fill: "rgba(255,255,255,0.04)" }}
                />
                <Legend
                  wrapperStyle={{ paddingTop: "16px", color: "#94a3b8", fontSize: 12 }}
                />
                <Bar
                  dataKey="committed"
                  name="Committed"
                  fill="rgba(0,240,255,0.3)"
                  radius={[4, 4, 0, 0]}
                  maxBarSize={60}
                />
                <Bar
                  dataKey="completed"
                  name="Completed"
                  fill="#00f0ff"
                  radius={[4, 4, 0, 0]}
                  maxBarSize={60}
                />
                <Line
                  dataKey="rollingAvg"
                  name="Rolling Avg"
                  stroke="#ff00aa"
                  strokeWidth={2}
                  dot={false}
                  connectNulls
                />
                <Line
                  dataKey="trend"
                  name="Trend"
                  stroke="#ffaa00"
                  strokeWidth={1.5}
                  strokeDasharray="4 4"
                  dot={false}
                />
              </ComposedChart>
            </ResponsiveContainer>
          </CardContent>
        </Card>

        {/* ---- Data Table ---- */}
        <Card className="bg-surface border-border">
          <CardHeader className="pb-4">
            <div className="flex items-center justify-between">
              <CardTitle className="text-lg font-display text-text">
                Sprint Data
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
                  className="gap-1.5 bg-accent/10 text-accent border border-accent/20 hover:bg-accent/20 hover:border-accent/40"
                >
                  <Plus className="w-4 h-4" />
                  Add Sprint
                </Button>
              </div>
            </div>
          </CardHeader>
          <CardContent className="space-y-3">
            {/* Header row */}
            <div className="grid grid-cols-[1fr_0.6fr_0.6fr_auto] gap-3 px-1 pb-2 border-b border-border">
              <span className="text-xs text-sub font-medium uppercase tracking-wider">Sprint Name</span>
              <span className="text-xs text-sub font-medium uppercase tracking-wider">Committed</span>
              <span className="text-xs text-sub font-medium uppercase tracking-wider">Completed</span>
              <span className="w-9" />
            </div>

            {sprints.map((sp) => (
              <div
                key={sp.id}
                className="grid grid-cols-[1fr_0.6fr_0.6fr_auto] gap-3 items-center"
              >
                <Input
                  value={sp.name}
                  onChange={(e) => updateSprint(sp.id, { name: e.target.value })}
                  className="bg-surface-deep border-border text-text focus:border-accent/50 focus:ring-accent/20"
                />
                <Input
                  type="number"
                  min={0}
                  value={sp.committed}
                  onChange={(e) =>
                    updateSprint(sp.id, { committed: Math.max(0, Number(e.target.value)) })
                  }
                  className="bg-surface-deep border-border text-text font-data focus:border-accent/50 focus:ring-accent/20"
                />
                <Input
                  type="number"
                  min={0}
                  value={sp.completed}
                  onChange={(e) =>
                    updateSprint(sp.id, { completed: Math.max(0, Number(e.target.value)) })
                  }
                  className="bg-surface-deep border-border text-text font-data focus:border-accent/50 focus:ring-accent/20"
                />
                <Button
                  variant="ghost"
                  size="icon"
                  disabled={sprints.length <= 1}
                  onClick={() => removeSprint(sp.id)}
                  className="h-9 w-9 text-sub hover:text-red-400 hover:bg-red-400/10 disabled:opacity-30"
                >
                  <Trash2 className="w-4 h-4" />
                </Button>
              </div>
            ))}

            {/* Predictability note */}
            <div className="mt-4 pt-4 border-t border-border flex items-center justify-between px-1">
              <span className="text-sm text-sub">
                Sprints meeting commitment:{" "}
                <span className="text-accent font-data font-semibold">
                  {sprints.filter((s) => s.completed >= s.committed).length}
                </span>{" "}
                / {sprints.length}
              </span>
              <div className="flex items-baseline gap-1.5">
                <span className="text-2xl font-data font-bold text-accent">
                  {round(stats.predictability, 0)}%
                </span>
                <span className="text-sm text-sub">predictable</span>
              </div>
            </div>
          </CardContent>
        </Card>
      </div>
    </ToolPageWrapper>
  );
}
