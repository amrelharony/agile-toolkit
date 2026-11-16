"use client";

/**
 * The comic strip's items (DNA-SPEC section 6, "Chat strip"): one memoised
 * component for each kind of lib/agent/chat-view item, shared by both chats'
 * logs (the owner's and a visitor's).
 *
 *   you      the reader's words, verbatim, in a you caption, on the side
 *            across from Amr
 *   balloon  Amr's own words in a speech balloon on his side, its tail toward
 *            the real Amr beside the panel (data-tail="amr", which globals.css
 *            turns to face him from the panel root's data-amr-side and
 *            data-amr-edge, so nothing re-renders when he moves): the reply
 *            as markdown, its lead lettered inside the first paragraph, and
 *            the full width of the log when it holds a table or code. Until
 *            a streaming reply's opening sentence is decided, the balloon
 *            scribbles with no words, so no word ever changes face
 *   steps    one narration caption for a run of tool calls (chat/tool-steps):
 *            each call's tool, verb and state in words, after a fixed slot
 *            for its running mark and ink tick, never the wire name, the
 *            arguments or the result string. Only the owner gets "Details",
 *            with the raw arguments and result (owner only); a visitor never
 *            sees them.
 *   note     a line the client wrote for Amr (the round limit's stand-in),
 *            in a narration caption with no "Amr said:": it is about him,
 *            not his words. Inline markdown, so an action's id is a chip.
 *   scene    a change of time, in a scene caption across the log: a new
 *            day ("Yesterday", in a <time>), or "Picking up where you left
 *            off" after a picked-up thread's last message
 *
 * A message with only tool calls draws no balloon: chat-view makes it steps
 * alone. No second Amr in the chat either: the real one stands beside it, and
 * the balloon's hidden "Amr said:" names him for a screen reader.
 *
 * Each kind is memoised on its view item, which createChatView hands back
 * unchanged when nothing in it changed (and the chat context keeps its
 * identity too), so a streamed flush re-renders only the reply still growing.
 *
 * Sides: the panel root (a `group/amr`) names Amr's side, and the items read
 * it as class names. His balloons stand on it, mirrored when he moves, and
 * keep 0.875rem from that edge for the tail, which stands 0.8rem out and a
 * scroller would clip; the reader's captions stand on the other side. With no
 * panel around them (a test, a preview), he is on the left. Each item is one
 * flex row, so it lays out the same in a block or a flex log.
 *
 * Nothing moves when an item arrives: it is simply there, in every mode.
 *
 * Under the latest reply, once its turn has settled, the log adds the reply's
 * end (ReplyEnd, below): Copy reply, Try again and up to two follow-ups.
 *
 * Runtime parts (the markdown renderer and its panel context), so this lives
 * in chat/, which every-page code may not reach
 * (test/agent/bundle-boundary.test.ts).
 */

import { memo, useRef, type MouseEvent } from "react";
import { useAnnounce } from "@/components/a11y/live-announcer";
import { Button } from "@/components/ui/button";
import { Narration, YouCaption } from "../comic/comic-parts";
import { AmrBalloon, SceneCaption, ThinkingBalloon } from "../comic/strip-parts";
import { Markdown } from "../markdown";
import { COMPACT_HIDDEN } from "../mascot/panel-context";
import {
  type BalloonItem,
  type ChatItem,
  type ChatStep,
  type NoteItem,
  type SceneItem,
  type StepsItem,
  type YouItem,
} from "@/lib/agent/chat-view";
import type { FollowUpTurn } from "@/lib/agent/follow-ups";
import { useAgentStore } from "@/lib/agent/store";
import { cn } from "@/lib/utils";
import { copyToClipboard } from "@/lib/utils/clipboard";
import { focusBeforeTurn, useChat } from "./chat-context";
import type { ChatNoticeProps } from "./chat-notice";
import { SuggestionChips } from "./suggestion-chips";
import { ToolSteps } from "./tool-steps";

/** The scene caption where a picked-up thread's last message was. */
export const PICKED_UP = "Picking up where you left off";

