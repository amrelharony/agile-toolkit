"use client";

import dynamic from "next/dynamic";
import { useMemo, useRef, useState, type ClipboardEvent } from "react";
import { nanoid } from "nanoid";
import { useShallow } from "zustand/react/shallow";
import { Activity, Clock, Columns3, Plus, Trash2, Zap } from "lucide-react";
import { StatCard } from "@/components/shared/stat-card";
import { KpiGrid } from "@/components/shared/kpi-grid";
import { CalloutAlert } from "@/components/shared/callout-alert";
import { SectionCard } from "@/components/shared/section-card";
import { SmartInput } from "@/components/shared/smart-input";
import { EmptyState } from "@/components/shared/empty-state";
import { ItemForm, useItemForm } from "@/components/shared/item-form";
import { AdvancedAnalysis } from "@/components/shared/advanced-analysis";
import { NotEnoughData } from "@/components/shared/not-enough-data";
import { ChartFigure } from "@/components/shared/chart-card";
import type { CausalAnnotationData } from "@/components/charts/causal-annotation";
import { Field } from "@/components/ui/field";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { IconButton } from "@/components/ui/icon-button";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { SourceLink } from "@/components/handoff/source-link";
import { useAnnounce } from "@/components/a11y/live-announcer";
import type { ItemText } from "@/components/shared/inline-item-editor";
import {
  ExampleNotice,
  LoadExampleButton,
  hasExampleItems,
  isExampleId,
} from "@/components/tool-frame/example-data";
import { forecastBayesianHolt } from "@/lib/analytics/forecasting-bayesian";
import { xmrLimits } from "@/lib/analytics/control-chart";
import { cusum } from "@/lib/analytics/changepoint";
import { mannKendall } from "@/lib/analytics/trend-test";
import { enoughData, needMore } from "@/lib/analytics/min-sample";
import { fmt } from "@/lib/charts/chart-text";
import { usePredictedDefault } from "@/lib/predictions/use-predicted-default";
import { useWorkspaceStore } from "@/lib/stores/workspace-store";
import {
  KANBAN_BOARD_ID,
  type KanbanBoard,
  type KanbanCard,
  type KanbanClassOfService,
  type KanbanColumnId,
} from "@/lib/stores/workspace-types";
import { cn } from "@/lib/utils";
import { emit as sonify } from "@/lib/sonification/emit";
import { useHistoryLogger } from "@/lib/history/use-history-logger";
import { KANBAN_ACTIONS } from "@/lib/history/event-actions";
import { undoable } from "@/lib/utils/undoable";
import { toast } from "@/lib/utils/toast";
import { PASTE_LINE_CAP, leftOutMessage, splitPastedLines } from "@/lib/utils/paste-lines";
import { useReturnFocus } from "@/hooks/use-return-focus";
import { buildExample } from "./example";
import { KANBAN_DESCRIPTION_MAX, KANBAN_TITLE_MAX, KanbanCardText } from "./card-text";
import { AgeBadge, BlockedBadge, BlockedToggle, PersonInPlace } from "./card-parts";
import { BoardDnd, DragPreview, DraggableCard, DropColumn } from "./board-dnd";
import { WipLimitInput, clampWipLimit } from "./wip-limit-input";
import { useNow } from "./use-now";
import {
  DEFAULT_WIP_LIMITS,
  EMPTY_CARD_DRAFT,
  FLOW_COLUMNS,
  FLOW_COLUMN_LABEL,
  cardColumnSince,
  cycleStats,
  daysInWork,
  daysSince,
  flowBreaches,
  flowVerdict,
  isLimited,
  movedCard,
  throughputChartText,
  throughputLastWeek,
  validateCard,
  weeklyThroughput,
  type CardDraft,
  type CardValues,
} from "./flow-view";

// Recharts loads with the throughput chart, not the page.
const WeeklyThroughputChart = dynamic(
  () => import("./charts").then((m) => m.WeeklyThroughputChart),
  {
    ssr: false,
    loading: () => (
      <div className="h-full w-full animate-pulse rounded-lg bg-muted/30" aria-hidden="true" />
    ),
  }
);

export interface KanbanState {
  cards: KanbanCard[];
  wipLimits: Record<KanbanColumnId, number>;
}

