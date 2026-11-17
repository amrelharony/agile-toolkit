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
 *   note           show a line in the composer's status note, its one live
 *                  span (polite), where a control in the log says what it
 *                  just did ("Reply copied"); false when no composer is there
 *                  to show it
 *   takeNotes      the composer's way to show those lines while it is there;
 *                  hands back the call that lets go
 *   StepDetails    the owner's "Details" on a tool step (chat/step-details:
 *                  the raw arguments and result, owner only), handed in by
 *                  the owner's container, so a visitor's chat never loads
 *                  it; null in a visitor's chat, whatever was handed in
 *
 * The value keeps its identity across the container's renders (it changes
 * only with the profile), so a memoised item never re-renders for it while a
 * reply streams. Without a provider a part gets a visitor's chat with
 * nothing to focus and no Details: the safe default.
 *
 * Runtime parts live in chat/, which every-page code may not reach
 * (test/agent/bundle-boundary.test.ts); this file itself is React only.
 */

import {
  createContext,
  useContext,
  useId,
  useMemo,
  useRef,
  type ComponentType,
  type MouseEvent,
  type ReactNode,
  type RefObject,
} from "react";
import type { ChatStep } from "@/lib/agent/chat-view";
import type { ChatProfile } from "@/lib/agent/store";

/** What the owner's Details on a tool step is given. */
export interface StepDetailsProps {
  step: ChatStep;
  /** The step in words ("Retro Board · Add card “flaky CI”"), for a screen reader. */
  name: string;
}

export interface ChatContextValue {
  profile: ChatProfile;
  logId: string;
  composerId: string;
  focusComposer(): boolean;
  note(text: string): boolean;
  takeNotes(show: (text: string) => void): () => void;
  StepDetails: ComponentType<StepDetailsProps> | null;
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

/**
 * Hand focus to a part that takes none of its own (a step's caption, the
 * reader's latest question), from code only: it is focusable (tabindex -1)
 * just while it holds focus, so a tap on it never takes focus from the
 * message box. The page doesn't scroll for it. False when it can't take focus.
 */
export function focusFromCode(el: HTMLElement | null | undefined): boolean {
  if (!el?.isConnected) return false;
  const lent = !el.hasAttribute("tabindex");
  if (lent) el.setAttribute("tabindex", "-1");
  el.focus({ preventScroll: true });
  const took = el.ownerDocument.activeElement === el;
  if (lent) {
    if (took) el.addEventListener("blur", () => el.removeAttribute("tabindex"), { once: true });
    else el.removeAttribute("tabindex");
  }
  return took;
}

/**
 * A touch screen: a text field taking focus there raises the keyboard over
 * the strip. Kept here, not panel-context's helper, so nothing new reaches
 * mascot code.
 */
export const onTouchScreen = (doc: Document | null | undefined) =>
  doc?.defaultView?.matchMedia?.("(pointer: coarse)")?.matches === true;

/**
 * A click that was a tap on a touch screen, where the message box taking
 * focus would raise the keyboard. A key press clicks with detail 0, so it is
 * never one: a control may still hand focus to the box after it.
 */
export const tapOnTouchScreen = (e: { detail: number; currentTarget: Element }) =>
  e.detail > 0 && onTouchScreen(e.currentTarget.ownerDocument);

/**
 * Hand focus on before a button that starts a turn goes with it (Try again,
 * Go on): after a key press to the message box, caret at the end; after a
 * tap on a touch screen to the latest question's caption (focusable just for
 * that, focusFromCode), since the box taking focus would raise the keyboard
 * over the answer just asked for. The turn keeps that question.
 */
export function focusBeforeTurn(e: MouseEvent<HTMLElement>, focusComposer: () => boolean): void {
  if (!tapOnTouchScreen(e)) {
    focusComposer();
    return;
  }
  const asked =
    e.currentTarget
      .closest('[role="log"]')
      ?.querySelectorAll<HTMLElement>('[data-chat-item="you"]') ?? [];
  focusFromCode(asked[asked.length - 1]);
}

/** No chat around the part: a visitor's, with nothing to focus and no composer for a note. */
export const NO_CHAT: ChatContextValue = Object.freeze({
  profile: "visitor",
  logId: "amr-chat-log",
  composerId: "amr-chat-composer",
  focusComposer: () => false,
  note: () => false,
  takeNotes: () => () => {},
  StepDetails: null,
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
  /** The owner's Details on a tool step (chat/step-details); used in the owner's chat only. */
  stepDetails?: ComponentType<StepDetailsProps>;
  children: ReactNode;
}

/** The chat around the strip's parts: give it once, around the log and the composer. */
export function ChatProvider({ profile, composerRef, stepDetails, children }: ChatProviderProps) {
  const base = useId();
  // The composer showing its notes now (takeNotes), if one is.
  const notes = useRef<((text: string) => void) | null>(null);
  const value = useMemo<ChatContextValue>(() => {
    const composerId = `${base}composer`;
    return {
      profile,
      logId: `${base}log`,
      composerId,
      focusComposer: () =>
        focusAtEnd(composerRef?.current ?? globalThis.document?.getElementById(composerId)),
      note: (text) => {
        notes.current?.(text);
        return notes.current !== null;
      },
      takeNotes: (show) => {
        notes.current = show;
        return () => {
          if (notes.current === show) notes.current = null;
        };
      },
      // A visitor never sees a step's arguments or result, whoever renders the chat.
      StepDetails: profile === "owner" ? (stepDetails ?? null) : null,
    };
  }, [base, profile, composerRef, stepDetails]);
  return <ChatContext.Provider value={value}>{children}</ChatContext.Provider>;
}

/** The chat this part is in, or the safe default (NO_CHAT) when there is none. */
export function useChat(): ChatContextValue {
  return useContext(ChatContext);
}
