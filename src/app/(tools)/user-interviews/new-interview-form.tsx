"use client";

/**
 * "New interview": a button that opens the form. Nothing is saved until
 * who it was with is named (a pseudonym is fine) and the day has
 * happened; a failed save focuses what's missing. Enter saves, Escape
 * closes.
 */

import { useEffect, useRef, useState } from "react";
import { Plus, Quote } from "lucide-react";
import { ItemForm, useItemForm } from "@/components/shared/item-form";
import { SectionCard } from "@/components/shared/section-card";
import { Button } from "@/components/ui/button";
import { Field } from "@/components/ui/field";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { CONTEXT_MAX, PARTICIPANT_MAX } from "@/lib/interviews/model";
import {
  emptyInterviewDraft,
  validateInterview,
  type InterviewDraft,
  type InterviewField,
  type InterviewValues,
} from "./form";

export function NewInterviewForm({
  today,
  onAdd,
}: {
  today: string;
  onAdd: (values: InterviewValues) => void;
}) {
  const [open, setOpen] = useState(false);
  const openerRef = useRef<HTMLButtonElement>(null);
  const reopenFocus = useRef(false);
  const form = useItemForm<InterviewDraft, InterviewValues, InterviewField>({
    initial: () => emptyInterviewDraft(today),
    validate: (d) => validateInterview(d, today),
    onSave: (values) => {
      onAdd(values);
      setOpen(false);
      reopenFocus.current = false;
    },
  });
  const { draft, update, errors, formRef, reset } = form;

  const close = () => {
    setOpen(false);
    reset();
    reopenFocus.current = true;
  };

  useEffect(() => {
    if (open) formRef.current?.querySelector<HTMLElement>("input")?.focus();
    else if (reopenFocus.current) {
      reopenFocus.current = false;
      openerRef.current?.focus();
    }
  }, [open, formRef]);

  if (!open) {
    return (
      <Button
        ref={openerRef}
        variant="toolkit"
        className="gap-2"
        onClick={() => setOpen(true)}
        data-new-interview=""
      >
        <Plus className="h-4 w-4" aria-hidden="true" />
        New interview
      </Button>
    );
  }

  return (
    <SectionCard title="New interview" icon={Quote} className="w-full">
      <ItemForm
        form={form}
        submitLabel="Add interview"
        submitIcon={<Plus className="h-4 w-4" aria-hidden="true" />}
        onCancel={close}
      >
        <div className="grid grid-cols-1 gap-3 sm:grid-cols-[1fr_12rem]">
          <Field
            label="Participant"
            hint="A name or a pseudonym; exports can anonymise it."
            error={errors.participant}
            required
          >
            {(props) => (
              <Input
                {...props}
                maxLength={PARTICIPANT_MAX}
                value={draft.participant}
                onChange={(e) => update({ participant: e.target.value })}
                placeholder="Customer 3, ops lead"
              />
            )}
          </Field>
          <Field label="Interviewed on" error={errors.date} required>
            {(props) => (
              <Input
                {...props}
                type="date"
                max={today}
                value={draft.date}
                onChange={(e) => update({ date: e.target.value })}
              />
            )}
          </Field>
        </div>
        <Field
          label="Context"
          hint="Optional. Their role, how they use the product, what you were exploring."
          error={errors.context}
        >
          {(props) => (
            <Textarea
              {...props}
              rows={2}
              maxLength={CONTEXT_MAX}
              value={draft.context}
              onChange={(e) => update({ context: e.target.value })}
              className="resize-none"
            />
          )}
        </Field>
      </ItemForm>
    </SectionCard>
  );
}
