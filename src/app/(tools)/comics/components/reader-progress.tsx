"use client";

import { useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { Card, CardContent } from "@/components/ui/card";
import { comicHref } from "@/lib/comics/entry";
import {
  READ_EVENT,
  lovedStories,
  readStories,
  totalSeconds,
  weekStreak,
} from "@/lib/comics/reading";
import { useVipHint } from "@/lib/vip/use-vip-hint";

/** Where a VIP meets everyone, with what each one wants and does. */
const MEET_THE_CAST = "/meet-the-cast";

export interface MetCharacter {
  name: string;
  /** The first story this browser read them in. */
  ep: number;
}

/**
 * The cast this browser has met: each name in `cast` that appears in a story it
 * has read, with the first such story (read order, then number). Names a story
 * lists that aren't in the cast count for nothing.
 */
export function metCast(
  cast: readonly string[],
  stories: readonly { ep: number; castNames: readonly string[] }[],
  read: readonly { ep: number }[]
): MetCharacter[] {
  const byEp = new Map(stories.map((s) => [s.ep, s.castNames]));
  const met = new Map<string, number>();
  for (const { ep } of read) {
    for (const name of byEp.get(ep) ?? []) {
      if (cast.includes(name) && !met.has(name)) met.set(name, ep);
    }
  }
  return cast.flatMap((name) => (met.has(name) ? [{ name, ep: met.get(name)! }] : []));
}

/**
 * "under 1 min", "25 min", "1 h 20 min": the reader's own reading time. The
 * first paint always shows the first, so it's no wider than the figures that
 * replace it: the chip never loses a line and moves the page.
 */
export function readingTimeLabel(seconds: number): string {
  const minutes = Math.floor(seconds / 60);
  if (minutes < 1) return "under 1 min";
  if (minutes < 60) return `${minutes} min`;
  const hours = Math.floor(minutes / 60);
  const rest = minutes % 60;
  return rest === 0 ? `${hours} h` : `${hours} h ${rest} min`;
}

/** Read after mount and after each story counts: the server knows nothing of this browser. */
function useReading() {
  const [read, setRead] = useState<{ ep: number; at: string }[]>([]);
  const [loved, setLoved] = useState<{ ep: number; at: string }[]>([]);
  const [seconds, setSeconds] = useState(0);
  const [now, setNow] = useState<Date | null>(null);
  useEffect(() => {
    const update = () => {
      setRead(readStories());
      setLoved(lovedStories());
      setSeconds(totalSeconds());
      setNow(new Date());
    };
    update();
    window.addEventListener(READ_EVENT, update);
    window.addEventListener("storage", update);
    return () => {
      window.removeEventListener(READ_EVENT, update);
      window.removeEventListener("storage", update);
    };
  }, []);
  const streak = now
    ? weekStreak(
        read.map((r) => r.at),
        now
      )
    : 0;
  return { read, loved, seconds, streak };
}

function streakText(streak: number) {
  return `Weeks in a row: ${streak}`;
}

/**
 * On /comics: how many stories the reader has read, their reading time and
 * weekly streak, the cast they've met and the stories they love. The same
 * height from the first paint, numbers filled in after, so nothing below it
 * moves; the lists wait in closed disclosures, which keeps a phone's page short.
 * Nothing leaves the browser.
 */
export function ReaderProgress({
  cast,
  stories,
}: {
  cast: readonly string[];
  stories: readonly { ep: number; castNames: readonly string[]; title?: string }[];
}) {
  const { read, loved, seconds, streak } = useReading();
  const vip = useVipHint();
  const met = useMemo(() => metCast(cast, stories, read), [cast, stories, read]);
  const titles = useMemo(() => new Map(stories.map((s) => [s.ep, s.title])), [stories]);
  // Only stories that are out: one loved early on the read-ahead page waits here
  // until its Sunday, rather than linking to "coming soon".
  const lovedOut = useMemo(() => loved.filter(({ ep }) => titles.has(ep)), [loved, titles]);

  return (
    <section aria-labelledby="reader-progress-heading">
      <Card>
        <CardContent className="space-y-3 p-4 sm:p-6">
          <h2 id="reader-progress-heading" className="font-display font-semibold text-text">
            Your reading
          </h2>
          {/* Each chip holds two lines from the first paint (2 × 20px, padding
              and border), so the figures filling in never move the page. */}
          <p className="grid grid-cols-2 gap-2 text-sm sm:grid-cols-4">
            <span className="flex min-h-[3.25rem] items-center rounded-lg border border-border px-3 py-1 font-medium text-text">
              Stories read: {read.length}
            </span>
            <span className="flex min-h-[3.25rem] items-center rounded-lg border border-border px-3 py-1 font-medium text-text">
              Time reading: {readingTimeLabel(seconds)}
            </span>
            <span className="flex min-h-[3.25rem] items-center rounded-lg border border-border px-3 py-1 font-medium text-text">
              {streakText(streak)}
            </span>
            <span className="flex min-h-[3.25rem] items-center rounded-lg border border-border px-3 py-1 font-medium text-text">
              Cast met: {met.length} of {cast.length}
            </span>
          </p>
          <details className="group">
            <summary className="min-h-11 cursor-pointer py-2 font-medium text-text">
              Cast you&apos;ve met
            </summary>
            {met.length === 0 ? (
              <p className="mt-2 text-sm text-sub">
                Each story you read to the end adds its colleagues here.
              </p>
            ) : (
              <ul className="mt-2 grid list-none grid-cols-2 gap-2 sm:grid-cols-3 lg:grid-cols-5">
                {met.map((m) => (
                  <li key={m.name}>
                    <Link
                      href={comicHref(m.ep)}
                      prefetch={false}
                      className="flex h-full min-h-11 flex-col justify-center rounded-lg border-2 border-border bg-card p-3 hover:border-text focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent"
                    >
                      <span className="font-medium text-text">{m.name}</span>
                      <span className="text-xs text-sub">First met in episode {m.ep}</span>
                    </Link>
                  </li>
                ))}
              </ul>
            )}
            {cast.length > met.length && met.length > 0 ? (
              <p className="mt-2 text-sm text-sub">
                {cast.length - met.length} more to meet in the weekly stories.
              </p>
            ) : null}
            {vip ? (
              <p className="mt-2 text-sm">
                <Link href={MEET_THE_CAST} className="font-medium text-accent underline">
                  Meet the whole cast
                </Link>
              </p>
            ) : null}
          </details>
          <details>
            <summary className="min-h-11 cursor-pointer py-2 font-medium text-text">
              Stories you loved ({lovedOut.length})
            </summary>
            {lovedOut.length === 0 ? (
              <p className="mt-2 text-sm text-sub">
                Press &ldquo;Love this&rdquo; under a story to keep it here.
              </p>
            ) : (
              <ul className="mt-2 list-none space-y-1">
                {lovedOut.map(({ ep }) => (
                  <li key={ep}>
                    <Link
                      href={comicHref(ep)}
                      prefetch={false}
                      className="inline-flex min-h-11 items-center font-medium text-accent underline"
                    >
                      {titles.get(ep)}
                    </Link>
                  </li>
                ))}
              </ul>
            )}
          </details>
        </CardContent>
      </Card>
    </section>
  );
}

/**
 * At the end of a story: the streak, updated the moment this story counts as
 * read. One line from the first paint, so the page doesn't move.
 */
export function StreakNote() {
  const { read, streak } = useReading();
  return (
    <p className="text-sm text-sub" aria-live="polite">
      {read.length === 0
        ? "Read a story each week to build a streak."
        : `${streakText(streak)}. A new story comes out every Sunday.`}
    </p>
  );
}
