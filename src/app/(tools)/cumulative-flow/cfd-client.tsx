"use client";

import { useRef, useMemo, useState } from "react";
import { create } from "zustand";
import { persist } from "zustand/middleware";
import {
  AreaChart,
  Area,
  CartesianGrid,
  XAxis,
  YAxis,
  Tooltip,
  Legend,
  ReferenceLine,
  ResponsiveContainer,
} from "recharts";
import { ToolPageWrapper } from "@/components/layout/tool-page-wrapper";
import { ExportButton } from "@/components/shared/export-button";
import { AiPromptGenerator } from "@/components/shared/ai-prompt-generator";
import { generateCFDPrompts } from "@/lib/ai-prompts/cumulative-flow";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Badge } from "@/components/ui/badge";
import { Plus, Trash2, Layers, BarChart2, Settings2, AlertTriangle } from "lucide-react";

/* -------------------------------------------------------------------------- */
/*  Types                                                                     */
/* -------------------------------------------------------------------------- */

interface StatusColumn {
  id: string;
  name: string;
  color: string;
}

interface DataEntry {
  id: string;
  date: string;
  counts: Record<string, number>; // statusId -> count
}

interface CFDStore {
  columns: StatusColumn[];
  entries: DataEntry[];
  wipLimit: number | null;
  addColumn: (name: string) => void;
  removeColumn: (id: string) => void;
  renameColumn: (id: string, name: string) => void;
  addEntry: () => void;
  removeEntry: (id: string) => void;
  updateEntry: (id: string, updates: Partial<Omit<DataEntry, "id">>) => void;
  updateEntryCount: (entryId: string, statusId: string, count: number) => void;
  setWipLimit: (limit: number | null) => void;
  reset: () => void;
}

/* -------------------------------------------------------------------------- */
/*  Constants                                                                 */
/* -------------------------------------------------------------------------- */

const DEFAULT_COLORS = [
  "#64748b",
  "#00f0ff",
  "#ff00aa",
  "#00ff88",
  "#f59e0b",
  "#a855f7",
  "#f97316",
  "#3b82f6",
];

const DEFAULT_COLUMNS: StatusColumn[] = [
  { id: "col-1", name: "To Do", color: "#64748b" },
  { id: "col-2", name: "In Progress", color: "#00f0ff" },
  { id: "col-3", name: "In Review", color: "#ff00aa" },
  { id: "col-4", name: "Done", color: "#00ff88" },
];

const createEntry = (columns: StatusColumn[]): DataEntry => ({
  id: crypto.randomUUID(),
  date: new Date().toISOString().slice(0, 10),
  counts: Object.fromEntries(columns.map((c) => [c.id, 0])),
});

/* -------------------------------------------------------------------------- */
/*  Store                                                                     */
/* -------------------------------------------------------------------------- */

const useCFDStore = create<CFDStore>()(
  persist(
    (set) => ({
      columns: DEFAULT_COLUMNS,
      entries: [],
      wipLimit: null,

      addColumn: (name) =>
        set((s) => {
          const id = crypto.randomUUID();
          const color = DEFAULT_COLORS[s.columns.length % DEFAULT_COLORS.length];
          const newCol: StatusColumn = { id, name, color };
          return {
            columns: [...s.columns, newCol],
            entries: s.entries.map((e) => ({
              ...e,
              counts: { ...e.counts, [id]: 0 },
            })),
          };
        }),

      removeColumn: (id) =>
        set((s) => ({
          columns: s.columns.filter((c) => c.id !== id),
          entries: s.entries.map((e) => {
            const counts = { ...e.counts };
            delete counts[id];
            return { ...e, counts };
          }),
        })),

      renameColumn: (id, name) =>
        set((s) => ({
          columns: s.columns.map((c) => (c.id === id ? { ...c, name } : c)),
        })),

      addEntry: () =>
        set((s) => ({
          entries: [...s.entries, createEntry(s.columns)],
        })),

      removeEntry: (id) =>
        set((s) => ({ entries: s.entries.filter((e) => e.id !== id) })),

      updateEntry: (id, updates) =>
        set((s) => ({
          entries: s.entries.map((e) => (e.id === id ? { ...e, ...updates } : e)),
        })),

      updateEntryCount: (entryId, statusId, count) =>
        set((s) => ({
          entries: s.entries.map((e) =>
            e.id === entryId
              ? { ...e, counts: { ...e.counts, [statusId]: Math.max(0, count) } }
              : e
          ),
        })),

      setWipLimit: (limit) => set({ wipLimit: limit }),

      reset: () =>
        set({ columns: DEFAULT_COLUMNS, entries: [], wipLimit: null }),
    }),
    { name: "agile-toolkit:cumulative-flow" }
  )
);

