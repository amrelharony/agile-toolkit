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

import { memo, useEffect, useMemo, useRef, useState } from "react";
import {
  Bold,
  AlignLeft,
  AlignCenter,
  AlignRight,
  Minus,
  MoveRight,
  MoveLeft,
  ArrowRightCircle,
  Tag,
  X,
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
  /** Open the card detail modal. Surface as a pill on the panel when a
   * single card is selected. */
  onOpenCardDetail?: (cardId: string) => void;
}

/** Sticky palette — matches templates.ts STICKY_PALETTE. */
const STICKY_COLORS = ["#fde68a", "#fca5a5", "#bef264", "#a5f3fc", "#fbcfe8", "#c4b5fd"];
/** Stroke + fill palette for shapes / text / freehand. */
const PAINT_COLORS = [
  "#e5e7eb",
  "#94a3b8",
  "#0b0f17",
  "#00f0ff",
  "#a78bfa",
  "#34d399",
  "#f59e0b",
  "#f87171",
  "#60a5fa",
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
function anchorScreenY(
  bbox: Rect,
  camera: Camera,
  viewportHeight: number
): { top: number; below: boolean } {
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

function PropertyPanelImpl({
  selection,
  selectionBbox,
  camera,
  viewportHeight,
  onPatch,
  onOpenCardDetail,
}: PropertyPanelProps) {
  if (selection.length === 0) return null;

  // Project to screen position.
  const screenLeft =
    (selectionBbox.x - camera.x) * camera.zoom + (selectionBbox.w * camera.zoom) / 2;
  const { top: screenTop } = anchorScreenY(selectionBbox, camera, viewportHeight);

  // Compute which control sets to show based on type uniformity.
  const types = new Set(selection.map((o) => o.type));
  const allOfType = (t: WhiteboardObject["type"]) => types.size === 1 && types.has(t);

  const stickies = selection.filter((o): o is WhiteboardSticky => o.type === "sticky");
  const shapes = selection.filter(
    (o): o is WhiteboardShape =>
      o.type === "rect" || o.type === "ellipse" || o.type === "diamond" || o.type === "triangle"
  );
  const texts = selection.filter((o): o is WhiteboardText => o.type === "text");
  const lines = selection.filter(
    (o): o is WhiteboardLine => o.type === "line" || o.type === "arrow"
  );
  const connectors = selection.filter((o): o is WhiteboardConnector => o.type === "connector");
  const freehands = selection.filter((o): o is WhiteboardFreehand => o.type === "freehand");
  const frames = selection.filter((o): o is WhiteboardFrame => o.type === "frame");
  // Phase 25-26 new types — single-edit only (no bulk apply for these).
  const cards = selection.filter((o): o is WhiteboardCard => o.type === "card");
  const timers = selection.filter((o): o is WhiteboardTimer => o.type === "timer");
  const votings = selection.filter((o): o is WhiteboardVoting => o.type === "voting");
  const kanbans = selection.filter((o): o is WhiteboardKanbanFrame => o.type === "kanban");

  /** Apply the same patch to every object in `targets`. */
  const patchAll = <T extends WhiteboardObject>(targets: readonly T[], patch: Partial<T>) => {
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
      // Single-row scrollable: was `flex-wrap max-w-[680px]` which split
      // a busy selection onto two rows + reserved the orphaned tag chip
      // at the bottom-left. Now: `flex-nowrap max-w-[min(95vw,640px)]
      // overflow-x-auto` keeps everything on one row and scrolls
      // horizontally when content overflows, with a hidden scrollbar
      // for the sleek look. Padding tightened: gap-1 → gap-0.5,
      // px-2 py-1 → px-1.5 py-0.5.
      className="flex items-center gap-0.5 bg-surface/95 border border-border rounded-lg px-1.5 py-0.5 shadow-lg backdrop-blur-sm flex-nowrap max-w-[min(95vw,640px)] overflow-x-auto [scrollbar-width:none] [&::-webkit-scrollbar]:hidden"
    >
      {/* ─── Sticky color (palette swatches) ─────────────────── */}
      {stickies.length > 0 && (
        <div className="flex items-center gap-0.5 shrink-0" aria-label="Sticky color">
          {STICKY_COLORS.map((c) => (
            <button
              key={c}
              type="button"
              aria-label={`Set color ${c}`}
              title={`Sticky color: ${c}`}
              onClick={() => patchAll(stickies, { color: c } as Partial<WhiteboardSticky>)}
              // 16 → 14 px swatches, full circles (was rounded-sm),
              // hover ring instead of scale so adjacent swatches
              // don't jitter when the user moves between them.
              className="w-3.5 h-3.5 rounded-full border border-black/20 hover:ring-2 hover:ring-accent/50 transition-shadow"
              style={{ background: c }}
            />
          ))}
          <div className="w-px h-4 bg-border/70 mx-1.5" />
        </div>
      )}

      {/* ─── Shape fill + stroke ─────────────────── */}
      {shapes.length > 0 && (
        <>
          <PaletteRow
            label="Fill"
            colors={[...PAINT_COLORS, "transparent"]}
            onPick={(c) =>
              patchAll(shapes, {
                fill: c === "transparent" ? undefined : c,
              } as Partial<WhiteboardShape>)
            }
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
            if (connectors.length > 0)
              patchAll(connectors, { stroke: c } as Partial<WhiteboardConnector>);
            if (freehands.length > 0)
              patchAll(freehands, { stroke: c } as Partial<WhiteboardFreehand>);
          }}
        />
      )}

      {/* ─── Stroke width — active pill on the currently-selected
          width (when uniform across the selection). */}
      {(shapes.length > 0 || lines.length > 0 || connectors.length > 0 || freehands.length > 0) && (
        <div className="flex items-center gap-0.5 shrink-0" aria-label="Stroke width">
          {STROKE_WIDTHS.map((w) => {
            const activeShape =
              shapes.length > 0 && shapes.every((o) => (o.strokeWidth ?? 1.5) === w);
            const activeLine = lines.length > 0 && lines.every((o) => o.strokeWidth === w);
            const activeConn =
              connectors.length > 0 && connectors.every((o) => o.strokeWidth === w);
            const activeFree = freehands.length > 0 && freehands.every((o) => o.strokeWidth === w);
            const active = activeShape || activeLine || activeConn || activeFree;
            return (
              <button
                key={w}
                type="button"
                aria-label={`Stroke width ${w}`}
                aria-pressed={active}
                title={`${w}px`}
                onClick={() => {
                  if (shapes.length > 0)
                    patchAll(shapes, { strokeWidth: w } as Partial<WhiteboardShape>);
                  if (lines.length > 0)
                    patchAll(lines, { strokeWidth: w } as Partial<WhiteboardLine>);
                  if (connectors.length > 0)
                    patchAll(connectors, { strokeWidth: w } as Partial<WhiteboardConnector>);
                  if (freehands.length > 0)
                    patchAll(freehands, { strokeWidth: w } as Partial<WhiteboardFreehand>);
                }}
                className={`w-6 h-6 rounded flex items-center justify-center transition-colors ${
                  active
                    ? "bg-accent/20 text-accent"
                    : "text-sub hover:text-text hover:bg-surface-deep"
                }`}
              >
                <div
                  style={{ width: 14, height: w, background: "currentColor", borderRadius: w / 2 }}
                />
              </button>
            );
          })}
          <div className="w-px h-4 bg-border/70 mx-1.5" />
        </div>
      )}

      {/* ─── Dashed toggle — also gets the active pill so the user
          sees whether their current selection IS dashed. */}
      {(lines.length > 0 || connectors.length > 0 || shapes.length > 0) &&
        (() => {
          const allDashed =
            (lines.length === 0 || lines.every((o) => o.dashed)) &&
            (connectors.length === 0 || connectors.every((o) => o.dashed)) &&
            (shapes.length === 0 || shapes.every((o) => o.dashed)) &&
            lines.length + connectors.length + shapes.length > 0;
          return (
            <button
              type="button"
              aria-label="Toggle dashed stroke"
              aria-pressed={allDashed}
              title="Dashed"
              onClick={() => {
                // Per-object toggle so mixed selections preserve individual
                // dashed state rather than being homogenised to the first
                // object's inverse.
                const entries: { id: string; patch: Partial<WhiteboardObject> }[] = [];
                for (const c of lines)
                  entries.push({
                    id: c.id,
                    patch: { dashed: !c.dashed } as Partial<WhiteboardObject>,
                  });
                for (const c of connectors)
                  entries.push({
                    id: c.id,
                    patch: { dashed: !c.dashed } as Partial<WhiteboardObject>,
                  });
                for (const c of shapes)
                  entries.push({
                    id: c.id,
                    patch: { dashed: !c.dashed } as Partial<WhiteboardObject>,
                  });
                onPatch(entries);
              }}
              className={`w-6 h-6 rounded flex items-center justify-center shrink-0 transition-colors ${
                allDashed
                  ? "bg-accent/20 text-accent"
                  : "text-sub hover:text-text hover:bg-surface-deep"
              }`}
            >
              <Minus className="w-4 h-4" style={{ strokeDasharray: "3 2" }} aria-hidden="true" />
            </button>
          );
        })()}

      {/* ─── Connector routing + arrowheads ─────────────────── */}
      {connectors.length > 0 && (
        <div className="flex items-center gap-0.5" aria-label="Connector options">
          <div className="w-px h-4 bg-border/70 mx-1.5" />
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
              onPatch(
                connectors.map((c) => ({
                  id: c.id,
                  patch: { arrowStart: !c.arrowStart } as Partial<WhiteboardObject>,
                }))
              );
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
              onPatch(
                connectors.map((c) => ({
                  id: c.id,
                  patch: { arrowEnd: !c.arrowEnd } as Partial<WhiteboardObject>,
                }))
              );
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

      {/* ─── Font size — tighter button rhythm. Each size compares to
          the current selected fontSize: active size gets the accent
          pill, others stay sub. Without the active indicator, the
          previous 7 plain numbers looked like decoration rather than
          a state picker. */}
      {(stickies.length > 0 || texts.length > 0) && (
        <div className="flex items-center gap-0.5 shrink-0" aria-label="Font size">
          {FONT_SIZES.map((s) => {
            const activeSticky =
              stickies.length > 0 && stickies.every((o) => (o.fontSize ?? 16) === s);
            const activeText = texts.length > 0 && texts.every((o) => o.fontSize === s);
            const active = activeSticky || activeText;
            return (
              <button
                key={s}
                type="button"
                aria-label={`Font size ${s}`}
                aria-pressed={active}
                title={`${s}px`}
                onClick={() => {
                  if (stickies.length > 0)
                    patchAll(stickies, { fontSize: s } as Partial<WhiteboardSticky>);
                  if (texts.length > 0) patchAll(texts, { fontSize: s } as Partial<WhiteboardText>);
                }}
                className={`min-w-[22px] h-6 px-1 rounded text-[10px] font-mono transition-colors ${
                  active
                    ? "bg-accent/20 text-accent"
                    : "text-sub hover:text-text hover:bg-surface-deep"
                }`}
              >
                {s}
              </button>
            );
          })}
          <div className="w-px h-4 bg-border/70 mx-1.5" />
        </div>
      )}

      {/* ─── Font family — same active-pill treatment for consistency. */}
      {(stickies.length > 0 || texts.length > 0) && (
        <div className="flex items-center gap-0.5 shrink-0" aria-label="Font family">
          {FONT_FAMILIES.map((f) => {
            const activeSticky =
              stickies.length > 0 && stickies.every((o) => (o.fontFamily ?? undefined) === f.value);
            const activeText =
              texts.length > 0 && texts.every((o) => (o.fontFamily ?? undefined) === f.value);
            const active = activeSticky || activeText;
            return (
              <button
                key={f.label}
                type="button"
                aria-label={`Font ${f.label}`}
                aria-pressed={active}
                title={f.label}
                onClick={() => {
                  if (stickies.length > 0)
                    patchAll(stickies, { fontFamily: f.value } as Partial<WhiteboardSticky>);
                  if (texts.length > 0)
                    patchAll(texts, { fontFamily: f.value } as Partial<WhiteboardText>);
                }}
                className={`h-6 px-1.5 rounded text-[10px] transition-colors ${
                  active
                    ? "bg-accent/20 text-accent"
                    : "text-sub hover:text-text hover:bg-surface-deep"
                }`}
                style={{ fontFamily: f.value }}
              >
                {f.label}
              </button>
            );
          })}
          <div className="w-px h-4 bg-border/70 mx-1.5" />
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
              onPatch(
                texts.map((t) => ({
                  id: t.id,
                  patch: {
                    fontWeight: (t.fontWeight ?? 400) >= 600 ? 400 : 700,
                  } as Partial<WhiteboardObject>,
                }))
              );
            }}
            className="w-6 h-6 rounded flex items-center justify-center shrink-0 text-sub hover:text-text hover:bg-surface-deep transition-colors"
          >
            <Bold className="w-3.5 h-3.5" aria-hidden="true" />
          </button>
          <button
            type="button"
            aria-label="Align left"
            title="Align left"
            onClick={() => patchAll(texts, { align: "left" } as Partial<WhiteboardText>)}
            className="w-6 h-6 rounded flex items-center justify-center shrink-0 text-sub hover:text-text hover:bg-surface-deep transition-colors"
          >
            <AlignLeft className="w-3.5 h-3.5" aria-hidden="true" />
          </button>
          <button
            type="button"
            aria-label="Align center"
            title="Align center"
            onClick={() => patchAll(texts, { align: "center" } as Partial<WhiteboardText>)}
            className="w-6 h-6 rounded flex items-center justify-center shrink-0 text-sub hover:text-text hover:bg-surface-deep transition-colors"
          >
            <AlignCenter className="w-3.5 h-3.5" aria-hidden="true" />
          </button>
          <button
            type="button"
            aria-label="Align right"
            title="Align right"
            onClick={() => patchAll(texts, { align: "right" } as Partial<WhiteboardText>)}
            className="w-6 h-6 rounded flex items-center justify-center shrink-0 text-sub hover:text-text hover:bg-surface-deep transition-colors"
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
          onPick={(c) =>
            patchAll(frames, {
              fill: c === "transparent" ? undefined : `${c}33`,
            } as Partial<WhiteboardFrame>)
          }
        />
      )}

      {/* ─── Card accent colour + edit-details pill (Phase 26) ──── */}
      {cards.length > 0 && (
        <PaletteRow
          label="Accent"
          colors={PAINT_COLORS}
          onPick={(c) => patchAll(cards, { color: c } as Partial<WhiteboardCard>)}
        />
      )}
      {cards.length === 1 && onOpenCardDetail && (
        <button
          type="button"
          onClick={() => onOpenCardDetail(cards[0].id)}
          title="Open full card details (Cmd+E)"
          className="text-[10px] uppercase font-mono px-2 py-1 rounded border border-accent/40 text-accent hover:bg-accent/10 transition-colors"
        >
          Details
        </button>
      )}

      {/* ─── Timer presets (Phase 25) ─────────────────── */}
      {timers.length > 0 && (
        <div className="flex items-center gap-0.5" aria-label="Timer duration">
          {[60, 180, 300, 600, 1200].map((sec) => (
            <button
              key={sec}
              type="button"
              aria-label={`Set ${sec} seconds`}
              title={`${Math.round(sec / 60)} min`}
              onClick={() =>
                patchAll(timers, {
                  durationSec: sec,
                  remainingSec: sec,
                  running: false,
                  startedAt: undefined,
                } as Partial<WhiteboardTimer>)
              }
              className="px-1.5 py-1 rounded text-[10px] font-mono text-sub hover:text-text hover:bg-surface-deep transition-colors"
            >
              {Math.round(sec / 60)}m
            </button>
          ))}
          <div className="w-px h-4 bg-border/70 mx-1.5" />
        </div>
      )}

      {/* ─── Voting reveal toggle + option presets (Phase 27) ──── */}
      {votings.length > 0 && (
        <div className="flex items-center gap-0.5" aria-label="Voting options">
          <button
            type="button"
            aria-label="Fibonacci scale"
            title="Fibonacci: 1, 2, 3, 5, 8, 13, ?, ☕"
            onClick={() =>
              patchAll(votings, {
                options: ["1", "2", "3", "5", "8", "13", "?", "☕"],
                votes: {},
                revealed: false,
              } as Partial<WhiteboardVoting>)
            }
            className="px-1.5 py-1 rounded text-[10px] font-mono text-sub hover:text-text hover:bg-surface-deep transition-colors"
          >
            Fib
          </button>
          <button
            type="button"
            aria-label="T-shirt sizes"
            title="T-shirt: XS, S, M, L, XL"
            onClick={() =>
              patchAll(votings, {
                options: ["XS", "S", "M", "L", "XL"],
                votes: {},
                revealed: false,
              } as Partial<WhiteboardVoting>)
            }
            className="px-1.5 py-1 rounded text-[10px] font-mono text-sub hover:text-text hover:bg-surface-deep transition-colors"
          >
            T-shirt
          </button>
          <button
            type="button"
            aria-label="Dot vote"
            title="Dot vote: +1, +2, +3"
            onClick={() =>
              patchAll(votings, {
                options: ["+1", "+2", "+3"],
                votes: {},
                revealed: false,
              } as Partial<WhiteboardVoting>)
            }
            className="px-1.5 py-1 rounded text-[10px] font-mono text-sub hover:text-text hover:bg-surface-deep transition-colors"
          >
            Dots
          </button>
          <div className="w-px h-4 bg-border/70 mx-1.5" />
        </div>
      )}

      {/* ─── Kanban column count presets (Phase 26) ─────────── */}
      {kanbans.length > 0 && (
        <div className="flex items-center gap-0.5" aria-label="Kanban columns">
          <button
            type="button"
            aria-label="3 columns"
            title="To do / In progress / Done"
            onClick={() =>
              patchAll(kanbans, {
                columns: ["todo", "in_progress", "done"],
                columnLabels: ["To do", "In progress", "Done"],
              } as Partial<WhiteboardKanbanFrame>)
            }
            className="px-1.5 py-1 rounded text-[10px] font-mono text-sub hover:text-text hover:bg-surface-deep transition-colors"
          >
            3
          </button>
          <button
            type="button"
            aria-label="4 columns"
            title="Backlog / To do / In progress / Done"
            onClick={() =>
              patchAll(kanbans, {
                columns: ["backlog", "todo", "in_progress", "done"],
                columnLabels: ["Backlog", "To do", "In progress", "Done"],
              } as Partial<WhiteboardKanbanFrame>)
            }
            className="px-1.5 py-1 rounded text-[10px] font-mono text-sub hover:text-text hover:bg-surface-deep transition-colors"
          >
            4
          </button>
          <button
            type="button"
            aria-label="5 columns"
            title="Backlog / To do / In progress / Review / Done"
            onClick={() =>
              patchAll(kanbans, {
                columns: ["backlog", "todo", "in_progress", "review", "done"],
                columnLabels: ["Backlog", "To do", "In progress", "Review", "Done"],
              } as Partial<WhiteboardKanbanFrame>)
            }
            className="px-1.5 py-1 rounded text-[10px] font-mono text-sub hover:text-text hover:bg-surface-deep transition-colors"
          >
            5
          </button>
          <div className="w-px h-4 bg-border/70 mx-1.5" />
        </div>
      )}
      {/* Embed has no styling — keep panel empty for embed-only selections. */}
      {types.size === 1 && types.has("embed") && (
        <span className="text-xs text-sub italic px-2">
          <ArrowRightCircle className="w-3 h-3 inline-block mr-1" />
          embed (no style)
        </span>
      )}

      {/* ─── Tags (Phase 26) — common to all object types ────────────
       * Tags are read across the union of selected objects' tags. When
       * a single object is selected we show its tags; when multiple
       * objects with mixed tag sets are selected, we still show the
       * full union and each add/remove fans out across all of them.
       * The same tag namespace is shared with Story.tags / Risk.tags
       * so a sticky tagged "blocker" surfaces in the same filter. */}
      {selection.length > 0 && !types.has("embed") && (
        <TagsEditor selection={selection} onPatch={onPatch} />
      )}
    </div>
  );
}

