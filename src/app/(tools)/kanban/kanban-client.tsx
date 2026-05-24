"use client";

import { useMemo, useState } from "react";
import { nanoid } from "nanoid";
import {
  LineChart,
  Line,
  XAxis,
  YAxis,
  CartesianGrid,
  Tooltip,
  ReferenceLine,
  ResponsiveContainer,
} from "recharts";
import { ToolPageWrapper } from "@/components/layout/tool-page-wrapper";
import { ExportButton } from "@/components/shared/export-button";
import { AiPromptGenerator } from "@/components/shared/ai-prompt-generator";
import { StatCard } from "@/components/shared/stat-card";
import { ActionRow } from "@/components/shared/action-row";
import { KpiGrid } from "@/components/shared/kpi-grid";
import { CalloutAlert } from "@/components/shared/callout-alert";
import { SectionCard } from "@/components/shared/section-card";
import { SmartInput } from "@/components/shared/smart-input";
import { CausalLine, type CausalAnnotationData } from "@/components/charts/causal-annotation";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Plus, Trash2, Zap, Clock, TrendingUp, Activity } from "lucide-react";
import { mean, stdDev } from "@/lib/analytics/anomaly";
import { forecastBayesianHolt } from "@/lib/analytics/forecasting-bayesian";
import { xmrLimits } from "@/lib/analytics/control-chart";
import { cusum } from "@/lib/analytics/changepoint";
import { mannKendall } from "@/lib/analytics/trend-test";
import { usePredictedDefault } from "@/lib/predictions/use-predicted-default";
import { generateKanbanPrompts } from "@/lib/ai-prompts/kanban";
import { usePersisted } from "@/lib/utils/use-persisted";
import { cn } from "@/lib/utils";
import { emit as sonify } from "@/lib/sonification/emit";
import { useHistoryLogger } from "@/lib/history/use-history-logger";
import { KANBAN_ACTIONS } from "@/lib/history/event-actions";

type ColumnId = "backlog" | "ready" | "in_progress" | "review" | "done";

type ClassOfService = "standard" | "expedite" | "fixed_date" | "intangible";

interface KCard {
  id: string;
  title: string;
  description?: string;
  column: ColumnId;
  class: ClassOfService;
  createdAt: string;
  startedAt?: string;
  completedAt?: string;
}

interface KanbanState {
  cards: KCard[];
  wipLimits: Record<ColumnId, number>;
}

const COLUMNS: { id: ColumnId; label: string }[] = [
  { id: "backlog", label: "Backlog" },
  { id: "ready", label: "Ready" },
  { id: "in_progress", label: "In Progress" },
  { id: "review", label: "Review" },
  { id: "done", label: "Done" },
];

const COS_COLORS: Record<ClassOfService, string> = {
  standard: "#00f0ff",
  expedite: "#ef4444",
  fixed_date: "#f59e0b",
  intangible: "#a855f7",
};

const DEFAULT_STATE: KanbanState = {
  cards: [],
  wipLimits: { backlog: 0, ready: 5, in_progress: 3, review: 2, done: 0 },
};

function cycleTimeDays(c: KCard): number | null {
  if (!c.startedAt || !c.completedAt) return null;
  const start = new Date(c.startedAt).getTime();
  const end = new Date(c.completedAt).getTime();
  return Math.max(0, (end - start) / (1000 * 60 * 60 * 24));
}

// ISO-8601 week number with the year of the Thursday-anchored week. Avoids
// the year/DST boundary glitch from raw `floor((d - Jan1) / 7days)` keys
// (which both miscount weeks at year boundaries and split a single calendar
// week across two buckets when DST shifts the millisecond delta).
function isoWeek(d: Date): { year: number; week: number } {
  const date = new Date(Date.UTC(d.getFullYear(), d.getMonth(), d.getDate()));
  date.setUTCDate(date.getUTCDate() + 4 - (date.getUTCDay() || 7));
  const yearStart = new Date(Date.UTC(date.getUTCFullYear(), 0, 1));
  const week = Math.ceil(((date.getTime() - yearStart.getTime()) / 86400000 + 1) / 7);
  return { year: date.getUTCFullYear(), week };
}

