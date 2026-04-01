"use client";

import { useRef, useMemo, useState } from "react";
import { create } from "zustand";
import { persist } from "zustand/middleware";
import {
  BarChart,
  Bar,
  XAxis,
  YAxis,
  CartesianGrid,
  Tooltip,
  ReferenceLine,
  ResponsiveContainer,
  ScatterChart,
  Scatter,
  Label as RechartsLabel,
} from "recharts";
import { ToolPageWrapper } from "@/components/layout/tool-page-wrapper";
import { ExportButton } from "@/components/shared/export-button";
import { AiPromptGenerator } from "@/components/shared/ai-prompt-generator";
import { generateCycleTimePrompts } from "@/lib/ai-prompts/cycle-time";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Badge } from "@/components/ui/badge";
import {
  Clock,
  Plus,
  Trash2,
  BarChart3,
  Target,
} from "lucide-react";

/* -------------------------------------------------------------------------- */
/*  Types                                                                     */
/* -------------------------------------------------------------------------- */

interface WorkItem {
  id: string;
  name: string;
  startDate: string;
  endDate: string;
}

interface CycleTimeStore {
  items: WorkItem[];
  addItem: () => void;
  removeItem: (id: string) => void;
  updateItem: (id: string, updates: Partial<Omit<WorkItem, "id">>) => void;
  reset: () => void;
}

/* -------------------------------------------------------------------------- */
/*  Helpers                                                                   */
/* -------------------------------------------------------------------------- */

function calcCycleTime(start: string, end: string): number | null {
  if (!start || !end) return null;
  const s = new Date(start).getTime();
  const e = new Date(end).getTime();
  if (isNaN(s) || isNaN(e) || e < s) return null;
  return Math.round((e - s) / (1000 * 60 * 60 * 24));
}

function percentile(sorted: number[], p: number): number {
  if (sorted.length === 0) return 0;
  const idx = Math.ceil((sorted.length * p) / 100) - 1;
  return sorted[Math.max(0, Math.min(idx, sorted.length - 1))];
}

function stdDev(values: number[]): number {
  if (values.length < 2) return 0;
  const mean = values.reduce((a, b) => a + b, 0) / values.length;
  const variance = values.reduce((s, v) => s + (v - mean) ** 2, 0) / values.length;
  return Math.sqrt(variance);
}

function round(v: number, d = 1) {
  return Math.round(v * 10 ** d) / 10 ** d;
}

const BUCKETS: { label: string; min: number; max: number }[] = [
  { label: "1 day", min: 1, max: 1 },
  { label: "2 days", min: 2, max: 2 },
  { label: "3-4 days", min: 3, max: 4 },
  { label: "5-7 days", min: 5, max: 7 },
  { label: "8-14 days", min: 8, max: 14 },
  { label: "15+ days", min: 15, max: Infinity },
];

const PERCENTILE_KEYS = [50, 75, 85, 90, 95, 99] as const;

/* -------------------------------------------------------------------------- */
/*  Store                                                                     */
/* -------------------------------------------------------------------------- */

const createItem = (): WorkItem => ({
  id: crypto.randomUUID(),
  name: "",
  startDate: "",
  endDate: "",
});

const useCycleTimeStore = create<CycleTimeStore>()(
  persist(
    (set) => ({
      items: [createItem()],

      addItem: () =>
        set((s) => ({ items: [...s.items, createItem()] })),

      removeItem: (id) =>
        set((s) => ({ items: s.items.filter((i) => i.id !== id) })),

      updateItem: (id, updates) =>
        set((s) => ({
          items: s.items.map((i) => (i.id === id ? { ...i, ...updates } : i)),
        })),

      reset: () => set({ items: [createItem()] }),
    }),
    { name: "agile-toolkit:cycle-time" }
  )
);

/* -------------------------------------------------------------------------- */
/*  Stat Card                                                                 */
/* -------------------------------------------------------------------------- */

