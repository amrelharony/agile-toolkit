"use client";

import { useMemo, useState } from "react";
import { nanoid } from "nanoid";
import { ToolPageWrapper } from "@/components/layout/tool-page-wrapper";
import { ExportButton } from "@/components/shared/export-button";
import { AiPromptGenerator } from "@/components/shared/ai-prompt-generator";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Plus, Trash2, Network, AlertTriangle, GitBranch } from "lucide-react";
import { generateDependencyMapPrompts } from "@/lib/ai-prompts/dependency-map";
import { usePersisted } from "@/lib/utils/use-persisted";
import { useHistoryLogger } from "@/lib/history/use-history-logger";
import { DEPENDENCY_MAP_ACTIONS } from "@/lib/history/event-actions";
import { StatCard } from "@/components/shared/stat-card";
import { KpiGrid } from "@/components/shared/kpi-grid";
import { CalloutAlert } from "@/components/shared/callout-alert";

interface Node {
  id: string;
  label: string;
  team?: string;
}

interface Edge {
  id: string;
  from: string;
  to: string;
  kind: "blocks" | "needs" | "informs";
}

interface State {
  nodes: Node[];
  edges: Edge[];
}

const DEFAULT_STATE: State = { nodes: [], edges: [] };

function detectCycles(nodes: Node[], edges: Edge[]): string[][] {
  const adj = new Map<string, string[]>();
  for (const e of edges) {
    if (e.kind === "blocks" || e.kind === "needs") {
      const src = e.kind === "needs" ? e.to : e.from;
      const dst = e.kind === "needs" ? e.from : e.to;
      const list = adj.get(src) ?? [];
      list.push(dst);
      adj.set(src, list);
    }
  }
  const cycles: string[][] = [];
  const visiting = new Set<string>();
  const done = new Set<string>();
  const dfs = (u: string, stack: string[]) => {
    if (visiting.has(u)) {
      const idx = stack.indexOf(u);
      if (idx >= 0) cycles.push(stack.slice(idx).concat(u));
      return;
    }
    if (done.has(u)) return;
    visiting.add(u);
    for (const v of adj.get(u) ?? []) dfs(v, stack.concat(u));
    visiting.delete(u);
    done.add(u);
  };
  for (const n of nodes) dfs(n.id, []);
  // Canonicalize each cycle by rotating to start with its lexicographically
  // smallest node, then dedupe — DFS from every node otherwise reports the
  // same 3-cycle three times in the UI.
  const seen = new Set<string>();
  const unique: string[][] = [];
  for (const c of cycles) {
    if (c.length < 2) continue;
    // The cycle path comes back as `[start, ..., start]`. Drop the trailing
    // duplicate before canonicalizing so rotations are clean.
    const ring = c[0] === c[c.length - 1] ? c.slice(0, -1) : c.slice();
    let pivot = 0;
    for (let i = 1; i < ring.length; i++) {
      if (ring[i] < ring[pivot]) pivot = i;
    }
    const rotated = [...ring.slice(pivot), ...ring.slice(0, pivot)];
    const key = rotated.join(">");
    if (!seen.has(key)) {
      seen.add(key);
      unique.push([...rotated, rotated[0]]);
    }
  }
  return unique;
}

function computeCriticalPath(nodes: Node[], edges: Edge[]): string[] {
  const adj = new Map<string, string[]>();
  for (const e of edges.filter((x) => x.kind === "blocks" || x.kind === "needs")) {
    const src = e.kind === "needs" ? e.to : e.from;
    const dst = e.kind === "needs" ? e.from : e.to;
    const list = adj.get(src) ?? [];
    list.push(dst);
    adj.set(src, list);
  }
  const memo = new Map<string, { len: number; path: string[] }>();
  const visiting = new Set<string>();
  const visit = (u: string): { len: number; path: string[] } => {
    if (memo.has(u)) return memo.get(u)!;
    if (visiting.has(u)) return { len: 0, path: [] };
    visiting.add(u);
    const neighbors = adj.get(u) ?? [];
    let best: { len: number; path: string[] } = { len: 1, path: [u] };
    for (const v of neighbors) {
      const sub = visit(v);
      if (sub.len + 1 > best.len) best = { len: sub.len + 1, path: [u, ...sub.path] };
    }
    visiting.delete(u);
    memo.set(u, best);
    return best;
  };
  let overall: { len: number; path: string[] } = { len: 0, path: [] };
  for (const n of nodes) {
    const r = visit(n.id);
    if (r.len > overall.len) overall = r;
  }
  return overall.path;
}

