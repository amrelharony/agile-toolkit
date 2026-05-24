/**
 * Auto-layout algorithms for the whiteboard.
 *
 * Three layouts, picked from the "Auto-arrange" submenu:
 * - `gridLayout`  — pack N items into a regular grid (cols × rows).
 *                   Cheap, deterministic, good for templates.
 * - `treeLayout`  — recursive layered tree (root at top, children below).
 *                   Used by the OKR import + mind-map template.
 * - `forceLayout` — Fruchterman-Reingold force-directed simulation.
 *                   Used by the "Untangle" button on a graph of nodes +
 *                   connectors. Converges in ~80 iters for ~50 nodes.
 *
 * All three return `{ id → {x, y} }` maps in world coordinates. The caller
 * applies these to actual objects via `upsertWhiteboardObjects`.
 */

import type { Vec2 } from "@/lib/geometry/bbox";

export interface LayoutNode {
  id: string;
  w: number;
  h: number;
}

export interface LayoutEdge {
  from: string;
  to: string;
}

/* ─── Grid ─────────────────────────────────────────────────────────── */

export function gridLayout(
  nodes: readonly LayoutNode[],
  opts: { cols?: number; gap?: number; originX?: number; originY?: number } = {}
): Record<string, Vec2> {
  const cols = Math.max(1, opts.cols ?? Math.ceil(Math.sqrt(nodes.length)));
  const gap = opts.gap ?? 24;
  const originX = opts.originX ?? 0;
  const originY = opts.originY ?? 0;
  const rowH = Math.max(...nodes.map((n) => n.h), 0);
  const colW = Math.max(...nodes.map((n) => n.w), 0);
  const out: Record<string, Vec2> = {};
  nodes.forEach((n, i) => {
    const col = i % cols;
    const row = Math.floor(i / cols);
    out[n.id] = {
      x: originX + col * (colW + gap),
      y: originY + row * (rowH + gap),
    };
  });
  return out;
}

/* ─── Tree ─────────────────────────────────────────────────────────── */

/**
 * Layered tree layout. `parents[id] = parentId | null`. The root (parent = null)
 * sits at top center; children are arranged left-to-right one row below.
 */
export function treeLayout(
  nodes: readonly LayoutNode[],
  parents: Record<string, string | null>,
  opts: { rowGap?: number; colGap?: number } = {}
): Record<string, Vec2> {
  const rowGap = opts.rowGap ?? 80;
  const colGap = opts.colGap ?? 40;
  const childrenOf = new Map<string | null, string[]>();
  for (const n of nodes) {
    const p = parents[n.id] ?? null;
    if (!childrenOf.has(p)) childrenOf.set(p, []);
    childrenOf.get(p)!.push(n.id);
  }
  const byId = new Map(nodes.map((n) => [n.id, n]));
  const out: Record<string, Vec2> = {};

  // First pass: compute subtree widths bottom-up so we can center each parent.
  // Cycle-safe: a `parents` map authored by hand (or by a buggy importer)
  // can contain A→B→C→A. The recursive walk would otherwise infinite-loop
  // and freeze the tab. We track the in-progress recursion via `visiting`
  // and break the cycle by treating the offending node as a leaf.
  const subtreeWidth = new Map<string, number>();
  const visiting = new Set<string>();
  const computeWidth = (id: string): number => {
    if (subtreeWidth.has(id)) return subtreeWidth.get(id)!;
    if (visiting.has(id)) {
      // Cycle — treat this branch as a leaf with the node's own width.
      const w = byId.get(id)?.w ?? 80;
      subtreeWidth.set(id, w);
      return w;
    }
    visiting.add(id);
    const kids = childrenOf.get(id) ?? [];
    if (kids.length === 0) {
      const w = byId.get(id)?.w ?? 80;
      subtreeWidth.set(id, w);
      visiting.delete(id);
      return w;
    }
    let total = 0;
    for (const k of kids) total += computeWidth(k);
    total += (kids.length - 1) * colGap;
    const ownW = byId.get(id)?.w ?? 80;
    const w = Math.max(total, ownW);
    subtreeWidth.set(id, w);
    visiting.delete(id);
    return w;
  };
  for (const n of nodes) computeWidth(n.id);

  // Second pass: assign positions top-down — also cycle-safe via `placed`.
  const placed = new Set<string>();
  const place = (id: string, leftX: number, y: number) => {
    // BUG-L5: assign a fallback position BEFORE the cycle short-circuit
    // so a node visited twice (diamond DAG, multiple parents) still has
    // SOME `out[id]` entry. Without this, downstream consumers reading
    // `positions[id].x` for the missed node get `undefined` and produce
    // NaN-position cards.
    if (placed.has(id)) {
      if (!out[id]) out[id] = { x: leftX, y };
      return;
    }
    placed.add(id);
    const n = byId.get(id);
    if (!n) {
      if (!out[id]) out[id] = { x: leftX, y };
      return;
    }
    const w = subtreeWidth.get(id)!;
    const centerX = leftX + w / 2;
    out[id] = { x: centerX - n.w / 2, y };
    const kids = childrenOf.get(id) ?? [];
    if (kids.length === 0) return;
    let cursor = leftX;
    const childY = y + n.h + rowGap;
    for (const k of kids) {
      const kw = subtreeWidth.get(k)!;
      place(k, cursor, childY);
      cursor += kw + colGap;
    }
  };
  const roots = childrenOf.get(null) ?? [];
  let cursor = 0;
  for (const r of roots) {
    place(r, cursor, 0);
    cursor += subtreeWidth.get(r)! + colGap * 2;
  }
  // Any node that wasn't reachable from a root (e.g. all involved in
  // a cycle, or parent points at a non-existent id) still needs a
  // position. Append them in a trailing row so the user sees them.
  const trailY =
    roots.length === 0 ? 0 : Math.max(...roots.map((r) => byId.get(r)?.h ?? 80)) + rowGap * 2;
  let trailX = 0;
  for (const n of nodes) {
    if (placed.has(n.id)) continue;
    out[n.id] = { x: trailX, y: trailY };
    trailX += n.w + colGap;
  }
  return out;
}

