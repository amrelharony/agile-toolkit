"use client";

/**
 * Clear chat in a visitor's chat (visitor-agent-panel), with Undo.
 *
 * A visitor's chat is never saved, so a clear would lose it for good. It goes
 * through undoable() (lib/utils/undoable), whose toast offers Undo for 8 s,
 * and leaves a narration caption in the log, "Chat cleared · Undo", the
 * narrator's line and never Amr's. The caption's Undo takes focus as the
 * caption comes (Clear chat itself goes with the messages, and a toast at
 * the top of a phone is out of reach for a keyboard or a screen reader), and
 * the caption stays until the next message goes out, however long that is.
 *
 * Either Undo puts the chat back as it was, while it is still empty: its
 * messages, the notice under them, a refusal it was showing (so a chat that
 * was read-only is again) and what was in the box, if the box is empty now.
 * Once a new message has gone out there is nothing to put back: the caption
 * goes, and the toast with it, so no Undo is left that would do nothing. The
 * caption's Undo hands focus to Clear chat in the panel header, which comes
 * back with the messages.
 *
 * A chunk of its own, loaded as the first message goes out (there is nothing
 * to clear before one), so the chat's first paint doesn't carry it. The
 * chat cleared is kept here, not in the chat, so it outlives the panel
 * closing; the caption's focus is taken once per clear, never again when the
 * panel opens on it.
 */

import { useEffect, useLayoutEffect, useRef, useSyncExternalStore } from "react";
import { flushSync } from "react-dom";
import { Button } from "@/components/ui/button";
import { useAgentStore, type AgentNotice, type ChatProfile } from "@/lib/agent/store";
import type { ChatMessage } from "@/lib/agent/types";
import { toast } from "@/lib/utils/toast";
import { undoable } from "@/lib/utils/undoable";
import type { VisitorErrorCode } from "@/lib/visitor-ai/contract";
import { Narration } from "../comic/comic-parts";

/** The caption's words, and the toast's. */
export const CHAT_CLEARED = "Chat cleared";

/** Clear chat in the panel header: where the caption's Undo hands focus. */
export const CLEAR_CHAT_SELECTOR = "[data-visitor-clear]";

/** The chat as it was before Clear chat, while it can still come back. */
interface Cleared {
  messages: ChatMessage[];
  notice: AgentNotice | null;
  fallback: VisitorErrorCode | null;
  draft: string;
  profile: ChatProfile;
  /** The Undo toast, closed once nothing is left to undo. */
  toastId?: string | number;
  /** Which clear this is: its caption takes focus once. */
  seq: number;
}

let cleared: Cleared | null = null;
let clears = 0;
/** The clear whose caption last took focus. */
let focusedSeq = 0;
const listeners = new Set<() => void>();

function setCleared(next: Cleared | null): void {
  cleared = next;
  listeners.forEach((listener) => listener());
}

function subscribe(listener: () => void): () => void {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}

const current = () => cleared;

/** Nothing left to put back: the caption goes, and the toast with it. */
function forget(): void {
  const was = cleared;
  if (!was) return;
  setCleared(null);
  if (was.toastId !== undefined) toast.dismiss(was.toastId);
}

/**
 * Put the chat cleared back, if the chat is still empty and still the same
 * visitor's (one who turned out to be the owner has a chat of their own).
 * True when it came back.
 */
function restore(): boolean {
  const was = cleared;
  if (!was) return false;
  const s = useAgentStore.getState();
  if (s.messages.length > 0 || s.streaming || s.chatProfile !== was.profile) {
    forget();
    return false;
  }
  useAgentStore.setState({
    messages: was.messages,
    visitorFallback: was.fallback,
    drafts: s.drafts.visitor ? s.drafts : { ...s.drafts, visitor: was.draft },
  });
  s.setNotice(was.notice);
  forget();
  return true;
}

/**
 * Clear the visitor's chat, with Undo (see the file comment). Through the
 * store: reset stops the answer under way before the chat empties, so none
 * of it lands in the fresh one. With nothing in the chat yet it only stops a
 * turn, and there is nothing to undo.
 */
export function clearVisitorChat(): void {
  const s = useAgentStore.getState();
  if (s.messages.length === 0) {
    s.reset();
    return;
  }
  // An earlier clear can't put its chat back over this one.
  forget();
  const was: Cleared = {
    messages: s.messages,
    notice: s.notice,
    fallback: s.visitorFallback,
    draft: s.drafts.visitor,
    profile: s.chatProfile,
    seq: ++clears,
  };
  const toastId = undoable({
    label: CHAT_CLEARED,
    apply: () => useAgentStore.getState().reset(),
    revert: () => {
      restore();
    },
  });
  setCleared({ ...was, toastId });
}

/**
 * "Chat cleared · Undo" in the log, while the chat cleared can still come
 * back: a narration caption whose Undo takes focus once per clear.
 */
export function ClearedCaption() {
  const was = useSyncExternalStore(subscribe, current, () => null);
  const empty = useAgentStore((s) => s.messages.length === 0);
  const undoRef = useRef<HTMLButtonElement>(null);
  const shown = was !== null && empty;

  // A new message went out: nothing to put back over it.
  useEffect(() => {
    if (!empty) forget();
  }, [empty]);

  // Before paint, so focus never rests on the page between the two.
  useLayoutEffect(() => {
    if (!shown || !was || focusedSeq === was.seq) return;
    focusedSeq = was.seq;
    undoRef.current?.focus();
  }, [shown, was]);

  if (!shown) return null;
  const undo = () => {
    const doc = undoRef.current?.ownerDocument;
    // The chat back first, so Clear chat is drawn again to take focus.
    flushSync(() => {
      restore();
    });
    doc?.querySelector<HTMLElement>(CLEAR_CHAT_SELECTOR)?.focus();
  };
  return (
    <Narration
      data-chat-cleared=""
      actions={
        <Button ref={undoRef} type="button" variant="outline" size="sm" onClick={undo}>
          Undo
        </Button>
      }
    >
      {CHAT_CLEARED}
    </Narration>
  );
}
