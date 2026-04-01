"use client";

import { useMemo, useState } from "react";
import { create } from "zustand";
import { persist } from "zustand/middleware";
import {
  LineChart,
  Line,
  XAxis,
  YAxis,
  CartesianGrid,
  Tooltip,
  ResponsiveContainer,
  ReferenceLine,
} from "recharts";
import { ToolPageWrapper } from "@/components/layout/tool-page-wrapper";
import { ExportButton } from "@/components/shared/export-button";
import { AiPromptGenerator } from "@/components/shared/ai-prompt-generator";
import { generateRefinementPrompts } from "@/lib/ai-prompts/refinement";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
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
}

interface StoryCheck {
  criterionId: string;
  checked: boolean;
}

interface StorySave {
  id: string;
  storyName: string;
  date: string; // ISO date string
  checks: StoryCheck[];
  totalCriteria: number;
  metCount: number;
  passRate: number; // 0-100
}

interface RefinementStore {
  criteria: Criterion[];
  storyName: string;
  currentChecks: Record<string, boolean>;
  history: StorySave[];

  setCriterion: (id: string, label: string) => void;
  addCriterion: () => void;
  removeCriterion: (id: string) => void;

  setStoryName: (v: string) => void;
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
      currentChecks: {},
      history: [],

      setCriterion: (id, label) =>
        set((s) => ({
          criteria: s.criteria.map((c) => (c.id === id ? { ...c, label } : c)),
        })),

      addCriterion: () =>
        set((s) => ({
          criteria: [
            ...s.criteria,
            { id: crypto.randomUUID(), label: "New criterion" },
          ],
        })),

      removeCriterion: (id) =>
        set((s) => ({
          criteria: s.criteria.filter((c) => c.id !== id),
          currentChecks: Object.fromEntries(
            Object.entries(s.currentChecks).filter(([k]) => k !== id)
          ),
        })),

      setStoryName: (v) => set({ storyName: v }),

      toggleCheck: (criterionId) =>
        set((s) => ({
          currentChecks: {
            ...s.currentChecks,
            [criterionId]: !s.currentChecks[criterionId],
          },
        })),

