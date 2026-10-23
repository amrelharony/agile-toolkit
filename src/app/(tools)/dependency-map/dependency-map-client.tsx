"use client";

import { useMemo, useRef, useState } from "react";
import { nanoid } from "nanoid";
import {
  AlertTriangle,
  CheckCircle2,
  GitBranch,
  Network,
  Pencil,
  RotateCcw,
  Route,
  Trash2,
} from "lucide-react";
import { ToolPageWrapper } from "@/components/layout/tool-page-wrapper";
import { ExportButton } from "@/components/shared/export-button";
import { AiPromptGenerator } from "@/components/shared/ai-prompt-generator";
import { ActionRow } from "@/components/shared/action-row";
import { CalloutAlert } from "@/components/shared/callout-alert";
import { ConfirmDialog } from "@/components/shared/confirm-dialog";
import { EmptyState } from "@/components/shared/empty-state";
import { KpiGrid } from "@/components/shared/kpi-grid";
import { SectionCard } from "@/components/shared/section-card";
import { StatCard } from "@/components/shared/stat-card";
import { SourceLink } from "@/components/handoff/source-link";
import { Button } from "@/components/ui/button";
import { IconButton } from "@/components/ui/icon-button";
import { ToggleGroup } from "@/components/ui/toggle-group";
import {
  ExampleNotice,
  LoadExampleButton,
  hasExampleItems,
} from "@/components/tool-frame/example-data";
import { generateDependencyMapPrompts } from "@/lib/ai-prompts/dependency-map";
import { useHistoryLogger } from "@/lib/history/use-history-logger";
import { DEPENDENCY_MAP_ACTIONS } from "@/lib/history/event-actions";
import { useHistoryStore } from "@/lib/history/history-store";
import type {
  DependencyEdge,
  DependencyNode,
  DependencyStatus,
} from "@/lib/stores/workspace-types";
import {
  DEPENDENCY_STATUS_LABEL,
  edgeStatus,
  isOverdue,
  withEdgeStatus,
} from "@/lib/dependencies/edges";
import { todayLocalISO } from "@/lib/utils/formatters";
import { undoable } from "@/lib/utils/undoable";
import { cn } from "@/lib/utils";
import { withExample, withoutExample } from "./example";
import { dayLabel } from "./format";
import {
  EdgeAddForm,
  EdgeEditor,
  NodeAddForm,
  NodeEditor,
  type EdgeValues,
  type NodeValues,
} from "./forms";
import { cleanEdges, criticalPath, detectCycles, type CriticalPath } from "./graph";
import { DependencyGraph } from "./graph-view";
import {
  currentDependencyMap,
  edgeSides,
  saveDependencyMap,
  setEdgeStatus,
  updateDependencyMap,
  useDependencyMap,
  type MapGraph,
} from "./link";
import { toMarkdown } from "./markdown";
import { DependencyStatusChip } from "./status-chip";
import { dependencyVerdict } from "./verdict";

type StatusFilter = "all" | DependencyStatus;

const FILTER_OPTIONS: { value: StatusFilter; label: string }[] = [
  { value: "all", label: "All" },
  { value: "open", label: "Open" },
  { value: "at-risk", label: "At risk" },
  { value: "resolved", label: "Resolved" },
];

const touches = (e: DependencyEdge, id: string) => e.from === id || e.to === id;

/** The list with `items` put back at their old positions (clamped to the list as it is now). */
function insertAt<T>(list: readonly T[], items: readonly { item: T; index: number }[]): T[] {
  const next = [...list];
  for (const { item, index } of items) next.splice(Math.min(index, next.length), 0, item);
  return next;
}

/** `{...obj, key: value}`, or `obj` without `key` when the value is empty. */
function setOptional<T extends object, K extends keyof T>(obj: T, key: K, value: T[K] | undefined) {
  const next = { ...obj };
  if (value === undefined || value === "") delete next[key];
  else next[key] = value;
  return next;
}

