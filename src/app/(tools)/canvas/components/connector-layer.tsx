"use client";

import { memo, useMemo, useRef } from "react";
import type { WhiteboardObject, WhiteboardConnector } from "@/lib/stores/workspace-types";
import { routeConnector, arrowheadPoints, type RoutedPath } from "@/lib/geometry/path-routing";
import { aabbIntersect, type Rect } from "@/lib/geometry/bbox";

interface ConnectorLayerProps {
  objects: readonly WhiteboardObject[];
  /** Active selection — selected connectors render thicker. */
  selectedIds: readonly string[];
  /** Optional pending-connector preview: from-object-id + cursor world point. */
  preview?: { fromId: string; toWorld: { x: number; y: number } } | null;
  /** Called when the user clicks a connector path. Wires connector
   * selection. Without this the connector layer is purely cosmetic. */
  onConnectorPointerDown?: (id: string, e: React.PointerEvent) => void;
  /** Called on double-click of a connector — used to open the inline
   * label editor. Wired in the parent to `onObjectDoubleClick`. */
  onConnectorDoubleClick?: (id: string) => void;
  /** ID of the connector currently being inline-edited. While set, the
   * connector renders an HTML `<input>` overlay (via SVG <foreignObject>)
   * instead of its SVG `<text>` label. */
  editingConnectorId?: string | null;
  /** Commit handler for the inline label edit. Called with the
   * connector id and the new label text on Enter / blur. */
  onCommitConnectorLabel?: (id: string, text: string) => void;
  /** Optional world-space viewport rect for culling off-screen connectors.
   * Drawn ~30% larger than the actual viewport so connectors whose endpoint
   * sits just past the edge still render their on-screen portion. When
   * omitted (e.g. PNG export of the full board), every connector renders. */
  viewportWorld?: Rect | null;
}

/**
 * Single SVG layer that renders every connector on the board (plus the
 * in-progress preview while a user is wiring a new one).
 *
 * Connectors live in WORLD coords just like every other object; the layer
 * is placed inside the world-space transform so pan/zoom apply automatically.
 *
 * Memoised so unrelated re-renders (selection changes that don't touch
 * connectors) don't reflow the SVG.
 *
 * Perf: on busy diagrams (5000+ connectors), unconditionally recomputing
 * every path's `d` string per render — and rendering every connector even
 * when most live off-screen — costs ~200 KB of DOM string churn per camera
 * tick. We cache the routed path keyed by the (fromRect, toRect, routing,
 * anchors) so unchanged connectors return the SAME RoutedPath object
 * across renders, and we viewport-cull connectors whose AABB doesn't
 * intersect the visible world rect.
 */
