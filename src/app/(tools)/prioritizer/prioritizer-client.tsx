"use client";

import { useMemo, useRef } from "react";
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
import { Tabs, TabsList, TabsTrigger, TabsContent } from "@/components/ui/tabs";
import { MOSCOW_CONFIG } from "./constants";
import { riceScore, wsjfScore } from "./scoring";
import { usePrioritizerStore } from "./use-prioritizer-store";
import { ItemsTable } from "./components/items-table";
import { MoSCoWTab } from "./components/moscow-tab";
import { WSJFTab } from "./components/wsjf-tab";
import { RICETab } from "./components/rice-tab";
import { MatrixTab } from "./components/matrix-tab";

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
  const promptConfig = useMemo(
    () => ({
      toolName: "Backlog Prioritizer",
      prompts: generatePrioritizerPrompts({ items }, workspace),
    }),
    [items, workspace]
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
        <div className="flex flex-wrap items-center justify-between gap-2">
          <Button variant="danger-ghost" size="sm" onClick={reset}>
            Reset to defaults
          </Button>
          <AiPromptGenerator config={promptConfig} />
          <ExportButton filename="backlog-prioritizer" csvData={csvData} jsonData={items} />
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
