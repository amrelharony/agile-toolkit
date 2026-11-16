"use client";

/**
 * The chat's notice (the store's `notice`: a note or an error the client
 * wrote), shared by both chats' logs, under the items: a narration caption,
 * the narrator's line about Amr in the third person, never a balloon and
 * never his own words (DNA-SPEC section 6, "Chat strip").
 *
 *   tone     "note" draws the quiet caption; "error" its danger line
 *            (data-tone="error"), the words saying what went wrong. No
 *            role="alert": the error's one assertive announcement comes from
 *            the chat's announcer (use-turn-announcer), so this adds none,
 *            and a note is read with the turn it ended.
 *   button   by the notice's kind (lib/agent/notice-actions), once no turn is
 *            under way: "Go on" (an answer cut short, every tool round used),
 *            which sends a real "Go on" message, or "Try again" for a failure
 *            a second try may get past, only while the client allows it (the
 *            last turn ran no change, so trying again repeats none).
 *
 * The button goes as the turn it starts begins, so it hands focus to the
 * message box first, caret at the end: always after a key press; after a tap
 * on a touch screen it leaves focus be, since the box taking focus would
 * raise the keyboard over the answer just asked for (as chat-frame's Latest
 * and its safety net do).
 *
 * It reads the notice from the store itself, so the container around it
 * never re-renders for one.
 *
 * Runtime parts (the agent store), so this lives in chat/, which every-page
 * code may not reach (test/agent/bundle-boundary.test.ts).
 */

import type { MouseEvent } from "react";
import { Button } from "@/components/ui/button";
import { noticeAction } from "@/lib/agent/notice-actions";
import { useAgentStore } from "@/lib/agent/store";
import type { ChatMessage } from "@/lib/agent/types";
import { Narration } from "../comic/comic-parts";
import { onTouchScreen, useChat } from "./chat-context";

export interface ChatNoticeProps {
  /** A button may show: no turn under way, and one can start (the owner is signed in). */
  ready: boolean;
  /** The client's word on Try again for this chat: true when the last turn ran no change. */
  canRetry(messages: ChatMessage[]): boolean;
  /** Ask the same question again (the client's retry). */
  onTryAgain(): void;
  /** Send "Go on" (the client's goOn). */
  onGoOn(): void;
}

/** The store's notice as a narration caption under the log's items, or nothing. */
export function ChatNotice({ ready, canRetry, onTryAgain, onGoOn }: ChatNoticeProps) {
  const notice = useAgentStore((s) => s.notice);
  const { profile, focusComposer } = useChat();
  const action = ready ? noticeAction(notice, profile) : null;
  const retry = useAgentStore((s) => action === "retry" && canRetry(s.messages));
  if (!notice) return null;

  const offer: [string, () => void] | null = retry
    ? ["Try again", onTryAgain]
    : action === "go_on"
      ? ["Go on", onGoOn]
      : null;
  const press = (e: MouseEvent<HTMLButtonElement>) => {
    // A key press (detail 0), or any press but a tap on a touch screen.
    if (!(e.detail > 0 && onTouchScreen(e.currentTarget.ownerDocument))) focusComposer();
    offer?.[1]();
  };

  return (
    <Narration
      tone={notice.tone}
      data-notice-kind={notice.kind}
      data-chat-notice=""
      actions={
        offer && (
          <Button type="button" variant="outline" size="sm" onClick={press}>
            {offer[0]}
          </Button>
        )
      }
    >
      {notice.text}
    </Narration>
  );
}
