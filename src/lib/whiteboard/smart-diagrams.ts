/**
 * Smart Diagrams — CSV → diagram (Phase 33).
 *
 * Two recognised shapes:
 *
 *   1. **Tree / org-chart** — two columns: `name, parent` (or `name, reports_to`).
 *      Rows with empty parent become roots. We use `treeLayout` to position
 *      cards and emit straight connectors from each parent to each child.
 *
 *   2. **Flowchart** — two columns: `from, to`. Each unique label becomes a
 *      card; each row becomes a connector. Auto-layout uses `forceLayout`
 *      to untangle the graph so the result is readable without manual
 *      arrangement.
 *
 * Parse + shape-detect heuristics live here so the import-modal UI is a
 * thin wrapper. No external CSV parser — we hand-roll a minimal RFC-4180
 * tolerant tokeniser. Comma + newline separators, double-quoted fields,
 * "" → embedded quote.
 */

import type {
  WhiteboardCard,
  WhiteboardConnector,
  WhiteboardObject,
} from "@/lib/stores/workspace-types";
import { treeLayout, forceLayout } from "./layout";

const CARD_W = 200;
const CARD_H = 80;
const ROW_GAP = 80;
const COL_GAP = 40;

export type DiagramShape = "tree" | "flowchart" | "unknown";

export interface DiagramRow {
  /** Source / node label. */
  a: string;
  /** Target / parent label. Empty string = root (tree mode). */
  b: string;
}

export interface ParsedDiagram {
  shape: DiagramShape;
  rows: DiagramRow[];
  /** Human-readable error when parsing fails or shape can't be inferred. */
  error?: string;
}

/**
 * Hand-rolled CSV tokeniser. Returns rows as `string[][]`. Header row
 * is preserved — caller decides whether to drop it.
 *
 * Tolerant of:
 *   - bare commas inside double-quoted fields
 *   - embedded quotes as `""` per RFC-4180
 *   - CR-LF, LF, and CR line endings
 *   - trailing empty rows
 */
export function parseCsv(text: string): string[][] {
  if (text.length > 5_000_000) throw new Error("CSV too large (>5MB)");
  // Strip UTF-8 BOM (Excel exports include it, breaks header sniff).
  if (text.charCodeAt(0) === 0xFEFF) text = text.slice(1);
  const out: string[][] = [];
  let row: string[] = [];
  // Array buffering avoids O(n^2) string concat on adversarial input.
  let fieldBuf: string[] = [];
  let inQuotes = false;
  for (let i = 0; i < text.length; i++) {
    const ch = text[i];
    if (inQuotes) {
      if (ch === '"') {
        if (text[i + 1] === '"') {
          // Escaped quote.
          fieldBuf.push('"');
          i++;
        } else {
          inQuotes = false;
        }
      } else {
        fieldBuf.push(ch);
      }
      continue;
    }
    if (ch === '"') { inQuotes = true; continue; }
    if (ch === ",") { row.push(fieldBuf.join("")); fieldBuf = []; continue; }
    if (ch === "\n" || ch === "\r") {
      // CR-LF: consume the LF.
      if (ch === "\r" && text[i + 1] === "\n") i++;
      row.push(fieldBuf.join(""));
      fieldBuf = [];
      // Skip rows that are entirely empty or whitespace-only.
      if (row.some((c) => c.trim().length > 0)) out.push(row);
      row = [];
      continue;
    }
    fieldBuf.push(ch);
  }
  // Tail handling: a trailing record with no terminator.
  if (fieldBuf.length > 0 || row.length > 0) {
    row.push(fieldBuf.join(""));
    if (row.some((c) => c.trim().length > 0)) out.push(row);
  }
  return out;
}

/**
 * Detect whether a 2-column CSV is a tree or a flowchart.
 *
 * Heuristic: if any node appears as both a source AND a target across
 * multiple rows (cycle or DAG with shared targets), it's a flowchart.
 * If every node has at most one parent and there are no cycles, it's
 * a tree.
 */
