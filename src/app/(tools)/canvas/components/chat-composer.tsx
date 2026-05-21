"use client";

/**
 * Cursor-chat composer.
 *
 * Lives as its own component so typing into it only re-renders the
 * composer itself — NOT the entire WhiteboardCanvas (which has 1500+
 * lines of children and selectors). Previously the `chatDraft` state
 * lived inside WhiteboardCanvas and every keystroke triggered a full
 * canvas re-render at typing speed.
 *
 * The parent owns the open/close lifecycle (chatComposerScreen
 * coordinates); this component just renders the input and handles
 * its own draft + publish lifecycle.
 */

import { memo, useEffect, useRef, useState } from "react";

interface ChatComposerProps {
  /** Screen-coords (client-relative) anchor for the textbox. */
  screen: { x: number; y: number };
  /** Viewport rect — used to translate `screen` to local-relative
   * positioning inside the absolute-positioned canvas. */
  viewportRect: { left: number; top: number };
  /** Publish a chat bubble on the realtime channel. */
  onPublish: (text: string) => void;
  onClose: () => void;
}

function ChatComposerImpl({ screen, viewportRect, onPublish, onClose }: ChatComposerProps) {
  const [draft, setDraft] = useState("");
  const inputRef = useRef<HTMLInputElement | null>(null);
  useEffect(() => {
    inputRef.current?.focus();
  }, []);

  const localX = screen.x - viewportRect.left;
  const localY = screen.y - viewportRect.top;

  return (
    <div
      style={{
        position: "absolute",
        left: localX + 20,
        top: localY + 20,
        zIndex: 9994,
      }}
      data-canvas-export-ignore="true"
    >
      <input
        ref={inputRef}
        type="text"
        value={draft}
        onChange={(e) => setDraft(e.target.value)}
        placeholder="Say something…"
        aria-label="Cursor chat"
        maxLength={200}
        onKeyDown={(e) => {
          e.stopPropagation();
          if (e.key === "Enter") {
            e.preventDefault();
            const text = draft.trim();
            if (text.length > 0) onPublish(text);
            onClose();
          } else if (e.key === "Escape") {
            e.preventDefault();
            onClose();
          }
        }}
        onBlur={() => {
          // Don't close on tab-switch / window-blur — the user may be
          // alt-tabbing to look something up. `document.hidden` is true
          // when the tab is backgrounded; in that case we leave the
          // composer open and preserve the draft. Returning to the tab
          // re-focuses the input automatically (browser default).
          if (typeof document !== "undefined" && document.hidden) return;
          onClose();
        }}
        className="bg-surface/95 border border-accent rounded-lg px-2 py-1 text-sm text-text outline-none shadow-lg min-w-[220px]"
        style={{ fontFamily: "ui-sans-serif, system-ui, sans-serif" }}
      />
    </div>
  );
}

export const ChatComposer = memo(ChatComposerImpl);
