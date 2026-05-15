/**
 * Built-in board templates.
 *
 * Each template returns a fresh array of {@link WhiteboardObject}s ready
 * to seed a new board. `boardId` is filled in at the seeding site so the
 * objects attach to the right board.
 *
 * Coordinates are sized so the resulting layout fits in a 1600×1000 area
 * (the default zoom-to-fit at canvas mount sees the whole template).
 */

import type {
  WhiteboardObject,
  WhiteboardSticky,
  WhiteboardShape,
  WhiteboardText,
  WhiteboardFrame,
} from "@/lib/stores/workspace-types";

export const STICKY_PALETTE = [
  "#fde68a", // amber
  "#bef264", // lime
  "#a5f3fc", // cyan
  "#fbcfe8", // pink
  "#c4b5fd", // violet
  "#fca5a5", // red
] as const;

export interface TemplateDef {
  id: string;
  name: string;
  description: string;
  /** Build the objects for a fresh board. Returns objects without `boardId`
   * — the seeder fills that in along with version/timestamps. */
  build: () => Omit<WhiteboardObject, "boardId">[];
}

let zCursor = 1;
const z = () => zCursor++;
const now = () => new Date().toISOString();
const id = () => `wb_${Math.random().toString(36).slice(2, 11)}`;

function sticky(
  x: number, y: number, content: string,
  color: string = STICKY_PALETTE[0],
  w = 200, h = 160,
): Omit<WhiteboardSticky, "boardId"> {
  return {
    id: id(),
    type: "sticky",
    x, y, w, h, z: z(),
    content,
    color,
    version: 1,
    updatedAt: now(),
    createdAt: now(),
  };
}

function frame(
  x: number, y: number, w: number, h: number, label: string, fill?: string,
): Omit<WhiteboardFrame, "boardId"> {
  return {
    id: id(),
    type: "frame",
    x, y, w, h, z: z(),
    label,
    fill,
    version: 1,
    updatedAt: now(),
    createdAt: now(),
  };
}

function text(
  x: number, y: number, content: string,
  fontSize = 24, color = "#e5e7eb", w = 400, h = 40,
): Omit<WhiteboardText, "boardId"> {
  return {
    id: id(),
    type: "text",
    x, y, w, h, z: z(),
    content,
    fontSize,
    color,
    align: "center",
    version: 1,
    updatedAt: now(),
    createdAt: now(),
  };
}

function rect(
  x: number, y: number, w: number, h: number,
  fill?: string, stroke = "#475569", strokeWidth = 1, content?: string,
): Omit<WhiteboardShape, "boardId"> {
  return {
    id: id(),
    type: "rect",
    x, y, w, h, z: z(),
    fill,
    stroke,
    strokeWidth,
    content,
    version: 1,
    updatedAt: now(),
    createdAt: now(),
  };
}

/* ─── Templates ─────────────────────────────────────────────────────── */

