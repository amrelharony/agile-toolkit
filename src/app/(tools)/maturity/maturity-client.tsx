"use client";

import { useRef, useMemo } from "react";
import { create } from "zustand";
import { persist } from "zustand/middleware";
import {
  RadarChart,
  PolarGrid,
  PolarAngleAxis,
  Radar,
  ResponsiveContainer,
  Tooltip,
} from "recharts";
import { ToolPageWrapper } from "@/components/layout/tool-page-wrapper";
import { ExportButton } from "@/components/shared/export-button";
import { AiPromptGenerator } from "@/components/shared/ai-prompt-generator";
import { generateMaturityPrompts } from "@/lib/ai-prompts/maturity";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Slider } from "@/components/ui/slider";
import { Award, TrendingUp, ChevronRight, RotateCcw } from "lucide-react";
import {
  MATURITY_DIMENSIONS,
  MATURITY_LEVEL_LABELS,
  getMaturityScore,
} from "@/lib/constants/maturity-model";

/* -------------------------------------------------------------------------- */
/*  Store                                                                     */
/* -------------------------------------------------------------------------- */

interface MaturityStore {
  scores: Record<string, number>; // dimensionId -> level 1-5
  targetLevel: number;
  setScore: (dimensionId: string, level: number) => void;
  setTargetLevel: (level: number) => void;
  reset: () => void;
}

const DEFAULT_SCORES = Object.fromEntries(
  MATURITY_DIMENSIONS.map((d) => [d.id, 1])
);

const useMaturityStore = create<MaturityStore>()(
  persist(
    (set) => ({
      scores: DEFAULT_SCORES,
      targetLevel: 4,
      setScore: (dimensionId, level) =>
        set((s) => ({ scores: { ...s.scores, [dimensionId]: level } })),
      setTargetLevel: (level) => set({ targetLevel: level }),
      reset: () => set({ scores: DEFAULT_SCORES, targetLevel: 4 }),
    }),
    { name: "agile-toolkit:maturity" }
  )
);

/* -------------------------------------------------------------------------- */
/*  Radar tooltip                                                              */
/* -------------------------------------------------------------------------- */

function CustomTooltip({
  active,
  payload,
}: {
  active?: boolean;
  payload?: Array<{ payload: { subject: string; value: number } }>;
}) {
  if (!active || !payload?.length) return null;
  const { subject, value } = payload[0].payload;
  return (
    <div className="bg-surface border border-border rounded-lg px-3 py-2 text-sm shadow-lg">
      <p className="text-text font-medium">{subject}</p>
      <p className="text-accent">
        Level {value} — {MATURITY_LEVEL_LABELS[value]}
      </p>
    </div>
  );
}

/* -------------------------------------------------------------------------- */
/*  Main Client                                                               */
/* -------------------------------------------------------------------------- */

