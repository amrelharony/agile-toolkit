"use client";

import { useMemo, useState, useEffect } from "react";
import { create } from "zustand";
import { persist } from "zustand/middleware";
import { safeJSONStorage } from "@/lib/stores/safe-storage";
import { LineChart, Line, XAxis, YAxis, CartesianGrid, Tooltip, ReferenceLine } from "recharts";
import { ToolPageWrapper } from "@/components/layout/tool-page-wrapper";
import { ExportButton } from "@/components/shared/export-button";
import { AiPromptGenerator } from "@/components/shared/ai-prompt-generator";
import { CalloutAlert } from "@/components/shared/callout-alert";
import { ChartCard } from "@/components/shared/chart-card";
import { SectionCard } from "@/components/shared/section-card";
import { generateRefinementPrompts } from "@/lib/ai-prompts/refinement";
import { useHistoryLogger } from "@/lib/history/use-history-logger";
import { REFINEMENT_ACTIONS } from "@/lib/history/event-actions";
import { todayLocalISO } from "@/lib/utils/formatters";
import { pChartLimits, westernElectricRules } from "@/lib/analytics/control-chart";
import { mannKendall } from "@/lib/analytics/trend-test";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Label } from "@/components/ui/label";
import { Badge } from "@/components/ui/badge";
import {
  CheckSquare,
  Plus,
  Trash2,
  History,
  TrendingUp,
  Save,
  Pencil,
  Check,
  X,
} from "lucide-react";

/* -------------------------------------------------------------------------- */
/*  Types                                                                     */
/* -------------------------------------------------------------------------- */

interface Criterion {
  id: string;
  label: string;
  description?: string;
}

interface StoryCheck {
  criterionId: string;
  checked: boolean;
}

interface StorySave {
  id: string;
  storyName: string;
  description?: string;
  date: string; // ISO date string
  checks: StoryCheck[];
  totalCriteria: number;
  metCount: number;
  passRate: number; // 0-100
}

interface RefinementStore {
  criteria: Criterion[];
  storyName: string;
  storyDescription: string;
  currentChecks: Record<string, boolean>;
  history: StorySave[];

  setCriterion: (id: string, label: string) => void;
  setCriterionDescription: (id: string, description: string) => void;
  addCriterion: () => void;
  removeCriterion: (id: string) => void;

  setStoryName: (v: string) => void;
  setStoryDescription: (v: string) => void;
  toggleCheck: (criterionId: string) => void;
  saveStory: () => void;
  removeHistory: (id: string) => void;
  clearHistory: () => void;
  resetCurrent: () => void;
  reset: () => void;
}

/* -------------------------------------------------------------------------- */
/*  Defaults                                                                  */
/* -------------------------------------------------------------------------- */

const DEFAULT_CRITERIA: Criterion[] = [
  { id: "d1", label: "User story written in correct format (As a / I want / So that)" },
  { id: "d2", label: "Acceptance criteria defined" },
  { id: "d3", label: "Estimated by team" },
  { id: "d4", label: "Dependencies identified" },
  { id: "d5", label: "No unresolved blockers" },
  { id: "d6", label: "UI/UX mockups attached (if applicable)" },
  { id: "d7", label: "Technical approach discussed" },
  { id: "d8", label: "Story fits within one sprint" },
];

/* -------------------------------------------------------------------------- */
/*  Store                                                                     */
/* -------------------------------------------------------------------------- */