/** Inline tag chip editor. Shows union of selected objects' tags as
 * removable chips, plus an inline input for adding a new tag.
 *
 * Add behaviour: appends to every selected object's tags array
 * (deduped). Remove behaviour: strips the tag from every object that
 * has it. */
function TagsEditor({
  selection,
  onPatch,
}: {
  selection: readonly WhiteboardObject[];
  onPatch: (updates: { id: string; patch: Partial<WhiteboardObject> }[]) => void;
}) {
  const [input, setInput] = useState("");
  const [open, setOpen] = useState(false);
  const [capWarning, setCapWarning] = useState(false);
  const containerRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLInputElement>(null);

  // Union of all tags currently on the selection — sorted for stable
  // chip order regardless of selection order. Memoised so we don't
  // rebuild the Set on every parent re-render.
  const tags = useMemo(() => {
    const set = new Set<string>();
    for (const o of selection) for (const t of o.tags ?? []) set.add(t);
    return Array.from(set).sort((a, b) => a.localeCompare(b));
  }, [selection]);

  // Close dropdown on outside click. setTimeout defers binding so the
  // same click that opened the dropdown doesn't immediately close it.
  useEffect(() => {
    if (!open) return;
    const onDocClick = (e: MouseEvent) => {
      if (!containerRef.current?.contains(e.target as Node)) setOpen(false);
    };
    const h = setTimeout(() => document.addEventListener("click", onDocClick), 0);
    return () => {
      clearTimeout(h);
      document.removeEventListener("click", onDocClick);
    };
  }, [open]);

  // Manual focus on initial open — replaces autoFocus so the input
  // doesn't steal focus on every re-render while typing.
  useEffect(() => {
    if (open && inputRef.current) inputRef.current.focus();
  }, [open]);

  // Auto-clear cap warning after 3 s.
  useEffect(() => {
    if (!capWarning) return;
    const h = setTimeout(() => setCapWarning(false), 3000);
    return () => clearTimeout(h);
  }, [capWarning]);

  const addTag = (raw: string) => {
    // Strip zero-width / invisible chars before normalisation so users
    // can't bypass dedupe by pasting "blocker​" as a "new" tag. Covers
    // ZWSP, ZWNJ, ZWJ, Word Joiner (U+2060), ZWNBSP/BOM, soft hyphen,
    // and emoji Variation Selector-16 (U+FE0F).
    const t = raw
      .trim()
      .toLowerCase()
      .replace(/[​-‍⁠﻿­️]/g, "")
      .slice(0, 24);
    if (!t) return;
    const updates: { id: string; patch: Partial<WhiteboardObject> }[] = [];
    let anyAtCap = false;
    for (const o of selection) {
      const existing = o.tags ?? [];
      if (existing.includes(t)) continue;
      // Cap at 8 tags per object — keeps chip overflow predictable.
      if (existing.length >= 8) {
        anyAtCap = true;
        continue;
      }
      updates.push({ id: o.id, patch: { tags: [...existing, t] } });
    }
    if (updates.length > 0) {
      onPatch(updates);
      setCapWarning(false);
    } else if (anyAtCap) {
      // Nothing got added AND at least one object was at the cap —
      // surface a visible notice so users don't think the add silently
      // succeeded.
      setCapWarning(true);
    }
    setInput("");
  };

  const removeTag = (t: string) => {
    const updates: { id: string; patch: Partial<WhiteboardObject> }[] = [];
    for (const o of selection) {
      if (!o.tags?.includes(t)) continue;
      updates.push({ id: o.id, patch: { tags: o.tags.filter((x) => x !== t) } });
    }
    if (updates.length > 0) onPatch(updates);
  };

  return (
    <div ref={containerRef} className="flex items-center gap-1 relative">
      <div className="w-px h-5 bg-border mx-1" />
      <button
        type="button"
        aria-label="Tags"
        aria-expanded={open}
        aria-haspopup="dialog"
        title="Tags"
        onClick={() => setOpen((v) => !v)}
        className={`w-7 h-7 rounded flex items-center justify-center transition-colors ${
          tags.length > 0 || open
            ? "text-accent bg-accent/10"
            : "text-sub hover:text-text hover:bg-surface-deep"
        }`}
      >
        <Tag className="w-3.5 h-3.5" aria-hidden="true" />
        {tags.length > 0 && <span className="text-[9px] font-mono ml-0.5">{tags.length}</span>}
      </button>
      {open && (
        <div
          className="absolute top-full right-0 mt-1 bg-surface border border-border rounded-lg shadow-lg p-2 w-[min(17.5rem,calc(100vw-1.5rem))] z-[9998]"
          onClick={(e) => e.stopPropagation()}
        >
          {tags.length > 0 ? (
            <div className="flex flex-wrap gap-1 mb-2">
              {tags.map((t) => (
                <span
                  key={t}
                  className="inline-flex items-center gap-1 bg-accent/15 text-accent border border-accent/30 rounded-full px-2 py-0.5 text-[10px] font-mono"
                >
                  {t}
                  <button
                    type="button"
                    aria-label={`Remove tag ${t}`}
                    onClick={() => removeTag(t)}
                    className="text-accent/70 hover:text-accent"
                  >
                    <X className="w-2.5 h-2.5" aria-hidden="true" />
                  </button>
                </span>
              ))}
            </div>
          ) : (
            <p className="text-[10px] text-sub italic mb-2">No tags yet.</p>
          )}
          <form
            onSubmit={(e) => {
              e.preventDefault();
              addTag(input);
            }}
            className="flex items-center gap-1"
          >
            <input
              ref={inputRef}
              type="text"
              value={input}
              onChange={(e) => setInput(e.target.value)}
              onKeyDown={(e) => {
                // Comma also commits — Miro / Linear convention.
                if (e.key === ",") {
                  e.preventDefault();
                  addTag(input);
                }
                if (e.key === "Escape") setOpen(false);
              }}
              maxLength={24}
              placeholder="Add tag…"
              className="flex-1 bg-surface-deep border border-border rounded px-2 py-1 text-xs text-text focus:outline-none focus:border-accent"
            />
            <button
              type="submit"
              disabled={!input.trim()}
              className="text-[10px] uppercase font-mono text-sub hover:text-accent px-2 py-1 disabled:opacity-30"
            >
              Add
            </button>
            {capWarning && (
              <span role="status" className="text-[9px] font-mono text-amber-400 ml-1">
                ⚠ Some objects at 8-tag limit
              </span>
            )}
          </form>
        </div>
      )}
    </div>
  );
}

