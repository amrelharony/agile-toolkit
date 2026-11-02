"use client";

import type { Camera, Rect } from "@/lib/geometry/bbox";
import type { CanvasTool } from "../use-canvas-store";

type PeerMember = {
  id: string;
  name: string;
  color: string;
};

/**
 * Top-right cluster of peer chips + Bring-all + Spotlight buttons.
 *
 * Clicking a peer chip toggles "follow user" mode so the local camera
 * tracks their viewport. The local user's own chip is filtered out.
 *
 * Bring-all broadcasts the local camera's world rect to every peer
 * so they fit-to-rect on receipt. Spotlight broadcasts the current
 * selection bbox (or full viewport if nothing's selected) and
 * triggers an 8s dimmed-surround flash on every peer's screen.
 */
export function PresenceChips(props: {
  members: readonly PeerMember[];
  selfId: string;
  followUserId: string | null;
  setFollowUserId: (id: string | null) => void;
  camera: Camera;
  size: { w: number; h: number };
  broadcastFocus: (kind: "snap" | "spotlight", rect: Rect) => void;
  selectionBbox: Rect | null;
  selection: readonly string[];
  logActivity: (kind: string, summary: string) => void;
}) {
  const {
    members,
    selfId,
    followUserId,
    setFollowUserId,
    camera,
    size,
    broadcastFocus,
    selectionBbox,
    selection,
    logActivity,
  } = props;

  if (members.length === 0) return null;

  return (
    <div
      className="absolute top-3 right-3 z-20 flex items-center gap-1"
      data-canvas-export-ignore="true"
    >
      {members
        .filter((m) => m.id !== selfId)
        .slice(0, 8)
        .map((m) => {
          const isFollowing = followUserId === m.id;
          return (
            <button
              key={m.id}
              type="button"
              title={isFollowing ? `Stop following ${m.name}` : `Follow ${m.name}`}
              aria-label={isFollowing ? `Stop following ${m.name}` : `Follow ${m.name}`}
              onClick={() => setFollowUserId(isFollowing ? null : m.id)}
              style={{
                width: 26,
                height: 26,
                borderRadius: "50%",
                background: m.color,
                color: "#0b0f17",
                display: "flex",
                alignItems: "center",
                justifyContent: "center",
                fontSize: 11,
                fontWeight: 700,
                border: isFollowing ? "2px solid var(--accent)" : "2px solid #0b0f17",
                marginLeft: -6,
                cursor: "pointer",
                boxShadow: isFollowing
                  ? "0 0 8px color-mix(in srgb, var(--accent) 60%, transparent)"
                  : undefined,
              }}
            >
              {m.name.charAt(0).toUpperCase()}
            </button>
          );
        })}
      {followUserId && (
        <button
          type="button"
          onClick={() => setFollowUserId(null)}
          aria-label="Stop following"
          title="Stop following"
          className="ml-1 text-xs uppercase font-mono text-accent hover:text-text px-2 py-1 rounded bg-surface/95 border border-accent"
        >
          following
        </button>
      )}
      <button
        type="button"
        onClick={() => {
          if (size.w === 0) return;
          broadcastFocus("snap", {
            x: camera.x,
            y: camera.y,
            w: size.w / Math.max(0.001, camera.zoom),
            h: size.h / Math.max(0.001, camera.zoom),
          });
          logActivity("focus", "Brought peers to my view");
        }}
        aria-label="Bring everyone to my view"
        title="Bring everyone to me"
        className="ml-1 text-xs uppercase font-mono text-sub hover:text-text px-2 py-1 rounded bg-surface/95 border border-border"
      >
        Bring all
      </button>
      <button
        type="button"
        onClick={() => {
          const target = selectionBbox ?? {
            x: camera.x,
            y: camera.y,
            w: size.w / Math.max(0.001, camera.zoom),
            h: size.h / Math.max(0.001, camera.zoom),
          };
          broadcastFocus("spotlight", target);
          logActivity(
            "spotlight",
            selectionBbox
              ? `Spotlighted ${selection.length} object${selection.length === 1 ? "" : "s"}`
              : "Spotlighted my view"
          );
        }}
        aria-label="Spotlight"
        title="Spotlight (8s flash on peer screens)"
        className="ml-1 text-xs uppercase font-mono text-sub hover:text-text px-2 py-1 rounded bg-surface/95 border border-border"
      >
        Spotlight
      </button>
    </div>
  );
}

