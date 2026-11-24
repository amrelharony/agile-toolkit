/**
 * A straw poll in Quick Vote over ideas or pitches: a link that opens a
 * poll with one option per canvas, through Quick Vote's own `pollLinkHref`
 * (the titles ride after the # sign, so they never reach a server). Each
 * option is "N Title", N counting from 1, so two titles
 * that share their first 30 characters (a link option's length) stay two
 * options; the page shows each key beside its title, so the room's totals
 * can be read back. A link takes LINK_OPTIONS_MAX options: the rest are
 * counted in `left`, and the page says so.
 *
 * Pure and server-safe.
 */

import { LINK_OPTIONS_MAX, pollLinkHref } from "@/lib/quick-vote/link";

export interface CanvasPoll {
  href: string;
  /** Each canvas in the poll, by id: the number its option starts with. */
  keys: Map<string, string>;
  /** Canvases past the link's options, left out of the poll. */
  left: number;
}

/** The Quick Vote link for `question` over `items`, in their order. */
export function canvasPoll(
  question: string,
  items: readonly { id: string; title: string }[]
): CanvasPoll {
  const shown = items.slice(0, LINK_OPTIONS_MAX);
  const keys = new Map<string, string>();
  const options = shown.map((item, i) => {
    const key = String(i + 1);
    keys.set(item.id, key);
    return `${key} ${item.title.replace(/\s+/g, " ").trim()}`;
  });
  return {
    href: pollLinkHref(question, options),
    keys,
    left: Math.max(0, items.length - shown.length),
  };
}
