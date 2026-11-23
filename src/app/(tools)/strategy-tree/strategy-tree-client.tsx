"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import Link from "next/link";
import { nanoid } from "nanoid";
import { Check, FlaskConical, Map as MapIcon, Plus, Trash2, TreeDeciduous } from "lucide-react";
import { useShallow } from "zustand/react/shallow";
import { useAnnounce } from "@/components/a11y/live-announcer";
import { AiButton, AiSuggestions } from "@/components/ai";
import { ToolPageWrapper } from "@/components/layout/tool-page-wrapper";
import { ActionRow } from "@/components/shared/action-row";
import { AiPromptGenerator } from "@/components/shared/ai-prompt-generator";
import { EmptyState } from "@/components/shared/empty-state";
import { ExportButton } from "@/components/shared/export-button";
import { OnSearchParams, dropSearchParam } from "@/components/shared/on-search-params";
import { WorkspaceLoading } from "@/components/shared/workspace-loading";
import { ChecksList } from "@/components/strategy-map/checks-list";
import { DeleteNodeDialog } from "@/components/strategy-map/delete-dialog";
import { LevelTree } from "@/components/strategy-map/level-tree";
import { NodeCard } from "@/components/strategy-map/node-card";
import {
  ExampleNotice,
  LoadExampleButton,
  hasExampleItems,
  isExampleId,
} from "@/components/tool-frame/example-data";
import { focusAfterClearingExample } from "@/components/tool-frame/after-clear-example";
import { Button } from "@/components/ui/button";
import { IconButton } from "@/components/ui/icon-button";
import { Textarea } from "@/components/ui/textarea";
import { generateStrategyTreePrompts } from "@/lib/ai-prompts/strategy-tree";
import {
  TREE_DRAFT_CONTEXT_MAX,
  TREE_DRAFT_EXISTING_MAX,
  TREE_DRAFT_TEXT_MAX,
  strategyTreeDraftTask,
  type DraftedBranch,
} from "@/lib/ai/tasks/strategy-tree.lite";
import type { AiSource } from "@/lib/ai/task-types";
import { cheer } from "@/lib/celebrate/cheer";
import { getHandoffRoute, liveLink } from "@/lib/handoffs/registry";
import { sendHandoff } from "@/lib/handoffs/send";
import type { HandoffLink } from "@/lib/handoffs/types";
import { STRATEGY_TREE_ACTIONS } from "@/lib/history/event-actions";
import { useHistoryLogger } from "@/lib/history/use-history-logger";
import { HYPOTHESIS_TRACKER_ID, linkedTest, type LinkedTest } from "@/lib/hypotheses/model";
import { useWorkspaceStore } from "@/lib/stores/workspace-store";
import type {
  Hypothesis,
  HypothesisTracker,
  StrategyMap,
  StrategyMapNode,
  StrategyNodeStatus,
  Workspace,
} from "@/lib/stores/workspace-types";
import { mapChecks } from "@/lib/strategy-map/checks";
import { fitDraftNodes, partDraftNodes } from "@/lib/strategy-map/drafts";
import {
  STATUS_LABEL,
  STRATEGY_FORMATS,
  isTreeFormat,
  levelOf,
  levelSends,
} from "@/lib/strategy-map/formats";
import {
  STRATEGY_NODES_MAX,
  TOO_BIG,
  applyNodeValues,
  becameAgreed,
  branchOf,
  canAddUnder,
  childrenOf,
  cleanText,
  fitsRow,
  holdsLink,
  levelCounts,
  newStrategyMap,
  newestFirst,
  nodeTitle,
  readStrategyMap,
  readStrategyMaps,
  rootOf,
  validateNode,
  withNode,
  withNodePatch,
  withNodes,
  withStatus,
  type NodeValues,
} from "@/lib/strategy-map/model";
import { strategySource } from "@/lib/strategy-map/send";
import { useWorkspaceHydrated } from "@/lib/team/use-team-roster";
import { cn } from "@/lib/utils";
import { EXPORT_SKIP } from "@/lib/utils/export-skip";
import { jsonBytes } from "@/lib/utils/json-bytes";
import { removeWithUndo, undoable } from "@/lib/utils/undoable";
import { todayLocalISO } from "@/lib/utils/formatters";
import { buildExamples } from "./example";
import type { NewTreeValues } from "./form";
import { strategyTreeMarkdown } from "./markdown";
import { NewTreeForm } from "./new-tree-form";