const useRefinementStore = create<RefinementStore>()(
  persist(
    (set, get) => ({
      criteria: DEFAULT_CRITERIA,
      storyName: "",
      storyDescription: "",
      currentChecks: {},
      history: [],

      setCriterion: (id, label) =>
        set((s) => ({
          criteria: s.criteria.map((c) => (c.id === id ? { ...c, label } : c)),
        })),

      setCriterionDescription: (id, description) =>
        set((s) => ({
          criteria: s.criteria.map((c) =>
            c.id === id ? { ...c, description: description.trim() || undefined } : c
          ),
        })),

      addCriterion: () =>
        set((s) => ({
          criteria: [...s.criteria, { id: crypto.randomUUID(), label: "New criterion" }],
        })),

      removeCriterion: (id) =>
        set((s) => ({
          criteria: s.criteria.filter((c) => c.id !== id),
          currentChecks: Object.fromEntries(
            Object.entries(s.currentChecks).filter(([k]) => k !== id)
          ),
        })),

      setStoryName: (v) => set({ storyName: v }),
      setStoryDescription: (v) => set({ storyDescription: v }),

      toggleCheck: (criterionId) =>
        set((s) => ({
          currentChecks: {
            ...s.currentChecks,
            [criterionId]: !s.currentChecks[criterionId],
          },
        })),

      saveStory: () => {
        const { criteria, storyName, storyDescription, currentChecks } = get();
        if (!storyName.trim()) return;
        const metCount = criteria.filter((c) => currentChecks[c.id]).length;
        const passRate = criteria.length > 0 ? Math.round((metCount / criteria.length) * 100) : 0;

        const save: StorySave = {
          id: crypto.randomUUID(),
          storyName: storyName.trim(),
          description: storyDescription.trim() || undefined,
          date: todayLocalISO(),
          checks: criteria.map((c) => ({
            criterionId: c.id,
            checked: !!currentChecks[c.id],
          })),
          totalCriteria: criteria.length,
          metCount,
          passRate,
        };

        set((s) => ({
          history: [save, ...s.history],
          storyName: "",
          storyDescription: "",
          currentChecks: {},
        }));
      },

      removeHistory: (id) => set((s) => ({ history: s.history.filter((h) => h.id !== id) })),

      clearHistory: () => set({ history: [] }),

      resetCurrent: () => set({ storyName: "", storyDescription: "", currentChecks: {} }),

      reset: () =>
        set({
          criteria: DEFAULT_CRITERIA,
          storyName: "",
          storyDescription: "",
          currentChecks: {},
          history: [],
        }),
    }),
    { name: "agile-toolkit:refinement", storage: safeJSONStorage("refinement") }
  )
);

/* -------------------------------------------------------------------------- */
/*  Helpers                                                                   */
/* -------------------------------------------------------------------------- */

const TOOLTIP_STYLE = {
  backgroundColor: "#1a1f36",
  border: "1px solid rgba(255,255,255,0.1)",
  borderRadius: "8px",
  color: "#e2e8f0",
};

function ReadinessIndicator({ pct }: { pct: number }) {
  if (pct === 100)
    return (
      <Badge className="bg-[#00ff88]/10 text-[#00ff88] border border-[#00ff88]/20">Ready</Badge>
    );
  if (pct > 0)
    return (
      <Badge className="bg-[#ffaa00]/10 text-[#ffaa00] border border-[#ffaa00]/20">Partial</Badge>
    );
  return (
    <Badge className="bg-[#ef4444]/10 text-[#ef4444] border border-[#ef4444]/20">Not Ready</Badge>
  );
}

/* -------------------------------------------------------------------------- */
/*  Editable Criterion Row                                                    */
/* -------------------------------------------------------------------------- */

