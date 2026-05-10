"use client";

import { useMemo, useRef, useState, useEffect } from "react";
import { create } from "zustand";
import { persist } from "zustand/middleware";
import {
  ScatterChart,
  Scatter,
  XAxis,
  YAxis,
  CartesianGrid,
  Tooltip,
  ReferenceLine,
} from "recharts";
import { ToolPageWrapper } from "@/components/layout/tool-page-wrapper";
import { ExportButton } from "@/components/shared/export-button";
import { AiPromptGenerator } from "@/components/shared/ai-prompt-generator";
import { generatePrioritizerPrompts } from "@/lib/ai-prompts/prioritizer";
import { useShallow } from "zustand/react/shallow";
import { useWorkspaceStore } from "@/lib/stores/workspace-store";
import type { Workspace } from "@/lib/stores/workspace-types";
import { useHistoryLogger } from "@/lib/history/use-history-logger";
import { PRIORITIZER_ACTIONS } from "@/lib/history/event-actions";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { SectionCard } from "@/components/shared/section-card";
import { ChartCard } from "@/components/shared/chart-card";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Badge } from "@/components/ui/badge";
import { Tabs, TabsList, TabsTrigger, TabsContent } from "@/components/ui/tabs";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { chartTheme } from "@/components/charts/chart-theme";
import { ArrowUpDown, Plus, Trash2 } from "lucide-react";

/* -------------------------------------------------------------------------- */
/*  Types                                                                       */
/* -------------------------------------------------------------------------- */

type MoSCoWCategory = "must" | "should" | "could" | "wont";

const IMPACT_VALUES = [0.25, 0.5, 1, 2, 3] as const;
type ImpactValue = (typeof IMPACT_VALUES)[number];

interface BacklogItem {
  id: string;
  name: string;
  description?: string;
  // MoSCoW
  moscow: MoSCoWCategory;
  // WSJF inputs
  businessValue: number;
  timeCriticality: number;
  riskReduction: number;
  jobSize: number;
  // RICE inputs
  reach: number;
  impact: ImpactValue;
  confidence: number;
  effort: number;
  // Matrix
  value: number;
  matrixEffort: number;
}

interface PrioritizerStore {
  items: BacklogItem[];
  addItem: () => void;
  updateItem: (id: string, updates: Partial<Omit<BacklogItem, "id">>) => void;
  removeItem: (id: string) => void;
  reset: () => void;
}

/* -------------------------------------------------------------------------- */
/*  Defaults                                                                   */
/* -------------------------------------------------------------------------- */

function createDefaultItem(): BacklogItem {
  return {
    id: crypto.randomUUID(),
    name: "New Item",
    moscow: "should",
    businessValue: 5,
    timeCriticality: 5,
    riskReduction: 5,
    jobSize: 5,
    reach: 100,
    impact: 1,
    confidence: 80,
    effort: 1,
    value: 5,
    matrixEffort: 5,
  };
}

const defaultItems: BacklogItem[] = [
  {
    id: crypto.randomUUID(),
    name: "User authentication",
    moscow: "must",
    businessValue: 9,
    timeCriticality: 8,
    riskReduction: 7,
    jobSize: 3,
    reach: 500,
    impact: 2,
    confidence: 90,
    effort: 2,
    value: 9,
    matrixEffort: 3,
  },
  {
    id: crypto.randomUUID(),
    name: "Dashboard redesign",
    moscow: "should",
    businessValue: 7,
    timeCriticality: 4,
    riskReduction: 2,
    jobSize: 5,
    reach: 300,
    impact: 1,
    confidence: 70,
    effort: 4,
    value: 7,
    matrixEffort: 5,
  },
  {
    id: crypto.randomUUID(),
    name: "Export to PDF",
    moscow: "could",
    businessValue: 4,
    timeCriticality: 2,
    riskReduction: 1,
    jobSize: 2,
    reach: 150,
    impact: 0.5,
    confidence: 60,
    effort: 1,
    value: 4,
    matrixEffort: 2,
  },
  {
    id: crypto.randomUUID(),
    name: "Dark mode toggle",
    moscow: "could",
    businessValue: 3,
    timeCriticality: 1,
    riskReduction: 1,
    jobSize: 1,
    reach: 400,
    impact: 0.5,
    confidence: 80,
    effort: 1,
    value: 3,
    matrixEffort: 1,
  },
  {
    id: crypto.randomUUID(),
    name: "Legacy API migration",
    moscow: "wont",
    businessValue: 2,
    timeCriticality: 3,
    riskReduction: 8,
    jobSize: 9,
    reach: 50,
    impact: 1,
    confidence: 50,
    effort: 8,
    value: 5,
    matrixEffort: 9,
  },
];

