"use client";

import { memo, useEffect, useMemo, useState } from "react";
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
 * Tick state on a 250 ms interval so chatBubble + reaction TTL fields
 * actually animate out — without this, an expired bubble would linger
 * until the peer broadcast another patch.
 *
 * Only ticks when `active` is true. On an empty board with no remote
 * chat / reactions, the interval is never armed — saves 5 re-renders
 * per second of pure waste.
 */
function useNowTick(intervalMs = 250, active = true): number {
  // R11-fix: initial state is 0, not `Date.now()`. The previous
  // `useState(() => Date.now())` produced a different timestamp on
  // the server (during the SSR render of this client component) and
  // on the client, triggering a hydration mismatch + warning on every
  // canvas page load. The first useEffect tick replaces 0 with the
  // real timestamp; ephemeral TTL checks against `now === 0` resolve
  // as "already-expired", which is safe (expired bubbles/reactions
  // simply don't render, matching the no-bubble case).
  const [now, setNow] = useState(0);
  useEffect(() => {
    setNow(Date.now());
    if (!active) return;
    // Belt-and-suspenders: even though React calls our cleanup when
    // `active` flips, the tick itself re-checks `active` so a stale
    // interval (e.g. from a race between unmount + ref dropping)
    // can't push a setState into an inactive overlay. M21.
    let stopped = false;
    const h = setInterval(() => {
      if (stopped) return;
      setNow(Date.now());
    }, intervalMs);
    return () => {
      stopped = true;
      clearInterval(h);
    };
  }, [intervalMs, active]);
  return now;
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
  // Only tick while at least one remote peer has a chatBubble or
  // reaction with a non-expired TTL — otherwise the 200ms re-render
  // is pure waste on idle/solo sessions.
  const hasEphemeral = useMemo(
    () => remotes.some((m) => m.chatBubble || m.reaction),
    [remotes],
  );
  const now = useNowTick(200, hasEphemeral);

  return (
    <>
      {remotes.map((m) => {
        const items: React.ReactNode[] = [];

        // Emoji reactions — render even when the peer's cursor has
        // moved past the spawn point. Float up over 6s; opacity fades
        // in the last 2s.
        if (m.reaction && m.reaction.expiresAt > now) {
          const r = m.reaction;
          const rx = (r.x - camera.x) * camera.zoom;
          const ry = (r.y - camera.y) * camera.zoom;
          // Lifetime ratio (0 just emitted → 1 about to expire).
          const lifeMs = 6000;
          const remaining = Math.max(0, r.expiresAt - now);
          const elapsed = lifeMs - remaining;
          const t = Math.min(1, elapsed / lifeMs);
          const float = -40 * t;
          const opacity = t < 0.7 ? 1 : Math.max(0, 1 - (t - 0.7) / 0.3);
          items.push(
            <div
              key={`react-${m.id}-${r.expiresAt}`}
              aria-hidden="true"
              style={{
                position: "absolute",
                left: rx,
                top: ry + float,
                transform: "translate(-50%, -50%)",
                fontSize: 28,
                pointerEvents: "none",
                zIndex: 9996,
                opacity,
                textShadow: "0 1px 2px rgba(0,0,0,0.6)",
              }}
            >
              {r.emoji}
            </div>,
          );
        }

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
          const showBubble = m.chatBubble && m.chatBubble.expiresAt > now;
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
              {showBubble && m.chatBubble && (
                <div
                  // Speech-bubble next to the cursor. Rendered after the
                  // nameplate so the user's name + chat sit naturally
                  // stacked. Word-break + max-width caps abusive payloads
                  // visually (the sanitizer already caps at 200 chars).
                  style={{
                    background: "#0b0f17",
                    color: "#e5e7eb",
                    fontSize: 12,
                    fontFamily: "ui-sans-serif, system-ui, sans-serif",
                    padding: "4px 8px",
                    borderRadius: 8,
                    marginTop: 4,
                    marginLeft: 14,
                    maxWidth: 240,
                    border: `1.5px solid ${m.color}`,
                    boxShadow: "0 2px 6px rgba(0,0,0,0.4)",
                    wordBreak: "break-word",
                    whiteSpace: "pre-wrap",
                    width: "fit-content",
                  }}
                >
                  {m.chatBubble.text}
                </div>
              )}
            </div>,
          );
        }

        return <div key={m.id}>{items}</div>;
      })}
    </>
  );
}

export const CursorOverlay = memo(CursorOverlayImpl);
