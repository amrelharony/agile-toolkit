"use client";

import React, { memo, useEffect, useRef } from "react";
import { Lock } from "lucide-react";
import type { WhiteboardObject, WhiteboardTimer, WhiteboardVoting, WhiteboardCard } from "@/lib/stores/workspace-types";
import { TimerObject } from "./objects/timer-object";
import { VotingObject } from "./objects/voting-object";
import { CardObject } from "./objects/card-object";
import { TableObject } from "./objects/table-object";
import type { WhiteboardTable } from "@/lib/stores/workspace-types";
import { TiptapInlineEditor } from "./tiptap-inline-editor";
import { sanitizeRichHtml, isRichHtmlEmpty } from "@/lib/utils/safe-html";

/**
 * Detect whether a stored `content` string is rich HTML or plain
 * text. Plain text is anything that doesn't begin with a tag
 * opening followed by an ASCII letter — same heuristic as
 * TiptapInlineEditor uses for input detection.
 *
 * Rich text gets `dangerouslySetInnerHTML` + sanitization; plain
 * text gets the original whitespace: pre-wrap rendering so
 * pre-Tiptap content keeps working byte-for-byte.
 */
function isRichHtml(content: string): boolean {
  return typeof content === "string" && /^\s*<[a-z]/i.test(content);
}

/**
 * Render a rich-text content string for read-only display. Sanitizes
 * defensively — even if the local editor produced clean HTML, peer
 * patches over realtime might carry unsanitized strings, and this is
 * the only barrier between them and `dangerouslySetInnerHTML`.
 *
 * Returns an empty fragment when the HTML is effectively empty so
 * the caller can fall back to placeholder text.
 */
function RichContent({
  html,
  className,
  style,
}: {
  html: string;
  className?: string;
  style?: React.CSSProperties;
}) {
  const clean = sanitizeRichHtml(html);
  if (!clean || isRichHtmlEmpty(clean)) return null;
  return (
    <div
      className={className}
      style={style}
      // eslint-disable-next-line react/no-danger
      dangerouslySetInnerHTML={{ __html: clean }}
    />
  );
}

interface ObjectRendererProps {
  object: WhiteboardObject;
  selected: boolean;
  /** True when this object is currently being inline-edited (textarea
   * overlays the static content). Only stickies, text, and shapes with
   * inner content respond to this flag. */
  editing?: boolean;
  onPointerDown?: (e: React.PointerEvent, id: string) => void;
  /** Called on double-click — viewport handles deciding which types are
   * editable and sets editingObjectId in the canvas store. */
  onDoubleClick?: (id: string) => void;
  /** Commit the new text. Called on textarea blur, on Enter (without
   * Shift), or on Esc (treated as commit; users expect their typing to
   * stick rather than disappear on accidental Esc). */
  onCommitEdit?: (id: string, text: string) => void;
  /** Stateful object mutators (timer / voting / card) — version-bumps
   * + persists via the canvas's diff-sync upstream. */
  onMutate?: (id: string, patch: Partial<WhiteboardObject>) => void;
  /** Current user id — passed to voting widget so it knows which
   * vote belongs to "me". */
  selfId?: string;
}

/**
 * Inline textarea overlay used by sticky / text / shape edit modes. Auto-
 * focuses on mount and selects the existing content so a quick type
 * replaces it (matches Miro / Figma UX).
 */
