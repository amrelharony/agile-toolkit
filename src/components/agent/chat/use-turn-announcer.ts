"use client";

/**
 * What the chat says out loud, shared by both chats (the owner's and a
 * visitor's): one announcement per settled turn, through the app's one pair
 * of live regions (useAnnounce), since nothing in the log is live (chat-log:
 * aria-live="off").
 *
 *   a turn settles   once, politely: "Amr said: " and the turn's own words as
 *                    plain text (no markdown marks; a table or code is named,
 *                    not read), cut at a sentence near ANNOUNCE_MAX characters
 *                    with a pointer to the conversation; then any narration
 *                    line the turn left in the strip (the round limit's
 *                    stand-in), without "Amr said:", since it is about him,
 *                    not his words; then the turn's note when it ended with
 *                    one ("The answer stopped short...").
 *                    Nothing while the words stream in: streamed chunks,
 *                    steps and re-renders change no live region. A turn with
 *                    no new words and no note says nothing (Stop, a New chat
 *                    or another thread opened under it).
 *   a card waits     "Amr needs your OK: {question}", once per card, unless
 *                    the card took focus as it came: then focus reads it out,
 *                    and an announcement would talk over it. The card takes
 *                    focus in its own effect, which runs before this one (it
 *                    is drawn inside the frame).
 *   an error         the error notice's own words, once and assertively, as
 *                    soon as it comes. A turn that ends in an error says
 *                    nothing more: the error speaks for it.
 *   a note, idle     a note that comes with no turn under way, politely.
 *   a quiet notice   nothing: what took its place says it (the visitor's
 *                    read-only footer, for a "no more AI for now" refusal).
 *
 * Only turns this chat sees settle are spoken: a thread loaded or a chat
 * reopened after its turn ended says nothing, and a chat opened during a turn
 * speaks it whole when it settles. The words are the balloons (and the
 * narration lines) that are new or grew since the turn began, so an earlier
 * reply is never read again.
 *
 * How a turn's words are said (plain text, the cut, the speaker) is
 * chat/spoken-text, which parses markdown, so it rides in the strip kit
 * (chat/strip-kit) and this reads it from the kit's holder as a turn settles
 * rather than importing it: a visitor's first paint carries no parser. A turn
 * has words only once there are items, and items only once the kit is in;
 * before that (a visitor's first turn dying as the runtime loads) the error
 * or the note is all there is to say, and saying it needs no parsing.
 *
 * Runtime parts (the agent store), so this lives in chat/, which every-page
 * code may not reach (test/agent/bundle-boundary.test.ts).
 */

import { useEffect, useRef, type RefObject } from "react";
import { useAnnounce } from "@/components/a11y/live-announcer";
import type { ChatItem } from "@/lib/agent/chat-view";
import { useAgentStore, type AgentNotice } from "@/lib/agent/store";
import { currentStripKit } from "./strip-kit-ref";

/** Before a waiting card's question. */
export const NEEDS_OK = "Amr needs your OK:";

/** Whether focus is inside the waiting card drawn in `root`. */
export function cardHasFocus(root: HTMLElement | null): boolean {
  if (!root) return false;
  const active = root.ownerDocument.activeElement;
  const card = active?.closest("[data-confirm-card]");
  return !!card && root.contains(card);
}

/** The log when a turn began: each balloon's and narration line's words by key, and the chat's first item. */
interface TurnStart {
  words: Map<string, string>;
  first: string | null;
}

function startOf(items: readonly ChatItem[]): TurnStart {
  const words = new Map<string, string>();
  for (const item of items) {
    if (item.kind === "balloon" || item.kind === "note") words.set(item.key, item.text);
  }
  return { words, first: items[0]?.key ?? null };
}

export interface TurnAnnouncerOptions {
  /** The strip's items, from lib/agent/chat-view. */
  items: readonly ChatItem[];
  /** A turn is under way, or starting. It settles when this goes false. */
  busy: boolean;
  /** The chat's root, around the log and its waiting card. */
  rootRef: RefObject<HTMLElement | null>;
}

/** Speak once per settled turn, per waiting card and per error (see the file comment). */
export function useTurnAnnouncer({ items, busy, rootRef }: TurnAnnouncerOptions): void {
  const announce = useAnnounce();
  const pending = useAgentStore((s) => s.pendingToolUse);
  const notice = useAgentStore((s) => s.notice);

  // The latest render's values, for the effects below that run on a change
  // of something else (never on a streamed chunk). Declared first, so they
  // are current when those run.
  const latest = useRef({ items, busy, notice });
  useEffect(() => {
    latest.current = { items, busy, notice };
  });

  /** The turn under way, from where the log stood when it began. */
  const turn = useRef<TurnStart | null>(null);
  /** The notice already spoken, or already showing when the chat opened. */
  const heard = useRef<AgentNotice | null>(notice);
  /** The waiting card already dealt with. */
  const card = useRef<string | null>(null);

  // A turn begins (or is under way as the chat opens), and settles.
  useEffect(() => {
    if (busy) {
      turn.current ??= startOf(latest.current.items);
      return;
    }
    const start = turn.current;
    if (!start) return;
    turn.current = null;
    const { items: now, notice: end } = latest.current;
    // An error ends the turn and speaks for it.
    if (end?.tone === "error") return;
    // The chat was swapped under the turn (another thread, a New chat).
    if (start.first !== null && now[0]?.key !== start.first) return;
    const replies: string[] = [];
    const narration: string[] = [];
    for (const item of now) {
      if (item.kind !== "balloon" && item.kind !== "note") continue;
      if (start.words.get(item.key) === item.text) continue;
      (item.kind === "balloon" ? replies : narration).push(item.text);
    }
    const note = end && end !== heard.current ? end.text : null;
    if (end) heard.current = end;
    // The words come from the strip kit (chat/spoken-text), read as the turn
    // settles, with no subscription. With no kit yet there were no items, so
    // no words: just the note.
    const say = currentStripKit()?.turnAnnouncement;
    const message = say ? say(replies, note, narration) : note?.trim() || null;
    if (message) announce(message);
  }, [busy, announce]);

  // A card waits: said once, unless it took focus as it came. It is known by
  // its call's id, so the same card drawn again is not said again.
  const cardId = pending?.toolUseId ?? null;
  const question = pending?.prompt.question ?? "";
  useEffect(() => {
    if (cardId === null) {
      card.current = null;
      return;
    }
    if (card.current === cardId) return;
    card.current = cardId;
    if (cardHasFocus(rootRef.current)) return;
    announce(`${NEEDS_OK} ${question}`);
  }, [cardId, question, announce, rootRef]);

  // An error at once and assertively; a note when no turn will carry it.
  useEffect(() => {
    if (!notice || notice === heard.current) return;
    if (notice.quiet) {
      heard.current = notice;
      return;
    }
    if (notice.tone === "error") {
      heard.current = notice;
      announce(notice.text, "assertive");
      return;
    }
    if (latest.current.busy) return;
    heard.current = notice;
    announce(notice.text);
  }, [notice, announce]);
}
