"use client";

import { memo } from "react";
import { MessageCircle, CheckCircle2 } from "lucide-react";
import type { Camera } from "@/lib/geometry/bbox";
import type { WhiteboardCommentThread, WhiteboardObject } from "@/lib/stores/workspace-types";

interface Props {
  threads: readonly WhiteboardCommentThread[];
  /** Object lookup so pins pinned to a moving object can follow it.
   * Stable Map<id, object> from the parent (memoised on objects). */
  objectsById: Map<string, WhiteboardObject>;
  camera: Camera;
  activeThreadId: string | null;
  onPinClick: (id: string) => void;
}

/**
 * Comment pins drawn at each thread's world position. Resolved threads
 * show a check icon and dim out. Click a pin to open it in the drawer.
 *
 * If a thread carries an `objectId` we resolve the current world position
 * from the live object (so dragging the object moves its pin); otherwise
 * we fall back to the thread's static (x, y). Without this, pins pinned
 * to stickies stayed at their original world coords even as the sticky
 * moved — a Miro-style "pin follows object" mental model is what users
 * expect.
 */
function CommentPinsImpl({ threads, objectsById, camera, activeThreadId, onPinClick }: Props) {
  // R11-fix: "pin 3 of 12" context so SR users know how many pins
  // exist on the board. It lives in the accessible name — aria-posinset
  // / aria-setsize aren't supported on a button and were ignored.
  const totalPins = threads.length;
  return (
    <>
      {threads.map((t, idx) => {
        // Resolve pin world position: object's bottom-right corner if
        // pinned, else the thread's static point.
        let worldX = t.x;
        let worldY = t.y;
        if (t.objectId) {
          const obj = objectsById.get(t.objectId);
          if (obj) {
            // Bottom-right corner so the pin doesn't overlap the
            // object's content area.
            worldX = obj.x + obj.w - 4;
            worldY = obj.y + obj.h - 4;
          }
        }
        const x = (worldX - camera.x) * camera.zoom;
        const y = (worldY - camera.y) * camera.zoom;
        const active = activeThreadId === t.id;
        return (
          <button
            key={t.id}
            type="button"
            onClick={(e) => {
              e.stopPropagation();
              onPinClick(t.id);
            }}
            aria-label={`Comment thread ${idx + 1} of ${totalPins}${t.resolved ? " (resolved)" : ""} — ${t.comments.length} message${t.comments.length === 1 ? "" : "s"}`}
            style={{
              position: "absolute",
              left: x - 12,
              top: y - 12,
              width: 24,
              height: 24,
              borderRadius: "50% 50% 50% 4px",
              background: t.resolved ? "rgba(52, 211, 153, 0.85)" : "rgba(245, 158, 11, 0.95)",
              border: active ? "2px solid var(--accent)" : "1.5px solid rgba(0,0,0,0.6)",
              color: "#0b0f17",
              display: "flex",
              alignItems: "center",
              justifyContent: "center",
              cursor: "pointer",
              zIndex: 9990,
              boxShadow: "0 2px 6px rgba(0,0,0,0.4)",
              transform: "rotate(-45deg)",
              opacity: t.resolved ? 0.7 : 1,
            }}
          >
            <div style={{ transform: "rotate(45deg)", display: "flex" }}>
              {t.resolved ? (
                <CheckCircle2 className="w-3 h-3" />
              ) : (
                <MessageCircle className="w-3 h-3" />
              )}
            </div>
          </button>
        );
      })}
    </>
  );
}

export const CommentPins = memo(CommentPinsImpl);
