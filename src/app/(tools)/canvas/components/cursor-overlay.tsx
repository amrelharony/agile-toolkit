"use client";

import { memo, useMemo } from "react";
import { MousePointer2 } from "lucide-react";
import type { Camera, Rect } from "@/lib/geometry/bbox";
import { rectUnion } from "@/lib/geometry/bbox";
import type { SimplePresence } from "@/lib/realtime/use-presence";
import type { WhiteboardObject } from "@/lib/stores/workspace-types";

interface CursorOverlayProps {
  members: readonly SimplePresence[];
  selfId: string;
  camera: Camera;
  objectsById: Map<string, WhiteboardObject>;
}

/**
 * Render remote pointers + remote selection boxes.
 *
 * - Pointer + nameplate at the peer's world cursor (projected to screen).
 * - Per-peer selection outline in their presence color, computed from the
 *   union bbox of their declared selection IDs (filtered to objects we
 *   actually have — peers might select ids we haven't synced yet, in
 *   which case the box just shrinks).
 */
function CursorOverlayImpl({ members, selfId, camera, objectsById }: CursorOverlayProps) {
  const remotes = useMemo(
    () => members.filter((m) => m.id !== selfId),
    [members, selfId],
  );

  return (
    <>
      {remotes.map((m) => {
        const items: React.ReactNode[] = [];

        // Selection outline rendered first so the cursor sits on top.
        if (m.selection && m.selection.length > 0) {
          let bbox: Rect | null = null;
          for (const id of m.selection) {
            const o = objectsById.get(id);
            if (!o) continue;
            const r = { x: o.x, y: o.y, w: o.w, h: o.h };
            bbox = bbox ? rectUnion(bbox, r) : r;
          }
          if (bbox) {
            const x = (bbox.x - camera.x) * camera.zoom;
            const y = (bbox.y - camera.y) * camera.zoom;
            const w = bbox.w * camera.zoom;
            const h = bbox.h * camera.zoom;
            items.push(
              <div
                key={`sel-${m.id}`}
                aria-hidden="true"
                style={{
                  position: "absolute",
                  left: x - 1,
                  top: y - 1,
                  width: w + 2,
                  height: h + 2,
                  border: `1.5px solid ${m.color}`,
                  pointerEvents: "none",
                  zIndex: 9994,
                  opacity: 0.7,
                  borderRadius: 4,
                }}
              />,
            );
          }
        }

        if (m.cursor) {
          const cx = (m.cursor.x - camera.x) * camera.zoom;
          const cy = (m.cursor.y - camera.y) * camera.zoom;
          items.push(
            <div
              key={`cur-${m.id}`}
              aria-hidden="true"
              style={{
                position: "absolute",
                left: cx,
                top: cy,
                pointerEvents: "none",
                zIndex: 9995,
                transform: "translate(-2px, -2px)",
                transition: "left 60ms linear, top 60ms linear",
              }}
            >
              <MousePointer2
                style={{ color: m.color, width: 18, height: 18, filter: "drop-shadow(0 1px 2px rgba(0,0,0,0.6))" }}
              />
              <div
                style={{
                  background: m.color,
                  color: "#0b0f17",
                  fontSize: 10,
                  fontFamily: "ui-monospace, monospace",
                  padding: "2px 5px",
                  borderRadius: 3,
                  marginTop: 2,
                  marginLeft: 14,
                  fontWeight: 700,
                  whiteSpace: "nowrap",
                  width: "fit-content",
                }}
              >
                {m.name}
              </div>
            </div>,
          );
        }

        return <div key={m.id}>{items}</div>;
      })}
    </>
  );
}

export const CursorOverlay = memo(CursorOverlayImpl);