export function DependencyMapClient() {
  // Synced workspace singleton (dependency-map:current), shared with PI
  // Planning, Scrum of Scrums and the tool.dependency_map.* agent actions.
  const map = useDependencyMap();
  const today = todayLocalISO();
  const { log } = useHistoryLogger("dependency-map");
  const exportRef = useRef<HTMLDivElement>(null);
  const [editing, setEditing] = useState<string | null>(null);
  const [confirmNode, setConfirmNode] = useState<DependencyNode | null>(null);
  const [statusFilter, setStatusFilter] = useState<StatusFilter>("all");
  const [overdueOnly, setOverdueOnly] = useState(false);

  const edges = useMemo(() => cleanEdges(map), [map]);
  const cycles = useMemo(() => detectCycles(map.nodes, edges), [map.nodes, edges]);
  const path: CriticalPath = useMemo(
    () => criticalPath(map.nodes, edges, today),
    [map.nodes, edges, today]
  );
  const onPath = useMemo(() => new Set(path.nodes), [path]);
  const label = (id: string) => map.nodes.find((n) => n.id === id)?.label ?? id;
  const open = edges.filter((e) => edgeStatus(e) !== "resolved");
  const overdue = open.filter((e) => isOverdue(e, today));

  /* ── Nodes ── */

  const addNode = (v: NodeValues) => {
    const node: DependencyNode = { id: nanoid(6), ...v };
    updateDependencyMap((m) => ({ ...m, nodes: [...m.nodes, node] }));
    log(DEPENDENCY_MAP_ACTIONS.NODE_ADDED, {
      nodeId: node.id,
      label: node.label,
      description: node.description,
    });
  };

  const saveNode = (node: DependencyNode, v: NodeValues) => {
    setEditing(null);
    updateDependencyMap((m) => ({
      ...m,
      nodes: m.nodes.map((n) => {
        if (n.id !== node.id) return n;
        const next = setOptional({ ...n, label: v.label }, "team", v.team);
        return setOptional(next, "description", v.description);
      }),
    }));
  };

  /** Remove a node and every edge on it, with Undo for both. */
  const removeNode = (node: DependencyNode) => {
    let taken: {
      node: { item: DependencyNode; index: number }[];
      edges: { item: DependencyEdge; index: number }[];
    } = { node: [], edges: [] };
    const count = (currentDependencyMap()?.edges ?? []).filter((e) => touches(e, node.id)).length;
    undoable({
      label: `Removed “${node.label}”`,
      description:
        count > 0 ? `and its ${count} ${count === 1 ? "dependency" : "dependencies"}` : undefined,
      apply: () => {
        updateDependencyMap((m) => {
          taken = {
            node: m.nodes.flatMap((item, index) => (item.id === node.id ? [{ item, index }] : [])),
            edges: m.edges.flatMap((item, index) =>
              touches(item, node.id) ? [{ item, index }] : []
            ),
          };
          return {
            nodes: m.nodes.filter((n) => n.id !== node.id),
            edges: m.edges.filter((e) => !touches(e, node.id)),
          };
        });
        log(DEPENDENCY_MAP_ACTIONS.NODE_REMOVED, { nodeId: node.id, label: node.label });
      },
      revert: () =>
        updateDependencyMap((m) => ({
          nodes: insertAt(m.nodes, taken.node),
          edges: insertAt(m.edges, taken.edges),
        })),
    });
  };

  /** A node with dependencies asks first: removing it takes them too. */
  const requestRemoveNode = (node: DependencyNode) => {
    if (map.edges.some((e) => touches(e, node.id))) setConfirmNode(node);
    else removeNode(node);
  };

  /* ── Edges ── */

  const addEdge = (v: EdgeValues) => {
    const edge: DependencyEdge = { id: nanoid(6), ...v };
    updateDependencyMap((m) => ({ ...m, edges: [...m.edges, edge] }));
    log(DEPENDENCY_MAP_ACTIONS.EDGE_ADDED, {
      edgeId: edge.id,
      from: edge.from,
      to: edge.to,
      kind: edge.kind,
    });
  };

  const saveEdge = (edge: DependencyEdge, v: EdgeValues) => {
    setEditing(null);
    updateDependencyMap((m) => ({
      ...m,
      edges: m.edges.map((e) => {
        if (e.id !== edge.id) return e;
        // A status change goes through withEdgeStatus, which stamps or clears resolvedAt.
        let next: DependencyEdge =
          v.status === edgeStatus(e) ? { ...e } : withEdgeStatus(e, v.status);
        next.kind = v.kind;
        next = setOptional(next, "owner", v.owner);
        next = setOptional(next, "due", v.due);
        return setOptional(next, "note", v.note);
      }),
    }));
  };

  const removeEdge = (edge: DependencyEdge) => {
    let index = -1;
    undoable({
      label: `Removed “${label(edge.from)} ${edge.kind} ${label(edge.to)}”`,
      apply: () => {
        updateDependencyMap((m) => {
          index = m.edges.findIndex((e) => e.id === edge.id);
          return { ...m, edges: m.edges.filter((e) => e.id !== edge.id) };
        });
        log(DEPENDENCY_MAP_ACTIONS.EDGE_REMOVED, { edgeId: edge.id });
      },
      revert: () =>
        updateDependencyMap((m) => ({
          ...m,
          edges: index < 0 ? m.edges : insertAt(m.edges, [{ item: edge, index }]),
        })),
    });
  };

  /* ── Example ── */

  const loadExample = () => saveDependencyMap(withExample(currentDependencyMap() ?? map));
  const clearExample = () => saveDependencyMap(withoutExample(currentDependencyMap() ?? map));

  /* ── Derived views ── */

  const shown = edges.filter(
    (e) =>
      (statusFilter === "all" || edgeStatus(e) === statusFilter) &&
      (!overdueOnly || isOverdue(e, today))
  );
  const filtered = statusFilter !== "all" || overdueOnly;

  const promptConfig = useMemo(
    () => ({
      toolName: "Dependency Map",
      // The cleaned edges, so the brief never names a deleted node.
      prompts: generateDependencyMapPrompts({
        nodes: map.nodes,
        edges,
        cycles,
        criticalPath: path.nodes,
      }),
    }),
    [map.nodes, edges, cycles, path.nodes]
  );

  // Cross-tool signal: several blockers raised lately often map to known
  // dependencies, so ask the user to check.
  const events = useHistoryStore((s) => s.events);
  const recentBlockers = useMemo(() => {
    const since = Date.now() - 14 * 86_400_000;
    return events.filter(
      (e) =>
        e.toolId === "impediments" &&
        e.action === "impediment_raised" &&
        new Date(e.occurredAt).getTime() >= since
    ).length;
  }, [events]);

  const csvData = {
    headers: [
      "Type",
      "ID",
      "Label/Kind",
      "Description",
      "From",
      "To",
      "Team",
      "Status",
      "Owner",
      "Due",
      "Note",
    ],
    rows: [
      ...map.nodes.map((n): (string | number)[] => [
        "node",
        n.id,
        n.label,
        n.description ?? "",
        "",
        "",
        n.team ?? "",
        "",
        "",
        "",
        "",
      ]),
      ...edges.map((e): (string | number)[] => [
        "edge",
        e.id,
        e.kind,
        "",
        label(e.from),
        label(e.to),
        "",
        DEPENDENCY_STATUS_LABEL[edgeStatus(e)],
        e.owner ?? "",
        e.due ?? "",
        e.note ?? "",
      ]),
    ],
  };

  const confirmCount = confirmNode ? map.edges.filter((e) => touches(e, confirmNode.id)).length : 0;

  return (
    <ToolPageWrapper
      toolId="dependency-map"
      title="Dependency Map"
      description="Model inter-team/inter-story dependencies. Auto-detects cycles and the longest critical path."
      category="Flow & Delivery"
    >
      <div ref={exportRef} className="space-y-4">
        {hasExampleItems(map.nodes) && <ExampleNotice onClear={clearExample} />}

        <ActionRow>
          <AiPromptGenerator config={promptConfig} />
          <ExportButton
            filename="dependency-map"
            csvData={csvData}
            jsonData={map}
            markdown={toMarkdown(map, today)}
            targetRef={exportRef}
          />
        </ActionRow>

        <KpiGrid cols={4} gap="lg" marginBottom="none">
          <StatCard
            variant="compact"
            icon={Network}
            label="Nodes"
            value={map.nodes.length}
            valueClassName="text-accent"
          />
          <StatCard
            variant="compact"
            icon={GitBranch}
            label="Dependencies"
            value={edges.length}
            hint={`${open.length} open`}
          />
          <StatCard
            variant="compact"
            icon={AlertTriangle}
            label="Overdue"
            value={overdue.length}
            tone={overdue.length > 0 ? "danger" : "default"}
          />
          <StatCard
            variant="compact"
            icon={RotateCcw}
            label="Circular waits"
            value={cycles.length}
            tone={cycles.length > 0 ? "danger" : "default"}
          />
        </KpiGrid>

        {recentBlockers >= 3 && (
          <CalloutAlert tone="info">
            {recentBlockers} blockers raised in the last 14 days. Check whether they map to
            dependencies on this map.
          </CalloutAlert>
        )}

        {map.nodes.length === 0 ? (
          <EmptyState icon={Network} action={<LoadExampleButton onLoad={loadExample} />}>
            Nothing on the map yet. Add the teams, services or deliverables below, then draw who
            waits on whom, or load an example to see a release mapped.
          </EmptyState>
        ) : (
          <SectionCard title="Map" icon={Network}>
            <p className="mb-3 text-sm font-medium text-text">{dependencyVerdict(map, today)}</p>
            <DependencyGraph nodes={map.nodes} edges={edges} today={today} critical={onPath} />
          </SectionCard>
        )}

        {cycles.length > 0 && (
          <CalloutAlert tone="danger">
            <strong>Circular wait: no critical path until one of these links is resolved.</strong>
            <ul className="mt-1 space-y-0.5">
              {cycles.slice(0, 3).map((c) => (
                // The canonical id ring is a stable key as cycles come and go.
                <li key={c.join(">")}>{c.map(label).join(" → ")}</li>
              ))}
            </ul>
          </CalloutAlert>
        )}

        {cycles.length === 0 && edges.length > 0 && <CriticalPathCard path={path} label={label} />}

        <SectionCard title={`Nodes (${map.nodes.length})`} icon={Network}>
          <div className="space-y-4">
            <NodeAddForm nodes={map.nodes} onAdd={addNode} />
            {map.nodes.length > 0 && (
              <ul className="divide-y divide-border" aria-label="Nodes">
                {map.nodes.map((n) => (
                  <li key={n.id} className="py-3">
                    {editing === n.id ? (
                      <NodeEditor
                        node={n}
                        nodes={map.nodes}
                        onSave={(v) => saveNode(n, v)}
                        onCancel={() => setEditing(null)}
                      />
                    ) : (
                      <NodeRow
                        node={n}
                        links={edges.filter((e) => touches(e, n.id)).length}
                        onPath={onPath.has(n.id)}
                        onEdit={() => setEditing(n.id)}
                        onRemove={() => requestRemoveNode(n)}
                      />
                    )}
                  </li>
                ))}
              </ul>
            )}
          </div>
        </SectionCard>

        <SectionCard title={`Dependencies (${edges.length})`} icon={GitBranch}>
          <div className="space-y-4">
            {map.nodes.length < 2 ? (
              <p className="text-sm text-sub">Add at least two nodes to draw a dependency.</p>
            ) : (
              <EdgeAddForm nodes={map.nodes} edges={map.edges} onAdd={addEdge} />
            )}
            {edges.length > 0 && (
              <>
                <div className="flex flex-wrap items-center gap-x-4 gap-y-2 border-t border-border pt-4">
                  <ToggleGroup
                    label="Show dependencies"
                    size="sm"
                    options={FILTER_OPTIONS}
                    value={statusFilter}
                    onValueChange={setStatusFilter}
                  />
                  <label className="inline-flex min-h-8 items-center gap-2 text-sm text-text">
                    <input
                      type="checkbox"
                      checked={overdueOnly}
                      onChange={(e) => setOverdueOnly(e.target.checked)}
                      className="h-4 w-4 accent-[var(--accent)]"
                    />
                    Overdue only
                  </label>
                  {filtered && (
                    <span className="text-xs text-sub" role="status">
                      Showing {shown.length} of {edges.length}
                    </span>
                  )}
                </div>
                {shown.length === 0 ? (
                  <p className="text-sm text-sub">
                    No dependencies match these filters.{" "}
                    <button
                      type="button"
                      className="text-accent underline-offset-2 hover:underline"
                      onClick={() => {
                        setStatusFilter("all");
                        setOverdueOnly(false);
                      }}
                    >
                      Show all
                    </button>
                  </p>
                ) : (
                  <ul className="divide-y divide-border" aria-label="Dependencies">
                    {shown.map((e) => (
                      <li key={e.id} className="py-3">
                        {editing === e.id ? (
                          <EdgeEditor
                            edge={e}
                            edges={map.edges}
                            sides={edgeSides(map, e)}
                            onSave={(v) => saveEdge(e, v)}
                            onCancel={() => setEditing(null)}
                          />
                        ) : (
                          <EdgeRow
                            edge={e}
                            map={map}
                            today={today}
                            onStatus={(s) => setEdgeStatus(e.id, s)}
                            onEdit={() => setEditing(e.id)}
                            onRemove={() => removeEdge(e)}
                          />
                        )}
                      </li>
                    ))}
                  </ul>
                )}
              </>
            )}
          </div>
        </SectionCard>
      </div>

      <ConfirmDialog
        open={confirmNode !== null}
        onOpenChange={(o) => {
          if (!o) setConfirmNode(null);
        }}
        title={`Remove “${confirmNode?.label ?? ""}”?`}
        description={`Its ${confirmCount} ${
          confirmCount === 1 ? "dependency goes" : "dependencies go"
        } with it. PI Planning and Scrum of Scrums items linked to ${
          confirmCount === 1 ? "it" : "them"
        } will show they're no longer on the map.`}
        confirmLabel="Remove node"
        onConfirm={() => {
          if (confirmNode) removeNode(confirmNode);
        }}
      />
    </ToolPageWrapper>
  );
}