/* -------------------------------------------------------------------------- */
/*  Store                                                                      */
/* -------------------------------------------------------------------------- */

const usePrioritizerStore = create<PrioritizerStore>()(
  persist(
    (set) => ({
      items: defaultItems,

      addItem: () =>
        set((s) => ({ items: [...s.items, createDefaultItem()] })),

      updateItem: (id, updates) =>
        set((s) => ({
          items: s.items.map((item) =>
            item.id === id ? { ...item, ...updates } : item
          ),
        })),

      removeItem: (id) =>
        set((s) => ({ items: s.items.filter((item) => item.id !== id) })),

      reset: () => set({ items: defaultItems }),
    }),
    { name: "agile-toolkit:prioritizer" }
  )
);

/* -------------------------------------------------------------------------- */
/*  Scoring helpers                                                             */
/* -------------------------------------------------------------------------- */

function wsjfScore(item: BacklogItem): number {
  const cod = item.businessValue + item.timeCriticality + item.riskReduction;
  return parseFloat((cod / Math.max(1, item.jobSize)).toFixed(2));
}

function riceScore(item: BacklogItem): number {
  return parseFloat(
    ((item.reach * item.impact * (item.confidence / 100)) /
      Math.max(0.1, item.effort)).toFixed(1)
  );
}

/* -------------------------------------------------------------------------- */
/*  MoSCoW config                                                              */
/* -------------------------------------------------------------------------- */

const MOSCOW_CONFIG: Record<
  MoSCoWCategory,
  { label: string; color: string; bg: string; borderColor: string }
> = {
  must: {
    label: "Must Have",
    color: "#ef4444",
    bg: "bg-red-500/10",
    borderColor: "border-red-500/30",
  },
  should: {
    label: "Should Have",
    color: "#00f0ff",
    bg: "bg-cyan-400/10",
    borderColor: "border-cyan-400/30",
  },
  could: {
    label: "Could Have",
    color: "#ffaa00",
    bg: "bg-amber-400/10",
    borderColor: "border-amber-400/30",
  },
  wont: {
    label: "Won't Have",
    color: "#94a3b8",
    bg: "bg-slate-500/10",
    borderColor: "border-slate-500/30",
  },
};

/* -------------------------------------------------------------------------- */
/*  Shared input styles                                                        */
/* -------------------------------------------------------------------------- */

const inputCls =
  "bg-surface-deep border-border text-text font-data focus:border-accent/50 focus:ring-accent/20 h-8 text-sm";

/* -------------------------------------------------------------------------- */
/*  Score badge                                                                */
/* -------------------------------------------------------------------------- */

function ScoreBadge({ value, color = "#00f0ff" }: { value: string | number; color?: string }) {
  return (
    <span
      className="inline-flex items-center justify-center px-2 py-0.5 rounded text-xs font-data font-bold min-w-[52px]"
      style={{ color, background: `${color}18`, border: `1px solid ${color}30` }}
    >
      {value}
    </span>
  );
}

/* -------------------------------------------------------------------------- */
/*  Numeric input cell — defers commit until blur/Enter so editing doesn't    */
/*  snap to clamp bounds while the user is mid-keystroke.                     */
/* -------------------------------------------------------------------------- */

function NumCell({
  value,
  min,
  max,
  step,
  onCommit,
  className,
}: {
  value: number;
  min: number;
  max?: number;
  step?: number;
  onCommit: (n: number) => void;
  className?: string;
}) {
  const [draft, setDraft] = useState(String(value));
  useEffect(() => setDraft(String(value)), [value]);

  const commit = () => {
    const n = Number(draft);
    if (Number.isFinite(n)) {
      onCommit(Math.max(min, Math.min(max ?? Infinity, n)));
    } else {
      setDraft(String(value));
    }
  };

  return (
    <Input
      type="number"
      min={min}
      max={max}
      step={step}
      value={draft}
      onChange={(e) => setDraft(e.target.value)}
      onBlur={commit}
      onKeyDown={(e) => {
        if (e.key === "Enter") e.currentTarget.blur();
      }}
      className={className}
    />
  );
}

