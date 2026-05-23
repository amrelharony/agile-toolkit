"use client";

import { useCallback, type RefObject } from "react";
import { wbId } from "@/lib/whiteboard/clipboard";
import type { WhiteboardObject } from "@/lib/stores/workspace-types";
import type { CanvasTool } from "../use-canvas-store";
import { STICKY_DEFAULT, SHAPE_DEFAULT, TEXT_DEFAULT } from "../constants";
import { MIND_MAP_NODE_DEFAULT } from "@/lib/whiteboard/mind-map-layout";
import { DIAGRAM_SHAPE_DEFAULT, DIAGRAM_SHAPE_KINDS } from "../components/objects/diagram-shape";

/**
 * Click-to-create factory: spawns a tool-appropriate object at the
 * given world point with default size, centred on the click.
 *
 * Used for tools that don't support drag-to-create (kanban, timer,
 * voting — composite widgets whose proportions only make sense at
 * known sizes), and as the single-click branch for tools that DO
 * support drag (when the user clicks without dragging).
 *
 * After creating, the tool reverts to `select` so the user doesn't
 * keep spawning duplicates. Text-bearing objects (sticky / text /
 * card) auto-enter inline edit mode so users can type immediately
 * — without this, users complained "I can't type in stickies"
 * because they assumed creating one gave focus to it.
 *
 * `topZRef.current` is read directly so this stays O(1) — previously
 * a full `nextZAbove(objects)` scan ran on every click, which got
 * hot when stamping rows of widgets quickly.
 */