/* -------------------------------------------------------------------------- */
/*  Tooltip                                                                   */
/* -------------------------------------------------------------------------- */

function CFDTooltip({ active, payload, label }: {
  active?: boolean;
  payload?: Array<{ name: string; value: number; color: string }>;
  label?: string;
}) {
  if (!active || !payload?.length) return null;
  const total = payload.reduce((s, p) => s + (p.value ?? 0), 0);
  return (
    <div className="bg-surface border border-border rounded-lg p-3 shadow-xl text-sm">
      <p className="text-sub font-medium mb-2">{label}</p>
      {[...payload].reverse().map((p) => (
        <div key={p.name} className="flex items-center justify-between gap-6 mb-1">
          <div className="flex items-center gap-2">
            <span className="w-2.5 h-2.5 rounded-sm" style={{ background: p.color }} />
            <span className="text-sub">{p.name}</span>
          </div>
          <span className="font-data font-semibold text-text">{p.value}</span>
        </div>
      ))}
      <div className="mt-2 pt-2 border-t border-border flex justify-between">
        <span className="text-sub">Total</span>
        <span className="font-data font-bold text-accent">{total}</span>
      </div>
    </div>
  );
}

/* -------------------------------------------------------------------------- */
/*  Stat Card                                                                 */
/* -------------------------------------------------------------------------- */

