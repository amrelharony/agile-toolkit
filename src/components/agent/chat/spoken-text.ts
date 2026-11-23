/**
 * A settled turn's words as the chat says them out loud
 * (chat/use-turn-announcer): "Amr said: " and the turn's own words as plain
 * text (no markdown marks; a table or code is named, not read), cut at a
 * sentence near ANNOUNCE_MAX characters with a pointer to the conversation;
 * then any narration line the turn left in the strip, without "Amr said:";
 * then the turn's note.
 *
 * Pure, with no React: it parses the reply's markdown (lib/agent/markdown),
 * so it rides in the strip kit (chat/strip-kit) with the rest of what reads
 * messages, and the announcer takes turnAnnouncement from the kit's holder
 * rather than importing it. A visitor's first paint carries none of it: a
 * turn has words to say only once the runtime, and the kit with it, is in.
 */

import { parseBlocks, tokenizeInline, type Block, type ListBlock } from "@/lib/agent/markdown";

/** About the most characters of a reply read out; the rest waits in the conversation. */
export const ANNOUNCE_MAX = 300;
/** The fewest characters a cut at a sentence end keeps; shorter, the cut falls between words. */
const SENTENCE_CUT_MIN = 80;

/** Before a reply's words, as the log's hidden speaker prefix names him. */
export const SPEAKER = "Amr said:";
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