const DEFAULT_STATE: KanbanState = { cards: [], wipLimits: DEFAULT_WIP_LIMITS };

/** A stored board as the UI reads it; a row missing its cards or limits still opens. */
function readBoard(board: KanbanBoard | undefined): KanbanState {
  if (!board) return DEFAULT_STATE;
  return {
    cards: Array.isArray(board.cards) ? board.cards : [],
    wipLimits: board.wipLimits ?? DEFAULT_WIP_LIMITS,
  };
}

const storedBoard = () =>
  (useWorkspaceStore.getState().kanbanBoards ?? []).find((b) => b.id === KANBAN_BOARD_ID);

/**
 * The synced workspace singleton (was isolated localStorage), so MCP board
 * writes round-trip into the UI: the page, tool.kanban.* and hand-offs all
 * use KANBAN_BOARD_ID. The setter reads the board as stored at the moment
 * it writes, never a render's copy.
 */
export function useKanbanBoard(): [
  KanbanState,
  (updater: KanbanState | ((prev: KanbanState) => KanbanState)) => void,
] {
  const board = useWorkspaceStore(
    useShallow((s) => (s.kanbanBoards ?? []).find((b) => b.id === KANBAN_BOARD_ID))
  );
  const upsertKanbanBoard = useWorkspaceStore((s) => s.upsertKanbanBoard);
  const state = useMemo(() => readBoard(board), [board]);
  const setState = (updater: KanbanState | ((prev: KanbanState) => KanbanState)) => {
    const cur = readBoard(storedBoard());
    const next = typeof updater === "function" ? updater(cur) : updater;
    upsertKanbanBoard({ ...next, id: KANBAN_BOARD_ID });
  };
  return [state, setState];
}

/** Class of service as a theme colour on the card's left edge (the select names it too). */
const COS_BORDER: Record<KanbanClassOfService, string> = {
  standard: "border-l-accent",
  expedite: "border-l-danger",
  fixed_date: "border-l-warning",
  intangible: "border-l-accent-magenta",
};

const COS_LABEL: Record<KanbanClassOfService, string> = {
  standard: "Standard",
  expedite: "Expedite",
  fixed_date: "Fixed Date",
  intangible: "Intangible",
};

/** The column a card shows in: one from an older build's renamed column waits in Backlog. */
function boardColumn(card: KanbanCard): KanbanColumnId {
  return FLOW_COLUMNS.some((c) => c.id === card.column) ? card.column : "backlog";
}

/** A name short enough for a one-line toast. */
function shortName(name: string, max = 40): string {
  const t = name.trim();
  return t.length > max ? `${t.slice(0, max - 1).trimEnd()}…` : t;
}

/**
 * The Flow board: a free board for work outside a sprint (or a team that
 * doesn't run sprints), with classes of service, WIP limits, cycle time and
 * throughput. Cards live in the workspace's one Kanban board.
 */