export const TEMPLATES: TemplateDef[] = [
  {
    id: "blank",
    name: "Blank",
    description: "Empty canvas — start from scratch.",
    build: () => [],
  },
  {
    id: "mind-map",
    name: "Mind Map",
    description: "Central topic with 6 radial branches.",
    build: () => {
      zCursor = 1;
      const out: Omit<WhiteboardObject, "boardId">[] = [];
      const cx = 800;
      const cy = 500;
      out.push(sticky(cx - 120, cy - 60, "Central topic", STICKY_PALETTE[2], 240, 120));
      const radius = 280;
      for (let i = 0; i < 6; i++) {
        const a = (i / 6) * Math.PI * 2 - Math.PI / 2;
        out.push(sticky(
          cx + Math.cos(a) * radius - 90,
          cy + Math.sin(a) * radius - 60,
          `Branch ${i + 1}`,
          STICKY_PALETTE[(i + 1) % STICKY_PALETTE.length],
          180, 120,
        ));
      }
      return out;
    },
  },
  {
    id: "journey-map",
    name: "Customer Journey",
    description: "5 stages × 5 lanes (Action, Touchpoint, Thinking, Feeling, Opportunity).",
    build: () => {
      zCursor = 1;
      const out: Omit<WhiteboardObject, "boardId">[] = [];
      const colW = 240;
      const rowH = 140;
      const cols = ["Awareness", "Consideration", "Purchase", "Use", "Advocacy"];
      const rows = ["Action", "Touchpoint", "Thinking", "Feeling", "Opportunity"];
      // Header row
      cols.forEach((c, i) => out.push(text(40 + 160 + i * colW, 40, c, 18)));
      // Lane labels + frames
      rows.forEach((r, j) => {
        out.push(text(20, 100 + 80 + j * rowH, r, 16, "#94a3b8", 140, 32));
        out.push(frame(160, 100 + j * rowH, cols.length * colW, rowH, r, "#1e293b22"));
      });
      return out;
    },
  },
  {
    id: "retro-4-corner",
    name: "Retrospective (Mad/Sad/Glad/Action)",
    description: "Classic 4-corner retro frames.",
    build: () => {
      zCursor = 1;
      const out: Omit<WhiteboardObject, "boardId">[] = [];
      const w = 640, h = 400;
      out.push(text(120, 20, "Retrospective", 28));
      const labels: [string, string][] = [
        ["Mad", "#fca5a5"],
        ["Sad", "#fbcfe8"],
        ["Glad", "#bef264"],
        ["Action", "#a5f3fc"],
      ];
      labels.forEach((l, i) => {
        const col = i % 2;
        const row = Math.floor(i / 2);
        out.push(frame(80 + col * (w + 40), 80 + row * (h + 40), w, h, l[0], l[1] + "33"));
      });
      return out;
    },
  },
  {
    id: "ecrs",
    name: "ECRS",
    description: "Eliminate · Combine · Rearrange · Simplify quadrants.",
    build: () => {
      zCursor = 1;
      const out: Omit<WhiteboardObject, "boardId">[] = [];
      const w = 600, h = 360;
      const labels = ["Eliminate", "Combine", "Rearrange", "Simplify"];
      labels.forEach((l, i) => {
        const col = i % 2;
        const row = Math.floor(i / 2);
        out.push(frame(60 + col * (w + 40), 60 + row * (h + 40), w, h, l, "#1e293b22"));
      });
      return out;
    },
  },
  {
    id: "scamper",
    name: "SCAMPER",
    description: "7 stickies: Substitute / Combine / Adapt / Modify / Put-to-use / Eliminate / Reverse.",
    build: () => {
      zCursor = 1;
      const out: Omit<WhiteboardObject, "boardId">[] = [];
      const labels = ["Substitute", "Combine", "Adapt", "Modify", "Put to use", "Eliminate", "Reverse"];
      labels.forEach((l, i) => {
        out.push(sticky(60 + (i % 4) * 240, 60 + Math.floor(i / 4) * 220, l, STICKY_PALETTE[i % STICKY_PALETTE.length], 220, 200));
      });
      return out;
    },
  },
  {
    id: "swimlane",
    name: "Swimlane",
    description: "5 vertical lanes × 4 horizontal stages.",
    build: () => {
      zCursor = 1;
      const out: Omit<WhiteboardObject, "boardId">[] = [];
      const lanes = ["Lane A", "Lane B", "Lane C", "Lane D", "Lane E"];
      const stages = ["To do", "In progress", "Review", "Done"];
      const laneW = 240;
      const stageH = 180;
      stages.forEach((s, j) => out.push(text(20, 120 + j * stageH, s, 14, "#94a3b8", 140, 28)));
      lanes.forEach((l, i) => {
        out.push(text(180 + i * laneW, 40, l, 16, "#e5e7eb", laneW - 20, 32));
        stages.forEach((_, j) => {
          out.push(frame(180 + i * laneW, 100 + j * stageH, laneW - 20, stageH - 20, "", "#1e293b22"));
        });
      });
      return out;
    },
  },
  {
    id: "risk-matrix",
    name: "P × I Risk Matrix (5 × 5)",
    description: "Probability × Impact grid with low / med / high color bands.",
    build: () => {
      zCursor = 1;
      const out: Omit<WhiteboardObject, "boardId">[] = [];
      const cell = 140;
      // Axis labels
      out.push(text(60, 60, "Probability →", 14, "#94a3b8", 160, 24));
      out.push(text(60, 100, "↑ Impact", 14, "#94a3b8", 160, 24));
      // Grid cells colored by risk magnitude.
      for (let p = 0; p < 5; p++) {
        for (let i = 0; i < 5; i++) {
          const score = (p + 1) * (5 - i);
          const fill =
            score >= 15 ? "#ef444433" :
            score >= 8 ? "#f59e0b33" :
            "#10b98133";
          out.push(rect(200 + p * cell, 60 + i * cell, cell - 4, cell - 4, fill, "#475569", 1));
        }
      }
      return out;
    },
  },
  {
    id: "empathy-map",
    name: "Empathy Map",
    description: "Says / Thinks / Does / Feels around Pains + Gains.",
    build: () => {
      zCursor = 1;
      const out: Omit<WhiteboardObject, "boardId">[] = [];
      out.push(text(560, 20, "Empathy Map", 24));
      const quads: [string, number, number][] = [
        ["Says",   100,  80],
        ["Thinks", 700,  80],
        ["Does",   100, 460],
        ["Feels",  700, 460],
      ];
      quads.forEach(([label, x, y]) =>
        out.push(frame(x, y, 560, 340, label, "#1e293b22"))
      );
      out.push(frame(380, 280, 600, 220, "Pains + Gains", "#7c3aed22"));
      return out;
    },
  },
  {
    id: "lean-canvas",
    name: "Lean Canvas",
    description: "Ash Maurya's 9-block one-page business plan.",
    build: () => buildNineBlockCanvas([
      "Problem", "Solution", "Unique Value Prop", "Unfair Advantage", "Customer Segments",
      "Key Metrics", "Channels", "Cost Structure", "Revenue Streams",
    ]),
  },
  {
    id: "business-model",
    name: "Business Model Canvas",
    description: "Osterwalder's 9-block strategic canvas.",
    build: () => buildNineBlockCanvas([
      "Key Partners", "Key Activities", "Value Propositions", "Customer Relationships", "Customer Segments",
      "Key Resources", "Channels", "Cost Structure", "Revenue Streams",
    ]),
  },
];