function detectShape(rows: DiagramRow[]): DiagramShape {
  if (rows.length === 0) return "unknown";
  // Count how many distinct b-values (parents) each a (child) has.
  // Tree property: every node has at most one parent.
  const parentsOf = new Map<string, Set<string>>();
  for (const r of rows) {
    if (!r.b) continue;
    if (!parentsOf.has(r.a)) parentsOf.set(r.a, new Set());
    parentsOf.get(r.a)!.add(r.b);
  }
  for (const set of Array.from(parentsOf.values())) {
    if (set.size > 1) return "flowchart";
  }
  // Cycle detection — DFS over the implied parent → child graph.
  const adj = new Map<string, string[]>();
  for (const r of rows) {
    if (!r.b) continue;
    // b is parent; a is child. Tree edge: b → a.
    if (!adj.has(r.b)) adj.set(r.b, []);
    adj.get(r.b)!.push(r.a);
  }
  const WHITE = 0, GRAY = 1, BLACK = 2;
  const color = new Map<string, number>();
  const allNodes = new Set<string>();
  for (const r of rows) {
    allNodes.add(r.a);
    if (r.b) allNodes.add(r.b);
  }
  Array.from(allNodes).forEach((n) => color.set(n, WHITE));
  // Iterative DFS with explicit stack to avoid blowing the JS call stack
  // on long parent-chains. Depth cap defends against pathological inputs.
  const MAX_STACK = 50_000;
  const hasCycleFrom = (root: string): boolean => {
    const stack: Array<{ node: string; childIdx: number }> = [];
    color.set(root, GRAY);
    stack.push({ node: root, childIdx: 0 });
    while (stack.length > 0) {
      if (stack.length > MAX_STACK) return true; // treat as flowchart-shaped
      const frame = stack[stack.length - 1];
      const children = adj.get(frame.node) ?? [];
      if (frame.childIdx >= children.length) {
        color.set(frame.node, BLACK);
        stack.pop();
        continue;
      }
      const m = children[frame.childIdx];
      frame.childIdx++;
      const c = color.get(m) ?? WHITE;
      if (c === GRAY) return true; // back-edge = cycle
      if (c === WHITE) {
        color.set(m, GRAY);
        stack.push({ node: m, childIdx: 0 });
      }
    }
    return false;
  };
  for (const n of Array.from(allNodes)) {
    if (color.get(n) === WHITE && hasCycleFrom(n)) return "flowchart";
  }
  return "tree";
}

/**
 * Parse a CSV string into a normalised ParsedDiagram, including
 * shape detection. Recognises common headers:
 *   - tree:      name, parent | name, reports_to | child, parent
 *   - flowchart: from, to | source, target
 *
 * If the first row doesn't match a known header, it's treated as data
 * (so a bare 2-column CSV without header still works).
 */
