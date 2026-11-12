"use client";

/**
 * The word cloud: the words the posts use most, bigger the more posts use
 * them. Plain text in a list (a screen reader hears each word and its
 * count), wrapping on a phone; no canvas, no layout tricks.
 */

import { cn } from "@/lib/utils";
import { wordCloud, type CloudWord } from "@/lib/audience-wall/words";

const SIZE: Record<CloudWord["weight"], string> = {
  1: "text-sm text-sub",
  2: "text-base text-text",
  3: "text-lg text-text",
  4: "text-xl font-medium text-text",
  5: "text-2xl font-semibold text-accent",
};

export function WordCloud({
  texts,
  label = "Word cloud",
  max = 40,
}: {
  texts: readonly string[];
  label?: string;
  max?: number;
}) {
  const words = wordCloud(texts, { max });
  if (words.length === 0) {
    return <p className="text-sm text-sub">No words to show yet: the posts are too short.</p>;
  }
  return (
    <ul
      aria-label={label}
      className="flex min-w-0 flex-wrap items-baseline justify-center gap-x-4 gap-y-2 rounded-lg border border-border bg-surface-deep px-3 py-4"
    >
      {words.map((w) => (
        // A long top word wraps anywhere rather than run past the card on a phone.
        <li
          key={w.word}
          className={cn(
            "min-w-0 max-w-full leading-tight [overflow-wrap:anywhere]",
            SIZE[w.weight]
          )}
        >
          {w.word}
          <span className="sr-only">
            : {w.count} {w.count === 1 ? "post" : "posts"}
          </span>
        </li>
      ))}
    </ul>
  );
}
