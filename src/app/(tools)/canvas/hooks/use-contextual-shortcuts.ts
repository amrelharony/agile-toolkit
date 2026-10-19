"use client";

import { useEffect, type RefObject } from "react";
import { controlOwnsKey, isInsideScope } from "@/lib/whiteboard/keyboard";
import type { WhiteboardObject } from "@/lib/stores/workspace-types";

const isFormTarget = (t: EventTarget | null): boolean => {
  const el = t as HTMLElement | null;
  return !!el && (el.tagName === "INPUT" || el.tagName === "TEXTAREA" || el.isContentEditable);
};

/**
 * Cmd+Shift+B → toggle frame bookmark on the currently-selected single
 * frame. Bookmarks live in canvasStore.frameBookmarks (per-board
 * persisted) and surface as quick-jump entries in the toolbar.
 *
 * Bookmarks are local (not multiplayer-broadcast), but we still gate
 * the shortcut on `readOnly` so the "viewer cannot mutate state"
 * contract is consistent — without that gate a viewer would accumulate
 * bookmarks that suddenly become visible if they're later promoted to
 * editor.
 */
export function useFrameBookmarkShortcut(params: {
  selection: readonly string[];
  objectsById: ReadonlyMap<string, WhiteboardObject>;
  boardId: string;
  toggleFrameBookmark: (boardId: string, frameId: string) => void;
  logActivity: (kind: string, summary: string) => void;
  readOnly: boolean;
}) {
  const { selection, objectsById, boardId, toggleFrameBookmark, logActivity, readOnly } = params;

  useEffect(() => {
    if (readOnly) return;
    const onKey = (e: KeyboardEvent) => {
      if (!(e.metaKey || e.ctrlKey) || !e.shiftKey) return;
      if (e.key !== "B" && e.key !== "b") return;
      if (isFormTarget(e.target)) return;
      if (selection.length !== 1) return;
      const obj = objectsById.get(selection[0]);
      if (!obj || obj.type !== "frame") return;
      e.preventDefault();
      toggleFrameBookmark(boardId, obj.id);
      logActivity("bookmark", `Toggled bookmark on frame "${obj.label || obj.id}"`);
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [selection, objectsById, boardId, toggleFrameBookmark, logActivity, readOnly]);
}

/**
 * Enter key on a selected sticky / text / card / shape → enter inline
 * edit mode. Mirrors Miro/Figma convention: select an object, press
 * Enter, start typing. Without this, users who selected (but didn't
 * double-click) a sticky and tried to type saw nothing happen — the
 * most common "I can't type in stickies" complaint.
 *
 * This is also the keyboard route to every double-click edit (WCAG
 * 2.1.1), so mind-map nodes, diagram shapes and connector labels are
 * included. Only while focus is on the board, and never when Enter
 * belongs to a focused button inside it (property panel, pins) —
 * cancelling it there made those buttons keyboard-dead.
 */
export function useEnterEditShortcut(params: {
  selection: readonly string[];
  objectsById: ReadonlyMap<string, WhiteboardObject>;
  editingObjectId: string | null;
  setEditingObjectId: (id: string | null) => void;
  readOnly: boolean;
  /** The focusable board element (role="application"). */
  viewportRef: RefObject<HTMLElement | null>;
}) {
  const { selection, objectsById, editingObjectId, setEditingObjectId, readOnly, viewportRef } =
    params;

  useEffect(() => {
    if (readOnly) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key !== "Enter" || e.shiftKey || e.metaKey || e.ctrlKey || e.altKey) return;
      if (isFormTarget(e.target)) return;
      if (!isInsideScope(e.target, viewportRef.current)) return;
      if (controlOwnsKey(e.target, e.key)) return;
      if (editingObjectId) return; // already editing
      if (selection.length !== 1) return;
      const obj = objectsById.get(selection[0]);
      if (!obj || obj.locked) return;
      const editable =
        obj.type === "sticky" ||
        obj.type === "text" ||
        obj.type === "card" ||
        obj.type === "rect" ||
        obj.type === "ellipse" ||
        obj.type === "diamond" ||
        obj.type === "triangle" ||
        obj.type === "mindMapNode" ||
        obj.type === "diagramShape" ||
        obj.type === "connector" ||
        // Tables start editing their first cell (see TableObject).
        obj.type === "table";
      if (!editable) return;
      e.preventDefault();
      setEditingObjectId(obj.id);
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [selection, objectsById, editingObjectId, setEditingObjectId, readOnly, viewportRef]);
}

/**
 * Focus the board once on mount when nothing else has focus, so the
 * board-scoped single-key shortcuts (WCAG 2.1.4) work straight away for
 * mouse users. Never takes focus from an input, dialog or anything else
 * that already has it. `focusVisible: false` keeps the keyboard focus
 * ring off until the user actually starts using the keyboard (browsers
 * without the option just ignore it).
 */
export function useFocusBoardOnMount(viewportRef: RefObject<HTMLElement | null>) {
  useEffect(() => {
    const el = viewportRef.current;
    if (!el) return;
    const active = document.activeElement;
    if (active && active !== document.body) return;
    el.focus({ preventScroll: true, focusVisible: false } as FocusOptions);
    // Mount only — later focus is the user's to move.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);
}

/**
 * Cmd+E — open the card detail modal for the currently-selected single
 * card. Mirrors Linear / Notion's "expand details" shortcut.
 *
 * Gated on `readOnly` because the modal's form mutates the store on
 * Save; the modal has no read-only rendering, so block at the
 * shortcut layer.
 */
export function useCardDetailShortcut(params: {
  selection: readonly string[];
  objectsById: ReadonlyMap<string, WhiteboardObject>;
  cardDetailId: string | null;
  setCardDetailId: (id: string | null) => void;
  readOnly: boolean;
}) {
  const { selection, objectsById, cardDetailId, setCardDetailId, readOnly } = params;

  useEffect(() => {
    if (readOnly) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key !== "e" && e.key !== "E") return;
      if (!(e.metaKey || e.ctrlKey)) return;
      if (e.shiftKey || e.altKey) return;
      if (isFormTarget(e.target)) return;
      if (selection.length !== 1) return;
      const obj = objectsById.get(selection[0]);
      if (!obj || obj.type !== "card") return;
      // Don't re-open the modal for the SAME card if it's already
      // showing; users hitting Cmd+E twice meant to dismiss.
      if (cardDetailId === obj.id) return;
      e.preventDefault();
      setCardDetailId(obj.id);
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [selection, objectsById, readOnly, cardDetailId, setCardDetailId]);
}
