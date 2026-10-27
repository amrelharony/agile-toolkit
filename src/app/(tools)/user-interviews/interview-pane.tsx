"use client";

/**
 * The selected interview: who it was with, when and the context, edited
 * in place (a name can't be cleared, a day can't be in the future), its
 * quotes (edited in place, deleted with Undo, raised as opportunities),
 * a form for the next quote, and "Delete interview" with Undo.
 */

import { forwardRef, useEffect, useId, useState } from "react";
import { Quote, Trash2 } from "lucide-react";
import { BlurTextarea } from "@/components/shared/blur-fields";
import { DayInput } from "@/components/shared/day-input";
import { Button } from "@/components/ui/button";
import { Field } from "@/components/ui/field";
import { Input } from "@/components/ui/input";
import { CONTEXT_MAX, PARTICIPANT_MAX } from "@/lib/interviews/model";
import type { Interview, InterviewQuote, TreeNode } from "@/lib/stores/workspace-types";
import { isExampleId } from "@/lib/utils/example-id";
import {
  interviewDraftFrom,
  validateInterview,
  type InterviewDraft,
  type InterviewValues,
  type QuoteValues,
} from "./form";
import { AddQuoteForm, QuoteCard } from "./quote-card";

export interface InterviewPaneProps {
  interview: Interview;
  today: string;
  nodes: readonly TreeNode[];
  onSave: (i: Interview, values: InterviewValues, fields: string[]) => void;
  onRemove: (i: Interview) => void;
  onAddQuote: (i: Interview, values: QuoteValues) => void;
  onSaveQuote: (i: Interview, q: InterviewQuote, values: QuoteValues) => void;
  onRemoveQuote: (i: Interview, q: InterviewQuote) => void;
  onSendQuote: (i: Interview, q: InterviewQuote, parentId: string | undefined) => void;
}

export const InterviewPane = forwardRef<HTMLHeadingElement, InterviewPaneProps>(
  function InterviewPane(
    {
      interview: i,
      today,
      nodes,
      onSave,
      onRemove,
      onAddQuote,
      onSaveQuote,
      onRemoveQuote,
      onSendQuote,
    },
    headingRef
  ) {
    const headingId = useId();
    const example = isExampleId(i.id);
    const name = i.participant?.trim() || "an unnamed participant";

    /** The interview with `patch` typed over its details, checked as the add form checks it. */
    const check = (patch: Partial<InterviewDraft>) =>
      validateInterview({ ...interviewDraftFrom(i), ...patch }, today, i);
    const save = (patch: Partial<InterviewDraft>, field: string) => {
      const r = check(patch);
      if (r.ok) onSave(i, r.values, [field]);
      return r;
    };

    return (
      <section
        aria-labelledby={headingId}
        className="space-y-4 rounded-lg border border-border bg-surface p-3 sm:p-4"
      >
        <h2
          id={headingId}
          ref={headingRef}
          // Focused when an interview is opened, so a phone scrolls to it.
          tabIndex={-1}
          className="text-base font-semibold text-text focus-visible:outline-none"
        >
          Interview with {name}
        </h2>

        <div className="grid grid-cols-1 gap-3 sm:grid-cols-[1fr_12rem]">
          <ParticipantInPlace
            value={i.participant ?? ""}
            validate={(v) => {
              const r = check({ participant: v });
              return r.ok ? null : (r.errors.participant ?? null);
            }}
            onCommit={(v) => save({ participant: v }, "participant")}
          />
          <div className="flex min-w-0 flex-col gap-1.5">
            <span className="text-sm text-text" aria-hidden="true">
              Interviewed on
            </span>
            <DayInput
              label={`Interviewed on, ${name}`}
              value={(i.date ?? "").slice(0, 10)}
              max={today}
              validate={(day) => {
                const r = check({ date: day });
                return r.ok ? null : (r.errors.date ?? Object.values(r.errors)[0] ?? null);
              }}
              onCommit={(day) => save({ date: day }, "date")}
            />
          </div>
        </div>
        <Field label="Context" hint="Optional. Blank removes it.">
          {(props) => (
            <BlurTextarea
              id={props.id}
              rows={2}
              maxLength={Math.max(CONTEXT_MAX, (i.context ?? "").length)}
              value={i.context ?? ""}
              onCommit={(v) => save({ context: v }, "context")}
              placeholder="Their role, how they use the product, what you were exploring"
              className="resize-none"
            />
          )}
        </Field>

        <div className="space-y-2">
          <h3 className="flex items-center gap-1 text-sm font-medium text-text">
            <Quote className="h-4 w-4 text-accent" aria-hidden="true" />
            Quotes ({(i.quotes ?? []).length})
          </h3>
          {(i.quotes ?? []).length > 0 && (
            <ul className="space-y-2" aria-label={`Quotes from ${name}`}>
              {(i.quotes ?? []).map((q, idx) => (
                <QuoteCard
                  key={q.id}
                  quote={q}
                  index={idx + 1}
                  nodes={nodes}
                  example={example}
                  onSave={(quote, values) => onSaveQuote(i, quote, values)}
                  onRemove={(quote) => onRemoveQuote(i, quote)}
                  onSend={(quote, parentId) => onSendQuote(i, quote, parentId)}
                />
              ))}
            </ul>
          )}
          <AddQuoteForm participant={i.participant ?? ""} onAdd={(v) => onAddQuote(i, v)} />
        </div>

        <div className="flex justify-end border-t border-border pt-3">
          <Button
            type="button"
            variant="danger-ghost"
            size="sm"
            className="gap-1"
            onClick={() => onRemove(i)}
          >
            <Trash2 aria-hidden="true" />
            Delete interview
          </Button>
        </div>
      </section>
    );
  }
);

/**
 * Who it was with, saved when the field is left or on Enter. A blank or
 * too-long name is refused with its reason, and the saved one stays.
 */
function ParticipantInPlace({
  value,
  validate,
  onCommit,
}: {
  value: string;
  validate: (v: string) => string | null;
  onCommit: (v: string) => void;
}) {
  const [draft, setDraft] = useState(value);
  const [error, setError] = useState<string | null>(null);
  useEffect(() => {
    setDraft(value);
    setError(null);
  }, [value]);
  const commit = () => {
    if (draft === value) {
      setError(null);
      return;
    }
    const why = validate(draft);
    setError(why);
    if (!why) onCommit(draft);
  };
  return (
    <Field label="Participant" error={error ?? undefined} required>
      {(props) => (
        <Input
          {...props}
          maxLength={Math.max(PARTICIPANT_MAX, value.length)}
          value={draft}
          onChange={(e) => {
            setDraft(e.target.value);
            if (error) setError(validate(e.target.value));
          }}
          onBlur={commit}
          onKeyDown={(e) => {
            if (e.key === "Enter") {
              e.preventDefault();
              commit();
            } else if (e.key === "Escape") {
              e.preventDefault();
              setDraft(value);
              setError(null);
            }
          }}
        />
      )}
    </Field>
  );
}
