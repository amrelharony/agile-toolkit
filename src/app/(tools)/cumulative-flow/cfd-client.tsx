"use client";

import { useId, useRef, useMemo, useState, useEffect } from "react";
import { ToolPageWrapper } from "@/components/layout/tool-page-wrapper";
import { ExportButton } from "@/components/shared/export-button";
import { AiPromptGenerator } from "@/components/shared/ai-prompt-generator";
import type { CausalAnnotationData } from "@/components/charts/causal-annotation";
import { generateCFDPrompts } from "@/lib/ai-prompts/cumulative-flow";
import { xmrLimits, westernElectricRules } from "@/lib/analytics/control-chart";
import { cusum } from "@/lib/analytics/changepoint";
import { mannKendall } from "@/lib/analytics/trend-test";
import { todayLocalISO } from "@/lib/utils/formatters";
import { useHistoryLogger } from "@/lib/history/use-history-logger";
import { CFD_ACTIONS } from "@/lib/history/event-actions";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { BlurInput, BlurTextarea } from "@/components/shared/blur-fields";
import { Label } from "@/components/ui/label";
import { Badge } from "@/components/ui/badge";
import { Plus, Trash2, Layers, Settings2, AlertTriangle } from "lucide-react";
import { toast } from "@/lib/utils/toast";
import { MIN_XMR_SAMPLES } from "./constants";
import { useCFDStore } from "./use-cfd-store";
import { StatCard } from "./components/stat-card";
import { FlowChart } from "./components/flow-chart";
import { WipControlChart } from "./components/wip-control-chart";
import { DataEntryTable } from "./components/data-entry-table";