function NodeRow({
  node,
  links,
  onPath,
  onEdit,
  onRemove,
}: {
  node: DependencyNode;
  links: number;
  onPath: boolean;
  onEdit: () => void;
  onRemove: () => void;
}) {
  return (
    <div className="flex flex-wrap items-start gap-x-3 gap-y-1">
      <div className="min-w-0 flex-1 basis-56 space-y-0.5">
        <p className="flex flex-wrap items-center gap-x-2 text-sm text-text">
          <span className="font-medium break-words">{node.label}</span>
          {node.team && <span className="font-mono text-xs text-sub">{node.team}</span>}
          {onPath && (
            <span className="rounded-full border border-warning/40 px-2 py-0.5 text-xs text-warning">
              On the critical path
            </span>
          )}
        </p>
        {node.description && (
          <p className="whitespace-pre-wrap break-words text-xs text-sub">{node.description}</p>
        )}
        <p className="flex flex-wrap items-center gap-x-3 text-xs text-sub">
          <span>
            {links === 0
              ? "No dependencies"
              : `${links} ${links === 1 ? "dependency" : "dependencies"}`}
          </span>
          <SourceLink sourceRef={node.sourceRef} />
        </p>
      </div>
      <span className="flex shrink-0 items-center">
        <IconButton
          label={`Edit ${node.label}`}
          icon={<Pencil className="h-4 w-4" />}
          className="text-sub hover:text-text"
          onClick={onEdit}
        />
        <IconButton
          label={`Remove node ${node.label}`}
          icon={<Trash2 className="h-4 w-4" />}
          className="text-sub hover:text-danger"
          onClick={onRemove}
        />
      </span>
    </div>
  );
}

