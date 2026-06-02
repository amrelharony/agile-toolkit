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

import { useEffect, useRef } from "react";
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
  const onMascotClick = () => {
    clickRef.current?.onClick();
    const now = Date.now();
    if (now - lastToggleRef.current > 500) {
      lastToggleRef.current = now;
      toggleSheet();
    }
  };
  useEffect(() => () => clickRef.current?.dispose(), []);

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
          className="fixed bottom-[228px] right-4 z-50 flex h-[min(68vh,560px)] w-[min(92vw,380px)] flex-col overflow-hidden rounded-2xl border border-border bg-surface-deep/95 shadow-2xl backdrop-blur"
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
        aria-label={open ? "Close assistant" : "Open assistant"}
        title="Ask ElharonyClaw"
        className={`fixed bottom-1 right-2 z-50 cursor-pointer rounded-full focus:outline-none focus-visible:ring-2 focus-visible:ring-accent ${styles.float}`}
      >
        <Mascot3D width={130} height={220} />
      </button>
    </>
  );
}
