/**
 * The chat as the comic strip draws it (DNA-SPEC section 6, "Chat strip"):
 * the store's messages turned into view items, worked out without React so
 * both chats, the log and their tests read one shape.
 *
 *   you      the reader's own words, for a you caption
 *   balloon  Amr's own words, for a speech balloon: the reply as markdown,
 *            its lettered lead (section 5) and whether it holds a table or
 *            code, so the balloon runs full width
 *   steps    one run of tool calls and what they came to, for one step
 *            caption: consecutive calls with no words between them, across
 *            the rounds of a turn
 *   note     a line the client wrote in an assistant message for Amr, in
 *            the third person (a text block marked `note`: the round limit's
 *            stand-in for a wrap-up), for a narration caption, never a
 *            balloon: only the model's own words go in his balloons
 *   scene    a change of time, for a scene caption: the day, before the
 *            first message of a new day (from the messages' createdAt), and
 *            in a thread that was picked up (a resumed thread, one opened
 *            from History) the day it began, at its top, and "Picking up
 *            where you left off" after its last message
 *
 * An assistant message's text and its tool calls are drawn apart, in their
 * order: a message with only tool calls draws no balloon. A result shows on
 * its call's step (lib/agent/tool-result-text pairs them); only a result
 * whose call isn't in the chat gets a step of its own. Nothing is stored:
 * saved threads read the same.
 *
 * createChatView keeps the items it made last time and hands back the same
 * object for anything that didn't change (the store keeps a message's
 * identity until it is patched), so memoised items skip a streamed flush,
 * and only the reply still growing is parsed again.
 *
 * Pure, with no React, no store and no registry import (markdown and
 * tool-result-text are pure too), so the visitor chat may use it
 * (test/agent/bundle-boundary.test.ts).
 */

import {
  createBlockCache,
  parseBlocks,
  parseSegment,
  tokenizeInline,
  type BlockCache,
} from "./markdown";
import { pairToolResults, stepState, type ToolStepState } from "./tool-result-text";
import type { ChatMessage, ContentBlock, ToolResultBlock, ToolUseBlock } from "./types";

// ── The lead ────────────────────────────────────────────────────────────

/**
 * The most characters a lettered lead runs to, from its first character to
 * the end of its sentence (closing marks included). Shantell reads poorly
 * at chat sizes beyond a short opener.
 */
export const LEAD_MAX = 120;

/**
 * Where a reply's lead stands. `lead`: `text.slice(start, end)` is lettered.
 * `none`: the reply has no lead, and no text that streams in after can give
 * it one. `open`: the text so far can't tell yet (only while it streams).
 */
export type LeadDecision =
  | { state: "lead"; start: number; end: number }
  | { state: "none" }
  | { state: "open" };

const NONE: LeadDecision = { state: "none" };
const OPEN: LeadDecision = { state: "open" };

/** Characters that end a sentence; a run of dots alone is an ellipsis. */
const TERMINATOR = /[.!?]/;
/** Marks that may close a sentence after its terminator: brackets, quotes, emphasis. */
const CLOSER = /[)\]"'”’*_]/;
const SPACE = /[ \t]/;
const WHITESPACE = /\s/;
// Unicode property escapes need the `u` flag, which the tsconfig target
// rejects in literals, so these are built at runtime (as in retro/themes.ts).
const LETTER = new RegExp("\\p{L}", "u");
const LATIN = new RegExp("\\p{Script=Latin}", "u");
const LOWERCASE = new RegExp("\\p{Ll}", "u");
const DIGIT = new RegExp("\\p{Nd}", "u");
/** A lone letter: an initial ("J. Smith", "Plan B."), never taken as a sentence end. */
const ONE_LETTER = new RegExp("^\\p{L}$", "u");
/**
 * A dotted abbreviation: parts of one or two letters ("e.g", "i.e", "U.S",
 * "a.m", "Ph.D"). A file name, a version or a web address ("README.md",
 * "v1.2", "agile.org") has longer parts, so its last period ends a sentence.
 */
