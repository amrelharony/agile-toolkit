"use client";

import { useEffect } from "react";
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
 */
export function useEnterEditShortcut(params: {
  selection: readonly string[];
  objectsById: ReadonlyMap<string, WhiteboardObject>;
  editingObjectId: string | null;
  setEditingObjectId: (id: string | null) => void;
  readOnly: boolean;
}) {
  const { selection, objectsById, editingObjectId, setEditingObjectId, readOnly } = params;

  useEffect(() => {
    if (readOnly) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key !== "Enter" || e.shiftKey || e.metaKey || e.ctrlKey || e.altKey) return;
      if (isFormTarget(e.target)) return;
      if (editingObjectId) return; // already editing
      if (selection.length !== 1) return;
      const obj = objectsById.get(selection[0]);
      if (!obj || obj.locked) return;
      const editable = obj.type === "sticky" || obj.type === "text"
        || obj.type === "card"
        || obj.type === "rect" || obj.type === "ellipse"
        || obj.type === "diamond" || obj.type === "triangle";
      if (!editable) return;
      e.preventDefault();
      setEditingObjectId(obj.id);
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [selection, objectsById, editingObjectId, setEditingObjectId, readOnly]);
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