/* -------------------------------------------------------------------------- */
/*  Items table                                                                */
/* -------------------------------------------------------------------------- */

function ItemsTable({
  items,
  updateItem,
  removeItem,
  addItem,
}: {
  items: BacklogItem[];
  updateItem: PrioritizerStore["updateItem"];
  removeItem: PrioritizerStore["removeItem"];
  addItem: PrioritizerStore["addItem"];
}) {
  return (
    <SectionCard
      title="Backlog Items"
      icon={ArrowUpDown}
      actions={
        <Button
          size="sm"
          variant="toolkit"
          onClick={addItem}
          className="gap-1.5 h-8 text-xs"
        >
          <Plus className="w-3.5 h-3.5" />
          Add Item
        </Button>
      }
    >
      <div className="overflow-x-auto">
        <table className="w-full text-sm">
          <thead>
            <tr className="border-b border-border">
              <th className="text-left text-xs text-sub font-medium uppercase tracking-wider pb-2 pr-3 min-w-[160px]">
                Item Name
              </th>
              <th className="text-left text-xs text-sub font-medium uppercase tracking-wider pb-2 px-2 min-w-[110px]">
                MoSCoW
              </th>
              <th className="text-center text-xs text-sub font-medium uppercase tracking-wider pb-2 px-2">
                Value
              </th>
              <th className="text-center text-xs text-sub font-medium uppercase tracking-wider pb-2 px-2">
                Effort
              </th>
              <th className="text-center text-xs text-sub font-medium uppercase tracking-wider pb-2 px-2">
                Time Crit
              </th>
              <th className="text-center text-xs text-sub font-medium uppercase tracking-wider pb-2 px-2">
                Risk Red
              </th>
              <th className="text-center text-xs text-sub font-medium uppercase tracking-wider pb-2 px-2">
                Job Size
              </th>
              <th className="text-center text-xs text-sub font-medium uppercase tracking-wider pb-2 px-2 min-w-[70px]">
                Reach
              </th>
              <th className="text-center text-xs text-sub font-medium uppercase tracking-wider pb-2 px-2 min-w-[80px]">
                Impact
              </th>
              <th className="text-center text-xs text-sub font-medium uppercase tracking-wider pb-2 px-2 min-w-[70px]">
                Conf %
              </th>
              <th className="text-center text-xs text-sub font-medium uppercase tracking-wider pb-2 px-2 min-w-[70px]">
                RICE Eff
              </th>
              <th className="w-9" />
            </tr>
          </thead>
          <tbody>
            {items.map((item) => (
              <tr key={item.id} className="border-b border-border group">
                <td className="py-2 pr-3 align-top">
                  <div className="flex flex-col gap-1.5 min-w-[140px]">
                    <Input
                      value={item.name}
                      onChange={(e) => updateItem(item.id, { name: e.target.value })}
                      className={inputCls}
                    />
                    <Textarea
                      value={item.description ?? ""}
                      onChange={(e) =>
                        updateItem(item.id, {
                          description: e.target.value.trim() ? e.target.value : undefined,
                        })
                      }
                      placeholder="Description (optional)..."
                      rows={2}
                      className="bg-surface-deep border-border resize-none text-xs"
                      aria-label={`Description for ${item.name || "unnamed item"}`}
                    />
                  </div>
                </td>
                <td className="py-2 px-2">
                  <Select
                    value={item.moscow}
                    onValueChange={(v) =>
                      updateItem(item.id, { moscow: v as MoSCoWCategory })
                    }
                  >
                    <SelectTrigger className={inputCls + " min-w-[110px]"}>
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent className="bg-surface border-border">
                      {(Object.keys(MOSCOW_CONFIG) as MoSCoWCategory[]).map((k) => (
                        <SelectItem key={k} value={k} className="text-text">
                          {MOSCOW_CONFIG[k].label}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </td>
                {/* Value (shared for WSJF business value + matrix value) */}
                <td className="py-2 px-2">
                  <NumCell
                    value={item.businessValue}
                    min={1}
                    max={10}
                    onCommit={(n) =>
                      updateItem(item.id, { businessValue: n, value: n })
                    }
                    className={inputCls + " w-16 text-center"}
                  />
                </td>
                {/* Matrix Effort */}
                <td className="py-2 px-2">
                  <NumCell
                    value={item.matrixEffort}
                    min={1}
                    max={10}
                    onCommit={(n) => updateItem(item.id, { matrixEffort: n })}
                    className={inputCls + " w-16 text-center"}
                  />
                </td>
                {/* Time Criticality */}
                <td className="py-2 px-2">
                  <NumCell
                    value={item.timeCriticality}
                    min={1}
                    max={10}
                    onCommit={(n) => updateItem(item.id, { timeCriticality: n })}
                    className={inputCls + " w-16 text-center"}
                  />
                </td>
                {/* Risk Reduction */}
                <td className="py-2 px-2">
                  <NumCell
                    value={item.riskReduction}
                    min={1}
                    max={10}
                    onCommit={(n) => updateItem(item.id, { riskReduction: n })}
                    className={inputCls + " w-16 text-center"}
                  />
                </td>
                {/* Job Size */}
                <td className="py-2 px-2">
                  <NumCell
                    value={item.jobSize}
                    min={1}
                    max={10}
                    onCommit={(n) => updateItem(item.id, { jobSize: n })}
                    className={inputCls + " w-16 text-center"}
                  />
                </td>
                {/* Reach */}
                <td className="py-2 px-2">
                  <NumCell
                    value={item.reach}
                    min={1}
                    onCommit={(n) => updateItem(item.id, { reach: n })}
                    className={inputCls + " w-20 text-center"}
                  />
                </td>
                {/* Impact */}
                <td className="py-2 px-2">
                  <Select
                    value={String(item.impact)}
                    onValueChange={(v) =>
                      updateItem(item.id, { impact: Number(v) as ImpactValue })
                    }
                  >
                    <SelectTrigger className={inputCls + " w-20"}>
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent className="bg-surface border-border">
                      {IMPACT_VALUES.map((v) => (
                        <SelectItem key={v} value={String(v)} className="text-text">
                          {v}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </td>
                {/* Confidence */}
                <td className="py-2 px-2">
                  <NumCell
                    value={item.confidence}
                    min={1}
                    max={100}
                    onCommit={(n) => updateItem(item.id, { confidence: n })}
                    className={inputCls + " w-16 text-center"}
                  />
                </td>
                {/* RICE Effort */}
                <td className="py-2 px-2">
                  <NumCell
                    value={item.effort}
                    min={0.1}
                    step={0.1}
                    onCommit={(n) => updateItem(item.id, { effort: n })}
                    className={inputCls + " w-16 text-center"}
                  />
                </td>
                <td className="py-2">
                  <Button
                    variant="danger-ghost"
                    size="icon"
                    onClick={() => removeItem(item.id)}
                    disabled={items.length <= 1}
                    className="min-touch-coarse h-8 w-8 disabled:opacity-30"
                  >
                    <Trash2 className="w-3.5 h-3.5" />
                  </Button>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      <p className="mt-3 text-xs text-sub">
        Value (1-10) is used for WSJF Business Value and the matrix Y-axis. Effort (1-10) is the matrix X-axis. RICE Effort is in person-months.
      </p>
    </SectionCard>
  );
}

/* -------------------------------------------------------------------------- */
/*  Tab 1: MoSCoW                                                              */
/* -------------------------------------------------------------------------- */

function MoSCoWTab({ items }: { items: BacklogItem[] }) {
  const groups = useMemo(() => {
    const result = {} as Record<MoSCoWCategory, BacklogItem[]>;
    (Object.keys(MOSCOW_CONFIG) as MoSCoWCategory[]).forEach((k) => {
      result[k] = items.filter((i) => i.moscow === k);
    });
    return result;
  }, [items]);

  return (
    <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
      {(Object.keys(MOSCOW_CONFIG) as MoSCoWCategory[]).map((category) => {
        const cfg = MOSCOW_CONFIG[category];
        const groupItems = groups[category];
        return (
          <Card key={category} className={`bg-surface border ${cfg.borderColor}`}>
            <CardHeader className="pb-2 pt-4">
              <CardTitle className="flex items-center gap-2 text-sm font-display">
                <span
                  className="inline-block w-2.5 h-2.5 rounded-full"
                  style={{ background: cfg.color }}
                />
                <span style={{ color: cfg.color }}>{cfg.label}</span>
                <span className="ml-auto text-xs text-sub font-data">
                  {groupItems.length} item{groupItems.length !== 1 ? "s" : ""}
                </span>
              </CardTitle>
            </CardHeader>
            <CardContent className="pt-0">
              {groupItems.length === 0 ? (
                <p className="text-xs text-sub italic">No items in this category</p>
              ) : (
                <div className="flex flex-wrap gap-2">
                  {groupItems.map((item) => (
                    <Badge
                      key={item.id}
                      className={`${cfg.bg} ${cfg.borderColor} border text-sm font-normal`}
                      style={{ color: cfg.color }}
                    >
                      {item.name}
                    </Badge>
                  ))}
                </div>
              )}
            </CardContent>
          </Card>
        );
      })}
    </div>
  );
}

/* -------------------------------------------------------------------------- */
/*  Tab 2: WSJF                                                               */
/* -------------------------------------------------------------------------- */

function WSJFTab({ items }: { items: BacklogItem[] }) {
  const sorted = useMemo(
    () =>
      [...items]
        .map((i) => ({ ...i, score: wsjfScore(i) }))
        .sort((a, b) => b.score - a.score),
    [items]
  );

  return (
    <SectionCard
      title="WSJF Prioritization"
      titleSuffix="Score = (Business Value + Time Criticality + Risk Reduction) / Job Size"
    >
      <div className="overflow-x-auto">
        <table className="w-full text-sm">
          <thead>
            <tr className="border-b border-border">
              <th className="text-left text-xs text-sub font-medium uppercase tracking-wider pb-2 pr-3">
                Rank
              </th>
              <th className="text-left text-xs text-sub font-medium uppercase tracking-wider pb-2 pr-3 min-w-[160px]">
                Item
              </th>
              <th className="text-center text-xs text-sub font-medium uppercase tracking-wider pb-2 px-2">
                Biz Value
              </th>
              <th className="text-center text-xs text-sub font-medium uppercase tracking-wider pb-2 px-2">
                Time Crit
              </th>
              <th className="text-center text-xs text-sub font-medium uppercase tracking-wider pb-2 px-2">
                Risk Red
              </th>
              <th className="text-center text-xs text-sub font-medium uppercase tracking-wider pb-2 px-2">
                CoD
              </th>
              <th className="text-center text-xs text-sub font-medium uppercase tracking-wider pb-2 px-2">
                Job Size
              </th>
              <th className="text-center text-xs text-sub font-medium uppercase tracking-wider pb-2 px-2">
                WSJF
              </th>
            </tr>
          </thead>
          <tbody>
            {sorted.map((item, idx) => (
              <tr
                key={item.id}
                className="border-b border-border hover:bg-card-hover"
              >
                <td className="py-3 pr-3 align-top">
                  <span className="font-data text-sub text-xs">#{idx + 1}</span>
                </td>
                <td className="py-3 pr-3 font-medium text-text align-top">
                  <div>{item.name}</div>
                  {item.description && (
                    <div className="text-sub text-[11px] mt-0.5 mb-0.5 whitespace-pre-wrap break-words font-normal">
                      {item.description}
                    </div>
                  )}
                </td>
                <td className="py-3 px-2 text-center font-data text-sub">
                  {item.businessValue}
                </td>
                <td className="py-3 px-2 text-center font-data text-sub">
                  {item.timeCriticality}
                </td>
                <td className="py-3 px-2 text-center font-data text-sub">
                  {item.riskReduction}
                </td>
                <td className="py-3 px-2 text-center">
                  <ScoreBadge
                    value={item.businessValue + item.timeCriticality + item.riskReduction}
                    color="#ffaa00"
                  />
                </td>
                <td className="py-3 px-2 text-center font-data text-sub">
                  {item.jobSize}
                </td>
                <td className="py-3 px-2 text-center">
                  <ScoreBadge value={item.score} color="#00f0ff" />
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </SectionCard>
  );
}

/* -------------------------------------------------------------------------- */
/*  Tab 3: RICE                                                               */
/* -------------------------------------------------------------------------- */

function RICETab({ items }: { items: BacklogItem[] }) {
  const sorted = useMemo(
    () =>
      [...items]
        .map((i) => ({ ...i, score: riceScore(i) }))
        .sort((a, b) => b.score - a.score),
    [items]
  );

  return (
    <SectionCard
      title="RICE Prioritization"
      titleSuffix="Score = (Reach × Impact × Confidence%) / Effort"
    >
      <div className="overflow-x-auto">
        <table className="w-full text-sm">
          <thead>
            <tr className="border-b border-border">
              <th className="text-left text-xs text-sub font-medium uppercase tracking-wider pb-2 pr-3">
                Rank
              </th>
              <th className="text-left text-xs text-sub font-medium uppercase tracking-wider pb-2 pr-3 min-w-[160px]">
                Item
              </th>
              <th className="text-center text-xs text-sub font-medium uppercase tracking-wider pb-2 px-2">
                Reach
              </th>
              <th className="text-center text-xs text-sub font-medium uppercase tracking-wider pb-2 px-2">
                Impact
              </th>
              <th className="text-center text-xs text-sub font-medium uppercase tracking-wider pb-2 px-2">
                Confidence
              </th>
              <th className="text-center text-xs text-sub font-medium uppercase tracking-wider pb-2 px-2">
                Effort
              </th>
              <th className="text-center text-xs text-sub font-medium uppercase tracking-wider pb-2 px-2">
                RICE
              </th>
            </tr>
          </thead>
          <tbody>
            {sorted.map((item, idx) => (
              <tr
                key={item.id}
                className="border-b border-border hover:bg-card-hover"
              >
                <td className="py-3 pr-3 align-top">
                  <span className="font-data text-sub text-xs">#{idx + 1}</span>
                </td>
                <td className="py-3 pr-3 font-medium text-text align-top">
                  <div>{item.name}</div>
                  {item.description && (
                    <div className="text-sub text-[11px] mt-0.5 mb-0.5 whitespace-pre-wrap break-words font-normal">
                      {item.description}
                    </div>
                  )}
                </td>
                <td className="py-3 px-2 text-center font-data text-sub">
                  {item.reach}
                </td>
                <td className="py-3 px-2 text-center font-data text-sub">
                  {item.impact}x
                </td>
                <td className="py-3 px-2 text-center font-data text-sub">
                  {item.confidence}%
                </td>
                <td className="py-3 px-2 text-center font-data text-sub">
                  {item.effort} pm
                </td>
                <td className="py-3 px-2 text-center">
                  <ScoreBadge value={item.score} color="#00f0ff" />
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </SectionCard>
  );
}

/* -------------------------------------------------------------------------- */
/*  Scatter tooltip                                                            */
/* -------------------------------------------------------------------------- */

interface ScatterPayload {
  name: string;
  value: number;
  matrixEffort: number;
}

function MatrixTooltip({
  active,
  payload,
}: {
  active?: boolean;
  payload?: Array<{ payload: ScatterPayload }>;
}) {
  if (!active || !payload?.length) return null;
  const d = payload[0].payload;
  return (
    <div style={chartTheme.tooltipStyle} className="px-3 py-2 min-w-[140px]">
      <p className="font-semibold mb-1" style={{ color: "#e2e8f0" }}>
        {d.name}
      </p>
      <div className="text-xs space-y-0.5">
        <div className="flex justify-between gap-3">
          <span style={{ color: "#94a3b8" }}>Value</span>
          <span style={{ color: "#00f0ff" }} className="font-data">
            {d.value}
          </span>
        </div>
        <div className="flex justify-between gap-3">
          <span style={{ color: "#94a3b8" }}>Effort</span>
          <span style={{ color: "#00f0ff" }} className="font-data">
            {d.matrixEffort}
          </span>
        </div>
      </div>
    </div>
  );
}

/* -------------------------------------------------------------------------- */
/*  Tab 4: Matrix                                                              */
/* -------------------------------------------------------------------------- */

function MatrixTab({ items }: { items: BacklogItem[] }) {
  const data = useMemo(
    () =>
      items.map((i) => ({
        name: i.name,
        value: i.value,
        matrixEffort: i.matrixEffort,
      })),
    [items]
  );

  return (
    <ChartCard
      title="Value vs. Effort Matrix"
      height={420}
      footer={
        <>
          {/* Quadrant legend */}
          <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
            {[
              { label: "Quick Wins", desc: "Low effort, high value", color: "#00ff88" },
              { label: "Major Projects", desc: "High effort, high value", color: "#00f0ff" },
              { label: "Fill-ins", desc: "Low effort, low value", color: "#ffaa00" },
              { label: "Time Sinks", desc: "High effort, low value", color: "#ef4444" },
            ].map((q) => (
              <div
                key={q.label}
                className="flex items-start gap-2 p-3 rounded-lg"
                style={{
                  background: `${q.color}0d`,
                  border: `1px solid ${q.color}20`,
                }}
              >
                <span
                  className="mt-0.5 inline-block w-2.5 h-2.5 rounded-full flex-shrink-0"
                  style={{ background: q.color }}
                />
                <div>
                  <p className="text-xs font-semibold" style={{ color: q.color }}>
                    {q.label}
                  </p>
                  <p className="text-xs text-sub mt-0.5">{q.desc}</p>
                </div>
              </div>
            ))}
          </div>

          {/* Item list colored by quadrant */}
          <div className="mt-4 space-y-1.5">
            {items.map((item) => {
              const isHighValue = item.value > 5;
              const isLowEffort = item.matrixEffort <= 5;
              const color =
                isHighValue && isLowEffort
                  ? "#00ff88"
                  : isHighValue
                  ? "#00f0ff"
                  : isLowEffort
                  ? "#ffaa00"
                  : "#ef4444";
              return (
                <div
                  key={item.id}
                  className="flex items-center gap-3 text-sm"
                >
                  <span
                    className="w-2 h-2 rounded-full flex-shrink-0"
                    style={{ background: color }}
                  />
                  <span className="text-text flex-1">{item.name}</span>
                  <span className="text-xs text-sub font-data">
                    V:{item.value} / E:{item.matrixEffort}
                  </span>
                </div>
              );
            })}
          </div>
        </>
      }
    >
      <ScatterChart margin={{ top: 20, right: 30, bottom: 20, left: 10 }}>
        <CartesianGrid
          strokeDasharray="3 3"
          stroke={chartTheme.gridColor}
        />
        <XAxis
          type="number"
          dataKey="matrixEffort"
          domain={[0, 11]}
          tick={{ fill: chartTheme.axisColor, fontSize: 11 }}
          axisLine={{ stroke: chartTheme.gridColor }}
          tickLine={false}
          label={{
            value: "Effort →",
            position: "insideBottomRight",
            offset: -5,
            fill: chartTheme.axisColor,
            fontSize: 11,
          }}
          ticks={[1, 2, 3, 4, 5, 6, 7, 8, 9, 10]}
        />
        <YAxis
          type="number"
          dataKey="value"
          domain={[0, 11]}
          tick={{ fill: chartTheme.axisColor, fontSize: 11 }}
          axisLine={false}
          tickLine={false}
          label={{
            value: "Value ↑",
            angle: -90,
            position: "insideLeft",
            fill: chartTheme.axisColor,
            fontSize: 11,
            offset: 10,
          }}
          ticks={[1, 2, 3, 4, 5, 6, 7, 8, 9, 10]}
        />
        <Tooltip content={<MatrixTooltip />} cursor={{ strokeDasharray: "3 3" }} />

        {/* Quadrant dividers */}
        <ReferenceLine x={5} stroke="rgba(255,255,255,0.15)" strokeWidth={1} />
        <ReferenceLine y={5} stroke="rgba(255,255,255,0.15)" strokeWidth={1} />

        <Scatter
          data={data}
          fill="#00f0ff"
          fillOpacity={0.85}
          r={6}
        />
      </ScatterChart>
    </ChartCard>
  );
}

/* -------------------------------------------------------------------------- */
/*  Main Client Component                                                      */
/* -------------------------------------------------------------------------- */

export function PrioritizerClient() {
  const {
    items,
    addItem: addItemRaw,
    updateItem: updateItemRaw,
    removeItem: removeItemRaw,
    reset: resetRaw,
  } = usePrioritizerStore();
  const { log } = useHistoryLogger("prioritizer");

  const addItem: typeof addItemRaw = (...args) => {
    addItemRaw(...args);
    log(PRIORITIZER_ACTIONS.ITEM_ADDED, {});
  };
  const updateItem: typeof updateItemRaw = (id, updates) => {
    updateItemRaw(id, updates);
    if (
      "businessValue" in updates ||
      "timeCriticality" in updates ||
      "riskReduction" in updates ||
      "jobSize" in updates ||
      "reach" in updates ||
      "impact" in updates ||
      "confidence" in updates ||
      "effort" in updates
    ) {
      log(PRIORITIZER_ACTIONS.SCORE_UPDATED, {
        itemId: id,
        fields: Object.keys(updates),
      });
    }
  };
  const removeItem: typeof removeItemRaw = (id) => {
    const item = items.find((x) => x.id === id);
    removeItemRaw(id);
    log(PRIORITIZER_ACTIONS.ITEM_REMOVED, { itemId: id, name: item?.name });
  };
  const reset = () => {
    resetRaw();
    log(PRIORITIZER_ACTIONS.PRIORITIZER_RESET, {});
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
    toolName: "Backlog Prioritizer",
    prompts: generatePrioritizerPrompts({ items }, workspace),
  }), [items, workspace]);

  const csvData = useMemo(
    () => ({
      headers: [
        "Name",
        "Description",
        "MoSCoW",
        "Business Value",
        "Time Criticality",
        "Risk Reduction",
        "Job Size",
        "WSJF",
        "Reach",
        "Impact",
        "Confidence %",
        "Effort (pm)",
        "RICE",
        "Matrix Value",
        "Matrix Effort",
      ],
      rows: items.map((i) => [
        i.name,
        i.description ?? "",
        MOSCOW_CONFIG[i.moscow].label,
        i.businessValue,
        i.timeCriticality,
        i.riskReduction,
        i.jobSize,
        wsjfScore(i),
        i.reach,
        i.impact,
        i.confidence,
        i.effort,
        riceScore(i),
        i.value,
        i.matrixEffort,
      ]),
    }),
    [items]
  );

  const matrixRef = useRef<HTMLDivElement>(null);

  return (
    <ToolPageWrapper
      toolId="prioritizer"
      title="Backlog Prioritizer"
      description="Prioritize your backlog with MoSCoW, WSJF, RICE, and Value vs. Effort frameworks."
      category="Sprint Planning & Estimation"
    >
      <div className="space-y-6">
        {/* Actions row */}
        <div className="flex items-center justify-between">
          <Button
            variant="danger-ghost"
            size="sm"
            onClick={reset}
          >
            Reset to defaults
          </Button>
          <AiPromptGenerator config={promptConfig} />
          <ExportButton
            filename="backlog-prioritizer"
            csvData={csvData}
            jsonData={items}
          />
        </div>

        {/* Items table */}
        <ItemsTable
          items={items}
          updateItem={updateItem}
          removeItem={removeItem}
          addItem={addItem}
        />

        {/* Prioritization tabs */}
        <Tabs defaultValue="moscow">
          <TabsList className="bg-surface-deep border border-border h-auto p-1 flex-wrap gap-1">
            {[
              { value: "moscow", label: "MoSCoW" },
              { value: "wsjf", label: "WSJF" },
              { value: "rice", label: "RICE" },
              { value: "matrix", label: "Value vs Effort" },
            ].map((tab) => (
              <TabsTrigger
                key={tab.value}
                value={tab.value}
                className="data-[state=active]:bg-accent/10 data-[state=active]:text-accent data-[state=active]:shadow-none text-sub"
              >
                {tab.label}
              </TabsTrigger>
            ))}
          </TabsList>

          <TabsContent value="moscow" className="mt-4">
            <MoSCoWTab items={items} />
          </TabsContent>

          <TabsContent value="wsjf" className="mt-4">
            <WSJFTab items={items} />
          </TabsContent>

          <TabsContent value="rice" className="mt-4">
            <RICETab items={items} />
          </TabsContent>

          <TabsContent value="matrix" className="mt-4">
            <div ref={matrixRef as React.RefObject<HTMLDivElement>}>
              <MatrixTab items={items} />
            </div>
          </TabsContent>
        </Tabs>
      </div>
    </ToolPageWrapper>
  );
}