function StatCard({
  label,
  value,
  unit,
  accent = false,
  warning = false,
}: {
  label: string;
  value: string | number;
  unit?: string;
  accent?: boolean;
  warning?: boolean;
}) {
  return (
    <Card className="bg-surface border-border">
      <CardContent className="p-5">
        <p className="text-xs text-sub mb-2">{label}</p>
        <div className="flex items-baseline gap-1.5">
          <span
            className={`text-2xl font-data font-bold ${
              warning
                ? "text-amber-400"
                : accent
                ? "text-accent"
                : "text-text"
            }`}
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
/*  Main Client Component                                                     */
/* -------------------------------------------------------------------------- */

export function CFDClient() {
  const {
    columns,
    entries,
    wipLimit,
    addColumn,
    removeColumn,
    renameColumn,
    addEntry,
    removeEntry,
    updateEntry,
    updateEntryCount,
    setWipLimit,
    reset,
  } = useCFDStore();

  const exportRef = useRef<HTMLDivElement>(null);
  const [newColName, setNewColName] = useState("");
  const [wipInput, setWipInput] = useState(wipLimit?.toString() ?? "");

  /* -- Sorted entries by date --------------------------------------------- */
  const sortedEntries = useMemo(
    () => [...entries].sort((a, b) => a.date.localeCompare(b.date)),
    [entries]
  );

  /* -- Chart data ---------------------------------------------------------- */
  const chartData = useMemo(
    () =>
      sortedEntries.map((e) => ({
        date: e.date,
        ...Object.fromEntries(columns.map((c) => [c.name, e.counts[c.id] ?? 0])),
      })),
    [sortedEntries, columns]
  );

  /* -- Stats --------------------------------------------------------------- */
  const stats = useMemo(() => {
    if (sortedEntries.length === 0) {
      return { totalItems: 0, wipItems: 0, wipPct: 0, doneItems: 0, cycleEff: 0 };
    }
    const latest = sortedEntries[sortedEntries.length - 1];
    const totalItems = columns.reduce((s, c) => s + (latest.counts[c.id] ?? 0), 0);

    // WIP = everything except first (backlog/todo) and last (done) columns
    const wipCols = columns.slice(1, columns.length - 1);
    const wipItems = wipCols.reduce((s, c) => s + (latest.counts[c.id] ?? 0), 0);
    const wipPct = totalItems > 0 ? Math.round((wipItems / totalItems) * 100) : 0;

    const lastCol = columns[columns.length - 1];
    const doneItems = lastCol ? (latest.counts[lastCol.id] ?? 0) : 0;

    // Cycle efficiency = Done / Total (higher = better throughput)
    const cycleEff = totalItems > 0 ? Math.round((doneItems / totalItems) * 100) : 0;

    return { totalItems, wipItems, wipPct, doneItems, cycleEff };
  }, [sortedEntries, columns]);

  /* -- WIP limit apply ---------------------------------------------------- */
  const applyWipLimit = () => {
    const v = parseInt(wipInput, 10);
    setWipLimit(isNaN(v) || v <= 0 ? null : v);
  };

  /* -- Export data --------------------------------------------------------- */
  const csvData = useMemo(() => {
    const headers = ["Date", ...columns.map((c) => c.name)];
    const rows = sortedEntries.map((e) => [
      e.date,
      ...columns.map((c) => e.counts[c.id] ?? 0),
    ]);
    return { headers, rows };
  }, [sortedEntries, columns]);

  const jsonData = useMemo(
    () => ({ columns: columns.map((c) => c.name), entries: chartData }),
    [columns, chartData]
  );

  const promptConfig = useMemo(() => ({
    toolName: "Cumulative Flow Diagram",
    prompts: generateCFDPrompts({ columns, entries, wipLimit }),
  }), [columns, entries, wipLimit]);

  /* -- Add column handler -------------------------------------------------- */
  const handleAddColumn = () => {
    const name = newColName.trim();
    if (!name) return;
    addColumn(name);
    setNewColName("");
  };

  /* -- Render -------------------------------------------------------------- */
  return (
    <ToolPageWrapper
      title="Cumulative Flow Diagram"
      description="Visualize work item flow through your process stages. Widening bands indicate bottlenecks; narrowing bands show increased throughput."
      category="Metrics & Dashboards"
    >
      <div ref={exportRef} className="space-y-6">
        {/* ---- Stats ---- */}
        <div className="grid grid-cols-2 sm:grid-cols-4 gap-4">
          <StatCard label="Total Items (latest)" value={stats.totalItems} accent />
          <StatCard label="WIP Items" value={stats.wipItems} unit={`(${stats.wipPct}%)`} warning={wipLimit !== null && stats.wipItems > wipLimit} />
          <StatCard label="Done Items" value={stats.doneItems} accent />
          <StatCard label="Cycle Efficiency" value={`${stats.cycleEff}%`} accent={stats.cycleEff >= 50} />
        </div>

        {/* ---- Chart ---- */}
        <Card className="bg-surface border-border">
          <CardHeader className="pb-2">
            <div className="flex items-center justify-between flex-wrap gap-2">
              <CardTitle className="flex items-center gap-2 text-lg font-display text-text">
                <Layers className="w-5 h-5 text-accent" />
                Flow Diagram
              </CardTitle>
              <div className="flex items-center gap-2">
                <AiPromptGenerator config={promptConfig} />
                <ExportButton
                  filename="cumulative-flow"
                  csvData={csvData}
                  jsonData={jsonData}
                  targetRef={exportRef}
                />
                <Button
                  variant="ghost"
                  size="sm"
                  onClick={reset}
                  className="text-sub hover:text-red-400 hover:bg-red-400/10"
                >
                  Reset
                </Button>
              </div>
            </div>
          </CardHeader>
          <CardContent>
            {chartData.length === 0 ? (
              <div className="flex flex-col items-center justify-center h-64 text-sub gap-3">
                <BarChart2 className="w-12 h-12 opacity-20" />
                <p className="text-sm">Add date entries below to see the chart</p>
              </div>
            ) : (
              <ResponsiveContainer width="100%" height={400}>
                <AreaChart data={chartData} margin={{ top: 10, right: 20, left: 0, bottom: 0 }}>
                  <CartesianGrid strokeDasharray="3 3" stroke="rgba(255,255,255,0.06)" />
                  <XAxis
                    dataKey="date"
                    tick={{ fill: "#94a3b8", fontSize: 12 }}
                    axisLine={{ stroke: "rgba(255,255,255,0.1)" }}
                    tickLine={false}
                  />
                  <YAxis
                    tick={{ fill: "#94a3b8", fontSize: 12 }}
                    axisLine={{ stroke: "rgba(255,255,255,0.1)" }}
                    tickLine={false}
                    allowDecimals={false}
                  />
                  <Tooltip content={<CFDTooltip />} />
                  <Legend
                    wrapperStyle={{ fontSize: 12, color: "#94a3b8", paddingTop: 12 }}
                  />
                  {wipLimit !== null && (
                    <ReferenceLine
                      y={wipLimit}
                      stroke="#ef4444"
                      strokeDasharray="6 3"
                      label={{ value: `WIP Limit: ${wipLimit}`, fill: "#ef4444", fontSize: 11 }}
                    />
                  )}
                  {columns.map((col) => (
                    <Area
                      key={col.id}
                      type="monotone"
                      dataKey={col.name}
                      stackId="1"
                      stroke={col.color}
                      fill={col.color}
                      fillOpacity={0.55}
                      strokeWidth={2}
                    />
                  ))}
                </AreaChart>
              </ResponsiveContainer>
            )}
          </CardContent>
        </Card>

        {/* ---- WIP Limit ---- */}
        <Card className="bg-surface border-border">
          <CardHeader className="pb-3">
            <CardTitle className="flex items-center gap-2 text-base font-display text-text">
              <AlertTriangle className="w-4 h-4 text-amber-400" />
              WIP Limit (optional)
            </CardTitle>
          </CardHeader>
          <CardContent>
            <div className="flex items-end gap-3 max-w-xs">
              <div className="flex-1 space-y-1.5">
                <Label className="text-sub text-xs">Max WIP Items</Label>
                <Input
                  type="number"
                  min={1}
                  placeholder="e.g. 10"
                  value={wipInput}
                  onChange={(e) => setWipInput(e.target.value)}
                  className="bg-surface-deep border-border text-text font-data focus:border-accent/50"
                />
              </div>
              <Button
                size="sm"
                onClick={applyWipLimit}
                className="bg-amber-500/10 text-amber-400 border border-amber-500/20 hover:bg-amber-500/20"
              >
                Apply
              </Button>
              {wipLimit !== null && (
                <Button
                  size="sm"
                  variant="ghost"
                  onClick={() => { setWipLimit(null); setWipInput(""); }}
                  className="text-sub hover:text-red-400 hover:bg-red-400/10"
                >
                  Clear
                </Button>
              )}
            </div>
            {wipLimit !== null && (
              <p className="mt-2 text-xs text-amber-400">
                WIP limit set at {wipLimit} items — red reference line shown on chart.
              </p>
            )}
          </CardContent>
        </Card>

        {/* ---- Column Configuration ---- */}
        <Card className="bg-surface border-border">
          <CardHeader className="pb-3">
            <CardTitle className="flex items-center gap-2 text-base font-display text-text">
              <Settings2 className="w-4 h-4 text-accent" />
              Status Columns
            </CardTitle>
          </CardHeader>
          <CardContent className="space-y-4">
            <div className="flex flex-wrap gap-2">
              {columns.map((col, idx) => (
                <div
                  key={col.id}
                  className="flex items-center gap-2 bg-surface-deep border border-border rounded-lg px-3 py-2"
                >
                  <span
                    className="w-3 h-3 rounded-full flex-shrink-0"
                    style={{ background: col.color }}
                  />
                  <Input
                    value={col.name}
                    onChange={(e) => renameColumn(col.id, e.target.value)}
                    className="h-7 w-28 bg-transparent border-none p-0 text-sm text-text focus:ring-0 focus:outline-none"
                  />
                  {columns.length > 2 && (
                    <button
                      onClick={() => removeColumn(col.id)}
                      className="text-sub hover:text-red-400 transition-colors ml-1"
                      title="Remove column"
                    >
                      <Trash2 className="w-3.5 h-3.5" />
                    </button>
                  )}
                  {idx === 0 && (
                    <Badge variant="outline" className="text-xs border-border text-sub ml-1">
                      start
                    </Badge>
                  )}
                  {idx === columns.length - 1 && (
                    <Badge variant="outline" className="text-xs border-border text-sub ml-1">
                      done
                    </Badge>
                  )}
                </div>
              ))}
            </div>
            <div className="flex items-center gap-2 max-w-xs">
              <Input
                placeholder="New status name…"
                value={newColName}
                onChange={(e) => setNewColName(e.target.value)}
                onKeyDown={(e) => e.key === "Enter" && handleAddColumn()}
                className="bg-surface-deep border-border text-text focus:border-accent/50"
              />
              <Button
                size="sm"
                onClick={handleAddColumn}
                disabled={!newColName.trim()}
                className="gap-1 bg-accent/10 text-accent border border-accent/20 hover:bg-accent/20 disabled:opacity-40"
              >
                <Plus className="w-4 h-4" />
                Add
              </Button>
            </div>
          </CardContent>
        </Card>

        {/* ---- Data Entry Table ---- */}
        <Card className="bg-surface border-border">
          <CardHeader className="pb-3">
            <div className="flex items-center justify-between">
              <CardTitle className="flex items-center gap-2 text-base font-display text-text">
                <BarChart2 className="w-4 h-4 text-accent" />
                Data Entries
              </CardTitle>
              <Button
                size="sm"
                onClick={addEntry}
                className="gap-1.5 bg-accent/10 text-accent border border-accent/20 hover:bg-accent/20"
              >
                <Plus className="w-4 h-4" />
                Add Date
              </Button>
            </div>
          </CardHeader>
          <CardContent>
            {entries.length === 0 ? (
              <p className="text-sm text-sub text-center py-6">
                No entries yet. Click &ldquo;Add Date&rdquo; to start tracking.
              </p>
            ) : (
              <div className="overflow-x-auto">
                <table className="w-full text-sm">
                  <thead>
                    <tr className="border-b border-border">
                      <th className="text-left py-2 pr-4 text-xs text-sub font-medium uppercase tracking-wider">
                        Date
                      </th>
                      {columns.map((col) => (
                        <th
                          key={col.id}
                          className="text-center py-2 px-3 text-xs font-medium uppercase tracking-wider whitespace-nowrap"
                          style={{ color: col.color }}
                        >
                          {col.name}
                        </th>
                      ))}
                      <th className="w-8" />
                    </tr>
                  </thead>
                  <tbody>
                    {sortedEntries.map((entry) => (
                      <tr key={entry.id} className="border-b border-border hover:bg-card">
                        <td className="py-2 pr-4">
                          <Input
                            type="date"
                            value={entry.date}
                            onChange={(e) =>
                              updateEntry(entry.id, { date: e.target.value })
                            }
                            className="h-8 w-36 bg-surface-deep border-border text-text text-sm focus:border-accent/50"
                          />
                        </td>
                        {columns.map((col) => (
                          <td key={col.id} className="py-2 px-3 text-center">
                            <Input
                              type="number"
                              min={0}
                              value={entry.counts[col.id] ?? 0}
                              onChange={(e) =>
                                updateEntryCount(entry.id, col.id, Number(e.target.value))
                              }
                              className="h-8 w-20 mx-auto bg-surface-deep border-border text-text font-data text-center focus:border-accent/50"
                            />
                          </td>
                        ))}
                        <td className="py-2">
                          <button
                            onClick={() => removeEntry(entry.id)}
                            className="text-sub hover:text-red-400 transition-colors p-1"
                          >
                            <Trash2 className="w-4 h-4" />
                          </button>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </CardContent>
        </Card>
      </div>
    </ToolPageWrapper>
  );
}
