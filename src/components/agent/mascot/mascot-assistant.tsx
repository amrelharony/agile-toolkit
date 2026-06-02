"use client";

/**
 * Floating 3D mascot + chat panel — replaces the agent sheet (Phase 3).
 *
 * The mascot is always present (bottom-right). Clicking it — or the header
 * button, or Cmd/Ctrl+J — toggles a chat panel that binds to the SAME
 * useAgentStore + sendUserMessage + ConfirmAction as before, so the agent's
 * tool-calling brain, confirm cards, and persistence are unchanged; only the
 * shell is new. The mascot "talks" (Talking clip) while the agent streams.
 */

import {
  useEffect,
  useRef,
  useState,
  type CSSProperties,
  type PointerEvent as ReactPointerEvent,
} from "react";
import dynamic from "next/dynamic";
import { X } from "lucide-react";
import { useAgentStore } from "@/lib/agent/store";
import { useMascotStore } from "@/lib/agent/mascot/store";
import { abortInFlight } from "@/lib/agent/client";
import { useMascotChatReactions } from "@/lib/agent/mascot/use-chat-reactions";
import { createClickInteraction } from "./engine/interactions/clicks";
import { installKonami } from "./engine/customization/commands";
import { playMascotSound } from "./engine/audio/mascot-audio";
import { RateLimitBar } from "./rate-limit-bar";
import { AgentConversation } from "../agent-conversation";
import styles from "./mascot-assistant.module.css";

/** Award XP via the gamification window bridge (no-op if unavailable). */
function addXp(n: number): void {
  (window as unknown as { VDna?: { addXp?: (x: number) => void } }).VDna?.addXp?.(n);
}

/** Which corner the mascot is parked in (drag-to-reposition). */
type Corner = "topLeft" | "topRight" | "bottomLeft" | "bottomRight";

/** Fixed-position style for the float button at a corner (default ≈ bottom-1 right-2). */
function buttonPos(c: Corner): CSSProperties {
  return {
    position: "fixed",
    ...(c.startsWith("top") ? { top: 4 } : { bottom: 4 }),
    ...(c.endsWith("Left") ? { left: 8 } : { right: 8 }),
  };
}

/** Chat-panel style for a corner — sits just inboard of the mascot. */
function panelPos(c: Corner): CSSProperties {
  return {
    ...(c.startsWith("top") ? { top: 228 } : { bottom: 228 }),
    ...(c.endsWith("Left") ? { left: 16 } : { right: 16 }),
  };
}

const Mascot3D = dynamic(() => import("./mascot-3d"), { ssr: false });

export function MascotAssistant() {
  const open = useAgentStore((s) => s.open);
  const toggleSheet = useAgentStore((s) => s.toggleSheet);
  const closeSheet = useAgentStore((s) => s.closeSheet);

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
      dragCleanupRef.current?.(); // removes both listeners + nulls the ref
      if (moved) {
        // Snap from the last DRAGGED position (React batches setDragPos, so the
        // DOM rect may still read the start position here).
        const cx = last.left + w / 2;
        const cy = last.top + h / 2;
        const next = `${cy < window.innerHeight / 2 ? "top" : "bottom"}${
          cx < window.innerWidth / 2 ? "Left" : "Right"
        }` as Corner;
        setCorner(next);
        setDragPos(null);
        // Suppress the click that fires right after a drag-release.
        draggedRef.current = true;
        setTimeout(() => (draggedRef.current = false), 60);
      }
    };
    document.addEventListener("pointermove", onMove);
    document.addEventListener("pointerup", onUp);
    dragCleanupRef.current = () => {
      document.removeEventListener("pointermove", onMove);
      document.removeEventListener("pointerup", onUp);
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

  // Abort any in-flight stream when the panel closes/unmounts (from agent-sheet).
  useEffect(() => {
    if (!open) abortInFlight();
  }, [open]);
  useEffect(() => () => abortInFlight(), []);

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

  return (
    <>
      {open && (
        <div
          data-agent-sheet-root
          style={panelPos(corner)}
          className="fixed z-50 flex h-[min(68vh,560px)] w-[min(92vw,380px)] flex-col overflow-hidden rounded-2xl border border-border bg-surface-deep/95 shadow-2xl backdrop-blur"
        >
          <div className="flex items-center justify-between border-b border-border px-4 py-2.5">
            <div>
              <p className="text-sm font-semibold text-text">✦ ElharonyClaw</p>
              <p className="text-[11px] text-sub">Drive every tool · Cmd/Ctrl+J to toggle</p>
            </div>
            <button
              type="button"
              onClick={closeSheet}
              aria-label="Close assistant"
              className="rounded-md p-1 text-sub transition-colors hover:bg-accent/10 hover:text-text"
            >
              <X className="h-4 w-4" aria-hidden="true" />
            </button>
          </div>
          <RateLimitBar />
          <div className="min-h-0 flex-1 px-3 py-2">
            <AgentConversation />
          </div>
        </div>
      )}

      {/* Always-present floating mascot — click to toggle the chat. */}
      <button
        type="button"
        onClick={onMascotClick}
        onPointerDown={onPointerDown}
        aria-label={open ? "Close assistant" : "Open assistant"}
        title="Ask ElharonyClaw · drag to reposition"
        style={
          dragPos ? { position: "fixed", left: dragPos.left, top: dragPos.top } : buttonPos(corner)
        }
        className={`z-50 cursor-pointer rounded-full focus:outline-none focus-visible:ring-2 focus-visible:ring-accent ${
          dragPos ? "" : styles.float
        }`}
      >
        <Mascot3D width={130} height={220} />
      </button>
    </>
  );
}