// Stable empty lists: zustand re-renders forever on a selector that returns a fresh array.
const NO_ROWS: StrategyMap[] = [];
const NO_TRACKERS: HypothesisTracker[] = [];
const NO_HYPOTHESES: Hypothesis[] = [];

const isTree = (m: StrategyMap) => isTreeFormat(m.format);

function testLabel(t: LinkedTest): string {
  if (t.state === "none") return "";
  if (t.state === "testing")
    return t.status === "running" ? "Testing: running" : "Testing: drafted";
  return `Tested: ${t.result}`;
}

interface Suggested {
  branches: DraftedBranch[];
  source: AiSource;
}

/**
 * Strategy Tree: strategy as a tree you can test, in one of three shapes
 * (DIBB, Lean Value Tree, Hoshin Kanri), each level with its own fields.
 * Every part is proposed, agreed, has questions or dropped (Hoshin's
 * catchball); a bet goes to the Hypothesis Tracker and an initiative or a
 * priority to the roadmap, each with Undo. The rules, levels, checks and
 * sources are lib/strategy-map's, which tool.strategy_tree shares.
 */
export function StrategyTreeClient() {
  const hydrated = useWorkspaceHydrated();
  const rows = useWorkspaceStore((s) => s.strategyMaps) ?? NO_ROWS;
  const trackers = useWorkspaceStore((s) => s.hypothesisTrackers) ?? NO_TRACKERS;
  // Read so "Sent · Open" follows an epic deleted elsewhere.
  useWorkspaceStore((s) => s.epicRoadmaps);
  const hypotheses =
    trackers.find((d) => d.id === HYPOTHESIS_TRACKER_ID)?.hypotheses ?? NO_HYPOTHESES;
  const { log } = useHistoryLogger("strategy-tree");
  const announce = useAnnounce();

  const trees = useMemo(() => newestFirst(readStrategyMaps(rows).filter(isTree)), [rows]);
  const [openId, setOpenId] = useState<string | null>(null);
  const [wanted, setWanted] = useState<string | null>(null);
  const [creating, setCreating] = useState(false);
  const [pendingDelete, setPendingDelete] = useState<StrategyMapNode | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [suggested, setSuggested] = useState<Suggested | null>(null);
  const [context, setContext] = useState("");
  const newTreeRef = useRef<HTMLButtonElement>(null);
  const askRef = useRef<HTMLDivElement>(null);
  const exportRef = useRef<HTMLElement>(null);

  const open = trees.find((t) => t.id === openId) ?? trees[0];
  const today = todayLocalISO();

  // A ?tree= link opens that tree once it has loaded, then leaves the address.
  useEffect(() => {
    if (!wanted || !hydrated) return;
    if (trees.some((t) => t.id === wanted)) setOpenId(wanted);
    setWanted(null);
    dropSearchParam("tree");
  }, [wanted, hydrated, trees]);

  /* ── Writes ── */

  const ws = () => useWorkspaceStore.getState();
  const freshTree = (id: string) =>
    readStrategyMap((ws().strategyMaps ?? []).find((m) => m.id === id)) ?? undefined;
  const write = (id: string, fn: (m: StrategyMap) => StrategyMap): StrategyMap | null => {
    const current = freshTree(id);
    if (!current) return null;
    const next = { ...fn(current), updatedAt: new Date().toISOString() };
    if (!fitsRow(next) && jsonBytes(next) > jsonBytes(current)) {
      setNotice(TOO_BIG);
      return null;
    }
    setNotice(null);
    ws().upsertStrategyMap(next);
    return next;
  };
  // Example trees aren't the team's history.
  const record = (treeId: string, action: string, payload: Record<string, unknown>) => {
    if (!isExampleId(treeId)) log(action, payload);
  };
  /** Log a change's status moves, and the moment the whole tree is agreed (once). */
  const statusMoments = (before: StrategyMap, after: StrategyMap, nodeId: string) => {
    const was = before.nodes.find((n) => n.id === nodeId)?.status ?? "proposed";
    const now = after.nodes.find((n) => n.id === nodeId)?.status ?? "proposed";
    if (was !== now) {
      record(after.id, STRATEGY_TREE_ACTIONS.STATUS_CHANGED, {
        treeId: after.id,
        nodeId,
        status: now,
      });
    }
    if (becameAgreed(before, after) && !isExampleId(after.id)) {
      log(STRATEGY_TREE_ACTIONS.TREE_AGREED, { treeId: after.id, nodes: after.nodes.length });
      cheer("strategy-tree", "agreed");
      announce("Every part of the tree is agreed.");
    }
  };

  function createTree(v: NewTreeValues) {
    const tree = newStrategyMap({
      id: `strategyMap_${nanoid(8)}`,
      rootId: nanoid(8),
      format: v.format,
      root: v.root,
      now: new Date().toISOString(),
    });
    ws().upsertStrategyMap(tree);
    setOpenId(tree.id);
    setCreating(false);
    setSuggested(null);
    record(tree.id, STRATEGY_TREE_ACTIONS.TREE_CREATED, { treeId: tree.id, format: tree.format });
    announce(`Started the ${STRATEGY_FORMATS[tree.format].label} “${tree.title}”`);
  }

  function removeTree(tree: StrategyMap) {
    const snapshot = freshTree(tree.id) ?? tree;
    undoable({
      label: `Deleted the tree “${snapshot.title}”`,
      apply: () => ws().removeStrategyMap(tree.id),
      revert: () => ws().upsertStrategyMap(snapshot),
    });
    if (openId === tree.id) setOpenId(null);
    setSuggested(null);
    record(tree.id, STRATEGY_TREE_ACTIONS.TREE_REMOVED, { treeId: tree.id, format: tree.format });
    announce(`Deleted the tree “${snapshot.title}”`);
    requestAnimationFrame(() => newTreeRef.current?.focus());
  }

  function addNode(tree: StrategyMap, parent: StrategyMapNode, values: NodeValues) {
    if (!canAddUnder(tree, parent)) return;
    const node = applyNodeValues(
      {
        id: nanoid(8),
        parentId: parent.id,
        level: (parent.level + 1) as 1 | 2 | 3,
        text: "",
        status: "proposed",
      },
      values,
      tree.format
    );
    if (!write(tree.id, (m) => withNode(m, node))) return;
    record(tree.id, STRATEGY_TREE_ACTIONS.NODE_ADDED, {
      treeId: tree.id,
      nodeId: node.id,
      level: node.level,
    });
    announce(`Added “${nodeTitle(node, tree.format)}” under “${nodeTitle(parent, tree.format)}”`);
  }

  function saveNode(tree: StrategyMap, node: StrategyMapNode, values: NodeValues) {
    const next = applyNodeValues(node, values, tree.format);
    if (JSON.stringify(next) === JSON.stringify(node)) return;
    const before = freshTree(tree.id) ?? tree;
    const retitle = node.parentId === null && tree.title.trim() === node.text.trim();
    const after = write(tree.id, (m) => ({
      ...m,
      ...(retitle ? { title: next.text } : {}),
      nodes: m.nodes.map((n) => (n.id === node.id ? applyNodeValues(n, values, tree.format) : n)),
    }));
    if (!after) return;
    const textChanged = ["text", "detail", "measure", "owner", "note"].some(
      (k) => next[k as keyof StrategyMapNode] !== node[k as keyof StrategyMapNode]
    );
    if (textChanged) {
      record(tree.id, STRATEGY_TREE_ACTIONS.NODE_UPDATED, { treeId: tree.id, nodeId: node.id });
    }
    statusMoments(before, after, node.id);
    announce(`Saved “${nodeTitle(next, tree.format)}”`);
  }

  function setStatus(tree: StrategyMap, node: StrategyMapNode, status: StrategyNodeStatus) {
    if ((node.status ?? "proposed") === status) return;
    const before = freshTree(tree.id) ?? tree;
    const after = write(tree.id, (m) => withStatus(m, node.id, status));
    if (!after) return;
    statusMoments(before, after, node.id);
    announce(`“${nodeTitle(node, tree.format)}” is ${STATUS_LABEL[status].toLowerCase()}`);
  }

  function askDelete(tree: StrategyMap, node: StrategyMapNode) {
    if (node.parentId === null) {
      if (tree.nodes.length > 1) setPendingDelete(node);
      else removeTree(tree);
      return;
    }
    if (branchOf(tree, node.id).length > 1) setPendingDelete(node);
    else removeNode(tree, node);
  }

  function removeNode(tree: StrategyMap, node: StrategyMapNode) {
    if (node.parentId === null) return removeTree(tree);
    const current = freshTree(tree.id) ?? tree;
    const ids = new Set(branchOf(current, node.id).map((n) => n.id));
    const label =
      ids.size > 1
        ? `Deleted “${nodeTitle(node, tree.format)}” and ${ids.size - 1} below it`
        : `Deleted “${nodeTitle(node, tree.format)}”`;
    removeWithUndo<StrategyMapNode>({
      label,
      update: (fn) => write(tree.id, (m) => ({ ...m, nodes: fn(m.nodes) })),
      match: (n) => ids.has(n.id),
    });
    record(tree.id, STRATEGY_TREE_ACTIONS.NODE_REMOVED, {
      treeId: tree.id,
      nodeId: node.id,
      removed: ids.size,
    });
    announce(label);
    requestAnimationFrame(() => {
      const el = Array.from(document.querySelectorAll<HTMLElement>("[data-node-edit]")).find(
        (b) => b.getAttribute("data-node-edit") === node.parentId
      );
      el?.focus();
    });
  }

  function send(tree: StrategyMap, node: StrategyMapNode, route: "hypothesis" | "epic") {
    const current = freshTree(tree.id) ?? tree;
    const fresh = current.nodes.find((n) => n.id === node.id) ?? node;
    const src = strategySource(current, fresh, route);
    if (!src) return;
    // Checked before the hypothesis or the epic is made: the row must hold its link.
    if (!holdsLink(current)) {
      setNotice(TOO_BIG);
      return;
    }
    // The target's own check (a full Hypothesis Tracker), said rather than a click that does nothing.
    const problem = getHandoffRoute(route).problem?.(src);
    if (problem) {
      setNotice(problem);
      announce(problem);
      return;
    }
    const links = {
      getLinks: () => freshTree(tree.id)?.nodes.find((n) => n.id === node.id)?.sentTo,
      setLinks: (update: (links: readonly HandoffLink[] | undefined) => HandoffLink[]) => {
        const prev = freshTree(tree.id)?.nodes.find((n) => n.id === node.id)?.sentTo;
        const next = update(prev);
        write(tree.id, (m) =>
          withNodePatch(m, node.id, { sentTo: next.length > 0 ? next : undefined })
        );
      },
    };
    const link =
      route === "hypothesis"
        ? sendHandoff("hypothesis", src, links)
        : sendHandoff("epic", src, links);
    if (!link) return;
    record(tree.id, STRATEGY_TREE_ACTIONS.BET_SENT, { treeId: tree.id, nodeId: node.id, route });
    announce(
      route === "hypothesis"
        ? `“${nodeTitle(node, tree.format)}” is now a hypothesis to test`
        : `“${nodeTitle(node, tree.format)}” is on the roadmap`
    );
  }

  function acceptDrafts(tree: StrategyMap, branches: readonly DraftedBranch[]) {
    const current = freshTree(tree.id) ?? tree;
    const root = rootOf(current);
    if (!root) return;
    const all = branches.flatMap((b) =>
      partDraftNodes(b, root.id, current.format, () => nanoid(8))
    );
    const fit = fitDraftNodes(current, all);
    if (fit.nodes.length === 0) {
      setNotice(`A tree holds at most ${STRATEGY_NODES_MAX} parts. Remove some to add more.`);
      return;
    }
    // Sized before anything is said: a refused write must not read as "Added", nor be logged.
    if (!fitsRow({ ...withNodes(current, fit.nodes), updatedAt: new Date().toISOString() })) {
      setNotice(TOO_BIG);
      return;
    }
    const ids = new Set(fit.nodes.map((n) => n.id));
    const tops = fit.nodes.filter((n) => n.level === 1).length;
    undoable({
      label: `Added ${tops === 1 ? `“${nodeTitle(fit.nodes[0], current.format)}”` : `${tops} branches`} to the tree`,
      kind: "success",
      apply: () => write(tree.id, (m) => withNodes(m, fit.nodes)),
      revert: () => write(tree.id, (m) => ({ ...m, nodes: m.nodes.filter((n) => !ids.has(n.id)) })),
    });
    record(tree.id, STRATEGY_TREE_ACTIONS.DRAFT_ACCEPTED, {
      treeId: tree.id,
      nodes: fit.nodes.length,
    });
    const left =
      fit.left > 0
        ? `${fit.left} ${fit.left === 1 ? "part was" : "parts were"} left out: a tree holds at most ${STRATEGY_NODES_MAX}.`
        : null;
    setNotice(left);
    announce(`Added ${fit.nodes.length} parts.${left ? ` ${left}` : ""}`);
  }

  const loadExample = () => {
    const examples = buildExamples();
    for (const t of examples) ws().upsertStrategyMap(t);
    setOpenId(examples[0].id);
  };
  const clearExample = () => {
    let removed: StrategyMap[] = [];
    undoable({
      label: "Cleared the example",
      apply: () => {
        removed = (ws().strategyMaps ?? []).filter((m) => isExampleId(m.id) && isTree(m));
        for (const m of removed) ws().removeStrategyMap(m.id);
      },
      revert: () => {
        const kept = ws().strategyMaps ?? [];
        for (const m of removed) if (!kept.some((x) => x.id === m.id)) ws().upsertStrategyMap(m);
      },
    });
    setOpenId(null);
    setSuggested(null);
    focusAfterClearingExample();
  };

  /* ── Exports and prompts ── */

  const markdown = open ? strategyTreeMarkdown(open, { hypotheses, today }) : "";
  const csvData = {
    headers: ["Level", "Part", "Under", "Measure", "Owner", "Status", "Note"],
    rows: open
      ? open.nodes.map((n) => [
          levelOf(open.format, n.level).label,
          n.text,
          n.parentId ? (open.nodes.find((p) => p.id === n.parentId)?.text ?? "") : "",
          n.measure ?? "",
          n.owner ?? "",
          STATUS_LABEL[n.status ?? "proposed"],
          n.note ?? "",
        ])
      : [],
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
      toolName: "Strategy Tree",
      prompts: generateStrategyTreePrompts({ tree: open, hypotheses }, workspace),
    }),
    [open, hypotheses, workspace]
  );

  /* ── Drawing one tree ── */

  const renderNode = (tree: StrategyMap, node: StrategyMapNode) => {
    const example = isExampleId(tree.id);
    const status = node.status ?? "proposed";
    const test = linkedTest(node.sentTo, hypotheses);
    const epic = liveLink(node.sentTo, "epic");
    const testable = levelSends(tree.format, node.level, "hypothesis") && status !== "dropped";
    const roadmap = levelSends(tree.format, node.level, "epic") && status !== "dropped";
    const title = nodeTitle(node, tree.format);
    return (
      <NodeCard
        format={tree.format}
        node={node}
        canAdd={canAddUnder(tree, node)}
        example={example}
        validate={(d, level) => validateNode(d, { format: tree.format, level })}
        onSave={(n, v) => saveNode(tree, n, v)}
        onAdd={(p, v) => addNode(tree, p, v)}
        onDelete={(n) => askDelete(tree, n)}
        footer={
          <>
            {test.state !== "none" && (
              <Link
                href={getHandoffRoute("hypothesis").targetHref(test.hypothesisId)}
                className={cn(
                  "min-touch-coarse mt-1 inline-flex items-center gap-1 text-xs underline-offset-2 hover:underline",
                  test.state === "tested" ? "text-success" : "text-accent"
                )}
              >
                <FlaskConical className="h-3.5 w-3.5" aria-hidden="true" />
                {testLabel(test)} · Open
              </Link>
            )}
            {epic && (
              <Link
                href={getHandoffRoute("epic").targetHref(epic.targetId)}
                className="min-touch-coarse ml-2 mt-1 inline-flex items-center gap-1 text-xs text-accent underline-offset-2 hover:underline"
              >
                <MapIcon className="h-3.5 w-3.5" aria-hidden="true" />
                On the roadmap · Open
              </Link>
            )}
          </>
        }
        actions={
          <>
            {status !== "agreed" && status !== "dropped" && (
              <Button
                type="button"
                size="sm"
                variant="ghost"
                className="min-touch-coarse gap-1 text-xs text-sub hover:bg-success/10 hover:text-success"
                aria-label={`Agree: ${title}`}
                onClick={() => setStatus(tree, node, "agreed")}
              >
                <Check className="h-4 w-4" aria-hidden="true" />
                Agree
              </Button>
            )}
            {testable && test.state === "none" && (
              <Button
                type="button"
                size="sm"
                variant="outline"
                className="gap-1 text-xs"
                disabled={example}
                aria-label={`Test as a hypothesis: ${title}`}
                onClick={() => send(tree, node, "hypothesis")}
              >
                <FlaskConical className="h-4 w-4" aria-hidden="true" />
                Test as a hypothesis
              </Button>
            )}
            {roadmap && !epic && (
              <Button
                type="button"
                size="sm"
                variant="outline"
                className="gap-1 text-xs"
                disabled={example}
                aria-label={`Put on the roadmap: ${title}`}
                onClick={() => send(tree, node, "epic")}
              >
                <MapIcon className="h-4 w-4" aria-hidden="true" />
                Put on the roadmap
              </Button>
            )}
          </>
        }
      />
    );
  };

  const checks = open ? mapChecks(open, hypotheses) : [];
  const counts = open ? levelCounts(open) : [0, 0, 0, 0];

  return (
    <ToolPageWrapper
      toolId="strategy-tree"
      title="Strategy Tree"
      description="DIBB, a Lean Value Tree or Hoshin Kanri, from the vision to bets and owners."
    >
      <OnSearchParams
        onChange={(search) => {
          const id = search.get("tree");
          if (id) setWanted(id);
        }}
      />
      <div className="space-y-4">
        {hasExampleItems(trees) && <ExampleNotice onClear={clearExample} />}
        <ActionRow>
          {open && (
            <>
              <AiPromptGenerator config={promptConfig} />
              <ExportButton
                filename="strategy-tree"
                csvData={csvData}
                jsonData={open}
                markdown={markdown}
                targetRef={exportRef}
              />
            </>
          )}
          {hydrated && !creating && (
            <Button
              ref={newTreeRef}
              variant="toolkit"
              className="gap-2"
              onClick={() => setCreating(true)}
            >
              <Plus className="h-4 w-4" aria-hidden="true" />
              New tree
            </Button>
          )}
        </ActionRow>

        {creating && (
          <NewTreeForm
            onCreate={createTree}
            onCancel={() => {
              setCreating(false);
              requestAnimationFrame(() => newTreeRef.current?.focus());
            }}
          />
        )}

        {notice && (
          <p
            role="status"
            className="rounded-md border border-warning/40 bg-warning/10 px-3 py-2 text-sm text-text"
          >
            {notice}
          </p>
        )}

        {!hydrated ? (
          <WorkspaceLoading>Loading the trees…</WorkspaceLoading>
        ) : trees.length === 0 ? (
          !creating && (
            <EmptyState icon={TreeDeciduous} action={<LoadExampleButton onLoad={loadExample} />}>
              No strategy trees yet. Pick a shape, DIBB, a Lean Value Tree or Hoshin Kanri, write
              its root, then add each level under the one above. Or load an example of each.
            </EmptyState>
          )
        ) : (
          open && (
            <>
              <nav aria-label="Your strategy trees">
                <ul className="flex flex-wrap gap-2">
                  {trees.map((t) => (
                    <li key={t.id}>
                      <Button
                        type="button"
                        size="sm"
                        variant={t.id === open.id ? "toolkit" : "outline"}
                        aria-current={t.id === open.id ? "true" : undefined}
                        className="max-w-[16rem] gap-1.5 truncate text-xs"
                        onClick={() => {
                          setOpenId(t.id);
                          setSuggested(null);
                        }}
                      >
                        <span className="rounded bg-accent/10 px-1 font-data text-xs uppercase text-accent">
                          {STRATEGY_FORMATS[t.format].label}
                        </span>
                        <span className="truncate">{t.title}</span>
                      </Button>
                    </li>
                  ))}
                </ul>
              </nav>

              {/* The PNG is the tree: its title and parts. Its controls are marked
                  EXPORT_SKIP, and so are the parts' own (NodeCard). */}
              <section ref={exportRef} aria-labelledby="tree-heading" className="space-y-3">
                <div className="flex flex-wrap items-start justify-between gap-2">
                  <div className="min-w-0">
                    <h2 id="tree-heading" className="break-words text-lg font-semibold text-text">
                      {open.title}
                    </h2>
                    <p className="text-xs text-sub">
                      {STRATEGY_FORMATS[open.format].label} ·{" "}
                      {[1, 2, 3]
                        .map((l) => {
                          const n = counts[l];
                          const lvl = levelOf(open.format, l);
                          return `${n} ${n === 1 ? lvl.label.toLowerCase() : lvl.plural}`;
                        })
                        .join(", ")}
                    </p>
                  </div>
                  <IconButton
                    {...EXPORT_SKIP}
                    label={`Delete the tree ${open.title}`}
                    icon={<Trash2 className="h-4 w-4" />}
                    className="text-sub hover:text-danger"
                    onClick={() => {
                      // A tree with no parts (an agent can make one) has no root to ask about.
                      const root = rootOf(open);
                      if (root) askDelete(open, root);
                      else removeTree(open);
                    }}
                  />
                </div>

                <div
                  {...EXPORT_SKIP}
                  className="space-y-2 rounded-lg border border-border bg-card p-3"
                >
                  <h3 className="text-sm font-semibold text-text">Draft with Amr</h3>
                  <label className="block space-y-1.5 text-sm text-text">
                    <span>Anything Amr should know</span>
                    <Textarea
                      rows={2}
                      maxLength={TREE_DRAFT_CONTEXT_MAX}
                      value={context}
                      onChange={(e) => setContext(e.target.value)}
                      aria-describedby="tree-context-hint"
                    />
                  </label>
                  <p id="tree-context-hint" className="text-xs text-sub">
                    Optional, and not saved. Amr drafts branches under the root for you to accept
                    one by one, with no owners; without AI you get templates to rewrite.
                  </p>
                  <div ref={askRef}>
                    <AiButton
                      task={strategyTreeDraftTask}
                      label="Ask Amr to draft branches"
                      fallbackLabel="Start from a template"
                      disabledReason={rootOf(open) ? null : "The tree needs its root first."}
                      input={() => {
                        const root = rootOf(open);
                        return {
                          format: isTreeFormat(open.format) ? open.format : "dibb",
                          root: cleanText(root?.text, TREE_DRAFT_TEXT_MAX),
                          ...(root?.measure
                            ? { measure: cleanText(root.measure, TREE_DRAFT_TEXT_MAX) }
                            : {}),
                          context: context.trim().slice(0, TREE_DRAFT_CONTEXT_MAX),
                          existing: childrenOf(open, root?.id ?? "")
                            .map((n) => cleanText(n.text, TREE_DRAFT_TEXT_MAX))
                            .filter(Boolean)
                            .slice(0, TREE_DRAFT_EXISTING_MAX),
                        };
                      }}
                      onResult={(data, meta) => {
                        setSuggested({ branches: data.branches, source: meta.source });
                        announce(
                          `${data.branches.length} suggested ${data.branches.length === 1 ? "branch" : "branches"} below.`
                        );
                      }}
                    />
                  </div>
                  {suggested && (
                    <AiSuggestions
                      items={suggested.branches}
                      source={suggested.source}
                      title="Suggested branches"
                      render={(b) => ({
                        title: b.text,
                        detail: b.children
                          .map((c) =>
                            c.children.length > 0
                              ? `${c.text}: ${c.children.map((g) => g.text).join(", ")}`
                              : c.text
                          )
                          .join(" · "),
                      })}
                      onAccept={(b) => acceptDrafts(open, [b])}
                      onAcceptAll={(list) => acceptDrafts(open, list)}
                      onDismiss={() => setSuggested(null)}
                      returnFocus={() => askRef.current?.querySelector<HTMLElement>("button")}
                    />
                  )}
                </div>

                <div {...EXPORT_SKIP}>
                  <ChecksList checks={checks} />
                </div>

                <LevelTree
                  map={open}
                  label="Strategy tree"
                  renderNode={(n) => renderNode(open, n)}
                />
              </section>
            </>
          )
        )}
      </div>

      <DeleteNodeDialog
        map={open}
        node={pendingDelete}
        onClose={() => setPendingDelete(null)}
        onConfirm={(n) => {
          if (open) removeNode(open, n);
        }}
      />
    </ToolPageWrapper>
  );
}