function InlineEditor({
  initialText,
  onCommit,
  background,
  color,
  fontSize,
  fontWeight,
  align,
  padding,
}: {
  initialText: string;
  onCommit: (text: string) => void;
  background?: string;
  color?: string;
  fontSize?: number;
  fontWeight?: number;
  align?: "left" | "center" | "right";
  padding?: number;
}) {
  const ref = useRef<HTMLTextAreaElement | null>(null);
  // Track the committed value via ref so blur can read the latest text
  // even if a fresh keystroke arrives in the same tick as blur.
  const valueRef = useRef(initialText);
  useEffect(() => {
    const ta = ref.current;
    if (!ta) return;
    ta.focus();
    // Select all so the next keystroke replaces placeholder content
    // ("Sticky note" / "Text"). Empty existing content is a no-op.
    ta.setSelectionRange(0, ta.value.length);
  }, []);
  return (
    <textarea
      ref={ref}
      // R10: maxLength matches the validator cap so a 10MB paste can't
      // sneak past inline edit, only to be silently rejected by
      // isValidObject on the next persist round-trip (losing the
      // user's note entirely).
      maxLength={50_000}
      defaultValue={initialText}
      // R8: skip writing the ref while an IME composition is in flight.
      // Android Chrome / iOS Safari fire `onChange` with INTERMEDIATE
      // composed glyph state (half-typed Hangul/Pinyin/Japanese chars).
      // Persisting mid-composition causes Backspace to delete the
      // wrong glyph and the IME to drop the candidate menu.
      onChange={(e) => {
        const native = e.nativeEvent as InputEvent;
        if (native && native.isComposing) return;
        valueRef.current = e.target.value;
      }}
      onCompositionEnd={(e) => { valueRef.current = (e.target as HTMLTextAreaElement).value; }}
      onBlur={() => onCommit(valueRef.current)}
      onKeyDown={(e) => {
        // R8: skip Enter-commits during IME composition — Enter is
        // supposed to CONFIRM the composed candidate, not submit.
        // `isComposing` works modern; `keyCode === 229` is the older
        // Safari/Edge signal.
        if (e.nativeEvent.isComposing || e.keyCode === 229) return;
        // Enter (without Shift) commits; Shift+Enter inserts a newline.
        // Esc also commits — discarding what the user typed feels
        // hostile and there's no undo from inside the textarea.
        if (e.key === "Enter" && !e.shiftKey) {
          e.preventDefault();
          onCommit(valueRef.current);
        } else if (e.key === "Escape") {
          e.preventDefault();
          onCommit(valueRef.current);
        }
        // Stop bubble so canvas-level shortcuts (V, N, R, …) don't fire
        // while the user is typing letters that happen to be tool keys.
        e.stopPropagation();
      }}
      // Block pointer-down bubbling so clicking inside the textarea
      // doesn't kick off a canvas marquee or restart the drag handler
      // on the underlying div.
      onPointerDown={(e) => e.stopPropagation()}
      onDoubleClick={(e) => e.stopPropagation()}
      // The textarea fills the parent. `resize: none` so users don't
      // accidentally resize the textarea separately from the object's
      // resize handles.
      style={{
        position: "absolute",
        inset: 0,
        width: "100%",
        height: "100%",
        background: background ?? "transparent",
        color: color ?? "inherit",
        border: "none",
        outline: "2px solid #00f0ff",
        outlineOffset: -1,
        borderRadius: 6,
        padding: padding ?? 10,
        boxSizing: "border-box",
        fontFamily: "ui-sans-serif, system-ui, sans-serif",
        fontSize: fontSize ?? 14,
        fontWeight: fontWeight ?? 400,
        textAlign: align ?? "left",
        whiteSpace: "pre-wrap",
        wordWrap: "break-word",
        resize: "none",
        cursor: "text",
      }}
    />
  );
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
  // Narrow to known raster formats. SVG data-URLs are an XSS vector
  // (embedded <script>) and other `data:` types (text/html,
  // application/*) never belong in an <img>. Allow only the formats
  // browsers render safely as bitmaps.
  if (/^data:image\/(?:png|jpe?g|webp|gif|avif);base64,/i.test(t)) return t;
  return "";
}

/**
 * Resolve the sandbox attribute string per embed host. Two tiers:
 *
 *   - "strict"   (default) — `allow-scripts allow-presentation allow-popups-to-escape-sandbox`.
 *     Suitable for YouTube, Google Docs preview, generic embeds. The
 *     iframe runs scripts in its own origin sandbox and can NOT call
 *     parent.postMessage with privileges or read top.parent.
 *
 *   - "elevated" — adds `allow-same-origin`. Required for Loom (sign-in
 *     state, video resume) and Figma (signed-in editing). These hosts
 *     are first-party-trusted; granting same-origin to a third-party
 *     origin (figma.com, loom.com) does NOT let the iframe break out
 *     of OUR origin's sandbox — they share their OWN third-party
 *     cookies, not ours.
 *
 * The HTML spec footgun about `allow-scripts allow-same-origin`
 * applies only when the iframe is served from the SAME origin as the
 * embedding page; cross-origin embeds keep their sandbox enforcement.
 */
