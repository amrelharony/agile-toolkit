"use client";

import { useCallback, useMemo } from "react";
import { Workflow } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { SectionCard } from "@/components/shared/section-card";
import { ExampleNotice, LoadExampleButton } from "@/components/tool-frame/example-data";
import { useHistoryLogger } from "@/lib/history/use-history-logger";
import {
  KANBAN_BOARD_ID,
  type KanbanCard,
  type KanbanColumnId,
  type Story,
} from "@/lib/stores/workspace-types";
import {
  BOARD_NAME,
  describedBoard,
  workflowItems,
  type WorkflowBoard,
} from "@/lib/kanban/workflow";
import { DowEditor } from "./dow-editor";
import { StatikSteps } from "./statik-steps";
import { Versions } from "./versions";
import { buildWorkflowExample } from "./example";
import type { WorkflowController } from "./use-workflow";

export interface WorkflowSectionProps {
  controller: WorkflowController;
  /** The board on screen. */
  view: WorkflowBoard;
  wipLimits: Record<KanbanColumnId, number>;
  cards: readonly KanbanCard[];
  stories: readonly Story[];
  /** Switch the page to the board the definition describes. */
  onSwitch: (board: WorkflowBoard) => void;
}

/**
 * "How we work", under the board on both views: the Definition of
 * Workflow, designing it with STATIK, and its saved versions. One
 * definition describes one board; on the other board the card says which
 * and offers to switch (both boards share the stage ids In progress, Review
 * and Done, so its policies show only on the board it names).
 */
export function WorkflowSection({
  controller,
  view,
  wipLimits,
  cards,
  stories,
  onSwitch,
}: WorkflowSectionProps) {
  const { log } = useHistoryLogger("kanban");
  const described = describedBoard(controller.def);
  const board: WorkflowBoard = described ?? view;
  const itemsFor = useCallback(
    (b: WorkflowBoard) =>
      workflowItems(
        b,
        { stories, boards: [{ id: KANBAN_BOARD_ID, cards: [...cards], wipLimits }] },
        { includeExamples: controller.example }
      ),
    [stories, cards, wipLimits, controller.example]
  );
  const items = useMemo(() => itemsFor(board), [itemsFor, board]);

  return (
    <SectionCard title="How we work" icon={Workflow} className="mt-6">
      {controller.example && <ExampleNotice onClear={controller.closeExample} />}
      {described && described !== view && (
        <div className="mb-4 flex flex-wrap items-center gap-2 rounded-lg border border-info/30 bg-info/10 px-3 py-2 text-sm text-text">
          <p className="min-w-0 flex-1">
            Your Definition of Workflow describes the {BOARD_NAME[described]}.
          </p>
          <Button type="button" size="sm" variant="outline" onClick={() => onSwitch(described)}>
            Switch to the {BOARD_NAME[described]}
          </Button>
        </div>
      )}
      {!controller.def && (
        <div className="mb-4 flex flex-wrap items-center gap-3 text-sm text-sub">
          <p className="min-w-0 flex-1">
            Write down how work moves on this board: what one item is, when it may enter and leave
            each column, the WIP and pull policies, and how soon the team aims to finish.
          </p>
          <LoadExampleButton
            label="See an example workflow"
            onLoad={() => controller.openExample(buildWorkflowExample())}
          />
        </div>
      )}
      <Tabs defaultValue="definition">
        <TabsList className="border border-border bg-surface-deep">
          <TabsTrigger value="definition">Definition</TabsTrigger>
          <TabsTrigger value="statik">Design it (STATIK)</TabsTrigger>
          <TabsTrigger value="versions">Versions</TabsTrigger>
        </TabsList>
        <TabsContent value="definition" className="mt-4">
          <DowEditor
            controller={controller}
            view={view}
            wipLimits={wipLimits}
            cards={cards}
            itemsFor={itemsFor}
            log={log}
          />
        </TabsContent>
        <TabsContent value="statik" className="mt-4">
          <StatikSteps controller={controller} board={board} items={items} log={log} />
        </TabsContent>
        <TabsContent value="versions" className="mt-4">
          <Versions controller={controller} wipLimits={wipLimits} items={items} log={log} />
        </TabsContent>
      </Tabs>
    </SectionCard>
  );
}