/**
 * Dimmed surround with a cutout over a world rect — fires when a peer
 * spotlights an area. Local camera stays put (so each user keeps their
 * own view) but the highlight tells them where to look.
 *
 * Implementation note: four CSS gradients form the cutout rather than
 * `clip-path`. Simpler than the clip-path on older browsers and avoids
 * the radial-gradient fade that doesn't read as "look exactly here."
 */
export function SpotlightCutout(props: {
  rect: Rect;
  camera: Camera;
  size: { w: number; h: number };
}) {
  const { rect, camera, size } = props;
  if (size.w === 0) return null;
  const sx = (rect.x - camera.x) * camera.zoom;
  const sy = (rect.y - camera.y) * camera.zoom;
  const sw = rect.w * camera.zoom;
  const sh = rect.h * camera.zoom;
  return (
    <div
      aria-hidden="true"
      data-canvas-export-ignore="true"
      style={{
        position: "absolute",
        inset: 0,
        pointerEvents: "none",
        zIndex: 9993,
        background: `
          linear-gradient(to bottom, rgba(0,0,0,0.55) ${sy}px, transparent ${sy}px, transparent ${sy + sh}px, rgba(0,0,0,0.55) ${sy + sh}px),
          linear-gradient(to right, rgba(0,0,0,0.55) ${sx}px, transparent ${sx}px, transparent ${sx + sw}px, rgba(0,0,0,0.55) ${sx + sw}px)
        `,
        backgroundBlendMode: "lighten",
      }}
    >
      <div
        style={{
          position: "absolute",
          left: sx - 2,
          top: sy - 2,
          width: sw + 4,
          height: sh + 4,
          border: "2px solid var(--accent)",
          boxShadow: "0 0 24px color-mix(in srgb, var(--accent) 70%, transparent)",
          borderRadius: 6,
        }}
      />
    </div>
  );
}

/**
 * Tiny instructional banner top-centre when the connector tool is
 * active. Two states: pre-source-click and post-source-click. Hidden
 * outside connector tool. pointer-events: none so it never steals
 * clicks from the canvas underneath.
 */
export function ConnectorBanner(props: {
  tool: CanvasTool;
  pendingConnectorFromId: string | null;
}) {
  const { tool, pendingConnectorFromId } = props;
  if (tool !== "connector") return null;
  return (
    <div className="absolute top-3 left-1/2 -translate-x-1/2 z-20 pointer-events-none">
      <div className="bg-card border border-accent text-accent text-xs px-3 py-1.5 rounded-full font-mono backdrop-blur-sm">
        {pendingConnectorFromId
          ? "Now click the target object · Esc to cancel"
          : "Click the source object, then click the target"}
      </div>
    </div>
  );
}

/**
 * Bottom-edge hint for empty boards. The centred CTA card ("Start
 * your board" with Templates / Import buttons) lives in
 * canvas-client.tsx — this hint sits at the bottom edge so it doesn't
 * fight that CTA visually and stays useful the moment the user picks
 * a tool to dismiss the CTA.
 */
export function EmptyCanvasHint(props: { objectCount: number }) {
  if (props.objectCount !== 0) return null;
  return (
    <div
      className="absolute bottom-3 left-1/2 -translate-x-1/2 pointer-events-none text-xs text-sub font-mono text-center"
      data-canvas-export-ignore="true"
    >
      Hold <kbd className="px-1 bg-surface/70 border border-border rounded text-xs">Space</kbd> +
      drag to pan · scroll to zoom
    </div>
  );
}