export function parseDiagramCsv(text: string): ParsedDiagram {
  let tokens: string[][];
  try {
    tokens = parseCsv(text);
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    return { shape: "unknown", rows: [], error: msg };
  }
  if (tokens.length === 0) return { shape: "unknown", rows: [], error: "Empty CSV." };
  // Sniff header: lowercased + trimmed.
  const first = tokens[0].map((c) => c.trim().toLowerCase());
  const TREE_HEADERS = [
    ["name", "parent"],
    ["name", "reports_to"],
    ["name", "reports to"],
    ["child", "parent"],
  ];
  const FLOW_HEADERS = [
    ["from", "to"],
    ["source", "target"],
  ];
  // Tolerate extra trailing columns: a 3-col CSV `name,parent,extra` should
  // still match the `name,parent` header.
  const sameAs = (h: string[]) => h.length <= first.length && h.every((v, i) => v === first[i]);
  let dataStart = 0;
  let forcedShape: DiagramShape | null = null;
  if (TREE_HEADERS.some(sameAs)) { dataStart = 1; forcedShape = "tree"; }
  else if (FLOW_HEADERS.some(sameAs)) { dataStart = 1; forcedShape = "flowchart"; }
  const rows: DiagramRow[] = [];
  for (let i = dataStart; i < tokens.length; i++) {
    const t = tokens[i];
    if (t.length < 1) continue;
    const a = (t[0] ?? "").trim();
    const b = (t[1] ?? "").trim();
    if (!a) continue;
    // Self-loops have no useful semantics in tree or flowchart mode.
    if (a === b) continue;
    rows.push({ a, b });
  }
  if (rows.length === 0) return { shape: "unknown", rows: [], error: "No data rows found." };
  // Hard row-cap independent of byte-size: a 5MB CSV with 10-char rows
  // could still produce ~500k rows / 500k cards and freeze the canvas.
  // Reject with a helpful message before layout/render is attempted.
  if (rows.length > 1000) {
    return { shape: "unknown", rows: [], error: `Too many rows (${rows.length}, max 1000). Split into smaller imports.` };
  }
  // Single-column CSV: no parent/target info available, can't infer shape.
  if (!rows.some((r) => r.b)) {
    return { shape: "unknown", rows: [], error: "CSV needs a second column (parent or target)." };
  }
  const shape = forcedShape ?? detectShape(rows);
  // For tree shape: warn if any child has multiple parents — only the first
  // is used (parentOf dedupes), which would otherwise silently drop edges.
  let warning: string | undefined;
  if (shape === "tree") {
    const seenParents = new Map<string, Set<string>>();
    for (const r of rows) {
      if (!r.b) continue;
      if (!seenParents.has(r.a)) seenParents.set(r.a, new Set());
      seenParents.get(r.a)!.add(r.b);
    }
    for (const [child, parents] of Array.from(seenParents.entries())) {
      if (parents.size > 1) {
        warning = `Note: child "${child}" has multiple parents — only the first was used.`;
        break;
      }
    }
  }
  return warning ? { shape, rows, error: warning } : { shape, rows };
}

/**
 * Convert a parsed tree-shaped diagram into Cards + Connectors. Each
 * unique label becomes one Card; each row's b → a relationship becomes
 * a connector with arrowEnd. Uses `treeLayout` to position cards.
 *
 * Caller bumps z + appends to the board.
 */