/** Amr's side of the log: a balloon stands there, mirrored when he moves, with room for its tail. */
const AMR_SIDE =
  "ml-3.5 mr-auto group-data-[amr-side=right]/amr:ml-auto group-data-[amr-side=right]/amr:mr-3.5";

/** The reader's side: across from Amr. */
const YOU_SIDE =
  "ml-auto group-data-[amr-side=right]/amr:ml-0 group-data-[amr-side=right]/amr:mr-auto";

/** How far a balloon or caption that doesn't run full width may reach across the log. */
const NARROW = "max-w-[85%]";

/** A row under Amr's balloon, lined up with it on his side. */
const AMR_ROW =
  "ml-3.5 group-data-[amr-side=right]/amr:ml-0 group-data-[amr-side=right]/amr:mr-3.5 group-data-[amr-side=right]/amr:justify-end";

/** The reader's words, in a you caption across from Amr. */
export const YouItemView = memo(function YouItemView({ item }: { item: YouItem }) {
  return (
    <div className="flex" data-chat-item="you" data-message-id={item.messageId}>
      <YouCaption className={cn(YOU_SIDE, NARROW)}>{item.text}</YouCaption>
    </div>
  );
});

/**
 * Amr's words, in a balloon on his side whose tail points at him. While the
 * reply's opening sentence is undecided (item.held), the balloon scribbles
 * with no words, so they first show in their final face, lettered or not.
 */
export const BalloonItemView = memo(function BalloonItemView({ item }: { item: BalloonItem }) {
  if (item.held) {
    return (
      <div className="flex" data-chat-item="balloon" data-message-id={item.messageId} data-held="">
        <ThinkingBalloon className={AMR_SIDE} />
      </div>
    );
  }
  return (
    <div
      className="flex"
      data-chat-item="balloon"
      data-message-id={item.messageId}
      data-wide={item.wide ? "" : undefined}
    >
      {/* A table or code needs the room: the balloon takes the row. */}
      <AmrBalloon className={cn(AMR_SIDE, item.wide ? "flex-1" : NARROW)}>
        <Markdown source={item.text} lead={item.lead} />
      </AmrBalloon>
    </div>
  );
});

/**
 * Amr about to answer (a turn under way, no words or steps of its reply yet):
 * his balloon on his side with a pen scribbling in it and no words. Hidden
 * from assistive tech; the chat's status line says it in words.
 */
export const ThinkingItemView = memo(function ThinkingItemView() {
  return (
    <div className="flex" data-chat-item="thinking">
      <ThinkingBalloon className={AMR_SIDE} />
    </div>
  );
});

/** A run of tool calls with no words between them: one step caption (chat/tool-steps). */
export const StepsItemView = memo(function StepsItemView({ item }: { item: StepsItem }) {
  return (
    <div data-chat-item="steps" data-message-id={item.steps[0]?.messageId} className="space-y-3">
      <ToolSteps steps={item.steps} />
    </div>
  );
});

/** A line the client wrote for Amr, told as narration: no balloon, no "Amr said:". */
export const NoteItemView = memo(function NoteItemView({ item }: { item: NoteItem }) {
  return (
    <div data-chat-item="note" data-message-id={item.messageId}>
      <Narration tone="note">
        <Markdown source={item.text} />
      </Narration>
    </div>
  );
});

/** A change of time: the day, or where a picked-up thread left off, as a scene caption. */
export const SceneItemView = memo(function SceneItemView({ item }: { item: SceneItem }) {
  return (
    <div data-chat-item="scene">
      <SceneCaption>
        {item.at === null ? PICKED_UP : <time dateTime={item.at}>{item.label}</time>}
      </SceneCaption>
    </div>
  );
});

// ── The reply's end ─────────────────────────────────────────────────────

/** Said in the composer's status note once Copy reply put the reply on the clipboard. */
export const REPLY_COPIED = "Reply copied";
/** Said there when the clipboard wouldn't take it. */
export const COPY_FAILED = "Couldn't copy the reply";

/** What Try again costs a visitor with `left` messages (null: not known yet), on its button. */
export const retryCost = (left: number | null) =>
  left === null
    ? "uses 1 message"
    : left === 1
      ? "uses your last message"
      : `uses 1 of your ${left} left`;