/** Compact swatch row reused for fill / stroke / text-color pickers.
 *
 * Sleek redesign: dropped the inline "FILL"/"STROKE"/"TEXT" labels —
 * they were taking horizontal space and the colour clusters speak for
 * themselves with tooltip-aware swatches. The aria-label on the wrapper
 * still announces the role for screen readers, and each swatch's
 * title/aria carries the colour value. */
function PaletteRow({
  label,
  colors,
  onPick,
}: {
  label: string;
  colors: readonly string[];
  onPick: (c: string) => void;
}) {
  return (
    <div className="flex items-center gap-0.5" aria-label={label} title={label}>
      {colors.map((c) => (
        <button
          key={c}
          type="button"
          aria-label={`${label} ${c}`}
          title={`${label}: ${c}`}
          onClick={() => onPick(c)}
          className="w-3.5 h-3.5 rounded-full border border-black/20 hover:ring-2 hover:ring-accent/50 transition-shadow"
          style={{
            background:
              c === "transparent"
                ? "repeating-conic-gradient(#374151 0% 25%, transparent 0% 50%) 50% / 6px 6px"
                : c,
          }}
        />
      ))}
      <div className="w-px h-4 bg-border/70 mx-1.5" />
    </div>
  );
}

export const PropertyPanel = memo(PropertyPanelImpl);
