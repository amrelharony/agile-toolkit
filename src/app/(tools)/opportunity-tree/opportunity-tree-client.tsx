"use client";

import { useMemo, useRef, useState, type ReactNode } from "react";
import { nanoid } from "nanoid";
import { Plus, Workflow } from "lucide-react";
import { useShallow } from "zustand/react/shallow";
import { useAnnounce } from "@/components/a11y/live-announcer";
import { ToolPageWrapper } from "@/components/layout/tool-page-wrapper";
import { ActionRow } from "@/components/shared/action-row";
import { AiPromptGenerator } from "@/components/shared/ai-prompt-generator";
import { ConfirmDialog } from "@/components/shared/confirm-dialog";
import { EmptyState } from "@/components/shared/empty-state";
import { ExportButton } from "@/components/shared/export-button";
import {
  ExampleNotice,
  LoadExampleButton,
  hasExampleItems,
  isExampleId,
} from "@/components/tool-frame/example-data";
import { Button } from "@/components/ui/button";
import { generateOpportunityTreePrompts } from "@/lib/ai-prompts/opportunity-tree";
import { sendHandoff } from "@/lib/handoffs/send";
import type { HandoffLink } from "@/lib/handoffs/types";
import { OPPORTUNITY_TREE_ACTIONS } from "@/lib/history/event-actions";
import { useHistoryLogger } from "@/lib/history/use-history-logger";
import { HYPOTHESIS_TRACKER_ID, linkedTest } from "@/lib/hypotheses/model";
import {
  OPPORTUNITY_TREE_ID,
  experimentHypothesisSource,
  nodeTitle,
  outcomeOf,
  withTarget,
} from "@/lib/opportunity-tree/model";
import { useWorkspaceStore } from "@/lib/stores/workspace-store";
import type {
  Hypothesis,
  HypothesisTracker,
  JobStory,
  OpportunityTree,
  TreeNode,
  TreeNodeKind,
  Workspace,
} from "@/lib/stores/workspace-types";
import { useWorkspaceHydrated } from "@/lib/team/use-team-roster";
import { cn } from "@/lib/utils";
import { removeWithUndo } from "@/lib/utils/undoable";
import { buildExample } from "./example";
import { applyNodeValues, type NodeValues } from "./form";
import { treeToMarkdown } from "./markdown";
import { NodeCard } from "./node-card";
import { AddNodeForm } from "./node-form";
import {
  KIND_LABEL,
  deleteNote,
  deleteQuestion,
  drawTree,
  keepOneTargetPerOutcome,
  subtreeSummary,
  treeVerdict,
} from "./view";

// Stable empty lists: zustand re-renders forever on a selector that
// returns a fresh array each call.
const NO_TREES: OpportunityTree[] = [];
const NO_TRACKERS: HypothesisTracker[] = [];
const NO_JOBS: JobStory[] = [];
const NONE: TreeNode[] = [];
const NO_HYPOTHESES: Hypothesis[] = [];

/**
 * Deeper than this is a hand-edited chain: the page stops drawing there
 * (the AI prompt's renderTree caps at the same depth).
 */
const MAX_DEPTH = 30;
/** Levels that indent; deeper ones line up under their parent so a phone keeps its width. */
const INDENT_LEVELS = 3;

/**
 * Opportunity Solution Tree (Teresa Torres): an outcome, the opportunities
 * that serve it (split into sub-opportunities as deep as needed), their
 * solutions and the experiments that test them. Nothing is saved without
 * its text; one opportunity per outcome can be the team's target; an
 * experiment becomes a hypothesis to test in the Hypothesis Tracker, and
 * shows its result; deleting a node with anything under it asks first,
 * and Undo puts the whole branch back with its ids, so JTBD jobs linked to
 * it link again. The rules are lib/opportunity-tree's, which
 * tool.opportunity_tree shares.
 */
