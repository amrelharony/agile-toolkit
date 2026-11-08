"use client";

import {
  useEffect,
  useMemo,
  useRef,
  useSyncExternalStore,
  type RefObject,
  type MutableRefObject,
} from "react";
import {
  CANVAS_ZOOM_CHORDS,
  defaultCanvasShortcuts,
  makeShortcutHandler,
  type CanvasShortcutActions,
} from "@/lib/whiteboard/keyboard";
import {
  copyObjects,
  duplicateObjects,
  readClipboardObjects,
  wbId,
} from "@/lib/whiteboard/clipboard";
import { useHistoryLogger } from "@/lib/history/use-history-logger";
import { CANVAS_ACTIONS } from "@/lib/history/event-actions";
import type { WhiteboardObject } from "@/lib/stores/workspace-types";
import type { CanvasTool } from "../use-canvas-store";
import type { KeyboardZoomActions } from "./use-pan-zoom-controls";
import { toast } from "@/lib/utils/toast";
import {
  LIVE_LOCK_NOTE,
  keptLiveNote,
  liveContainerOf,
  liveDeletion,
  withoutLiveChildren,
} from "../lib/live-boards";

type LogFn = ReturnType<typeof useHistoryLogger>["log"];

type MarqueeStateLike = { initialSelection: string[] } | null;

/**
 * The board's object actions as plain calls, for the controls a phone
 * needs because it has no keyboard: Delete / Duplicate on the selection
 * bar, Undo / Redo by the zoom bar, and the long-press menu. Each one IS
 * the handler its shortcut runs (Delete, Cmd+D, Cmd+C, Cmd+], Cmd+[,
 * Cmd+L, Cmd+Z, Cmd+Shift+Z), with the same read-only and mid-gesture
 * guards, so a button and its key can't drift apart.
 */
export interface CanvasObjectActions {
  deleteSelected: () => void;
  duplicate: () => void;
  copy: () => void;
  bringToFront: () => void;
  sendToBack: () => void;
  toggleLock: () => void;
  undo: () => void;
  redo: () => void;
}

/** Every keymap action this hook owns (the zoom chords come from the caller). */
type BoardHandlers = Omit<
  CanvasShortcutActions,
  "setTool" | "zoomIn" | "zoomOut" | "resetZoom" | "fitToContent"
>;

// The open, editable board's actions, for controls rendered outside
// WhiteboardCanvas (the zoom bar is a sibling in canvas-client and the
// guest page). One board is open at a time; like use-undo-stack's
// `openBoards`, the newest mount wins and only it can clear the slot.
let openActions: CanvasObjectActions | null = null;
const openActionsListeners = new Set<() => void>();

function setOpenActions(next: CanvasObjectActions | null) {
  openActions = next;
  openActionsListeners.forEach((listener) => listener());
}

function subscribeOpenActions(listener: () => void) {
  openActionsListeners.add(listener);
  return () => {
    openActionsListeners.delete(listener);
  };
}

/**
 * The open board's object actions, or null while no board is open or it
 * is read-only (viewer / commenter) — then there is nothing to undo.
 */
export function useOpenCanvasActions(): CanvasObjectActions | null {
  return useSyncExternalStore(
    subscribeOpenActions,
    () => openActions,
    () => null
  );
}

