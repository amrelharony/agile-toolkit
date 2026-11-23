"use client";

/**
 * The PR/FAQ's own panel: the press release's length against its aim, the
 * launch date's check, and the hard questions: each one asked when an
 * internal question carries it, answered when that question has its answer.
 * "Add to internal questions" adds the question to the internal questions, to answer there.
 */

import { useState } from "react";
import { Check, Plus } from "lucide-react";
import { SectionCard } from "@/components/shared/section-card";
import { Button } from "@/components/ui/button";
import { PRODUCT_CANVAS_ACTIONS } from "@/lib/history/event-actions";
import {
  HEADLINE_WORDS_MAX,
  RELEASE_WORDS_AIM,
  RELEASE_WORDS_NOTE,
} from "@/lib/product-canvas/formats";
import { answerOf, hardQuestions, releaseWords, withItem } from "@/lib/product-canvas/model";
import { isIsoDay } from "@/lib/product-goal/model";
import { todayIso } from "@/lib/sprints/series";
import type { CanvasHandle } from "../boxes";

export function PressReleasePanel({ handle }: { handle: CanvasHandle }) {
  const { canvas, write, log } = handle;
  const [problem, setProblem] = useState<string | null>(null);
  const words = releaseWords(canvas);
  const date = answerOf(canvas, "launch-date");
  const today = todayIso();
  const questions = hardQuestions(canvas);
  const asked = questions.filter((q) => q.asked).length;
  const answered = questions.filter((q) => q.answered).length;

  const ask = (id: string, text: string) => {
    const w = write((c, now) => withItem(c, "internal-faq", { text, promptId: id }, now));
    if (!w.ok) {
      setProblem(w.message);
      return;
    }
    setProblem(null);
    log(PRODUCT_CANVAS_ACTIONS.CANVAS_UPDATED, { canvasId: canvas.id, section: "internal-faq" });
  };

  return (
    <SectionCard title="Check the press release" contentClassName="space-y-3">
      <p className="text-sm text-text" data-field="release-words">
        {words.words} words. About {RELEASE_WORDS_AIM} reads well.
        {words.words > RELEASE_WORDS_NOTE && (
          <span className="text-warning">
            {" "}
            It is getting long: cut what a customer wouldn’t miss.
          </span>
        )}
      </p>
      {words.headline > HEADLINE_WORDS_MAX && (
        <p className="text-sm text-warning">
          The headline has {words.headline} words. Keep it to {HEADLINE_WORDS_MAX} or fewer.
        </p>
      )}
      {!date ? (
        <p className="text-sm text-sub">No launch date yet.</p>
      ) : !isIsoDay(date) ? (
        <p className="text-sm text-warning">The launch date isn’t a day (YYYY-MM-DD).</p>
      ) : date < today ? (
        <p className="text-sm text-warning" data-field="launch-past">
          The launch date {date} has passed. Move it, or say what launched.
        </p>
      ) : (
        <p className="text-sm text-sub">Launch date: {date}.</p>
      )}
      <div className="space-y-2 border-t border-border pt-3">
        <p className="text-sm font-medium text-text">
          Hard questions: {asked} of {questions.length} asked, {answered} answered
        </p>
        <ul aria-label="Hard questions" className="space-y-1.5">
          {questions.map((q) => (
            <li
              key={q.id}
              className="flex flex-col gap-1.5 rounded-md border border-border p-2 sm:flex-row sm:items-center"
            >
              <span className="min-w-0 flex-1 break-words text-sm text-text">{q.text}</span>
              {q.asked ? (
                <span className="inline-flex items-center gap-1 text-xs text-sub">
                  <Check className="h-3.5 w-3.5" aria-hidden="true" />
                  {q.answered ? "Asked and answered" : "Asked, not answered yet"}
                </span>
              ) : (
                <Button
                  type="button"
                  size="sm"
                  variant="outline"
                  aria-label={`Add to internal questions: ${q.text}`}
                  onClick={() => ask(q.id, q.text)}
                >
                  <Plus aria-hidden="true" />
                  Add to internal questions
                </Button>
              )}
            </li>
          ))}
        </ul>
        {problem && (
          <p role="alert" className="text-sm text-danger">
            {problem}
          </p>
        )}
      </div>
    </SectionCard>
  );
}