export function FlowBoard({
  state,
  setState,
}: {
  state: KanbanState;
  setState: (updater: (prev: KanbanState) => KanbanState) => void;
}) {
  const { log } = useHistoryLogger("kanban");
  const announce = useAnnounce();
  const { refFor, returnTo } = useReturnFocus();
  const titleRef = useRef<HTMLInputElement>(null);
  const now = useNow();

  // New cards land in Backlog. Cap free-text card fields: Kanban boards
  // routinely accumulate hundreds of cards over weeks; without these bounds
  // a single mega-paste would push the persisted state past the 5 MB origin
  // quota and silently kill writes for every other tool on this domain.
  const insertCards = (items: CardValues[]) => {
    const at = new Date().toISOString();
    const added: KanbanCard[] = items.map(({ title, description }) => {
      const card: KanbanCard = {
        id: nanoid(8),
        title: title.trim().slice(0, KANBAN_TITLE_MAX),
        column: "backlog",
        class: "standard",
        createdAt: at,
        columnSince: at,
      };
      const desc = description?.trim().slice(0, KANBAN_DESCRIPTION_MAX);
      if (desc) card.description = desc;
      return card;
    });
    if (added.length === 0) return added;
    sonify("kanban", "card-add");
    setState((s) => ({ ...s, cards: [...s.cards, ...added] }));
    for (const c of added) {
      log(KANBAN_ACTIONS.CARD_ADDED, { cardId: c.id, title: c.title, description: c.description });
    }
    return added;
  };

  // Enter or Add: one card, and the cursor stays in the title box. A blank
  // title is an error under the box, never a silent no-op.
  const form = useItemForm<CardDraft, CardValues, "title">({
    initial: EMPTY_CARD_DRAFT,
    validate: validateCard,
    onSave: (values) => {
      insertCards([values]);
      titleRef.current?.focus();
    },
  });

  // Several lines pasted into the title box: one card per line. What's
  // already typed stays in the boxes.
  const pasteCards = (e: ClipboardEvent<HTMLInputElement>) => {
    const pasted = splitPastedLines(e.clipboardData.getData("text"));
    if (!pasted) return;
    e.preventDefault();
    const added = insertCards(pasted.lines.map((title) => ({ title })));
    announce(`Added ${added.length} cards to Backlog.`);
    if (pasted.dropped > 0) {
      toast.info(`Added ${added.length} cards.`, {
        description: `${leftOutMessage(pasted.dropped)} One paste adds up to ${PASTE_LINE_CAP}.`,
      });
    }
  };

  const patchCard = (id: string, patch: (c: KanbanCard) => KanbanCard) =>
    setState((s) => ({ ...s, cards: s.cards.map((c) => (c.id === id ? patch(c) : c)) }));

  // Title and description after adding. An emptied description is removed.
  const editCard = (id: string, next: ItemText) => {
    const title = next.title.slice(0, KANBAN_TITLE_MAX);
    const description = next.description?.slice(0, KANBAN_DESCRIPTION_MAX) || undefined;
    patchCard(id, (c) => {
      const edited: KanbanCard = { ...c, title, description };
      if (!description) delete edited.description;
      return edited;
    });
    log(KANBAN_ACTIONS.CARD_UPDATED, { cardId: id, title, description });
  };

  const moveCard = (id: string, col: KanbanColumnId, { refocus = true } = {}) => {
    const at = new Date().toISOString();
    // BUG-RD3-kanban-1: read `from`/`title` INSIDE the functional updater,
    // not from the render's `state`. Two rapid moves within a tick (a drag
    // across two columns) used to log the pre-tick `from` for both.
    const moved: { title?: string; from?: KanbanColumnId } = {};
    setState((s) => {
      const before = s.cards.find((c) => c.id === id);
      if (!before || before.column === col) return s;
      moved.title = before.title;
      moved.from = before.column;
      return { ...s, cards: s.cards.map((c) => (c.id === id ? movedCard(c, col, at) : c)) };
    });
    if (moved.from === undefined) return;
    sonify("kanban", col === "done" ? "card-done" : "card-move");
    log(KANBAN_ACTIONS.CARD_MOVED, { cardId: id, title: moved.title, from: moved.from, to: col });
    announce(`Moved “${shortName(moved.title ?? "card")}” to ${FLOW_COLUMN_LABEL[col]}.`);
    // The card re-renders in its new column: keep the keyboard on it (a
    // drag leaves focus where the pointer user had it).
    if (refocus) returnTo(`move:${id}`);
  };

  const removeCard = (id: string) => {
    const index = state.cards.findIndex((c) => c.id === id);
    if (index === -1) return;
    const card = state.cards[index];
    // The trash button goes with the card, which would drop the keyboard on
    // the page: focus moves to the next card in the column (the one above
    // when it was the last), else to the emptied column's heading.
    const column = boardColumn(card);
    const inColumn = state.cards.filter((c) => boardColumn(c) === column);
    const at = inColumn.findIndex((c) => c.id === id);
    const neighbour = inColumn[at + 1] ?? inColumn[at - 1];
    returnTo(neighbour ? `move:${neighbour.id}` : `column:${column}`);
    undoable({
      label: `Deleted “${shortName(card.title)}”`,
      apply: () => {
        // BUG-RD3-kanban-1 (same pattern as moveCard): capture title /
        // description from the freshest state inside the updater.
        const removed: { title?: string; description?: string } = {};
        setState((s) => {
          const before = s.cards.find((c) => c.id === id);
          removed.title = before?.title;
          removed.description = before?.description;
          return { ...s, cards: s.cards.filter((c) => c.id !== id) };
        });
        log(KANBAN_ACTIONS.CARD_REMOVED, { cardId: id, ...removed });
      },
      // Back at its old position, so it keeps its place in the column.
      revert: () =>
        setState((s) => {
          if (s.cards.some((c) => c.id === id)) return s;
          const cards = [...s.cards];
          cards.splice(Math.min(index, cards.length), 0, card);
          return { ...s, cards };
        }),
    });
  };

  const setWip = (col: KanbanColumnId, n: number) =>
    setState((s) => ({ ...s, wipLimits: { ...s.wipLimits, [col]: clampWipLimit(n) } }));

  const setClass = (id: string, cls: KanbanClassOfService) => {
    patchCard(id, (c) => ({ ...c, class: cls }));
    log(KANBAN_ACTIONS.CARD_UPDATED, { cardId: id, classOfService: cls });
  };

  const setAssignee = (id: string, name: string) => {
    patchCard(id, (c) => {
      const next: KanbanCard = { ...c };
      if (name) next.assignee = name;
      else delete next.assignee;
      return next;
    });
    log(KANBAN_ACTIONS.CARD_UPDATED, { cardId: id, assignee: name || null });
  };

  const toggleBlocked = (card: KanbanCard) => {
    const blocked = !card.blocked;
    patchCard(card.id, (c) => {
      const next: KanbanCard = { ...c };
      if (blocked) next.blocked = true;
      else delete next.blocked;
      return next;
    });
    log(KANBAN_ACTIONS.CARD_UPDATED, { cardId: card.id, blocked });
    announce(
      blocked
        ? `Flagged “${shortName(card.title)}” as blocked.`
        : `“${shortName(card.title)}” is no longer blocked.`
    );
  };

  // Example cards go through the same setter but are never logged or
  // sonified: loading an example isn't the user's own work. The board is a
  // singleton, so clearing drops only the example cards and keeps the
  // user's cards and WIP limits.
  const loadExample = () => {
    setState((s) => ({ ...s, cards: [...s.cards, ...buildExample()] }));
    form.reset();
  };
  const clearExample = () =>
    setState((s) => ({ ...s, cards: s.cards.filter((c) => !isExampleId(c.id)) }));

  const byColumn = useMemo(() => {
    const map: Record<KanbanColumnId, KanbanCard[]> = {
      backlog: [],
      ready: [],
      in_progress: [],
      review: [],
      done: [],
    };
    for (const c of state.cards) {
      // Cards from an older build may carry a column that no longer exists
      // (a renamed column): show them in Backlog rather than crash the board.
      const col = boardColumn(c);
      map[col].push(col === c.column ? c : { ...c, column: col });
    }
    return map;
  }, [state.cards]);

  const stats = useMemo(() => cycleStats(state.cards), [state.cards]);
  const throughput7 = useMemo(() => throughputLastWeek(state.cards, now), [state.cards, now]);
  const series = useMemo(() => weeklyThroughput(state.cards), [state.cards]);
  const weekly = useMemo(() => series.map((p) => p.value), [series]);
  const chartText = useMemo(() => throughputChartText(series), [series]);
  const verdict = flowVerdict(state.cards, state.wipLimits, stats);
  const violations = flowBreaches(state.cards, state.wipLimits);
  const inFlight = byColumn.in_progress.length + byColumn.review.length;
  const blockedInFlight = [...byColumn.in_progress, ...byColumn.review].filter(
    (c) => c.blocked
  ).length;
  const showAverage = stats.average !== null && enoughData(stats.count, "average");
  const showSpread = stats.spread !== null && enoughData(stats.count, "distribution");
  const showP85 = stats.p85 !== null && enoughData(stats.count, "distribution");

  // ── Smart-default predictor for the in_progress WIP limit ──────────────
  const wipPrediction = usePredictedDefault<number>("kanban", "wipLimit", 3);
  // Local edit buffer so the SmartInput's ghost can render when the field
  // is empty. The committed store value remains the source of truth.
  const [wipEditBuffer, setWipEditBuffer] = useState<string | null>(null);

  const titleOf = (id: string) => state.cards.find((c) => c.id === id)?.title ?? "card";

  return (
    <>
      {hasExampleItems(state.cards) && <ExampleNotice onClear={clearExample} />}

      <p className="mb-3 text-sm font-medium text-text">{verdict}</p>

      <KpiGrid cols={4} gap="lg">
        <StatCard
          variant="compact"
          icon={Clock}
          label="Cycle avg"
          value={showAverage ? `${fmt(stats.average as number)}d` : "—"}
          hint={
            showAverage
              ? showSpread
                ? `±${fmt(stats.spread as number)} days`
                : `from ${stats.count} cards`
              : `finish ${needMore(stats.count, "average")} more`
          }
          valueClassName="text-accent"
        />
        <StatCard
          variant="compact"
          label="85% within"
          value={showP85 ? `${fmt(stats.p85 as number)}d` : "—"}
          hint={showP85 ? "P85 cycle time" : `finish ${needMore(stats.count, "distribution")} more`}
        />
        <StatCard
          variant="compact"
          icon={Zap}
          label="Last 7 days"
          value={throughput7}
          hint="finished"
          valueClassName="text-accent"
        />
        <StatCard
          variant="compact"
          icon={Activity}
          label="In progress"
          value={inFlight}
          hint={blockedInFlight > 0 ? `${blockedInFlight} blocked` : "none blocked"}
          tone={blockedInFlight > 0 ? "danger" : "default"}
        />
      </KpiGrid>

      {series.length >= 2 && (
        <SectionCard title="Weekly throughput" icon={Activity} titleSize="sm" className="mb-4">
          <ChartFigure
            label="Weekly throughput"
            summary={chartText.summary}
            table={chartText.table}
            plotClassName="-mx-2 h-[200px]"
          >
            <WeeklyThroughputChart data={series} />
          </ChartFigure>
        </SectionCard>
      )}

      {series.length >= 2 && <FlowAdvanced series={series} weekly={weekly} />}

      {violations.length > 0 && (
        <CalloutAlert tone="danger" className="mb-4">
          <strong>WIP limit violated:</strong>{" "}
          {violations.map((v) => `${v.label} (${v.count}/${v.limit})`).join(", ")}
        </CalloutAlert>
      )}

      {/* Add-card form. Description is optional; Ctrl/Cmd+Enter submits
          from the textarea. A multi-line paste into the title adds one card
          per line. */}
      <ItemForm
        form={form}
        submitLabel="Add"
        submitIcon={<Plus className="h-4 w-4" aria-hidden="true" />}
        className="mb-4"
      >
        <Field label="New card title" error={form.errors.title}>
          {(props) => (
            <Input
              {...props}
              ref={titleRef}
              value={form.draft.title}
              onChange={(e) => form.update({ title: e.target.value })}
              onPaste={pasteCards}
              maxLength={KANBAN_TITLE_MAX}
              placeholder="e.g. Export invoices as CSV"
              className="bg-surface border-border"
            />
          )}
        </Field>
        <Field label="Description" hint="Optional. Ctrl+Enter adds the card.">
          {(props) => (
            <Textarea
              {...props}
              value={form.draft.description}
              onChange={(e) => form.update({ description: e.target.value })}
              onKeyDown={(e) => {
                if (e.key === "Enter" && (e.metaKey || e.ctrlKey)) {
                  e.preventDefault();
                  form.submit();
                }
              }}
              maxLength={KANBAN_DESCRIPTION_MAX}
              rows={2}
              className="bg-surface border-border resize-none text-xs"
            />
          )}
        </Field>
      </ItemForm>

      {state.cards.length === 0 && (
        <EmptyState
          icon={Columns3}
          padding="md"
          className="mb-4"
          action={<LoadExampleButton onLoad={loadExample} />}
        >
          No cards yet. Add your first one, or load an example board to see WIP limits at work.
        </EmptyState>
      )}

      <BoardDnd
        titleOf={titleOf}
        renderOverlay={(id) => <DragPreview title={titleOf(id)} />}
        onMove={(id, col) => {
          if (FLOW_COLUMNS.some((c) => c.id === col)) {
            moveCard(id, col as KanbanColumnId, { refocus: false });
          }
        }}
      >
        {/* Columns, mobile-first: one lane per swipe (scroll-x-snap) on
            phones, then 2, 3 and all 5 columns as the screen widens. */}
        <div
          className={cn(
            "scroll-x-snap sm:grid sm:gap-3",
            "sm:grid-cols-2 md:grid-cols-3 lg:grid-cols-5",
            // Reset scroll-x styles at sm+: it's a real grid there.
            "sm:overflow-visible sm:m-0 sm:p-0"
          )}
        >
          {FLOW_COLUMNS.map((col) => {
            const cards = byColumn[col.id];
            const limit = state.wipLimits[col.id] ?? 0;
            const over = isLimited(col.id) && limit > 0 && cards.length > limit;
            return (
              <section
                key={col.id}
                aria-label={col.label}
                className="space-y-2 min-w-0 w-[80vw] xs:w-[70vw] sm:w-auto"
              >
                <div
                  className={cn(
                    "rounded-lg border p-2",
                    over ? "border-danger/40 bg-danger/5" : "border-border bg-surface"
                  )}
                >
                  <div className="flex items-center justify-between mb-1">
                    {/* Focus lands here when the column's last card is deleted. */}
                    <h3
                      ref={refFor(`column:${col.id}`)}
                      tabIndex={-1}
                      className="rounded-sm text-xs uppercase tracking-wider text-text font-semibold focus:outline-none focus-visible:ring-2 focus-visible:ring-accent"
                    >
                      {col.label}
                    </h3>
                    <div className="text-xs font-data text-sub">
                      {cards.length}
                      {limit > 0 && isLimited(col.id) && ` / ${limit}`}
                      {over && <span className="sr-only"> (over the WIP limit)</span>}
                    </div>
                  </div>
                  {isLimited(col.id) &&
                    (col.id === "in_progress" ? (
                      // SmartInput on the most-used column: the predictor
                      // offers a limit as a ghost value, and Tab accepts it
                      // (never applied on its own). Same draft-on-blur
                      // pattern as WipLimitInput (BUG-RD3-kanban-2).
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
                              value={wipEditBuffer ?? String(limit)}
                              placeholder={ghost ?? "WIP"}
                              onKeyDown={(e) => {
                                if (e.key === "Tab" && wipEditBuffer === "") {
                                  e.preventDefault();
                                  accept();
                                }
                                if (e.key === "Enter") e.currentTarget.blur();
                              }}
                              onChange={(e) => setWipEditBuffer(e.target.value)}
                              onBlur={() => {
                                const raw = wipEditBuffer;
                                setWipEditBuffer(null);
                                if (raw === null || raw === "") return;
                                const n = Number(raw);
                                if (Number.isFinite(n) && n >= 0 && n !== limit) {
                                  setWip("in_progress", n);
                                }
                              }}
                              className="h-8 sm:h-7 text-xs bg-bg border-border font-data"
                              aria-label={`WIP limit for ${col.label}`}
                            />
                            {chip}
                          </>
                        )}
                      />
                    ) : (
                      <WipLimitInput
                        colLabel={col.label}
                        value={limit}
                        onCommit={(n) => setWip(col.id, n)}
                      />
                    ))}
                </div>
                {/* Card pile. Mobile gets a smaller min-height so empty
                    lanes don't waste a third of the viewport. */}
                <DropColumn
                  id={col.id}
                  className="space-y-2 min-h-[100px] sm:min-h-[140px] md:min-h-[200px]"
                >
                  {cards.map((c) => (
                    <FlowCard
                      key={c.id}
                      card={c}
                      now={now}
                      p85={showP85 ? stats.p85 : null}
                      moveRef={refFor(`move:${c.id}`)}
                      onEdit={(next) => editCard(c.id, next)}
                      onMove={(to) => moveCard(c.id, to)}
                      onClass={(cls) => setClass(c.id, cls)}
                      onAssignee={(name) => setAssignee(c.id, name)}
                      onToggleBlocked={() => toggleBlocked(c)}
                      onRemove={() => removeCard(c.id)}
                    />
                  ))}
                </DropColumn>
              </section>
            );
          })}
        </div>
      </BoardDnd>
    </>
  );
}

