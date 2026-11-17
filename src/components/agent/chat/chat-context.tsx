"use client";

/**
 * What the comic strip's parts (chat-items and the log around them) need to
 * know about the chat they are in, given once by the chat's container (the
 * owner's agent-conversation, the visitor's visitor-agent-panel) instead of
 * passed down to every item:
 *
 *   profile        whose chat it is: the owner's, where each tool step gets
 *                  "Details" with the raw arguments and result, or a
 *                  visitor's, which never shows any JSON
 *   logId          the id of the chat's log (role="log"), for a control that
 *                  points at it
 *   composerId     the id of the message box, which the box itself carries,
 *                  for a control that points at it
 *   focusComposer  put focus in the message box with the caret at the end:
 *                  where a control that takes itself away hands focus (Try
 *                  again, Go on, Latest, a starter); false when there is no
 *                  box to take it (a read-only chat)
 *
 * The value keeps its identity across the container's renders (it changes
 * only with the profile), so a memoised item never re-renders for it while a
 * reply streams. Without a provider a part gets a visitor's chat with
 * nothing to focus: the safe default, which never shows JSON.
 *
 * Runtime parts live in chat/, which every-page code may not reach
 * (test/agent/bundle-boundary.test.ts); this file itself is React only.
 */

import { createContext, useContext, useId, useMemo, type ReactNode, type RefObject } from "react";
import type { ChatProfile } from "@/lib/agent/store";

export interface ChatContextValue {
  profile: ChatProfile;
  logId: string;
  composerId: string;
  focusComposer(): boolean;
}

/**
 * Put focus in a text field with the caret after its last character, so a
 * handoff never selects or splits what the reader has typed. False when
 * there is no field, or it can't take focus.
 */
export function focusAtEnd(el: HTMLElement | null | undefined): boolean {
  if (!el || !el.isConnected) return false;
  el.focus();
  if (el instanceof HTMLTextAreaElement || el instanceof HTMLInputElement) {
    const end = el.value.length;
    try {
      el.setSelectionRange(end, end);
    } catch {
      // An input type with no caret (none here today): focus is enough.
    }
  }
  return el.ownerDocument.activeElement === el;
}

/** No chat around the part: a visitor's, with nothing to focus. */
export const NO_CHAT: ChatContextValue = Object.freeze({
  profile: "visitor",
  logId: "amr-chat-log",
  composerId: "amr-chat-composer",
  focusComposer: () => false,
});

const ChatContext = createContext<ChatContextValue>(NO_CHAT);
ChatContext.displayName = "ChatContext";

export interface ChatProviderProps {
  profile: ChatProfile;
  /**
   * The message box, when the container holds a ref to it. Without one,
   * focusComposer finds the box by composerId, which the box then carries.
   */
  composerRef?: RefObject<HTMLTextAreaElement | null>;
  children: ReactNode;
}

/** The chat around the strip's parts: give it once, around the log and the composer. */
export function ChatProvider({ profile, composerRef, children }: ChatProviderProps) {
  const base = useId();
  const value = useMemo<ChatContextValue>(() => {
    const composerId = `${base}composer`;
    return {
      profile,
      logId: `${base}log`,
      composerId,
      focusComposer: () =>
        focusAtEnd(composerRef?.current ?? globalThis.document?.getElementById(composerId)),
    };
  }, [base, profile, composerRef]);
  return <ChatContext.Provider value={value}>{children}</ChatContext.Provider>;
}

/** The chat this part is in, or the safe default (NO_CHAT) when there is none. */
export function useChat(): ChatContextValue {
  return useContext(ChatContext);
}
