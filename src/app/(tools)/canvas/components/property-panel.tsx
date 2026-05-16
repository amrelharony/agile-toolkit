"use client";

/**
 * Floating property panel — Miro/Figma-style contextual property bar.
 *
 * Anchored above the selection bbox (in screen space); auto-positions
 * below the selection when there's no room above. Visible only when:
 *   - selection.length >= 1
 *   - tool === "select"
 *   - no in-flight drag/resize/marquee
 *
 * Shows different controls per selection type, with a "common
 * denominator" set for mixed selections. Every change emits a single
 * upsertMany with version-bumped objects so realtime peers see the
 * update immediately.
 *
 * What's editable per type:
 *   sticky    → color, textColor, fontSize, fontFamily
 *   shape     → fill, stroke, strokeWidth, dashed, contentColor, fontFamily
 *   text      → color, fontSize, fontWeight, align, fontFamily
 *   line/arrow→ stroke, strokeWidth, dashed
 *   connector → stroke, strokeWidth, dashed, routing, arrowStart, arrowEnd
 *   freehand  → stroke, strokeWidth
 *   frame     → fill (label edited via inline-edit)
 *   image     → fit
 *   embed     → (read-only)
 */

import { memo } from "react";
import {
  Bold, AlignLeft, AlignCenter, AlignRight,
  Minus, MoveRight, MoveLeft, ArrowRightCircle,
} from "lucide-react";
import type { Camera, Rect } from "@/lib/geometry/bbox";
import type {
  WhiteboardObject,
  WhiteboardSticky,
  WhiteboardShape,
  WhiteboardText,
  WhiteboardLine,
  WhiteboardConnector,
  WhiteboardFreehand,
  WhiteboardFrame,
  WhiteboardCard,
  WhiteboardTimer,
  WhiteboardVoting,
  WhiteboardKanbanFrame,
  ConnectorRouting,
} from "@/lib/stores/workspace-types";

interface PropertyPanelProps {
  selection: readonly WhiteboardObject[];
  selectionBbox: Rect;
  camera: Camera;
  viewportHeight: number;
  /** Patch the styles of one or more objects. Caller bumps version +
   * upserts. Each entry is a partial of the object that's merged on top
   * of the existing one. */
  onPatch: (updates: { id: string; patch: Partial<WhiteboardObject> }[]) => void;
}

/** Sticky palette — matches templates.ts STICKY_PALETTE. */
const STICKY_COLORS = ["#fde68a", "#fca5a5", "#bef264", "#a5f3fc", "#fbcfe8", "#c4b5fd"];
/** Stroke + fill palette for shapes / text / freehand. */
const PAINT_COLORS = [
  "#e5e7eb", "#94a3b8", "#0b0f17",
  "#00f0ff", "#a78bfa", "#34d399",
  "#f59e0b", "#f87171", "#60a5fa",
];
/** Sans-first font picker — three options is enough to avoid a
 * dropdown library while still giving users an escape hatch from the
 * default. */
const FONT_FAMILIES: { label: string; value: string | undefined }[] = [
  { label: "Sans", value: undefined },
  { label: "Serif", value: "ui-serif, Georgia, serif" },
  { label: "Mono", value: "ui-monospace, SFMono-Regular, monospace" },
];
const FONT_SIZES = [10, 12, 14, 16, 20, 28, 40];
const STROKE_WIDTHS = [1, 2, 4, 6];

/** Project a world rect to the screen-anchor point for the panel. */
function anchorScreenY(bbox: Rect, camera: Camera, viewportHeight: number): { top: number; below: boolean } {
  const top = (bbox.y - camera.y) * camera.zoom;
  // 56 px = panel height + margin. If above-the-bbox doesn't fit,
  // render below instead.
  const above = top - 56;
  if (above >= 8) return { top: above, below: false };
  const below = top + bbox.h * camera.zoom + 8;
  if (below + 56 <= viewportHeight) return { top: below, below: true };
  // Last-resort: clamp to viewport top.
  return { top: 8, below: false };
}