/**
 * The chat's Try again under its latest reply: the notice's own wiring
 * (chat-notice), so both run the client's one retry, only while it allows.
 */
export interface ReplyRetry extends Pick<ChatNoticeProps, "canRetry" | "onTryAgain"> {
  /** A visitor's messages left (null: not known yet), which the button says it spends one of. The owner's is left out. */
  left?: number | null;
}

/** The chat's follow-ups for a turn (lib/agent/follow-ups), handed in by its container. */
export type FollowUpsFor = (turn: FollowUpTurn) => readonly string[];

/** The latest reply, with what its turn ran and asked: what its end works from. */
export interface ReplyTurn {
  reply: BalloonItem;
  /** The turn's tool calls, oldest first. */
  steps: ChatStep[];
  /** The reader's question the turn answers, or null. */
  asked: string | null;
}

/**
 * The latest reply, when it is the strip's last word: the last item but for
 * scene captions (a picked-up thread's), a balloon that is done growing.
 * Null when the strip ends on a question, steps or a note instead.
 */
export function latestReply(items: readonly ChatItem[]): ReplyTurn | null {
  let at = items.length - 1;
  while (at >= 0 && items[at].kind === "scene") at--;
  const reply = items[at];
  if (reply?.kind !== "balloon" || reply.streaming || reply.held) return null;
  const turn: ReplyTurn = { reply, steps: [], asked: null };
  while (--at >= 0) {
    const item = items[at];
    if (item.kind === "you") {
      turn.asked = item.text;
      break;
    }
    if (item.kind === "steps") turn.steps.unshift(...item.steps);
  }
  return turn;
}

export interface ReplyEndProps {
  turn: ReplyTurn;
  /** Try again, when the chat can run one now; it shows only while canRetry says the turn ran no change. */
  retry?: ReplyRetry;
  followUps?: FollowUpsFor;
}

/**
 * The end of Amr's latest reply, once its turn has settled, on his side under
 * the balloon (design 1.2, "Under the latest reply"):
 *
 *   Copy reply  the reply's markdown on the clipboard (lib/utils/clipboard),
 *               said in the composer's status note ("Reply copied"), its one
 *               live span; never a toast
 *   Try again   when the turn ran no change (the client's canRetry, as the
 *               notice's Try again), so trying again repeats none. A visitor's
 *               says it spends one of the messages left. It goes as the turn
 *               it starts begins, so it hands focus on first, as the notice's
 *               does (chat-context focusBeforeTurn)
 *   follow-ups  up to two, from the chat's rules (no model call), as the
 *               reader's own words: suggestion chips that fill the message box
 *               and never send. They wait while the panel is compact
 *
 * While a notice shows, it is the turn's end and has its own button, so this
 * draws nothing. Ghost buttons, 44 px on a touch screen; nothing moves in.
 */
export function ReplyEnd({ turn, retry, followUps }: ReplyEndProps) {
  const { focusComposer, note } = useChat();
  const announce = useAnnounce();
  const noticed = useAgentStore((s) => s.notice !== null);
  const canRetry = retry?.canRetry;
  const retryable = useAgentStore((s) => !!canRetry && canRetry(s.messages));
  const copying = useRef(false);
  if (noticed) return null;

  const { reply, steps, asked } = turn;
  const next = followUps?.({ reply: reply.text, steps, asked }) ?? [];
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
            {retry.left === undefined ? "Try again" : `Try again (${retryCost(retry.left)})`}
          </Button>
        )}
      </div>
      {next.length > 0 && (
        <SuggestionChips
          starters={next}
          label="Ways to follow up"
          className={cn("mt-2", AMR_ROW, COMPACT_HIDDEN)}
        />
      )}
    </div>
  );
}

/** One item of the strip, whatever its kind: what the log draws for each chatView item. */
export function ChatItemView({ item }: { item: ChatItem }) {
  switch (item.kind) {
    case "you":
      return <YouItemView item={item} />;
    case "balloon":
      return <BalloonItemView item={item} />;
    case "steps":
      return <StepsItemView item={item} />;
    case "note":
      return <NoteItemView item={item} />;
    case "scene":
      return <SceneItemView item={item} />;
  }
}
