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
 *
 * Only turns this chat sees settle are spoken: a thread loaded or a chat
 * reopened after its turn ended says nothing, and a chat opened during a turn
 * speaks it whole when it settles. The words are the balloons (and the
 * narration lines) that are new or grew since the turn began, so an earlier
 * reply is never read again.
 *
 * Runtime parts (the agent store), so this lives in chat/, which every-page
 * code may not reach (test/agent/bundle-boundary.test.ts).
 */

import { useEffect, useRef, type RefObject } from "react";
import { useAnnounce } from "@/components/a11y/live-announcer";
import type { ChatItem } from "@/lib/agent/chat-view";
import { parseBlocks, tokenizeInline, type Block, type ListBlock } from "@/lib/agent/markdown";
import { useAgentStore, type AgentNotice } from "@/lib/agent/store";

/** About the most characters of a reply read out; the rest waits in the conversation. */
export const ANNOUNCE_MAX = 300;
/** The fewest characters a cut at a sentence end keeps; shorter, the cut falls between words. */
const SENTENCE_CUT_MIN = 80;

/** Before a reply's words, as the log's hidden speaker prefix names him. */
export const SPEAKER = "Amr said:";
/** Before a waiting card's question. */
export const NEEDS_OK = "Amr needs your OK:";
/** After a reply cut short for reading out. */
export const REST_IN_LOG = "The rest is in the conversation.";
/** In place of a table, which reads poorly out loud. */
export const TABLE_WORDS = "A table is in the conversation.";
/** In place of a code block. */
export const CODE_WORDS = "Code is in the conversation.";

/** Ends a sentence: Latin, Arabic and CJK marks, and an ellipsis. */
const ENDS = /[.!?…؟。]["'”’)\]]*$/;
/** Ends a spoken piece with a pause already: a sentence end, a colon or a semicolon. */
const PAUSES = /[.!?…؟。:;]["'”’)\]]*$/;
/** A sentence end followed by a space, for the cut. */
const SENTENCE_END = /[.!?…؟。]["'”’)\]]*(?=\s)/g;

/** A line of inline markdown as its words: no stars, ticks or link brackets. */
function plainInline(text: string): string {
  return tokenizeInline(text)
    .map((token) => token.value)
    .join("");
}

/** One spoken piece: spaces collapsed, ending as a sentence so the reader pauses. */
function asSentence(text: string): string {
  const words = text.replace(/\s+/g, " ").trim();
  if (!words) return "";
  return PAUSES.test(words) ? words : `${words}.`;
}

function listWords(list: ListBlock): string[] {
  const out: string[] = [];
  for (const item of list.items) {
    out.push(plainInline(item.text));
    for (const child of item.children ?? []) out.push(...listWords(child));
  }
  return out;
}

function blockWords(block: Block): string[] {
  switch (block.type) {
    case "p":
    case "h":
      return [plainInline(block.text)];
    case "quote":
      return block.paragraphs.map(plainInline);
    case "ul":
    case "ol":
      return listWords(block);
    case "table":
      return [TABLE_WORDS];
    case "code":
      return [CODE_WORDS];
    case "hr":
      return [];
  }
}

/**
 * A reply's markdown as words to read out: the text of its paragraphs,
 * headings, quotes and list items, each ending as a sentence, with a table or
 * a code block named instead of read.
 */
export function spokenText(markdown: string): string {
  return parseBlocks(markdown).flatMap(blockWords).map(asSentence).filter(Boolean).join(" ");
}

/**
 * Words cut for reading out: whole up to `max` characters; longer, at the
 * last sentence end within `max` (when that keeps enough), or else between
 * words with an ellipsis, then a pointer to the conversation.
 */
export function clipSpoken(text: string, max = ANNOUNCE_MAX): string {
  if (text.length <= max) return text;
  // Never end inside a character that takes two code units.
  let room = max;
  const code = text.charCodeAt(room - 1);
  if (code >= 0xd800 && code <= 0xdbff) room--;
  const head = text.slice(0, room);
  let cut = -1;
  SENTENCE_END.lastIndex = 0;
  for (let m = SENTENCE_END.exec(head); m; m = SENTENCE_END.exec(head)) {
    cut = m.index + m[0].length;
  }
  // A sentence end at the very edge has its space just past it.
  if (ENDS.test(head) && /\s/.test(text[room] ?? "")) cut = room;
  if (cut >= SENTENCE_CUT_MIN) return `${head.slice(0, cut)} ${REST_IN_LOG}`;
  const space = head.lastIndexOf(" ");
  const words = (space > 0 ? head.slice(0, space) : head).replace(/[\s,;:]+$/, "");
  return `${words}… ${REST_IN_LOG}`;
}

/**
 * What a settled turn says: its words after the speaker, cut for reading out,
 * then its narration lines (markdown, as the strip's note items hold them)
 * with no speaker, then its note. Null when there is nothing to say.
 */
export function turnAnnouncement(
  replies: readonly string[],
  note?: string | null,
  narration: readonly string[] = []
): string | null {
  const words = replies.map(spokenText).filter(Boolean).join(" ");
  const told = narration.map(spokenText).filter(Boolean).join(" ");
  const parts: string[] = [];
  if (words) parts.push(`${SPEAKER} ${clipSpoken(words)}`);
  if (told) parts.push(clipSpoken(told));
  if (note?.trim()) parts.push(note.trim());
  return parts.length > 0 ? parts.join(" ") : null;
}

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
    const message = turnAnnouncement(replies, note, narration);
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
