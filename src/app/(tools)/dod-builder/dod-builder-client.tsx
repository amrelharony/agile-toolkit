"use client";

import { useMemo, useState } from "react";
import { nanoid } from "nanoid";
import dynamic from "next/dynamic";
import { ToolPageWrapper } from "@/components/layout/tool-page-wrapper";
import { ExportButton } from "@/components/shared/export-button";
import { AiPromptGenerator } from "@/components/shared/ai-prompt-generator";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Progress } from "@/components/ui/progress";
import {
  Plus,
  Trash2,
  Code,
  ShieldCheck,
  FileCode,
  Gauge,
  Lock,
  CircleHelp,
  Camera,
  Check,
} from "lucide-react";
import { generateDodBuilderPrompts } from "@/lib/ai-prompts/dod-builder";
import { ActionRow } from "@/components/shared/action-row";
import { usePersisted } from "@/lib/utils/use-persisted";
import { DOD_STORAGE_KEY } from "./summary";
import { useHistoryLogger } from "@/lib/history/use-history-logger";
import { DOD_ACTIONS } from "@/lib/history/event-actions";
import { pChartLimits } from "@/lib/analytics/control-chart";
import { mannKendall } from "@/lib/analytics/trend-test";
import { todayLocalISO } from "@/lib/utils/formatters";

// Recharts loads with the adherence chart, not the page.
const DodAdherenceChart = dynamic(() => import("./charts").then((m) => m.DodAdherenceChart), {
  ssr: false,
  loading: () => (
    <div className="h-full w-full animate-pulse rounded-lg bg-muted/30" aria-hidden="true" />
  ),
});

type CategoryId = "code" | "testing" | "docs" | "performance" | "security" | "other";

interface DodItem {
  id: string;
  label: string;
  description?: string;
  category: CategoryId;
  required: boolean;
  /** Per-current-sprint completion checkbox; cleared on snapshot. */
  done?: boolean;
}

interface SprintAdherence {
  sprintName: string;
  totalRequired: number;
  completed: number;
  ts: string;
}

interface DodState {
  items: DodItem[];
  history: SprintAdherence[];
}

const STARTER: DodItem[] = [
  { id: "seed-code-review", label: "Code reviewed by peer", category: "code", required: true },
  { id: "seed-unit-tests", label: "Unit tests added/updated", category: "testing", required: true },
  { id: "seed-ci", label: "Integration tests pass in CI", category: "testing", required: true },
  { id: "seed-docs", label: "README or inline docs updated", category: "docs", required: false },
  { id: "seed-perf", label: "Load-tested against SLO", category: "performance", required: false },
  {
    id: "seed-security",
    label: "Security review for sensitive changes",
    category: "security",
    required: false,
  },
];

const CATEGORIES: { id: CategoryId; label: string; icon: typeof Code }[] = [
  { id: "code", label: "Code", icon: Code },
  { id: "testing", label: "Testing", icon: ShieldCheck },
  { id: "docs", label: "Docs", icon: FileCode },
  { id: "performance", label: "Performance", icon: Gauge },
  { id: "security", label: "Security", icon: Lock },
  { id: "other", label: "Other", icon: CircleHelp },
];

