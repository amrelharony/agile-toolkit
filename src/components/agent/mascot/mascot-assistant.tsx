"use client";

/**
 * Floating Amr + chat panel — replaces the agent sheet (Phase 3).
 *
 * Amr is always present (bottom-right). Clicking him — or the header
 * button, or Cmd/Ctrl+J — toggles a chat panel that binds to the SAME
 * useAgentStore + sendUserMessage + ConfirmAction as before, so the agent's
 * tool-calling brain, confirm cards, and persistence are unchanged; only the
 * shell is new. Amr "talks" (the review pose) while the agent streams.
 *
 * The agent itself is owner-only. Visitors keep the mascot (clicks, Konami,
 * Cmd/Ctrl+J) but the panel shows <VisitorGuide/> — a tool finder — instead
 * of the chat, so their panel never touches /api/agent/* or the agent tables
 * in Supabase. The chat (and the action registry it needs) is a separate
 * dynamic chunk, owner-agent-panel, so visitors never download it either.
 */

import {
  useEffect,
  useRef,
  useState,
  type CSSProperties,
  type PointerEvent as ReactPointerEvent,
} from "react";
import dynamic from "next/dynamic";
import { X, Plus, History, Sparkles } from "lucide-react";
import { cn } from "@/lib/utils";
import { useAgentStore } from "@/lib/agent/store";
import { useOwnerState } from "@/lib/auth/use-is-owner";
import { useMascotStore } from "@/lib/agent/mascot/store";
import { useMascotChatReactions } from "@/lib/agent/mascot/use-chat-reactions";
import { useMascotToolReactions } from "@/lib/agent/mascot/use-tool-reactions";
import { createClickInteraction } from "./engine/interactions/clicks";
import { installKonami } from "./engine/customization/commands";
import { playMascotSound } from "./engine/audio/mascot-audio";
import { FIGURE_BOTTOM, FIGURE_TOP, SHEET } from "./engine/sprite-poses";
import { VisitorGuide } from "./visitor-guide";
import styles from "./mascot-assistant.module.css";

/** Award XP via the gamification window bridge (no-op if unavailable). */
function addXp(n: number): void {
  (window as unknown as { VDna?: { addXp?: (x: number) => void } }).VDna?.addXp?.(n);
}

/** Which corner the mascot is parked in (drag-to-reposition). */
type Corner = "topLeft" | "topRight" | "bottomLeft" | "bottomRight";

/** Inset of the float button from its corner. */
const BUTTON_INSET = 4;
/** Size of Amr's box inside that button: one sheet cell at an exact 12:13. */
const MASCOT_BOX = { w: 132, h: 143 };
/** Phones get a smaller figure so it covers less of the page. */
const MASCOT_BOX_PHONE = { w: 96, h: 104 };
/** The round launcher shown until the figure is ready (or if the sheet can't load). */
const LAUNCHER_SIZE = 48;
/**
 * How much of the empty box (in sheet px) may sit past the screen edge: all the
 * space below his feet when parked at the bottom, most of the headroom when
 * parked at the top. A margin is left there because he jumps into it.
 */
const FEET_TRIM = SHEET.cellH - FIGURE_BOTTOM;
const HEAD_TRIM = 16;
/**
 * The part of the box that takes clicks: the figure, not the transparent space
 * around it. Fractions of the box width are left clear on each side.
 */
const HIT_SIDE = 0.28;
/** Breathing room between the mascot's silhouette and the panel. */
const PANEL_GAP = 6;

/** Distance of the button's edge from its corner (negative: past the edge). */
function edgeInset(c: Corner, figure: boolean, boxH: number): number {
  if (!figure) return BUTTON_INSET;
  const scale = boxH / SHEET.cellH;
  return BUTTON_INSET - (c.startsWith("top") ? HEAD_TRIM : FEET_TRIM) * scale;
}

/** Fixed-position style for the float button at a corner (default ≈ bottom-1 right-2). */
function buttonPos(c: Corner, figure: boolean, boxH: number): CSSProperties {
  const inset = edgeInset(c, figure, boxH);
  return {
    position: "fixed",
    ...(c.startsWith("top") ? { top: inset } : { bottom: inset }),
    ...(c.endsWith("Left") ? { left: 8 } : { right: 8 }),
  };
}