export function useAddObjectAt(params: {
  boardId: string;
  stickyColor: string;
  tool: CanvasTool;
  topZRef: RefObject<number>;
  pickedDiagramShape: string;
  upsert: (obj: WhiteboardObject) => void;
  setTool: (t: CanvasTool) => void;
  setSelection: (ids: string[]) => void;
  setEditingObjectId: (id: string | null) => void;
  logActivity: (kind: string, summary: string) => void;
}) {
  const {
    boardId, stickyColor, tool, topZRef, pickedDiagramShape,
    upsert, setTool, setSelection, setEditingObjectId, logActivity,
  } = params;

  return useCallback(
    (worldX: number, worldY: number) => {
      const id = wbId("wb");
      const now = new Date().toISOString();
      const base = { id, boardId, version: 1, z: (topZRef.current ?? 0) + 1, createdAt: now, updatedAt: now };
      let obj: WhiteboardObject | null = null;
      switch (tool) {
        case "sticky":
          obj = {
            ...base, type: "sticky",
            x: worldX - STICKY_DEFAULT.w / 2,
            y: worldY - STICKY_DEFAULT.h / 2,
            w: STICKY_DEFAULT.w, h: STICKY_DEFAULT.h,
            content: "", color: stickyColor,
          };
          break;
        case "rect":
        case "ellipse":
        case "diamond":
        case "triangle":
          obj = {
            ...base, type: tool,
            x: worldX - SHAPE_DEFAULT.w / 2,
            y: worldY - SHAPE_DEFAULT.h / 2,
            w: SHAPE_DEFAULT.w, h: SHAPE_DEFAULT.h,
            stroke: "#94a3b8", strokeWidth: 1.5,
            // Soft translucent fill so the shape has visual presence
            // when created. Previously shapes shipped as a thin gray
            // outline only — visually indistinguishable from background
            // grid lines on a dark theme, and easy to lose-track-of in
            // a busy board. The 12% alpha keeps it subtle so it
            // doesn't compete with stickies or filled shapes the user
            // explicitly colours.
            fill: "rgba(148, 163, 184, 0.12)",
          };
          break;
        case "text":
          obj = {
            ...base, type: "text",
            x: worldX - TEXT_DEFAULT.w / 2,
            y: worldY,
            w: TEXT_DEFAULT.w, h: TEXT_DEFAULT.h,
            content: "Text", fontSize: 18, color: "#e5e7eb", align: "left",
          };
          break;
        case "frame":
          obj = {
            ...base, type: "frame",
            x: worldX - 320, y: worldY - 200,
            w: 640, h: 400,
            label: "Frame",
          };
          break;
        case "card":
          obj = {
            ...base, type: "card",
            x: worldX - 100, y: worldY - 60,
            w: 200, h: 120,
            title: "New card",
            color: "#00f0ff",
          };
          break;
        case "kanban":
          obj = {
            ...base, type: "kanban",
            x: worldX - 360, y: worldY - 200,
            w: 720, h: 400,
            label: "Kanban",
            columns: ["todo", "in_progress", "done"],
            columnLabels: ["To Do", "In Progress", "Done"],
          };
          break;
        case "timer":
          obj = {
            ...base, type: "timer",
            x: worldX - 70, y: worldY - 50,
            w: 140, h: 100,
            durationSec: 300, // 5-minute default
            running: false,
            remainingSec: 300,
            label: "Timer",
          };
          break;
        case "voting":
          obj = {
            ...base, type: "voting",
            x: worldX - 140, y: worldY - 90,
            w: 280, h: 180,
            question: "How would you estimate this?",
            options: ["1", "2", "3", "5", "8", "13", "?", "☕"],
            votes: {},
            revealed: false,
          };
          break;
        case "table":
          // 3-column × 3-row starter (header + 2 data rows). Empty
          // cells are fine — double-clicking starts editing.
          obj = {
            ...base, type: "table",
            x: worldX - 240, y: worldY - 60,
            w: 480, h: 120,
            rows: [
              ["Column A", "Column B", "Column C"],
              ["", "", ""],
              ["", "", ""],
            ],
            headerRow: true,
          };
          break;
        case "diagramShape": {
          // Use whatever kind the user picked in the diagram-shape
          // palette. Fall back to "database" if the picker hasn't
          // run yet (first-time tool selection).
          const kind = DIAGRAM_SHAPE_KINDS[pickedDiagramShape] ? pickedDiagramShape : "database";
          obj = {
            ...base, type: "diagramShape",
            x: worldX - DIAGRAM_SHAPE_DEFAULT.w / 2,
            y: worldY - DIAGRAM_SHAPE_DEFAULT.h / 2,
            w: DIAGRAM_SHAPE_DEFAULT.w,
            h: DIAGRAM_SHAPE_DEFAULT.h,
            kind,
            label: "",
          };
          break;
        }
        case "mindMap": {
          // Creates JUST a root node — Tab/Enter from the keyboard
          // hook adds descendants. The mindMapId groups the tree
          // for layout; using the root's id keeps the value stable
          // even if the user later reparents.
          const mindMapId = id;
          obj = {
            ...base, type: "mindMapNode",
            x: worldX - MIND_MAP_NODE_DEFAULT.w / 2,
            y: worldY - MIND_MAP_NODE_DEFAULT.h / 2,
            w: MIND_MAP_NODE_DEFAULT.w,
            h: MIND_MAP_NODE_DEFAULT.h,
            text: "",
            mindMapId,
          };
          break;
        }
        default:
          break;
      }
      if (obj) {
        upsert(obj);
        logActivity("added", `Created ${obj.type}`);
        // Revert to select so we don't keep spawning more.
        setTool("select");
        // Auto-enter edit mode for text-bearing objects so the user
        // can type immediately after creation (Miro/Figma convention).
        if (obj.type === "sticky" || obj.type === "text" || obj.type === "card" || obj.type === "mindMapNode") {
          setSelection([obj.id]);
          setEditingObjectId(obj.id);
        }
      }
    },
    // `topZRef` is identity-stable; reading `.current` doesn't need it
    // in deps but include it so react-hooks/exhaustive-deps doesn't
    // grumble about the destructured-ref access.
    [boardId, stickyColor, tool, upsert, setTool, setSelection, setEditingObjectId, logActivity, topZRef, pickedDiagramShape],
  );
}