/**
 * The big keyboard-shortcut handler.
 *
 * Wired through `defaultCanvasShortcuts` + `makeShortcutHandler` so
 * shortcut definitions stay declarative. Each callback is wrapped in
 * `guardMut` for read-only / commenter modes — mutating shortcuts
 * become no-ops, but navigation/inspect shortcuts (selectAll, copy,
 * cancel) stay live so viewers can still interact.
 *
 * Live object reads come through `objectsRef` / `objectsByIdRef` /
 * `topZRef` rather than closure values: `objects` identity changes on
 * every drag frame (objectsById is memoised on objects), so making
 * those a dep would re-mount the keydown listener at ~60 Hz during
 * any drag.
 *
 * `undo` / `redo` self-suppress while any gesture is in flight:
 * applying an undo snapshot mid-gesture would leave
 * drag.initialRects pointing at object ids that may no longer exist
 * or have mismatched sizes, corrupting the rest of the drag. The
 * user can cancel (Esc) and then press undo again.
 *
 * `cancel` (Esc) walks the gesture chain in priority order:
 * drawing → pendingConnector → drag → resize → rotation → marquee →
 * clear-selection. The marquee branch additionally cancels any
 * in-flight lasso rAF and restores the selection that existed before
 * the marquee began.
 *
 * Unmodified keys (tool letters, Delete) only fire while focus is inside
 * `viewportRef` (WCAG 2.1.4 — see `makeShortcutHandler`'s `scope`). So do
 * the zoom chords (Cmd/Ctrl + = / - / 0 / 1): on the board they drive
 * `zoomActions`, elsewhere they stay the browser's page zoom.
 *
 * Returns the object actions (`CanvasObjectActions`) for the phone
 * buttons and the long-press menu: stable functions that call the very
 * handlers the keymap runs, read at call time.
 */
