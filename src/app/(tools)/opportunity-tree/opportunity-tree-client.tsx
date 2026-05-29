"use client";

import { useMemo } from "react";
import { nanoid } from "nanoid";
import { ToolPageWrapper } from "@/components/layout/tool-page-wrapper";
import { ExportButton } from "@/components/shared/export-button";
import { AiPromptGenerator } from "@/components/shared/ai-prompt-generator";
import { Button } from "@/components/ui/button";
import { BlurInput, BlurTextarea } from "@/components/shared/blur-fields";
import { Plus, Trash2, Workflow } from "lucide-react";
import { generateOpportunityTreePrompts } from "@/lib/ai-prompts/opportunity-tree";
import { useShallow } from "zustand/react/shallow";
import { useWorkspaceStore } from "@/lib/stores/workspace-store";
import type { Workspace } from "@/lib/stores/workspace-types";
import { useHistoryLogger } from "@/lib/history/use-history-logger";
import { OPPORTUNITY_TREE_ACTIONS } from "@/lib/history/event-actions";
import { ActionRow } from "@/components/shared/action-row";
import { EmptyState } from "@/components/shared/empty-state";

type NodeKind = "outcome" | "opportunity" | "solution" | "experiment";

interface TreeNode {
  id: string;
  kind: NodeKind;
  text: string;
  parentId: string | null;
  evidence?: string;
  // Optional elaboration applicable to any node kind. Distinct from
  // `evidence`, which is only meaningful for opportunity/experiment nodes.
  description?: string;
}

const KIND_COLORS: Record<NodeKind, string> = {
  outcome: "#00f0ff",
  opportunity: "#a855f7",
  solution: "#34d399",
  experiment: "#f59e0b",
};

const CHILD_KIND: Record<NodeKind, NodeKind | null> = {
  outcome: "opportunity",
  opportunity: "solution",
  solution: "experiment",
  experiment: null,
};

const OT_ID = "opportunityTree:current"; // MUST match OT_ID in opportunity-tree.ts.
const EMPTY_NODES: TreeNode[] = [];

// Synced workspace singleton (was isolated usePersisted/localStorage) wrapping
// the nodes[] array. Drop-in [state, setState] (structural types).
function useNodes(): [TreeNode[], (u: TreeNode[] | ((p: TreeNode[]) => TreeNode[])) => void] {
  const doc = useWorkspaceStore(
    useShallow((s) => (s.opportunityTrees ?? []).find((d) => d.id === OT_ID))
  );
  const upsert = useWorkspaceStore((s) => s.upsertOpportunityTree);
  const nodes = doc?.nodes ?? EMPTY_NODES;
  const setNodes = (u: TreeNode[] | ((p: TreeNode[]) => TreeNode[])) => {
    const cur =
      (useWorkspaceStore.getState().opportunityTrees ?? []).find((d) => d.id === OT_ID)?.nodes ??
      [];
    const next = typeof u === "function" ? u(cur) : u;
    upsert({ id: OT_ID, nodes: next });
  };
  return [nodes, setNodes];
}