export function KanbanClient() {
  const [state, setState] = usePersisted<KanbanState>("agile-toolkit:kanban", DEFAULT_STATE);
  const [newTitle, setNewTitle] = useState("");
  const [newDescription, setNewDescription] = useState("");
  const { log } = useHistoryLogger("kanban");

  const addCard = () => {
    if (!newTitle.trim()) return;
    sonify("kanban", "card-add");
    const now = new Date().toISOString();
    const cardId = nanoid(8);
    // Cap free-text card fields. Kanban boards routinely accumulate
    // hundreds of cards over weeks; without these bounds a single mega-
    // paste would push the persisted state past the 5 MB origin quota and
    // silently kill writes for every other tool on this domain.
    const title = newTitle.trim().slice(0, 240);
    const description = newDescription.trim().slice(0, 4000) || undefined;
    setState((s) => ({
      ...s,
      cards: [
        ...s.cards,
        { id: cardId, title, description, column: "backlog", class: "standard", createdAt: now },
      ],
    }));
    log(KANBAN_ACTIONS.CARD_ADDED, { cardId, title, description });
    setNewTitle("");
    setNewDescription("");
  };

  const moveCard = (id: string, col: ColumnId) => {
    sonify("kanban", col === "done" ? "card-done" : "card-move");
    const card = state.cards.find((c) => c.id === id);
    setState((s) => ({
      ...s,
      cards: s.cards.map((c) => {
        if (c.id !== id) return c;
        const now = new Date().toISOString();
        const patch: Partial<KCard> = { column: col };
        if (col === "in_progress" && !c.startedAt) patch.startedAt = now;
        if (col === "done" && !c.completedAt) patch.completedAt = now;
        // BUG-T4-kanban-1: clear stale completion timestamp when a card
        // moves out of Done. Without this, cycle-time + throughput KPI +
        // XmR control chart + Mann-Kendall trend all consume corrupted
        // data: a card moved Done→In Progress still reports `completedAt`,
        // so `cycleTimeDays` returns a value and `throughputLast7` counts
        // it.
        if (col !== "done" && c.completedAt) patch.completedAt = undefined;
        // Similarly: moving back to backlog/ready means the card was
        // never started — clear startedAt so re-work cycle is captured.
        if ((col === "backlog" || col === "ready") && c.startedAt) {
          patch.startedAt = undefined;
        }
        return { ...c, ...patch };
      }),
    }));
    log(KANBAN_ACTIONS.CARD_MOVED, {
      cardId: id,
      title: card?.title,
      from: card?.column,
      to: col,
    });
  };

  const removeCard = (id: string) => {
    const card = state.cards.find((c) => c.id === id);
    setState((s) => ({ ...s, cards: s.cards.filter((c) => c.id !== id) }));
    log(KANBAN_ACTIONS.CARD_REMOVED, {
      cardId: id,
      title: card?.title,
      description: card?.description,
    });
  };
  const setWip = (col: ColumnId, n: number) =>
    setState((s) => ({
      ...s,
      // Cap WIP limit at 999 — beyond that the badge overflows the column
      // header and the "limit > 0" gate below stops serving as a sensible
      // signal. NaN inputs (from a paste-of-words) are coerced to 0.
      wipLimits: {
        ...s.wipLimits,
        [col]: Number.isFinite(n) ? Math.max(0, Math.min(999, Math.floor(n))) : 0,
      },
    }));
  const setClass = (id: string, cls: ClassOfService) => {
    setState((s) => ({
      ...s,
      cards: s.cards.map((c) => (c.id === id ? { ...c, class: cls } : c)),
    }));
    log(KANBAN_ACTIONS.CARD_UPDATED, { cardId: id, classOfService: cls });
  };

  const byColumn = useMemo(() => {
    const map: Record<ColumnId, KCard[]> = {
      backlog: [],
      ready: [],
      in_progress: [],
      review: [],
      done: [],
    };
    for (const c of state.cards) {
      // Guard against persisted cards from an older build that may have a
      // column value not in the current ColumnId union (e.g. a column was
      // renamed). Without this, `map[c.column].push(c)` would throw with
      // "Cannot read property 'push' of undefined" and crash the whole board.
      if (c.column in map) {
        map[c.column].push(c);
      } else {
        map.backlog.push({ ...c, column: "backlog" });
      }
    }
    return map;
  }, [state.cards]);

  // Memoize so a 100+ card board doesn't re-sort and re-allocate on every
  // render (which happens whenever an unrelated piece of state changes).
  const { cycleAvg, cycleStd, cycleP85 } = useMemo(() => {
    const ct = state.cards.map(cycleTimeDays).filter((v): v is number => v !== null);
    if (ct.length === 0) return { cycleAvg: 0, cycleStd: 0, cycleP85: 0 };
    const sorted = ct.slice().sort((a, b) => a - b);
    // Nearest-rank P85; clamp index so a single observation still resolves.
    const p85Idx = Math.min(sorted.length - 1, Math.floor(sorted.length * 0.85));
    return {
      cycleAvg: mean(ct),
      cycleStd: stdDev(ct),
      cycleP85: sorted[p85Idx],
    };
  }, [state.cards]);

  const throughputLast7 = useMemo(() => {
    const now = Date.now();
    return state.cards.filter(
      (c) => c.completedAt && now - new Date(c.completedAt).getTime() <= 7 * 24 * 60 * 60 * 1000
    ).length;
  }, [state.cards]);

  // Keep both the (label, value) pairs (for charting) and the value-only
  // series (for the analytics primitives that take number[]).
  const weeklyThroughputSeries = useMemo(() => {
    const byWeek = new Map<string, number>();
    for (const c of state.cards) {
      if (!c.completedAt) continue;
      const { year, week } = isoWeek(new Date(c.completedAt));
      const key = `${year}-W${String(week).padStart(2, "0")}`;
      byWeek.set(key, (byWeek.get(key) ?? 0) + 1);
    }
    // Byte-order compare instead of localeCompare — the keys are
    // strict ISO week strings ("2026-W20"); locale-aware sorting can
    // pick up unexpected orderings in some locales (Turkish dotless-i,
    // etc.). Plain `<` comparison is faster and locale-stable for this
    // restricted character set.
    return Array.from(byWeek.entries())
      .sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0))
      .map(([label, value]) => ({ label, value }));
  }, [state.cards]);

  const weeklyThroughput = useMemo(
    () => weeklyThroughputSeries.map((p) => p.value),
    [weeklyThroughputSeries]
  );

  const forecast = useMemo(
    // Bayesian variant inflates σ on small n — honest 80/95% bands at low
    // sample sizes rather than the over-confident bands plain Holt produces.
    () =>
      weeklyThroughput.length >= 2
        ? forecastBayesianHolt(weeklyThroughput, 1, { priorWeight: 2 })
        : [],
    [weeklyThroughput]
  );

  // ── Phase-15 analytics on weekly throughput ─────────────────────────────
  // XmR control limits — need at least 2 observations to compute a moving
  // range; below that we suppress the overlay rather than draw a flat line.
  const throughputLimits = useMemo(
    // Throughput (count of stories closed per week) cannot be negative —
    // clamp LCL at 0 so the lower band reflects reality.
    () => (weeklyThroughput.length >= 2 ? xmrLimits(weeklyThroughput, true) : null),
    [weeklyThroughput]
  );

  // CUSUM changepoints — primitive guards length<4 internally but we keep
  // the explicit gate for clarity. Map to the chart's x-axis label so the
  // CausalLine lands on the right tick. Annotations whose label isn't in
  // the chart's x-domain are dropped — `ifOverflow="extendDomain"` would
  // otherwise distort the axis with phantom ticks.
  const throughputCusumAnnotations = useMemo<CausalAnnotationData[]>(() => {
    if (weeklyThroughput.length < 4) return [];
    const xValuesInChart = new Set(weeklyThroughputSeries.map((p) => p.label));
    return cusum(weeklyThroughput)
      .map((cp): CausalAnnotationData | null => {
        const point = weeklyThroughputSeries[cp.index];
        if (!point) return null;
        return {
          x: point.label,
          label: cp.direction === "up" ? "Throughput regime up" : "Throughput regime down",
          detail: `CUSUM detected a ${cp.direction === "up" ? "sustained increase" : "sustained decrease"} in weekly throughput at ${point.label}.`,
          confidence: cp.cumulativeStat >= 6 ? "strong" : "moderate",
        };
      })
      .filter(
        (a): a is CausalAnnotationData =>
          a !== null && typeof a.x === "string" && xValuesInChart.has(a.x)
      );
  }, [weeklyThroughput, weeklyThroughputSeries]);

  // Mann-Kendall trend test — primitive returns trend "none" for n<5.
  const throughputTrend = useMemo(
    () => (weeklyThroughput.length >= 5 ? mannKendall(weeklyThroughput) : null),
    [weeklyThroughput]
  );

  // ── Smart-default predictor for the in_progress WIP limit ──────────────
  const wipPrediction = usePredictedDefault<number>("kanban", "wipLimit", 3);
  // Local edit buffer so the SmartInput's ghost can render when the field
  // is empty. The committed store value remains the source of truth.
  const [wipEditBuffer, setWipEditBuffer] = useState<string | null>(null);
  const wipFor = (col: ColumnId): string => {
    if (col === "in_progress" && wipEditBuffer !== null) return wipEditBuffer;
    return String(state.wipLimits[col]);
  };

  const violations = COLUMNS.filter(
    (c) =>
      c.id !== "backlog" &&
      c.id !== "done" &&
      state.wipLimits[c.id] > 0 &&
      byColumn[c.id].length > state.wipLimits[c.id]
  );

  const promptConfig = useMemo(
    () => ({
      toolName: "Kanban Board",
      prompts: generateKanbanPrompts({
        cards: state.cards,
        wipLimits: state.wipLimits,
        cycleAvg,
        cycleP85,
        throughputLast7,
      }),
    }),
    [state.cards, state.wipLimits, cycleAvg, cycleP85, throughputLast7]
  );

  return (
    <ToolPageWrapper
      toolId="kanban"
      title="Kanban Board"
      description="WIP-limited flow with classes of service, cycle-time analysis, and throughput forecasting."
      category="Flow & Delivery"
    >
      <ActionRow>
        <AiPromptGenerator config={promptConfig} />
        <ExportButton
          filename="kanban"
          csvData={{
            headers: [
              "Title",
              "Description",
              "Column",
              "Class",
              "Created",
              "Started",
              "Completed",
              "Cycle (days)",
            ],
            rows: state.cards.map((c) => [
              c.title,
              c.description ?? "",
              c.column,
              c.class,
              c.createdAt,
              c.startedAt ?? "",
              c.completedAt ?? "",
              cycleTimeDays(c)?.toFixed(2) ?? "",
            ]),
          }}
          jsonData={state}
        />
      </ActionRow>

      <KpiGrid cols={4} gap="lg">
        <StatCard
          variant="compact"
          icon={Clock}
          label="Cycle avg"
          value={`${cycleAvg.toFixed(1)}d`}
          hint={`±${cycleStd.toFixed(1)}`}
          valueClassName="text-accent"
        />
        <StatCard variant="compact" label="P85" value={`${cycleP85.toFixed(1)}d`} />
        <StatCard
          variant="compact"
          icon={Zap}
          label="Last 7 days"
          value={
            <span className="inline-flex items-baseline gap-1.5">
              {throughputLast7}
              {throughputTrend?.significant && (
                <span
                  className={cn(
                    "text-[10px] font-mono uppercase tracking-wider px-1.5 py-0.5 rounded border",
                    throughputTrend.trend === "up"
                      ? "border-[#00ff88]/40 text-[#00ff88] bg-[#00ff88]/10"
                      : "border-danger/40 text-danger bg-danger/5"
                  )}
                  aria-label={`Throughput trend ${throughputTrend.trend} (Mann-Kendall p=${throughputTrend.pValue.toFixed(3)})`}
                  title={`Mann-Kendall p=${throughputTrend.pValue.toFixed(3)}`}
                >
                  {throughputTrend.trend === "up" ? "↗ trend" : "↘ trend"}
                </span>
              )}
            </span>
          }
          hint="completed"
          valueClassName="text-accent"
        />
        <StatCard
          variant="compact"
          icon={TrendingUp}
          label="Next week"
          value={forecast[0] ? Math.max(0, Math.round(forecast[0].yHat)) : "—"}
          hint="forecast"
        />
      </KpiGrid>

      {/* Weekly throughput chart with XmR control limits + CUSUM markers.
          Hidden when there are fewer than 2 weeks of completion data — the
          XmR primitive collapses to a point and the chart is meaningless. */}
      {weeklyThroughputSeries.length >= 2 && (
        <SectionCard title="Weekly throughput" icon={Activity} titleSize="sm" className="mb-4">
          <div className="-mx-2" style={{ height: 200 }}>
            <ResponsiveContainer width="100%" height="100%">
              <LineChart
                data={weeklyThroughputSeries}
                margin={{ top: 10, right: 16, left: 0, bottom: 0 }}
              >
                <CartesianGrid strokeDasharray="3 3" stroke="rgba(255,255,255,0.06)" />
                <XAxis
                  dataKey="label"
                  tick={{ fill: "var(--sub)", fontSize: 11 }}
                  axisLine={{ stroke: "rgba(255,255,255,0.1)" }}
                  tickLine={false}
                />
                <YAxis
                  tick={{ fill: "var(--sub)", fontSize: 11 }}
                  axisLine={{ stroke: "rgba(255,255,255,0.1)" }}
                  tickLine={false}
                  allowDecimals={false}
                />
                <Tooltip
                  contentStyle={{
                    background: "var(--surface)",
                    border: "1px solid var(--border)",
                    borderRadius: 8,
                    fontSize: 12,
                  }}
                  labelStyle={{ color: "var(--sub)" }}
                />
                {throughputLimits && (
                  <>
                    <ReferenceLine
                      y={throughputLimits.centerLine}
                      stroke="var(--sub)"
                      strokeDasharray="2 4"
                      label={{
                        value: `X̄ ${throughputLimits.centerLine.toFixed(1)}`,
                        fill: "var(--sub)",
                        fontSize: 10,
                        position: "right",
                      }}
                    />
                    <ReferenceLine
                      y={throughputLimits.ucl}
                      stroke="var(--destructive)"
                      strokeDasharray="4 2"
                      label={{
                        value: `UCL ${throughputLimits.ucl.toFixed(1)}`,
                        fill: "var(--destructive)",
                        fontSize: 10,
                        position: "right",
                      }}
                    />
                    <ReferenceLine
                      y={throughputLimits.lcl}
                      stroke="var(--destructive)"
                      strokeDasharray="4 2"
                      label={{
                        value: `LCL ${throughputLimits.lcl.toFixed(1)}`,
                        fill: "var(--destructive)",
                        fontSize: 10,
                        position: "right",
                      }}
                    />
                  </>
                )}
                {throughputCusumAnnotations.map((a, i) => (
                  <CausalLine key={i} annotation={a} />
                ))}
                <Line
                  type="monotone"
                  dataKey="value"
                  stroke="var(--accent)"
                  strokeWidth={2}
                  dot={{ r: 3, fill: "var(--accent)" }}
                  activeDot={{ r: 5 }}
                  name="Completed"
                />
              </LineChart>
            </ResponsiveContainer>
          </div>
        </SectionCard>
      )}

      {violations.length > 0 && (
        <CalloutAlert tone="danger" className="mb-4">
          <strong>WIP limit violated:</strong>{" "}
          {violations
            .map((v) => `${v.label} (${byColumn[v.id].length}/${state.wipLimits[v.id]})`)
            .join(", ")}
        </CalloutAlert>
      )}

      {/* Add-card form. Title row stacks vertically on the smallest phones
          so the "Add" button stays a comfortable touch target. Description
          is optional; Cmd/Ctrl+Enter submits from the textarea. */}
      <div className="flex flex-col gap-2 mb-4">
        <div className="flex flex-col xs:flex-row gap-2">
          <Input
            value={newTitle}
            onChange={(e) => setNewTitle(e.target.value)}
            onKeyDown={(e) => e.key === "Enter" && addCard()}
            placeholder="New card title..."
            className="bg-surface border-border"
            aria-label="New card title"
          />
          <Button
            onClick={addCard}
            className="gap-2 bg-accent text-bg hover:bg-accent/90 xs:w-auto w-full"
          >
            <Plus className="w-4 h-4" aria-hidden="true" />
            Add
          </Button>
        </div>
        <Textarea
          value={newDescription}
          onChange={(e) => setNewDescription(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === "Enter" && (e.metaKey || e.ctrlKey)) addCard();
          }}
          placeholder="Description (optional)..."
          rows={2}
          className="bg-surface border-border resize-none text-xs"
          aria-label="New card description"
        />
      </div>

      {/* Column grid — mobile-first.
          - 320 px: a single column with horizontal-scroll snap so users can
            "swipe through" lanes without losing context. Columns are
            min-w-[80vw] so each one feels like a page.
          - sm (640 px): 2 columns.
          - md (768 px): 3 columns.
          - lg (1024 px): all 5 columns.
          The scroll-x-snap utility from globals.css handles the bleed-to-
          edge scrolling and snap stops below sm. */}
      <div
        className={cn(
          "scroll-x-snap sm:grid sm:gap-3",
          "sm:grid-cols-2 md:grid-cols-3 lg:grid-cols-5",
          // Reset scroll-x styles at sm+: it's a real grid there.
          "sm:overflow-visible sm:m-0 sm:p-0"
        )}
      >
        {COLUMNS.map((col) => {
          const cards = byColumn[col.id];
          const limit = state.wipLimits[col.id];
          const over = limit > 0 && cards.length > limit;
          return (
            <div key={col.id} className="space-y-2 min-w-0 w-[80vw] xs:w-[70vw] sm:w-auto">
              <div
                className={cn(
                  "rounded-lg border p-2",
                  over ? "border-danger/40 bg-danger/5" : "border-border bg-surface"
                )}
              >
                <div className="flex items-center justify-between mb-1">
                  <div className="text-xs uppercase tracking-wider text-text font-semibold">
                    {col.label}
                  </div>
                  <div className="text-xs font-data text-sub">
                    {cards.length}
                    {limit > 0 && ` / ${limit}`}
                  </div>
                </div>
                {col.id !== "backlog" &&
                  col.id !== "done" &&
                  (col.id === "in_progress" ? (
                    // SmartInput on the most-used column. Predictor returns
                    // 120% of current in-progress count when there's signal;
                    // Tab-to-accept when the field is blank.
                    <SmartInput<number>
                      predicted={wipPrediction}
                      onAccept={(v) => {
                        setWip("in_progress", v);
                        setWipEditBuffer(null);
                      }}
                      render={({ ghost, chip, accept }) => (
                        <>
                          <Input
                            type="number"
                            min={0}
                            value={wipFor("in_progress")}
                            placeholder={ghost ?? "WIP"}
                            onKeyDown={(e) => {
                              // Use the raw edit buffer (which is "" when
                              // the field is blank) — wipFor() falls back to
                              // String(limit) when the buffer is null, so
                              // it's always a stringified number and the
                              // empty-check would never fire.
                              if (e.key === "Tab" && wipEditBuffer === "") {
                                e.preventDefault();
                                accept();
                              }
                            }}
                            onChange={(e) => {
                              const raw = e.target.value;
                              setWipEditBuffer(raw);
                              // Empty string parks at 0 in store but keeps the
                              // ghost visible via wipEditBuffer.
                              const n = raw === "" ? 0 : Number(raw);
                              if (Number.isFinite(n)) setWip("in_progress", n);
                            }}
                            onBlur={() => setWipEditBuffer(null)}
                            className="h-8 sm:h-7 text-xs bg-bg border-border font-data"
                            aria-label={`WIP limit for ${col.label}`}
                          />
                          {chip}
                        </>
                      )}
                    />
                  ) : (
                    <Input
                      type="number"
                      min={0}
                      value={limit}
                      // R11-fix: NaN-guard. Pasting "abc" or clearing
                      // the field silently parked the limit at 0 with
                      // no user feedback (setWip clamps to 0 on NaN).
                      // Now: ignore invalid input so the prior limit
                      // is preserved until the user types a valid number.
                      onChange={(e) => {
                        const raw = e.target.value;
                        if (raw === "") return; // user clearing; keep prior limit
                        const n = Number(raw);
                        if (Number.isFinite(n) && n >= 0) setWip(col.id, n);
                      }}
                      placeholder="WIP"
                      className="h-8 sm:h-7 text-xs bg-bg border-border font-data"
                      aria-label={`WIP limit for ${col.label}`}
                    />
                  ))}
              </div>
              {/* Card pile. Mobile gets a smaller min-height so empty lanes
                  don't waste 31% of the viewport. */}
              <div className="space-y-2 min-h-[100px] sm:min-h-[140px] md:min-h-[200px]">
                {cards.map((c) => (
                  <div
                    key={c.id}
                    className="rounded-md border border-border bg-bg p-2 text-xs"
                    style={{
                      borderLeftColor: COS_COLORS[c.class],
                      borderLeftWidth: 3,
                    }}
                  >
                    <div className="text-text font-medium break-words">{c.title}</div>
                    {c.description && (
                      <div className="text-sub text-[11px] mt-0.5 mb-1.5 whitespace-pre-wrap break-words">
                        {c.description}
                      </div>
                    )}
                    {!c.description && <div className="mb-1.5" />}
                    {/* Card controls. Stacked on mobile (one per row) so each
                        select/button is a comfortable touch target; flex row
                        on sm+ where horizontal density is fine. */}
                    <div className="flex flex-col xs:flex-row xs:items-center gap-1.5">
                      <Select value={c.column} onValueChange={(v) => moveCard(c.id, v as ColumnId)}>
                        <SelectTrigger
                          className="h-9 xs:h-7 text-xs bg-surface border-border xs:w-24 w-full"
                          aria-label={`Move ${c.title}`}
                        >
                          <SelectValue />
                        </SelectTrigger>
                        <SelectContent>
                          {COLUMNS.map((x) => (
                            <SelectItem key={x.id} value={x.id} className="text-xs">
                              {x.label}
                            </SelectItem>
                          ))}
                        </SelectContent>
                      </Select>
                      <div className="flex items-center gap-1.5 flex-1">
                        <Select
                          value={c.class}
                          onValueChange={(v) => setClass(c.id, v as ClassOfService)}
                        >
                          <SelectTrigger
                            className="h-9 xs:h-7 text-xs bg-surface border-border flex-1"
                            aria-label={`Class of service for ${c.title}`}
                          >
                            <SelectValue />
                          </SelectTrigger>
                          <SelectContent>
                            <SelectItem value="standard" className="text-xs">
                              Standard
                            </SelectItem>
                            <SelectItem value="expedite" className="text-xs">
                              Expedite
                            </SelectItem>
                            <SelectItem value="fixed_date" className="text-xs">
                              Fixed Date
                            </SelectItem>
                            <SelectItem value="intangible" className="text-xs">
                              Intangible
                            </SelectItem>
                          </SelectContent>
                        </Select>
                        <Button
                          variant="ghost"
                          size="sm"
                          onClick={() => removeCard(c.id)}
                          className="min-touch xs:h-7 xs:w-7 xs:min-w-0 xs:min-h-0 p-0 text-sub hover:text-danger"
                          aria-label={`Remove ${c.title}`}
                        >
                          <Trash2 className="w-4 h-4 xs:w-3 xs:h-3" aria-hidden="true" />
                        </Button>
                      </div>
                    </div>
                  </div>
                ))}
              </div>
            </div>
          );
        })}
      </div>
    </ToolPageWrapper>
  );
}