function EdgeRow({
  edge,
  map,
  today,
  onStatus,
  onEdit,
  onRemove,
}: {
  edge: DependencyEdge;
  map: MapGraph;
  today: string;
  onStatus: (status: DependencyStatus) => void;
  onEdit: () => void;
  onRemove: () => void;
}) {
  const sides = edgeSides(map, edge);
  const status = edgeStatus(edge);
  const late = isOverdue(edge, today);
  const name = `${sides.from} ${edge.kind} ${sides.to}`;
  return (
    <div
      className={cn(
        "flex flex-wrap items-start gap-x-3 gap-y-1",
        status === "resolved" && "opacity-70"
      )}
    >
      <div className="min-w-0 flex-1 basis-56 space-y-1">
        <p className="flex flex-wrap items-center gap-x-2 gap-y-1 text-sm text-text">
          <span className="break-words">{sides.from}</span>
          <span className="text-xs font-medium uppercase text-accent">{edge.kind}</span>
          <span className="break-words">{sides.to}</span>
          <DependencyStatusChip status={status} overdue={late} />
        </p>
        <p className="flex flex-wrap gap-x-3 gap-y-0.5 text-xs text-sub">
          {edge.owner && <span>Owner: {edge.owner}</span>}
          {edge.due && (
            <span className={late ? "text-danger" : undefined}>Due {dayLabel(edge.due, true)}</span>
          )}
          {edge.resolvedAt && status === "resolved" && (
            <span>Resolved {dayLabel(edge.resolvedAt.slice(0, 10), true)}</span>
          )}
          <SourceLink sourceRef={edge.sourceRef} />
        </p>
        {edge.note && (
          <p className="whitespace-pre-wrap break-words text-xs text-sub">{edge.note}</p>
        )}
      </div>
      <span className="ml-auto flex shrink-0 items-center">
        {status === "resolved" ? (
          <Button
            type="button"
            variant="ghost"
            size="sm"
            className="min-touch-coarse gap-1 text-sub"
            aria-label={`Reopen ${name}`}
            onClick={() => onStatus("open")}
          >
            <RotateCcw aria-hidden="true" />
            Reopen
          </Button>
        ) : (
          <Button
            type="button"
            variant="ghost"
            size="sm"
            className="min-touch-coarse gap-1 text-success"
            aria-label={`Resolve ${name}`}
            onClick={() => onStatus("resolved")}
          >
            <CheckCircle2 aria-hidden="true" />
            Resolve
          </Button>
        )}
        <IconButton
          label={`Edit ${name}`}
          icon={<Pencil className="h-4 w-4" />}
          className="text-sub hover:text-text"
          onClick={onEdit}
        />
        <IconButton
          label={`Remove dependency ${name}`}
          icon={<Trash2 className="h-4 w-4" />}
          className="text-sub hover:text-danger"
          onClick={onRemove}
        />
      </span>
    </div>
  );
}