/** One Flow board card: text, flags, age in its column, who has it, and its controls. */
function FlowCard({
  card: c,
  now,
  p85,
  moveRef,
  onEdit,
  onMove,
  onClass,
  onAssignee,
  onToggleBlocked,
  onRemove,
}: {
  card: KanbanCard;
  now: Date;
  /** The P85 cycle time once there are enough done cards: older open cards are flagged. */
  p85: number | null;
  moveRef: (el: HTMLElement | null) => void;
  onEdit: (next: ItemText) => void;
  onMove: (to: KanbanColumnId) => void;
  onClass: (cls: KanbanClassOfService) => void;
  onAssignee: (name: string) => void;
  onToggleBlocked: () => void;
  onRemove: () => void;
}) {
  const label = FLOW_COLUMN_LABEL[c.column] ?? "Backlog";
  const age = daysSince(cardColumnSince(c), now);
  // Against P85 (start to done), the time in work counts, not the time in
  // this column: a card that just went from In progress to Review has been
  // in work all along.
  const working = c.column === "in_progress" || c.column === "review";
  const inWork = working ? daysInWork(c, now) : null;
  const ageing = p85 !== null && inWork !== null && inWork > p85;
  // An agent's move into Done leaves the flag behind; a done card isn't blocked.
  const blocked = Boolean(c.blocked) && c.column !== "done";
  return (
    <DraggableCard
      id={c.id}
      className={cn(
        "rounded-md border border-border border-l-[3px] bg-bg p-2 text-xs",
        COS_BORDER[c.class]
      )}
    >
      {(grip) => (
        <>
          <div className="flex items-start gap-1">
            {grip}
            <div className="min-w-0 flex-1">
              <KanbanCardText title={c.title} description={c.description} onSave={onEdit} />
            </div>
          </div>
          <div className="mb-1.5 flex flex-wrap items-center gap-x-2 gap-y-1">
            {blocked && <BlockedBadge />}
            <AgeBadge
              days={age}
              column={label}
              warn={ageing}
              note={
                ageing
                  ? `in work for ${inWork} ${inWork === 1 ? "day" : "days"}, longer than 85% of finished cards took`
                  : undefined
              }
            />
            {/* Sent here from another tool (a retro action). */}
            <SourceLink sourceRef={c.sourceRef} />
          </div>
          <div className="mb-1.5 flex flex-wrap items-center justify-between gap-1">
            <PersonInPlace
              value={c.assignee}
              itemTitle={c.title}
              role="Assignee"
              emptyText="Unassigned"
              offerAddToRoster={!isExampleId(c.id)}
              onSave={onAssignee}
            />
            {c.column !== "done" && (
              <BlockedToggle blocked={blocked} itemTitle={c.title} onToggle={onToggleBlocked} />
            )}
          </div>
          {/* Card controls. Stacked on mobile (one per row) so each select
              is a comfortable touch target; a row on wider screens. */}
          <div className="flex flex-col xs:flex-row xs:items-center gap-1.5">
            <Select value={c.column} onValueChange={(v) => onMove(v as KanbanColumnId)}>
              <SelectTrigger
                ref={moveRef}
                className="h-9 xs:h-7 text-xs bg-surface border-border xs:w-28 w-full"
                aria-label={`Move ${c.title}`}
              >
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {FLOW_COLUMNS.map((x) => (
                  <SelectItem key={x.id} value={x.id} className="text-xs">
                    {x.label}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
            <div className="flex items-center gap-1.5 flex-1">
              <Select value={c.class} onValueChange={(v) => onClass(v as KanbanClassOfService)}>
                <SelectTrigger
                  className="h-9 xs:h-7 text-xs bg-surface border-border flex-1"
                  aria-label={`Class of service for ${c.title}`}
                >
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {(Object.keys(COS_LABEL) as KanbanClassOfService[]).map((cls) => (
                    <SelectItem key={cls} value={cls} className="text-xs">
                      {COS_LABEL[cls]}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
              <IconButton
                label={`Remove ${c.title}`}
                icon={<Trash2 className="h-4 w-4 xs:h-3.5 xs:w-3.5" />}
                className="text-sub hover:text-danger"
                onClick={onRemove}
              />
            </div>
          </div>
        </>
      )}
    </DraggableCard>
  );
}

/**
 * The statistics that need a longer history than a glance at the board:
 * next week's forecast, a trend test and the control chart with change
 * points. Each waits for its minimum sample (lib/analytics/min-sample), and
 * all of it stays folded away until opened.
 */
function FlowAdvanced({
  series,
  weekly,
}: {
  series: { label: string; value: number }[];
  weekly: number[];
}) {
  const weeks = weekly.length;
  const forecast = useMemo(
    // The Bayesian variant widens its bands on short histories rather than
    // drawing the over-confident ones plain Holt gives.
    () =>
      enoughData(weeks, "forecast") ? forecastBayesianHolt(weekly, 1, { priorWeight: 2 }) : [],
    [weekly, weeks]
  );
  const trend = useMemo(
    () => (enoughData(weeks, "trend") ? mannKendall(weekly) : null),
    [weekly, weeks]
  );
  const control = useMemo(() => {
    if (!enoughData(weeks, "changePoint")) return null;
    // Throughput can't be negative: the lower limit stops at 0.
    const limits = xmrLimits(weekly, true);
    const labels = new Set(series.map((p) => p.label));
    const annotations = cusum(weekly)
      .map((cp): CausalAnnotationData | null => {
        const point = series[cp.index];
        if (!point) return null;
        return {
          x: point.label,
          label: cp.direction === "up" ? "Throughput regime up" : "Throughput regime down",
          detail: `CUSUM found a ${cp.direction === "up" ? "sustained increase" : "sustained decrease"} in weekly throughput at ${point.label}.`,
          confidence: cp.cumulativeStat >= 6 ? "strong" : "moderate",
        };
      })
      // An annotation off the chart's x-axis would add phantom ticks.
      .filter((a): a is CausalAnnotationData => a !== null && labels.has(String(a.x)));
    const shifts = annotations.length;
    return {
      limits,
      annotations,
      summary: `Control limits: centre ${fmt(limits.centerLine)}, upper ${fmt(limits.ucl)}, lower ${fmt(limits.lcl)} cards a week; ${
        shifts === 0
          ? "no lasting shift found"
          : `${shifts} lasting ${shifts === 1 ? "shift" : "shifts"} found`
      }.`,
    };
  }, [series, weekly, weeks]);
  const next = forecast[0];

  return (
    <AdvancedAnalysis className="mb-4">
      <div>
        <h4 className="mb-1 text-sm font-medium text-text">Next week</h4>
        {next ? (
          <p className="text-sm text-sub">
            About {Math.max(0, Math.round(next.yHat))} cards (80% range{" "}
            {Math.max(0, Math.round(next.lower80))}–{Math.max(0, Math.round(next.upper80))}).
          </p>
        ) : (
          <NotEnoughData have={weeks} need="forecast" unit={["week", "weeks"]} what="a forecast" />
        )}
      </div>
      <div>
        <h4 className="mb-1 text-sm font-medium text-text">Trend</h4>
        {trend ? (
          <p className="text-sm text-sub">
            {trend.significant
              ? `Weekly throughput is trending ${trend.trend} (Mann-Kendall p = ${trend.pValue.toFixed(3)}).`
              : `No clear trend in weekly throughput yet (Mann-Kendall p = ${trend.pValue.toFixed(3)}).`}
          </p>
        ) : (
          <NotEnoughData have={weeks} need="trend" unit={["week", "weeks"]} what="a trend" />
        )}
      </div>
      <div>
        <h4 className="mb-1 text-sm font-medium text-text">Control chart</h4>
        {control ? (
          <ChartFigure
            label="Weekly throughput control chart"
            summary={control.summary}
            table={{
              columns: ["Week", "Cards finished"],
              rows: series.map((p) => [p.label, p.value]),
              caption: "Cards finished per week",
            }}
            plotClassName="-mx-2 h-[200px]"
          >
            <WeeklyThroughputChart
              data={series}
              limits={control.limits}
              annotations={control.annotations}
            />
          </ChartFigure>
        ) : (
          <NotEnoughData
            have={weeks}
            need="changePoint"
            unit={["week", "weeks"]}
            what="control limits and shifts"
          />
        )}
      </div>
    </AdvancedAnalysis>
  );
}