      saveStory: () => {
        const { criteria, storyName, currentChecks } = get();
        if (!storyName.trim()) return;
        const metCount = criteria.filter((c) => currentChecks[c.id]).length;
        const passRate =
          criteria.length > 0
            ? Math.round((metCount / criteria.length) * 100)
            : 0;

        const save: StorySave = {
          id: crypto.randomUUID(),
          storyName: storyName.trim(),
          date: new Date().toISOString().split("T")[0],
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
          currentChecks: {},
        }));
      },

      removeHistory: (id) =>
        set((s) => ({ history: s.history.filter((h) => h.id !== id) })),

      clearHistory: () => set({ history: [] }),

      resetCurrent: () => set({ storyName: "", currentChecks: {} }),

      reset: () =>
        set({
          criteria: DEFAULT_CRITERIA,
          storyName: "",
          currentChecks: {},
          history: [],
        }),
    }),
    { name: "agile-toolkit:refinement" }
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
      <Badge className="bg-[#00ff88]/10 text-[#00ff88] border border-[#00ff88]/20">
        Ready
      </Badge>
    );
  if (pct > 0)
    return (
      <Badge className="bg-[#ffaa00]/10 text-[#ffaa00] border border-[#ffaa00]/20">
        Partial
      </Badge>
    );
  return (
    <Badge className="bg-[#ef4444]/10 text-[#ef4444] border border-[#ef4444]/20">
      Not Ready
    </Badge>
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
  onRemove,
  showCheckbox,
}: {
  criterion: Criterion;
  checked: boolean;
  onToggle?: () => void;
  onLabelChange: (label: string) => void;
  onRemove: () => void;
  showCheckbox: boolean;
}) {
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState(criterion.label);

  const commitEdit = () => {
    onLabelChange(draft.trim() || criterion.label);
    setEditing(false);
  };

  return (
    <div className="flex items-center gap-3 p-3 rounded-lg border border-border bg-surface-deep/40 group hover:bg-surface-deep/70 transition-colors">
      {showCheckbox && (
        <button
          onClick={onToggle}
          className={`flex-shrink-0 w-5 h-5 rounded border transition-all ${
            checked
              ? "bg-accent border-accent"
              : "border-border hover:border-accent/50"
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
        <div className="flex-1 flex items-center gap-2">
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
            className="h-7 w-7 text-[#00ff88] hover:bg-[#00ff88]/10"
          >
            <Check className="w-3.5 h-3.5" />
          </Button>
          <Button
            variant="ghost"
            size="icon"
            onClick={() => setEditing(false)}
            className="h-7 w-7 text-sub hover:bg-cardH"
          >
            <X className="w-3.5 h-3.5" />
          </Button>
        </div>
      ) : (
        <span
          className={`flex-1 text-sm ${
            showCheckbox && checked
              ? "line-through text-sub"
              : "text-text"
          }`}
        >
          {criterion.label}
        </span>
      )}

      {!editing && (
        <div className="flex items-center gap-1 opacity-0 group-hover:opacity-100 transition-opacity">
          <Button
            variant="ghost"
            size="icon"
            onClick={() => {
              setDraft(criterion.label);
              setEditing(true);
            }}
            className="h-7 w-7 text-sub hover:text-accent hover:bg-accent/10"
          >
            <Pencil className="w-3 h-3" />
          </Button>
          <Button
            variant="ghost"
            size="icon"
            onClick={onRemove}
            className="h-7 w-7 text-sub hover:text-red-400 hover:bg-red-400/10"
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
    currentChecks,
    history,
    setCriterion,
    addCriterion,
    removeCriterion,
    setStoryName,
    toggleCheck,
    saveStory,
    removeHistory,
    clearHistory,
    resetCurrent,
    reset,
  } = useRefinementStore();

  const metCount = criteria.filter((c) => currentChecks[c.id]).length;
  const pct =
    criteria.length > 0 ? Math.round((metCount / criteria.length) * 100) : 0;

  // Chart data — last 20 saves in chronological order
  const chartData = useMemo(() => {
    return [...history]
      .reverse()
      .slice(-20)
      .map((h, i) => ({
        name: `#${i + 1}`,
        passRate: h.passRate,
        story: h.storyName,
      }));
  }, [history]);

  // CSV export
  const csvData = useMemo(
    () => ({
      headers: ["Story", "Date", "% Ready", "Criteria Met", "Total Criteria"],
      rows: history.map((h) => [
        h.storyName,
        h.date,
        h.passRate,
        h.metCount,
        h.totalCriteria,
      ]),
    }),
    [history]
  );

  const promptConfig = useMemo(() => ({
    toolName: "Refinement Checklist",
    prompts: generateRefinementPrompts({
      criteria,
      history: history.map((h) => ({
        storyName: h.storyName,
        passRate: h.passRate,
        checks: Object.fromEntries(h.checks.map((c) => [c.criterionId, c.checked])),
      })),
    }),
  }), [criteria, history]);

  return (
    <ToolPageWrapper
      title="Refinement Checklist"
      description="Track Definition of Ready compliance per story and monitor your team's refinement pass rate over time."
      category="Ceremonies"
    >
      <div className="space-y-6">
        {/* Header */}
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-3">
            <span className="text-sm text-sub">
              {criteria.length} criteria defined
            </span>
            {history.length > 0 && (
              <Badge className="bg-accent/10 text-accent border border-accent/20 text-xs">
                {history.length} stories saved
              </Badge>
            )}
          </div>
          <Button
            variant="ghost"
            size="sm"
            onClick={reset}
            className="text-sub hover:text-red-400 hover:bg-red-400/10"
          >
            Reset All
          </Button>
        </div>

        <div className="grid grid-cols-1 lg:grid-cols-[400px_1fr] gap-6">
          {/* Left — DoR criteria + per-story check */}
          <div className="space-y-4">
            {/* Criteria management */}
            <Card className="bg-surface border-border">
              <CardHeader className="pb-3">
                <div className="flex items-center justify-between">
                  <CardTitle className="text-base font-display text-text flex items-center gap-2">
                    <CheckSquare className="w-4 h-4 text-accent" />
                    Definition of Ready
                  </CardTitle>
                  <Button
                    size="sm"
                    onClick={addCriterion}
                    className="gap-1.5 bg-accent/10 text-accent border border-accent/20 hover:bg-accent/20 hover:border-accent/40"
                  >
                    <Plus className="w-4 h-4" />
                    Add
                  </Button>
                </div>
              </CardHeader>
              <CardContent className="space-y-2">
                {criteria.map((c) => (
                  <CriterionRow
                    key={c.id}
                    criterion={c}
                    checked={false}
                    onLabelChange={(label) => setCriterion(c.id, label)}
                    onRemove={() => removeCriterion(c.id)}
                    showCheckbox={false}
                  />
                ))}
                {criteria.length === 0 && (
                  <p className="text-sm text-sub text-center py-4">
                    No criteria yet. Add some above.
                  </p>
                )}
              </CardContent>
            </Card>

            {/* Per-story checklist */}
            <Card className="bg-surface border-border">
              <CardHeader className="pb-3">
                <div className="flex items-center justify-between">
                  <CardTitle className="text-base font-display text-text">
                    Check Story
                  </CardTitle>
                  <ReadinessIndicator pct={pct} />
                </div>
              </CardHeader>
              <CardContent className="space-y-4">
                <div className="space-y-1.5">
                  <Label className="text-sub text-xs">
                    Story Name / ID
                  </Label>
                  <Input
                    value={storyName}
                    onChange={(e) => setStoryName(e.target.value)}
                    placeholder="e.g. USER-42 — Add dark mode toggle"
                    className="bg-surface-deep border-border text-text focus:border-accent/50"
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
                          color:
                            pct === 100
                              ? "#00ff88"
                              : pct > 0
                              ? "#ffaa00"
                              : "#ef4444",
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
                          background:
                            pct === 100
                              ? "#00ff88"
                              : pct > 0
                              ? "#ffaa00"
                              : "#ef4444",
                        }}
                      />
                    </div>
                  </div>
                )}

                <div className="flex gap-2 pt-1">
                  <Button
                    onClick={saveStory}
                    disabled={!storyName.trim()}
                    className="flex-1 gap-2 bg-accent/10 text-accent border border-accent/20 hover:bg-accent/20 hover:border-accent/40 disabled:opacity-40"
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
              </CardContent>
            </Card>
          </div>

          {/* Right — history + chart */}
          <div className="space-y-4">
            {/* Pass rate chart */}
            {chartData.length > 1 && (
              <Card className="bg-surface border-border">
                <CardHeader className="pb-2">
                  <CardTitle className="text-base font-display text-text flex items-center gap-2">
                    <TrendingUp className="w-4 h-4 text-accent" />
                    Pass Rate Trend
                  </CardTitle>
                </CardHeader>
                <CardContent>
                  <ResponsiveContainer width="100%" height={200}>
                    <LineChart
                      data={chartData}
                      margin={{ top: 10, right: 10, left: -20, bottom: 0 }}
                    >
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
                        formatter={(v, _name, props) => [
                          `${v}%`,
                          props.payload.story,
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
                  </ResponsiveContainer>
                </CardContent>
              </Card>
            )}

            {/* History table */}
            <Card className="bg-surface border-border">
              <CardHeader className="pb-3">
                <div className="flex items-center justify-between">
                  <CardTitle className="text-base font-display text-text flex items-center gap-2">
                    <History className="w-4 h-4 text-accent" />
                    Story History
                    {history.length > 0 && (
                      <span className="text-sm text-sub font-normal">
                        ({history.length})
                      </span>
                    )}
                  </CardTitle>
                  <div className="flex items-center gap-2">
                    {history.length > 0 && (
                      <>
                        <AiPromptGenerator config={promptConfig} />
                        <ExportButton
                          filename="refinement-history"
                          csvData={csvData}
                        />
                        <Button
                          variant="ghost"
                          size="sm"
                          onClick={clearHistory}
                          className="text-sub hover:text-red-400 hover:bg-red-400/10 text-xs"
                        >
                          Clear
                        </Button>
                      </>
                    )}
                  </div>
                </div>
              </CardHeader>
              <CardContent>
                {history.length === 0 ? (
                  <p className="text-sm text-sub text-center py-8">
                    No stories saved yet. Check a story above and click &ldquo;Save to
                    History&rdquo;.
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
                            <td className="py-2.5 pr-4 text-text font-medium truncate max-w-[160px]">
                              {h.storyName}
                            </td>
                            <td className="py-2.5 pr-4 text-sub text-xs">
                              {h.date}
                            </td>
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
                                variant="ghost"
                                size="icon"
                                onClick={() => removeHistory(h.id)}
                                className="h-7 w-7 opacity-0 group-hover:opacity-100 text-sub hover:text-red-400 hover:bg-red-400/10 transition-opacity"
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
              </CardContent>
            </Card>
          </div>
        </div>
      </div>
    </ToolPageWrapper>
  );
}
