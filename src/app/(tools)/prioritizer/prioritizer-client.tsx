"use client";

/**
 * The Backlog Prioritizer: the shared backlog every prioritization method
 * scores, and where the team decides its one order.
 *
 * - Add an item: a name and a description; every method starts Not scored.
 * - The items table: MoSCoW, WSJF, RICE and Value/Effort edited in place
 *   through the method registry's inputs (the item owns them, so the
 *   method tools' linked rows show each edit at once).
 * - All methods: every method's result side by side, ICE, Kano and Cost of
 *   Delay from the rows linked in their tools.
 * - Decide order: each method's places, the Borda consensus, then the
 *   team's order (drag or keyboard), saved as BacklogItem.rank, which
 *   Sprint Planning imports in.
 * - MoSCoW (reorderable buckets), WSJF, RICE and the Value vs Effort chart.
 *
 * Every score, quadrant, place and consensus comes from lib/prioritization
 * (the methods registry and rank.ts), the code tool.prioritizer.* runs.
 */

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useShallow } from "zustand/react/shallow";
import { ArrowUpDown, Plus } from "lucide-react";
import { ToolPageWrapper } from "@/components/layout/tool-page-wrapper";
import { ExportButton } from "@/components/shared/export-button";
import { AiPromptGenerator } from "@/components/shared/ai-prompt-generator";
import { EmptyState } from "@/components/shared/empty-state";
import { SectionCard } from "@/components/shared/section-card";
import { useAnnounce } from "@/components/a11y/live-announcer";
import { ExampleNotice, LoadExampleButton } from "@/components/tool-frame/example-data";
import { Tabs, TabsList, TabsTrigger, TabsContent } from "@/components/ui/tabs";
import { generatePrioritizerPrompts } from "@/lib/ai-prompts/prioritizer";
import { useWorkspaceStore } from "@/lib/stores/workspace-store";
import type { PrioritizationItem, Workspace } from "@/lib/stores/workspace-types";
import { useHistoryLogger } from "@/lib/history/use-history-logger";
import { PRIORITIZER_ACTIONS } from "@/lib/history/event-actions";
import { evaluateItem, evaluateItemIn, method, type Values } from "@/lib/prioritization/methods";
import { decidedOrder } from "@/lib/prioritization/rank";
import { usePrioritizerStore } from "./use-prioritizer-store";
import { isExampleBacklogId } from "./example";
import type { HubMethodId, NewItemValues } from "./hub-form";
import { toMarkdown } from "./markdown";
import { HUB_METHODS, itemName, methodText } from "./method-text";
import { rankOf } from "./order";
import { analyseOrder, orderVerdict } from "./verdict";
import { AddItemForm } from "./components/add-item-form";
import { ItemsTable } from "./components/items-table";
import { ScoresTab } from "./components/scores-tab";
import { WhichMethod } from "./components/which-method";
import { DecideOrder } from "./components/decide-order";
import { MoSCoWTab } from "./components/moscow-tab";
import { WSJFTab } from "./components/wsjf-tab";
import { RICETab } from "./components/rice-tab";
import { MatrixTab } from "./components/matrix-tab";

const NO_ROWS: PrioritizationItem[] = [];

/**
 * Logged when a decided order is saved. Not in PRIORITIZER_ACTIONS
 * (lib/history/event-actions.ts) yet; named like the events that are.
 */
const ORDER_SAVED = "order_saved";

/** The Decide order step's anchor: a link to /prioritizer#decide-order opens it. */
export const DECIDE_ORDER_HASH = "#decide-order";

const TABS = [
  { value: "all", label: "All methods" },
  { value: "decide", label: "Decide order" },
  { value: "moscow", label: "MoSCoW" },
  { value: "wsjf", label: "WSJF" },
  { value: "rice", label: "RICE" },
  { value: "matrix", label: "Value vs Effort" },
] as const;

