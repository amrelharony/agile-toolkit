/**
 * Minimal, valid WhiteboardObject fixtures per kind for the object-renderer
 * render-characterization tests. NOT a test file (no `.test` suffix) — it's a
 * shared builder module imported by the suites.
 *
 * Each builder returns a representative object with sensible required fields so
 * `<ObjectRenderer>` can render it read-only. Override anything via `extra`.
 */

import type {
  WhiteboardObjectBase,
  WhiteboardSticky,
  WhiteboardShape,
  WhiteboardText,
  WhiteboardFreehand,
  WhiteboardImage,
  WhiteboardFrame,
  WhiteboardEmbed,
  WhiteboardLine,
  WhiteboardKanbanFrame,
  WhiteboardTimer,
  WhiteboardVoting,
  WhiteboardCard,
  WhiteboardTable,
  WhiteboardMindMapNode,
  WhiteboardDiagramShape,
  WhiteboardObjectKind,
} from "@/lib/stores/workspace-types";

let seq = 0;

function base(type: WhiteboardObjectKind): WhiteboardObjectBase {
  seq += 1;
  return {
    id: `obj-${type}-${seq}`,
    boardId: "board-1",
    type,
    x: 100,
    y: 80,
    w: 200,
    h: 160,
    z: 1,
    version: 1,
    updatedAt: "2026-01-01T00:00:00.000Z",
    createdAt: "2026-01-01T00:00:00.000Z",
  };
}

export const stickyFixture = (extra: Partial<WhiteboardSticky> = {}): WhiteboardSticky => ({
  ...base("sticky"),
  type: "sticky",
  content: "Hello sticky",
  color: "#ffd166",
  ...extra,
});

export const shapeFixture = (
  type: WhiteboardShape["type"] = "rect",
  extra: Partial<WhiteboardShape> = {}
): WhiteboardShape => ({
  ...base(type),
  type,
  fill: "#1e293b",
  stroke: "#94a3b8",
  strokeWidth: 2,
  ...extra,
});

export const textFixture = (extra: Partial<WhiteboardText> = {}): WhiteboardText => ({
  ...base("text"),
  type: "text",
  content: "Some text",
  fontSize: 18,
  color: "#e2e8f0",
  ...extra,
});

export const frameFixture = (extra: Partial<WhiteboardFrame> = {}): WhiteboardFrame => ({
  ...base("frame"),
  type: "frame",
  label: "Frame label",
  ...extra,
});

export const lineFixture = (
  type: WhiteboardLine["type"] = "arrow",
  extra: Partial<WhiteboardLine> = {}
): WhiteboardLine => ({
  ...base(type),
  type,
  stroke: "#00f0ff",
  strokeWidth: 2,
  ...extra,
});

export const freehandFixture = (extra: Partial<WhiteboardFreehand> = {}): WhiteboardFreehand => ({
  ...base("freehand"),
  type: "freehand",
  points: [0, 0, 10, 10, 20, 5, 30, 25],
  stroke: "#ff00aa",
  strokeWidth: 3,
  ...extra,
});

export const imageFixture = (extra: Partial<WhiteboardImage> = {}): WhiteboardImage => ({
  ...base("image"),
  type: "image",
  src: "https://cdn.example.com/pic.png",
  alt: "a picture",
  ...extra,
});

export const embedFixture = (extra: Partial<WhiteboardEmbed> = {}): WhiteboardEmbed => ({
  ...base("embed"),
  type: "embed",
  src: "https://www.youtube.com/watch?v=dQw4w9WgXcQ",
  kind: "youtube",
  ...extra,
});

export const kanbanFixture = (
  extra: Partial<WhiteboardKanbanFrame> = {}
): WhiteboardKanbanFrame => ({
  ...base("kanban"),
  type: "kanban",
  label: "Sprint board",
  columns: ["todo", "doing", "done"],
  ...extra,
});

export const timerFixture = (extra: Partial<WhiteboardTimer> = {}): WhiteboardTimer => ({
  ...base("timer"),
  type: "timer",
  durationSec: 300,
  running: false,
  ...extra,
});

export const votingFixture = (extra: Partial<WhiteboardVoting> = {}): WhiteboardVoting => ({
  ...base("voting"),
  type: "voting",
  question: "Estimate?",
  votes: {},
  options: ["1", "2", "3", "5", "8"],
  revealed: false,
  ...extra,
});

export const cardFixture = (extra: Partial<WhiteboardCard> = {}): WhiteboardCard => ({
  ...base("card"),
  type: "card",
  title: "Card title",
  ...extra,
});

export const tableFixture = (extra: Partial<WhiteboardTable> = {}): WhiteboardTable => ({
  ...base("table"),
  type: "table",
  rows: [
    ["A", "B"],
    ["1", "2"],
  ],
  ...extra,
});

export const mindMapNodeFixture = (
  extra: Partial<WhiteboardMindMapNode> = {}
): WhiteboardMindMapNode => ({
  ...base("mindMapNode"),
  type: "mindMapNode",
  text: "Idea",
  mindMapId: "mm-1",
  ...extra,
});

export const diagramShapeFixture = (
  extra: Partial<WhiteboardDiagramShape> = {}
): WhiteboardDiagramShape => ({
  ...base("diagramShape"),
  type: "diagramShape",
  kind: "database",
  label: "DB",
  ...extra,
});
