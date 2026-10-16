"use client";

/**
 * Floating 3D mascot + chat panel — replaces the agent sheet (Phase 3).
 *
 * The mascot is always present (bottom-right). Clicking it — or the header
 * button, or Cmd/Ctrl+J — toggles a chat panel that binds to the SAME
 * useAgentStore + sendUserMessage + ConfirmAction as before, so the agent's
 * tool-calling brain, confirm cards, and persistence are unchanged; only the
 * shell is new. The mascot "talks" (Talking clip) while the agent streams.
 *
 * The agent itself is owner-only. Visitors keep the mascot (clicks, Konami,
 * Cmd/Ctrl+J) but the panel shows <VisitorGuide/> — a tool finder — instead
 * of the chat, so their panel never touches /api/agent/* or the agent tables
 * in Supabase. The chat (and the action registry it needs) is a separate
 * dynamic chunk, owner-agent-panel, so visitors never download it either.
 */

import {
  useCallback,
  useEffect,
  useRef,
  useState,
  type CSSProperties,
  type PointerEvent as ReactPointerEvent,
} from "react";
import dynamic from "next/dynamic";
import { usePathname } from "next/navigation";
import { X, Plus, History, Sparkles } from "lucide-react";
import { cn } from "@/lib/utils";
import { useAgentStore } from "@/lib/agent/store";
import { useOwnerState } from "@/lib/auth/use-is-owner";
import { isComicRoute } from "@/lib/comic/agile-at-work";
import { useMascotStore } from "@/lib/agent/mascot/store";
import { useMascotChatReactions } from "@/lib/agent/mascot/use-chat-reactions";
import { createClickInteraction } from "./engine/interactions/clicks";
import { installKonami } from "./engine/customization/commands";
import { playMascotSound } from "./engine/audio/mascot-audio";
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
/** Size of the Mascot3D canvas inside that button (see <Mascot3D height>). */
const MASCOT_BOX = { w: 130, h: 220 };
/** Phones get a smaller figure so it covers less of the page. */
const MASCOT_BOX_PHONE = { w: 96, h: 162 };
/** The round launcher shown until the 3D figure is ready (or if it can't run). */
const LAUNCHER_SIZE = 48;
/** Remount attempts after the GPU drops the WebGL context. */
const MAX_CONTEXT_RECOVERIES = 2;
/**
 * Where the figure actually lands inside that 220px canvas. The 3D framing
 * (fov 62, camera at z 2.5 — mascot-3d.tsx) renders the model across rows
 * 50…154, so the visible mascot is only ~105px tall: 50px of transparent
 * headroom above its head and 65px below its feet. Anchoring the chat panel to
 * the canvas edge instead of the figure left it floating ~54px off the mascot's
 * head, which read as a detached, unrelated panel.
 */
const MODEL_TOP = 50;
const MODEL_BOTTOM = 155;
/** Breathing room between the mascot's silhouette and the panel. */
const PANEL_GAP = 6;

/** Fixed-position style for the float button at a corner (default ≈ bottom-1 right-2). */
function buttonPos(c: Corner): CSSProperties {
  return {
    position: "fixed",
    ...(c.startsWith("top") ? { top: BUTTON_INSET } : { bottom: BUTTON_INSET }),
    ...(c.endsWith("Left") ? { left: 8 } : { right: 8 }),
  };
}

/**
 * Chat-panel style for a corner — hugs the mascot's silhouette, not its canvas.
 * `boxH` is the rendered canvas height (the model rows scale with it); with
 * the launcher showing, the panel clears the launcher instead.
 */
