"use client";

/**
 * The end of Amr's latest reply, once its turn has settled, on his side right
 * under the balloon (design 1.2, "Under the latest reply"). The log places
 * it (chat-log, after chat-items latestReply); the chat's container hands the
 * log this component and its Try again.
 *
 *   Copy reply  the reply's markdown on the clipboard (lib/utils/clipboard),
 *               said in the composer's status note ("Reply copied"), its one
 *               live span, through the chat context's note; never a toast.
 *               With no composer there, the app's announcer says it
 *   Try again   when the turn ran no change (the client's canRetry, as the
 *               notice's Try again: the container hands both the same one),
 *               so trying again repeats none. A visitor's says what it
 *               spends (`cost`, in the visitor chat's words from
 *               lib/visitor-ai/allowance). It goes as the turn it starts begins,
 *               so it hands focus on first, as the notice's does (chat-context
 *               focusBeforeTurn)
 *   follow-ups  up to two (lib/agent/follow-ups: no model call, so a
 *               visitor's allowance pays for none), in the reader's own
 *               words: suggestion chips that fill the message box and never
 *               send. They wait while the panel is compact
 *
 * While a notice shows, it is the turn's end and has its own button, so this
 * draws nothing. Ghost buttons, 44 px on a touch screen; nothing moves in.
 *
 * A module of its own, and with it the follow-ups' rules and the clipboard
 * helper: the owner's chat imports it, and a visitor's loads it with the
 * first message (visitor-agent-panel), since nothing needs it before a reply,
 * so the chat chunk both chats share doesn't carry it.
 *
 * Runtime parts (the agent store), so this lives in chat/, which every-page
 * code may not reach (test/agent/bundle-boundary.test.ts).
 */

import { useRef, type MouseEvent } from "react";
import { useAnnounce } from "@/components/a11y/live-announcer";
import { Button } from "@/components/ui/button";
import { followUps } from "@/lib/agent/follow-ups";
import { useAgentStore } from "@/lib/agent/store";
import { cn } from "@/lib/utils";
import { copyToClipboard } from "@/lib/utils/clipboard";
import { COMPACT_HIDDEN } from "../mascot/panel-context";
import { focusBeforeTurn, useChat } from "./chat-context";
import type { ReplyTurn } from "./chat-items";
import type { ChatNoticeProps } from "./chat-notice";
import { SuggestionChips } from "./suggestion-chips";

/** Said in the composer's status note once Copy reply put the reply on the clipboard. */
export const REPLY_COPIED = "Reply copied";
/** Said there when the clipboard wouldn't take it. */
export const COPY_FAILED = "Couldn't copy the reply";
/** The follow-ups' list, as a screen reader names it. */
export const FOLLOW_UPS_LABEL = "Ways to follow up";

/**
 * The chat's Try again under its latest reply: the notice's own wiring
 * (chat-notice), so both run the client's one retry, only while it allows.
 */
export interface ReplyRetry extends Pick<ChatNoticeProps, "canRetry" | "onTryAgain"> {
  /**
   * What a visitor's Try again spends, in brackets after its name ("uses 1 of
   * your 12 left": lib/visitor-ai/allowance retryCost). The owner's is left out.
   */
  cost?: string;
}

export interface ReplyEndProps {
  turn: ReplyTurn;
  /** Try again, when the chat can run one now; it shows only while canRetry says the turn ran no change. */
  retry?: ReplyRetry;
}

/**
 * A row under Amr's balloon, lined up with it on his side. The side away from
 * him keeps the follow-up list's 1 px inset (suggestion-chips' mx-px), which
 * keeps High contrast's 5 px focus ring inside the log's 4 px padding when a
 * long chip wraps to the full width.
 */
const AMR_ROW =
  "ml-3.5 group-data-[amr-side=right]/amr:ml-px group-data-[amr-side=right]/amr:mr-3.5 group-data-[amr-side=right]/amr:justify-end";

/** The end of the latest reply: see the file comment. */
export function ReplyEnd({ turn, retry }: ReplyEndProps) {
  const { focusComposer, note } = useChat();
  const announce = useAnnounce();
  const noticed = useAgentStore((s) => s.notice !== null);
  const canRetry = retry?.canRetry;
  const retryable = useAgentStore((s) => !!canRetry && canRetry(s.messages));
  const copying = useRef(false);
  if (noticed) return null;

  const { reply, steps, asked } = turn;
  const next = followUps({ reply: reply.text, steps, asked });
  const copy = async () => {
    if (copying.current) return;
    copying.current = true;
    const said = (await copyToClipboard(reply.text)) ? REPLY_COPIED : COPY_FAILED;
    copying.current = false;
    // No composer (a read-only chat): the app's announcer says it instead.
    if (!note(said)) announce(said);
  };
  const again = (e: MouseEvent<HTMLButtonElement>) => {
    focusBeforeTurn(e, focusComposer);
    retry?.onTryAgain();
  };

  return (
    <div data-chat-reply-end="" data-message-id={reply.messageId}>
      <div className={cn("flex flex-wrap gap-1", AMR_ROW)}>
        <Button type="button" variant="ghost" size="sm" onClick={() => void copy()}>
          Copy reply
        </Button>
        {retry && retryable && (
          <Button type="button" variant="ghost" size="sm" onClick={again}>
            {retry.cost === undefined ? "Try again" : `Try again (${retry.cost})`}
          </Button>
        )}
      </div>
      {next.length > 0 && (
        <SuggestionChips
          starters={next}
          label={FOLLOW_UPS_LABEL}
          className={cn("mt-2", AMR_ROW, COMPACT_HIDDEN)}
        />
      )}
    </div>
  );
}