export function PrioritizerClient() {
  const store = usePrioritizerStore();
  const { items, loadExample, clearExample } = store;
  const rows = useWorkspaceStore((s) => s.prioritizations) ?? NO_ROWS;
  const { log } = useHistoryLogger("prioritizer");
  const announce = useAnnounce();
  const exportRef = useRef<HTMLDivElement>(null);
  const [tab, setTab] = useState<string>("all");
  // The item just added: its first score button takes focus once it's on screen.
  const [focusId, setFocusId] = useState<string | null>(null);
  const focused = useCallback(() => setFocusId(null), []);

  // A next step's "Decide order" link opens that tab.
  useEffect(() => {
    if (window.location.hash !== DECIDE_ORDER_HASH) return;
    setTab("decide");
    window.requestAnimationFrame(() =>
      document.getElementById(DECIDE_ORDER_HASH.slice(1))?.scrollIntoView({ block: "start" })
    );
  }, []);

  const nameOf = useCallback(
    (id: string) => itemName(items.find((i) => i.id === id)?.name),
    [items]
  );
  const analysis = useMemo(() => analyseOrder(items, rows), [items, rows]);
  const verdict = orderVerdict(analysis, nameOf);
  const hasExample = items.some((i) => isExampleBacklogId(i.id));

  /* ── Changes ──────────────────────────────────────────────────────── */

  const add = (values: NewItemValues) => {
    const item = store.addItem(values.name, values.description);
    log(PRIORITIZER_ACTIONS.ITEM_ADDED, { itemId: item.id, name: item.name });
    announce(`Added “${itemName(item.name)}”: not scored in any method, and not ordered yet.`);
    setFocusId(item.id);
  };

  const saveScores = (id: string, methodId: HubMethodId, values: Values) => {
    const patch = store.saveScores(id, methodId, values);
    const fields = Object.keys(patch);
    if (fields.length > 0) {
      log(PRIORITIZER_ACTIONS.SCORE_UPDATED, { itemId: id, method: methodId, fields });
    }
    const saved = (useWorkspaceStore.getState().backlogItems ?? []).find((i) => i.id === id);
    if (saved) {
      const text = methodText(methodId, evaluateItemIn(saved, [], methodId));
      announce(`${method(methodId).label} for “${itemName(saved.name)}”: ${text}.`);
    }
  };

  const remove = (id: string) => {
    const item = items.find((x) => x.id === id);
    store.removeItem(id);
    log(PRIORITIZER_ACTIONS.ITEM_REMOVED, { itemId: id, name: item?.name });
  };

  // The Undo toast says what was saved; a second announcement would repeat it.
  const saveOrder = (ids: readonly string[], label: string) => {
    store.saveOrder(ids, label);
    log(ORDER_SAVED, { ranked: ids.length });
  };

  /* ── Export and prompts ───────────────────────────────────────────── */

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
  const promptConfig = useMemo(
    () => ({
      toolName: "Backlog Prioritizer",
      // Scored by the method registry, with "Not scored" where a method has
      // no inputs, in the decided order: the prompt quotes the screen.
      prompts: generatePrioritizerPrompts({ items, rows }, workspace),
    }),
    [items, rows, workspace]
  );
  const markdown = useMemo(
    () => toMarkdown({ items, rows, analysis, verdict }),
    [items, rows, analysis, verdict]
  );
  // The CSV reads as the screen: the decided order, each method's result
  // in words ("Not scored" where it hasn't scored the item).
  const csvData = useMemo(
    () => ({
      headers: ["Order", "Name", "Description", ...HUB_METHODS.map((id) => method(id).label)],
      rows: decidedOrder(items).map((i) => {
        const all = evaluateItem(i, rows);
        return [
          rankOf(i) ?? "",
          i.name,
          i.description ?? "",
          ...HUB_METHODS.map((id) => methodText(id, all[id])),
        ];
      }),
    }),
    [items, rows]
  );

  return (
    <ToolPageWrapper
      toolId="prioritizer"
      title="Backlog Prioritizer"
      description="Your shared backlog: score it with MoSCoW, WSJF, RICE and Value vs Effort here (ICE, Kano and Cost of Delay in their tools), compare every method side by side, and decide the order Sprint Planning imports in."
      category="Sprint Planning & Estimation"
    >
      <div ref={exportRef} className="space-y-6">
        {hasExample && <ExampleNotice onClear={clearExample} />}

        <div className="flex flex-wrap items-center justify-between gap-3">
          {items.length > 0 ? (
            <p className="min-w-0 flex-1 basis-64 text-sm font-medium text-text">{verdict}</p>
          ) : (
            <span />
          )}
          <div className="flex flex-wrap items-center gap-2">
            <AiPromptGenerator config={promptConfig} />
            <ExportButton
              filename="backlog-prioritizer"
              markdown={markdown}
              csvData={csvData}
              jsonData={items}
              targetRef={exportRef}
            />
          </div>
        </div>

        <SectionCard title="Add an item" icon={Plus}>
          <AddItemForm items={items} onAdd={add} />
        </SectionCard>

        <SectionCard title={`Backlog items (${items.length})`} icon={ArrowUpDown}>
          <ItemsTable
            items={items}
            onRename={(id, name) => store.updateItem(id, { name })}
            onDescribe={(id, description) => store.updateItem(id, { description })}
            onSaveScores={saveScores}
            onRemove={remove}
            focusId={focusId}
            onFocused={focused}
            emptyState={
              <EmptyState
                icon={ArrowUpDown}
                action={<LoadExampleButton onLoad={loadExample} className="mt-4" />}
              >
                Your backlog is empty. Add an item above, or load an example to see how the methods
                compare and decide an order.
              </EmptyState>
            }
          />
          {items.length > 0 && (
            <p className="mt-3 text-xs text-sub">
              Value (Fibonacci 1, 2, 3, 5, 8, 13, 20) is WSJF&apos;s business value and the
              matrix&apos;s value axis (8 or more is high). Effort (1–10) is the matrix&apos;s (6 or
              more is high). Every WSJF part runs 1–20. RICE effort is in person-months, 0.5 at
              least.
            </p>
          )}
        </SectionCard>

        {items.length > 0 && (
          <Tabs value={tab} onValueChange={setTab}>
            <TabsList className="h-auto flex-wrap gap-1 border border-border bg-surface-deep p-1">
              {TABS.map((t) => (
                <TabsTrigger
                  key={t.value}
                  value={t.value}
                  className="text-sub data-[state=active]:bg-accent/10 data-[state=active]:text-accent data-[state=active]:shadow-none"
                >
                  {t.label}
                </TabsTrigger>
              ))}
            </TabsList>

            <TabsContent value="all" className="mt-4 space-y-4">
              <ScoresTab items={items} rows={rows} />
              <WhichMethod />
            </TabsContent>

            <TabsContent value="decide" className="mt-4" id={DECIDE_ORDER_HASH.slice(1)}>
              <DecideOrder items={items} rows={rows} onSaveOrder={saveOrder} />
            </TabsContent>

            <TabsContent value="moscow" className="mt-4">
              <MoSCoWTab items={items} onReorder={saveOrder} />
            </TabsContent>

            <TabsContent value="wsjf" className="mt-4">
              <WSJFTab items={items} />
            </TabsContent>

            <TabsContent value="rice" className="mt-4">
              <RICETab items={items} />
            </TabsContent>

            <TabsContent value="matrix" className="mt-4">
              <MatrixTab items={items} />
            </TabsContent>
          </Tabs>
        )}
      </div>
    </ToolPageWrapper>
  );
}