function iframeSandboxFor(host: string): string {
  // R11-fix: removed `allow-popups-to-escape-sandbox` from the base
  // tier. Even with a sandboxed iframe, this attribute lets the embed
  // open a top-level un-sandboxed window whose `window.opener` still
  // references the iframe — a side-channel out of the sandbox for
  // generic-tier (untrusted) embeds. Only the elevated tier (Figma,
  // Loom) gets it, paired with `allow-popups` for legit outbound link
  // navigation from the editor / player.
  const base = "allow-scripts allow-presentation";
  // Hosts that legitimately need same-origin to function properly
  // (signed-in editing / playback resume). All entries must be exact
  // hostnames — substring matching would let a "figma.com.evil.tld"
  // attacker masquerade as Figma.
  const elevated = new Set([
    "figma.com",
    "www.figma.com",
    "loom.com",
    "www.loom.com",
  ]);
  return elevated.has(host)
    ? `${base} allow-same-origin allow-popups allow-popups-to-escape-sandbox`
    : base;
}

/**
 * Convert a user-supplied URL into an embeddable iframe URL when we
 * recognise it. Returns null for unsupported / unsafe sources so the
 * renderer can fall back to a placeholder instead of embedding raw
 * HTML. Recognises YouTube, Loom, Figma, Google Docs/Sheets/Slides;
 * generic https URLs are accepted only when `kind === "generic"`.
 */