function PropertyPanelImpl({ selection, selectionBbox, camera, viewportHeight, onPatch }: PropertyPanelProps) {
  if (selection.length === 0) return null;

  // Project to screen position.
  const screenLeft = (selectionBbox.x - camera.x) * camera.zoom + (selectionBbox.w * camera.zoom) / 2;
  const { top: screenTop } = anchorScreenY(selectionBbox, camera, viewportHeight);

  // Compute which control sets to show based on type uniformity.
  const types = new Set(selection.map((o) => o.type));
  const allOfType = (t: WhiteboardObject["type"]) => types.size === 1 && types.has(t);

  const stickies = selection.filter((o): o is WhiteboardSticky => o.type === "sticky");
  const shapes = selection.filter((o): o is WhiteboardShape =>
    o.type === "rect" || o.type === "ellipse" || o.type === "diamond" || o.type === "triangle");
  const texts = selection.filter((o): o is WhiteboardText => o.type === "text");
  const lines = selection.filter((o): o is WhiteboardLine => o.type === "line" || o.type === "arrow");
  const connectors = selection.filter((o): o is WhiteboardConnector => o.type === "connector");
  const freehands = selection.filter((o): o is WhiteboardFreehand => o.type === "freehand");
  const frames = selection.filter((o): o is WhiteboardFrame => o.type === "frame");
  // Phase 25-26 new types — single-edit only (no bulk apply for these).
  const cards = selection.filter((o): o is WhiteboardCard => o.type === "card");
  const timers = selection.filter((o): o is WhiteboardTimer => o.type === "timer");
  const votings = selection.filter((o): o is WhiteboardVoting => o.type === "voting");
  const kanbans = selection.filter((o): o is WhiteboardKanbanFrame => o.type === "kanban");

  /** Apply the same patch to every object in `targets`. */
  const patchAll = <T extends WhiteboardObject>(
    targets: readonly T[],
    patch: Partial<T>,
  ) => {
    if (targets.length === 0) return;
    onPatch(targets.map((o) => ({ id: o.id, patch: patch as Partial<WhiteboardObject> })));
  };

  return (
    <div
      role="toolbar"
      aria-label="Object properties"
      data-canvas-export-ignore="true"
      style={{
        position: "absolute",
        left: screenLeft,
        top: screenTop,
        transform: "translateX(-50%)",
        zIndex: 9997,
      }}
      className="flex items-center gap-1 bg-surface/95 border border-border rounded-lg px-2 py-1 shadow-lg backdrop-blur-sm flex-wrap max-w-[680px]"
    >
      {/* ─── Sticky color (palette swatches) ─────────────────── */}
      {stickies.length > 0 && (
        <div className="flex items-center gap-0.5" aria-label="Sticky color">
          {STICKY_COLORS.map((c) => (
            <button
              key={c}
              type="button"
              aria-label={`Set color ${c}`}
              title={c}
              onClick={() => patchAll(stickies, { color: c } as Partial<WhiteboardSticky>)}
              className="w-5 h-5 rounded border border-black/30 hover:scale-110 transition-transform"
              style={{ background: c }}
            />
          ))}
          <div className="w-px h-5 bg-border mx-1" />
        </div>
      )}

      {/* ─── Shape fill + stroke ─────────────────── */}
      {shapes.length > 0 && (
        <>
          <PaletteRow
            label="Fill"
            colors={[...PAINT_COLORS, "transparent"]}
            onPick={(c) => patchAll(shapes, { fill: c === "transparent" ? undefined : c } as Partial<WhiteboardShape>)}
          />
          <PaletteRow
            label="Stroke"
            colors={PAINT_COLORS}
            onPick={(c) => patchAll(shapes, { stroke: c } as Partial<WhiteboardShape>)}
          />
        </>
      )}

      {/* ─── Line / arrow / freehand / connector: stroke color + width + dashed ─────────────────── */}
      {(lines.length > 0 || connectors.length > 0 || freehands.length > 0) && (
        <PaletteRow
          label="Stroke"
          colors={PAINT_COLORS}
          onPick={(c) => {
            if (lines.length > 0) patchAll(lines, { stroke: c } as Partial<WhiteboardLine>);
            if (connectors.length > 0) patchAll(connectors, { stroke: c } as Partial<WhiteboardConnector>);
            if (freehands.length > 0) patchAll(freehands, { stroke: c } as Partial<WhiteboardFreehand>);
          }}
        />
      )}

      {/* ─── Stroke width ─────────────────── */}
      {(shapes.length > 0 || lines.length > 0 || connectors.length > 0 || freehands.length > 0) && (
        <div className="flex items-center gap-0.5" aria-label="Stroke width">
          {STROKE_WIDTHS.map((w) => (
            <button
              key={w}
              type="button"
              aria-label={`Stroke width ${w}`}
              title={`${w}px`}
              onClick={() => {
                if (shapes.length > 0) patchAll(shapes, { strokeWidth: w } as Partial<WhiteboardShape>);
                if (lines.length > 0) patchAll(lines, { strokeWidth: w } as Partial<WhiteboardLine>);
                if (connectors.length > 0) patchAll(connectors, { strokeWidth: w } as Partial<WhiteboardConnector>);
                if (freehands.length > 0) patchAll(freehands, { strokeWidth: w } as Partial<WhiteboardFreehand>);
              }}
              className="w-6 h-6 rounded flex items-center justify-center text-sub hover:text-text hover:bg-surface-deep transition-colors"
            >
              <div style={{ width: 14, height: w, background: "currentColor", borderRadius: w / 2 }} />
            </button>
          ))}
          <div className="w-px h-5 bg-border mx-1" />
        </div>
      )}

      {/* ─── Dashed toggle (lines / arrows / connectors / shapes) ──── */}
      {(lines.length > 0 || connectors.length > 0 || shapes.length > 0) && (
        <button
          type="button"
          aria-label="Toggle dashed stroke"
          title="Dashed"
          onClick={() => {
            // Per-object toggle so mixed selections preserve individual
            // dashed state rather than being homogenised to the first
            // object's inverse.
            const entries: { id: string; patch: Partial<WhiteboardObject> }[] = [];
            for (const c of lines) entries.push({ id: c.id, patch: { dashed: !c.dashed } as Partial<WhiteboardObject> });
            for (const c of connectors) entries.push({ id: c.id, patch: { dashed: !c.dashed } as Partial<WhiteboardObject> });
            for (const c of shapes) entries.push({ id: c.id, patch: { dashed: !c.dashed } as Partial<WhiteboardObject> });
            onPatch(entries);
          }}
          className="w-7 h-7 rounded flex items-center justify-center text-sub hover:text-text hover:bg-surface-deep transition-colors"
        >
          <Minus className="w-4 h-4" style={{ strokeDasharray: "3 2" }} aria-hidden="true" />
        </button>
      )}

      {/* ─── Connector routing + arrowheads ─────────────────── */}
      {connectors.length > 0 && (
        <div className="flex items-center gap-0.5" aria-label="Connector options">
          <div className="w-px h-5 bg-border mx-1" />
          {(["straight", "orthogonal", "curved"] as ConnectorRouting[]).map((r) => (
            <button
              key={r}
              type="button"
              aria-label={`Routing ${r}`}
              title={r}
              onClick={() => patchAll(connectors, { routing: r } as Partial<WhiteboardConnector>)}
              className="text-[10px] uppercase font-mono px-1.5 py-1 rounded text-sub hover:text-text hover:bg-surface-deep"
            >
              {r[0]}
            </button>
          ))}
          <button
            type="button"
            aria-label="Toggle arrow start"
            title="Arrow start"
            onClick={() => {
              // Per-object toggle: each connector flips its OWN
              // arrowStart so a mixed selection toggles each
              // independently. Previous behaviour was to read the
              // first connector's value and apply its inverse to all
              // (homogenising the selection unexpectedly).
              onPatch(connectors.map((c) => ({
                id: c.id,
                patch: { arrowStart: !c.arrowStart } as Partial<WhiteboardObject>,
              })));
            }}
            className="w-6 h-6 rounded flex items-center justify-center text-sub hover:text-text hover:bg-surface-deep"
          >
            <MoveLeft className="w-3.5 h-3.5" aria-hidden="true" />
          </button>
          <button
            type="button"
            aria-label="Toggle arrow end"
            title="Arrow end"
            onClick={() => {
              onPatch(connectors.map((c) => ({
                id: c.id,
                patch: { arrowEnd: !c.arrowEnd } as Partial<WhiteboardObject>,
              })));
            }}
            className="w-6 h-6 rounded flex items-center justify-center text-sub hover:text-text hover:bg-surface-deep"
          >
            <MoveRight className="w-3.5 h-3.5" aria-hidden="true" />
          </button>
        </div>
      )}

      {/* ─── Text color ─────────────────── */}
      {texts.length > 0 && (
        <PaletteRow
          label="Color"
          colors={PAINT_COLORS}
          onPick={(c) => patchAll(texts, { color: c } as Partial<WhiteboardText>)}
        />
      )}
      {stickies.length > 0 && (
        <PaletteRow
          label="Text"
          colors={PAINT_COLORS}
          onPick={(c) => patchAll(stickies, { textColor: c } as Partial<WhiteboardSticky>)}
        />
      )}

      {/* ─── Font size ─────────────────── */}
      {(stickies.length > 0 || texts.length > 0) && (
        <div className="flex items-center gap-0.5" aria-label="Font size">
          {FONT_SIZES.map((s) => (
            <button
              key={s}
              type="button"
              aria-label={`Font size ${s}`}
              title={`${s}px`}
              onClick={() => {
                if (stickies.length > 0) patchAll(stickies, { fontSize: s } as Partial<WhiteboardSticky>);
                if (texts.length > 0) patchAll(texts, { fontSize: s } as Partial<WhiteboardText>);
              }}
              className="px-1.5 py-1 rounded text-[10px] font-mono text-sub hover:text-text hover:bg-surface-deep transition-colors"
            >
              {s}
            </button>
          ))}
          <div className="w-px h-5 bg-border mx-1" />
        </div>
      )}

      {/* ─── Font family (sticky + text only) ─────────────────── */}
      {(stickies.length > 0 || texts.length > 0) && (
        <div className="flex items-center gap-0.5" aria-label="Font family">
          {FONT_FAMILIES.map((f) => (
            <button
              key={f.label}
              type="button"
              aria-label={`Font ${f.label}`}
              title={f.label}
              onClick={() => {
                if (stickies.length > 0) patchAll(stickies, { fontFamily: f.value } as Partial<WhiteboardSticky>);
                if (texts.length > 0) patchAll(texts, { fontFamily: f.value } as Partial<WhiteboardText>);
              }}
              className="px-1.5 py-1 rounded text-[10px] text-sub hover:text-text hover:bg-surface-deep transition-colors"
              style={{ fontFamily: f.value }}
            >
              {f.label}
            </button>
          ))}
          <div className="w-px h-5 bg-border mx-1" />
        </div>
      )}

      {/* ─── Text bold + alignment ─────────────────── */}
      {texts.length > 0 && (
        <div className="flex items-center gap-0.5" aria-label="Text style">
          <button
            type="button"
            aria-label="Toggle bold"
            title="Bold"
            onClick={() => {
              // Per-text toggle so mixed bold/regular selections flip
              // each independently rather than homogenising.
              onPatch(texts.map((t) => ({
                id: t.id,
                patch: { fontWeight: (t.fontWeight ?? 400) >= 600 ? 400 : 700 } as Partial<WhiteboardObject>,
              })));
            }}
            className="w-7 h-7 rounded flex items-center justify-center text-sub hover:text-text hover:bg-surface-deep transition-colors"
          >
            <Bold className="w-3.5 h-3.5" aria-hidden="true" />
          </button>
          <button
            type="button"
            aria-label="Align left"
            title="Align left"
            onClick={() => patchAll(texts, { align: "left" } as Partial<WhiteboardText>)}
            className="w-7 h-7 rounded flex items-center justify-center text-sub hover:text-text hover:bg-surface-deep transition-colors"
          >
            <AlignLeft className="w-3.5 h-3.5" aria-hidden="true" />
          </button>
          <button
            type="button"
            aria-label="Align center"
            title="Align center"
            onClick={() => patchAll(texts, { align: "center" } as Partial<WhiteboardText>)}
            className="w-7 h-7 rounded flex items-center justify-center text-sub hover:text-text hover:bg-surface-deep transition-colors"
          >
            <AlignCenter className="w-3.5 h-3.5" aria-hidden="true" />
          </button>
          <button
            type="button"
            aria-label="Align right"
            title="Align right"
            onClick={() => patchAll(texts, { align: "right" } as Partial<WhiteboardText>)}
            className="w-7 h-7 rounded flex items-center justify-center text-sub hover:text-text hover:bg-surface-deep transition-colors"
          >
            <AlignRight className="w-3.5 h-3.5" aria-hidden="true" />
          </button>
        </div>
      )}

      {/* ─── Frame fill ─────────────────── */}
      {frames.length > 0 && allOfType("frame") && (
        <PaletteRow
          label="Background"
          colors={[...PAINT_COLORS, "transparent"]}
          onPick={(c) => patchAll(frames, { fill: c === "transparent" ? undefined : `${c}33` } as Partial<WhiteboardFrame>)}
        />
      )}

      {/* ─── Card accent colour (Phase 26) ─────────────────── */}
      {cards.length > 0 && (
        <PaletteRow
          label="Accent"
          colors={PAINT_COLORS}
          onPick={(c) => patchAll(cards, { color: c } as Partial<WhiteboardCard>)}
        />
      )}

      {/* ─── Timer presets (Phase 25) ─────────────────── */}
      {timers.length > 0 && (
        <div className="flex items-center gap-0.5" aria-label="Timer duration">
          <span className="text-[9px] uppercase font-mono text-sub mr-1">Duration</span>
          {[60, 180, 300, 600, 1200].map((sec) => (
            <button
              key={sec}
              type="button"
              aria-label={`Set ${sec} seconds`}
              title={`${Math.round(sec / 60)} min`}
              onClick={() => patchAll(timers, {
                durationSec: sec,
                remainingSec: sec,
                running: false,
                startedAt: undefined,
              } as Partial<WhiteboardTimer>)}
              className="px-1.5 py-1 rounded text-[10px] font-mono text-sub hover:text-text hover:bg-surface-deep transition-colors"
            >
              {Math.round(sec / 60)}m
            </button>
          ))}
          <div className="w-px h-5 bg-border mx-1" />
        </div>
      )}

      {/* ─── Voting reveal toggle + option presets (Phase 27) ──── */}
      {votings.length > 0 && (
        <div className="flex items-center gap-0.5" aria-label="Voting options">
          <span className="text-[9px] uppercase font-mono text-sub mr-1">Options</span>
          <button
            type="button"
            aria-label="Fibonacci scale"
            title="Fibonacci: 1, 2, 3, 5, 8, 13, ?, ☕"
            onClick={() => patchAll(votings, {
              options: ["1", "2", "3", "5", "8", "13", "?", "☕"],
              votes: {},
              revealed: false,
            } as Partial<WhiteboardVoting>)}
            className="px-1.5 py-1 rounded text-[10px] font-mono text-sub hover:text-text hover:bg-surface-deep transition-colors"
          >
            Fib
          </button>
          <button
            type="button"
            aria-label="T-shirt sizes"
            title="T-shirt: XS, S, M, L, XL"
            onClick={() => patchAll(votings, {
              options: ["XS", "S", "M", "L", "XL"],
              votes: {},
              revealed: false,
            } as Partial<WhiteboardVoting>)}
            className="px-1.5 py-1 rounded text-[10px] font-mono text-sub hover:text-text hover:bg-surface-deep transition-colors"
          >
            T-shirt
          </button>
          <button
            type="button"
            aria-label="Dot vote"
            title="Dot vote: +1, +2, +3"
            onClick={() => patchAll(votings, {
              options: ["+1", "+2", "+3"],
              votes: {},
              revealed: false,
            } as Partial<WhiteboardVoting>)}
            className="px-1.5 py-1 rounded text-[10px] font-mono text-sub hover:text-text hover:bg-surface-deep transition-colors"
          >
            Dots
          </button>
          <div className="w-px h-5 bg-border mx-1" />
        </div>
      )}

      {/* ─── Kanban column count presets (Phase 26) ─────────── */}
      {kanbans.length > 0 && (
        <div className="flex items-center gap-0.5" aria-label="Kanban columns">
          <span className="text-[9px] uppercase font-mono text-sub mr-1">Columns</span>
          <button
            type="button"
            aria-label="3 columns"
            title="To do / In progress / Done"
            onClick={() => patchAll(kanbans, {
              columns: ["todo", "in_progress", "done"],
              columnLabels: ["To do", "In progress", "Done"],
            } as Partial<WhiteboardKanbanFrame>)}
            className="px-1.5 py-1 rounded text-[10px] font-mono text-sub hover:text-text hover:bg-surface-deep transition-colors"
          >
            3
          </button>
          <button
            type="button"
            aria-label="4 columns"
            title="Backlog / To do / In progress / Done"
            onClick={() => patchAll(kanbans, {
              columns: ["backlog", "todo", "in_progress", "done"],
              columnLabels: ["Backlog", "To do", "In progress", "Done"],
            } as Partial<WhiteboardKanbanFrame>)}
            className="px-1.5 py-1 rounded text-[10px] font-mono text-sub hover:text-text hover:bg-surface-deep transition-colors"
          >
            4
          </button>
          <button
            type="button"
            aria-label="5 columns"
            title="Backlog / To do / In progress / Review / Done"
            onClick={() => patchAll(kanbans, {
              columns: ["backlog", "todo", "in_progress", "review", "done"],
              columnLabels: ["Backlog", "To do", "In progress", "Review", "Done"],
            } as Partial<WhiteboardKanbanFrame>)}
            className="px-1.5 py-1 rounded text-[10px] font-mono text-sub hover:text-text hover:bg-surface-deep transition-colors"
          >
            5
          </button>
          <div className="w-px h-5 bg-border mx-1" />
        </div>
      )}
      {/* Embed has no styling — keep panel empty for embed-only selections. */}
      {types.size === 1 && types.has("embed") && (
        <span className="text-xs text-sub italic px-2">
          <ArrowRightCircle className="w-3 h-3 inline-block mr-1" />
          embed (no style)
        </span>
      )}
    </div>
  );
}

/** Compact swatch row reused for fill / stroke / text-color pickers. */
function PaletteRow({ label, colors, onPick }: { label: string; colors: readonly string[]; onPick: (c: string) => void }) {
  return (
    <div className="flex items-center gap-0.5" aria-label={label}>
      <span className="text-[9px] uppercase font-mono text-sub mr-1">{label}</span>
      {colors.map((c) => (
        <button
          key={c}
          type="button"
          aria-label={`${label} ${c}`}
          title={c}
          onClick={() => onPick(c)}
          className="w-4 h-4 rounded border border-black/30 hover:scale-110 transition-transform"
          style={{
            background: c === "transparent"
              ? "repeating-conic-gradient(#374151 0% 25%, transparent 0% 50%) 50% / 6px 6px"
              : c,
          }}
        />
      ))}
      <div className="w-px h-5 bg-border mx-1" />
    </div>
  );
}

export const PropertyPanel = memo(PropertyPanelImpl);
