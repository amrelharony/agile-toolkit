"use client";

import { useEffect, useRef, useState } from "react";
import type { WhiteboardTable, WhiteboardObject } from "@/lib/stores/workspace-types";

/**
 * Renderer for the WhiteboardTable object.
 *
 * Features:
 *   - Header row (row 0) rendered as <th> by default; toggle via
 *     `headerRow: false` on the object.
 *   - Per-column width: `columnFractions[i]` is i'th column's share
 *     of total width. Defaults to even distribution.
 *   - Double-click any cell to edit: an `<input>` overlays the cell,
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
  onPointerDown,
  onMutate,
}: {
  object: WhiteboardTable;
  selected: boolean;
  readOnly: boolean;
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
    if (col >= numCols) { col = 0; row += 1; }
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
    let nextFractions: number[] | undefined;
    if (object.columnFractions && object.columnFractions.length === numCols) {
      const scale = numCols / (numCols + 1);
      nextFractions = [
        ...object.columnFractions.map((f) => f * scale),
        1 - object.columnFractions.reduce((a, b) => a + b, 0) * scale,
      ];
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
  } | null>(null);

  const onResizePointerDown = (colIdx: number, e: React.PointerEvent) => {
    if (readOnly || object.locked) return;
    e.stopPropagation();
    e.preventDefault();
    (e.currentTarget as HTMLDivElement).setPointerCapture(e.pointerId);
    resizeRef.current = {
      colIdx,
      startX: e.clientX,
      startFractions: [...fractions],
      width: object.w,
    };
  };
  const onResizePointerMove = (e: React.PointerEvent) => {
    const r = resizeRef.current;
    if (!r) return;
    const dxPx = e.clientX - r.startX;
    const dxFrac = dxPx / Math.max(1, r.width);
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
        border: `${selected ? 2 : 1}px solid ${selected ? "#00f0ff" : borderColor}`,
        borderRadius: 4,
        boxShadow: selected ? "0 0 12px rgba(0,240,255,0.4)" : "0 1px 3px rgba(0,0,0,0.3)",
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
                    showResizeHandle={!showHeader && colIdx < numCols - 1 && !readOnly && !object.locked}
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
    border: "1px solid rgba(0, 240, 255, 0.5)",
    background: "rgba(11, 15, 23, 0.95)",
    color: "#00f0ff",
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
        <button type="button" title="Add row" aria-label="Add row" onClick={onAddRow} style={btnStyle}>+</button>
        {canRemoveRow && (
          <button type="button" title="Remove last row" aria-label="Remove last row" onClick={onRemoveRow} style={btnStyle}>−</button>
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
        <button type="button" title="Add column" aria-label="Add column" onClick={onAddCol} style={btnStyle}>+</button>
        {canRemoveCol && (
          <button type="button" title="Remove last column" aria-label="Remove last column" onClick={onRemoveCol} style={btnStyle}>−</button>
        )}
      </div>
    </>
  );
}

type CellMove = "next" | "prev" | "down";

interface CellProps {
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
  return (
    <CellBase as="th" headerStyle {...props} />
  );
}

function TableDataCell(props: CellProps) {
  return (
    <CellBase as="td" {...props} />
  );
}

function CellBase({
  as,
  text, isEditing, readOnly,
  onStartEdit, onCommit, onMove,
  showResizeHandle, onResizePointerDown, onResizePointerMove, onResizePointerUp,
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
        <CellEditor initial={text} onCommit={onCommit} onMove={onMove} />
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
  initial,
  onCommit,
  onMove,
}: {
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
      defaultValue={initial}
      onChange={(e) => { valueRef.current = e.target.value; }}
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
        outline: "1px solid #00f0ff",
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
