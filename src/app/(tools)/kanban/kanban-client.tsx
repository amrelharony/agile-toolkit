"use client";

import { useMemo, useState } from "react";
import { nanoid } from "nanoid";
import { ToolPageWrapper } from "@/components/layout/tool-page-wrapper";
import { ExportButton } from "@/components/shared/export-button";
import { AiPromptGenerator } from "@/components/shared/ai-prompt-generator";
import { StatCard } from "@/components/shared/stat-card";
import { ActionRow } from "@/components/shared/action-row";
import { KpiGrid } from "@/components/shared/kpi-grid";
import { CalloutAlert } from "@/components/shared/callout-alert";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Plus, Trash2, Zap, Clock, TrendingUp } from "lucide-react";
import { mean, stdDev } from "@/lib/analytics/anomaly";
import { forecastHolt } from "@/lib/analytics/forecasting";
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

export function KanbanClient() {
  const [state, setState] = usePersisted<KanbanState>("agile-toolkit:kanban", DEFAULT_STATE);
  const [newTitle, setNewTitle] = useState("");
  const { log } = useHistoryLogger("kanban");

  const addCard = () => {
    if (!newTitle.trim()) return;
    sonify("kanban", "card-add");
    const now = new Date().toISOString();
    const cardId = nanoid(8);
    const title = newTitle.trim();
    setState((s) => ({
      ...s,
      cards: [
        ...s.cards,
        { id: cardId, title, column: "backlog", class: "standard", createdAt: now },
      ],
    }));
    log(KANBAN_ACTIONS.CARD_ADDED, { cardId, title });
    setNewTitle("");
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
    log(KANBAN_ACTIONS.CARD_REMOVED, { cardId: id, title: card?.title });
  };
  const setWip = (col: ColumnId, n: number) =>
    setState((s) => ({ ...s, wipLimits: { ...s.wipLimits, [col]: Math.max(0, n) } }));
  const setClass = (id: string, cls: ClassOfService) => {
    setState((s) => ({ ...s, cards: s.cards.map((c) => (c.id === id ? { ...c, class: cls } : c)) }));
    log(KANBAN_ACTIONS.CARD_UPDATED, { cardId: id, classOfService: cls });
  };

  const byColumn = useMemo(() => {
    const map: Record<ColumnId, KCard[]> = { backlog: [], ready: [], in_progress: [], review: [], done: [] };
    for (const c of state.cards) map[c.column].push(c);
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

  const weeklyThroughput = useMemo(() => {
    const byWeek = new Map<string, number>();
    for (const c of state.cards) {
      if (!c.completedAt) continue;
      const d = new Date(c.completedAt);
      const y = d.getFullYear();
      const week = Math.floor((d.getTime() - new Date(y, 0, 1).getTime()) / (7 * 24 * 60 * 60 * 1000));
      const key = `${y}-W${String(week).padStart(2, "0")}`;
      byWeek.set(key, (byWeek.get(key) ?? 0) + 1);
    }
    return Array.from(byWeek.entries())
      .sort(([a], [b]) => a.localeCompare(b))
      .map(([, v]) => v);
  }, [state.cards]);

  const forecast = weeklyThroughput.length >= 2 ? forecastHolt(weeklyThroughput, 1) : [];

  const violations = COLUMNS.filter((c) => c.id !== "backlog" && c.id !== "done" && state.wipLimits[c.id] > 0 && byColumn[c.id].length > state.wipLimits[c.id]);

  const promptConfig = useMemo(
    () => ({
      toolName: "Kanban Board",
      prompts: generateKanbanPrompts({ cards: state.cards, wipLimits: state.wipLimits, cycleAvg, cycleP85, throughputLast7 }),
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
            headers: ["Title", "Column", "Class", "Created", "Started", "Completed", "Cycle (days)"],
            rows: state.cards.map((c) => [
              c.title,
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
        <StatCard
          variant="compact"
          label="P85"
          value={`${cycleP85.toFixed(1)}d`}
        />
        <StatCard
          variant="compact"
          icon={Zap}
          label="Last 7 days"
          value={throughputLast7}
          hint="completed"
          valueClassName="text-accent"
        />
        <StatCard
          variant="compact"
          icon={TrendingUp}
          label="Next week"
          value={
            forecast[0] ? Math.max(0, Math.round(forecast[0].yHat)) : "—"
          }
          hint="forecast"
        />
      </KpiGrid>

      {violations.length > 0 && (
        <CalloutAlert tone="danger" className="mb-4">
          <strong>WIP limit violated:</strong>{" "}
          {violations.map((v) => `${v.label} (${byColumn[v.id].length}/${state.wipLimits[v.id]})`).join(", ")}
        </CalloutAlert>
      )}

      {/* Add-card row. Stacks vertically on the smallest phones so the
          "Add" button stays a comfortable touch target. */}
      <div className="flex flex-col xs:flex-row gap-2 mb-4">
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
            <div
              key={col.id}
              className="space-y-2 min-w-0 w-[80vw] xs:w-[70vw] sm:w-auto"
            >
              <div
                className={cn(
                  "rounded-lg border p-2",
                  over
                    ? "border-danger/40 bg-danger/5"
                    : "border-border bg-surface"
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
                {col.id !== "backlog" && col.id !== "done" && (
                  <Input
                    type="number"
                    min={0}
                    value={limit}
                    onChange={(e) => setWip(col.id, Number(e.target.value))}
                    placeholder="WIP"
                    className="h-8 sm:h-7 text-xs bg-bg border-border font-data"
                    aria-label={`WIP limit for ${col.label}`}
                  />
                )}
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
                    <div className="text-text font-medium mb-1.5 break-words">
                      {c.title}
                    </div>
                    {/* Card controls. Stacked on mobile (one per row) so each
                        select/button is a comfortable touch target; flex row
                        on sm+ where horizontal density is fine. */}
                    <div className="flex flex-col xs:flex-row xs:items-center gap-1.5">
                      <Select
                        value={c.column}
                        onValueChange={(v) => moveCard(c.id, v as ColumnId)}
                      >
                        <SelectTrigger
                          className="h-9 xs:h-7 text-xs bg-surface border-border xs:w-24 w-full"
                          aria-label={`Move ${c.title}`}
                        >
                          <SelectValue />
                        </SelectTrigger>
                        <SelectContent>
                          {COLUMNS.map((x) => (
                            <SelectItem
                              key={x.id}
                              value={x.id}
                              className="text-xs"
                            >
                              {x.label}
                            </SelectItem>
                          ))}
                        </SelectContent>
                      </Select>
                      <div className="flex items-center gap-1.5 flex-1">
                        <Select
                          value={c.class}
                          onValueChange={(v) =>
                            setClass(c.id, v as ClassOfService)
                          }
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