/* ─── Force-directed ────────────────────────────────────────────────── */

/**
 * Fruchterman-Reingold force layout. Each iteration:
 *  - repulsive force ~ k²/d between every pair of nodes
 *  - attractive force ~ d²/k along every edge
 *  - cap displacement by a "temperature" that linearly cools to 0
 *
 * Initial positions: nodes that already have a sensible position keep it;
 * unpositioned nodes are placed on a circle around the origin.
 */
export function forceLayout(
  nodes: readonly LayoutNode[],
  edges: readonly LayoutEdge[],
  opts: {
    iterations?: number;
    width?: number;
    height?: number;
    initial?: Record<string, Vec2>;
  } = {}
): Record<string, Vec2> {
  const W = opts.width ?? Math.max(800, Math.sqrt(nodes.length) * 100);
  const H = opts.height ?? Math.max(600, Math.sqrt(nodes.length) * 100);
  const k = Math.sqrt((W * H) / Math.max(1, nodes.length));
  const iterations = opts.iterations ?? 80;
  const pos: Record<string, { x: number; y: number; dx: number; dy: number }> = {};

  nodes.forEach((n, i) => {
    const init = opts.initial?.[n.id];
    if (init) {
      pos[n.id] = { x: init.x, y: init.y, dx: 0, dy: 0 };
    } else {
      const angle = (i / nodes.length) * Math.PI * 2;
      pos[n.id] = {
        x: W / 2 + (Math.cos(angle) * Math.min(W, H)) / 3,
        y: H / 2 + (Math.sin(angle) * Math.min(W, H)) / 3,
        dx: 0,
        dy: 0,
      };
    }
  });

  let temp = Math.min(W, H) / 10;
  const cool = temp / iterations;

  for (let iter = 0; iter < iterations; iter++) {
    // Reset displacements.
    for (const id in pos) {
      pos[id].dx = 0;
      pos[id].dy = 0;
    }
    // Repulsion (O(n²) — fine for ≤ ~150 nodes).
    const ids = Object.keys(pos);
    for (let i = 0; i < ids.length; i++) {
      for (let j = i + 1; j < ids.length; j++) {
        const a = pos[ids[i]];
        const b = pos[ids[j]];
        let dx = a.x - b.x;
        let dy = a.y - b.y;
        let dist = Math.sqrt(dx * dx + dy * dy);
        if (dist < 0.01) {
          dx = Math.random() - 0.5;
          dy = Math.random() - 0.5;
          dist = 0.01;
        }
        const force = (k * k) / dist;
        a.dx += (dx / dist) * force;
        a.dy += (dy / dist) * force;
        b.dx -= (dx / dist) * force;
        b.dy -= (dy / dist) * force;
      }
    }
    // Attraction along edges.
    for (const e of edges) {
      const a = pos[e.from];
      const b = pos[e.to];
      if (!a || !b) continue;
      const dx = a.x - b.x;
      const dy = a.y - b.y;
      const dist = Math.sqrt(dx * dx + dy * dy) || 0.01;
      const force = (dist * dist) / k;
      a.dx -= (dx / dist) * force;
      a.dy -= (dy / dist) * force;
      b.dx += (dx / dist) * force;
      b.dy += (dy / dist) * force;
    }
    // Apply capped displacements.
    for (const id in pos) {
      const p = pos[id];
      const disp = Math.sqrt(p.dx * p.dx + p.dy * p.dy) || 0.01;
      p.x += (p.dx / disp) * Math.min(disp, temp);
      p.y += (p.dy / disp) * Math.min(disp, temp);
    }
    temp = Math.max(0.01, temp - cool);
  }

  const out: Record<string, Vec2> = {};
  for (const id in pos) out[id] = { x: pos[id].x, y: pos[id].y };
  return out;
}
