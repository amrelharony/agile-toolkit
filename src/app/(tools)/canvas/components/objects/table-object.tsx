"use client";

import { useEffect, useRef, useState } from "react";
import type { WhiteboardTable, WhiteboardObject } from "@/lib/stores/workspace-types";
import { useCanvasStore } from "../../use-canvas-store";

/**
 * Renderer for the WhiteboardTable object.
 *
 * Features:
 *   - Header row (row 0) rendered as <th> by default; toggle via
 *     `headerRow: false` on the object.
 *   - Per-column width: `columnFractions[i]` is i'th column's share
 *     of total width. Defaults to even distribution.
 *   - Double-click any cell to edit (or press Enter on the selected
 *     table to start at the first cell): an `<input>` overlays the cell,
 *     Enter / Tab / blur commits, Esc cancels.
 *   - Tab during edit moves to the next cell (wraps to next row);
 *     Shift+Tab moves backwards. Enter without Shift moves to the
 *     row below same column (Excel-style).
 *   - Column-resize handles between columns: drag to change
 *     `columnFractions`. Locked objects skip the resize handle.
 *
 * Out of scope (would push past session budget):
 *   - Add / remove rows / columns from a header menu (would need a
 *     context menu + several pointer affordances).
 *   - Rich text per cell (would require Tiptap × N — heavy).
 *   - Cell selection / multi-cell paste.
 *   - Formulas.
 */