export function diagramToObjects(
  boardId: string,
  parsed: ParsedDiagram,
  /** Top-left world origin where the diagram should land. */
  origin: { x: number; y: number },
): WhiteboardObject[] {
  if (parsed.rows.length === 0) return [];
  const now = new Date().toISOString();
  // De-duplicate labels — many CSVs list a child once per parent edge.
  const labels = new Set<string>();
  for (const r of parsed.rows) {
    labels.add(r.a);
    if (r.b) labels.add(r.b);
  }
  // Ids are per-import, not stable across imports: we salt every id with a
  // per-call epoch so two imports of the same CSV don't accidentally collide
  // with already-placed cards on the same board. (Trade-off: re-importing
  // the same CSV produces fresh cards rather than dedup-merging.)
  //
  // R5: two diagrams imported within the same millisecond shared the same
  // epoch → same labels → same ids → the second import OVERWROTE the first
  // via upsert. Append a short random suffix so concurrent same-ms calls
  // get distinct id spaces.
  const epoch = `${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 5)}`;
  const idFor = (label: string) =>
    `wb_${epoch}_${hashLabel(label)}`;

  const objects: WhiteboardObject[] = [];

  if (parsed.shape === "tree") {
    // Build parents map for treeLayout. Pick the FIRST parent we see
    // for any node — multi-parent shouldn't happen in tree mode (the
    // shape detector would have routed to flowchart) but we guard.
    const parentOf = new Map<string, string>();
    for (const r of parsed.rows) {
      if (!r.b) continue;
      if (!parentOf.has(r.a)) parentOf.set(r.a, r.b);
    }
    const labelsArr = Array.from(labels);
    const layoutNodes = labelsArr.map((l) => ({ id: idFor(l), w: CARD_W, h: CARD_H }));
    const parentsForLayout: Record<string, string | null> = {};
    for (const l of labelsArr) {
      const p = parentOf.get(l);
      parentsForLayout[idFor(l)] = p ? idFor(p) : null;
    }
    const positions = treeLayout(layoutNodes, parentsForLayout, { rowGap: ROW_GAP, colGap: COL_GAP });

    let zCursor = 1;
    for (const l of labelsArr) {
      const id = idFor(l);
      const pos = positions[id] ?? { x: 0, y: 0 };
      const card: WhiteboardCard = {
        id,
        boardId,
        type: "card",
        x: origin.x + pos.x,
        y: origin.y + pos.y,
        w: CARD_W,
        h: CARD_H,
        z: zCursor++,
        version: 1,
        title: l,
        color: "#00f0ff",
        createdAt: now,
        updatedAt: now,
      };
      objects.push(card as WhiteboardObject);
    }
    // Edges: parent → child connectors. arrowEnd points at the child.
    let edgeIdx = 0;
    for (const [child, parent] of Array.from(parentOf.entries())) {
      const connector: WhiteboardConnector = {
        id: `wbc_${epoch}_${edgeIdx++}_${hashLabel(parent + ">" + child)}`,
        boardId,
        type: "connector",
        x: 0, y: 0, w: 0, h: 0,
        z: zCursor++,
        version: 1,
        fromId: idFor(parent),
        toId: idFor(child),
        stroke: "#94a3b8",
        strokeWidth: 1.5,
        routing: "orthogonal",
        arrowEnd: true,
        createdAt: now,
        updatedAt: now,
      };
      objects.push(connector as WhiteboardObject);
    }
    return objects;
  }

  // Flowchart shape — force-layout the graph.
  const labelsArr2 = Array.from(labels);
  const layoutNodes = labelsArr2.map((l) => ({ id: idFor(l), w: CARD_W, h: CARD_H }));
  const layoutEdges = parsed.rows
    .filter((r) => r.b)
    .map((r) => ({ from: idFor(r.b), to: idFor(r.a) }));
  // Cap force-layout iterations based on node count — N=1000 × 100 iters
  // froze the tab. Tunes the work budget to ~8000 ops independent of N.
  const iters = Math.max(40, Math.min(100, Math.floor(8000 / Math.max(1, labelsArr2.length))));
  const positions = forceLayout(layoutNodes, layoutEdges, {
    width: Math.max(800, layoutNodes.length * 60),
    height: Math.max(600, layoutNodes.length * 40),
    iterations: iters,
  });
  let zCursor = 1;
  for (const l of labelsArr2) {
    const id = idFor(l);
    const pos = positions[id] ?? { x: 0, y: 0 };
    const card: WhiteboardCard = {
      id,
      boardId,
      type: "card",
      x: origin.x + pos.x,
      y: origin.y + pos.y,
      w: CARD_W,
      h: CARD_H,
      z: zCursor++,
      version: 1,
      title: l,
      color: "#a78bfa",
      createdAt: now,
      updatedAt: now,
    };
    objects.push(card as WhiteboardObject);
  }
  // Dedupe parallel/duplicate edges by (from, to) — id collision was silently
  // dropping them downstream. Per-edge index keeps connector ids unique even
  // if hashLabel happens to collide.
  const edgeKeys = new Set<string>();
  let edgeIdx = 0;
  for (const r of parsed.rows) {
    if (!r.b) continue;
    const key = idFor(r.b) + ">" + idFor(r.a);
    if (edgeKeys.has(key)) continue;
    edgeKeys.add(key);
    const connector: WhiteboardConnector = {
      id: `wbc_${epoch}_${edgeIdx++}_${hashLabel(r.b + ">" + r.a)}`,
      boardId,
      type: "connector",
      x: 0, y: 0, w: 0, h: 0,
      z: zCursor++,
      version: 1,
      fromId: idFor(r.b),
      toId: idFor(r.a),
      stroke: "#94a3b8",
      strokeWidth: 1.5,
      routing: "curved",
      arrowEnd: true,
      createdAt: now,
      updatedAt: now,
    };
    objects.push(connector as WhiteboardObject);
  }
  return objects;
}

/**
 * Deterministic short hash for a label — used to derive stable ids so
 * a repeated import doesn't endlessly accumulate duplicate cards.
 * djb2 variant, case-sensitive (proper names like "User" vs "user"
 * should NOT collide), truncated to 9 alphanumeric chars.
 */
function hashLabel(label: string): string {
  let h = 5381;
  for (let i = 0; i < label.length; i++) h = ((h << 5) + h + label.charCodeAt(i)) | 0;
  return Math.abs(h).toString(36).padStart(9, "0").slice(0, 9);
}
