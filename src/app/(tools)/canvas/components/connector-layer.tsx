"use client";

import { memo, useMemo } from "react";
import type { WhiteboardObject, WhiteboardConnector } from "@/lib/stores/workspace-types";
import { routeConnector, arrowheadPoints } from "@/lib/geometry/path-routing";

interface ConnectorLayerProps {
  objects: readonly WhiteboardObject[];
  /** Active selection — selected connectors render thicker. */
  selectedIds: readonly string[];
  /** Optional pending-connector preview: from-object-id + cursor world point. */
  preview?: { fromId: string; toWorld: { x: number; y: number } } | null;
  /** Called when the user clicks a connector path. Wires connector
   * selection. Without this the connector layer is purely cosmetic. */
  onConnectorPointerDown?: (id: string, e: React.PointerEvent) => void;
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
 */
function ConnectorLayerImpl({ objects, selectedIds, preview, onConnectorPointerDown }: ConnectorLayerProps) {
  const byId = useMemo(() => {
    const m = new Map<string, WhiteboardObject>();
    for (const o of objects) m.set(o.id, o);
    return m;
  }, [objects]);

  const connectors = useMemo(
    () => objects.filter((o): o is WhiteboardConnector => o.type === "connector"),
    [objects],
  );

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
        const path = routeConnector(
          { x: from.x, y: from.y, w: from.w, h: from.h },
          { x: to.x, y: to.y, w: to.w, h: to.h },
          c.routing,
          c.fromAnchor,
          c.toAnchor,
        );
        const selected = selectedIds.includes(c.id);
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
            {c.label && (
              <text
                x={(path.start.x + path.end.x) / 2}
                y={(path.start.y + path.end.y) / 2 - 4}
                fontSize={12}
                fill={stroke}
                textAnchor="middle"
                style={{ paintOrder: "stroke", stroke: "#0b0f17", strokeWidth: 3 }}
              >
                {c.label}
              </text>
            )}
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
