"use client";

import { Button } from "@/components/ui/button";
import { ToggleGroup } from "@/components/ui/toggle-group";
import type { DesignSprintOutput } from "@/lib/stores/workspace-types";
import { ANSWER_LABEL, isAnswer, type QuestionAnswer } from "./outputs";

/**
 * Test day's answers to the sprint questions the team wrote on Map day:
 * yes, no or unclear, and "Not answered" until someone chooses. The answer
 * is stored on the question itself, so the Map day shows it too.
 */

type AnswerChoice = QuestionAnswer | "none";

const OPTIONS: { value: AnswerChoice; label: string }[] = [
  { value: "none", label: "Not answered" },
  { value: "yes", label: ANSWER_LABEL.yes },
  { value: "no", label: ANSWER_LABEL.no },
  { value: "unclear", label: ANSWER_LABEL.unclear },
];

export function QuestionAnswers({
  questions,
  onAnswer,
  onOpenMap,
}: {
  questions: readonly DesignSprintOutput[];
  onAnswer: (question: DesignSprintOutput, answer: QuestionAnswer | null) => void;
  onOpenMap: () => void;
}) {
  const answered = questions.filter((q) => isAnswer(q.answer)).length;
  return (
    <section aria-label="Answers to the sprint questions" className="space-y-2">
      <h3 className="text-xs font-semibold uppercase tracking-wider text-sub">
        Sprint questions{" "}
        {questions.length > 0 && (
          <span className="font-data font-normal normal-case tracking-normal">
            ({answered} of {questions.length} answered)
          </span>
        )}
      </h3>
      {questions.length === 0 ? (
        <div className="flex flex-wrap items-center gap-2 text-sm text-sub">
          <p>No sprint questions on Map day, so there is nothing to answer.</p>
          <Button type="button" variant="link" size="sm" className="h-auto p-0" onClick={onOpenMap}>
            Open Map day
          </Button>
        </div>
      ) : (
        <>
          <p className="text-sm text-sub">Did the interviews answer the questions from Map day?</p>
          <ul className="space-y-2">
            {questions.map((q) => (
              <li
                key={q.id}
                className="flex flex-col gap-2 rounded border border-border bg-bg p-2 md:flex-row md:items-center md:justify-between"
              >
                <span className="min-w-0 break-words text-sm text-text">{q.text}</span>
                <ToggleGroup<AnswerChoice>
                  label={`Answer: ${q.text}`}
                  size="sm"
                  className="shrink-0"
                  options={OPTIONS}
                  value={isAnswer(q.answer) ? q.answer : "none"}
                  onValueChange={(v) => onAnswer(q, v === "none" ? null : v)}
                />
              </li>
            ))}
          </ul>
        </>
      )}
    </section>
  );
}
