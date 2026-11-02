"use client";

/**
 * Shared leaf components used by the object-renderer's per-type render branches:
 *
 *  - RichContent  — sanitized read-only rich-text (dangerouslySetInnerHTML).
 *  - InlineEditor — the textarea overlay for sticky / text / shape edit modes.
 *  - LockBadge    — the corner lock indicator on locked objects.
 *  - FramePresenterNotesAffordance — the speaker-notes pill on selected frames.
 *
 * Extracted from object-renderer.tsx so each per-type object component
 * (sticky/shape/frame/…) can import them directly.
 */

import React, { useEffect, useId, useRef, useState } from "react";
import { Lock, StickyNote } from "lucide-react";
import { sanitizeRichHtml, isRichHtmlEmpty } from "@/lib/utils/safe-html";

/**
 * Render a rich-text content string for read-only display. Sanitizes
 * defensively — even if the local editor produced clean HTML, peer
 * patches over realtime might carry unsanitized strings, and this is
 * the only barrier between them and `dangerouslySetInnerHTML`.
 *
 * Returns an empty fragment when the HTML is effectively empty so
 * the caller can fall back to placeholder text.
 */
export function RichContent({
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

/**
 * Inline textarea overlay used by sticky / text / shape edit modes. Auto-
 * focuses on mount and selects the existing content so a quick type
 * replaces it (matches Miro / Figma UX).
 */
export function InlineEditor({
  initialText,
  onCommit,
  label = "Edit text",
  background,
  color,
  fontSize,
  fontWeight,
  align,
  padding,
}: {
  initialText: string;
  onCommit: (text: string) => void;
  /** Accessible name — the overlay has no visible label. */
  label?: string;
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
      aria-label={label}
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
      onCompositionEnd={(e) => {
        valueRef.current = (e.target as HTMLTextAreaElement).value;
      }}
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
        outline: "2px solid var(--accent)",
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
 * Tiny lock badge in the top-right corner of locked objects. Without
 * this users have no signal that an object is locked except for the
 * "move" cursor mysteriously failing.
 */
export function LockBadge({ z }: { z: number }) {
  return (
    <div
      // role="img" so the name is exposed — aria-label on a bare div is
      // ignored by assistive tech.
      role="img"
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
 * Small "Notes" pill anchored to a selected frame's bottom-right
 * corner. Click expands an inline textarea where the user can edit
 * presenter notes; Enter / blur commits to `frame.presenterNotes`.
 *
 * The popover sits OUTSIDE the frame border (bottom-right offset by
 * 4-6 px) so it doesn't visually clip frame content. pointerEvents
 * stop bubbling so clicking the pill doesn't trigger a frame drag.
 *
 * Visibility: a small dot indicator on the pill turns cyan when
 * notes are present, helping users see at a glance which frames
 * have speaker notes attached.
 */
export function FramePresenterNotesAffordance({
  notes,
  onCommit,
}: {
  notes: string;
  onCommit: (text: string) => void;
}) {
  const [open, setOpen] = useState(false);
  const [draft, setDraft] = useState(notes);
  const fieldId = useId();
  // Re-sync draft when notes change from upstream (peer edit, undo).
  useEffect(() => {
    setDraft(notes);
  }, [notes]);
  const hasNotes = notes.trim().length > 0;
  return (
    <>
      <button
        type="button"
        aria-label={hasNotes ? "Edit speaker notes" : "Add speaker notes"}
        title={hasNotes ? "Edit speaker notes" : "Add speaker notes"}
        onPointerDown={(e) => e.stopPropagation()}
        onClick={(e) => {
          e.stopPropagation();
          setOpen((v) => !v);
        }}
        style={{
          position: "absolute",
          bottom: 6,
          right: 6,
          height: 22,
          padding: "0 8px",
          borderRadius: 11,
          background: "rgba(11,15,23,0.95)",
          border: `1px solid ${hasNotes ? "var(--accent)" : "#475569"}`,
          color: hasNotes ? "var(--accent)" : "#94a3b8",
          fontFamily: "ui-monospace, SF Mono, monospace",
          fontSize: 10,
          fontWeight: 600,
          textTransform: "uppercase",
          letterSpacing: 0.5,
          display: "inline-flex",
          alignItems: "center",
          gap: 4,
          cursor: "pointer",
          zIndex: 2,
        }}
      >
        <StickyNote width={11} height={11} aria-hidden="true" />
        Notes
      </button>
      {open && (
        <div
          // Event isolation only (keeps the frame from dragging); the
          // labelled textarea inside is the control.
          role="presentation"
          onPointerDown={(e) => e.stopPropagation()}
          onDoubleClick={(e) => e.stopPropagation()}
          style={{
            position: "absolute",
            bottom: 32,
            right: 6,
            width: 280,
            maxHeight: 200,
            zIndex: 3,
            background: "rgba(11,15,23,0.98)",
            border: "1px solid var(--accent)",
            borderRadius: 6,
            padding: 8,
            boxShadow: "0 6px 20px rgba(0,0,0,0.5)",
          }}
        >
          <label
            htmlFor={`${fieldId}-notes`}
            style={{
              display: "block",
              fontSize: 9,
              color: "#94a3b8",
              textTransform: "uppercase",
              letterSpacing: 1,
              marginBottom: 4,
              fontFamily: "ui-monospace, monospace",
            }}
          >
            Speaker notes
          </label>
          <textarea
            id={`${fieldId}-notes`}
            aria-describedby={`${fieldId}-hint`}
            value={draft}
            onChange={(e) => setDraft(e.target.value)}
            onBlur={() => {
              if (draft !== notes) onCommit(draft);
              setOpen(false);
            }}
            onKeyDown={(e) => {
              e.stopPropagation();
              if (e.key === "Escape") {
                e.preventDefault();
                if (draft !== notes) onCommit(draft);
                setOpen(false);
              }
            }}
            autoFocus
            maxLength={4000}
            placeholder="What to say when this slide is up…"
            style={{
              width: "100%",
              height: 120,
              boxSizing: "border-box",
              background: "rgba(15,23,42,0.5)",
              border: "1px solid #475569",
              borderRadius: 4,
              color: "#e5e7eb",
              fontFamily: "ui-sans-serif, system-ui, sans-serif",
              fontSize: 12,
              padding: 6,
              resize: "none",
              outline: "none",
              lineHeight: 1.4,
            }}
          />
          <div
            id={`${fieldId}-hint`}
            style={{
              fontSize: 9,
              color: "#475569",
              marginTop: 4,
              fontFamily: "ui-monospace, monospace",
            }}
          >
            Esc / click-out to save · shown in presentation mode
          </div>
        </div>
      )}
    </>
  );
}