const DOTTED = new RegExp("^\\p{L}{1,2}(?:\\.\\p{L}{1,2})+$", "u");
/** Opening marks dropped from the front of the word before a period. */
const OPENERS = /^[(["'“‘*_`]+/;

/**
 * Words whose period is no sentence end. Dotted ones ("e.g.", "i.e.", "U.S.")
 * and lone letters are caught by shape; these are the rest. Lower case,
 * without the period.
 */
const ABBREVIATIONS: ReadonlySet<string> = new Set([
  "mr",
  "mrs",
  "ms",
  "mx",
  "dr",
  "prof",
  "sr",
  "jr",
  "st",
  "vs",
  "etc",
  "cf",
  "viz",
  "approx",
  "fig",
  "inc",
  "ltd",
  "al",
  "eg",
  "ie",
]);

/** Words whose period is no sentence end when a number follows ("No. 5", "vol. 2"). */
const BEFORE_NUMBER: ReadonlySet<string> = new Set(["no", "nos", "vol", "ch", "pp"]);

/**
 * Inline markdown left open in a lead: a code tick, an emphasis star, a link's
 * bracket, or an underscore that could open italics (as tokenizeInline reads
 * it). A sentence end inside a span is no lead end, so the lead's own inline
 * spans always close inside it.
 */
const OPEN_MARK = /[`*[]|(?<![A-Za-z0-9])_/;

/** The lead's inline spans all close inside it, so it renders apart from what follows exactly as within it. */
function balanced(lead: string): boolean {
  return tokenizeInline(lead).every((t) => t.type !== "text" || !OPEN_MARK.test(t.value));
}

/** The word before the period at `at`, from the last space (not before `from`), without opening marks. */
function wordBefore(text: string, from: number, at: number): string {
  let j = at;
  while (j > from && !WHITESPACE.test(text[j - 1])) j--;
  return text.slice(j, at).replace(OPENERS, "");
}

/** A period after this word is never a sentence end, whatever follows. */
function isAbbreviation(word: string): boolean {
  return (
    word === "" ||
    ONE_LETTER.test(word) ||
    DOTTED.test(word) ||
    ABBREVIATIONS.has(word.toLowerCase())
  );
}

/**
 * A reply's lead: its first sentence, lettered (DNA-SPEC section 5). There
 * is one only when
 *   - the reply opens with a paragraph (not a list, table, code, heading,
 *     quote or rule),
 *   - in Latin script: every letter from the start to the sentence's end is
 *     Latin (an Arabic, Cyrillic or CJK opening has none),
 *   - and that sentence ends on the first line within LEAD_MAX characters.
 *
 * A sentence ends at `.`, `!` or `?` (after any closing brackets, quotes or
 * emphasis marks) followed by a line break, the end of a finished reply, or
 * spaces and anything but a lower-case letter. So a period in a number
 * ("3.5"), a web address ("x.com") or a file name isn't one, nor are "e.g.",
 * "i.e.", "Mr.", "etc.", initials, "No. 5" or an ellipsis. A sentence end
 * inside a code span, emphasis or a link isn't one either.
 *
 * Decided by character position: each answer depends only on the text up to
 * the sentence end and the character after it, so as a reply streams it is
 * `open`, then `lead` or `none` for good; text that streams in after never
 * moves the cut or takes the lead away. (One shape can: a first line that the
 * second line turns into a table header, which a prose opener with a sentence
 * end and no `|` before it never is.) `streaming` says more text may come:
 * then the end of the text so far is no sentence end yet.
 */
export function findLead(text: string, streaming = false): LeadDecision {
  let start = 0;
  while (start < text.length && WHITESPACE.test(text[start])) start++;
  if (start === text.length) return streaming ? OPEN : NONE;

  // The opening block's shape, from its first line and the one after (a
  // table needs both); a partial marker ("1.", "``") reads as a paragraph
  // until it is whole, and no sentence end is found inside one before then.
  const lineStart = text.lastIndexOf("\n", start) + 1;
  const lineEnd = text.indexOf("\n", start);
  const nextEnd = lineEnd === -1 ? -1 : text.indexOf("\n", lineEnd + 1);
  const head = text.slice(lineStart, nextEnd === -1 ? undefined : nextEnd);
  if (parseSegment(head)[0]?.type !== "p") return NONE;

  let letters = 0;
  let i = start;
  while (i < text.length) {
    if (i - start >= LEAD_MAX) return NONE;
    const ch = String.fromCodePoint(text.codePointAt(i) as number);
    // The first line ended with no sentence end; a pipe reads as a table row.
    if (ch === "\n" || ch === "\r" || ch === "|") return NONE;
    if (LETTER.test(ch)) {
      if (!LATIN.test(ch)) return NONE;
      letters++;
    }
    if (!TERMINATOR.test(ch)) {
      i += ch.length;
      continue;
    }

    let j = i;
    while (j < text.length && TERMINATOR.test(text[j])) j++;
    const run = text.slice(i, j);
    let k = j;
    while (k < text.length && CLOSER.test(text[k])) k++;
    if (k - start > LEAD_MAX) return NONE;
    const word = run === "." ? wordBefore(text, start, i) : null;
    const notAnEnd = /^\.{2,}$/.test(run) || (word !== null && isAbbreviation(word));

    if (!notAnEnd) {
      // What follows the closing marks decides it.
      let m = k;
      while (m < text.length && SPACE.test(text[m])) m++;
      if (m === text.length) {
        if (streaming) return OPEN;
      } else if (m === k && text[k] !== "\n" && text[k] !== "\r") {
        // Something other than a space or a line break: "3.5", "x.com", "Hi!there".
        i = k;
        continue;
      }
      const next = m < text.length ? text[m] : "";
      const carriesOn =
        LOWERCASE.test(next) ||
        (word !== null && DIGIT.test(next) && BEFORE_NUMBER.has(word.toLowerCase()));
      const lead = text.slice(start, k);
      if (!carriesOn && letters > 0 && balanced(lead)) return { state: "lead", start, end: k };
    }
    i = k;
  }
  return streaming ? OPEN : NONE;
}

/** A finished (or, with `streaming`, a growing) reply's lead as markdown source, or null. */
export function leadOf(text: string, streaming = false): string | null {
  const decision = findLead(text, streaming);
  return decision.state === "lead" ? text.slice(decision.start, decision.end) : null;
}

// ── View items ──────────────────────────────────────────────────────────

/** The reader's own words. */
export interface YouItem {
  kind: "you";
  key: string;
  messageId: string;
  /** Shown verbatim, never as markdown. */
  text: string;
}

/** Amr's own words: one run of text blocks in an assistant message. */
export interface BalloonItem {
  kind: "balloon";
  key: string;
  messageId: string;
  /** The reply as markdown. */
  text: string;
  /**
   * The lettered lead as markdown source (findLead), or null when the reply
   * has none or, while it streams, can't tell yet: its first sentence hasn't
   * ended. Once set it never changes as more text streams in. The first
   * paragraph's text, after its leading spaces, starts with it, and its
   * inline spans close inside it. Letter it inside that paragraph rather than
   * by splitting `text`: on their own, the words after it could read as a
   * list or a heading.
   */
  lead: string | null;
  /**
   * Its opening sentence is still undecided while it streams (findLead is
   * `open`: at most LEAD_MAX characters, until the one after its end
   * arrives), so none of its words are drawn yet: they would show in Inter,
   * then turn lettered (DNA-SPEC section 5: words already streamed never
   * change face). The balloon still scribbles; the words first appear in
   * their final face.
   */
  held: boolean;
  /** The reply holds a table or a code block, so its balloon runs full width. */
  wide: boolean;
  /**
   * Its words may still grow: the trailing text of the reply streaming now.
   * Text with a tool call after it is finished (a reply streams its words
   * before its calls), so its lead is settled while the calls run.
   */
  streaming: boolean;
}

/** One tool call and what it came to. */
export interface ChatStep {
  key: string;
  /** The message the call is in, or for a result with no call, the result's own. */
  messageId: string;
  /** Null for a result whose call isn't in the chat (an old or odd thread). */
  call: ToolUseBlock | null;
  /** The result that answers it, once one has come. */
  result: ToolResultBlock | undefined;
  /** Where it stands (tool-result-text stepState), or null when nothing is known. */
  state: ToolStepState | null;
  /**
   * The turn it is part of: the id of the reader's message the turn answers
   * (null before any), so the strip inks at most one tick a turn.
   */
  turn: string | null;
}

/** A run of tool calls with no words between them: one step caption. */
export interface StepsItem {
  kind: "steps";
  /** Its first step's key, so a run keeps its key as calls join it. */
  key: string;
  steps: readonly ChatStep[];
}

/**
 * Narration the client wrote into an assistant message (a text block marked
 * `note`), about Amr rather than by him: drawn as a narration caption, read
 * out without "Amr said:".
 */
export interface NoteItem {
  kind: "note";
  key: string;
  messageId: string;
  /** Inline markdown: an action's id is a code span. */
  text: string;
}

/**
 * A change of time in the strip: a new day, or where a thread was picked up.
 * Drawn as a scene caption, between the messages it falls between.
 */
export interface SceneItem {
  kind: "scene";
  key: string;
  /**
   * The day's first message's createdAt, or null for the place a thread was
   * picked up ("Picking up where you left off").
   */
  at: string | null;
  /**
   * The day in words (dayLabel, as of the build that made it), or null for
   * the pick-up place. Worked out here, not as it draws, so the first build
   * on a new day makes a new item and "Today" becomes "Yesterday".
   */
  label: string | null;
}

export type ChatItem = YouItem | BalloonItem | StepsItem | NoteItem | SceneItem;

export interface ChatViewOptions {
  /** The assistant message a reply is streaming into (store.streamingMessageId). */
  streamingId?: string | null;
  /** A turn is under way (store.streaming): the latest reply's calls may still be running. */
  busy?: boolean;
  /** The call whose confirm card is showing (store.pendingToolUse.toolUseId). */
  pendingId?: string | null;
  /**
   * The last message of a thread that was picked up (store.resumedAfter):
   * the strip opens with the day the thread began and marks the place after
   * this message. Ignored when the message isn't in the chat.
   */
  resumedAfter?: string | null;
}

const DAY_MS = 86_400_000;

/** Midnight of a date's own day, in the reader's time zone. */
const dayStart = (d: Date) => new Date(d.getFullYear(), d.getMonth(), d.getDate()).getTime();

/**
 * A scene caption's day, for the reader: "Today", "Yesterday", or the date
 * with its weekday in the reader's own format ("Sunday, November 8"), with
 * the year when it isn't this one. `at` is a message's createdAt.
 */
export function dayLabel(at: string, now: Date = new Date()): string {
  const d = new Date(at);
  // Rounded: a day the clocks change in is 23 or 25 hours long.
  const ago = Math.round((dayStart(now) - dayStart(d)) / DAY_MS);
  if (ago === 0) return "Today";
  if (ago === 1) return "Yesterday";
  return d.toLocaleDateString(undefined, {
    weekday: "long",
    month: "long",
    day: "numeric",
    year: d.getFullYear() === now.getFullYear() ? undefined : "numeric",
  });
}

/** What a view made last time, by key, and each balloon's parse cache. */
interface Made {
  items: Map<string, ChatItem>;
  steps: Map<string, ChatStep>;
  caches: Map<string, BlockCache>;
}

const made = (): Made => ({ items: new Map(), steps: new Map(), caches: new Map() });

/** A message's text blocks, joined as paragraphs. */
const textOf = (blocks: readonly ContentBlock[]) =>
  blocks
    .filter((b): b is Extract<ContentBlock, { type: "text" }> => b.type === "text")
    .map((b) => b.text)
    .join("\n\n");

const hasWords = (text: string) => text.trim() !== "";

/** Turn messages into items, reusing what `prev` made for anything unchanged and filling `next`. */
function build(
  messages: readonly ChatMessage[],
  opts: ChatViewOptions,
  prev: Made,
  next: Made
): ChatItem[] {
  const pairs = pairToolResults(messages);
  /** The reader's day now, for the scene captions' Today and Yesterday. */
  const now = new Date();
  const out: ChatItem[] = [];
  let run: ChatStep[] | null = null;
  /** The reader's latest message so far: the turn the steps after it are part of. */
  let turn: string | null = null;

  const keep = (item: ChatItem) => {
    next.items.set(item.key, item);
    out.push(item);
  };

  const endRun = () => {
    if (!run) return;
    const steps = run;
    run = null;
    const key = steps[0].key;
    const old = prev.items.get(key);
    if (
      old?.kind === "steps" &&
      old.steps.length === steps.length &&
      old.steps.every((s, n) => s === steps[n])
    ) {
      keep(old);
    } else {
      keep({ kind: "steps", key, steps });
    }
  };

  const addStep = (
    key: string,
    messageId: string,
    call: ToolUseBlock | null,
    result: ToolResultBlock | undefined,
    state: ToolStepState | null
  ) => {
    const old = prev.steps.get(key);
    const step =
      old && old.call === call && old.result === result && old.state === state && old.turn === turn
        ? old
        : { key, messageId, call, result, state, turn };
    next.steps.set(key, step);
    (run ??= []).push(step);
  };

  const addBalloon = (key: string, messageId: string, text: string, streaming: boolean) => {
    // Words only: an empty or blank text block between calls keeps their run together.
    if (!hasWords(text)) return;
    endRun();
    const cache = prev.caches.get(key) ?? createBlockCache();
    next.caches.set(key, cache);
    const old = prev.items.get(key);
    if (old?.kind === "balloon" && old.text === text && old.streaming === streaming) {
      keep(old);
      return;
    }
    const blocks = parseBlocks(text, cache);
    const lead = findLead(text, streaming);
    keep({
      kind: "balloon",
      key,
      messageId,
      text,
      lead: lead.state === "lead" ? text.slice(lead.start, lead.end) : null,
      held: lead.state === "open",
      wide: blocks.some((b) => b.type === "table" || b.type === "code"),
      streaming,
    });
  };

  const addScene = (key: string, at: string | null) => {
    endRun();
    const label = at === null ? null : dayLabel(at, now);
    const old = prev.items.get(key);
    keep(
      old?.kind === "scene" && old.at === at && old.label === label
        ? old
        : { kind: "scene", key, at, label }
    );
  };

  // Picked up, while the thread's last message then is still in the chat.
  const resumedAfter = opts.resumedAfter ?? null;
  const resumed = resumedAfter !== null && messages.some((m) => m.id === resumedAfter);
  /** The day of the latest message with a date so far (the reader's time zone). */
  let day: string | null = null;
  /** The message before this one. */
  let before: string | null = null;

  for (const message of messages) {
    if (resumed && before === resumedAfter) addScene(`resume:${before}`, null);
    before = message.id;
    const date = new Date(message.createdAt);
    const dayOf = Number.isNaN(date.getTime()) ? null : date.toDateString();
    if (dayOf !== null) {
      // A new day; a picked-up thread also opens with the day it began.
      if (day === null ? resumed : dayOf !== day) addScene(`day:${message.id}`, message.createdAt);
      day = dayOf;
    }

    if (message.role === "user") {
      turn = message.id;
      const text = textOf(message.content);
      if (!hasWords(text)) continue;
      endRun();
      const old = prev.items.get(message.id);
      keep(
        old?.kind === "you" && old.text === text
          ? old
          : { kind: "you", key: message.id, messageId: message.id, text }
      );
      continue;
    }

    if (message.role === "tool") {
      // A result shows on its call's step; only one whose call isn't in the chat shows here.
      message.content.forEach((block, index) => {
        if (block.type !== "tool_result" || pairs.answersACall(message.id, index)) return;
        const state = stepState({ id: block.tool_use_id, input: {} }, block, {});
        addStep(`${message.id}:r${index}`, message.id, null, block, state);
      });
      continue;
    }

    const streaming = opts.streamingId != null && opts.streamingId === message.id;
    const live = !!opts.busy && pairs.latestAssistantId === message.id;
    let texts: string[] = [];
    let textAt = -1;
    // A run of text blocks becomes one balloon, keyed by its first block.
    const endText = (growing: boolean) => {
      if (textAt >= 0) {
        addBalloon(`${message.id}:t${textAt}`, message.id, texts.join("\n\n"), growing);
      }
      texts = [];
      textAt = -1;
    };
    message.content.forEach((block, index) => {
      if (block.type === "text" && block.note) {
        // Narration, not his words: the words before it are finished.
        endText(false);
        if (!hasWords(block.text)) return;
        endRun();
        const key = `${message.id}:n${index}`;
        const old = prev.items.get(key);
        keep(
          old?.kind === "note" && old.text === block.text
            ? old
            : { kind: "note", key, messageId: message.id, text: block.text }
        );
      } else if (block.type === "text") {
        if (textAt < 0) textAt = index;
        texts.push(block.text);
      } else if (block.type === "tool_use") {
        endText(false);
        const result = pairs.resultOf(message.id, block.id);
        const state = stepState(block, result, { pendingId: opts.pendingId, live });
        addStep(`${message.id}:s${index}`, message.id, block, result, state);
      }
    });
    endText(streaming);
  }
  if (resumed && before === resumedAfter) addScene(`resume:${before}`, null);
  endRun();
  return out;
}

/** The chat's view items, made from scratch (createChatView keeps them across calls). */
export function chatView(
  messages: readonly ChatMessage[],
  opts: ChatViewOptions = {}
): readonly ChatItem[] {
  return build(messages, opts, made(), made());
}

/**
 * A view that keeps its last items: each call hands back the same object for
 * an item that didn't change, and the same array when none did. It keeps
 * only what the last call made, so it never outgrows one chat.
 */
export function createChatView(): (
  messages: readonly ChatMessage[],
  opts?: ChatViewOptions
) => readonly ChatItem[] {
  let last = made();
  let list: readonly ChatItem[] = [];
  return (messages, opts = {}) => {
    const next = made();
    const out = build(messages, opts, last, next);
    last = next;
    if (out.length !== list.length || out.some((item, n) => item !== list[n])) list = out;
    return list;
  };
}