/** Where clicks land inside the figure's box (see HIT_SIDE). */
function hitBox(box: { w: number; h: number }): CSSProperties {
  const scale = box.h / SHEET.cellH;
  return {
    top: FIGURE_TOP * scale,
    bottom: box.h - FIGURE_BOTTOM * scale,
    left: box.w * HIT_SIDE,
    right: box.w * HIT_SIDE,
  };
}

/**
 * Chat-panel style for a corner — hugs Amr's silhouette, not his box. `boxH` is
 * the rendered box height (the figure's rows scale with it); with the launcher
 * showing, the panel clears the launcher instead.
 */
function panelPos(c: Corner, figure: boolean, boxH: number): CSSProperties {
  const scale = boxH / SHEET.cellH;
  const top = figure ? FIGURE_TOP * scale : 0;
  const bottom = figure ? FIGURE_BOTTOM * scale : LAUNCHER_SIZE;
  const height = figure ? boxH : LAUNCHER_SIZE;
  const inset = edgeInset(c, figure, boxH);
  return {
    ...(c.startsWith("top")
      ? // Parked up top: clear his feet.
        { top: inset + bottom + PANEL_GAP }
      : // Parked at the bottom: clear its head.
        { bottom: inset + (height - top) + PANEL_GAP }),
    ...(c.endsWith("Left") ? { left: 16 } : { right: 16 }),
  };
}

/** True below the `sm` breakpoint (640px). */
function useIsPhone(): boolean {
  const [isPhone, setIsPhone] = useState(false);
  useEffect(() => {
    const mq = window.matchMedia?.("(max-width: 639px)");
    if (!mq) return;
    const update = () => setIsPhone(mq.matches);
    update();
    mq.addEventListener?.("change", update);
    return () => mq.removeEventListener?.("change", update);
  }, []);
  return isPhone;
}

/** Start the figure this long after load if nobody has interacted yet. */
const MASCOT_DELAY_MS = 2000;

/**
 * Defer the figure (its chunk and the sprite sheet) until the visitor first
 * interacts (pointer, key, scroll) or a moment after the page has loaded,
 * whichever comes first, then wait for an idle moment, so it never competes with
 * the page's own content. The launcher shows until then. Skipped entirely when
 * the visitor asked to save data.
 */
function useDeferredFigure(): boolean {
  const [ready, setReady] = useState(false);
  useEffect(() => {
    const nav = navigator as Navigator & { connection?: { saveData?: boolean } };
    if (nav.connection?.saveData) return;
    const w = window as Window & {
      requestIdleCallback?: (cb: () => void, opts?: { timeout: number }) => number;
      cancelIdleCallback?: (id: number) => void;
    };
    let idleId: number | undefined;
    let timer: number | undefined;
    let started = false;
    const events = ["pointerdown", "keydown", "scroll", "touchstart"] as const;
    const start = () => {
      if (started) return;
      started = true;
      events.forEach((e) => window.removeEventListener(e, start));
      window.clearTimeout(timer);
      if (w.requestIdleCallback)
        idleId = w.requestIdleCallback(() => setReady(true), { timeout: 2000 });
      else timer = window.setTimeout(() => setReady(true), 300);
    };
    events.forEach((e) => window.addEventListener(e, start, { passive: true, once: true }));
    const arm = () => {
      timer = window.setTimeout(start, MASCOT_DELAY_MS);
    };
    if (document.readyState === "complete") arm();
    else window.addEventListener("load", arm, { once: true });
    return () => {
      events.forEach((e) => window.removeEventListener(e, start));
      window.removeEventListener("load", arm);
      window.clearTimeout(timer);
      if (idleId !== undefined) w.cancelIdleCallback?.(idleId);
    };
  }, []);
  return ready;
}

/** On phones, step aside while the visitor is typing (the keyboard is up). */
function useTypingOnPhone(isPhone: boolean): boolean {
  const [typing, setTyping] = useState(false);
  useEffect(() => {
    if (!isPhone) {
      setTyping(false);
      return;
    }
    const isField = (t: EventTarget | null) => {
      const el = t as HTMLElement | null;
      return (
        !!el &&
        (el.isContentEditable ||
          el.tagName === "INPUT" ||
          el.tagName === "TEXTAREA" ||
          el.tagName === "SELECT")
      );
    };
    const onIn = (e: FocusEvent) => {
      // Typing inside the assistant panel itself keeps the figure in place.
      const inPanel = (e.target as HTMLElement | null)?.closest?.("[data-agent-sheet-root]");
      if (isField(e.target) && !inPanel) setTyping(true);
    };
    const onOut = (e: FocusEvent) => {
      if (isField(e.target)) setTyping(false);
    };
    document.addEventListener("focusin", onIn);
    document.addEventListener("focusout", onOut);
    return () => {
      document.removeEventListener("focusin", onIn);
      document.removeEventListener("focusout", onOut);
    };
  }, [isPhone]);
  return typing;
}