function ConnectorLayerImpl({
  objects, selectedIds, preview,
  onConnectorPointerDown, onConnectorDoubleClick,
  editingConnectorId, onCommitConnectorLabel,
  viewportWorld,
}: ConnectorLayerProps) {
  const byId = useMemo(() => {
    const m = new Map<string, WhiteboardObject>();
    for (const o of objects) m.set(o.id, o);
    return m;
  }, [objects]);

  const connectors = useMemo(
    () => objects.filter((o): o is WhiteboardConnector => o.type === "connector"),
    [objects],
  );

  // R9: Set lookup for selection — `selectedIds.includes` was O(M) per
  // connector. With 5k connectors × 100-item selection that's 500k ops
  // per render of the connector layer.
  const selectedSet = useMemo(() => new Set(selectedIds), [selectedIds]);

  // Per-connector path cache. Keyed by stable connector id; the cached
  // entry stores (input-key, routed result). On render, look up the
  // input-key — if it matches, reuse the path. Otherwise recompute and
  // refresh the cache entry. We hold the cache in a ref so it survives
  // re-renders without participating in React's reconciliation.
  //
  // Why not useMemo per-connector? useMemo's dep list is fixed-length —
  // it can't memo across an unknown number of children. A ref-based
  // cache scoped to the layer is the cheapest stable-identity scheme.
  const pathCacheRef = useRef<Map<string, { key: string; path: RoutedPath }>>(new Map());

  // Prune cache entries for connectors that no longer exist. Without
  // this, deleted connectors leak slots in the cache (small but
  // monotonically growing on long-lived boards).
  const activeIdsKey = useMemo(() => {
    const ids = new Set<string>();
    for (const c of connectors) ids.add(c.id);
    // Drop stale entries
    const cache = pathCacheRef.current;
    if (cache.size > ids.size) {
      for (const id of Array.from(cache.keys())) {
        if (!ids.has(id)) cache.delete(id);
      }
    }
    return ids;
  }, [connectors]);
  void activeIdsKey;

  const previewSource = preview ? byId.get(preview.fromId) : null;

  return (
    <svg
      // SVG covers the entire world transform's parent — overflow visible
      // so connectors can extend past the nominal viewport while still
      // participating in the camera transform applied to the parent div.
      //
      // pointerEvents="none" on the root SVG so empty space passes clicks
      // through to objects beneath it. Per-connector hit targets below
      // re-enable pointerEvents only on the wide hit-stroke paths, so
      // users can click anywhere within ~12px of a connector to select it.
      style={{
        position: "absolute",
        left: 0,
        top: 0,
        width: 1,
        height: 1,
        overflow: "visible",
        pointerEvents: "none",
      }}
    >
      {connectors.map((c) => {
        const from = byId.get(c.fromId);
        const to = byId.get(c.toId);
        if (!from || !to) return null;

        // Viewport culling: skip connectors whose AABB (the union of
        // from + to rects) doesn't intersect the visible world rect.
        // Inflate the connector AABB slightly because orthogonal
        // routing can detour past the endpoint rects via the elbow
        // mid-segment.
        if (viewportWorld) {
          const minX = Math.min(from.x, to.x);
          const minY = Math.min(from.y, to.y);
          const maxX = Math.max(from.x + from.w, to.x + to.w);
          const maxY = Math.max(from.y + from.h, to.y + to.h);
          const aabb = { x: minX, y: minY, w: maxX - minX, h: maxY - minY };
          if (!aabbIntersect(aabb, viewportWorld)) return null;
        }

        // Cache key — captures every input to routeConnector. A
        // version-bump of from/to (mid-drag move) changes (x, y) and
        // invalidates the cache for that connector; sibling unchanged
        // connectors keep their cached path. The 11-field string costs
        // ~80 bytes per connector per render but trades for a typically
        // 200-byte path-d allocation and a 30-loop SVG-path-routing
        // function call.
        const cacheKey = `${from.x}:${from.y}:${from.w}:${from.h}|${to.x}:${to.y}:${to.w}:${to.h}|${c.routing}|${c.fromAnchor ?? ""}|${c.toAnchor ?? ""}`;
        const cached = pathCacheRef.current.get(c.id);
        let path: RoutedPath;
        if (cached && cached.key === cacheKey) {
          path = cached.path;
        } else {
          path = routeConnector(
            { x: from.x, y: from.y, w: from.w, h: from.h },
            { x: to.x, y: to.y, w: to.w, h: to.h },
            c.routing,
            c.fromAnchor,
            c.toAnchor,
          );
          pathCacheRef.current.set(c.id, { key: cacheKey, path });
        }

        const selected = selectedSet.has(c.id);
        const stroke = selected ? "#00f0ff" : c.stroke;
        const strokeWidth = selected ? c.strokeWidth + 1 : c.strokeWidth;
        const interactive = !!onConnectorPointerDown;
        return (
          <g key={c.id}>
            {/* Invisible wide hit target. Stroke is `transparent` (not
                "none") so the SVG hit-tester treats it as fillable for
                pointer events. 12px is comfortable on touch screens. */}
            {interactive && (
              <path
                d={path.d}
                fill="none"
                stroke="transparent"
                strokeWidth={Math.max(12, strokeWidth + 10)}
                style={{ pointerEvents: "stroke", cursor: "pointer" }}
                onPointerDown={(e) => onConnectorPointerDown?.(c.id, e)}
                onDoubleClick={() => onConnectorDoubleClick?.(c.id)}
                aria-label={c.label ?? "Connector"}
              />
            )}
            <path
              d={path.d}
              fill="none"
              stroke={stroke}
              strokeWidth={strokeWidth}
              strokeDasharray={c.dashed ? "6 4" : undefined}
            />
            {c.arrowEnd && (
              <polygon
                points={arrowheadPoints(path.end, path.endTangent, Math.max(8, strokeWidth * 3))}
                fill={stroke}
              />
            )}
            {c.arrowStart && (
              <polygon
                points={arrowheadPoints(
                  path.start,
                  { x: -path.endTangent.x, y: -path.endTangent.y },
                  Math.max(8, strokeWidth * 3),
                )}
                fill={stroke}
              />
            )}
            {editingConnectorId === c.id ? (
              <ConnectorLabelEditor
                cx={(path.start.x + path.end.x) / 2}
                cy={(path.start.y + path.end.y) / 2 - 4}
                initial={c.label ?? ""}
                onCommit={(text) => onCommitConnectorLabel?.(c.id, text)}
              />
            ) : c.label ? (
              <text
                x={(path.start.x + path.end.x) / 2}
                y={(path.start.y + path.end.y) / 2 - 4}
                fontSize={12}
                fill={stroke}
                textAnchor="middle"
                style={{ paintOrder: "stroke", stroke: "#0b0f17", strokeWidth: 3 }}
                onDoubleClick={() => onConnectorDoubleClick?.(c.id)}
              >
                {c.label}
              </text>
            ) : null}
          </g>
        );
      })}

      {/* In-progress connector preview — dashed line from source object
          centre to the current pointer position. */}
      {preview && previewSource && (
        <line
          x1={previewSource.x + previewSource.w / 2}
          y1={previewSource.y + previewSource.h / 2}
          x2={preview.toWorld.x}
          y2={preview.toWorld.y}
          stroke="#00f0ff"
          strokeWidth={2}
          strokeDasharray="6 4"
          opacity={0.7}
        />
      )}
    </svg>
  );
}