export function OpportunityTreeClient() {
  const hydrated = useWorkspaceHydrated();
  const trees = useWorkspaceStore((s) => s.opportunityTrees) ?? NO_TREES;
  const trackers = useWorkspaceStore((s) => s.hypothesisTrackers) ?? NO_TRACKERS;
  const jobs = useWorkspaceStore((s) => s.jobStories) ?? NO_JOBS;
  const nodes = trees.find((d) => d.id === OPPORTUNITY_TREE_ID)?.nodes ?? NONE;
  const hypotheses =
    trackers.find((d) => d.id === HYPOTHESIS_TRACKER_ID)?.hypotheses ?? NO_HYPOTHESES;
  const { log } = useHistoryLogger("opportunity-tree");
  const announce = useAnnounce();
  const [addingOutcome, setAddingOutcome] = useState(false);
  const [pendingDelete, setPendingDelete] = useState<TreeNode | null>(null);
  const addOutcomeRef = useRef<HTMLButtonElement>(null);
  const exportRef = useRef<HTMLDivElement>(null);

  const drawn = useMemo(() => drawTree(nodes), [nodes]);
  const verdict = treeVerdict(nodes, hypotheses);

  /* ── Writes ── */

  const ws = () => useWorkspaceStore.getState();
  const currentTree = () => (ws().opportunityTrees ?? []).find((d) => d.id === OPPORTUNITY_TREE_ID);
  const updateNodes = (fn: (list: readonly TreeNode[]) => TreeNode[]) => {
    const doc = currentTree();
    ws().upsertOpportunityTree({
      ...(doc ?? {}),
      id: OPPORTUNITY_TREE_ID,
      nodes: fn(doc?.nodes ?? []),
    });
  };
  const fresh = (id: string) => currentTree()?.nodes.find((n) => n.id === id);
  const patch = (id: string, fn: (n: TreeNode) => TreeNode) =>
    updateNodes((list) => list.map((n) => (n.id === id ? fn(n) : n)));
  // Example rows aren't the team's history.
  const record = (id: string, action: string, payload: Record<string, unknown>) => {
    if (!isExampleId(id)) log(action, payload);
  };

  /** Focus a node's Edit button once the tree has re-rendered. */
  const focusNode = (id: string | undefined) =>
    requestAnimationFrame(() => {
      const el = id
        ? Array.from(document.querySelectorAll<HTMLElement>("[data-node-edit]")).find(
            (b) => b.getAttribute("data-node-edit") === id
          )
        : undefined;
      (el ?? addOutcomeRef.current)?.focus();
    });

  function add(parent: TreeNode | null, kind: TreeNodeKind, values: NodeValues) {
    const node = applyNodeValues(
      { id: nanoid(8), kind, text: "", parentId: parent?.id ?? null },
      values
    );
    updateNodes((list) => [...list, node]);
    record(node.id, OPPORTUNITY_TREE_ACTIONS.NODE_ADDED, {
      nodeId: node.id,
      kind,
      parentId: parent?.id ?? null,
    });
    announce(
      `Added ${KIND_LABEL[kind].toLowerCase()} “${nodeTitle(node)}”${parent ? ` under “${nodeTitle(parent)}”` : ""}`
    );
  }

  function save(node: TreeNode, values: NodeValues) {
    const next = applyNodeValues(node, values);
    if (JSON.stringify(next) === JSON.stringify(node)) return;
    patch(node.id, (n) => applyNodeValues(n, values));
    const fields = (["text", "description", "evidence"] as const).filter(
      (k) => next[k] !== node[k]
    );
    record(node.id, OPPORTUNITY_TREE_ACTIONS.NODE_UPDATED, { nodeId: node.id, fields });
    announce(`Saved “${nodeTitle(next)}”`);
  }

  function toggleTarget(node: TreeNode) {
    const on = !node.target;
    const before = currentTree()?.nodes ?? [];
    const byId = new Map(before.map((n) => [n.id, n]));
    const outcome = outcomeOf(node, byId);
    const replaced = on
      ? before.filter(
          (n) =>
            n.id !== node.id &&
            n.kind === "opportunity" &&
            n.target &&
            (outcomeOf(n, byId)?.id ?? null) === (outcome?.id ?? null)
        )
      : [];
    // At most one target per outcome: withTarget clears the others.
    updateNodes((list) => withTarget(list, node.id, on));
    record(node.id, OPPORTUNITY_TREE_ACTIONS.TARGET_CHANGED, { nodeId: node.id, on });
    announce(
      on
        ? `“${nodeTitle(node)}” is now the target${outcome ? ` for “${nodeTitle(outcome)}”` : ""}${replaced.length > 0 ? `, instead of “${nodeTitle(replaced[0])}”` : ""}`
        : `“${nodeTitle(node)}” is no longer the target`
    );
  }

  function test(node: TreeNode) {
    const current = fresh(node.id) ?? node;
    const link = sendHandoff(
      "hypothesis",
      experimentHypothesisSource(current, currentTree()?.nodes ?? nodes),
      {
        getLinks: () => fresh(node.id)?.sentTo,
        setLinks: (update: (links: readonly HandoffLink[] | undefined) => HandoffLink[]) =>
          patch(node.id, (n) => ({ ...n, sentTo: update(n.sentTo) })),
      }
    );
    if (!link) return;
    record(node.id, OPPORTUNITY_TREE_ACTIONS.EXPERIMENT_SENT, {
      nodeId: node.id,
      hypothesisId: link.targetId,
    });
    announce(`“${nodeTitle(node)}” is now a hypothesis to test`);
    focusNode(node.id);
  }

  /** A leaf goes at once; a node with anything under it asks first. Undo either way. */
  function askDelete(node: TreeNode) {
    if (subtreeSummary(nodes, node.id).ids.size > 1) setPendingDelete(node);
    else remove(node);
  }

  function remove(node: TreeNode) {
    // From the tree as it is now: a child added since the dialog opened goes too.
    const summary = subtreeSummary(currentTree()?.nodes ?? nodes, node.id, jobs);
    const count = summary.ids.size;
    const parentId = node.parentId ?? undefined;
    removeWithUndo<TreeNode>({
      label:
        count > 1
          ? `Deleted “${nodeTitle(node)}” and ${count - 1} below it`
          : `Deleted “${nodeTitle(node)}”`,
      // Undo puts the branch back; a target in it gives way to one picked
      // under the same outcome meanwhile, so an outcome keeps one target.
      update: (fn) => updateNodes((list) => keepOneTargetPerOutcome(list, fn(list))),
      match: (n) => summary.ids.has(n.id),
    });
    record(node.id, OPPORTUNITY_TREE_ACTIONS.NODE_REMOVED, {
      nodeId: node.id,
      kind: node.kind,
      removed: count,
    });
    announce(
      count > 1
        ? `Deleted “${nodeTitle(node)}” and ${count - 1} below it`
        : `Deleted “${nodeTitle(node)}”`
    );
    focusNode(parentId);
  }

  const loadExample = () => updateNodes((list) => [...buildExample(), ...list]);
  const clearExample = () => updateNodes((list) => list.filter((n) => !isExampleId(n.id)));

  /* ── Exports ── */

  const markdown = treeToMarkdown(nodes, hypotheses);
  const csvData = {
    headers: ["Kind", "Text", "Description", "Parent", "Evidence", "Target", "Hypothesis"],
    // Parents by their text: raw ids mean nothing in a spreadsheet.
    rows: nodes.map((n) => {
      const parentText = n.parentId ? (nodes.find((p) => p.id === n.parentId)?.text ?? "") : "";
      const t = linkedTest(n.sentTo, hypotheses);
      return [
        n.kind,
        n.text,
        n.description ?? "",
        parentText,
        n.evidence ?? "",
        n.target ? "yes" : "",
        t.state === "none" ? "" : t.state === "tested" ? t.result : t.status,
      ];
    }),
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
      toolName: "Opportunity Solution Tree",
      prompts: generateOpportunityTreePrompts({ nodes: [...nodes] }, workspace),
    }),
    [nodes, workspace]
  );

  /* ── Drawing ── */

  const seen = new Set<string>();
  const renderNode = (node: TreeNode, depth: number): ReactNode => {
    if (depth > MAX_DEPTH || seen.has(node.id)) return null;
    seen.add(node.id);
    const children = drawn.childrenOf(node.id);
    return (
      <li key={node.id} className="min-w-0 space-y-2">
        <NodeCard
          node={node}
          test={linkedTest(node.sentTo, hypotheses)}
          testable={
            node.kind === "experiment" &&
            experimentHypothesisSource(node, nodes).title.trim().length > 0
          }
          example={isExampleId(node.id)}
          onSave={save}
          onAdd={(parent, kind, values) => add(parent, kind, values)}
          onToggleTarget={toggleTarget}
          onTest={test}
          onDelete={askDelete}
        />
        {children.length > 0 && (
          <ul
            className={cn(
              "space-y-2 border-l border-border",
              depth < INDENT_LEVELS ? "ml-1 pl-3 md:ml-2 md:pl-6" : "pl-1"
            )}
            aria-label={`Under ${nodeTitle(node)}`}
          >
            {children.map((c) => renderNode(c, depth + 1))}
          </ul>
        )}
      </li>
    );
  };

  const pending = pendingDelete ? subtreeSummary(nodes, pendingDelete.id, jobs, hypotheses) : null;

  return (
    <ToolPageWrapper
      toolId="opportunity-tree"
      title="Opportunity Solution Tree"
      description="Map outcomes to opportunities, solutions, and experiments (Teresa Torres framework)."
      category="Product Discovery"
    >
      <div ref={exportRef} className="space-y-4">
        {hasExampleItems(nodes) && <ExampleNotice onClear={clearExample} />}
        <ActionRow>
          {nodes.length > 0 && (
            <>
              <AiPromptGenerator config={promptConfig} />
              <ExportButton
                filename="opportunity-tree"
                csvData={csvData}
                jsonData={nodes}
                markdown={markdown}
                targetRef={exportRef}
              />
            </>
          )}
          {!addingOutcome && (
            <Button
              ref={addOutcomeRef}
              variant="toolkit"
              className="gap-2"
              onClick={() => setAddingOutcome(true)}
            >
              <Plus className="h-4 w-4" aria-hidden="true" />
              Add outcome
            </Button>
          )}
        </ActionRow>

        {addingOutcome && (
          <AddNodeForm
            kind="outcome"
            parent={null}
            onAdd={(values) => {
              add(null, "outcome", values);
              setAddingOutcome(false);
              requestAnimationFrame(() => addOutcomeRef.current?.focus());
            }}
            onCancel={() => {
              setAddingOutcome(false);
              requestAnimationFrame(() => addOutcomeRef.current?.focus());
            }}
          />
        )}

        {nodes.length === 0 ? (
          hydrated &&
          !addingOutcome && (
            <EmptyState icon={Workflow} action={<LoadExampleButton onLoad={loadExample} />}>
              No outcomes yet. Start with the outcome you want to move, then map the customer
              opportunities, solutions and experiments under it, or load an example. Quotes raised
              from User Interviews land here as opportunities.
            </EmptyState>
          )
        ) : (
          <>
            <p className="text-sm font-medium text-text">{verdict}</p>
            <ul className="space-y-4" aria-label="Opportunity tree">
              {drawn.roots.map((n) => renderNode(n, 0))}
            </ul>
          </>
        )}
      </div>

      <ConfirmDialog
        open={pendingDelete !== null}
        onOpenChange={(open) => {
          if (!open) setPendingDelete(null);
        }}
        title={pendingDelete && pending ? deleteQuestion(pendingDelete, pending) : ""}
        description={pending ? deleteNote(pending) : undefined}
        confirmLabel="Delete"
        onConfirm={() => {
          if (pendingDelete) remove(pendingDelete);
        }}
      />
    </ToolPageWrapper>
  );
}