const MascotSprite = dynamic(() => import("./mascot-sprite"), { ssr: false });
const OwnerAgentPanel = dynamic(() => import("./owner-agent-panel"), {
  ssr: false,
  loading: () => <div className="min-h-0 flex-1" aria-busy="true" />,
});

export function MascotAssistant() {
  const open = useAgentStore((s) => s.open);
  const toggleSheet = useAgentStore((s) => s.toggleSheet);
  const closeSheet = useAgentStore((s) => s.closeSheet);
  const [showHistory, setShowHistory] = useState(false);
  // `settled` keeps the owner from seeing the visitor notice flash while
  // auth is still loading; no chat component mounts until it's settled.
  const { isOwner, settled } = useOwnerState();
  const isPhone = useIsPhone();
  const typingOnPhone = useTypingOnPhone(isPhone);
  const hideFigure = typingOnPhone;
  const box = isPhone ? MASCOT_BOX_PHONE : MASCOT_BOX;

  // The figure loads after the page is idle; until it's ready (or if the sheet
  // can't load) a small launcher keeps the assistant one click away without an
  // invisible hit box over the page.
  const loadFigure = useDeferredFigure();
  const figureReady = useMascotStore((s) => s.ready);
  const [figureFailed, setFigureFailed] = useState(false);
  const mountFigure = loadFigure && !figureFailed;
  const showFigure = mountFigure && figureReady;

  // Owner signed out mid-session: drop the conversation from memory. (The
  // chat panel unmounts at the same moment, which aborts any in-flight turn.)
  const wasOwnerRef = useRef(false);
  useEffect(() => {
    if (isOwner) {
      wasOwnerRef.current = true;
      return;
    }
    if (!wasOwnerRef.current) return;
    wasOwnerRef.current = false;
    useAgentStore.getState().reset();
    setShowHistory(false);
  }, [isOwner]);

  // Click interaction: a flourish + multi-click escalations on top of the chat
  // toggle (the toggle is debounced so rapid taps don't thrash the panel).
  const clickRef = useRef<ReturnType<typeof createClickInteraction> | null>(null);
  if (!clickRef.current) {
    clickRef.current = createClickInteraction({
      queueReaction: (r) => useMascotStore.getState().queueReaction(r),
      queueMicro: (n) => useMascotStore.getState().queueMicroExpression(n),
      sound: () => playMascotSound("click"),
      addXp,
    });
  }
  const lastToggleRef = useRef(0);
  const draggedRef = useRef(false);
  const onMascotClick = () => {
    if (draggedRef.current) return; // a drag-release, not a click
    clickRef.current?.onClick();
    const now = Date.now();
    if (now - lastToggleRef.current > 500) {
      lastToggleRef.current = now;
      toggleSheet();
    }
  };
  useEffect(() => () => clickRef.current?.dispose(), []);

  // Drag-to-reposition: free-drag past a threshold, then snap to the nearest
  // corner (the chat panel follows via the corner state). Source initDragDrop.
  const [corner, setCorner] = useState<Corner>("bottomRight");
  const [dragPos, setDragPos] = useState<{ left: number; top: number } | null>(null);
  // Removes the active drag's document listeners (called on pointerup, on a new
  // drag, or on unmount) so they never leak past an in-progress drag.
  const dragCleanupRef = useRef<(() => void) | null>(null);
  useEffect(() => () => dragCleanupRef.current?.(), []);
  const onPointerDown = (e: ReactPointerEvent<HTMLButtonElement>) => {
    if (e.button !== 0) return;
    dragCleanupRef.current?.(); // tidy any prior unfinished drag
    const el = e.currentTarget;
    const start = { x: e.clientX, y: e.clientY };
    const rect = el.getBoundingClientRect();
    const offset = { x: rect.left - e.clientX, y: rect.top - e.clientY };
    const w = el.offsetWidth;
    const h = el.offsetHeight;
    let moved = false;
    let last = { left: rect.left, top: rect.top };
    let pointerX = e.clientX;
    let heading: "left" | "right" | null = null;
    const onMove = (ev: PointerEvent) => {
      if (!moved && Math.abs(ev.clientX - start.x) + Math.abs(ev.clientY - start.y) > 8) {
        moved = true;
      }
      if (moved) {
        last = {
          left: Math.max(0, Math.min(window.innerWidth - w, ev.clientX + offset.x)),
          top: Math.max(0, Math.min(window.innerHeight - h, ev.clientY + offset.y)),
        };
        setDragPos(last);
        // Amr runs the way he's being dragged (a straight-up drag keeps the last way).
        const dx = ev.clientX - pointerX;
        const next = dx < 0 ? "left" : dx > 0 ? "right" : (heading ?? "right");
        pointerX = ev.clientX;
        if (next !== heading) {
          heading = next;
          useMascotStore.getState().setDragDirection(next);
        }
      }
    };
    const onUp = () => {
      dragCleanupRef.current?.(); // removes all three listeners + nulls the ref
      useMascotStore.getState().setDragDirection(null);
      if (moved) {
        // Snap from the last DRAGGED position (React batches setDragPos, so the
        // DOM rect may still read the start position here).
        const cx = last.left + w / 2;
        const cy = last.top + h / 2;
        const next = `${cy < window.innerHeight / 2 ? "top" : "bottom"}${
          cx < window.innerWidth / 2 ? "Left" : "Right"
        }` as Corner;
        setCorner(next);
        // Suppress the click that fires right after a drag-release.
        draggedRef.current = true;
        setTimeout(() => (draggedRef.current = false), 60);
      }
      // Always clear the free-drag offset — NOT only when `moved`. On touch,
      // dragging the fixed-position mascot reads as a scroll gesture and the
      // browser fires `pointercancel` instead of `pointerup`; with the reset
      // inside `if (moved)` the mascot stayed pinned at its last dragPos with
      // its float animation dead, and `panelPos(corner)` anchored the chat
      // panel to the stale corner. A later tap never cleared it either.
      setDragPos(null);
    };
    document.addEventListener("pointermove", onMove);
    document.addEventListener("pointerup", onUp);
    // `pointercancel` is the touch-scroll / capture-loss path — same teardown.
    document.addEventListener("pointercancel", onUp);
    dragCleanupRef.current = () => {
      document.removeEventListener("pointermove", onMove);
      document.removeEventListener("pointerup", onUp);
      document.removeEventListener("pointercancel", onUp);
      dragCleanupRef.current = null;
    };
  };

  // Konami easter egg (spin + rainbow + XP) + restore the persisted aura.
  useEffect(() => {
    useMascotStore.getState().hydrateAppearance();
    return installKonami(() => addXp(10));
  }, []);

  // Drive the mascot from the conversation: talk while streaming, think on send,
  // react to tool results, shift mood to the reply's sentiment.
  useMascotChatReactions();
  // React to finished tool actions, for visitors and the owner alike.
  useMascotToolReactions();

  // Cmd/Ctrl+J toggles — the de-facto AI-chat shortcut (moved from agent-sheet).
  // Skip when typing in an editable element so it can't steal focus mid-edit.
  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      if (!(e.metaKey || e.ctrlKey) || e.shiftKey || e.altKey) return;
      if (e.key !== "j" && e.key !== "J") return;
      const t = e.target as HTMLElement | null;
      if (
        t &&
        (t.isContentEditable ||
          t.tagName === "INPUT" ||
          t.tagName === "TEXTAREA" ||
          t.tagName === "SELECT")
      ) {
        return;
      }
      if (e.repeat) return;
      e.preventDefault();
      toggleSheet();
    };
    window.addEventListener("keydown", handler);
    return () => window.removeEventListener("keydown", handler);
  }, [toggleSheet]);

  // Escape closes the panel — unless a confirm card is up (it owns Escape to
  // deny) or focus is in the rename field (it stops propagation to cancel edit).
  useEffect(() => {
    if (!open) return;
    const onEsc = (e: KeyboardEvent) => {
      if (e.key !== "Escape") return;
      if (useAgentStore.getState().pendingToolUse) return;
      // Renaming a thread: Escape cancels that edit, not the whole panel.
      const ae = document.activeElement;
      if (ae?.getAttribute("aria-label") === "Rename conversation") return;
      closeSheet();
    };
    document.addEventListener("keydown", onEsc);
    return () => document.removeEventListener("keydown", onEsc);
  }, [open, closeSheet]);

  return (
    <>
      {open && (
        <div
          data-agent-sheet-root
          role="dialog"
          aria-label="Amr assistant"
          aria-modal={false}
          style={panelPos(corner, showFigure, box.h)}
          className="fixed z-50 flex h-[min(68vh,560px)] w-[min(92vw,380px)] flex-col overflow-hidden rounded-2xl border border-border bg-surface-deep/95 shadow-2xl backdrop-blur"
        >
          <div className="flex items-center justify-between border-b border-border px-4 py-2.5">
            <div>
              <p className="text-sm font-semibold text-text">✦ Amr</p>
              <p className="text-xs text-sub">
                {isOwner ? "Drive every tool · " : "Find the right tool · "}Cmd/Ctrl+J
              </p>
            </div>
            <div className="flex items-center gap-0.5">
              {isOwner && (
                <>
                  <button
                    type="button"
                    onClick={() => {
                      useAgentStore.getState().reset();
                      setShowHistory(false);
                    }}
                    aria-label="New chat"
                    title="New chat"
                    className="rounded-md p-1 text-sub transition-colors hover:bg-accent/10 hover:text-text"
                  >
                    <Plus className="h-4 w-4" aria-hidden="true" />
                  </button>
                  <button
                    type="button"
                    onClick={() => setShowHistory((v) => !v)}
                    aria-label="Conversation history"
                    title="History"
                    aria-pressed={showHistory}
                    className={`rounded-md p-1 transition-colors hover:bg-accent/10 hover:text-text ${
                      showHistory ? "text-accent" : "text-sub"
                    }`}
                  >
                    <History className="h-4 w-4" aria-hidden="true" />
                  </button>
                </>
              )}
              <button
                type="button"
                onClick={closeSheet}
                aria-label="Close assistant"
                className="min-touch-coarse rounded-md p-1 text-sub transition-colors hover:bg-accent/10 hover:text-text"
              >
                <X className="h-4 w-4" aria-hidden="true" />
              </button>
            </div>
          </div>
          {!isOwner ? (
            <div className="min-h-0 flex-1" aria-busy={!settled}>
              {settled && <VisitorGuide onNavigate={closeSheet} />}
            </div>
          ) : (
            <OwnerAgentPanel
              showHistory={showHistory}
              onCloseHistory={() => setShowHistory(false)}
            />
          )}
        </div>
      )}

      {/* Floating mascot — click to toggle the chat. */}
      {!hideFigure && (
        <button
          type="button"
          onClick={onMascotClick}
          onPointerDown={onPointerDown}
          aria-label={open ? "Close assistant" : "Open assistant"}
          title="Ask Amr · drag to reposition"
          style={
            dragPos
              ? { position: "fixed", left: dragPos.left, top: dragPos.top }
              : buttonPos(corner, showFigure, box.h)
          }
          className={cn(
            "z-50 cursor-pointer rounded-full focus:outline-none focus-visible:ring-2 focus-visible:ring-accent",
            !dragPos && styles.float,
            // The figure's box is mostly transparent: let clicks there
            // reach the page, and take them only on the figure (below).
            showFigure && "pointer-events-none",
            !showFigure &&
              "flex h-12 w-12 items-center justify-center border border-border bg-card shadow-lg"
          )}
        >
          {!showFigure && <Sparkles className="h-5 w-5 text-accent" aria-hidden="true" />}
          {showFigure && (
            <span
              aria-hidden="true"
              data-mascot-hit
              className="pointer-events-auto absolute z-10 rounded-full"
              style={hitBox(box)}
            />
          )}
          {mountFigure && (
            <div
              aria-hidden="true"
              className={
                showFigure ? undefined : "pointer-events-none absolute bottom-0 right-0 opacity-0"
              }
            >
              <MascotSprite
                width={box.w}
                height={box.h}
                onLoadError={() => setFigureFailed(true)}
              />
            </div>
          )}
        </button>
      )}
    </>
  );
}
