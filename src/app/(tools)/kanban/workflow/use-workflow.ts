"use client";

/**
 * The Definition of Workflow on screen: the team's stored one, or an
 * example held in memory while it is open (nothing of it is saved). Every
 * write reads the stored definition at the moment it writes, never a
 * render's copy.
 */

import { useCallback, useMemo, useRef, useState } from "react";
import { useWorkspaceStore } from "@/lib/stores/workspace-store";
import { WORKFLOW_DEFINITION_ID, type WorkflowDefinition } from "@/lib/stores/workspace-types";
import { undoable } from "@/lib/utils/undoable";

const storedDefinition = () =>
  (useWorkspaceStore.getState().workflowDefinitions ?? []).find(
    (d) => d.id === WORKFLOW_DEFINITION_ID
  ) ?? null;

export interface WorkflowController {
  /** The definition on screen: the example while it is open, else the team's (null for none). */
  def: WorkflowDefinition | null;
  /** The example is open: writes stay in memory, nothing is logged. */
  example: boolean;
  /** The definition as it is right now (fresh, not a render's copy). */
  current: () => WorkflowDefinition | null;
  /** Save `build(current)` with Undo (`label` names it). Returns what was saved, or null for no change. */
  save: (
    build: (current: WorkflowDefinition | null) => WorkflowDefinition | null,
    label: string
  ) => WorkflowDefinition | null;
  /** Save without a toast (a STATIK note): it destroys nothing. */
  saveQuietly: (
    build: (current: WorkflowDefinition | null) => WorkflowDefinition | null
  ) => WorkflowDefinition | null;
  openExample: (def: WorkflowDefinition) => void;
  closeExample: () => void;
}

export function useWorkflow(): WorkflowController {
  const stored =
    useWorkspaceStore((s) =>
      (s.workflowDefinitions ?? []).find((d) => d.id === WORKFLOW_DEFINITION_ID)
    ) ?? null;
  const [example, setExample] = useState<WorkflowDefinition | null>(null);
  // Writes read the example as it is now, not as a render saw it.
  const exampleRef = useRef<WorkflowDefinition | null>(null);
  exampleRef.current = example;

  const current = useCallback(() => exampleRef.current ?? storedDefinition(), []);

  const write = useCallback(
    (
      build: (cur: WorkflowDefinition | null) => WorkflowDefinition | null,
      label: string | null
    ): WorkflowDefinition | null => {
      if (exampleRef.current) {
        const next = build(exampleRef.current);
        if (!next || next === exampleRef.current) return null;
        exampleRef.current = next;
        setExample(next);
        return next;
      }
      const before = storedDefinition();
      const next = build(before);
      if (!next || next === before) return null;
      const upsert = useWorkspaceStore.getState().upsertWorkflowDefinition;
      if (label === null) {
        upsert(next);
        return next;
      }
      undoable({
        label,
        apply: () => upsert(next),
        revert: () => {
          if (before) useWorkspaceStore.getState().upsertWorkflowDefinition(before);
          else useWorkspaceStore.getState().removeWorkflowDefinition(WORKFLOW_DEFINITION_ID);
        },
      });
      return next;
    },
    []
  );

  return useMemo(
    () => ({
      def: example ?? stored,
      example: example !== null,
      current,
      save: (build, label) => write(build, label),
      saveQuietly: (build) => write(build, null),
      openExample: (def) => {
        exampleRef.current = def;
        setExample(def);
      },
      closeExample: () => {
        exampleRef.current = null;
        setExample(null);
      },
    }),
    [example, stored, current, write]
  );
}