export function OpportunityTreeClient() {
  const [nodes, setNodes] = useNodes();
  const { log } = useHistoryLogger("opportunity-tree");

  const addRoot = () => {
    const node = { id: nanoid(6), kind: "outcome" as const, text: "", parentId: null };
    setNodes((s) => [...s, node]);
    log(OPPORTUNITY_TREE_ACTIONS.NODE_ADDED, { nodeId: node.id, kind: node.kind });
  };
  const addChild = (parent: TreeNode) => {
    const nextKind = CHILD_KIND[parent.kind];
    if (!nextKind) return;
    const node = { id: nanoid(6), kind: nextKind, text: "", parentId: parent.id };
    setNodes((s) => [...s, node]);
    log(OPPORTUNITY_TREE_ACTIONS.NODE_ADDED, {
      nodeId: node.id,
      kind: node.kind,
      parentId: parent.id,
    });
  };
  const update = (id: string, patch: Partial<TreeNode>) =>
    setNodes((s) => s.map((n) => (n.id === id ? { ...n, ...patch } : n)));
  const remove = (id: string) => {
    const node = nodes.find((n) => n.id === id);
    log(OPPORTUNITY_TREE_ACTIONS.NODE_REMOVED, { nodeId: id, kind: node?.kind });
    // Compute the descendant set INSIDE the functional updater so we read the
    // freshest state (avoids losing a child added between this render and the
    // setNodes call). Use a visited set to terminate even on corrupted
    // imports where parentId forms a cycle.
    setNodes((s) => {
      const toDelete = new Set<string>([id]);
      let grew = true;
      while (grew) {
        grew = false;
        for (const n of s) {
          if (n.parentId && toDelete.has(n.parentId) && !toDelete.has(n.id)) {
            toDelete.add(n.id);
            grew = true;
          }
        }
      }
      return s.filter((n) => !toDelete.has(n.id));
    });
  };

  // Index children by parent once per render — the previous filter was O(n)
  // per call and was invoked twice per node (once to test length, once to
  // iterate), pushing the recursive renderNode into O(n²) territory.
  const childrenIndex = useMemo(() => {
    const map = new Map<string | null, TreeNode[]>();
    for (const n of nodes) {
      const list = map.get(n.parentId) ?? [];
      list.push(n);
      map.set(n.parentId, list);
    }
    return map;
  }, [nodes]);
  const childrenOf = (pid: string | null) => childrenIndex.get(pid) ?? [];

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
      prompts: generateOpportunityTreePrompts({ nodes }, workspace),
    }),
    [nodes, workspace]
  );

  const renderNode = (node: TreeNode, depth: number): React.ReactNode => {
    // Cap recursion at 30 plies. The UI only creates 4 levels via
    // `CHILD_KIND`, but a corrupted persisted state (or a future schema)
    // could land with a pathological chain — without a cap we'd blow the
    // stack instead of just truncating the render. The AI prompt
    // (renderTree in lib/ai-prompts/opportunity-tree.ts) applies the same
    // cap; keep these aligned.
    if (depth > 30) return null;
    // Defensive lookup — corrupted state could land an unknown kind here.
    // Default to outcome's cyan rather than rendering broken inline CSS.
    const kindColor = KIND_COLORS[node.kind] ?? KIND_COLORS.outcome;
    return (
      <div key={node.id} className="space-y-2">
        <div
          className="rounded-lg border bg-bg p-3"
          style={{ borderColor: `${kindColor}66`, borderLeftWidth: 3, borderLeftColor: kindColor }}
        >
          <div className="flex items-start gap-2">
            <span
              className="text-[10px] uppercase tracking-wider px-1.5 py-0.5 rounded font-data flex-shrink-0"
              style={{ background: `${kindColor}22`, color: kindColor }}
            >
              {node.kind}
            </span>
            <div className="flex-1 min-w-0 space-y-2">
              <BlurTextarea
                rows={2}
                value={node.text}
                onCommit={(v) => update(node.id, { text: v })}
                placeholder={`${node.kind}...`}
                className="bg-surface border-border text-sm"
              />
              {/* Description input applies to any node kind — distinct from
                evidence (opportunity/experiment only). The visible input
                doubles as the display, mirroring how the main `text` field
                works above. */}
              <BlurInput
                value={node.description ?? ""}
                onCommit={(v) => update(node.id, { description: v })}
                placeholder="Description (optional)..."
                className="bg-surface border-border text-xs"
              />
              {(node.kind === "opportunity" || node.kind === "experiment") && (
                <BlurInput
                  value={node.evidence ?? ""}
                  onCommit={(v) => update(node.id, { evidence: v })}
                  placeholder="Evidence / data..."
                  className="bg-surface border-border text-xs"
                />
              )}
            </div>
            <div className="flex flex-col gap-1 flex-shrink-0">
              {CHILD_KIND[node.kind] && (
                <Button
                  variant="ghost"
                  size="sm"
                  onClick={() => addChild(node)}
                  className="min-touch md:min-h-0 md:h-7 text-sub hover:text-accent gap-1"
                  aria-label={`Add ${CHILD_KIND[node.kind]}`}
                >
                  <Plus className="w-4 h-4 md:w-3.5 md:h-3.5" />
                  <span className="text-xs hidden xs:inline">{CHILD_KIND[node.kind]}</span>
                </Button>
              )}
              <Button
                variant="ghost"
                size="icon"
                onClick={() => remove(node.id)}
                className="md:min-h-0 md:min-w-0 md:h-7 md:w-7 text-sub hover:text-danger"
                aria-label={`Remove ${node.kind}`}
              >
                <Trash2 className="w-4 h-4 md:w-3.5 md:h-3.5" />
              </Button>
            </div>
          </div>
        </div>
        {childrenOf(node.id).length > 0 && (
          <div className="pl-3 md:pl-6 space-y-2 border-l border-border ml-1 md:ml-2">
            {childrenOf(node.id).map((child) => renderNode(child, depth + 1))}
          </div>
        )}
      </div>
    );
  };

  const rootNodes = childrenOf(null);

  return (
    <ToolPageWrapper
      toolId="opportunity-tree"
      title="Opportunity Solution Tree"
      description="Map outcomes to opportunities, solutions, and experiments (Teresa Torres framework)."
      category="Product Discovery"
    >
      <ActionRow>
        <AiPromptGenerator config={promptConfig} />
        <ExportButton
          filename="opportunity-tree"
          csvData={{
            headers: ["Kind", "Text", "Description", "Parent", "Evidence"],
            // Resolve parentId to the parent node's `text` for the CSV export.
            // Raw nanoids are useless to a human reading the spreadsheet, and
            // they tie the export to internal IDs that change on import.
            rows: nodes.map((n) => {
              const parentText = n.parentId
                ? (nodes.find((p) => p.id === n.parentId)?.text ?? "")
                : "";
              return [n.kind, n.text, n.description ?? "", parentText, n.evidence ?? ""];
            }),
          }}
          jsonData={nodes}
        />
        <Button onClick={addRoot} className="gap-2 bg-accent text-bg hover:bg-accent/90">
          <Plus className="w-4 h-4" />
          Add Outcome
        </Button>
      </ActionRow>

      {rootNodes.length === 0 ? (
        <EmptyState icon={Workflow}>
          No outcomes yet. Start by defining a clear outcome you want to drive.
        </EmptyState>
      ) : (
        <div className="space-y-4">{rootNodes.map((n) => renderNode(n, 0))}</div>
      )}
    </ToolPageWrapper>
  );
}