export function DodBuilderClient() {
  const [state, setState] = usePersisted<DodState>(DOD_STORAGE_KEY, {
    items: STARTER,
    history: [],
  });
  const [newLabel, setNewLabel] = useState("");
  const [newDescription, setNewDescription] = useState("");
  const [activeCategory, setActiveCategory] = useState<CategoryId>("code");
  const [snapshotName, setSnapshotName] = useState("");
  const { log } = useHistoryLogger("dod-builder");

  const addItem = () => {
    if (!newLabel.trim()) return;
    const description = newDescription.trim() || undefined;
    const item: DodItem = {
      id: nanoid(6),
      label: newLabel.trim(),
      description,
      category: activeCategory,
      required: false,
    };
    setState((s) => ({ ...s, items: [...s.items, item] }));
    log(DOD_ACTIONS.CRITERION_ADDED, {
      itemId: item.id,
      label: item.label,
      description,
      category: item.category,
    });
    setNewLabel("");
    setNewDescription("");
  };

  const toggleRequired = (id: string) => {
    setState((s) => ({
      ...s,
      items: s.items.map((x) => (x.id === id ? { ...x, required: !x.required } : x)),
    }));
    const item = state.items.find((x) => x.id === id);
    log(DOD_ACTIONS.CRITERION_TOGGLED, {
      itemId: id,
      label: item?.label,
      required: !(item?.required ?? false),
    });
  };

  const remove = (id: string) => {
    const item = state.items.find((x) => x.id === id);
    setState((s) => ({ ...s, items: s.items.filter((x) => x.id !== id) }));
    log(DOD_ACTIONS.CRITERION_REMOVED, { itemId: id, label: item?.label });
  };

  const toggleDone = (id: string) => {
    setState((s) => ({
      ...s,
      items: s.items.map((x) => (x.id === id ? { ...x, done: !x.done } : x)),
    }));
  };

  // Snapshot the current sprint's adherence into history. Only required items
  // count toward the trial-block; clearing `done` after lets the team start
  // a fresh sprint without losing the historical record.
  const snapshotSprint = () => {
    const name = snapshotName.trim();
    if (!name) return;
    const required = state.items.filter((i) => i.required);
    if (required.length === 0) return;
    const completed = required.filter((i) => i.done === true).length;
    const entry: SprintAdherence = {
      sprintName: name,
      totalRequired: required.length,
      completed,
      ts: todayLocalISO(),
    };
    setState((s) => ({
      ...s,
      history: [...s.history, entry],
      items: s.items.map((i) => ({ ...i, done: false })),
    }));
    log(DOD_ACTIONS.DOD_RESET, {
      sprintName: name,
      totalRequired: required.length,
      completed,
    });
    setSnapshotName("");
  };

  const adherence = useMemo(() => {
    if (state.history.length === 0) return null;
    const last = state.history[state.history.length - 1];
    return last.totalRequired > 0 ? last.completed / last.totalRequired : 0;
  }, [state.history]);

  // Per-sprint adherence series, snapshotted at sprint close. We plot the
  // trailing 20 sprints so the p-chart limits stay stable as the team's DoD
  // bar evolves; older sprints are summarised but not plotted.
  const adherenceSeries = useMemo(() => {
    return state.history.slice(-20).map((h) => ({
      sprintName: h.sprintName,
      passed: h.completed,
      required: h.totalRequired,
      adherencePct: h.totalRequired > 0 ? (h.completed / h.totalRequired) * 100 : 0,
    }));
  }, [state.history]);

  // p-chart on per-sprint DoD adherence. Each sprint = one trial-block where
  // `passed` = met requirements, `required.length` = total trials. Returns
  // null when fewer than 4 sprints — limits are unstable on tiny series.
  const adherenceControl = useMemo(() => {
    if (adherenceSeries.length < 4) return null;
    const limits = pChartLimits(
      adherenceSeries.map((s) => s.passed),
      adherenceSeries.map((s) => s.required)
    );
    return {
      centerLinePct: limits.centerLine * 100,
      uclPct: limits.ucl * 100,
      lclPct: limits.lcl * 100,
    };
  }, [adherenceSeries]);

  // Mann-Kendall on the per-sprint adherence series. Reports a chip when
  // the trend is significant at α=0.05 over 5+ sprints.
  const adherenceTrend = useMemo(() => {
    if (adherenceSeries.length < 5) return null;
    return mannKendall(adherenceSeries.map((s) => s.adherencePct));
  }, [adherenceSeries]);

  const promptConfig = useMemo(
    () => ({
      toolName: "Definition of Done Builder",
      prompts: generateDodBuilderPrompts({ items: state.items, history: state.history }),
    }),
    [state.items, state.history]
  );

  return (
    <ToolPageWrapper
      toolId="dod-builder"
      title="Definition of Done Builder"
      description="Assemble your team's DoD across categories and track per-sprint adherence."
      category="Risk & Governance"
    >
      <ActionRow>
        <AiPromptGenerator config={promptConfig} />
        <ExportButton
          filename="definition-of-done"
          csvData={{
            headers: ["Category", "Item", "Description", "Required"],
            rows: state.items.map((i) => [
              i.category,
              i.label,
              i.description ?? "",
              i.required ? "Yes" : "No",
            ]),
          }}
          jsonData={state}
        />
      </ActionRow>

      {adherence !== null && (
        <Card className="bg-surface border-border mb-6">
          <CardContent className="p-4">
            <div className="flex items-center justify-between mb-2">
              <div className="text-sm text-sub">Last sprint DoD adherence</div>
              <div className="text-fluid-h3 font-data text-accent">
                {Math.round(adherence * 100)}%
              </div>
            </div>
            <Progress
              value={adherence * 100}
              className="h-2"
              aria-label="Last sprint DoD adherence"
            />
          </CardContent>
        </Card>
      )}

      {/* Sprint snapshot — captures count of `required && done` items into
          history, so the p-chart and Mann-Kendall trend below have data. */}
      <Card className="bg-surface border-border mb-6">
        <CardContent className="p-4">
          <div className="flex flex-col sm:flex-row gap-3 sm:items-end">
            <div className="flex-1">
              <label
                htmlFor="dod-sprint-name"
                className="block text-xs text-sub uppercase tracking-wider font-mono mb-1.5"
              >
                Sprint name
              </label>
              <Input
                id="dod-sprint-name"
                value={snapshotName}
                onChange={(e) => setSnapshotName(e.target.value)}
                onKeyDown={(e) => e.key === "Enter" && snapshotSprint()}
                placeholder="e.g. Sprint 42"
                className="bg-bg border-border"
              />
            </div>
            <div className="text-xs text-sub font-mono whitespace-nowrap">
              {state.items.filter((i) => i.required && i.done).length}
              <span className="text-text/40"> / </span>
              {state.items.filter((i) => i.required).length}
              <span className="text-text/40"> required done</span>
            </div>
            <Button
              onClick={snapshotSprint}
              disabled={!snapshotName.trim() || state.items.filter((i) => i.required).length === 0}
              className="gap-2 bg-accent text-bg hover:bg-accent/90"
            >
              <Camera className="w-4 h-4" />
              Snapshot this sprint
            </Button>
          </div>
        </CardContent>
      </Card>

      {/* p-chart on per-sprint DoD adherence — UCL/X̄/LCL overlay so the team
          can see when adherence drifts outside the natural variation band.
          Renders alongside a Mann-Kendall trend chip when 5+ sprints exist. */}
      {adherenceSeries.length >= 4 && adherenceControl && (
        <Card className="bg-surface border-border mb-6">
          <CardContent className="p-4 space-y-2">
            <div className="flex items-center justify-between">
              <div className="text-sm text-sub">
                DoD adherence — last {adherenceSeries.length} sprints
              </div>
              {adherenceTrend?.significant && (
                <Badge
                  variant="outline"
                  className={`font-mono text-xs tracking-wider uppercase ${
                    adherenceTrend.trend === "up"
                      ? "border-success/40 text-success bg-success/10"
                      : "border-warning/40 text-warning bg-warning/10"
                  }`}
                  title={`Mann-Kendall p=${adherenceTrend.pValue.toFixed(3)}`}
                >
                  {adherenceTrend.trend === "up" ? "↗" : "↘"} adherence trend
                </Badge>
              )}
            </div>
            <div style={{ height: 180 }}>
              <DodAdherenceChart data={adherenceSeries} control={adherenceControl} />
            </div>
          </CardContent>
        </Card>
      )}

      <Tabs value={activeCategory} onValueChange={(v) => setActiveCategory(v as CategoryId)}>
        <TabsList className="bg-surface border border-border mb-4 flex flex-wrap h-auto">
          {CATEGORIES.map((c) => {
            const Icon = c.icon;
            const count = state.items.filter((i) => i.category === c.id).length;
            return (
              <TabsTrigger key={c.id} value={c.id} className="gap-1.5">
                <Icon className="w-3.5 h-3.5" />
                {c.label}
                <span className="text-text/50 font-data text-xs">{count}</span>
              </TabsTrigger>
            );
          })}
        </TabsList>

        {CATEGORIES.map((c) => (
          <TabsContent key={c.id} value={c.id} className="space-y-2">
            {state.items
              .filter((i) => i.category === c.id)
              .map((item) => (
                <div
                  key={item.id}
                  className="flex items-start gap-3 rounded-lg border border-border bg-surface p-3"
                >
                  {/* Per-item done checkbox. Snapshot counts only required-done,
                      but we show the checkbox for all items so users can track
                      optional progress too. */}
                  <button
                    type="button"
                    onClick={() => toggleDone(item.id)}
                    role="checkbox"
                    aria-checked={item.done === true}
                    aria-label={`Done: ${item.label}`}
                    className={`mt-0.5 w-5 h-5 rounded border flex items-center justify-center shrink-0 transition min-touch-coarse ${
                      item.done
                        ? "border-success/60 bg-success/10 text-success"
                        : "border-border text-transparent hover:border-success/40"
                    }`}
                  >
                    <Check className="w-3 h-3" />
                  </button>
                  {/* The visible text names the state, so it is the accessible
                      name too (no aria-pressed: a toggle's name must not change). */}
                  <button
                    type="button"
                    onClick={() => toggleRequired(item.id)}
                    className={`px-2 py-0.5 rounded-md text-xs font-mono uppercase tracking-wider border transition mt-0.5 min-touch-coarse ${
                      item.required
                        ? "border-accent/60 bg-accent/10 text-accent"
                        : "border-border text-sub hover:border-accent/30"
                    }`}
                  >
                    {item.required ? "Required" : "Optional"}
                    <span className="sr-only">: {item.label}</span>
                  </button>
                  <div className="flex-1 min-w-0">
                    <div className="text-text text-sm">{item.label}</div>
                    {item.description && (
                      <div className="text-sub text-xs mt-0.5 mb-1.5 whitespace-pre-wrap break-words">
                        {item.description}
                      </div>
                    )}
                  </div>
                  <Button
                    variant="ghost"
                    size="sm"
                    onClick={() => remove(item.id)}
                    aria-label={`Remove ${item.label}`}
                    className="text-sub hover:text-danger min-touch-coarse"
                  >
                    <Trash2 className="w-3.5 h-3.5" />
                  </Button>
                </div>
              ))}
            <div className="flex flex-col gap-2 pt-2">
              <div className="flex gap-2">
                <Input
                  value={newLabel}
                  onChange={(e) => setNewLabel(e.target.value)}
                  onKeyDown={(e) => e.key === "Enter" && addItem()}
                  placeholder={`Add ${c.label.toLowerCase()} item...`}
                  className="bg-bg border-border"
                  aria-label={`New ${c.label.toLowerCase()} item`}
                />
                <Button onClick={addItem} className="gap-2 bg-accent text-bg hover:bg-accent/90">
                  <Plus className="w-4 h-4" />
                  Add
                </Button>
              </div>
              <Textarea
                value={newDescription}
                onChange={(e) => setNewDescription(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === "Enter" && (e.metaKey || e.ctrlKey)) addItem();
                }}
                placeholder="Description (optional)..."
                rows={2}
                className="bg-bg border-border resize-none text-xs"
                aria-label="New DoD item description"
              />
            </div>
          </TabsContent>
        ))}
      </Tabs>
    </ToolPageWrapper>
  );
}
