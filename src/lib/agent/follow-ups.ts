/**
 * Up to two follow-ups under Amr's latest reply (design 1.2, "Under the
 * latest reply"; decision 4): next questions written as the reader's own
 * words, which fill the message box and never send (chat/suggestion-chips).
 * Worked out from the reply and the tools its turn ran, with no extra model
 * call, so a visitor's allowance pays for none.
 *
 * In the reader's voice, never Amr's, and with no I, me or my even so: a
 * first-person line in the chat would read as his (DNA-SPEC section 6,
 * "Chat strip"). Nor any dash.
 *
 *   - A reply in another script (Arabic, say) gets none: the chips are in
 *     English, and the reader writes in their own language.
 *   - A reply that ends by offering to do something ("Want these added as
 *     cards?") gets the two answers: "Yes, go ahead" and "No, thanks".
 *   - A reply that ends on any other question, a choice ("one week or
 *     two?") among them, gets none: the answer is the reader's own. A
 *     closing "Anything else?" doesn't count as one.
 *   - Otherwise, the first two of these that fit:
 *       a change Amr made in a tool   "What else can you do in Retro Board?"
 *       a list of two or more items   "Which of these matters most?"
 *       a long reply                  "Sum that up in one line"
 *       an answer with no tool run    "Can you give an example?" (unless it
 *       and no example in it          gives one)
 *
 * None repeats the reply (one it already says) or the question it answers,
 * and none is a link the reply has (design 3, "Deliberately not done").
 *
 * Pure, with no registry import (tool-label isn't one), so the visitor chat
 * may use it. It rides in the strip kit (components/agent/chat/strip-kit)
 * with tool-label, and the reply's end takes it from there, so a visitor
 * downloads the tools' names once, with the runtime
 * (test/agent/bundle-boundary.test.ts).
 */

import type { ChatStep } from "./chat-view";
import { readsOnly, toolLabel } from "./tool-label";

/** The most follow-ups under a reply. */
export const MAX_FOLLOW_UPS = 2;

/** The follow-ups' words, apart from the one that names a tool (moreIn). */
export const FOLLOW_UP_TEXT = {
  yes: "Yes, go ahead",
  no: "No, thanks",
  ranks: "Which of these matters most?",
  shorter: "Sum that up in one line",
  example: "Can you give an example?",
} as const;

/** The follow-up after a change Amr made in `tool`. */
export const moreIn = (tool: string) => `What else can you do in ${tool}?`;

/** The latest turn, as the strip has it. */
export interface FollowUpTurn {
  /** Amr's reply, as markdown: the turn's last balloon ("" when it had no words). */
  reply: string;
  /** The turn's tool calls, oldest first, with where each ended (chat-view ChatStep). */
  steps?: readonly Pick<ChatStep, "call" | "state">[];
  /** The reader's message the turn answers, so no follow-up asks it again. */
  asked?: string | null;
}

/** The labels that name no one tool: a follow-up about "Workspace" says nothing. */
const NO_TOOL: ReadonlySet<string> = new Set(["Workspace", "Tool"]);

/** A reply this long, in characters, may be summed up. */
const LONG_REPLY = 600;

// Unicode property escapes need the `u` flag, which the tsconfig target
// rejects in literals, so these are built at runtime (as in chat-view).
const LETTERS = new RegExp("\\p{L}", "gu");
const LATIN = new RegExp("\\p{Script=Latin}", "gu");
const NOT_WORD = new RegExp("[^\\p{L}\\p{N}]+", "gu");

/** A last question that offers to do something: its answer is yes or no. */
const OFFER =
  /^(?:(?:so|ok|okay|great|also|then),?\s+)?(?:want|shall|should|can (?:i|we)|could (?:i|we)|may i|would you like|do you want|would it help|ok to|okay to|ready (?:to|for))\b/i;
/** A closing invitation, which waits on nothing in particular. */
const INVITATION = /\banything else\b|\bany (?:other |more )?questions\b|\bwhat else\b/i;
/** A list item's line, anywhere in the reply. */
const LIST_ITEM = /^[ \t]*(?:[-*+]|\d{1,3}[.)])[ \t]+\S/gm;
/** A line that is no sentence of Amr's to the reader: a list item, a quote, a heading, a table row, a fence. */
const NOT_PROSE = /^(?:[-*+]\s|\d{1,3}[.)]\s|[>|]|#{1,6}\s|```|~~~)/;
/** An example the reply already gives. */
const EXAMPLE = /\bexamples?\b|\bfor instance\b|\be\.g\./i;

/** Lower case, with only letters, digits and single spaces. */
const plain = (text: string) => text.toLowerCase().replace(NOT_WORD, " ").trim();

/**
 * The reply's closing sentence, without emphasis marks or closing quotes:
 * the last sentence of its last line, when that line is prose. A list of
 * questions at the end of a reply ("2. What didn't go well?") asks the
 * reader nothing.
 */
function closingSentence(reply: string): string {
  const lines = reply.split("\n").filter((line) => line.trim() !== "");
  const line = (lines[lines.length - 1] ?? "").trim();
  if (NOT_PROSE.test(line)) return "";
  const words = line
    .replace(/[*_`]/g, "")
    .replace(/["'”’)\]]+$/, "")
    .trim();
  return words.split(/(?<=[.!?])\s+/).pop() ?? "";
}

/** Mostly letters of another script than Latin. */
function otherScript(text: string): boolean {
  const letters = text.match(LETTERS)?.length ?? 0;
  const latin = text.match(LATIN)?.length ?? 0;
  return letters > 0 && latin * 2 < letters;
}

/** The tool of the latest change that worked, when it is one tool. */
function changedIn(steps: NonNullable<FollowUpTurn["steps"]>): string | null {
  for (let i = steps.length - 1; i >= 0; i--) {
    const { call, state } = steps[i];
    if (!call || state !== "done") continue;
    const label = toolLabel(call.name);
    if (!readsOnly(label)) return NO_TOOL.has(label.tool) ? null : label.tool;
  }
  return null;
}

/** Up to MAX_FOLLOW_UPS follow-ups for the latest turn (see the top). */
export function followUps({ reply, steps = [], asked = null }: FollowUpTurn): string[] {
  if (otherScript(`${asked ?? ""} ${reply}`)) return [];
  const said = plain(reply);
  const again = plain(asked ?? "");
  const fresh = (text: string) => {
    const words = plain(text);
    return words !== again && !said.includes(words);
  };

  const last = closingSentence(reply);
  if (last.endsWith("?")) {
    if (OFFER.test(last) && !/\bor\b/i.test(last)) {
      return [FOLLOW_UP_TEXT.yes, FOLLOW_UP_TEXT.no].filter(fresh);
    }
    if (!INVITATION.test(last)) return [];
  }

  const tool = changedIn(steps);
  const picks: string[] = [];
  if (tool) picks.push(moreIn(tool));
  if ((reply.match(LIST_ITEM)?.length ?? 0) >= 2) picks.push(FOLLOW_UP_TEXT.ranks);
  if (reply.length >= LONG_REPLY) picks.push(FOLLOW_UP_TEXT.shorter);
  if (steps.length === 0 && reply.trim() !== "" && !EXAMPLE.test(reply)) {
    picks.push(FOLLOW_UP_TEXT.example);
  }
  return picks.filter(fresh).slice(0, MAX_FOLLOW_UPS);
}
