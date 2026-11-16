"use client";

/**
 * Where the chat's log finds the strip kit (chat/strip-kit: the parts that
 * draw messages), static for both chats and tiny: React only, and the kit's
 * type alone. The kit itself fills it when it is evaluated: the owner's chat
 * imports it statically, a visitor's runtime brings it on the first message
 * (mascot/visitor-chat-runtime), and tests import it.
 *
 * A module-level holder, not chat-context state: only the parts that draw
 * with it (the log, the status line) subscribe, never the chat's container,
 * so a streamed chunk still draws nothing there
 * (test/agent/chat-stream-renders.test.tsx). A visitor's log has no message
 * to draw before the kit is in: messages come only from the runtime that
 * brings it.
 */

import { useSyncExternalStore } from "react";
import type { StripKit } from "./strip-kit";

let kit: StripKit | null = null;
const listeners = new Set<() => void>();

/** Fill the holder; the same kit again changes nothing and tells no one. */
export function provideStripKit(next: StripKit): void {
  if (kit === next) return;
  kit = next;
  listeners.forEach((listener) => listener());
}

/** The kit, once something has provided it (null before). */
export function currentStripKit(): StripKit | null {
  return kit;
}

/** Hear of each new kit provided; returns the unsubscribe. */
export function subscribeStripKit(listener: () => void): () => void {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}

/** The kit, drawn again as it arrives (null until then). */
export function useStripKit(): StripKit | null {
  return useSyncExternalStore(subscribeStripKit, currentStripKit, currentStripKit);
}
