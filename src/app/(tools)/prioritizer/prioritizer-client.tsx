"use client";

import { useMemo, useRef } from "react";
import { ToolPageWrapper } from "@/components/layout/tool-page-wrapper";
import { ExportButton } from "@/components/shared/export-button";
import { AiPromptGenerator } from "@/components/shared/ai-prompt-generator";
import { generatePrioritizerPrompts } from "@/lib/ai-prompts/prioritizer";
import { useShallow } from "zustand/react/shallow";
import { useWorkspaceStore } from "@/lib/stores/workspace-store";
import type { PrioritizationItem, Workspace } from "@/lib/stores/workspace-types";
import { withBacklogDefaults } from "@/lib/prioritization/frameworks";
import { useHistoryLogger } from "@/lib/history/use-history-logger";
import { PRIORITIZER_ACTIONS } from "@/lib/history/event-actions";
import { ExampleNotice, LoadExampleButton } from "@/components/tool-frame/example-data";
import { Tabs, TabsList, TabsTrigger, TabsContent } from "@/components/ui/tabs";
import { MOSCOW_CONFIG } from "./constants";
import { riceScore, wsjfScore } from "./scoring";
import { usePrioritizerStore } from "./use-prioritizer-store";
import { isExampleBacklogId } from "./example";
import { ItemsTable } from "./components/items-table";
import { ScoresTab } from "./components/scores-tab";
import { WhichMethod } from "./components/which-method";
import { MoSCoWTab } from "./components/moscow-tab";
import { WSJFTab } from "./components/wsjf-tab";
import { RICETab } from "./components/rice-tab";
import { MatrixTab } from "./components/matrix-tab";

const NO_ROWS: PrioritizationItem[] = [];

export function PrioritizerClient() {
  const {
    items,
    addItem: addItemRaw,
    updateItem: updateItemRaw,
    removeItem: removeItemRaw,
    loadExample,
    clearExample,
  } = usePrioritizerStore();
  const rows = useWorkspaceStore((s) => s.prioritizations) ?? NO_ROWS;
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
  const hasExample = items.some((i) => isExampleBacklogId(i.id));

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
  // Phase 7 engine replaces this: a missing input exports as its old default.
  const filled = useMemo(() => items.map(withBacklogDefaults), [items]);
  const promptConfig = useMemo(
    () => ({
      toolName: "Backlog Prioritizer",
      prompts: generatePrioritizerPrompts({ items: filled }, workspace),
    }),
    [filled, workspace]
  );

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
      // The scores come from the stored item, as the tabs show them.
      rows: filled.map((i, n) => [
        i.name,
        i.description ?? "",
        MOSCOW_CONFIG[i.moscow].label,
        i.businessValue,
        i.timeCriticality,
        i.riskReduction,
        i.jobSize,
        wsjfScore(items[n]),
        i.reach,
        i.impact,
        i.confidence,
        i.effort,
        riceScore(items[n]),
        i.value,
        i.matrixEffort,
      ]),
    }),
    [filled, items]
  );

  const matrixRef = useRef<HTMLDivElement>(null);

  return (
    <ToolPageWrapper
      toolId="prioritizer"
      title="Backlog Prioritizer"
      description="Your shared backlog: score it with MoSCoW, WSJF, RICE and Value vs. Effort here, and compare every method side by side."
      category="Sprint Planning & Estimation"
    >
      {hasExample && <ExampleNotice onClear={clearExample} />}
      <div className="space-y-6">
        {/* Actions row */}
        <div className="flex flex-wrap items-center justify-end gap-2">
          <AiPromptGenerator config={promptConfig} />
          <ExportButton filename="backlog-prioritizer" csvData={csvData} jsonData={items} />
        </div>

        {/* Items table: the shared backlog the method tools score */}
        <ItemsTable
          items={items}
          updateItem={updateItem}
          removeItem={removeItem}
          addItem={addItem}
          emptyState={<LoadExampleButton onLoad={loadExample} />}
        />

        {/* Prioritization tabs */}
        <Tabs defaultValue="all">
          <TabsList className="bg-surface-deep border border-border h-auto p-1 flex-wrap gap-1">
            {[
              { value: "all", label: "All methods" },
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

          <TabsContent value="all" className="mt-4 space-y-4">
            <ScoresTab items={items} rows={rows} />
            <WhichMethod />
          </TabsContent>

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
