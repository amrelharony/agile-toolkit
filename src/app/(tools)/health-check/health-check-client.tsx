"use client";

import { useMemo } from "react";
import { create } from "zustand";
import { persist } from "zustand/middleware";
import { safeJSONStorage } from "@/lib/stores/safe-storage";
import {
  LineChart,
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
import { generateHealthCheckPrompts } from "@/lib/ai-prompts/health-check";
import { useShallow } from "zustand/react/shallow";
import { useWorkspaceStore } from "@/lib/stores/workspace-store";
import type { Workspace } from "@/lib/stores/workspace-types";
import { useHistoryLogger } from "@/lib/history/use-history-logger";
import { HEALTH_CHECK_ACTIONS } from "@/lib/history/event-actions";
import { todayLocalISO } from "@/lib/utils/formatters";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { SectionCard } from "@/components/shared/section-card";
import { Input } from "@/components/ui/input";
import { HeartPulse } from "lucide-react";

/* -------------------------------------------------------------------------- */
/*  Constants                                                                 */
/* -------------------------------------------------------------------------- */

const DIMENSIONS = [
  "Delivering Value",
  "Easy to Release",
  "Fun",
  "Health of Codebase",
  "Learning",
  "Mission",
  "Speed",
  "Teamwork",
] as const;

type Dimension = (typeof DIMENSIONS)[number];

type TrafficLight = "green" | "yellow" | "red";
type Trend = "up" | "same" | "down";

const DIMENSION_COLORS: Record<Dimension, string> = {
  "Delivering Value": "#00f0ff",
  "Easy to Release": "#00ff88",
  "Fun": "#ffaa00",
  "Health of Codebase": "#ff00aa",
  "Learning": "#8b5cf6",
  "Mission": "#f97316",
  "Speed": "#06b6d4",
  "Teamwork": "#84cc16",
};

const SCORE_MAP: Record<TrafficLight, number> = { green: 2, yellow: 1, red: 0 };

/* -------------------------------------------------------------------------- */
/*  Types                                                                     */
/* -------------------------------------------------------------------------- */

type DimensionScore = {
  light: TrafficLight;
  trend: Trend;
};

type CurrentCheck = {
  sprintName: string;
  scores: Record<Dimension, DimensionScore>;
};

type HistoryEntry = {
  id: string;
  sprintName: string;
  date: string;
  scores: Record<Dimension, DimensionScore>;
};

interface HealthCheckStore {
  current: CurrentCheck;
  history: HistoryEntry[];
  setSprintName: (name: string) => void;
  setLight: (dim: Dimension, light: TrafficLight) => void;
  setTrend: (dim: Dimension, trend: Trend) => void;
  saveCheck: () => void;
  reset: () => void;
}

/* -------------------------------------------------------------------------- */
/*  Default state                                                             */
/* -------------------------------------------------------------------------- */

function defaultScores(): Record<Dimension, DimensionScore> {
  return Object.fromEntries(
    DIMENSIONS.map((d) => [d, { light: "green" as TrafficLight, trend: "same" as Trend }])
  ) as Record<Dimension, DimensionScore>;
}

const DEFAULT_CURRENT: CurrentCheck = {
  sprintName: "",
  scores: defaultScores(),
};

/* -------------------------------------------------------------------------- */
/*  Store                                                                     */
/* -------------------------------------------------------------------------- */

const useHealthCheckStore = create<HealthCheckStore>()(
  persist(
    (set, get) => ({
      current: DEFAULT_CURRENT,
      history: [],

      setSprintName: (name) =>
        set((s) => ({ current: { ...s.current, sprintName: name } })),

      setLight: (dim, light) =>
        set((s) => ({
          current: {
            ...s.current,
            scores: {
              ...s.current.scores,
              [dim]: { ...s.current.scores[dim], light },
            },
          },
        })),

      setTrend: (dim, trend) =>
        set((s) => ({
          current: {
            ...s.current,
            scores: {
              ...s.current.scores,
              [dim]: { ...s.current.scores[dim], trend },
            },
          },
        })),

      saveCheck: () => {
        const { current, history } = get();
        const entry: HistoryEntry = {
          id: crypto.randomUUID(),
          sprintName: current.sprintName || `Check ${history.length + 1}`,
          date: todayLocalISO(),
          scores: { ...current.scores },
        };
        set((s) => ({
          history: [...s.history, entry],
          current: { ...DEFAULT_CURRENT, scores: defaultScores() },
        }));
      },

      reset: () =>
        set({ current: { ...DEFAULT_CURRENT, scores: defaultScores() }, history: [] }),
    }),
    { name: "agile-toolkit:health-check", storage: safeJSONStorage("health-check") }
  )
);

/* -------------------------------------------------------------------------- */
/*  Helper components                                                         */
/* -------------------------------------------------------------------------- */

const TOOLTIP_STYLE = {
  backgroundColor: "#1a1f36",
  border: "1px solid rgba(255,255,255,0.1)",
  borderRadius: "8px",
  color: "#e2e8f0",
};

function TrafficDot({ light }: { light: TrafficLight }) {
  const bg =
    light === "green"
      ? "bg-[#22c55e]"
      : light === "yellow"
      ? "bg-[#eab308]"
      : "bg-[#ef4444]";
  return (
    <span
      className={`inline-block w-4 h-4 rounded-full ${bg} shadow-sm`}
      title={light}
    />
  );
}

function TrafficButton({
  active,
  light,
  onClick,
}: {
  active: boolean;
  light: TrafficLight;
  onClick: () => void;
}) {
  const emoji =
    light === "green" ? "🟢" : light === "yellow" ? "🟡" : "🔴";
  const label = light.charAt(0).toUpperCase() + light.slice(1);
  const ring =
    active
      ? light === "green"
        ? "ring-2 ring-[#22c55e]"
        : light === "yellow"
        ? "ring-2 ring-[#eab308]"
        : "ring-2 ring-[#ef4444]"
      : "";
  return (
    <button
      onClick={onClick}
      className={`flex items-center gap-1.5 px-3 py-1.5 rounded-md text-sm transition-all border ${
        active
          ? "bg-card border-border text-text"
          : "bg-transparent border-border text-sub hover:bg-cardH hover:border-border"
      } ${ring}`}
      title={label}
    >
      <span>{emoji}</span>
      <span>{label}</span>
    </button>
  );
}

function TrendButton({
  active,
  trend,
  onClick,
}: {
  active: boolean;
  trend: Trend;
  onClick: () => void;
}) {
  const arrow = trend === "up" ? "↑" : trend === "same" ? "→" : "↓";
  const label = trend === "up" ? "Up" : trend === "same" ? "Same" : "Down";
  const color =
    trend === "up"
      ? "text-[#22c55e]"
      : trend === "same"
      ? "text-sub"
      : "text-[#ef4444]";
  return (
    <button
      onClick={onClick}
      className={`flex items-center gap-1 px-2.5 py-1.5 rounded-md text-sm transition-all border ${
        active
          ? "bg-card border-border text-text"
          : "bg-transparent border-border text-sub hover:bg-cardH"
      }`}
      title={label}
    >
      <span className={`text-base ${color}`}>{arrow}</span>
      <span className="text-xs">{label}</span>
    </button>
  );
}

/* -------------------------------------------------------------------------- */
/*  Main component                                                            */
/* -------------------------------------------------------------------------- */

export function HealthCheckClient() {
  // R5: destructuring `useHealthCheckStore()` re-subscribes the whole
  // component to every store property — every keystroke on an unrelated
  // tool sharing the store would re-render this whole page. Use
  // individual selectors so each field is its own subscription.
  const current = useHealthCheckStore((s) => s.current);
  const history = useHealthCheckStore((s) => s.history);
  const setSprintName = useHealthCheckStore((s) => s.setSprintName);
  const setLight = useHealthCheckStore((s) => s.setLight);
  const setTrend = useHealthCheckStore((s) => s.setTrend);
  const saveCheckRaw = useHealthCheckStore((s) => s.saveCheck);
  const resetRaw = useHealthCheckStore((s) => s.reset);
  const { log } = useHistoryLogger("health-check");

  const saveCheck = () => {
    // Read latest store snapshot synchronously so we don't log a stale
    // `current` from a previous render (the destructured `current` above
    // can lag the most recent edit).
    const pre = useHealthCheckStore.getState().current;
    saveCheckRaw();
    log(HEALTH_CHECK_ACTIONS.CHECK_SAVED, {
      sprintName: pre?.sprintName,
      scores: pre?.scores,
    });
  };
  const reset = () => {
    resetRaw();
    log(HEALTH_CHECK_ACTIONS.HEALTH_CHECK_RESET, {});
  };

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
  const promptConfig = useMemo(() => ({
    toolName: "Team Health Check",
    prompts: generateHealthCheckPrompts({ current, history }, workspace),
  }), [current, history, workspace]);

  /* -- CSV export ---------------------------------------------------------- */
  const csvData = useMemo(() => {
    const headers = ["Sprint", "Date", ...DIMENSIONS, "Overall Health %"];
    const rows = history.map((h) => {
      // Optional-chain `h.scores` itself: a hand-edited persisted entry could
      // be missing it altogether, which would otherwise crash the CSV builder.
      const greenCount = DIMENSIONS.filter((d) => h.scores?.[d]?.light === "green").length;
      const health = Math.round((greenCount / DIMENSIONS.length) * 100);
      return [
        h.sprintName,
        h.date,
        ...DIMENSIONS.map((d) => h.scores?.[d]?.light ?? "—"),
        health,
      ] as (string | number)[];
    });
    return { headers, rows };
  }, [history]);

  /* -- Trend chart data ---------------------------------------------------- */
  // Defensive: a history entry from an older build may be missing a dimension
  // (added later) or have a malformed `light` value. Coerce to the default
  // `green` rather than emit `undefined` into the chart series, which produced
  // NaN gaps in the recharts <Line> via `SCORE_MAP[undefined]`.
  const chartData = useMemo(
    () =>
      history.map((h) => ({
        name: h.sprintName,
        ...Object.fromEntries(
          DIMENSIONS.map((d) => {
            const score = h.scores?.[d]?.light;
            return [d, score && score in SCORE_MAP ? SCORE_MAP[score] : 0];
          })
        ),
      })),
    [history]
  );

  /* -- Overall health for current check ------------------------------------ */
  const currentGreen = useMemo(
    () =>
      DIMENSIONS.filter((d) => current.scores[d]?.light === "green").length,
    [current.scores]
  );
  const currentHealth = Math.round((currentGreen / DIMENSIONS.length) * 100);

  const reversedHistory = useMemo(() => [...history].reverse(), [history]);

  /* -- Render -------------------------------------------------------------- */
  return (
    <ToolPageWrapper
      toolId="health-check"
      title="Squad Health Check"
      description="Spotify-model health check — rate each dimension with traffic lights and track trends over time."
      category="Team Health & Maturity"
    >
      <div className="space-y-6">

        {/* ---- Current Check ---- */}
        <SectionCard
          title="Current Check"
          icon={HeartPulse}
          titleSize="lg"
          headerClassName="pb-4"
          actions={
            <>
              <div className="text-sm text-sub">
                Health:{" "}
                <span
                  className={`font-data font-bold ${
                    currentHealth >= 75
                      ? "text-[#22c55e]"
                      : currentHealth >= 50
                      ? "text-[#eab308]"
                      : "text-[#ef4444]"
                  }`}
                >
                  {currentHealth}%
                </span>
              </div>
              <Button
                size="sm"
                variant="toolkit"
                onClick={saveCheck}
              >
                Save Check
              </Button>
            </>
          }
          contentClassName="space-y-4"
        >
          {/* Sprint name */}
          <div className="flex items-center gap-3">
            <label className="text-sm text-sub w-24 shrink-0">
              Sprint name
            </label>
            <Input
              value={current.sprintName}
              onChange={(e) => setSprintName(e.target.value)}
              placeholder="e.g. Sprint 42"
              className="max-w-xs input-toolkit"
            />
          </div>

          {/* Dimension rows */}
          <div className="space-y-2">
            {/* Header */}
            <div className="grid grid-cols-[1fr_auto_auto] gap-3 px-1 pb-2 border-b border-border">
              <span className="text-xs text-sub font-medium uppercase tracking-wider">
                Dimension
              </span>
              <span className="text-xs text-sub font-medium uppercase tracking-wider w-52 text-center">
                Status
              </span>
              <span className="text-xs text-sub font-medium uppercase tracking-wider w-48 text-center">
                Trend
              </span>
            </div>

            {DIMENSIONS.map((dim) => (
              <div
                key={dim}
                className="grid grid-cols-[1fr_auto_auto] gap-3 items-center py-1.5 border-b border-border last:border-0"
              >
                <span className="text-sm text-text font-medium">{dim}</span>
                <div className="flex gap-1.5 w-52 justify-center">
                  {/* R11-fix: optional-chain on current.scores[dim].
                      Persisted state from an older build that's missing
                      a recently-added dimension would crash on the
                      direct member access. Default to "red" (worst light)
                      so a missing/legacy dimension surfaces visibly
                      rather than silently rendering as no-active. */}
                  {(["green", "yellow", "red"] as TrafficLight[]).map((l) => (
                    <TrafficButton
                      key={l}
                      light={l}
                      active={(current.scores[dim]?.light ?? "red") === l}
                      onClick={() => setLight(dim, l)}
                    />
                  ))}
                </div>
                <div className="flex gap-1.5 w-48 justify-center">
                  {/* R11-fix: same optional-chain defence as the light
                      buttons above — missing dimension in persisted
                      state should fall back to "same" rather than crash. */}
                  {(["up", "same", "down"] as Trend[]).map((t) => (
                    <TrendButton
                      key={t}
                      trend={t}
                      active={(current.scores[dim]?.trend ?? "same") === t}
                      onClick={() => setTrend(dim, t)}
                    />
                  ))}
                </div>
              </div>
            ))}
          </div>
        </SectionCard>

        {/* ---- Trend Chart ---- */}
        {history.length > 0 && (
          <SectionCard
            title="Trend Chart"
            titleSize="lg"
            headerClassName="pb-2"
            actions={
              <>
                <AiPromptGenerator config={promptConfig} />
                <ExportButton
                  filename="squad-health-check"
                  csvData={csvData}
                />
              </>
            }
          >
            <p className="text-xs text-sub mb-3">
              2 = Green &nbsp;·&nbsp; 1 = Yellow &nbsp;·&nbsp; 0 = Red
            </p>
            <ResponsiveContainer width="100%" height={360}>
              <LineChart
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
                  domain={[0, 2]}
                  ticks={[0, 1, 2]}
                  tickFormatter={(v) =>
                    v === 2 ? "Green" : v === 1 ? "Yellow" : "Red"
                  }
                  tick={{ fill: "#94a3b8", fontSize: 11 }}
                  axisLine={false}
                  tickLine={false}
                  width={56}
                />
                <Tooltip contentStyle={TOOLTIP_STYLE} />
                <Legend
                  wrapperStyle={{ paddingTop: "16px", color: "#94a3b8", fontSize: 11 }}
                />
                {DIMENSIONS.map((dim) => (
                  <Line
                    key={dim}
                    dataKey={dim}
                    stroke={DIMENSION_COLORS[dim]}
                    strokeWidth={2}
                    dot={{ r: 3, fill: DIMENSION_COLORS[dim] }}
                    activeDot={{ r: 5 }}
                  />
                ))}
              </LineChart>
            </ResponsiveContainer>
          </SectionCard>
        )}

        {/* ---- History Table ---- */}
        {history.length > 0 ? (
          <SectionCard
            title="History"
            titleSize="lg"
            headerClassName="pb-4"
            actions={
              <Button
                variant="danger-ghost"
                size="sm"
                onClick={reset}
              >
                Clear All
              </Button>
            }
          >
            <div className="overflow-x-auto">
                <table className="w-full text-sm">
                  <thead>
                    <tr className="border-b border-border">
                      <th className="text-left text-xs text-sub font-medium uppercase tracking-wider pb-3 pr-4 whitespace-nowrap">
                        Sprint
                      </th>
                      <th className="text-left text-xs text-sub font-medium uppercase tracking-wider pb-3 pr-4 whitespace-nowrap">
                        Date
                      </th>
                      {DIMENSIONS.map((d) => (
                        <th
                          key={d}
                          className="text-center text-xs text-sub font-medium uppercase tracking-wider pb-3 px-2 whitespace-nowrap"
                          title={d}
                        >
                          {d.split(" ").map((w) => w[0]).join("")}
                        </th>
                      ))}
                      <th className="text-right text-xs text-sub font-medium uppercase tracking-wider pb-3 pl-4 whitespace-nowrap">
                        Health
                      </th>
                    </tr>
                  </thead>
                  <tbody>
                    {reversedHistory.map((h) => {
                      const greens = DIMENSIONS.filter(
                        (d) => h.scores?.[d]?.light === "green"
                      ).length;
                      const health = Math.round((greens / DIMENSIONS.length) * 100);
                      return (
                        <tr
                          key={h.id}
                          className="border-b border-border last:border-0 hover:bg-card"
                        >
                          <td className="py-3 pr-4 text-text font-medium whitespace-nowrap">
                            {h.sprintName}
                          </td>
                          <td className="py-3 pr-4 text-sub whitespace-nowrap">
                            {h.date}
                          </td>
                          {DIMENSIONS.map((d) => (
                            <td key={d} className="py-3 px-2 text-center">
                              <div className="flex justify-center">
                                <TrafficDot light={h.scores?.[d]?.light ?? "green"} />
                              </div>
                            </td>
                          ))}
                          <td className="py-3 pl-4 text-right">
                            <span
                              className={`font-data font-semibold ${
                                health >= 75
                                  ? "text-[#22c55e]"
                                  : health >= 50
                                  ? "text-[#eab308]"
                                  : "text-[#ef4444]"
                              }`}
                            >
                              {health}%
                            </span>
                          </td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </div>
          </SectionCard>
        ) : (
          <Card className="bg-surface border-border">
            <CardContent className="py-12 text-center text-sub">
              No history yet — fill in the Current Check above and click{" "}
              <span className="text-text font-medium">Save Check</span>.
            </CardContent>
          </Card>
        )}
      </div>
    </ToolPageWrapper>
  );
}
