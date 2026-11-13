/**
 * A visitor room's code as people read it and type it.
 *
 * The code itself never changes: 12 characters from `VISITOR_CODE_ALPHABET`
 * (`visitor-rooms.ts`), which is what the channel, the link and the QR code
 * hold. People see it in three groups of four (ABCD-EFGH-JKMN), read it
 * aloud, and type it into `/join` however it comes out: any case, with or
 * without spaces or dashes, full-width characters from a phone keyboard, or
 * the whole join link pasted in.
 *
 * Look-alikes: the alphabet already leaves out 0, O, 1, I and L, both halves
 * of each pair, so there is no character a typed O or 1 could safely stand
 * for. Instead of guessing, `readJoinInput` says which characters a code
 * never holds, so the person looks at the screen again.
 *
 * Pure and server-safe: no React, no browser globals.
 */

import {
  VISITOR_CODE_ALPHABET,
  VISITOR_CODE_LENGTH,
  isVisitorRoomCode,
  isVisitorTool,
  type VisitorTool,
} from "./visitor-rooms";

/** Characters per group in the displayed code. */
export const CODE_GROUP_SIZE = 4;

/** "ABCD-EFGH-JKMN": a well-formed code in groups of four. Anything else comes back as it was. */
export function groupRoomCode(code: string): string {
  if (!isVisitorRoomCode(code)) return code;
  const groups: string[] = [];
  for (let i = 0; i < code.length; i += CODE_GROUP_SIZE) {
    groups.push(code.slice(i, i + CODE_GROUP_SIZE));
  }
  return groups.join("-");
}

/**
 * Characters people type for one they see, which a code never holds. Both
 * halves of each look-alike pair are missing from the alphabet (no 0 or O,
 * no 1, I or L), so none can be mapped to the other.
 */
export const NEVER_IN_CODE = ["0", "O", "1", "I", "L"] as const;

/** Longest input looked at: a pasted join link with its key fits easily. */
export const JOIN_INPUT_MAX_CHARS = 512;

/** Spaces, dashes of every width, underscores, dots, bullets and slashes between groups. */
const SEPARATORS_RE = /[\s­‐-―−ー_.·•・/\\-]+/g;

/** A pasted link or path: `/join/<tool>/<code>`, maybe `?…`, maybe the `#k=` host key. */
const JOIN_PATH_RE =
  /\/join\/([A-Za-z0-9-]{1,40})\/([^/?#\s]{1,40})\/?(?:\?[^#\s]*)?(#k=[A-Za-z0-9_-]{22})?/;

export type JoinInputProblem =
  /** Nothing typed. */
  | "empty"
  /** Fewer than 12 code characters. */
  | "too-short"
  /** More than 12 code characters. */
  | "too-long"
  /** A character a code never holds that looks like one it does (0 O 1 I L). */
  | "look-alike"
  /** Another character a code never holds. */
  | "not-a-code"
  /** A pasted link for a tool that has no live room. */
  | "unknown-tool";

export type JoinInput =
  | {
      ok: true;
      /** The code, upper case, without separators. */
      code: string;
      /** The tool, when a link or path was pasted; null for a bare code. */
      tool: VisitorTool | null;
      /** `#k=<fingerprint>` from a pasted link, kept exactly; null otherwise. */
      keyFragment: string | null;
    }
  | {
      ok: false;
      problem: JoinInputProblem;
      /** How many code characters there were (too short or too long). */
      length?: number;
      /** The offending characters, upper case, each once, in typed order. */
      chars?: string[];
    };

/** The code characters in `raw`: full-width folded, upper case, separators gone. */
export function codeCharacters(raw: string): string {
  return raw.normalize("NFKC").toUpperCase().replace(SEPARATORS_RE, "");
}

function readBareCode(raw: string): JoinInput {
  const chars = codeCharacters(raw);
  if (chars.length === 0) return { ok: false, problem: "empty" };
  const lookAlikes: string[] = [];
  const strangers: string[] = [];
  for (const ch of Array.from(chars)) {
    if (VISITOR_CODE_ALPHABET.includes(ch)) continue;
    const list = (NEVER_IN_CODE as readonly string[]).includes(ch) ? lookAlikes : strangers;
    if (!list.includes(ch)) list.push(ch);
  }
  if (strangers.length > 0) return { ok: false, problem: "not-a-code", chars: strangers };
  if (lookAlikes.length > 0) return { ok: false, problem: "look-alike", chars: lookAlikes };
  if (chars.length < VISITOR_CODE_LENGTH) {
    return { ok: false, problem: "too-short", length: chars.length };
  }
  if (chars.length > VISITOR_CODE_LENGTH) {
    return { ok: false, problem: "too-long", length: chars.length };
  }
  return isVisitorRoomCode(chars)
    ? { ok: true, code: chars, tool: null, keyFragment: null }
    : { ok: false, problem: "not-a-code", chars: [] };
}

/**
 * What someone typed or pasted into `/join`'s code box: a bare code in any
 * shape, or a join link or path (whose tool and `#k=` host key are kept).
 */
export function readJoinInput(raw: string): JoinInput {
  if (typeof raw !== "string") return { ok: false, problem: "empty" };
  const text = raw.slice(0, JOIN_INPUT_MAX_CHARS).trim();
  if (text.length === 0) return { ok: false, problem: "empty" };
  const link = JOIN_PATH_RE.exec(text);
  if (link) {
    const tool = link[1].toLowerCase();
    if (!isVisitorTool(tool)) return { ok: false, problem: "unknown-tool" };
    const code = readBareCode(link[2]);
    if (!code.ok) return code;
    return { ok: true, code: code.code, tool, keyFragment: link[3] ?? null };
  }
  return readBareCode(text);
}

/** One sentence on what to fix, for the code box's error line. */
export function joinInputMessage(input: Extract<JoinInput, { ok: false }>): string {
  switch (input.problem) {
    case "empty":
      return "Type the 12-character code from the host's screen.";
    case "too-short":
    case "too-long":
      return `That's ${input.length ?? 0} ${input.length === 1 ? "character" : "characters"}. A room code has ${VISITOR_CODE_LENGTH}.`;
    case "look-alike":
      return `Room codes never use 0, O, 1, I or L, so ${quoteList(input.chars ?? [])} must be another character. Check the host's screen again.`;
    case "not-a-code":
      return input.chars && input.chars.length > 0
        ? `A room code has no ${quoteList(input.chars)}. Codes use letters and the digits 2 to 9.`
        : "That isn't a room code. Codes use letters and the digits 2 to 9.";
    case "unknown-tool":
      return "That link isn't for a live room this page can open.";
  }
}

function quoteList(chars: readonly string[]): string {
  const shown = chars.slice(0, 4).map((c) => `"${c}"`);
  if (shown.length <= 1) return shown[0] ?? "that character";
  return `${shown.slice(0, -1).join(", ")} or ${shown[shown.length - 1]}`;
}