function panelPos(c: Corner, figure: boolean, boxH: number): CSSProperties {
  const scale = boxH / MASCOT_BOX.h;
  const top = figure ? MODEL_TOP * scale : 0;
  const bottom = figure ? MODEL_BOTTOM * scale : LAUNCHER_SIZE;
  const height = figure ? boxH : LAUNCHER_SIZE;
  return {
    ...(c.startsWith("top")
      ? // Parked up top: clear the model's feet.
        { top: BUTTON_INSET + bottom + PANEL_GAP }
      : // Parked at the bottom: clear its head.
        { bottom: BUTTON_INSET + (height - top) + PANEL_GAP }),
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

/**
 * Defer the 3D figure (three.js + the model) until the browser is idle, so it
 * never competes with the page's own content. Skipped entirely when the
 * visitor asked to save data.
 */
function useDeferred3d(): boolean {
  const [ready, setReady] = useState(false);
  useEffect(() => {
    const nav = navigator as Navigator & { connection?: { saveData?: boolean } };
    if (nav.connection?.saveData) return;
    const w = window as Window & {
      requestIdleCallback?: (cb: () => void, opts?: { timeout: number }) => number;
      cancelIdleCallback?: (id: number) => void;
    };
    if (w.requestIdleCallback) {
      const id = w.requestIdleCallback(() => setReady(true), { timeout: 3000 });
      return () => w.cancelIdleCallback?.(id);
    }
    const t = window.setTimeout(() => setReady(true), 300);
    return () => window.clearTimeout(t);
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

const Mascot3D = dynamic(() => import("./mascot-3d"), { ssr: false });
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
  // The comic reader fills the viewport, so its toolbar (Prev/Next, the
  // scrubber, Download PDF) always ends up under the fixed figure's 130×220
  // hit box — on phones and desktops alike. The figure steps aside on that
  // route; the header button and Cmd/Ctrl+J still open the chat.
  const pathname = usePathname();
  const isPhone = useIsPhone();
  const typingOnPhone = useTypingOnPhone(isPhone);
  const hideFigure = isComicRoute(pathname) || typingOnPhone;
  const box = isPhone ? MASCOT_BOX_PHONE : MASCOT_BOX;

  // The 3D figure loads after the page is idle; until it's ready (or if
  // WebGL can't run) a small launcher keeps the assistant one click away
  // without an invisible 130×220 hit box over the page.
  const load3d = useDeferred3d();
  const figureReady = useMascotStore((s) => s.ready);
  const [figureFailed, setFigureFailed] = useState(false);
  const [contextLosses, setContextLosses] = useState(0);
  const [figureKey, setFigureKey] = useState(0);
  const onContextLost = useCallback(() => setContextLosses((n) => n + 1), []);
  const onFigureError = useCallback(() => setFigureFailed(true), []);
  useEffect(() => {
    if (contextLosses === 0) return;
    if (contextLosses > MAX_CONTEXT_RECOVERIES) {
      setFigureFailed(true);
      return;
    }
    // Give the GPU a moment, then rebuild the scene from scratch.
    const t = window.setTimeout(() => setFigureKey((k) => k + 1), 1000);
    return () => window.clearTimeout(t);
  }, [contextLosses]);
  const mount3d = load3d && !figureFailed;
  const showFigure = mount3d && figureReady;

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
      }
    };
    const onUp = () => {
      dragCleanupRef.current?.(); // removes all three listeners + nulls the ref
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

  // Konami easter egg (spin + rainbow + XP) + restore persisted appearance.
  useEffect(() => {
    useMascotStore.getState().hydrateAppearance();
    return installKonami(() => addXp(10));
  }, []);

  // Drive the mascot from the conversation: talk while streaming, think on send,
  // react to tool results, shift mood to the reply's sentiment.
  useMascotChatReactions();

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
          aria-label="ElharonyClaw assistant"
          aria-modal={false}
          style={panelPos(corner, showFigure, box.h)}
          className="fixed z-50 flex h-[min(68vh,560px)] w-[min(92vw,380px)] flex-col overflow-hidden rounded-2xl border border-border bg-surface-deep/95 shadow-2xl backdrop-blur"
        >
          <div className="flex items-center justify-between border-b border-border px-4 py-2.5">
            <div>
              <p className="text-sm font-semibold text-text">✦ ElharonyClaw</p>
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
                className="rounded-md p-1 text-sub transition-colors hover:bg-accent/10 hover:text-text"
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
          title="Ask ElharonyClaw · drag to reposition"
          style={
            dragPos
              ? { position: "fixed", left: dragPos.left, top: dragPos.top }
              : buttonPos(corner)
          }
          className={cn(
            "z-50 cursor-pointer rounded-full focus:outline-none focus-visible:ring-2 focus-visible:ring-accent",
            !dragPos && styles.float,
            !showFigure &&
              "flex h-12 w-12 items-center justify-center border border-border bg-card shadow-lg"
          )}
        >
          {!showFigure && <Sparkles className="h-5 w-5 text-accent" aria-hidden="true" />}
          {mount3d && (
            <div
              aria-hidden="true"
              className={
                showFigure ? undefined : "pointer-events-none absolute bottom-0 right-0 opacity-0"
              }
            >
              <Mascot3D
                key={`${figureKey}-${box.w}`}
                width={box.w}
                height={box.h}
                onContextLost={onContextLost}
                onLoadError={onFigureError}
              />
            </div>
          )}
        </button>
      )}
    </>
  );
}