/** The longest chain still blocking, in delivery order, with each link's due date. */
function CriticalPathCard({ path, label }: { path: CriticalPath; label: (id: string) => string }) {
  if (path.steps.length === 0) {
    return (
      <SectionCard title="Critical path" icon={Route}>
        <p className="text-sm text-sub">Nothing is blocking: no open blocks or needs links.</p>
      </SectionCard>
    );
  }
  const n = path.steps.length;
  return (
    <SectionCard title={`Critical path (${n} ${n === 1 ? "link" : "links"})`} icon={Route}>
      <p className="mb-3 text-xs text-sub">
        The longest chain of open blocking links, from what has to be delivered first to the work
        that waits at the end. Each link&rsquo;s due date should come after the one before it.
      </p>
      <ol className="space-y-2" aria-label="Critical path">
        {path.steps.map((s, i) => (
          <li key={s.edge.id} className="flex flex-wrap items-center gap-x-2 gap-y-1 text-sm">
            <span className="w-5 shrink-0 font-mono text-xs text-sub">{i + 1}.</span>
            <span className="text-text">
              {label(s.provider)} → {label(s.consumer)}
            </span>
            <span className={s.overdue ? "text-xs text-danger" : "text-xs text-sub"}>
              {s.edge.due ? `due ${dayLabel(s.edge.due, true)}` : "no due date"}
            </span>
            {s.overdue && <Flag tone="danger">Overdue</Flag>}
            {s.atRisk && <Flag tone="warning">At risk</Flag>}
            {s.dueBeforeUpstream && <Flag tone="warning">Due before the link it waits on</Flag>}
          </li>
        ))}
      </ol>
    </SectionCard>
  );
}

function Flag({ tone, children }: { tone: "danger" | "warning"; children: string }) {
  return (
    <span
      className={
        tone === "danger"
          ? "rounded-full border border-danger/40 px-2 py-0.5 text-xs text-danger"
          : "rounded-full border border-warning/40 px-2 py-0.5 text-xs text-warning"
      }
    >
      {children}
    </span>
  );
}
