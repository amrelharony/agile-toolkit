"use client";

/**
 * Embed object view. Extracted verbatim from object-renderer's `case "embed"`.
 * SECURITY: the src is normalized to a known embed endpoint via embedIframeUrl,
 * and the iframe sandbox tier is resolved per-host via iframeSandboxFor; an
 * unrecognized/unsafe source falls back to a text placeholder (no iframe).
 */

import React from "react";
import type { WhiteboardEmbed } from "@/lib/stores/workspace-types";
import { embedIframeUrl, iframeSandboxFor } from "../../lib/object-render-utils";
import { LockBadge } from "./object-render-primitives";
import type { ObjectViewBaseProps } from "./object-view-shared";

export function EmbedObject({
  object: o,
  selected,
  onPointerDown,
}: ObjectViewBaseProps & { object: WhiteboardEmbed }) {
  const handle = (e: React.PointerEvent) => onPointerDown?.(e, o.id);
  const selectionStyle = selected
    ? {
        boxShadow:
          "0 0 0 2px var(--accent), 0 0 12px color-mix(in srgb, var(--accent) 40%, transparent)",
      }
    : undefined;

  const iframeSrc = embedIframeUrl(o.src ?? "", o.kind);
  // Compute per-host sandbox tier from the resolved iframe src
  // (NOT the user-typed URL) — embedIframeUrl already normalises
  // figma.com / youtube.com / loom.com to known embed endpoints,
  // so we read the host off the result for accurate routing.
  let iframeHost = "";
  if (iframeSrc) {
    try {
      iframeHost = new URL(iframeSrc).hostname;
    } catch {
      iframeHost = "";
    }
  }
  const sandboxAttr = iframeSandboxFor(iframeHost);
  return (
    <div
      onPointerDown={handle}
      data-canvas-object-kind="embed"
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
        cursor: o.locked ? "default" : "move",
        zIndex: o.z,
        opacity: o.locked ? 0.85 : 1,
        overflow: "hidden",
        ...selectionStyle,
      }}
    >
      {iframeSrc ? (
        <>
          <iframe
            src={iframeSrc}
            title={`${o.kind} embed`}
            // SECURITY: sandbox tier is resolved per-host via
            // `iframeSandboxFor`. Most hosts (YouTube, Google Docs,
            // generic embeds) get the strict tier. Figma + Loom
            // need `allow-same-origin` to retain signed-in state;
            // since those hosts run in their OWN third-party
            // origin, the spec's "scripts + same-origin from the
            // SAME origin lets the iframe drop its sandbox"
            // footgun does NOT apply.
            sandbox={sandboxAttr}
            allow="autoplay; fullscreen; picture-in-picture"
            referrerPolicy="no-referrer"
            loading="lazy"
            style={{
              width: "100%",
              height: "100%",
              border: "none",
              // Block pointer events when locked or when this is
              // not the selected object — otherwise the iframe
              // steals every drag attempt.
              pointerEvents: selected ? "auto" : "none",
            }}
          />
          {/* Click-shield overlay when not selected so the user
              can still drag/select the embed via its outer div
              without iframe-captured pointers. */}
          {!selected && (
            <div
              aria-hidden="true"
              style={{
                position: "absolute",
                inset: 0,
                cursor: o.locked ? "default" : "move",
              }}
            />
          )}
        </>
      ) : (
        <div
          style={{
            display: "flex",
            alignItems: "center",
            justifyContent: "center",
            width: "100%",
            height: "100%",
            padding: 8,
            textAlign: "center",
          }}
        >
          {o.kind}: {(o.src ?? "").slice(0, 60) || "(no source)"}
        </div>
      )}
      {o.locked && <LockBadge z={o.z} />}
    </div>
  );
}
