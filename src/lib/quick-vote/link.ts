/**
 * A link that opens Quick Vote with a poll set up:
 * `/quick-vote?preset=poll&question=…&options=…`, the options one per
 * line. Picker's "Vote in Quick Vote" builds it from its shortlist (up to
 * 20 names of up to 30 characters, a question of up to 200).
 *
 * The page treats the link as untrusted text: only a poll is opened, each
 * value is cleaned and capped, and anything else in the link is ignored.
 * More options than a live round takes are kept (up to 20), so the host
 * sees them all and the form says how many to drop.
 *
 * Pure and server-safe.
 */

import { cleanLine, QUESTION_MAX } from "./draft";

/** The link's parameters: the page takes them off the address once read. */
export const POLL_LINK_PARAMS = ["preset", "question", "options"] as const;
/** The most options a link carries. */
export const LINK_OPTIONS_MAX = 20;
/** The longest option a link carries; a longer one is cut. */
export const LINK_OPTION_CHARS = 30;
/** The longest question a link carries; a longer one is ignored. */
export const LINK_QUESTION_CHARS = 200;
/** The most raw text read from the options (20 lines of 30 with room for encoding). */
const LINK_OPTIONS_TEXT_MAX = 4_000;

export interface PollLink {
  /** The question, cleaned and cut to what a round takes; null for the poll's own. */
  question: string | null;
  /** The options, cleaned, capped, each once (case aside), in the link's order. */
  options: string[];
}

/** The link to open a poll with `question` and `options` (capped as the page reads them). */
export function pollLinkHref(question: string, options: readonly string[]): string {
  const params = new URLSearchParams({
    preset: "poll",
    question: question.slice(0, LINK_QUESTION_CHARS),
    options: options
      .slice(0, LINK_OPTIONS_MAX)
      .map((o) => cleanLine(o, LINK_OPTION_CHARS))
      .join("\n"),
  });
  return `/quick-vote?${params.toString()}`;
}

/** The poll a page address asks for (its `?…` part), or null when it asks for none. */
export function readPollLink(search: string): PollLink | null {
  let params: URLSearchParams;
  try {
    params = new URLSearchParams(search);
  } catch {
    return null;
  }
  if (params.get("preset") !== "poll") return null;

  const rawQuestion = params.get("question") ?? "";
  const question =
    rawQuestion.length <= LINK_QUESTION_CHARS ? cleanLine(rawQuestion, QUESTION_MAX) : "";

  const seen = new Set<string>();
  const options: string[] = [];
  for (const line of (params.get("options") ?? "").slice(0, LINK_OPTIONS_TEXT_MAX).split(/\r?\n/)) {
    if (options.length >= LINK_OPTIONS_MAX) break;
    const text = cleanLine(line, LINK_OPTION_CHARS);
    const key = text.toLowerCase();
    if (!text || seen.has(key)) continue;
    seen.add(key);
    options.push(text);
  }
  return { question: question || null, options };
}
