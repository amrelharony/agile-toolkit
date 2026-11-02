"use client";

/**
 * Image object view. Extracted verbatim from object-renderer's `case "image"`.
 * SECURITY: the src runs through safeImageSrc (http(s)/raster-data-URL allowlist)
 * before reaching the <img>.
 */

import React from "react";
import type { WhiteboardImage } from "@/lib/stores/workspace-types";
import { safeImageSrc } from "../../lib/object-render-utils";
import { LockBadge } from "./object-render-primitives";
import type { ObjectViewBaseProps } from "./object-view-shared";

export function ImageObject({
  object: o,
  selected,
  onPointerDown,
}: ObjectViewBaseProps & { object: WhiteboardImage }) {
  const handle = (e: React.PointerEvent) => onPointerDown?.(e, o.id);
  const selectionStyle = selected
    ? {
        boxShadow:
          "0 0 0 2px var(--accent), 0 0 12px color-mix(in srgb, var(--accent) 40%, transparent)",
      }
    : undefined;

  // SECURITY: o.src is user-controlled (paste, cross-tool import,
  // realtime patch). Block anything outside the http(s)/data:image
  // whitelist. Modern browsers don't fire JS from `<img src>` for
  // javascript: URLs, but stripping defensively guards against
  // future renderer changes (iframe/object) reusing this code path.
  const safeSrc = safeImageSrc(o.src);
  return (
    <div
      onPointerDown={handle}
      data-canvas-object-kind="image"
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
      {/* eslint-disable-next-line @next/next/no-img-element */}
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
