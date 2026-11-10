"use client";

import { create } from "zustand";

/**
 * A short line Amr says beside himself, outside the chat: an offer ("Tilt your
 * phone, I'll feel it"), a greeting, a word when someone seems stuck. One at a
 * time; a new one replaces the one showing. The bubble is drawn by
 * components/agent/mascot/mascot-bubble.tsx, where the moment chip stands, and
 * waits while a moment chip is up. Every line he can say is in lines.ts.
 */

export interface BubbleAction {
  label: string;
  /** Called from the tap itself, so it may ask the browser for a permission. */
  run(): void;
}

export interface MascotBubble {
  /** Names the bubble: showing the same id again replaces it. */
  id: string;
  text: string;
  /** Up to two answers. With none, the bubble fades on its own (or is tapped: onTap). */
  actions?: readonly BubbleAction[];
  /** Tapping the line itself (only when it has no answers). */
  onTap?(): void;
  /** How long it stays, in ms. */
  ms?: number;
  /** It went unanswered: it timed out, or was closed. */
  onIgnore?(): void;
}

/** How long a line stays when nothing is asked. */
export const BUBBLE_MS = 4000;
/** How long a question waits for its answer. */
export const BUBBLE_ASK_MS = 10_000;

interface BubbleState {
  current: MascotBubble | null;
  show(bubble: MascotBubble): void;
  /** Close the bubble (only the one named, when an id is given). `answered` skips onIgnore. */
  dismiss(id?: string, answered?: boolean): void;
}

export const useBubbleStore = create<BubbleState>()((set, get) => ({
  current: null,
  show: (bubble) => {
    const prev = get().current;
    if (prev && prev.id !== bubble.id) prev.onIgnore?.();
    set({ current: bubble });
  },
  dismiss: (id, answered = false) => {
    const cur = get().current;
    if (!cur || (id !== undefined && cur.id !== id)) return;
    set({ current: null });
    if (!answered) cur.onIgnore?.();
  },
}));

/** How long a bubble stays: its own time, or the usual for a line or a question. */
export function bubbleMs(bubble: Pick<MascotBubble, "ms" | "actions">): number {
  return bubble.ms ?? (bubble.actions?.length ? BUBBLE_ASK_MS : BUBBLE_MS);
}