function CriterionRow({
  criterion,
  checked,
  onToggle,
  onLabelChange,
  onDescriptionChange,
  onRemove,
  showCheckbox,
}: {
  criterion: Criterion;
  checked: boolean;
  onToggle?: () => void;
  onLabelChange: (label: string) => void;
  onDescriptionChange: (description: string) => void;
  onRemove: () => void;
  showCheckbox: boolean;
}) {
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState(criterion.label);
  const [descDraft, setDescDraft] = useState(criterion.description ?? "");

  // Keep local draft state in sync when the criterion is updated elsewhere
  // (e.g. another row reset, store rehydration). Skip while the user is mid-edit
  // so we don't clobber their typing.
  useEffect(() => {
    if (!editing) {
      setDraft(criterion.label);
      setDescDraft(criterion.description ?? "");
    }
  }, [criterion.label, criterion.description, editing]);

  const commitEdit = () => {
    onLabelChange(draft.trim() || criterion.label);
    onDescriptionChange(descDraft);
    setEditing(false);
  };

  return (
    <div className="flex items-start gap-3 p-3 rounded-lg border border-border bg-surface-deep/40 group hover:bg-surface-deep/70 transition-colors">
      {showCheckbox && (
        <button
          onClick={onToggle}
          aria-label={`Toggle ${criterion.label}`}
          className={`flex-shrink-0 w-5 h-5 mt-0.5 rounded border transition-all ${
            checked ? "bg-accent border-accent" : "border-border hover:border-accent/50"
          }`}
        >
          {checked && (
            <svg viewBox="0 0 20 20" fill="none" className="w-full h-full">
              <path
                d="M5 10l4 4 6-6"
                stroke="#0a0e1a"
                strokeWidth="2"
                strokeLinecap="round"
                strokeLinejoin="round"
              />
            </svg>
          )}
        </button>
      )}

      {editing ? (
        <div className="flex-1 flex flex-col gap-2">
          <div className="flex items-center gap-2">
            <Input
              autoFocus
              value={draft}
              onChange={(e) => setDraft(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === "Enter") commitEdit();
                if (e.key === "Escape") setEditing(false);
              }}
              className="flex-1 bg-surface-deep border-border text-text text-sm focus:border-accent/50 h-8"
            />
            <Button
              variant="ghost"
              size="icon"
              onClick={commitEdit}
              className="min-touch-coarse h-7 w-7 text-[#00ff88] hover:bg-[#00ff88]/10"
            >
              <Check className="w-3.5 h-3.5" />
            </Button>
            <Button
              variant="ghost"
              size="icon"
              onClick={() => setEditing(false)}
              className="min-touch-coarse h-7 w-7 text-sub hover:bg-cardH"
            >
              <X className="w-3.5 h-3.5" />
            </Button>
          </div>
          {/* Optional description; Cmd/Ctrl+Enter commits both. */}
          <Textarea
            value={descDraft}
            onChange={(e) => setDescDraft(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Enter" && (e.metaKey || e.ctrlKey)) commitEdit();
              if (e.key === "Escape") setEditing(false);
            }}
            placeholder="Description (optional)..."
            rows={2}
            className="bg-surface-deep border-border resize-none text-xs"
            aria-label="Criterion description"
          />
        </div>
      ) : (
        <div className="flex-1 min-w-0">
          <span
            className={`block text-sm ${
              showCheckbox && checked ? "line-through text-sub" : "text-text"
            }`}
          >
            {criterion.label}
          </span>
          {criterion.description && (
            <div className="text-sub text-[11px] mt-0.5 mb-1.5 whitespace-pre-wrap break-words">
              {criterion.description}
            </div>
          )}
        </div>
      )}

      {!editing && (
        <div className="flex items-center gap-1 opacity-0 group-hover:opacity-100 group-focus-within:opacity-100 transition-opacity">
          <Button
            variant="ghost"
            size="icon"
            onClick={() => {
              setDraft(criterion.label);
              setDescDraft(criterion.description ?? "");
              setEditing(true);
            }}
            className="min-touch-coarse h-7 w-7 text-sub hover:text-accent hover:bg-accent/10"
          >
            <Pencil className="w-3 h-3" />
          </Button>
          <Button
            variant="danger-ghost"
            size="icon"
            onClick={onRemove}
            className="min-touch-coarse h-7 w-7"
          >
            <Trash2 className="w-3.5 h-3.5" />
          </Button>
        </div>
      )}
    </div>
  );
}

/* -------------------------------------------------------------------------- */
/*  Main component                                                            */
/* -------------------------------------------------------------------------- */

