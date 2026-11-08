"use client";

import { useCallback, useEffect, useState } from "react";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { SHOW_SHARES_AT, type StoryGuess } from "@/lib/comics/guess";
import { SKIPPED, guessFor, markGuessed } from "@/lib/comics/reading";
import { readTaps, sendTap, type TapResult } from "@/lib/comics/taps-client";
import { cn } from "@/lib/utils";

export interface GuessState {
  /** The last panel shows. True from the start for a story without a guess. */
  revealed: boolean;
  /** The option this reader picked, SKIPPED, or null before either. */
  picked: number | null;
  /** How readers picked, once known. Null while loading or when the count failed. */
  result: TapResult | null;
  /** True between the tap and the reveal's first paint, so a double tap counts once. */
  busy: boolean;
  choose: (option: number) => void;
  skip: () => void;
}

/**
 * One story's guess: whether the last panel is out, what this reader picked,
 * and how everyone picked. A reader who already answered on this device (the
 * reading record) sees the panel and the totals at once and isn't counted again.
 * The tap counts in the background: the panel never waits for the network.
 */
export function useStoryGuess(ep: number, guess: StoryGuess | null): GuessState {
  const size = guess?.options.length ?? 0;
  const [revealed, setRevealed] = useState(!guess);
  const [picked, setPicked] = useState<number | null>(null);
  const [result, setResult] = useState<TapResult | null>(null);
  const [busy, setBusy] = useState(false);

  // Read after mount: the server render knows nothing of this browser.
  useEffect(() => {
    if (!guess) return;
    const before = guessFor(ep);
    if (before === null || before >= size) return;
    setPicked(before);
    setRevealed(true);
    let live = true;
    void readTaps(ep, "guess", size).then((r) => {
      if (live) setResult(r);
    });
    return () => {
      live = false;
    };
  }, [ep, guess, size]);

  const choose = useCallback(
    (option: number) => {
      if (!guess || busy || revealed) return;
      setBusy(true);
      setPicked(option);
      setRevealed(true);
      const first = guessFor(ep) === null;
      markGuessed(ep, option);
      void (first ? sendTap(ep, "guess", option, size) : readTaps(ep, "guess", size)).then((r) => {
        setResult(r);
        setBusy(false);
      });
    },
    [busy, ep, guess, revealed, size]
  );

  const skip = useCallback(() => {
    if (!guess || revealed) return;
    setPicked(SKIPPED);
    setRevealed(true);
    markGuessed(ep, SKIPPED);
    void readTaps(ep, "guess", size).then(setResult);
  }, [ep, guess, revealed, size]);

  return { revealed, picked, result, busy, choose, skip };
}

/** Over the last panel until the reader guesses: the same box, so nothing moves when it lifts. */
export function GuessCover({ panelNumber }: { panelNumber: number }) {
  return (
    <div
      role="img"
      aria-label={`Panel ${panelNumber} is hidden until you guess what happens, below.`}
      className="guess-cover absolute inset-0 flex flex-col items-center justify-center gap-1 bg-card text-text"
    >
      <span aria-hidden="true" className="font-display text-5xl font-bold leading-none">
        ?
      </span>
      <span aria-hidden="true" className="text-sm text-sub">
        Panel {panelNumber}
      </span>
    </div>
  );
}

/** Without JavaScript nobody could guess, so the cover simply isn't there. */
export const GUESS_NOSCRIPT = "<style>.guess-cover{display:none}</style>";

/** The question and its options, under the panels, while the last one is hidden. */
export function GuessQuestion({
  ep,
  guess,
  panelNumber,
  state,
}: {
  ep: number;
  guess: StoryGuess;
  panelNumber: number;
  state: GuessState;
}) {
  const headingId = `guess-${ep}`;
  return (
    <section aria-labelledby={headingId}>
      <Card>
        <CardContent className="space-y-3 p-4 sm:p-6">
          <h2 id={headingId} className="font-display font-semibold text-text">
            {guess.question}
          </h2>
          <p className="text-sm text-sub">Pick one to see panel {panelNumber}.</p>
          <div role="group" aria-labelledby={headingId} className="grid gap-2">
            {guess.options.map((option, i) => (
              <Button
                key={i}
                type="button"
                variant="outline"
                disabled={state.busy}
                onClick={() => state.choose(i)}
                className="h-auto min-h-11 w-full justify-start whitespace-normal py-3 text-left md:h-auto"
              >
                {option}
              </Button>
            ))}
          </div>
          <Button type="button" variant="ghost" className="w-full sm:w-auto" onClick={state.skip}>
            Just show me
          </Button>
        </CardContent>
      </Card>
    </section>
  );
}

function Tag({ children, strong = false }: { children: string; strong?: boolean }) {
  return (
    <span
      className={cn(
        "inline-block rounded-full border border-border px-2 py-0.5 text-xs font-medium text-text",
        strong && "bg-accent/10"
      )}
    >
      {children}
    </span>
  );
}

/** After the reveal: what happened, this reader's guess, and how readers picked. */
export function GuessResults({
  ep,
  guess,
  state,
}: {
  ep: number;
  guess: StoryGuess;
  state: GuessState;
}) {
  const headingId = `guess-results-${ep}`;
  const shares = state.result?.shares ?? null;
  const total = state.result?.counts.reduce((sum, n) => sum + n, 0) ?? 0;
  const soFar =
    total === 0
      ? "Nobody has guessed yet."
      : total === 1 && state.picked !== SKIPPED
        ? "You're the first to guess."
        : `${total} readers have guessed so far.`;
  return (
    <section aria-labelledby={headingId}>
      <Card>
        <CardContent className="space-y-3 p-4 sm:p-6">
          <h2 id={headingId} className="font-display font-semibold text-text">
            {shares ? "What readers picked" : guess.question}
          </h2>
          <ul className="list-none space-y-3">
            {guess.options.map((option, i) => (
              <li key={i} className="space-y-1">
                <p className="flex flex-wrap items-center gap-x-2 gap-y-1 text-sm text-text">
                  <span>{option}</span>
                  {i === guess.happened ? <Tag strong>What happened</Tag> : null}
                  {i === state.picked ? <Tag>Your guess</Tag> : null}
                </p>
                {shares ? (
                  <div className="flex items-center gap-2">
                    <div
                      aria-hidden="true"
                      className="h-2 flex-1 overflow-hidden rounded-full bg-border"
                    >
                      <div
                        className="h-full rounded-full bg-accent"
                        style={{ width: `${shares[i]}%` }}
                      />
                    </div>
                    <span className="w-10 shrink-0 text-right text-sm tabular-nums text-sub">
                      {shares[i]}%
                    </span>
                  </div>
                ) : null}
              </li>
            ))}
          </ul>
          {state.result && !shares ? (
            <p className="text-sm text-sub">
              {soFar} How everyone picked shows once {SHOW_SHARES_AT} readers have guessed.
            </p>
          ) : null}
          {guess.note ? <p className="text-sub">{guess.note}</p> : null}
        </CardContent>
      </Card>
    </section>
  );
}
