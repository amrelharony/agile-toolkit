"use client";

import { useEffect, useRef, useState } from "react";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { SEEN_OPTIONS, SHOW_SHARES_AT } from "@/lib/comics/guess";
import { markSeen, seenFor } from "@/lib/comics/reading";
import { readTaps, sendTap, type TapResult } from "@/lib/comics/taps-client";

const SIZE = SEEN_OPTIONS.length;

/**
 * "Seen this at work?": one tap, then how many readers have. Counted once per
 * device (the reading record) and anonymously (/api/comics/taps). The answer
 * area is a live region that's always in the page, so the result is announced
 * when it arrives, and focus moves to it because the buttons pressed are gone.
 */
export function SeenAtWork({ ep }: { ep: number }) {
  const [answer, setAnswer] = useState<number | null>(null);
  const [result, setResult] = useState<TapResult | null>(null);
  const status = useRef<HTMLParagraphElement>(null);
  const moved = useRef(false);

  useEffect(() => {
    const before = seenFor(ep);
    if (before === null || before >= SIZE) return;
    setAnswer(before);
    let live = true;
    void readTaps(ep, "seen", SIZE).then((r) => {
      if (live) setResult(r);
    });
    return () => {
      live = false;
    };
  }, [ep]);

  useEffect(() => {
    if (answer === null || !moved.current) return;
    moved.current = false;
    status.current?.focus();
  }, [answer]);

  const tap = (choice: number) => {
    if (answer !== null) return;
    moved.current = true;
    const first = seenFor(ep) === null;
    setAnswer(choice);
    markSeen(ep, choice);
    void (first ? sendTap(ep, "seen", choice, SIZE) : readTaps(ep, "seen", SIZE)).then(setResult);
  };

  const total = result ? result.counts[0] + result.counts[1] : 0;
  const message =
    answer === null
      ? ""
      : result?.shares
        ? `Thanks. ${result.shares[0]}% of readers have seen this at work.`
        : result
          ? `Thanks. The share shows once ${SHOW_SHARES_AT} readers have answered${
              total > 0 ? ` (${total} so far)` : ""
            }.`
          : "Thanks.";

  return (
    <section aria-labelledby={`seen-${ep}`}>
      <Card>
        <CardContent className="space-y-3 p-4 sm:p-6">
          <h2 id={`seen-${ep}`} className="font-display font-semibold text-text">
            Seen this at work?
          </h2>
          {answer === null ? (
            <div className="grid grid-cols-1 gap-2 min-[360px]:grid-cols-2">
              {SEEN_OPTIONS.map((label, i) => (
                <Button
                  key={label}
                  type="button"
                  variant="outline"
                  className="w-full whitespace-normal"
                  onClick={() => tap(i)}
                >
                  {label}
                </Button>
              ))}
            </div>
          ) : null}
          <p
            ref={status}
            role="status"
            tabIndex={-1}
            // Visually hidden while empty, never display:none: a region that
            // isn't in the accessibility tree announces nothing when filled.
            className={answer === null ? "sr-only" : "text-sub focus:outline-none"}
          >
            {message}
          </p>
        </CardContent>
      </Card>
    </section>
  );
}