export function RefinementClient() {
  const {
    criteria,
    storyName,
    storyDescription,
    currentChecks,
    history,
    setCriterion,
    setCriterionDescription,
    addCriterion,
    removeCriterion,
    setStoryName,
    setStoryDescription,
    toggleCheck,
    saveStory: saveStoryRaw,
    removeHistory,
    clearHistory,
    resetCurrent,
    reset: resetRaw,
  } = useRefinementStore();
  const { log } = useHistoryLogger("refinement");

  const saveStory: typeof saveStoryRaw = (...args) => {
    saveStoryRaw(...args);
    log(REFINEMENT_ACTIONS.STORY_ADDED, { storyName });
  };
  const reset = () => {
    resetRaw();
    log(REFINEMENT_ACTIONS.REFINEMENT_RESET, {});
  };

  const metCount = criteria.filter((c) => currentChecks[c.id]).length;
  const pct = criteria.length > 0 ? Math.round((metCount / criteria.length) * 100) : 0;

  // Chart data — last 20 saves in chronological order. We label each point with
  // the actual story name so the x-axis stays stable across renders (sequential
  // #1..#N labels rebase whenever the window slides).
  const chartData = useMemo(() => {
    return [...history]
      .reverse()
      .slice(-20)
      .map((h) => ({
        name: h.storyName,
        passRate: h.passRate,
        story: h.storyName,
      }));
  }, [history]);

  // p-chart limits on per-story DoR pass rate. Each save is a "trial" with
  // `metCount` successes out of `totalCriteria` criteria. Limits expressed
  // as percentages so they overlay the existing 0-100 chart axis.
  // Returns null when the chart window is too small (< 4 points) to keep
  // limits stable.
  const passRateControl = useMemo(() => {
    if (chartData.length < 4) return null;
    const window = [...history].reverse().slice(-20);
    const successes = window.map((h) => h.metCount);
    const trials = window.map((h) => h.totalCriteria);
    const limits = pChartLimits(successes, trials);
    return {
      centerLinePct: limits.centerLine * 100,
      uclPct: limits.ucl * 100,
      lclPct: limits.lcl * 100,
      // Series scaled to 0-1 for Western Electric — limits are in fractions.
      ratioSeries: window.map((h) => (h.totalCriteria > 0 ? h.metCount / h.totalCriteria : 0)),
      rawLimits: limits,
      lastStoryName: window[window.length - 1]?.storyName,
    };
  }, [chartData.length, history]);

  // Western Electric Rule 2 detection ("9 consecutive points on same side of
  // center line"). Surfaces a CalloutAlert when the most recent point trips
  // the rule so a sustained drift is hard to miss.
  const rule2Signal = useMemo(() => {
    if (!passRateControl) return null;
    const signals = westernElectricRules(passRateControl.ratioSeries, passRateControl.rawLimits);
    const lastIndex = passRateControl.ratioSeries.length - 1;
    return signals.find((s) => s.rule === "rule-2" && s.index === lastIndex) ?? null;
  }, [passRateControl]);

  // Mann-Kendall trend test on the rolling pass-rate series.
  const passRateTrend = useMemo(() => {
    if (chartData.length < 5) return null;
    return mannKendall(chartData.map((c) => c.passRate));
  }, [chartData]);

  // CSV export
  const csvData = useMemo(
    () => ({
      headers: ["Story", "Description", "Date", "% Ready", "Criteria Met", "Total Criteria"],
      rows: history.map((h) => [
        h.storyName,
        h.description ?? "",
        h.date,
        h.passRate,
        h.metCount,
        h.totalCriteria,
      ]),
    }),
    [history]
  );

  const promptConfig = useMemo(
    () => ({
      toolName: "Refinement Checklist",
      prompts: generateRefinementPrompts({
        criteria,
        history: history.map((h) => ({
          storyName: h.storyName,
          passRate: h.passRate,
          checks: Object.fromEntries(h.checks.map((c) => [c.criterionId, c.checked])),
        })),
      }),
    }),
    [criteria, history]
  );

  return (
    <ToolPageWrapper
      toolId="refinement"
      title="Refinement Checklist"
      description="Track Definition of Ready compliance per story and monitor your team's refinement pass rate over time."
      category="Ceremonies"
    >
      <div className="space-y-6">
        {/* Header */}
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-3">
            <span className="text-sm text-sub">{criteria.length} criteria defined</span>
            {history.length > 0 && (
              <Badge className="bg-accent/10 text-accent border border-accent/20 text-xs">
                {history.length} stories saved
              </Badge>
            )}
          </div>
          <Button variant="danger-ghost" size="sm" onClick={reset}>
            Reset All
          </Button>
        </div>

        <div className="grid grid-cols-1 lg:grid-cols-[400px_1fr] gap-6">
          {/* Left — DoR criteria + per-story check */}
          <div className="space-y-4">
            {/* Criteria management */}
            <SectionCard
              title="Definition of Ready"
              icon={CheckSquare}
              actions={
                <Button size="sm" variant="toolkit" onClick={addCriterion} className="gap-1.5">
                  <Plus className="w-4 h-4" />
                  Add
                </Button>
              }
              contentClassName="space-y-2"
            >
              {criteria.map((c) => (
                <CriterionRow
                  key={c.id}
                  criterion={c}
                  checked={false}
                  onLabelChange={(label) => setCriterion(c.id, label)}
                  onDescriptionChange={(desc) => setCriterionDescription(c.id, desc)}
                  onRemove={() => removeCriterion(c.id)}
                  showCheckbox={false}
                />
              ))}
              {criteria.length === 0 && (
                <p className="text-sm text-sub text-center py-4">
                  No criteria yet. Add some above.
                </p>
              )}
            </SectionCard>

            {/* Per-story checklist */}
            <SectionCard
              title="Check Story"
              actions={<ReadinessIndicator pct={pct} />}
              contentClassName="space-y-4"
            >
              <div className="space-y-1.5">
                <Label className="text-sub text-xs">Story Name / ID</Label>
                <Input
                  value={storyName}
                  onChange={(e) => setStoryName(e.target.value)}
                  placeholder="e.g. USER-42 — Add dark mode toggle"
                  className="input-toolkit"
                />
                {/* Optional description for the saved story snapshot;
                      empty trims to undefined when committed via saveStory. */}
                <Textarea
                  value={storyDescription}
                  onChange={(e) => setStoryDescription(e.target.value)}
                  onKeyDown={(e) => {
                    if (e.key === "Enter" && (e.metaKey || e.ctrlKey)) saveStory();
                  }}
                  placeholder="Description (optional)..."
                  rows={2}
                  className="bg-surface border-border resize-none text-xs"
                  aria-label="Story description"
                />
              </div>

              <div className="space-y-2">
                {criteria.map((c) => (
                  <CriterionRow
                    key={c.id}
                    criterion={c}
                    checked={!!currentChecks[c.id]}
                    onToggle={() => toggleCheck(c.id)}
                    onLabelChange={(label) => setCriterion(c.id, label)}
                    onDescriptionChange={(desc) => setCriterionDescription(c.id, desc)}
                    onRemove={() => removeCriterion(c.id)}
                    showCheckbox={true}
                  />
                ))}
              </div>

              {criteria.length > 0 && (
                <div className="pt-2 border-t border-border">
                  <div className="flex items-center justify-between text-xs text-sub mb-2">
                    <span>
                      {metCount} / {criteria.length} criteria met
                    </span>
                    <span
                      className="font-data font-bold"
                      style={{
                        color: pct === 100 ? "#00ff88" : pct > 0 ? "#ffaa00" : "#ef4444",
                      }}
                    >
                      {pct}%
                    </span>
                  </div>
                  <div className="w-full h-2 bg-card rounded-full overflow-hidden">
                    <div
                      className="h-full rounded-full transition-all duration-300"
                      style={{
                        width: `${pct}%`,
                        background: pct === 100 ? "#00ff88" : pct > 0 ? "#ffaa00" : "#ef4444",
                      }}
                    />
                  </div>
                </div>
              )}

              <div className="flex gap-2 pt-1">
                <Button
                  variant="toolkit"
                  onClick={saveStory}
                  disabled={!storyName.trim()}
                  className="flex-1 gap-2"
                >
                  <Save className="w-4 h-4" />
                  Save to History
                </Button>
                <Button
                  variant="ghost"
                  onClick={resetCurrent}
                  className="text-sub hover:text-text hover:bg-cardH"
                >
                  Clear
                </Button>
              </div>
            </SectionCard>
          </div>

          {/* Right — history + chart */}
          <div className="space-y-4">
            {/* Western Electric Rule 2 alert: 9 consecutive saves on same side
                of the p-chart center line — sustained drift in DoR adherence. */}
            {rule2Signal && passRateControl && (
              <CalloutAlert tone="warning">
                <strong className="font-semibold">DoR adherence drift:</strong> The last 9 saved
                stories sit on one side of the long-run pass-rate baseline (
                {passRateControl.centerLinePct.toFixed(0)}%). Investigate before it shifts the team
                baseline.
              </CalloutAlert>
            )}

            {/* Pass rate chart */}
            {chartData.length > 1 && (
              <ChartCard title="Pass Rate Trend" icon={TrendingUp} height={200}>
                <LineChart data={chartData} margin={{ top: 10, right: 10, left: -20, bottom: 0 }}>
                  <CartesianGrid
                    strokeDasharray="3 3"
                    stroke="rgba(255,255,255,0.06)"
                    vertical={false}
                  />
                  <XAxis
                    dataKey="name"
                    tick={{ fill: "#94a3b8", fontSize: 11 }}
                    axisLine={{ stroke: "rgba(255,255,255,0.1)" }}
                    tickLine={false}
                  />
                  <YAxis
                    domain={[0, 100]}
                    tick={{ fill: "#94a3b8", fontSize: 11 }}
                    axisLine={false}
                    tickLine={false}
                    tickFormatter={(v) => `${v}%`}
                  />
                  <Tooltip
                    contentStyle={TOOLTIP_STYLE}
                    // BUG-RD3-refinement-1: Recharts may invoke the
                    // formatter on a ReferenceLine hover where
                    // `props.payload` is undefined. The prior
                    // `props.payload.story` threw TypeError and the
                    // chart tooltip crashed. Optional-chain through.
                    formatter={(v, _name, props) => [
                      `${v}%`,
                      (props as { payload?: { story?: string } }).payload?.story ?? "",
                    ]}
                  />
                  <ReferenceLine
                    y={80}
                    stroke="#00ff88"
                    strokeDasharray="4 4"
                    strokeOpacity={0.5}
                    label={{
                      value: "80% target",
                      fill: "#00ff88",
                      fontSize: 10,
                      position: "right",
                    }}
                  />
                  {/* p-chart limits — UCL / X̄ / LCL — stable when the rolling
                      window has at least 4 saved stories. */}
                  {passRateControl && (
                    <>
                      <ReferenceLine
                        y={passRateControl.centerLinePct}
                        stroke="#00f0ff"
                        strokeDasharray="2 4"
                        strokeOpacity={0.55}
                        label={{
                          value: "X̄",
                          fill: "#00f0ff",
                          fontSize: 10,
                          position: "right",
                        }}
                        ifOverflow="extendDomain"
                      />
                      <ReferenceLine
                        y={passRateControl.uclPct}
                        stroke="#00ff88"
                        strokeDasharray="2 4"
                        strokeOpacity={0.55}
                        label={{
                          value: "UCL",
                          fill: "#00ff88",
                          fontSize: 10,
                          position: "right",
                        }}
                        ifOverflow="extendDomain"
                      />
                      <ReferenceLine
                        y={passRateControl.lclPct}
                        stroke="#ef4444"
                        strokeDasharray="2 4"
                        strokeOpacity={0.55}
                        label={{
                          value: "LCL",
                          fill: "#ef4444",
                          fontSize: 10,
                          position: "right",
                        }}
                        ifOverflow="extendDomain"
                      />
                    </>
                  )}
                  <Line
                    type="monotone"
                    dataKey="passRate"
                    name="Pass Rate"
                    stroke="#00f0ff"
                    strokeWidth={2}
                    dot={{ fill: "#00f0ff", r: 3 }}
                    activeDot={{ r: 5 }}
                  />
                </LineChart>
              </ChartCard>
            )}

            {/* Mann-Kendall trend chip on the rolling pass-rate series. */}
            {passRateTrend?.significant && (
              <div className="flex items-center justify-end -mt-2">
                <span
                  className={`inline-flex items-center gap-1.5 text-[11px] font-mono uppercase tracking-wider px-2 py-0.5 rounded-md border ${
                    passRateTrend.trend === "up"
                      ? "bg-accent/15 text-accent border-accent/40"
                      : "bg-destructive/15 text-destructive border-destructive/40"
                  }`}
                  title={`Mann-Kendall p=${passRateTrend.pValue.toFixed(3)}`}
                >
                  <span>{passRateTrend.trend === "up" ? "↗" : "↘"} pass-rate trend</span>
                  <span className="opacity-60">p={passRateTrend.pValue.toFixed(2)}</span>
                </span>
              </div>
            )}

            {/* History table */}
            <SectionCard
              title="Story History"
              icon={History}
              titleSuffix={history.length > 0 ? `(${history.length})` : undefined}
              actions={
                history.length > 0 ? (
                  <>
                    <AiPromptGenerator config={promptConfig} />
                    <ExportButton filename="refinement-history" csvData={csvData} />
                    <Button
                      variant="danger-ghost"
                      size="sm"
                      onClick={clearHistory}
                      className="text-xs"
                    >
                      Clear
                    </Button>
                  </>
                ) : undefined
              }
            >
              {history.length === 0 ? (
                <p className="text-sm text-sub text-center py-8">
                  No stories saved yet. Check a story above and click &ldquo;Save to History&rdquo;.
                </p>
              ) : (
                <div className="overflow-x-auto">
                  <table className="w-full text-sm">
                    <thead>
                      <tr className="border-b border-border">
                        <th className="text-left text-xs text-sub font-medium uppercase tracking-wider pb-2 pr-4">
                          Story
                        </th>
                        <th className="text-left text-xs text-sub font-medium uppercase tracking-wider pb-2 pr-4">
                          Date
                        </th>
                        <th className="text-right text-xs text-sub font-medium uppercase tracking-wider pb-2 pr-4">
                          % Ready
                        </th>
                        <th className="text-right text-xs text-sub font-medium uppercase tracking-wider pb-2 pr-4">
                          Met
                        </th>
                        <th className="text-right text-xs text-sub font-medium uppercase tracking-wider pb-2">
                          Status
                        </th>
                        <th className="w-8" />
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-white/5">
                      {history.map((h) => (
                        <tr key={h.id} className="group">
                          <td className="py-2.5 pr-4 max-w-[200px]">
                            <div className="text-text font-medium truncate">{h.storyName}</div>
                            {h.description && (
                              <div className="text-sub text-[11px] mt-0.5 whitespace-pre-wrap break-words">
                                {h.description}
                              </div>
                            )}
                          </td>
                          <td className="py-2.5 pr-4 text-sub text-xs">{h.date}</td>
                          <td className="py-2.5 pr-4 text-right font-data font-semibold">
                            <span
                              style={{
                                color:
                                  h.passRate === 100
                                    ? "#00ff88"
                                    : h.passRate > 0
                                      ? "#ffaa00"
                                      : "#ef4444",
                              }}
                            >
                              {h.passRate}%
                            </span>
                          </td>
                          <td className="py-2.5 pr-4 text-right text-sub text-xs font-data">
                            {h.metCount}/{h.totalCriteria}
                          </td>
                          <td className="py-2.5 pr-4 text-right">
                            <ReadinessIndicator pct={h.passRate} />
                          </td>
                          <td className="py-2.5">
                            <Button
                              variant="danger-ghost"
                              size="icon"
                              onClick={() => removeHistory(h.id)}
                              className="min-touch-coarse h-7 w-7 opacity-0 group-hover:opacity-100 group-focus-within:opacity-100 transition-opacity"
                            >
                              <Trash2 className="w-3.5 h-3.5" />
                            </Button>
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              )}
            </SectionCard>
          </div>
        </div>
      </div>
    </ToolPageWrapper>
  );
}