function StatCard({
  label,
  value,
  unit,
  accent = false,
}: {
  label: string;
  value: string | number;
  unit?: string;
  accent?: boolean;
}) {
  return (
    <Card className="bg-surface border-border">
      <CardContent className="p-5">
        <p className="text-xs text-sub mb-2">{label}</p>
        <div className="flex items-baseline gap-1.5">
          <span
            className={`text-2xl font-data font-bold ${accent ? "text-accent" : "text-text"}`}
          >
            {value}
          </span>
          {unit && <span className="text-sm text-sub">{unit}</span>}
        </div>
      </CardContent>
    </Card>
  );
}

/* -------------------------------------------------------------------------- */
/*  Custom Tooltips                                                           */
/* -------------------------------------------------------------------------- */

function HistogramTooltip({
  active,
  payload,
}: {
  active?: boolean;
  payload?: Array<{ payload: { bucket: string; count: number } }>;
}) {
  if (!active || !payload?.length) return null;
  const d = payload[0].payload;
  return (
    <div className="bg-surface border border-border rounded-lg p-3 shadow-xl text-sm">
      <p className="text-sub mb-1">{d.bucket}</p>
      <p className="font-data font-bold text-accent">{d.count} items</p>
    </div>
  );
}

function ScatterTooltip({
  active,
  payload,
}: {
  active?: boolean;
  payload?: Array<{ payload: { idx: number; cycleTime: number; name: string } }>;
}) {
  if (!active || !payload?.length) return null;
  const d = payload[0].payload;
  return (
    <div className="bg-surface border border-border rounded-lg p-3 shadow-xl text-sm">
      <p className="text-sub mb-1">#{d.idx} — {d.name || "(unnamed)"}</p>
      <p className="font-data font-bold text-accent">{d.cycleTime} days</p>
    </div>
  );
}

/* -------------------------------------------------------------------------- */
/*  Main Client Component                                                     */
/* -------------------------------------------------------------------------- */