function embedIframeUrl(src: string, kind: string): string | null {
  if (typeof src !== "string") return null;
  const t = src.trim();
  if (!/^https?:\/\//i.test(t)) return null;
  try {
    const u = new URL(t);
    const host = u.hostname.replace(/^www\./, "");
    if (host === "youtube.com" || host === "m.youtube.com") {
      const id = u.searchParams.get("v");
      // Real YouTube IDs are exactly 11 chars (base64url-style alphabet).
      // The previous {6,20} range matched non-IDs and accepted truncated
      // / over-long strings that 404 on YouTube's embed endpoint.
      if (id && /^[A-Za-z0-9_-]{11}$/.test(id)) return `https://www.youtube.com/embed/${id}`;
      const match = u.pathname.match(/^\/embed\/([A-Za-z0-9_-]{11})/);
      if (match) return `https://www.youtube.com/embed/${match[1]}`;
    }
    if (host === "youtu.be") {
      const id = u.pathname.slice(1);
      if (/^[A-Za-z0-9_-]{11}$/.test(id)) return `https://www.youtube.com/embed/${id}`;
    }
    if (host === "loom.com") {
      // Loom share IDs are 32-hex strings (8-32 covers common renamed
      // forms). Capping the upper bound avoids forwarding adversarial
      // input through to the embed endpoint.
      const m = u.pathname.match(/^\/share\/([A-Za-z0-9]{8,32})$/);
      if (m) return `https://www.loom.com/embed/${m[1]}`;
    }
    if (host === "figma.com") {
      // Only accept canonical /file/ID, /proto/ID, or /design/ID URLs.
      // Previously we forwarded the entire user URL as a `url=` query
      // param to figma.com/embed, which let attackers smuggle arbitrary
      // strings (including javascript: schemes) past the host check.
      const m = u.pathname.match(/^\/(?:file|proto|design)\/([A-Za-z0-9]+)/);
      if (!m) return null;
      // Re-construct a clean URL from origin + matched path; drop user
      // query string entirely. Figma's embed endpoint accepts this form.
      const cleanFigmaUrl = `https://www.figma.com${m[0]}`;
      return `https://www.figma.com/embed?embed_host=agile-toolkit&url=${encodeURIComponent(cleanFigmaUrl)}`;
    }
    if (host === "docs.google.com") {
      // Restrict to canonical Google Docs / Sheets / Slides / Forms
      // paths so a bare `docs.google.com` URL with a non-document path
      // doesn't fall through to the embed slot. Required form:
      //   /(document|spreadsheets|presentation|forms)/d/<id>[…]
      // Anything else (calendar, drawings, etc.) returns null so the
      // renderer shows the broken-embed placeholder instead of an
      // iframe pointing at a URL we don't trust.
      const validPath = /^\/(?:document|spreadsheets|presentation|forms)\/d\//.test(u.pathname);
      if (!validPath) return null;
      return t.replace(/\/edit.*$/, "/preview");
    }
    if (kind === "generic") return t;
    return null;
  } catch {
    return null;
  }
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
function ObjectRendererImpl({ object: o, selected, editing, onPointerDown, onDoubleClick, onCommitEdit, onMutate, selfId }: ObjectRendererProps) {
  const handle = (e: React.PointerEvent) => onPointerDown?.(e, o.id);
  const dblClick = () => onDoubleClick?.(o.id);
  const commitEdit = (text: string) => onCommitEdit?.(o.id, text);
  const selectionStyle = selected
    ? { boxShadow: "0 0 0 2px #00f0ff, 0 0 12px rgba(0,240,255,0.4)" }
    : undefined;

  switch (o.type) {
    case "sticky": {
      // Sticky font scales with the SHORTER dimension so a tall-thin
      // sticky still fits text horizontally and a stretched-wide sticky
      // still keeps text vertically. Floor 16 (smallest legible body
      // text), ceiling 64 (huge stickies read like posters — a 500×400
      // sticky should have giant text, not tiny chrome-sized text).
      // Divisor 7 keeps the scaling visually pleasant:
      //
      //   80×60 (thumbnail) → 60/7=8 → floor 16
      //   200×160 (default) → 160/7=22 → 22 px
      //   400×300           → 300/7=42 → 42 px
      //   600×500           → 500/7=71 → ceiling 64
      //
      // Respects an explicitly-set `fontSize` if the user has
      // customised it via the property panel — only the auto-default
      // case is scaled.
      const stickyFontSize =
        o.fontSize ??
        Math.max(16, Math.min(64, Math.floor(Math.min(o.w, o.h) / 7)));
      return (
        <div
          data-canvas-object-kind="sticky"
          onPointerDown={editing ? undefined : handle}
          onDoubleClick={dblClick}
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
            fontSize: stickyFontSize,
            lineHeight: 1.2,
            fontFamily: o.fontFamily ?? "ui-sans-serif, system-ui, sans-serif",
            whiteSpace: "pre-wrap",
            wordWrap: "break-word",
            cursor: editing ? "text" : (o.locked ? "default" : "move"),
            userSelect: editing ? "text" : "none",
            boxShadow: selected ? selectionStyle?.boxShadow : "0 1px 3px rgba(0,0,0,0.3)",
            zIndex: o.z,
            opacity: o.locked ? 0.85 : 1,
          }}
        >
          {editing ? (
            <TiptapInlineEditor
              initialText={o.content}
              onCommit={commitEdit}
              background="transparent"
              color={o.textColor ?? "#0b0f17"}
              fontSize={stickyFontSize}
            />
          ) : isRichHtml(o.content) ? (
            <RichContent html={o.content} />
          ) : (
            o.content || <span style={{ opacity: 0.4 }}>Sticky note</span>
          )}
          {o.locked && !editing && <LockBadge z={o.z} />}
        </div>
      );
    }

    case "rect":
    case "ellipse":
    case "diamond":
    case "triangle": {
      const fill = o.fill ?? "transparent";
      const stroke = o.stroke ?? "#94a3b8";
      const strokeWidth = o.strokeWidth ?? 1.5;
      const strokeDasharray = o.dashed ? "6 4" : undefined;
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
            strokeDasharray={strokeDasharray}
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
            strokeDasharray={strokeDasharray}
          />
        );
      } else if (o.type === "diamond") {
        shape = (
          <polygon
            points={`${o.w / 2},0 ${o.w},${o.h / 2} ${o.w / 2},${o.h} 0,${o.h / 2}`}
            fill={fill}
            stroke={stroke}
            strokeWidth={strokeWidth}
            strokeDasharray={strokeDasharray}
          />
        );
      } else {
        shape = (
          <polygon
            points={`${o.w / 2},0 ${o.w},${o.h} 0,${o.h}`}
            fill={fill}
            stroke={stroke}
            strokeWidth={strokeWidth}
            strokeDasharray={strokeDasharray}
          />
        );
      }
      return (
        <div
          data-canvas-object-kind={o.type}
          onPointerDown={editing ? undefined : handle}
          onDoubleClick={dblClick}
          style={{
            position: "absolute",
            left: 0,
            top: 0,
            transform: `translate3d(${o.x}px, ${o.y}px, 0)${o.rotation ? ` rotate(${o.rotation}deg)` : ""}`,
            width: o.w,
            height: o.h,
            cursor: editing ? "text" : (o.locked ? "default" : "move"),
            opacity: o.locked ? 0.85 : 1,
            ...selectionStyle,
            zIndex: o.z,
          }}
        >
          <svg width={o.w} height={o.h} style={{ display: "block" }}>
            {shape}
          </svg>
          {/* Shape font scales with the smaller dimension. Floor 16
              (matches sticky body text — smallest legible content) and
              ceiling 64 (matches sticky — a huge shape gets poster-
              sized text, not chrome-sized). Divisor 7 keeps the ramp
              the same shape as sticky:
                  80×60 thumbnail → 16 px floor
                  160×120 default → 17 px
                  400×300         → 42 px
                  600×500+        → 64 px ceiling
              Previously this was floor 14 / ceiling 32, which made
              shape text noticeably smaller than sticky text on
              identically-sized objects — inconsistent across types. */}
          {(() => {
            const shapeFontSize = Math.max(
              16,
              Math.min(64, Math.floor(Math.min(o.w, o.h) / 7)),
            );
            return editing ? (
              <InlineEditor
                initialText={o.content ?? ""}
                onCommit={commitEdit}
                color="#e5e7eb"
                fontSize={shapeFontSize}
                align="center"
                padding={8}
              />
            ) : (
              o.content && (
                <div
                  style={{
                    position: "absolute",
                    inset: 0,
                    display: "flex",
                    alignItems: "center",
                    justifyContent: "center",
                    color: "#e5e7eb",
                    fontSize: shapeFontSize,
                    fontFamily: "ui-sans-serif, system-ui, sans-serif",
                    textAlign: "center",
                    padding: 8,
                    pointerEvents: "none",
                    lineHeight: 1.2,
                    wordBreak: "break-word",
                  }}
                >
                  {o.content}
                </div>
              )
            );
          })()}
          {o.locked && !editing && <LockBadge z={o.z} />}
        </div>
      );
    }

    case "text":
      return (
        <div
          data-canvas-object-kind="text"
          onPointerDown={editing ? undefined : handle}
          onDoubleClick={dblClick}
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
            cursor: editing ? "text" : (o.locked ? "default" : "move"),
            opacity: o.locked ? 0.85 : 1,
            userSelect: editing ? "text" : "none",
            fontFamily: o.fontFamily ?? "ui-sans-serif, system-ui, sans-serif",
            whiteSpace: "pre-wrap",
            wordWrap: "break-word",
            ...selectionStyle,
            zIndex: o.z,
          }}
        >
          {editing ? (
            <TiptapInlineEditor
              initialText={o.content}
              onCommit={commitEdit}
              color={o.color}
              fontSize={o.fontSize}
              fontWeight={o.fontWeight ?? 400}
              align={o.align ?? "left"}
              padding={0}
            />
          ) : isRichHtml(o.content) ? (
            <RichContent html={o.content} />
          ) : (
            o.content || <span style={{ opacity: 0.4 }}>Text</span>
          )}
          {o.locked && !editing && <LockBadge z={o.z} />}
        </div>
      );

    case "frame":
      return (
        <div
          data-canvas-object-kind="frame"
          onPointerDown={editing ? undefined : handle}
          onDoubleClick={dblClick}
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
            cursor: editing ? "text" : (o.locked ? "default" : "move"),
            opacity: o.locked ? 0.85 : 1,
            ...selectionStyle,
          }}
        >
          {/* Label tab above the frame. Bumped from 12 → 14 px so it's
              readable at a normal zoom level — the prior size matched
              the toolbar font, blurring the line between frame chrome
              and frame content. Double-click swaps the static label
              for an InlineEditor; onCommitEdit routes the new text
              into `frame.label` via the type-aware commit handler in
              whiteboard-canvas.tsx. */}
          <div
            style={{
              position: "absolute",
              top: -26,
              left: 6,
              fontSize: 14,
              fontWeight: 600,
              color: "#cbd5e1",
              fontFamily: "ui-sans-serif, system-ui, sans-serif",
              background: "#0b0f17",
              padding: "2px 8px",
              borderRadius: 4,
              minWidth: 60,
              minHeight: 20,
              display: "flex",
              alignItems: "center",
            }}
            // Stop drag from starting when the user clicks the label tab
            // to enter edit mode.
            onPointerDown={editing ? (e) => e.stopPropagation() : undefined}
          >
            {editing ? (
              <InlineEditor
                initialText={o.label ?? ""}
                onCommit={commitEdit}
                background="transparent"
                color="#e5e7eb"
                fontSize={14}
                fontWeight={600}
                padding={0}
              />
            ) : (
              o.label || <span style={{ opacity: 0.5 }}>Frame</span>
            )}
          </div>
          {o.locked && !editing && <LockBadge z={o.z} />}
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
          data-canvas-object-kind={o.type}
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
          data-canvas-object-kind="freehand"
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

    case "embed": {
      const iframeSrc = embedIframeUrl(o.src ?? "", o.kind);
      // Compute per-host sandbox tier from the resolved iframe src
      // (NOT the user-typed URL) — embedIframeUrl already normalises
      // figma.com / youtube.com / loom.com to known embed endpoints,
      // so we read the host off the result for accurate routing.
      let iframeHost = "";
      if (iframeSrc) {
        try { iframeHost = new URL(iframeSrc).hostname; } catch { iframeHost = ""; }
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
            <div style={{ display: "flex", alignItems: "center", justifyContent: "center", width: "100%", height: "100%", padding: 8, textAlign: "center" }}>
              {o.kind}: {(o.src ?? "").slice(0, 60) || "(no source)"}
            </div>
          )}
          {o.locked && <LockBadge z={o.z} />}
        </div>
      );
    }

    case "timer":
      return (
        <TimerObject
          object={o as WhiteboardTimer}
          selected={selected}
          onPointerDown={handle}
          onMutate={(patch) => onMutate?.(o.id, patch as Partial<WhiteboardObject>)}
        />
      );

    case "voting":
      return (
        <VotingObject
          object={o as WhiteboardVoting}
          selected={selected}
          selfId={selfId ?? "anonymous"}
          onPointerDown={handle}
          onMutate={(patch) => onMutate?.(o.id, patch as Partial<WhiteboardObject>)}
        />
      );

    case "card":
      return (
        <CardObject
          object={o as WhiteboardCard}
          selected={selected}
          editing={editing ?? false}
          onPointerDown={handle}
          onDoubleClick={() => onDoubleClick?.(o.id)}
          onCommitEdit={(text) => onCommitEdit?.(o.id, text)}
        />
      );

    case "table":
      return (
        <TableObject
          object={o as WhiteboardTable}
          selected={selected}
          readOnly={!onMutate}
          onPointerDown={handle}
          onMutate={(id, patch) => onMutate?.(id, patch)}
        />
      );

    case "kanban":
      // Kanban frames render like Frame but with column dividers; we
      // reuse the existing frame logic by short-circuiting here.
      return (
        <div
          data-canvas-object-kind="kanban"
          onPointerDown={handle}
          style={{
            position: "absolute",
            left: 0,
            top: 0,
            transform: `translate3d(${o.x}px, ${o.y}px, 0)`,
            width: o.w,
            height: o.h,
            border: "1.5px dashed #60a5fa",
            borderRadius: 8,
            background: "rgba(96, 165, 250, 0.05)",
            zIndex: o.z,
            opacity: o.locked ? 0.85 : 1,
            ...selectionStyle,
          }}
        >
          <div
            style={{
              position: "absolute", top: -22, left: 6,
              fontSize: 12, color: "#60a5fa",
              fontFamily: "ui-sans-serif, system-ui, sans-serif",
              background: "#0b0f17", padding: "1px 6px", borderRadius: 3,
            }}
          >
            ▣ {o.label}
          </div>
          {/* Column dividers — visual cue for users to drop cards into. */}
          {o.columns.map((_col, i) => (
            <React.Fragment key={i}>
              {i > 0 && (
                <div
                  aria-hidden="true"
                  style={{
                    position: "absolute",
                    left: (i / o.columns.length) * o.w,
                    top: 0,
                    width: 1,
                    height: o.h,
                    background: "rgba(96, 165, 250, 0.3)",
                  }}
                />
              )}
              <div
                style={{
                  position: "absolute",
                  left: (i / o.columns.length) * o.w + 6,
                  top: 8,
                  fontSize: 10,
                  color: "#60a5fa",
                  fontFamily: "ui-sans-serif, system-ui, sans-serif",
                  textTransform: "uppercase",
                  letterSpacing: 0.5,
                  pointerEvents: "none",
                }}
              >
                {(o.columnLabels?.[i] ?? o.columns[i]).replace("_", " ")}
              </div>
            </React.Fragment>
          ))}
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