export function TableObject({
  object,
  selected,
  readOnly,
  editing: boardEditing = false,
  onEditEnd,
  onPointerDown,
  onMutate,
}: {
  object: WhiteboardTable;
  selected: boolean;
  readOnly: boolean;
  /** Board-level edit flag — set by Enter on the selected table, the
   *  keyboard route to the double-click cell editor (WCAG 2.1.1). */
  editing?: boolean;
  /** Clears the board-level edit flag once cell editing finishes. */
  onEditEnd?: () => void;
  onPointerDown?: (e: React.PointerEvent) => void;
  onMutate: (id: string, patch: Partial<WhiteboardObject>) => void;
}) {
  const rows = object.rows ?? [];
  const numCols = rows[0]?.length ?? 0;

  // Per-column width fractions — defaults to even distribution.
  const fractions = (() => {
    if (object.columnFractions && object.columnFractions.length === numCols) {
      // Normalise in case the stored sum drifts from 1.0.
      const sum = object.columnFractions.reduce((a, b) => a + b, 0);
      if (sum > 0) return object.columnFractions.map((f) => f / sum);
    }
    return Array.from({ length: numCols }, () => 1 / Math.max(1, numCols));
  })();

  const showHeader = object.headerRow !== false && rows.length > 0;
  const dataRows = showHeader ? rows.slice(1) : rows;
  const headerRow = showHeader ? rows[0] : null;
  const borderColor = object.borderColor ?? "rgba(148, 163, 184, 0.35)";

  // ── Cell editing state ──────────────────────────────────────────
  const [editing, setEditing] = useState<{ row: number; col: number } | null>(null);

  // Enter on the board opens the first cell; when cell editing ends
  // (Esc, Tab past the last cell, blur) hand the board its flag back so
  // its shortcuts and focus resume. The ref tells "just started" apart
  // from "finished" — both see `editing === null`.
  const boardEditStartedRef = useRef(false);
  useEffect(() => {
    if (!boardEditing) {
      boardEditStartedRef.current = false;
      return;
    }
    if (!boardEditStartedRef.current) {
      boardEditStartedRef.current = true;
      if (readOnly || object.locked || rows.length === 0 || numCols === 0) onEditEnd?.();
      else setEditing({ row: 0, col: 0 });
      return;
    }
    if (editing === null) onEditEnd?.();
    // Only the edit flags drive this; the rest is read at transition time.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [boardEditing, editing]);

  const commitCell = (row: number, col: number, text: string) => {
    const nextRows = rows.map((r) => r.slice());
    if (!nextRows[row]) nextRows[row] = [];
    nextRows[row][col] = text;
    // Pad shorter rows to keep column count consistent (caller
    // may have built an empty cell with no trailing keystrokes).
    for (const r of nextRows) {
      while (r.length < numCols) r.push("");
    }
    onMutate(object.id, { rows: nextRows } as Partial<WhiteboardObject>);
  };

  const moveEditingTo = (row: number, col: number) => {
    // Bound the indices so Tab past the last cell wraps to the next
    // row, and past the last cell of the last row stops there.
    if (row < 0) row = 0;
    if (col < 0) col = numCols - 1;
    if (col >= numCols) {
      col = 0;
      row += 1;
    }
    if (row >= rows.length) {
      setEditing(null);
      return;
    }
    setEditing({ row, col });
  };

  // ── Row / column add + remove ───────────────────────────────────
  // Affordances only visible when the table is selected and writable.
  // Add a row of empty cells matching the current column count;
  // remove the last row (but keep at least 1 data row when there's
  // a header so the table doesn't visually collapse to just headers).
  const addRow = () => {
    const newRow = Array.from({ length: numCols }, () => "");
    onMutate(object.id, { rows: [...rows, newRow] } as Partial<WhiteboardObject>);
  };
  const minRows = showHeader ? 2 : 1;
  const canRemoveRow = rows.length > minRows;
  const removeRow = () => {
    if (!canRemoveRow) return;
    onMutate(object.id, { rows: rows.slice(0, -1) } as Partial<WhiteboardObject>);
  };
  const addCol = () => {
    const nextRows = rows.map((r) => [...r, ""]);
    // Distribute the new column an equal share, scaling existing
    // columns proportionally to make room.
    // BUG-RD3-table-object-1: stored fractions can drift from summing
    // exactly to 1 (the resize handle writes `.toFixed(3)` percentages
    // through the render path on each move). The prior arithmetic
    // `1 - existing.reduce(...) * scale` produced a negative new-col
    // fraction when sum > 1, or > 1/(N+1) when sum < 1 — NaN/invalid
    // colgroup widths on the next render. Normalise the stored
    // fractions to sum to 1 before splitting.
    let nextFractions: number[] | undefined;
    if (object.columnFractions && object.columnFractions.length === numCols) {
      const sum = object.columnFractions.reduce((a, b) => a + b, 0);
      const normalised =
        sum > 0
          ? object.columnFractions.map((f) => f / sum)
          : Array.from({ length: numCols }, () => 1 / Math.max(1, numCols));
      const scale = numCols / (numCols + 1);
      nextFractions = [...normalised.map((f) => f * scale), 1 / (numCols + 1)];
    }
    onMutate(object.id, {
      rows: nextRows,
      ...(nextFractions ? { columnFractions: nextFractions } : {}),
    } as Partial<WhiteboardObject>);
  };
  const canRemoveCol = numCols > 1;
  const removeCol = () => {
    if (!canRemoveCol) return;
    const nextRows = rows.map((r) => r.slice(0, -1));
    let nextFractions: number[] | undefined;
    if (object.columnFractions && object.columnFractions.length === numCols) {
      // Rescale remaining columns to sum to 1.
      const remaining = object.columnFractions.slice(0, -1);
      const sum = remaining.reduce((a, b) => a + b, 0);
      nextFractions = sum > 0 ? remaining.map((f) => f / sum) : undefined;
    }
    onMutate(object.id, {
      rows: nextRows,
      ...(nextFractions ? { columnFractions: nextFractions } : {}),
    } as Partial<WhiteboardObject>);
  };

  // ── Column resize ───────────────────────────────────────────────
  const resizeRef = useRef<{
    colIdx: number;
    startX: number;
    startFractions: number[];
    width: number;
    /** Camera zoom captured at drag start — see `onResizePointerMove`. */
    zoom: number;
  } | null>(null);

  const onResizePointerDown = (colIdx: number, e: React.PointerEvent) => {
    if (readOnly || object.locked) return;
    e.stopPropagation();
    e.preventDefault();
    (e.currentTarget as HTMLDivElement).setPointerCapture(e.pointerId);
    // Snapshot the zoom alongside startX/startFractions so the whole
    // gesture is measured against one consistent frame of reference.
    const z = useCanvasStore.getState().camera.zoom;
    resizeRef.current = {
      colIdx,
      startX: e.clientX,
      startFractions: [...fractions],
      width: object.w,
      zoom: z > 0 && Number.isFinite(z) ? z : 1,
    };
  };
  const onResizePointerMove = (e: React.PointerEvent) => {
    const r = resizeRef.current;
    if (!r) return;
    const dxPx = e.clientX - r.startX;
    // `dxPx` is a SCREEN delta but `r.width` is `object.w` in WORLD
    // units, and canvas-world-layer applies `scale(camera.zoom)` — the
    // table is `object.w * zoom` px wide on screen. Dividing by the raw
    // world width made the divider lag the cursor at zoom < 1 and
    // overshoot into the 5% clamp at zoom > 1; only zoom 1 was correct.
    const widthPx = Math.max(1, r.width * r.zoom);
    const dxFrac = dxPx / widthPx;
    // Move width between colIdx and colIdx+1 so total stays at 1.
    // Both sides are clamped to a 5% minimum; whichever side hit the
    // floor first determines the snap, so we compute the constrained
    // left and let newRight follow from the invariant sumPair.
    const proposedLeft = r.startFractions[r.colIdx] + dxFrac;
    const sumPair = r.startFractions[r.colIdx] + r.startFractions[r.colIdx + 1];
    const newLeft = Math.min(sumPair - 0.05, Math.max(0.05, proposedLeft));
    const newRight = sumPair - newLeft;
    const next = [...r.startFractions];
    next[r.colIdx] = newLeft;
    next[r.colIdx + 1] = newRight;
    onMutate(object.id, { columnFractions: next } as Partial<WhiteboardObject>);
  };
  const onResizePointerUp = (e: React.PointerEvent) => {
    if (!resizeRef.current) return;
    // Guard the release: if the user alt-tabbed / switched desktops
    // mid-drag the browser fires `pointercancel` and drops capture
    // before pointer-up arrives. Calling release on a pointer we
    // don't hold throws `NotFoundError`. Same fix as the
    // canvas-level pointer machine.
    const target = e.currentTarget as HTMLDivElement;
    if (target.hasPointerCapture?.(e.pointerId)) {
      target.releasePointerCapture(e.pointerId);
    }
    resizeRef.current = null;
  };

  // BUG-RD3-table-object-2: document-level pointerup / pointercancel
  // fallback. The handle's own pointerup fires reliably WHEN capture
  // works, but if the release happens after the user clicks an
  // external window (browser dropping capture silently in some
  // engines) the resize state stays armed — the next stray pointer
  // event over the canvas re-enters the move handler with stale
  // `startFractions` / `startX`, producing a phantom jump on the
  // unrelated column. Listen on document so we always clear the ref.
  useEffect(() => {
    const onDocUp = () => {
      if (resizeRef.current) resizeRef.current = null;
    };
    document.addEventListener("pointerup", onDocUp);
    document.addEventListener("pointercancel", onDocUp);
    return () => {
      document.removeEventListener("pointerup", onDocUp);
      document.removeEventListener("pointercancel", onDocUp);
    };
  }, []);

  // ── Render ──────────────────────────────────────────────────────
  return (
    <div
      onPointerDown={onPointerDown}
      data-canvas-object-kind="table"
      style={{
        position: "absolute",
        left: 0,
        top: 0,
        transform: `translate3d(${object.x}px, ${object.y}px, 0)${object.rotation ? ` rotate(${object.rotation}deg)` : ""}`,
        width: object.w,
        height: object.h,
        boxSizing: "border-box",
        overflow: "auto",
        background: "rgba(15, 23, 42, 0.95)",
        border: `${selected ? 2 : 1}px solid ${selected ? "var(--accent)" : borderColor}`,
        borderRadius: 4,
        boxShadow: selected
          ? "0 0 12px color-mix(in srgb, var(--accent) 40%, transparent)"
          : "0 1px 3px rgba(0,0,0,0.3)",
        color: "#e5e7eb",
        fontFamily: "ui-sans-serif, system-ui, sans-serif",
        fontSize: 12,
        cursor: object.locked ? "default" : "move",
        zIndex: object.z,
        opacity: object.locked ? 0.85 : 1,
      }}
    >
      <table
        style={{
          width: "100%",
          height: "100%",
          borderCollapse: "collapse",
          tableLayout: "fixed",
        }}
      >
        <colgroup>
          {fractions.map((f, i) => (
            <col key={i} style={{ width: `${(f * 100).toFixed(3)}%` }} />
          ))}
        </colgroup>
        {showHeader && headerRow && (
          <thead>
            <tr>
              {headerRow.map((cell, colIdx) => (
                <TableHeaderCell
                  key={colIdx}
                  label={`Header, column ${colIdx + 1}`}
                  text={cell}
                  isEditing={editing?.row === 0 && editing?.col === colIdx}
                  readOnly={readOnly || !!object.locked}
                  onStartEdit={() => setEditing({ row: 0, col: colIdx })}
                  onCommit={(text) => {
                    commitCell(0, colIdx, text);
                    setEditing(null);
                  }}
                  onMove={(dir) => {
                    if (dir === "next") moveEditingTo(0, colIdx + 1);
                    else if (dir === "prev") moveEditingTo(0, colIdx - 1);
                    else if (dir === "down") moveEditingTo(1, colIdx);
                  }}
                  showResizeHandle={colIdx < numCols - 1 && !readOnly && !object.locked}
                  onResizePointerDown={(e) => onResizePointerDown(colIdx, e)}
                  onResizePointerMove={onResizePointerMove}
                  onResizePointerUp={onResizePointerUp}
                  borderColor={borderColor}
                />
              ))}
            </tr>
          </thead>
        )}
        <tbody>
          {dataRows.map((row, dIdx) => {
            const rowIdx = showHeader ? dIdx + 1 : dIdx;
            return (
              <tr key={rowIdx}>
                {row.map((cell, colIdx) => (
                  <TableDataCell
                    key={colIdx}
                    label={`Row ${dIdx + 1}, column ${colIdx + 1}`}
                    text={cell}
                    isEditing={editing?.row === rowIdx && editing?.col === colIdx}
                    readOnly={readOnly || !!object.locked}
                    onStartEdit={() => setEditing({ row: rowIdx, col: colIdx })}
                    onCommit={(text) => {
                      commitCell(rowIdx, colIdx, text);
                      setEditing(null);
                    }}
                    onMove={(dir) => {
                      if (dir === "next") moveEditingTo(rowIdx, colIdx + 1);
                      else if (dir === "prev") moveEditingTo(rowIdx, colIdx - 1);
                      else if (dir === "down") moveEditingTo(rowIdx + 1, colIdx);
                    }}
                    showResizeHandle={
                      !showHeader && colIdx < numCols - 1 && !readOnly && !object.locked
                    }
                    onResizePointerDown={(e) => onResizePointerDown(colIdx, e)}
                    onResizePointerMove={onResizePointerMove}
                    onResizePointerUp={onResizePointerUp}
                    borderColor={borderColor}
                  />
                ))}
              </tr>
            );
          })}
        </tbody>
      </table>
      {selected && !readOnly && !object.locked && (
        <TableEditAffordances
          canRemoveRow={canRemoveRow}
          canRemoveCol={canRemoveCol}
          onAddRow={addRow}
          onRemoveRow={removeRow}
          onAddCol={addCol}
          onRemoveCol={removeCol}
        />
      )}
    </div>
  );
}

/**
 * Add / remove row + column affordances. Visible only when the
 * table is selected (and writable). The buttons live inside the
 * outer `<div>` so they scroll with the table when it overflows,
 * but they sit at the bottom + right edges so they don't visually
 * intrude on cells.
 *
 * Each button stops pointer-down propagation so clicks don't
 * initiate a drag on the parent table object.
 */
function TableEditAffordances({
  canRemoveRow,
  canRemoveCol,
  onAddRow,
  onRemoveRow,
  onAddCol,
  onRemoveCol,
}: {
  canRemoveRow: boolean;
  canRemoveCol: boolean;
  onAddRow: () => void;
  onRemoveRow: () => void;
  onAddCol: () => void;
  onRemoveCol: () => void;
}) {
  const btnStyle: React.CSSProperties = {
    fontSize: 10,
    fontFamily: "ui-monospace, SF Mono, monospace",
    width: 18,
    height: 18,
    borderRadius: 4,
    border: "1px solid color-mix(in srgb, var(--accent) 50%, transparent)",
    background: "rgba(11, 15, 23, 0.95)",
    color: "var(--accent)",
    cursor: "pointer",
    display: "flex",
    alignItems: "center",
    justifyContent: "center",
    lineHeight: 1,
  };
  return (
    <>
      {/* Bottom-edge row controls */}
      <div
        style={{
          position: "absolute",
          left: "50%",
          bottom: -10,
          transform: "translateX(-50%)",
          display: "flex",
          gap: 4,
          zIndex: 2,
        }}
        onPointerDown={(e) => e.stopPropagation()}
      >
        <button
          type="button"
          title="Add row"
          aria-label="Add row"
          onClick={onAddRow}
          style={btnStyle}
        >
          +
        </button>
        {canRemoveRow && (
          <button
            type="button"
            title="Remove last row"
            aria-label="Remove last row"
            onClick={onRemoveRow}
            style={btnStyle}
          >
            −
          </button>
        )}
      </div>
      {/* Right-edge column controls */}
      <div
        style={{
          position: "absolute",
          right: -10,
          top: "50%",
          transform: "translateY(-50%)",
          display: "flex",
          flexDirection: "column",
          gap: 4,
          zIndex: 2,
        }}
        onPointerDown={(e) => e.stopPropagation()}
      >
        <button
          type="button"
          title="Add column"
          aria-label="Add column"
          onClick={onAddCol}
          style={btnStyle}
        >
          +
        </button>
        {canRemoveCol && (
          <button
            type="button"
            title="Remove last column"
            aria-label="Remove last column"
            onClick={onRemoveCol}
            style={btnStyle}
          >
            −
          </button>
        )}
      </div>
    </>
  );
}

type CellMove = "next" | "prev" | "down";

interface CellProps {
  /** Accessible name for the cell editor ("Row 2, column 3"). */
  label: string;
  text: string;
  isEditing: boolean;
  readOnly: boolean;
  onStartEdit: () => void;
  onCommit: (text: string) => void;
  onMove: (dir: CellMove) => void;
  showResizeHandle: boolean;
  onResizePointerDown: (e: React.PointerEvent) => void;
  onResizePointerMove: (e: React.PointerEvent) => void;
  onResizePointerUp: (e: React.PointerEvent) => void;
  borderColor: string;
}

function TableHeaderCell(props: CellProps) {
  return <CellBase as="th" headerStyle {...props} />;
}

function TableDataCell(props: CellProps) {
  return <CellBase as="td" {...props} />;
}

function CellBase({
  as,
  label,
  text,
  isEditing,
  readOnly,
  onStartEdit,
  onCommit,
  onMove,
  showResizeHandle,
  onResizePointerDown,
  onResizePointerMove,
  onResizePointerUp,
  borderColor,
  headerStyle = false,
}: CellProps & { as: "th" | "td"; headerStyle?: boolean }) {
  const Tag = as;
  return (
    <Tag
      onPointerDown={(e) => e.stopPropagation()}
      onDoubleClick={(e) => {
        if (readOnly) return;
        e.stopPropagation();
        onStartEdit();
      }}
      style={{
        position: "relative",
        padding: 6,
        borderRight: `1px solid ${borderColor}`,
        borderBottom: `1px solid ${borderColor}`,
        verticalAlign: "top",
        textAlign: "left",
        fontWeight: headerStyle ? 600 : 400,
        background: headerStyle ? "rgba(30, 41, 59, 0.7)" : "transparent",
        cursor: readOnly ? "default" : "text",
        // wrap long cell content; overflow scrolls inside the outer
        // <div> rather than the cell itself for predictable layout.
        wordBreak: "break-word",
        whiteSpace: "pre-wrap",
      }}
    >
      {isEditing ? (
        <CellEditor label={label} initial={text} onCommit={onCommit} onMove={onMove} />
      ) : (
        text || <span style={{ opacity: 0.35 }}>&nbsp;</span>
      )}
      {showResizeHandle && (
        <div
          aria-hidden="true"
          onPointerDown={onResizePointerDown}
          onPointerMove={onResizePointerMove}
          onPointerUp={onResizePointerUp}
          // Wide invisible hit target so the user doesn't need pixel-
          // perfect aim, narrow visible line so it isn't busy. Sits
          // on the right border of the cell.
          style={{
            position: "absolute",
            top: 0,
            right: -3,
            width: 6,
            height: "100%",
            cursor: "col-resize",
            zIndex: 1,
          }}
        />
      )}
    </Tag>
  );
}

function CellEditor({
  label,
  initial,
  onCommit,
  onMove,
}: {
  label: string;
  initial: string;
  onCommit: (text: string) => void;
  onMove: (dir: CellMove) => void;
}) {
  const ref = useRef<HTMLInputElement | null>(null);
  const valueRef = useRef(initial);
  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    el.focus();
    el.select();
  }, []);
  return (
    <input
      ref={ref}
      aria-label={label}
      defaultValue={initial}
      onChange={(e) => {
        valueRef.current = e.target.value;
      }}
      onBlur={() => onCommit(valueRef.current)}
      onKeyDown={(e) => {
        e.stopPropagation();
        if (e.key === "Enter" && !e.shiftKey) {
          e.preventDefault();
          onCommit(valueRef.current);
          onMove("down");
        } else if (e.key === "Tab") {
          e.preventDefault();
          onCommit(valueRef.current);
          onMove(e.shiftKey ? "prev" : "next");
        } else if (e.key === "Escape") {
          e.preventDefault();
          onCommit(valueRef.current);
        }
      }}
      onPointerDown={(e) => e.stopPropagation()}
      style={{
        width: "100%",
        boxSizing: "border-box",
        background: "transparent",
        border: "none",
        outline: "1px solid var(--accent)",
        outlineOffset: -1,
        color: "inherit",
        fontFamily: "inherit",
        fontSize: "inherit",
        fontWeight: "inherit",
        padding: 0,
      }}
    />
  );
}