export function CycleTimeClient() {
  const { items, addItem, removeItem, updateItem, reset } = useCycleTimeStore();
  const exportRef = useRef<HTMLDivElement>(null);
  const [targetPct, setTargetPct] = useState(85);

  /* -- Computed cycle times ------------------------------------------------ */
  const itemsWithCT = useMemo(
    () =>
      items.map((item) => ({
        ...item,
        cycleTime: calcCycleTime(item.startDate, item.endDate),
      })),
    [items]
  );

  const validCycleTimes = useMemo(
    () =>
      itemsWithCT
        .filter((i): i is typeof i & { cycleTime: number } => i.cycleTime !== null)
        .map((i) => i.cycleTime),
    [itemsWithCT]
  );

  const sortedCT = useMemo(() => [...validCycleTimes].sort((a, b) => a - b), [validCycleTimes]);

  /* -- Stats --------------------------------------------------------------- */
  const stats = useMemo(() => {
    if (sortedCT.length === 0) {
      return { avg: 0, median: 0, p85: 0, stddev: 0 };
    }
    const avg = round(validCycleTimes.reduce((a, b) => a + b, 0) / validCycleTimes.length);
    const median = percentile(sortedCT, 50);
    const p85 = percentile(sortedCT, 85);
    const sd = round(stdDev(validCycleTimes));
    return { avg, median, p85, stddev: sd };
  }, [sortedCT, validCycleTimes]);

  /* -- Percentile map ------------------------------------------------------ */
  const percentileMap = useMemo(
    () =>
      Object.fromEntries(
        PERCENTILE_KEYS.map((p) => [p, percentile(sortedCT, p)])
      ) as Record<(typeof PERCENTILE_KEYS)[number], number>,
    [sortedCT]
  );

  /* -- SLE calculation ----------------------------------------------------- */
  const sleValue = useMemo(
    () => (sortedCT.length > 0 ? percentile(sortedCT, targetPct) : 0),
    [sortedCT, targetPct]
  );

  /* -- Histogram data ------------------------------------------------------ */
  const histogramData = useMemo(
    () =>
      BUCKETS.map((b) => ({
        bucket: b.label,
        count: validCycleTimes.filter((ct) => ct >= b.min && ct <= b.max).length,
      })),
    [validCycleTimes]
  );

  /* -- Scatter data -------------------------------------------------------- */
  const scatterData = useMemo(
    () =>
      itemsWithCT
        .filter((i): i is typeof i & { cycleTime: number } => i.cycleTime !== null)
        .map((item, idx) => ({
          idx: idx + 1,
          cycleTime: item.cycleTime,
          name: item.name,
        })),
    [itemsWithCT]
  );

  /* -- Export data --------------------------------------------------------- */
  const csvData = useMemo(() => ({
    headers: ["Item Name", "Start Date", "End Date", "Cycle Time (days)"],
    rows: itemsWithCT.map((i) => [
      i.name || "(unnamed)",
      i.startDate,
      i.endDate,
      i.cycleTime ?? "N/A",
    ]),
  }), [itemsWithCT]);

  const jsonData = useMemo(
    () => ({
      items: itemsWithCT.map((i) => ({
        name: i.name || "(unnamed)",
        startDate: i.startDate,
        endDate: i.endDate,
        cycleTime: i.cycleTime,
      })),
      stats,
      percentiles: percentileMap,
    }),
    [itemsWithCT, stats, percentileMap]
  );

  const promptConfig = useMemo(() => ({
    toolName: "Cycle Time Tracker",
    prompts: generateCycleTimePrompts({
      items: itemsWithCT
        .filter((i): i is typeof i & { cycleTime: number } => i.cycleTime !== null)
        .map((i) => ({ name: i.name, startDate: i.startDate, endDate: i.endDate, cycleTimeDays: i.cycleTime })),
      stats: { mean: stats.avg, median: stats.median, p85: stats.p85, p95: percentileMap[95], stdDev: stats.stddev },
    }),
  }), [itemsWithCT, stats, percentileMap]);

  /* -- Render -------------------------------------------------------------- */
  return (
    <ToolPageWrapper
      title="Cycle Time Analyzer"
      description="Analyze how long work items take to complete. Use histogram, scatter plot, and percentile data to set realistic Service Level Expectations."
      category="Metrics & Dashboards"
    >
      <div ref={exportRef} className="space-y-6">
        {/* ---- Stats ---- */}
        <div className="grid grid-cols-2 sm:grid-cols-4 gap-4">
          <StatCard label="Average" value={stats.avg} unit="days" accent />
          <StatCard label="Median (50th %ile)" value={stats.median} unit="days" />
          <StatCard label="85th Percentile" value={stats.p85} unit="days" accent />
          <StatCard label="Std Deviation" value={stats.stddev} unit="days" />
        </div>

        {/* ---- Charts Tabs ---- */}
        <Card className="bg-surface border-border">
          <CardHeader className="pb-2">
            <div className="flex items-center justify-between flex-wrap gap-2">
              <CardTitle className="flex items-center gap-2 text-lg font-display text-text">
                <Clock className="w-5 h-5 text-accent" />
                Analysis
              </CardTitle>
              <div className="flex items-center gap-2">
                <AiPromptGenerator config={promptConfig} />
                <ExportButton
                  filename="cycle-time"
                  csvData={csvData}
                  jsonData={jsonData}
                  targetRef={exportRef}
                />
              </div>
            </div>
          </CardHeader>
          <CardContent>
            {validCycleTimes.length === 0 ? (
              <div className="flex flex-col items-center justify-center h-64 text-sub gap-3">
                <BarChart3 className="w-12 h-12 opacity-20" />
                <p className="text-sm">Add items with start and end dates to see analysis</p>
              </div>
            ) : (
              <Tabs defaultValue="histogram">
                <TabsList className="bg-surface-deep border border-border mb-6">
                  <TabsTrigger
                    value="histogram"
                    className="gap-2 data-[state=active]:bg-accent/10 data-[state=active]:text-accent"
                  >
                    <BarChart3 className="w-4 h-4" />
                    Histogram
                  </TabsTrigger>
                  <TabsTrigger
                    value="scatter"
                    className="gap-2 data-[state=active]:bg-accent/10 data-[state=active]:text-accent"
                  >
                    <Target className="w-4 h-4" />
                    Scatter Plot
                  </TabsTrigger>
                  <TabsTrigger
                    value="sle"
                    className="gap-2 data-[state=active]:bg-accent/10 data-[state=active]:text-accent"
                  >
                    <Clock className="w-4 h-4" />
                    SLE
                  </TabsTrigger>
                </TabsList>

                {/* Tab 1: Histogram */}
                <TabsContent value="histogram">
                  <ResponsiveContainer width="100%" height={380}>
                    <BarChart
                      data={histogramData}
                      margin={{ top: 10, right: 20, left: 0, bottom: 0 }}
                    >
                      <CartesianGrid strokeDasharray="3 3" stroke="rgba(255,255,255,0.06)" />
                      <XAxis
                        dataKey="bucket"
                        tick={{ fill: "#94a3b8", fontSize: 11 }}
                        axisLine={{ stroke: "rgba(255,255,255,0.1)" }}
                        tickLine={false}
                      />
                      <YAxis
                        tick={{ fill: "#94a3b8", fontSize: 12 }}
                        axisLine={{ stroke: "rgba(255,255,255,0.1)" }}
                        tickLine={false}
                        allowDecimals={false}
                        label={{
                          value: "Items",
                          angle: -90,
                          position: "insideLeft",
                          fill: "#94a3b8",
                          fontSize: 12,
                        }}
                      />
                      <Tooltip content={<HistogramTooltip />} />
                      <Bar dataKey="count" fill="#00f0ff" fillOpacity={0.8} radius={[4, 4, 0, 0]} />
                      <ReferenceLine
                        x={BUCKETS.findIndex((b) => stats.median >= b.min && stats.median <= b.max) >= 0
                          ? BUCKETS[BUCKETS.findIndex((b) => stats.median >= b.min && stats.median <= b.max)].label
                          : undefined}
                        stroke="#00f0ff"
                        strokeDasharray="4 2"
                        label={{ value: "P50", fill: "#00f0ff", fontSize: 10 }}
                      />
                      <ReferenceLine
                        x={BUCKETS.findIndex((b) => stats.p85 >= b.min && stats.p85 <= b.max) >= 0
                          ? BUCKETS[BUCKETS.findIndex((b) => stats.p85 >= b.min && stats.p85 <= b.max)].label
                          : undefined}
                        stroke="#f59e0b"
                        strokeDasharray="4 2"
                        label={{ value: "P85", fill: "#f59e0b", fontSize: 10 }}
                      />
                      <ReferenceLine
                        x={BUCKETS.findIndex((b) => percentileMap[95] >= b.min && percentileMap[95] <= b.max) >= 0
                          ? BUCKETS[BUCKETS.findIndex((b) => percentileMap[95] >= b.min && percentileMap[95] <= b.max)].label
                          : undefined}
                        stroke="#ef4444"
                        strokeDasharray="4 2"
                        label={{ value: "P95", fill: "#ef4444", fontSize: 10 }}
                      />
                    </BarChart>
                  </ResponsiveContainer>
                  <div className="flex items-center gap-4 mt-3 text-xs text-sub">
                    <span className="flex items-center gap-1.5">
                      <span className="w-5 border-t border-dashed border-accent" />
                      P50 ({stats.median}d)
                    </span>
                    <span className="flex items-center gap-1.5">
                      <span className="w-5 border-t border-dashed border-amber-400" />
                      P85 ({stats.p85}d)
                    </span>
                    <span className="flex items-center gap-1.5">
                      <span className="w-5 border-t border-dashed border-red-500" />
                      P95 ({percentileMap[95]}d)
                    </span>
                  </div>
                </TabsContent>

                {/* Tab 2: Scatter Plot */}
                <TabsContent value="scatter">
                  <ResponsiveContainer width="100%" height={380}>
                    <ScatterChart margin={{ top: 10, right: 20, left: 0, bottom: 20 }}>
                      <CartesianGrid strokeDasharray="3 3" stroke="rgba(255,255,255,0.06)" />
                      <XAxis
                        dataKey="idx"
                        type="number"
                        name="Item #"
                        tick={{ fill: "#94a3b8", fontSize: 12 }}
                        axisLine={{ stroke: "rgba(255,255,255,0.1)" }}
                        tickLine={false}
                        allowDecimals={false}
                      >
                        <RechartsLabel value="Item #" offset={-10} position="insideBottom" fill="#94a3b8" fontSize={12} />
                      </XAxis>
                      <YAxis
                        dataKey="cycleTime"
                        type="number"
                        name="Days"
                        tick={{ fill: "#94a3b8", fontSize: 12 }}
                        axisLine={{ stroke: "rgba(255,255,255,0.1)" }}
                        tickLine={false}
                        label={{
                          value: "Cycle Time (days)",
                          angle: -90,
                          position: "insideLeft",
                          fill: "#94a3b8",
                          fontSize: 12,
                        }}
                      />
                      <Tooltip content={<ScatterTooltip />} />
                      <ReferenceLine
                        y={stats.median}
                        stroke="#00f0ff"
                        strokeDasharray="5 3"
                        label={{ value: `P50 (${stats.median}d)`, fill: "#00f0ff", fontSize: 10, position: "right" }}
                      />
                      <ReferenceLine
                        y={stats.p85}
                        stroke="#f59e0b"
                        strokeDasharray="5 3"
                        label={{ value: `P85 (${stats.p85}d)`, fill: "#f59e0b", fontSize: 10, position: "right" }}
                      />
                      <ReferenceLine
                        y={percentileMap[95]}
                        stroke="#ef4444"
                        strokeDasharray="5 3"
                        label={{ value: `P95 (${percentileMap[95]}d)`, fill: "#ef4444", fontSize: 10, position: "right" }}
                      />
                      <Scatter data={scatterData} fill="#00f0ff" fillOpacity={0.8} />
                    </ScatterChart>
                  </ResponsiveContainer>
                </TabsContent>

                {/* Tab 3: SLE */}
                <TabsContent value="sle">
                  <div className="space-y-6">
                    {/* SLE Statement */}
                    <div className="rounded-xl bg-accent/5 border border-accent/20 p-5 text-center">
                      <p className="text-sub text-sm mb-1">Service Level Expectation</p>
                      <p className="text-2xl font-display font-bold text-text">
                        <span className="text-accent">{targetPct}%</span>
                        {" "}of items complete within{" "}
                        <span className="text-[#00ff88]">{sleValue} days</span>
                      </p>
                    </div>

                    {/* Target % Input */}
                    <div className="flex items-end gap-3 max-w-xs">
                      <div className="flex-1 space-y-1.5">
                        <Label className="text-sub text-xs">Target Percentile (%)</Label>
                        <Input
                          type="number"
                          min={1}
                          max={99}
                          value={targetPct}
                          onChange={(e) => {
                            const v = Math.min(99, Math.max(1, Number(e.target.value)));
                            setTargetPct(v);
                          }}
                          className="bg-surface-deep border-border text-text font-data focus:border-accent/50"
                        />
                      </div>
                      <p className="text-xs text-sub pb-2.5">
                        = {sleValue} days
                      </p>
                    </div>

                    {/* Percentile Table */}
                    <div>
                      <p className="text-sm font-medium text-sub mb-3">All Percentile Thresholds</p>
                      <div className="overflow-hidden rounded-lg border border-border">
                        <table className="w-full text-sm">
                          <thead>
                            <tr className="border-b border-border bg-surface-deep">
                              <th className="text-left py-2.5 px-4 text-xs text-sub font-medium uppercase tracking-wider">
                                Percentile
                              </th>
                              <th className="text-right py-2.5 px-4 text-xs text-sub font-medium uppercase tracking-wider">
                                Cycle Time
                              </th>
                              <th className="text-left py-2.5 px-4 text-xs text-sub font-medium uppercase tracking-wider">
                                Interpretation
                              </th>
                            </tr>
                          </thead>
                          <tbody>
                            {PERCENTILE_KEYS.map((p, i) => {
                              const val = percentileMap[p];
                              const isTarget = p === targetPct;
                              return (
                                <tr
                                  key={p}
                                  className={`border-b border-border ${isTarget ? "bg-accent/5" : i % 2 === 0 ? "bg-transparent" : "bg-card-hover"}`}
                                >
                                  <td className="py-2.5 px-4 text-text font-data">
                                    {p}th
                                    {isTarget && (
                                      <Badge className="ml-2 text-xs bg-accent/10 text-accent border-accent/20">
                                        target
                                      </Badge>
                                    )}
                                  </td>
                                  <td className="py-2.5 px-4 text-right">
                                    <span
                                      className={`font-data font-bold ${
                                        p <= 50
                                          ? "text-accent"
                                          : p <= 85
                                          ? "text-amber-400"
                                          : "text-red-400"
                                      }`}
                                    >
                                      {val} days
                                    </span>
                                  </td>
                                  <td className="py-2.5 px-4 text-sub text-xs">
                                    {p === 50 && "Half of items finish within this time"}
                                    {p === 75 && "Most items finish within this time"}
                                    {p === 85 && "Recommended SLE target"}
                                    {p === 90 && "High-confidence commitment"}
                                    {p === 95 && "Very high confidence, near worst-case"}
                                    {p === 99 && "Near-maximum observed time"}
                                  </td>
                                </tr>
                              );
                            })}
                          </tbody>
                        </table>
                      </div>
                    </div>
                  </div>
                </TabsContent>
              </Tabs>
            )}
          </CardContent>
        </Card>

        {/* ---- Data Input Table ---- */}
        <Card className="bg-surface border-border">
          <CardHeader className="pb-3">
            <div className="flex items-center justify-between flex-wrap gap-2">
              <CardTitle className="flex items-center gap-2 text-base font-display text-text">
                <Clock className="w-4 h-4 text-accent" />
                Work Items
                <Badge variant="outline" className="border-border text-sub text-xs ml-1">
                  {validCycleTimes.length} / {items.length} with cycle time
                </Badge>
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
                  onClick={addItem}
                  className="gap-1.5 bg-accent/10 text-accent border border-accent/20 hover:bg-accent/20"
                >
                  <Plus className="w-4 h-4" />
                  Add Item
                </Button>
              </div>
            </div>
          </CardHeader>
          <CardContent>
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead>
                  <tr className="border-b border-border">
                    <th className="text-left py-2 pr-4 text-xs text-sub font-medium uppercase tracking-wider">
                      Item Name
                    </th>
                    <th className="text-left py-2 px-3 text-xs text-sub font-medium uppercase tracking-wider">
                      Start Date
                    </th>
                    <th className="text-left py-2 px-3 text-xs text-sub font-medium uppercase tracking-wider">
                      End Date
                    </th>
                    <th className="text-center py-2 px-3 text-xs text-sub font-medium uppercase tracking-wider">
                      Cycle Time
                    </th>
                    <th className="w-8" />
                  </tr>
                </thead>
                <tbody>
                  {itemsWithCT.map((item) => (
                    <tr key={item.id} className="border-b border-border hover:bg-card-hover">
                      <td className="py-2 pr-4">
                        <Input
                          placeholder="Feature or story name"
                          value={item.name}
                          onChange={(e) => updateItem(item.id, { name: e.target.value })}
                          className="h-8 bg-surface-deep border-border text-text focus:border-accent/50"
                        />
                      </td>
                      <td className="py-2 px-3">
                        <Input
                          type="date"
                          value={item.startDate}
                          onChange={(e) => updateItem(item.id, { startDate: e.target.value })}
                          className="h-8 w-36 bg-surface-deep border-border text-text focus:border-accent/50"
                        />
                      </td>
                      <td className="py-2 px-3">
                        <Input
                          type="date"
                          value={item.endDate}
                          onChange={(e) => updateItem(item.id, { endDate: e.target.value })}
                          className="h-8 w-36 bg-surface-deep border-border text-text focus:border-accent/50"
                        />
                      </td>
                      <td className="py-2 px-3 text-center">
                        {item.cycleTime !== null ? (
                          <span className="font-data font-semibold text-accent">
                            {item.cycleTime}d
                          </span>
                        ) : (
                          <span className="text-sub text-xs">—</span>
                        )}
                      </td>
                      <td className="py-2">
                        <button
                          onClick={() => removeItem(item.id)}
                          disabled={items.length === 1}
                          className="text-sub hover:text-red-400 transition-colors p-1 disabled:opacity-30"
                        >
                          <Trash2 className="w-4 h-4" />
                        </button>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </CardContent>
        </Card>
      </div>
    </ToolPageWrapper>
  );
}
