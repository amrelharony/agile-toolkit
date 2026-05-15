"use client";

import { memo } from "react";
import { Lock } from "lucide-react";
import type { WhiteboardObject } from "@/lib/stores/workspace-types";

interface ObjectRendererProps {
  object: WhiteboardObject;
  selected: boolean;
  onPointerDown?: (e: React.PointerEvent, id: string) => void;
}

/**
 * Whitelist for image/embed src URLs. Anything outside this list — most
 * importantly `javascript:` / `vbscript:` / `data:text/html` — gets
 * blanked out before the URL reaches the browser. Modern browsers won't
 * execute `javascript:` in `<img src>` anyway, but defensive
 * sanitization is cheap and protects against future renderer changes
 * (e.g. embedding via iframe).
 */
function safeImageSrc(src: string): string {
  if (typeof src !== "string") return "";
  const t = src.trim();
  if (/^https?:/i.test(t)) return t;
  if (/^data:image\//i.test(t)) return t;
  return "";
}

/**
 * Tiny lock badge in the top-right corner of locked objects. Without
 * this users have no signal that an object is locked except for the
 * "move" cursor mysteriously failing.
 */
function LockBadge({ z }: { z: number }) {
  return (
    <div
      aria-label="Locked"
      style={{
        position: "absolute",
        top: 4,
        right: 4,
        width: 16,
        height: 16,
        borderRadius: 4,
        background: "rgba(0,0,0,0.55)",
        color: "#fde68a",
        display: "flex",
        alignItems: "center",
        justifyContent: "center",
        zIndex: z + 1,
        pointerEvents: "none",
      }}
    >
      <Lock style={{ width: 10, height: 10 }} aria-hidden="true" />
    </div>
  );
}

/**
 * Stateless render of a single whiteboard object. All interactivity is
 * delegated up via `onPointerDown` — the viewport decides whether to
 * start a drag, open an editor, etc.
 *
 * The renderer is split per-type via a switch, each branch kept simple
 * so future tweaks land cleanly. Memoised so a 100-object board doesn't
 * re-render every object on every camera tick.
 */
function ObjectRendererImpl({ object: o, selected, onPointerDown }: ObjectRendererProps) {
  const handle = (e: React.PointerEvent) => onPointerDown?.(e, o.id);
  const selectionStyle = selected
    ? { boxShadow: "0 0 0 2px #00f0ff, 0 0 12px rgba(0,240,255,0.4)" }
    : undefined;

  switch (o.type) {
    case "sticky":
      return (
        <div
          onPointerDown={handle}
          style={{
            position: "absolute",
            // `transform: translate3d` instead of left/top so the browser
            // promotes each object to its own GPU layer; left/top mutations
            // trigger layout, transform mutations only compositor work. At
            // 500 objects with frequent drags this is the difference
            // between a steady 60 fps and a stuttering 20 fps.
            left: 0,
            top: 0,
            transform: `translate3d(${o.x}px, ${o.y}px, 0)${o.rotation ? ` rotate(${o.rotation}deg)` : ""}`,
            width: o.w,
            height: o.h,
            background: o.color,
            color: o.textColor ?? "#0b0f17",
            padding: 10,
            boxSizing: "border-box",
            borderRadius: 6,
            fontSize: o.fontSize ?? 14,
            fontFamily: "ui-sans-serif, system-ui, sans-serif",
            whiteSpace: "pre-wrap",
            wordWrap: "break-word",
            cursor: o.locked ? "default" : "move",
            userSelect: "none",
            boxShadow: selected ? selectionStyle?.boxShadow : "0 1px 3px rgba(0,0,0,0.3)",
            zIndex: o.z,
            opacity: o.locked ? 0.85 : 1,
          }}
        >
          {o.content || <span style={{ opacity: 0.4 }}>Sticky note</span>}
          {o.locked && <LockBadge z={o.z} />}
        </div>
      );

    case "rect":
    case "ellipse":
    case "diamond":
    case "triangle": {
      const fill = o.fill ?? "transparent";
      const stroke = o.stroke ?? "#94a3b8";
      const strokeWidth = o.strokeWidth ?? 1.5;
      let shape: React.ReactNode = null;
      if (o.type === "rect") {
        shape = (
          <rect
            x={strokeWidth / 2}
            y={strokeWidth / 2}
            width={o.w - strokeWidth}
            height={o.h - strokeWidth}
            fill={fill}
            stroke={stroke}
            strokeWidth={strokeWidth}
            rx={4}
          />
        );
      } else if (o.type === "ellipse") {
        shape = (
          <ellipse
            cx={o.w / 2}
            cy={o.h / 2}
            rx={Math.max(0, o.w / 2 - strokeWidth / 2)}
            ry={Math.max(0, o.h / 2 - strokeWidth / 2)}
            fill={fill}
            stroke={stroke}
            strokeWidth={strokeWidth}
          />
        );
      } else if (o.type === "diamond") {
        shape = (
          <polygon
            points={`${o.w / 2},0 ${o.w},${o.h / 2} ${o.w / 2},${o.h} 0,${o.h / 2}`}
            fill={fill}
            stroke={stroke}
            strokeWidth={strokeWidth}
          />
        );
      } else {
        shape = (
          <polygon
            points={`${o.w / 2},0 ${o.w},${o.h} 0,${o.h}`}
            fill={fill}
            stroke={stroke}
            strokeWidth={strokeWidth}
          />
        );
      }
      return (
        <div
          onPointerDown={handle}
          style={{
            position: "absolute",
            left: 0,
            top: 0,
            transform: `translate3d(${o.x}px, ${o.y}px, 0)${o.rotation ? ` rotate(${o.rotation}deg)` : ""}`,
            width: o.w,
            height: o.h,
            cursor: o.locked ? "default" : "move",
            opacity: o.locked ? 0.85 : 1,
            ...selectionStyle,
            zIndex: o.z,
          }}
        >
          <svg width={o.w} height={o.h} style={{ display: "block" }}>
            {shape}
          </svg>
          {o.content && (
            <div
              style={{
                position: "absolute",
                inset: 0,
                display: "flex",
                alignItems: "center",
                justifyContent: "center",
                color: "#e5e7eb",
                fontSize: 14,
                fontFamily: "ui-sans-serif, system-ui, sans-serif",
                textAlign: "center",
                padding: 8,
                pointerEvents: "none",
              }}
            >
              {o.content}
            </div>
          )}
          {o.locked && <LockBadge z={o.z} />}
        </div>
      );
    }

    case "text":
      return (
        <div
          onPointerDown={handle}
          style={{
            position: "absolute",
            left: 0,
            top: 0,
            transform: `translate3d(${o.x}px, ${o.y}px, 0)${o.rotation ? ` rotate(${o.rotation}deg)` : ""}`,
            width: o.w,
            minHeight: o.h,
            color: o.color,
            fontSize: o.fontSize,
            fontWeight: o.fontWeight ?? 400,
            textAlign: o.align ?? "left",
            cursor: o.locked ? "default" : "move",
            opacity: o.locked ? 0.85 : 1,
            userSelect: "none",
            fontFamily: "ui-sans-serif, system-ui, sans-serif",
            whiteSpace: "pre-wrap",
            wordWrap: "break-word",
            ...selectionStyle,
            zIndex: o.z,
          }}
        >
          {o.content || <span style={{ opacity: 0.4 }}>Text</span>}
          {o.locked && <LockBadge z={o.z} />}
        </div>
      );

    case "frame":
      return (
        <div
          onPointerDown={handle}
          style={{
            position: "absolute",
            left: 0,
            top: 0,
            transform: `translate3d(${o.x}px, ${o.y}px, 0)${o.rotation ? ` rotate(${o.rotation}deg)` : ""}`,
            width: o.w,
            height: o.h,
            border: "1px dashed #475569",
            borderRadius: 8,
            background: o.fill ?? "transparent",
            zIndex: o.z,
            pointerEvents: "auto",
            opacity: o.locked ? 0.85 : 1,
            ...selectionStyle,
          }}
        >
          <div
            style={{
              position: "absolute",
              top: -22,
              left: 6,
              fontSize: 12,
              color: "#94a3b8",
              fontFamily: "ui-sans-serif, system-ui, sans-serif",
              background: "#0b0f17",
              padding: "1px 6px",
              borderRadius: 3,
            }}
          >
            {o.label}
          </div>
          {o.locked && <LockBadge z={o.z} />}
        </div>
      );

    case "line":
    case "arrow": {
      // World coords: (x, y) start; (x+w, y+h) end. We render into a
      // bounding-box SVG and align with absolute positioning.
      const minX = Math.min(0, o.w);
      const minY = Math.min(0, o.h);
      const w = Math.abs(o.w);
      const h = Math.abs(o.h);
      const sx = -minX;
      const sy = -minY;
      const ex = sx + o.w;
      const ey = sy + o.h;
      return (
        <div
          onPointerDown={handle}
          style={{
            position: "absolute",
            left: 0,
            top: 0,
            transform: `translate3d(${o.x + minX}px, ${o.y + minY}px, 0)`,
            width: w || 1,
            height: h || 1,
            cursor: o.locked ? "default" : "move",
            zIndex: o.z,
            opacity: o.locked ? 0.85 : 1,
            ...selectionStyle,
          }}
        >
          <svg width="100%" height="100%" overflow="visible">
            <line
              x1={sx}
              y1={sy}
              x2={ex}
              y2={ey}
              stroke={o.stroke}
              strokeWidth={o.strokeWidth}
              strokeDasharray={o.dashed ? "6 4" : undefined}
            />
            {o.type === "arrow" && (
              <polygon
                points={arrowheadPoints({ x: ex, y: ey }, { x: o.w, y: o.h }, Math.max(8, o.strokeWidth * 3))}
                fill={o.stroke}
              />
            )}
          </svg>
          {o.locked && <LockBadge z={o.z} />}
        </div>
      );
    }

    case "freehand": {
      // We draw freehand objects as their own SVG path inside a div that
      // covers the object's bbox in world coords. Points are world-coords;
      // shift them into the local svg coord system.
      const { points } = o;
      if (points.length < 4) return null;
      const path = points
        .map((v, i) => (i % 2 === 0 ? `${i === 0 ? "M" : "L"}${v - o.x}` : ` ${v - o.y}`))
        .join("");
      return (
        <div
          onPointerDown={handle}
          style={{
            position: "absolute",
            left: 0,
            top: 0,
            transform: `translate3d(${o.x}px, ${o.y}px, 0)`,
            width: o.w || 1,
            height: o.h || 1,
            cursor: o.locked ? "default" : "move",
            zIndex: o.z,
            opacity: o.locked ? 0.85 : 1,
            ...selectionStyle,
          }}
        >
          <svg width="100%" height="100%" overflow="visible">
            <path
              d={path}
              fill="none"
              stroke={o.stroke}
              strokeWidth={o.strokeWidth}
              strokeLinecap="round"
              strokeLinejoin="round"
            />
          </svg>
          {o.locked && <LockBadge z={o.z} />}
        </div>
      );
    }

    case "image": {
      // SECURITY: o.src is user-controlled (paste, cross-tool import,
      // realtime patch). Block anything outside the http(s)/data:image
      // whitelist. Modern browsers don't fire JS from `<img src>` for
      // javascript: URLs, but stripping defensively guards against
      // future renderer changes (iframe/object) reusing this code path.
      const safeSrc = safeImageSrc(o.src);
      return (
        <div
          onPointerDown={handle}
          style={{
            position: "absolute",
            left: 0,
            top: 0,
            transform: `translate3d(${o.x}px, ${o.y}px, 0)${o.rotation ? ` rotate(${o.rotation}deg)` : ""}`,
            width: o.w,
            height: o.h,
            cursor: o.locked ? "default" : "move",
            zIndex: o.z,
            opacity: o.locked ? 0.85 : 1,
            ...selectionStyle,
          }}
        >
          <img
            src={safeSrc}
            alt={o.alt ?? ""}
            style={{
              width: "100%",
              height: "100%",
              objectFit: o.fit === "cover" ? "cover" : "contain",
              display: "block",
              pointerEvents: "none",
            }}
            draggable={false}
          />
          {o.locked && <LockBadge z={o.z} />}
        </div>
      );
    }

    case "embed":
      return (
        <div
          onPointerDown={handle}
          style={{
            position: "absolute",
            left: 0,
            top: 0,
            transform: `translate3d(${o.x}px, ${o.y}px, 0)`,
            width: o.w,
            height: o.h,
            background: "#1e293b",
            border: "1px solid #475569",
            color: "#94a3b8",
            fontSize: 12,
            display: "flex",
            alignItems: "center",
            justifyContent: "center",
            cursor: o.locked ? "default" : "move",
            zIndex: o.z,
            opacity: o.locked ? 0.85 : 1,
            ...selectionStyle,
          }}
        >
          {o.kind}: {(o.src ?? "").slice(0, 40)}
          {o.locked && <LockBadge z={o.z} />}
        </div>
      );

    default:
      // `connector` is rendered separately in a single SVG layer covering
      // the whole canvas — connectors reference other objects' positions,
      // so it's easier to draw them once with all positions known.
      return null;
  }
}

function arrowheadPoints(tip: { x: number; y: number }, dir: { x: number; y: number }, size: number): string {
  const len = Math.hypot(dir.x, dir.y) || 1;
  const ux = dir.x / len;
  const uy = dir.y / len;
  const px = -uy;
  const py = ux;
  const baseX = tip.x - ux * size;
  const baseY = tip.y - uy * size;
  return `${tip.x},${tip.y} ${baseX + px * size * 0.5},${baseY + py * size * 0.5} ${baseX - px * size * 0.5},${baseY - py * size * 0.5}`;
}

export const ObjectRenderer = memo(ObjectRendererImpl);
