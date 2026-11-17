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
 * Runtime parts (the markdown renderer and its panel context), so this lives
 * in chat/, which every-page code may not reach
 * (test/agent/bundle-boundary.test.ts).
 */

import { memo } from "react";
import { Narration, YouCaption } from "../comic/comic-parts";
import { AmrBalloon, SceneCaption, ThinkingBalloon } from "../comic/strip-parts";
import { Markdown } from "../markdown";
import {
  type BalloonItem,
  type ChatItem,
  type NoteItem,
  type SceneItem,
  type StepsItem,
  type YouItem,
} from "@/lib/agent/chat-view";
import { cn } from "@/lib/utils";
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