function buildNineBlockCanvas(labels: string[]): Omit<WhiteboardObject, "boardId">[] {
  zCursor = 1;
  const out: Omit<WhiteboardObject, "boardId">[] = [];
  const w = 280, h = 220, gap = 8;
  // Lean Canvas / BMC layout:
  //   Columns 0/2/4 (Problem, UVP, Customer Segments) are tall — they span
  //   both rows of the top half (height = 2h + gap).
  //   Columns 1/3 (Solution, Unfair Advantage) are half-height on top with
  //   blocks 5/6 (Key Metrics, Channels) stacked directly below them.
  //   Bottom row (Cost Structure, Revenue Streams) is two equal-width
  //   blocks spanning the full canvas width.
  // Block indices match the labels array order in the Lean Canvas and BMC
  // builders above.
  const positions: [number, number, number, number][] = [
    [0, 0, w, h * 2 + gap],                                          // 0 — top-left tall
    [w + gap, 0, w, h],                                              // 1 — top, col 2 half
    [(w + gap) * 2, 0, w, h * 2 + gap],                              // 2 — top, col 3 tall
    [(w + gap) * 3, 0, w, h],                                        // 3 — top, col 4 half
    [(w + gap) * 4, 0, w, h * 2 + gap],                              // 4 — top-right tall
    [w + gap, h + gap, w, h],                                        // 5 — under col 2
    [(w + gap) * 3, h + gap, w, h],                                  // 6 — under col 4
    [0, (h + gap) * 2, (w + gap) * 2.5 - gap, h],                    // 7 — bottom-left wide
    [(w + gap) * 2.5, (h + gap) * 2, (w + gap) * 2.5 - gap, h],      // 8 — bottom-right wide
  ];
  positions.forEach(([x, y, fw, fh], i) =>
    out.push(frame(40 + x, 40 + y, fw, fh, labels[i] ?? `Block ${i + 1}`, "#1e293b22"))
  );
  return out;
}

export function getTemplate(id: string): TemplateDef | undefined {
  return TEMPLATES.find((t) => t.id === id);
}