export function DependencyMapClient() {
  const [state, setState] = usePersisted<State>("agile-toolkit:dependency-map", DEFAULT_STATE);
  const [newNode, setNewNode] = useState({ label: "", team: "" });
  const [newEdge, setNewEdge] = useState<{ from: string; to: string; kind: Edge["kind"] }>({ from: "", to: "", kind: "blocks" });
  const { log } = useHistoryLogger("dependency-map");

  const addNode = () => {
    if (!newNode.label.trim()) return;
    const node = { id: nanoid(6), label: newNode.label.trim(), team: newNode.team || undefined };
    setState((s) => ({ ...s, nodes: [...s.nodes, node] }));
    log(DEPENDENCY_MAP_ACTIONS.NODE_ADDED, { nodeId: node.id, label: node.label });
    setNewNode({ label: "", team: "" });
  };
  const removeNode = (id: string) => {
    const node = state.nodes.find((n) => n.id === id);
    setState((s) => ({ nodes: s.nodes.filter((n) => n.id !== id), edges: s.edges.filter((e) => e.from !== id && e.to !== id) }));
    log(DEPENDENCY_MAP_ACTIONS.NODE_REMOVED, { nodeId: id, label: node?.label });
  };
  const addEdge = () => {
    if (!newEdge.from || !newEdge.to || newEdge.from === newEdge.to) return;
    const edge = { id: nanoid(6), ...newEdge };
    setState((s) => ({ ...s, edges: [...s.edges, edge] }));
    log(DEPENDENCY_MAP_ACTIONS.EDGE_ADDED, {
      edgeId: edge.id,
      from: edge.from,
      to: edge.to,
      kind: edge.kind,
    });
  };
  const removeEdge = (id: string) => {
    setState((s) => ({ ...s, edges: s.edges.filter((e) => e.id !== id) }));
    log(DEPENDENCY_MAP_ACTIONS.EDGE_REMOVED, { edgeId: id });
  };

  const cycles = useMemo(() => detectCycles(state.nodes, state.edges), [state]);
  const criticalPath = useMemo(() => computeCriticalPath(state.nodes, state.edges), [state]);
  const nodeLabel = (id: string) => state.nodes.find((n) => n.id === id)?.label ?? id;

  const promptConfig = useMemo(
    () => ({
      toolName: "Dependency Map",
      prompts: generateDependencyMapPrompts({ nodes: state.nodes, edges: state.edges, cycles, criticalPath }),
    }),
    [state, cycles, criticalPath]
  );

  return (
    <ToolPageWrapper
      toolId="dependency-map"
      title="Dependency Map"
      description="Model inter-team/inter-story dependencies. Auto-detects cycles and the longest critical path."
      category="Flow & Delivery"
    >
      <div className="flex flex-wrap items-center justify-end gap-2 mb-4">
        <AiPromptGenerator config={promptConfig} />
        <ExportButton
          filename="dependency-map"
          csvData={{
            headers: ["Type", "ID", "Label/Kind", "From", "To", "Team"],
            rows: [
              ...state.nodes.map((n) => ["node", n.id, n.label, "", "", n.team ?? ""] as (string | number)[]),
              ...state.edges.map((e) => ["edge", e.id, e.kind, nodeLabel(e.from), nodeLabel(e.to), ""] as (string | number)[]),
            ],
          }}
          jsonData={state}
        />
      </div>

      <KpiGrid cols={3} gap="lg">
        <StatCard
          variant="compact"
          icon={Network}
          label="Nodes"
          value={state.nodes.length}
          valueClassName="text-accent"
        />
        <StatCard
          variant="compact"
          icon={GitBranch}
          label="Edges"
          value={state.edges.length}
        />
        <StatCard
          variant="compact"
          icon={AlertTriangle}
          label="Cycles"
          value={cycles.length}
          tone={cycles.length > 0 ? "danger" : "default"}
        />
      </KpiGrid>

      {cycles.length > 0 && (
        <CalloutAlert tone="danger" className="mb-4">
          <strong>Circular dependencies detected:</strong>
          <ul className="mt-1 space-y-0.5">
            {cycles.slice(0, 3).map((c, i) => (
              <li key={i}>{c.map(nodeLabel).join(" → ")}</li>
            ))}
          </ul>
        </CalloutAlert>
      )}

      {criticalPath.length > 1 && (
        <CalloutAlert tone="warning" className="mb-4">
          <strong>Critical path ({criticalPath.length} nodes):</strong>{" "}
          {criticalPath.map(nodeLabel).join(" → ")}
        </CalloutAlert>
      )}

      <Card className="bg-surface border-border mb-6">
        <CardContent className="p-4 space-y-3">
          <div className="text-sm font-semibold text-text flex items-center gap-2">
            <Plus className="w-4 h-4" />
            Add node
          </div>
          <div className="grid grid-cols-1 md:grid-cols-[1fr_200px_auto] gap-2">
            <Input
              value={newNode.label}
              onChange={(e) => setNewNode((n) => ({ ...n, label: e.target.value }))}
              placeholder="Story / epic / service / team..."
              className="bg-bg border-border"
            />
            <Input
              value={newNode.team}
              onChange={(e) => setNewNode((n) => ({ ...n, team: e.target.value }))}
              placeholder="Team (optional)"
              className="bg-bg border-border"
            />
            <Button onClick={addNode} className="gap-2 bg-accent text-bg hover:bg-accent/90">
              <Plus className="w-4 h-4" />
              Add
            </Button>
          </div>
        </CardContent>
      </Card>

      <Card className="bg-surface border-border mb-6">
        <CardContent className="p-4 space-y-3">
          <div className="text-sm font-semibold text-text flex items-center gap-2">
            <GitBranch className="w-4 h-4" />
            Add dependency
          </div>
          <div className="grid grid-cols-1 md:grid-cols-[1fr_140px_1fr_auto] gap-2">
            <Select value={newEdge.from} onValueChange={(v) => setNewEdge((e) => ({ ...e, from: v }))}>
              <SelectTrigger className="bg-bg border-border"><SelectValue placeholder="From..." /></SelectTrigger>
              <SelectContent>
                {state.nodes.map((n) => <SelectItem key={n.id} value={n.id}>{n.label}</SelectItem>)}
              </SelectContent>
            </Select>
            <Select value={newEdge.kind} onValueChange={(v) => setNewEdge((e) => ({ ...e, kind: v as Edge["kind"] }))}>
              <SelectTrigger className="bg-bg border-border"><SelectValue /></SelectTrigger>
              <SelectContent>
                <SelectItem value="blocks">blocks</SelectItem>
                <SelectItem value="needs">needs</SelectItem>
                <SelectItem value="informs">informs</SelectItem>
              </SelectContent>
            </Select>
            <Select value={newEdge.to} onValueChange={(v) => setNewEdge((e) => ({ ...e, to: v }))}>
              <SelectTrigger className="bg-bg border-border"><SelectValue placeholder="To..." /></SelectTrigger>
              <SelectContent>
                {state.nodes.map((n) => <SelectItem key={n.id} value={n.id}>{n.label}</SelectItem>)}
              </SelectContent>
            </Select>
            <Button onClick={addEdge} className="gap-2 bg-accent text-bg hover:bg-accent/90">
              <Plus className="w-4 h-4" />
              Add
            </Button>
          </div>
        </CardContent>
      </Card>

      <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
        <div>
          <div className="text-sm font-semibold text-text mb-2">Nodes</div>
          <div className="space-y-2">
            {state.nodes.map((n) => {
              const onCritical = criticalPath.includes(n.id);
              return (
                <div key={n.id} className={`flex items-center gap-2 rounded-lg border p-2 ${onCritical ? "border-amber-500/40 bg-amber-500/5" : "border-border bg-surface"}`}>
                  <span className="flex-1 text-sm text-text truncate">{n.label}</span>
                  {n.team && <span className="text-xs text-sub font-mono">{n.team}</span>}
                  <Button variant="ghost" size="sm" onClick={() => removeNode(n.id)} className="text-sub hover:text-danger">
                    <Trash2 className="w-3.5 h-3.5" />
                  </Button>
                </div>
              );
            })}
          </div>
        </div>
        <div>
          <div className="text-sm font-semibold text-text mb-2">Dependencies</div>
          <div className="space-y-2">
            {state.edges.map((e) => (
              <div key={e.id} className="flex items-center gap-2 rounded-lg border border-border bg-surface p-2 text-xs">
                <span className="truncate text-text">{nodeLabel(e.from)}</span>
                <span className="text-accent uppercase">{e.kind}</span>
                <span className="truncate text-text flex-1">{nodeLabel(e.to)}</span>
                <Button variant="ghost" size="sm" onClick={() => removeEdge(e.id)} className="text-sub hover:text-danger">
                  <Trash2 className="w-3.5 h-3.5" />
                </Button>
              </div>
            ))}
          </div>
        </div>
      </div>
    </ToolPageWrapper>
  );
}
