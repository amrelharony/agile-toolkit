"use client";

/**
 * Starting a kickoff: six format cards (name, when to use it, how long it
 * takes), then the name, a short brief, the date and who takes part. A
 * Team Canvas starts with the team's people from the Team page; an
 * Inception deck or Trade-offs with Scope, Date, Cost and Quality.
 */

import { Plus } from "lucide-react";
import { ItemForm, useItemForm } from "@/components/shared/item-form";
import { PeoplePicker } from "@/components/team/person-picker";
import { Field } from "@/components/ui/field";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { KICKOFF_FORMAT_LIST, kickoffFormat } from "@/lib/kickoff/formats";
import { validateKickoff, type KickoffStart } from "@/lib/kickoff/model";
import { KICKOFF_BRIEF_MAX, TOOL_TEXT_MAX, type KickoffFormat } from "@/lib/stores/workspace-types";
import type { Validation } from "@/lib/utils/form";
import { cn } from "@/lib/utils";

export interface StartDraft {
  format: KickoffFormat | "";
  title: string;
  brief: string;
  date: string;
  participants: string[];
}

export interface StartValues extends KickoffStart {
  format: KickoffFormat;
}

type StartField = "format" | "title" | "brief" | "date" | "participants";

/** The start form checked: a format, a name, and every field within its cap. */
export function validateStart(draft: StartDraft): Validation<StartValues, StartField> {
  const checked = validateKickoff(draft);
  const errors: Partial<Record<StartField, string>> = checked.ok ? {} : { ...checked.errors };
  if (!kickoffFormat(draft.format)) errors.format = "Pick a format.";
  if (!checked.ok || errors.format) return { ok: false, errors };
  return { ok: true, values: { ...checked.values, format: draft.format as KickoffFormat } };
}

export const EMPTY_START: StartDraft = {
  format: "",
  title: "",
  brief: "",
  date: "",
  participants: [],
};

export function StartKickoff({
  initial,
  onStart,
  onCancel,
}: {
  /** What the form starts with: another format from the same brief, say. */
  initial?: Partial<StartDraft>;
  onStart: (values: StartValues) => void;
  onCancel?: () => void;
}) {
  const form = useItemForm<StartDraft, StartValues, StartField>({
    initial: () => ({ ...EMPTY_START, ...initial }),
    validate: validateStart,
    onSave: onStart,
  });
  const { draft, update, errors } = form;
  const chosen = kickoffFormat(draft.format);

  return (
    <ItemForm
      form={form}
      submitLabel="Start the kickoff"
      submitIcon={<Plus className="h-4 w-4" aria-hidden="true" />}
      onCancel={onCancel}
      className="space-y-4"
    >
      <fieldset className="space-y-2" data-invalid={errors.format ? "true" : undefined}>
        <legend className="text-sm font-medium text-text">Pick a format</legend>
        <div className="grid gap-2 sm:grid-cols-2 lg:grid-cols-3">
          {KICKOFF_FORMAT_LIST.map((f) => {
            const on = draft.format === f.id;
            return (
              <button
                key={f.id}
                type="button"
                aria-pressed={on}
                aria-invalid={errors.format && !draft.format ? true : undefined}
                onClick={() => update({ format: f.id })}
                className={cn(
                  "flex min-h-11 flex-col items-start gap-1 rounded-lg border p-3 text-left transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent",
                  on ? "border-accent bg-accent/10" : "border-border bg-card hover:border-accent/40"
                )}
              >
                <span className="text-sm font-medium text-text">{f.name}</span>
                <span className="text-xs text-sub">{f.useWhen}</span>
                {f.time && <span className="text-xs text-sub">{f.time}</span>}
              </button>
            );
          })}
        </div>
        {errors.format && (
          <p role="alert" className="text-sm text-danger">
            {errors.format}
          </p>
        )}
        {chosen?.id === "team-canvas" && (
          <p className="text-xs text-sub">
            It starts with the people on the Team page, each with their role.
          </p>
        )}
        {chosen?.hasSliders && (
          <p className="text-xs text-sub">It starts with Scope, Date, Cost and Quality to order.</p>
        )}
      </fieldset>
      <Field label="Name" hint="The team or the work it starts." error={errors.title} required>
        {(props) => (
          <Input
            {...props}
            value={draft.title}
            maxLength={TOOL_TEXT_MAX.short}
            onChange={(e) => update({ title: e.target.value })}
            placeholder="Checkout squad"
          />
        )}
      </Field>
      <Field
        label="Brief"
        hint="What this is and why now, in a sentence or two. Amr drafts from it."
        error={errors.brief}
      >
        {(props) => (
          <Textarea
            {...props}
            rows={3}
            value={draft.brief}
            maxLength={KICKOFF_BRIEF_MAX}
            onChange={(e) => update({ brief: e.target.value })}
          />
        )}
      </Field>
      <div className="grid gap-3 md:grid-cols-2">
        <Field label="Date" error={errors.date}>
          {(props) => (
            <Input
              {...props}
              type="date"
              value={draft.date}
              onChange={(e) => update({ date: e.target.value })}
            />
          )}
        </Field>
        <PeoplePicker
          label="Who takes part"
          values={draft.participants}
          onChange={(participants) => update({ participants })}
          error={errors.participants}
          offerEveryone
        />
      </div>
    </ItemForm>
  );
}