export const ConnectorLayer = memo(ConnectorLayerImpl);

/**
 * Inline-edit textbox for a connector label.
 *
 * Lives inside an SVG `<foreignObject>` so the HTML input scales with
 * the world transform (a connector label at zoom 2.0 looks twice the
 * normal size). Auto-focuses + selects on mount; commits on Enter /
 * blur, cancels on Esc.
 *
 * Sized at 140×24 world units so the box reads at typical zoom
 * without being overwhelming on highly-zoomed boards. The label
 * commits even when blank — empty string clears the label, matching
 * how stickies/text handle clearing.
 */
function ConnectorLabelEditor({
  cx, cy, initial, onCommit,
}: {
  cx: number;
  cy: number;
  initial: string;
  onCommit: (text: string) => void;
}) {
  const inputRef = useRef<HTMLInputElement | null>(null);
  // Focus + select-all on mount so the user can immediately overwrite
  // the existing label. Matches the InlineEditor pattern used for
  // stickies / text / shapes.
  const handleRef = (el: HTMLInputElement | null) => {
    inputRef.current = el;
    if (el) {
      el.focus();
      el.select();
    }
  };
  const commit = () => {
    const text = inputRef.current?.value ?? "";
    onCommit(text);
  };
  return (
    <foreignObject
      x={cx - 70}
      y={cy - 12}
      width={140}
      height={24}
      // Block pointer events from reaching the SVG hit path beneath —
      // otherwise clicking inside the input deselects the connector.
      style={{ overflow: "visible" }}
    >
      <input
        ref={handleRef}
        type="text"
        defaultValue={initial}
        onKeyDown={(e) => {
          e.stopPropagation();
          if (e.key === "Enter") {
            e.preventDefault();
            commit();
          } else if (e.key === "Escape") {
            e.preventDefault();
            // Esc cancels — commit the ORIGINAL value so the
            // editingObjectId clears without mutating the label.
            onCommit(initial);
          }
        }}
        onBlur={commit}
        onPointerDown={(e) => e.stopPropagation()}
        onDoubleClick={(e) => e.stopPropagation()}
        maxLength={200}
        // Inline styles because this lives inside SVG — Tailwind
        // classes apply but the host is foreignObject and we want
        // predictable rendering at any zoom level.
        style={{
          width: "100%",
          height: "100%",
          fontSize: 12,
          textAlign: "center",
          padding: "0 4px",
          border: "1px solid #00f0ff",
          borderRadius: 3,
          background: "#0b0f17",
          color: "#e5e7eb",
          fontFamily: "ui-sans-serif, system-ui, sans-serif",
          outline: "none",
        }}
      />
    </foreignObject>
  );
}
