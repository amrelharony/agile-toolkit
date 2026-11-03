"use client";

import { useEffect, useRef, useState } from "react";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import type { QuizQuestion } from "@/lib/comics/extras";
import { cn } from "@/lib/utils";

/**
 * A story's quiz, when the portal gave it one: pick an answer for each, then
 * check. Nothing is kept or sent; it's for the reader, and for a team talking
 * the story over.
 *
 * The score's live region is always in the page, so the score is announced when
 * it's written into it, and focus moves to it after checking and back to the
 * first answer after "Try again": the button pressed is gone either way.
 */
export function StoryQuiz({ ep, quiz }: { ep: number; quiz: readonly QuizQuestion[] }) {
  const [picked, setPicked] = useState<(number | null)[]>(() => quiz.map(() => null));
  const [checked, setChecked] = useState(false);
  const score = useRef<HTMLParagraphElement>(null);
  const firstAnswer = useRef<HTMLInputElement>(null);
  const moved = useRef(false);
  const right = quiz.filter((q, i) => picked[i] === q.answer).length;
  const allPicked = picked.every((p) => p !== null);

  useEffect(() => {
    if (!moved.current) return;
    moved.current = false;
    (checked ? score.current : firstAnswer.current)?.focus();
  }, [checked]);

  const pick = (question: number, option: number) => {
    setPicked((current) => current.map((p, i) => (i === question ? option : p)));
  };

  return (
    <section aria-labelledby="quiz-heading">
      <Card>
        <CardContent className="space-y-4 p-4 sm:p-6">
          <h2 id="quiz-heading" className="font-display font-semibold text-text">
            A quick quiz
          </h2>
          <ol className="list-none space-y-4">
            {quiz.map((q, qi) => (
              <li key={qi}>
                <fieldset className="space-y-2">
                  <legend className="font-medium text-text">
                    {quiz.length > 1 ? `${qi + 1}. ` : ""}
                    {q.question}
                  </legend>
                  {q.options.map((option, oi) => {
                    const id = `quiz-${ep}-${qi}-${oi}`;
                    return (
                      <div key={oi} className="flex items-start gap-2">
                        <input
                          ref={qi === 0 && oi === 0 ? firstAnswer : undefined}
                          id={id}
                          type="radio"
                          name={`quiz-${ep}-${qi}`}
                          className="mt-1 h-4 w-4 accent-accent"
                          checked={picked[qi] === oi}
                          disabled={checked}
                          onChange={() => pick(qi, oi)}
                        />
                        <label
                          htmlFor={id}
                          className={cn(
                            "text-sub",
                            checked && oi === q.answer && "font-semibold text-text"
                          )}
                        >
                          {option}
                        </label>
                      </div>
                    );
                  })}
                  {checked ? (
                    <p className="text-sm text-text">
                      {picked[qi] === q.answer
                        ? "Right."
                        : `Not quite. It's: ${q.options[q.answer]}`}
                      {q.explain ? <span className="text-sub"> {q.explain}</span> : null}
                    </p>
                  ) : null}
                </fieldset>
              </li>
            ))}
          </ol>
          <div className="flex flex-wrap items-center gap-3">
            <p
              ref={score}
              role="status"
              tabIndex={-1}
              // Visually hidden while empty, never display:none: a region that
              // isn't in the accessibility tree announces nothing when filled.
              className={checked ? "font-medium text-text focus:outline-none" : "sr-only"}
            >
              {checked ? `${right} of ${quiz.length} right` : ""}
            </p>
            {checked ? (
              <Button
                type="button"
                variant="outline"
                onClick={() => {
                  moved.current = true;
                  setPicked(quiz.map(() => null));
                  setChecked(false);
                }}
              >
                Try again
              </Button>
            ) : (
              <Button
                type="button"
                variant="toolkit"
                disabled={!allPicked}
                onClick={() => {
                  moved.current = true;
                  setChecked(true);
                }}
              >
                Check my answers
              </Button>
            )}
          </div>
        </CardContent>
      </Card>
    </section>
  );
}