export function MaturityClient() {
  const { scores, targetLevel, setScore, setTargetLevel, reset } =
    useMaturityStore();
  const chartRef = useRef<HTMLDivElement>(null);

  /* -- Derived data -------------------------------------------------------- */

  const radarData = useMemo(
    () =>
      MATURITY_DIMENSIONS.map((d) => ({
        subject: d.name,
        value: scores[d.id] ?? 1,
        fullMark: 5,
      })),
    [scores]
  );

  const averageLevel = useMemo(() => {
    const values = MATURITY_DIMENSIONS.map((d) => scores[d.id] ?? 1);
    return values.reduce((a, b) => a + b, 0) / values.length;
  }, [scores]);

  const maturityScore = useMemo(
    () => getMaturityScore(averageLevel),
    [averageLevel]
  );

  const roadmapItems = useMemo(
    () =>
      MATURITY_DIMENSIONS.filter(
        (d) => (scores[d.id] ?? 1) < targetLevel
      ).map((d) => {
        const current = scores[d.id] ?? 1;
        const nextLevel = d.levels.find((l) => l.level === current + 1);
        return { dimension: d, current, nextLevel };
      }),
    [scores, targetLevel]
  );

  /* -- AI prompts ---------------------------------------------------------- */

  const promptConfig = useMemo(() => ({
    toolName: "Agile Maturity Assessment",
    prompts: generateMaturityPrompts({
      dimensions: MATURITY_DIMENSIONS.map((d) => ({
        name: d.name,
        currentScore: scores[d.id] ?? 1,
        targetScore: targetLevel,
      })),
      overallScore: maturityScore.percentage,
      targetLevel,
    }),
  }), [scores, targetLevel, maturityScore.percentage]);

  /* -- Export -------------------------------------------------------------- */

  const clipboardText = useMemo(() => {
    const lines: string[] = [
      "AGILE MATURITY ASSESSMENT",
      "=".repeat(40),
      "",
      `Overall Score: ${maturityScore.percentage}% — ${maturityScore.label}`,
      `Average Level: ${averageLevel.toFixed(1)} / 5`,
      "",
      "DIMENSION SCORES",
      "-".repeat(40),
    ];
    for (const d of MATURITY_DIMENSIONS) {
      const level = scores[d.id] ?? 1;
      const lbl = MATURITY_LEVEL_LABELS[level];
      lines.push(`${d.name.padEnd(28)} Level ${level} (${lbl})`);
    }
    if (roadmapItems.length > 0) {
      lines.push("", "IMPROVEMENT ROADMAP", "-".repeat(40));
      for (const item of roadmapItems) {
        lines.push(`\n${item.dimension.name} (${item.current} → ${targetLevel})`);
        if (item.nextLevel) {
          lines.push(`  Next: ${item.nextLevel.description}`);
        }
      }
    }
    return lines.join("\n");
  }, [scores, averageLevel, maturityScore, roadmapItems, targetLevel]);

  /* -- Render -------------------------------------------------------------- */

  return (
    <ToolPageWrapper
      title="Agile Maturity Assessment"
      description="Rate your team across 8 Agile dimensions to visualize your current maturity and identify the most impactful next steps."
      category="Team Health & Maturity"
    >
      <div className="space-y-6">
        {/* ---- Top bar ---------------------------------------------------- */}
        <div className="flex items-center justify-between flex-wrap gap-3">
          <div className="flex items-center gap-3">
            {/* Overall badge */}
            <div
              className="flex items-center gap-2 px-4 py-2 rounded-lg border"
              style={{
                borderColor: `${maturityScore.color}40`,
                backgroundColor: `${maturityScore.color}10`,
              }}
            >
              <Award className="w-5 h-5" style={{ color: maturityScore.color }} />
              <span className="font-data text-2xl font-bold" style={{ color: maturityScore.color }}>
                {maturityScore.percentage}%
              </span>
              <span className="text-sm text-sub">
                {maturityScore.label}
              </span>
            </div>
            <div className="text-sm text-sub">
              Avg level{" "}
              <span className="text-text font-medium">
                {averageLevel.toFixed(1)}
              </span>{" "}
              / 5
            </div>
          </div>
          <div className="flex items-center gap-2">
            <AiPromptGenerator config={promptConfig} />
            <ExportButton
              filename="agile-maturity-assessment"
              clipboardText={clipboardText}
              targetRef={chartRef}
            />
            <Button
              variant="ghost"
              size="sm"
              onClick={reset}
              className="gap-1.5 text-sub hover:text-red-400 hover:bg-red-400/10"
            >
              <RotateCcw className="w-4 h-4" />
              Reset
            </Button>
          </div>
        </div>

        {/* ---- Main layout: sliders + radar ------------------------------- */}
        <div className="grid grid-cols-1 xl:grid-cols-2 gap-6">
          {/* Left: dimension sliders */}
          <Card className="bg-surface border-border">
            <CardHeader className="pb-4">
              <CardTitle className="text-lg font-display text-text">
                Dimension Scores
              </CardTitle>
            </CardHeader>
            <CardContent className="space-y-5">
              {MATURITY_DIMENSIONS.map((dim) => {
                const level = scores[dim.id] ?? 1;
                const levelData = dim.levels.find((l) => l.level === level)!;
                return (
                  <div key={dim.id} className="space-y-2">
                    <div className="flex items-center justify-between">
                      <span className="text-sm font-medium text-text">
                        {dim.name}
                      </span>
                      <Badge
                        variant="outline"
                        className="text-xs border-accent/30 text-accent bg-accent/5"
                      >
                        {level} — {levelData.label}
                      </Badge>
                    </div>
                    <Slider
                      min={1}
                      max={5}
                      step={1}
                      value={[level]}
                      onValueChange={([v]) => setScore(dim.id, v)}
                      className="w-full"
                    />
                    <p className="text-xs text-sub leading-relaxed">
                      {levelData.description}
                    </p>
                  </div>
                );
              })}
            </CardContent>
          </Card>

          {/* Right: radar chart */}
          <div className="space-y-4">
            <Card className="bg-surface border-border">
              <CardHeader className="pb-2">
                <CardTitle className="text-lg font-display text-text">
                  Maturity Radar
                </CardTitle>
              </CardHeader>
              <CardContent>
                <div ref={chartRef} className="h-[420px]">
                  <ResponsiveContainer width="100%" height="100%">
                    <RadarChart
                      data={radarData}
                      margin={{ top: 20, right: 30, bottom: 20, left: 30 }}
                    >
                      <PolarGrid
                        gridType="polygon"
                        stroke="rgba(255,255,255,0.1)"
                      />
                      <PolarAngleAxis
                        dataKey="subject"
                        tick={{
                          fill: "#a0aec0",
                          fontSize: 11,
                          fontFamily: "Inter, sans-serif",
                        }}
                      />
                      <Radar
                        name="Maturity"
                        dataKey="value"
                        stroke="#00f0ff"
                        fill="#00f0ff"
                        fillOpacity={0.15}
                        strokeWidth={2}
                        dot={{ r: 4, fill: "#00f0ff", strokeWidth: 0 }}
                      />
                      <Tooltip content={<CustomTooltip />} />
                    </RadarChart>
                  </ResponsiveContainer>
                </div>
                {/* Level legend */}
                <div className="flex flex-wrap gap-x-4 gap-y-1 mt-2 justify-center">
                  {[1, 2, 3, 4, 5].map((l) => (
                    <span key={l} className="text-xs text-sub">
                      <span className="text-text font-medium">{l}</span>{" "}
                      {MATURITY_LEVEL_LABELS[l]}
                    </span>
                  ))}
                </div>
              </CardContent>
            </Card>
          </div>
        </div>

        {/* ---- Improvement Roadmap ---------------------------------------- */}
        <Card className="bg-surface border-border">
          <CardHeader className="pb-4">
            <div className="flex items-center justify-between flex-wrap gap-3">
              <CardTitle className="flex items-center gap-2 text-lg font-display text-text">
                <TrendingUp className="w-5 h-5 text-accent" />
                Improvement Roadmap
              </CardTitle>
              <div className="flex items-center gap-3">
                <span className="text-sm text-sub">Target level:</span>
                <div className="flex gap-1">
                  {[2, 3, 4, 5].map((l) => (
                    <button
                      key={l}
                      type="button"
                      onClick={() => setTargetLevel(l)}
                      className={`w-8 h-8 rounded text-sm font-medium transition-all ${
                        targetLevel === l
                          ? "bg-accent text-[#0a0f1e] font-bold"
                          : "bg-card text-sub hover:bg-cardH border border-border"
                      }`}
                    >
                      {l}
                    </button>
                  ))}
                </div>
              </div>
            </div>
          </CardHeader>
          <CardContent>
            {roadmapItems.length === 0 ? (
              <div className="text-center py-8 text-sub">
                <Award className="w-10 h-10 mx-auto mb-3 text-accent opacity-60" />
                <p className="font-medium text-text">
                  All dimensions meet or exceed target level {targetLevel}!
                </p>
                <p className="text-sm mt-1">
                  Raise the target to continue improving.
                </p>
              </div>
            ) : (
              <div className="space-y-4">
                {roadmapItems.map(({ dimension, current, nextLevel }) => (
                  <div
                    key={dimension.id}
                    className="flex gap-3 p-4 rounded-lg bg-card-hover border border-border hover:border-accent/20 transition-colors"
                  >
                    <ChevronRight className="w-4 h-4 text-accent flex-shrink-0 mt-0.5" />
                    <div className="space-y-1 min-w-0">
                      <div className="flex items-center gap-2 flex-wrap">
                        <span className="font-medium text-text text-sm">
                          {dimension.name}
                        </span>
                        <span className="text-xs text-sub">
                          Level {current} → {current + 1}
                          {current + 1 < targetLevel && ` (target: ${targetLevel})`}
                        </span>
                      </div>
                      {nextLevel && (
                        <p className="text-sm text-sub leading-relaxed">
                          {nextLevel.description}
                        </p>
                      )}
                    </div>
                  </div>
                ))}
              </div>
            )}
          </CardContent>
        </Card>
      </div>
    </ToolPageWrapper>
  );
}
