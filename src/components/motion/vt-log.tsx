"use client";

/**
 * The ?vt-log=1 table: the last 20 page changes on this visit, with how each
 * ended and how long the screen held still. It is for measuring the hold cap
 * with real finger taps on a phone (docs/PAGE-TRANSITIONS.md). It reads the
 * list page-transition.ts keeps in memory and sends nothing anywhere. It lets
 * taps through, and sits under Amr and the top bar.
 */

import { useEffect, useState } from "react";
import {
  onPageChange,
  pageChangeLog,
  type PageChangeEntry,
  type PageChangeOutcome,
} from "@/lib/motion/page-transition";

const OUTCOMES: PageChangeOutcome[] = ["ran", "capped", "fallback", "instant"];

/** The path and query, short enough for a phone. */
function shortHref(href: string): string {
  try {
    const url = new URL(href, window.location.href);
    return url.pathname + url.search;
  } catch {
    return href;
  }
}

export default function VtLog() {
  const [taps, setTaps] = useState<readonly PageChangeEntry[]>(() => [...pageChangeLog()]);

  useEffect(() => {
    setTaps([...pageChangeLog()]);
    return onPageChange(() => setTaps([...pageChangeLog()]));
  }, []);

  const counts = OUTCOMES.map((o) => `${o} ${taps.filter((t) => t.outcome === o).length}`);

  return (
    <section
      aria-label="Page change log"
      className="pointer-events-none fixed left-2 top-[calc(var(--header-h)+0.5rem)] z-30 max-h-[60vh] w-[min(22rem,calc(100vw-1rem))] overflow-hidden rounded-md border border-border bg-bg/90 p-2 font-mono text-xs text-text shadow-md"
    >
      <p className="mb-1 font-semibold">Page changes: {counts.join(" · ")}</p>
      <table className="w-full border-collapse text-left">
        <thead>
          <tr className="text-sub">
            <th scope="col" className="pr-2 font-normal">
              #
            </th>
            <th scope="col" className="pr-2 font-normal">
              Outcome
            </th>
            <th scope="col" className="pr-2 font-normal">
              Held
            </th>
            <th scope="col" className="font-normal">
              Page
            </th>
          </tr>
        </thead>
        <tbody>
          {taps.length === 0 ? (
            <tr>
              <td colSpan={4} className="text-sub">
                No taps yet
              </td>
            </tr>
          ) : (
            taps
              .map((tap, i) => (
                <tr key={`${tap.at}-${i}`}>
                  <td className="pr-2 tabular-nums">{i + 1}</td>
                  <td className="pr-2">
                    {tap.outcome}
                    {tap.why ? ` (${tap.why})` : ""}
                  </td>
                  <td className="pr-2 tabular-nums">{tap.waited} ms</td>
                  <td className="max-w-[9rem] truncate">{shortHref(tap.href)}</td>
                </tr>
              ))
              .reverse()
          )}
        </tbody>
      </table>
    </section>
  );
}