export function CFDClient() {
  const {
    columns,
    entries,
    wipLimit,
    addColumn: addColumnRaw,
    removeColumn: removeColumnRaw,
    renameColumn,
    setColumnDescription,
    addEntry: addEntryRaw,
    removeEntry,
    updateEntry,
    updateEntryCount,
    setWipLimit,
    reset: resetRaw,
  } = useCFDStore();
  const { log } = useHistoryLogger("cumulative-flow");

  const addColumn: typeof addColumnRaw = (name, description) => {
    addColumnRaw(name, description);
    log(CFD_ACTIONS.COLUMN_ADDED, { name, description });
  };
  const removeColumn: typeof removeColumnRaw = (id) => {
    const col = columns.find((c) => c.id === id);
    removeColumnRaw(id);
    log(CFD_ACTIONS.COLUMN_REMOVED, { name: col?.name });
  };
  const addEntry: typeof addEntryRaw = () => {
    // Reject a duplicate snapshot for today — the chart's date axis collapses
    // same-date entries onto one tick, so a second blank entry just shadows
    // the first and is impossible to tell apart visually. Warn the user via
    // a toast instead of silently appending an invisible row.
    const todayIso = todayLocalISO();
    const existing = useCFDStore.getState().entries.find((e) => e.date === todayIso);
    if (existing) {
      toast.warning("A snapshot for today already exists — edit it instead of duplicating.");
      return;
    }
    addEntryRaw();
    const fresh = useCFDStore.getState().entries;
    log(CFD_ACTIONS.SNAPSHOT_LOGGED, { entryCount: fresh.length });
  };
  const reset = () => {
    resetRaw();
    log(CFD_ACTIONS.CFD_RESET, {});
  };

  const exportRef = useRef<HTMLDivElement>(null);
  const [newColName, setNewColName] = useState("");
  const [newColDescription, setNewColDescription] = useState("");
  const [wipInput, setWipInput] = useState(wipLimit?.toString() ?? "");
  const wipInputId = useId();

  // Sync wipInput whenever wipLimit changes from a source other than this
  // input (initial hydration, Clear button, undo/redo). The previous version
  // only synced on the first hydration (null → number) and missed every
  // subsequent external change, so the displayed text drifted from state.
  // Compare via string form to (a) treat null/"" as equivalent and (b) avoid
  // a feedback loop where the user-typed "10" gets re-set to "10".
  const prevWipString = useRef<string>(wipLimit?.toString() ?? "");
  useEffect(() => {
    const next = wipLimit?.toString() ?? "";
    if (next !== prevWipString.current) {
      prevWipString.current = next;
      // Only mirror into the input if the input doesn't already match — this
      // avoids clobbering an in-progress edit (e.g. user typing "12" while a
      // store-side update arrives).
      setWipInput((cur) => (cur === next ? cur : next));
    }
  }, [wipLimit]);

  /* -- Sorted entries by date --------------------------------------------- */
  const sortedEntries = useMemo(
    () => [...entries].sort((a, b) => a.date.localeCompare(b.date)),
    [entries]
  );

  /* -- Chart data ---------------------------------------------------------- */
  const chartData = useMemo<Record<string, string | number>[]>(
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

    // WIP = everything except first (backlog/todo) and last (done) columns.
    // R5: when `columns.length < 3`, `slice(1, len-1)` is empty and the
    // WIP stats collapse to 0 — but doneItems still counts. The result
    // was a misleading "0% WIP, 100% efficient" display. Treat <3 cols
    // as N/A (return null sentinel so the UI can render "—").
    const wipCols = columns.length >= 3 ? columns.slice(1, columns.length - 1) : [];
    const wipItems = wipCols.reduce((s, c) => s + (latest.counts[c.id] ?? 0), 0);
    const wipPct =
      columns.length < 3 ? null : totalItems > 0 ? Math.round((wipItems / totalItems) * 100) : 0;

    const lastCol = columns[columns.length - 1];
    const doneItems = lastCol ? (latest.counts[lastCol.id] ?? 0) : 0;

    // Cycle efficiency = Done / Total (higher = better throughput)
    const cycleEff = totalItems > 0 ? Math.round((doneItems / totalItems) * 100) : 0;

    return { totalItems, wipItems, wipPct, doneItems, cycleEff };
  }, [sortedEntries, columns]);

  /* -- Phase-15: WIP series across snapshots ------------------------------ */
  // The WIP definition mirrors the `stats` memo — everything except the
  // first (backlog/todo) and last (done) columns. Returns one (date, count)
  // per snapshot in chronological order so analytics primitives can chew on
  // it directly.
  const wipSeries = useMemo(() => {
    if (sortedEntries.length === 0 || columns.length < 3) return [];
    const wipColIds = columns.slice(1, columns.length - 1).map((c) => c.id);
    return sortedEntries.map((e) => ({
      date: e.date,
      value: wipColIds.reduce((s, id) => s + (e.counts[id] ?? 0), 0),
    }));
  }, [sortedEntries, columns]);

  const wipValues = useMemo(() => wipSeries.map((p) => p.value), [wipSeries]);

  const wipLimits = useMemo(
    // WIP is a non-negative count; clamp LCL at 0.
    () => (wipValues.length >= MIN_XMR_SAMPLES ? xmrLimits(wipValues, true) : null),
    [wipValues]
  );

  // Western Electric out-of-control signals on the WIP series. We only run
  // the rules when xmrLimits returned valid (non-degenerate) limits — rule-1
  // ("point beyond ±3σ") is meaningless when ucl == centerLine, and the
  // ≥8 samples gate on wipLimits already covers the statistical-validity
  // requirement for the rules themselves.
  const wipSignals = useMemo(() => {
    if (!wipLimits) return [] as ReturnType<typeof westernElectricRules>;
    if (wipLimits.ucl <= wipLimits.centerLine) return [] as ReturnType<typeof westernElectricRules>;
    return westernElectricRules(wipValues, wipLimits);
  }, [wipValues, wipLimits]);

  // CUSUM regime shifts on WIP — primitive guards length<4 internally.
  const wipCusumAnnotations = useMemo<CausalAnnotationData[]>(() => {
    if (wipValues.length < 4) return [];
    return cusum(wipValues).map((cp) => {
      const point = wipSeries[cp.index];
      return {
        x: point?.date ?? cp.index,
        label: cp.direction === "up" ? "WIP regime up" : "WIP regime down",
        detail: `CUSUM detected a sustained ${cp.direction === "up" ? "increase" : "decrease"} in WIP at ${point?.date ?? `index ${cp.index}`}.`,
        // CUSUM cumulativeStat is signed: positive for upward regime
        // shifts, negative for downward. The prior `>= 6` test missed
        // downward shifts entirely (they'd always read "moderate"
        // regardless of magnitude). Use absolute value to match the
        // intent of "strong vs borderline signal".
        confidence: Math.abs(cp.cumulativeStat) >= 6 ? "strong" : "moderate",
      };
    });
  }, [wipValues, wipSeries]);

  // Mann-Kendall trend chip — needs n>=5 for a meaningful p-value.
  const wipTrend = useMemo(
    () => (wipValues.length >= 5 ? mannKendall(wipValues) : null),
    [wipValues]
  );

  /* -- WIP limit apply ---------------------------------------------------- */
  const applyWipLimit = () => {
    const v = parseInt(wipInput, 10);
    setWipLimit(isNaN(v) || v <= 0 ? null : v);
  };

  /* -- Export data --------------------------------------------------------- */
  const csvData = useMemo(() => {
    const headers = ["Date", ...columns.map((c) => c.name), "Note"];
    const rows = sortedEntries.map((e) => [
      e.date,
      ...columns.map((c) => e.counts[c.id] ?? 0),
      e.description ?? "",
    ]);
    return { headers, rows };
  }, [sortedEntries, columns]);

  const jsonData = useMemo(
    () => ({
      columns: columns.map((c) => ({ name: c.name, description: c.description })),
      entries: sortedEntries.map((e) => ({
        date: e.date,
        description: e.description,
        counts: Object.fromEntries(columns.map((c) => [c.name, e.counts[c.id] ?? 0])),
      })),
    }),
    [columns, sortedEntries]
  );

  const promptConfig = useMemo(
    () => ({
      toolName: "Cumulative Flow Diagram",
      prompts: generateCFDPrompts({ columns, entries, wipLimit }),
    }),
    [columns, entries, wipLimit]
  );

  /* -- Add column handler -------------------------------------------------- */
  const handleAddColumn = () => {
    const name = newColName.trim();
    if (!name) return;
    // Reject case-insensitive duplicate column names. The chart's `dataKey`
    // and the chartData accumulator key by `column.name`, so a second column
    // with the same name silently merges into the first (and Recharts only
    // renders one Area). Surface this to the user via a toast instead.
    if (columns.some((c) => c.name.toLowerCase() === name.toLowerCase())) {
      toast.warning(`A column named "${name}" already exists.`);
      return;
    }
    const description = newColDescription.trim() || undefined;
    addColumn(name, description);
    setNewColName("");
    setNewColDescription("");
  };

  /* -- Render -------------------------------------------------------------- */
  return (
    <ToolPageWrapper
      toolId="cumulative-flow"
      title="Cumulative Flow Diagram"
      description="Visualize work item flow through your process stages. Widening bands indicate bottlenecks; narrowing bands show increased throughput."
      category="Metrics & Dashboards"
    >
      <div ref={exportRef} className="space-y-6">
        {/* ---- Stats ---- */}
        <div className="grid grid-cols-2 sm:grid-cols-4 gap-4">
          <StatCard label="Total Items (latest)" value={stats.totalItems} accent />
          <StatCard
            label="WIP Items"
            value={stats.wipItems}
            unit={stats.wipPct === null ? "(n/a — add a middle column)" : `(${stats.wipPct}%)`}
            warning={wipLimit !== null && stats.wipItems > wipLimit}
            trailing={
              wipTrend?.significant ? (
                <span
                  className={`text-xs font-mono uppercase tracking-wider px-1.5 py-0.5 rounded border ${
                    // For WIP, "down" is good (less queue), "up" is concerning.
                    wipTrend.trend === "down"
                      ? "border-accent-green/40 text-accent-green bg-accent-green/10"
                      : "border-warning/40 text-warning bg-warning/10"
                  }`}
                  title={`Mann-Kendall p=${wipTrend.pValue.toFixed(3)}`}
                >
                  <span aria-hidden="true">{wipTrend.trend === "up" ? "↗ trend" : "↘ trend"}</span>
                  <span className="sr-only">{`WIP trend ${wipTrend.trend} (Mann-Kendall p=${wipTrend.pValue.toFixed(3)})`}</span>
                </span>
              ) : undefined
            }
          />
          <StatCard label="Done Items" value={stats.doneItems} accent />
          <StatCard
            label="Cycle Efficiency"
            value={`${stats.cycleEff}%`}
            accent={stats.cycleEff >= 50}
          />
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
                <Button variant="danger-ghost" size="sm" onClick={reset}>
                  Reset
                </Button>
              </div>
            </div>
          </CardHeader>
          <CardContent>
            <FlowChart chartData={chartData} columns={columns} wipLimit={wipLimit} />
          </CardContent>
        </Card>

        {/* ---- WIP control chart (XmR + CUSUM) ---- */}
        {/* Standalone view of in-progress (WIP) over time. Hidden when the
            source series is too short to be meaningful. */}
        {wipSeries.length >= 2 && (
          <WipControlChart
            wipSeries={wipSeries}
            wipLimits={wipLimits}
            cusumAnnotations={wipCusumAnnotations}
            signals={wipSignals}
          />
        )}

        {/* ---- WIP Limit ---- */}
        <Card className="bg-surface border-border">
          <CardHeader className="pb-3">
            <CardTitle className="flex items-center gap-2 text-base font-display text-text">
              <AlertTriangle className="w-4 h-4 text-warning" />
              WIP Limit (optional)
            </CardTitle>
          </CardHeader>
          <CardContent>
            <div className="flex items-end gap-3 max-w-xs">
              <div className="flex-1 space-y-1.5">
                <Label htmlFor={wipInputId} className="text-sub text-xs">
                  Max WIP Items
                </Label>
                <Input
                  id={wipInputId}
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
                className="bg-warning/10 text-warning border border-warning/20 hover:bg-warning/20"
              >
                Apply
              </Button>
              {wipLimit !== null && (
                <Button
                  size="sm"
                  variant="danger-ghost"
                  onClick={() => {
                    setWipLimit(null);
                    setWipInput("");
                  }}
                >
                  Clear
                </Button>
              )}
            </div>
            {wipLimit !== null && (
              <p className="mt-2 text-xs text-warning">
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
            <div className="flex flex-col gap-2">
              {columns.map((col, idx) => (
                <div
                  key={col.id}
                  className="flex flex-col gap-2 bg-surface-deep border border-border rounded-lg px-3 py-2"
                >
                  <div className="flex items-center gap-2">
                    <span
                      className="w-3 h-3 rounded-full flex-shrink-0"
                      style={{ background: col.color }}
                      aria-hidden="true"
                    />
                    {/* Commit on blur, like the description field below.
                        `renameColumn` trims and rejects empty/duplicate names,
                        so the committed name often equals the current one —
                        React then bails out of the re-render and restores the
                        old text into the DOM node, making a trailing space (or
                        any in-progress edit) impossible to type. */}
                    <BlurInput
                      value={col.name}
                      onCommit={(v) => renameColumn(col.id, v)}
                      aria-label={`Name for column ${idx + 1}`}
                      className="h-7 w-32 bg-transparent border-none p-0 text-sm text-text focus:ring-0 focus:outline-none"
                    />
                    {columns.length > 2 && (
                      <button
                        type="button"
                        onClick={() => removeColumn(col.id)}
                        className="min-touch-coarse -m-1 p-1 text-sub hover:text-danger transition-colors ml-1"
                        title="Remove column"
                        aria-label={`Remove column ${col.name}`}
                      >
                        <Trash2 className="w-3.5 h-3.5" aria-hidden="true" />
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
                  <BlurTextarea
                    value={col.description ?? ""}
                    onCommit={(v) => setColumnDescription(col.id, v.trim() ? v : undefined)}
                    placeholder="Column purpose / definition (optional)..."
                    rows={2}
                    className="bg-surface border-border resize-none text-xs text-text"
                    aria-label={`Description for ${col.name}`}
                  />
                </div>
              ))}
            </div>
            {/* New column form — name input + Add on row 1, optional description Textarea below.
                Cmd/Ctrl+Enter on the Textarea submits to match the kanban pattern. */}
            <div className="flex flex-col gap-2 max-w-md">
              <div className="flex items-center gap-2">
                <Input
                  placeholder="New status name…"
                  aria-label="New status name"
                  value={newColName}
                  onChange={(e) => setNewColName(e.target.value)}
                  onKeyDown={(e) => e.key === "Enter" && handleAddColumn()}
                  className="input-toolkit"
                />
                <Button
                  size="sm"
                  variant="toolkit"
                  onClick={handleAddColumn}
                  disabled={!newColName.trim()}
                  className="gap-1"
                >
                  <Plus className="w-4 h-4" />
                  Add
                </Button>
              </div>
              <Textarea
                value={newColDescription}
                onChange={(e) => setNewColDescription(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === "Enter" && (e.metaKey || e.ctrlKey)) handleAddColumn();
                }}
                placeholder="Description (optional)..."
                rows={2}
                className="bg-surface-deep border-border resize-none text-xs text-text"
                aria-label="New column description"
              />
            </div>
          </CardContent>
        </Card>

        {/* ---- Data Entry Table ---- */}
        <DataEntryTable
          sortedEntries={sortedEntries}
          columns={columns}
          hasEntries={entries.length > 0}
          onUpdateEntry={updateEntry}
          onUpdateCount={updateEntryCount}
          onRemoveEntry={removeEntry}
          onAddEntry={addEntry}
        />
      </div>
    </ToolPageWrapper>
  );
}