export function useCanvasShortcuts(params: {
  // Refs into live state (read at call time, not bind time)
  objectsRef: RefObject<readonly WhiteboardObject[]>;
  objectsByIdRef: RefObject<ReadonlyMap<string, WhiteboardObject>>;
  topZRef: RefObject<number>;
  lassoRafRef: MutableRefObject<number | null>;
  lassoPointsRef: MutableRefObject<number[] | null>;
  lastLassoWorldRef: MutableRefObject<{ x: number; y: number } | null>;
  // Wet-ink preview layer — the Esc-cancel of an in-flight freehand
  // stroke must clear it or the half-drawn ink stays painted on the
  // overlay canvas until the next completed stroke resets it.
  wetInkApiRef: MutableRefObject<{ reset(): void } | null>;
  // Ephemeral interaction state (closure values — drive when the
  // handler should suppress / cancel itself)
  drag: unknown;
  resize: unknown;
  rotation: unknown;
  marquee: MarqueeStateLike;
  drawing: unknown;
  pendingConnectorFromId: string | null;
  // Selection state + setters
  selection: readonly string[];
  setSelection: (ids: string[]) => void;
  clearSelection: () => void;
  // Ephemeral state setters
  setDrag: (d: null) => void;
  setResize: (r: null) => void;
  setRotation: (r: null) => void;
  setMarquee: (m: null) => void;
  setDrawing: (d: null) => void;
  setPendingConnectorFromId: (id: string | null) => void;
  // Tool selector
  setTool: (t: CanvasTool) => void;
  // Workspace operations
  boardId: string;
  removeMany: (ids: string[]) => void;
  upsertMany: (objs: WhiteboardObject[]) => void;
  // Undo/redo
  pushSnapshot: () => void;
  undo: () => void;
  redo: () => void;
  // Logging
  log: LogFn;
  logActivity: (kind: string, summary: string) => void;
  // Mode
  readOnly: boolean;
  /** The focusable board element (role="application"). */
  viewportRef: RefObject<HTMLElement | null>;
  /** Camera moves for the zoom chords (stable identity). */
  zoomActions: KeyboardZoomActions;
}) {
  const {
    objectsRef,
    objectsByIdRef,
    topZRef,
    lassoRafRef,
    lassoPointsRef,
    lastLassoWorldRef,
    wetInkApiRef,
    drag,
    resize,
    rotation,
    marquee,
    drawing,
    pendingConnectorFromId,
    selection,
    setSelection,
    clearSelection,
    setDrag,
    setResize,
    setRotation,
    setMarquee,
    setDrawing,
    setPendingConnectorFromId,
    setTool,
    boardId,
    removeMany,
    upsertMany,
    pushSnapshot,
    undo,
    redo,
    log,
    logActivity,
    readOnly,
    viewportRef,
    zoomActions,
  } = params;

  // Every board action, rebuilt when what it reads changes. The keymap
  // below and the returned object actions both call THESE functions.
  const handlers = useMemo<BoardHandlers>(() => {
    const bringForward = (step: number) => {
      const liveObjects = objectsRef.current ?? [];
      const sel = liveObjects.filter((o) => selection.includes(o.id));
      if (sel.length === 0) return;
      pushSnapshot();
      // Find actual top + bottom z across the board. The previous version
      // used `objects[0]?.z` for the bottom — that's the FIRST object in
      // insertion order, not the lowest-z one. After a few z-shuffles
      // it returns the wrong baseline and send-backward sometimes raises
      // instead of lowers.
      let topZ = -Infinity;
      let bottomZ = Infinity;
      for (const o of liveObjects) {
        if (o.z > topZ) topZ = o.z;
        if (o.z < bottomZ) bottomZ = o.z;
      }
      if (!Number.isFinite(topZ)) topZ = 0;
      if (!Number.isFinite(bottomZ)) bottomZ = 0;
      // version MUST bump on z/lock/group changes: the undo stack's
      // snapshotsEqual heuristic (use-undo-stack.ts) treats two snapshots
      // with equal length + equal Σversion as identical and DROPS the newer
      // one — so a group→ungroup (or lock toggle, or z-shuffle) that left
      // version untouched silently collapsed an undo step. (It also lets the
      // realtime LWW diff detect the change.)
      const updates = sel.map((o, i) => ({
        ...o,
        z:
          step > 0
            ? topZ + i + 1
            : // Allow z to go negative — easier to reason about than clamping
              // at 0 (clamping caused stacking-order collisions when multiple
              // objects already sat at z=0).
              bottomZ - sel.length + i,
        version: o.version + 1,
        updatedAt: new Date().toISOString(),
      }));
      upsertMany(updates);
    };
    const toggleLock = () => {
      const liveObjects = objectsRef.current ?? [];
      const chosen = liveObjects.filter((o) => selection.includes(o.id));
      // A live board's cards take their lock from the board (a closed
      // sprint's, a story map's), which would put it back straight away.
      const byId = new Map(liveObjects.map((o) => [o.id, o]));
      const sel = chosen.filter((o) => liveContainerOf(o.id, byId) === null);
      if (sel.length < chosen.length) toast.info(LIVE_LOCK_NOTE);
      if (sel.length === 0) return;
      pushSnapshot();
      const allLocked = sel.every((o) => o.locked);
      const updates = sel.map((o) => ({
        ...o,
        locked: !allLocked,
        version: o.version + 1,
        updatedAt: new Date().toISOString(),
      }));
      upsertMany(updates);
    };
    const groupSelection = () => {
      const liveObjects = objectsRef.current ?? [];
      const sel = liveObjects.filter((o) => selection.includes(o.id));
      if (sel.length < 2) return;
      pushSnapshot();
      const gid = wbId("wbg");
      const updates = sel.map((o) => ({
        ...o,
        groupId: gid,
        version: o.version + 1,
        updatedAt: new Date().toISOString(),
      }));
      upsertMany(updates);
    };
    const ungroupSelection = () => {
      const liveObjects = objectsRef.current ?? [];
      const sel = liveObjects.filter((o) => selection.includes(o.id) && o.groupId);
      if (sel.length === 0) return;
      pushSnapshot();
      const updates = sel.map((o) => ({
        ...o,
        groupId: undefined,
        version: o.version + 1,
        updatedAt: new Date().toISOString(),
      }));
      upsertMany(updates);
    };

    // ReadOnly-gated wrapper: any callback wrapped here is a no-op in
    // viewer/commenter mode. Defense-in-depth — even if a key reaches
    // the handler, the mutation is silenced. Non-mutating shortcuts
    // (selectAll, copy, cancel) stay live so viewers can still
    // navigate and inspect.
    const guardMut =
      <Args extends unknown[]>(fn: (...args: Args) => void) =>
      (...args: Args) => {
        if (!readOnly) fn(...args);
      };
    return {
      deleteSelected: guardMut(() => {
        if (selection.length === 0) return;
        // A live board goes with its cards; a card of a board that stays
        // can't go (the board would rebuild it), so say where to change it.
        const { ids, kept, keptFrom } = liveDeletion(selection, objectsRef.current ?? []);
        if (kept > 0) toast.info(keptLiveNote(keptFrom));
        if (ids.length === 0) return;
        pushSnapshot();
        // Capture types BEFORE the remove for a sane activity summary.
        const summary =
          ids.length === 1
            ? `Deleted ${objectsByIdRef.current?.get(ids[0])?.type ?? "object"}`
            : `Deleted ${ids.length} objects`;
        removeMany(ids);
        log(CANVAS_ACTIONS.OBJECT_REMOVED, { count: ids.length, ids });
        logActivity("deleted", summary);
        clearSelection();
      }),
      selectAll: () => setSelection((objectsRef.current ?? []).map((o) => o.id)),
      // A copied live board leaves its cards out: the pasted board
      // builds its own from the sprint or map, so copies would double up.
      // A live card copied without its board pastes as a plain card.
      copy: () => {
        const all = objectsRef.current ?? [];
        const sel = all.filter((o) => selection.includes(o.id));
        if (sel.length > 0) void copyObjects(withoutLiveChildren(sel, all));
      },
      cut: guardMut(() => {
        const all = objectsRef.current ?? [];
        const { ids, kept, keptFrom } = liveDeletion(selection, all);
        if (kept > 0) toast.info(keptLiveNote(keptFrom));
        const cutIds = new Set(ids);
        const sel = all.filter((o) => cutIds.has(o.id));
        if (sel.length === 0) return;
        pushSnapshot();
        void copyObjects(withoutLiveChildren(sel, all));
        removeMany(ids);
        log(CANVAS_ACTIONS.OBJECT_REMOVED, {
          count: ids.length,
          ids,
          action: "cut",
        });
        logActivity("cut", sel.length === 1 ? `Cut ${sel[0].type}` : `Cut ${sel.length} objects`);
        clearSelection();
      }),
      paste: guardMut(() => {
        void (async () => {
          const pasted = await readClipboardObjects(boardId);
          if (pasted.length === 0) return;
          pushSnapshot();
          // O(1) read via cached topZRef instead of scanning the
          // entire object list.
          const topZ = topZRef.current ?? 0;
          const repositioned = pasted.map((p, i) => ({ ...p, z: topZ + i + 1 }));
          upsertMany(repositioned);
          log(CANVAS_ACTIONS.OBJECTS_PASTED, { count: repositioned.length });
          setSelection(repositioned.map((p) => p.id));
        })();
      }),
      duplicate: guardMut(() => {
        const all = objectsRef.current ?? [];
        const sel = withoutLiveChildren(
          all.filter((o) => selection.includes(o.id)),
          all
        );
        if (sel.length === 0) return;
        pushSnapshot();
        const dup = duplicateObjects(sel, boardId);
        const topZ = topZRef.current ?? 0;
        const repositioned = dup.map((p, i) => ({ ...p, z: topZ + i + 1 }));
        upsertMany(repositioned);
        log(CANVAS_ACTIONS.OBJECTS_PASTED, { count: repositioned.length, action: "duplicate" });
        setSelection(repositioned.map((p) => p.id));
      }),
      bringForward: guardMut(() => bringForward(1)),
      sendBackward: guardMut(() => bringForward(-1)),
      toggleLock: guardMut(toggleLock),
      groupSelection: guardMut(groupSelection),
      ungroupSelection: guardMut(ungroupSelection),
      // Guard undo/redo against mid-interaction triggers AND against
      // readOnly mode (undo can't restore a state the local user
      // can't write back). If a drag / resize / marquee / drawing is
      // in flight, the canvas store has ephemeral state pointing at
      // the *current* object state, and applying an undo snapshot
      // would leave drag.initialRects referring to ids that may no
      // longer exist or have mismatched sizes — the rest of the
      // gesture would corrupt the board. Cancel the in-flight
      // interaction first; user can hit undo a second time to
      // actually step back.
      undo: guardMut(() => {
        if (drag || resize || rotation || marquee || drawing) return;
        undo();
      }),
      redo: guardMut(() => {
        if (drag || resize || rotation || marquee || drawing) return;
        redo();
      }),
      cancel: () => {
        // Single Esc: end whatever interaction is in progress; if none,
        // clear selection. Keeps the gesture chain predictable.
        if (drawing) {
          setDrawing(null);
          // Clear the wet-ink preview too — without this, Esc mid-
          // stylus-stroke leaves the half-drawn ink painted on the
          // overlay canvas (screen-space, so it also stops tracking
          // pan/zoom) until the next completed stroke resets it.
          wetInkApiRef.current?.reset();
          return;
        }
        if (pendingConnectorFromId) {
          setPendingConnectorFromId(null);
          return;
        }
        if (drag) {
          setDrag(null);
          return;
        }
        if (resize) {
          setResize(null);
          return;
        }
        if (rotation) {
          setRotation(null);
          return;
        }
        if (marquee) {
          if (lassoRafRef.current != null) {
            cancelAnimationFrame(lassoRafRef.current);
            lassoRafRef.current = null;
          }
          lassoPointsRef.current = null;
          lastLassoWorldRef.current = null;
          setSelection([...marquee.initialSelection]);
          setMarquee(null);
          return;
        }
        if (selection.length > 0) clearSelection();
      },
    };
    // Refs (objectsRef, objectsByIdRef, topZRef, lassoRafRef,
    // lassoPointsRef, lastLassoWorldRef, wetInkApiRef) are deliberately
    // omitted — they are stable identities and reading them at call time
    // is the whole point. Adding them to the dep array would change
    // nothing behaviourally but would clutter the warning surface.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [
    selection,
    removeMany,
    upsertMany,
    clearSelection,
    setSelection,
    boardId,
    drag,
    resize,
    rotation,
    marquee,
    drawing,
    pendingConnectorFromId,
    setDrag,
    setResize,
    setRotation,
    setMarquee,
    setDrawing,
    setPendingConnectorFromId,
    log,
    logActivity,
    pushSnapshot,
    undo,
    redo,
    readOnly,
  ]);

  useEffect(() => {
    const handler = makeShortcutHandler(
      defaultCanvasShortcuts({
        setTool: (t) => setTool(t as CanvasTool),
        ...handlers,
        // Camera only — no guardMut, viewers can zoom too.
        ...zoomActions,
      }),
      { scope: () => viewportRef.current, scopedChords: CANVAS_ZOOM_CHORDS }
    );
    window.addEventListener("keydown", handler);
    return () => window.removeEventListener("keydown", handler);
  }, [handlers, setTool, zoomActions, viewportRef]);

  // Stable wrappers that call the CURRENT handlers, so the buttons and
  // the menu (PropertyPanel is memoised) don't re-render on every
  // selection or gesture change just because the handlers were rebuilt.
  const handlersRef = useRef(handlers);
  handlersRef.current = handlers;
  const actions = useMemo<CanvasObjectActions>(
    () => ({
      deleteSelected: () => handlersRef.current.deleteSelected(),
      duplicate: () => handlersRef.current.duplicate(),
      copy: () => handlersRef.current.copy(),
      bringToFront: () => handlersRef.current.bringForward(),
      sendToBack: () => handlersRef.current.sendBackward(),
      toggleLock: () => handlersRef.current.toggleLock(),
      undo: () => handlersRef.current.undo(),
      redo: () => handlersRef.current.redo(),
    }),
    []
  );

  // Publish them for the zoom bar's Undo / Redo while this board is open
  // and editable.
  useEffect(() => {
    if (readOnly) return;
    setOpenActions(actions);
    return () => {
      if (openActions === actions) setOpenActions(null);
    };
  }, [actions, readOnly]);

  return actions;
}
