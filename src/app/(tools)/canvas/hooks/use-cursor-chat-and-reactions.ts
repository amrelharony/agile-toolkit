"use client";

import { useEffect, type RefObject } from "react";

// Module-scope keymap for quick emoji reactions — hoisted out of the
// render path so the `EMOJI_KEYS` object isn't allocated on every render
// (and so the keydown effect's dependency tree doesn't need to list it).
const EMOJI_KEYS: Record<string, string> = {
  "1": "👍", "2": "❤️", "3": "😂", "4": "🎉", "5": "🤔", "6": "👀",
};

type PresencePatch = {
  reaction?: { emoji: string; x: number; y: number; expiresAt: number };
};

/**
 * Cursor chat (/) + emoji reactions (1-6).
 *
 * "/" opens a small composer floating at the current screen cursor;
 * type → Enter publishes a `chatBubble` on presence, Esc cancels.
 * Number keys 1-6 emit emoji reactions at the current world-cursor.
 *
 * Modifier-bearing keys (Cmd/Ctrl/Alt) and edits inside form fields
 * are passed through so this hook never steals shortcuts from
 * undo/copy/paste or in-place text editing.
 */
export function useCursorChatAndReactions(params: {
  chatComposerScreen: { x: number; y: number } | null;
  setChatComposerScreen: (s: { x: number; y: number } | null) => void;
  lastPointerRef: RefObject<{ x: number; y: number } | null>;
  publish: (patch: PresencePatch) => void;
  clientToWorld: (clientX: number, clientY: number) => { x: number; y: number };
}) {
  const { chatComposerScreen, setChatComposerScreen, lastPointerRef, publish, clientToWorld } = params;

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const t = e.target as HTMLElement | null;
      if (t && (t.tagName === "INPUT" || t.tagName === "TEXTAREA" || t.isContentEditable)) return;
      if (e.metaKey || e.ctrlKey || e.altKey) return;
      // "/" opens cursor chat at the last known screen-pointer location.
      if (e.key === "/" && !chatComposerScreen) {
        const last = lastPointerRef.current;
        if (!last) return;
        e.preventDefault();
        setChatComposerScreen({ x: last.x, y: last.y });
        return;
      }
      // 1-6 spawn an emoji reaction at the cursor world position.
      const emoji = EMOJI_KEYS[e.key];
      if (emoji && lastPointerRef.current) {
        const world = clientToWorld(lastPointerRef.current.x, lastPointerRef.current.y);
        publish({
          reaction: { emoji, x: world.x, y: world.y, expiresAt: Date.now() + 6_000 },
        });
        return;
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
    // `lastPointerRef` + `clientToWorld` deliberately omitted from deps:
    // the ref is stable across renders and clientToWorld's identity
    // changes on every camera change (~60 Hz during a drag), which
    // would otherwise re-bind the keydown listener at the same rate.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [chatComposerScreen, publish, setChatComposerScreen]);
}
