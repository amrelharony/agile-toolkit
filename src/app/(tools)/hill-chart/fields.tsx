"use client";

/**
 * Hill Chart's form fields: a chart (name, what it covers, the sprint or
 * epic it follows) and a scope (title, position, the story or epic it
 * follows, a note). Native selects sized like <Input>.
 */

import { Input } from "@/components/ui/input";
import { Field } from "@/components/ui/field";
import { Textarea } from "@/components/ui/textarea";
import type { ItemFormState } from "@/components/shared/item-form";
import { TOOL_TEXT_MAX } from "@/lib/stores/workspace-types";
import type { ChartDraft, ChartField, ScopeDraft, ScopeField } from "./form";

/** Matches <Input>: 44 px / 16 px on touch, 36 px / 14 px for a mouse at md+. */
export const SELECT_CLASS =
  "flex h-11 pointer-fine:md:h-9 w-full rounded-md border border-input bg-background px-3 py-1 text-base pointer-fine:md:text-sm text-text shadow-sm focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring disabled:cursor-not-allowed disabled:opacity-50";

export interface LinkOption {
  id: string;
  label: string;
}

function LinkSelect({
  label,
  hint,
  value,
  options,
  none,
  onChange,
}: {
  label: string;
  hint?: string;
  value: string;
  options: readonly LinkOption[];
  none: string;
  onChange: (value: string) => void;
}) {
  // A link to something since removed stays readable until it is changed.
  const missing = value && !options.some((o) => o.id === value);
  return (
    <Field label={label} hint={hint}>
      {(props) => (
        <select
          {...props}
          className={SELECT_CLASS}
          value={value}
          onChange={(e) => onChange(e.target.value)}
        >
          <option value="">{none}</option>
          {options.map((o) => (
            <option key={o.id} value={o.id}>
              {o.label}
            </option>
          ))}
          {missing && <option value={value}>No longer there</option>}
        </select>
      )}
    </Field>
  );
}

export function ChartFields({
  form,
  sprints,
  epics,
}: {
  form: ItemFormState<ChartDraft, ChartField>;
  sprints: readonly LinkOption[];
  epics: readonly LinkOption[];
}) {
  const { draft, update, errors } = form;
  return (
    <div className="space-y-3">
      <Field label="Chart name" error={errors.title} required>
        {(props) => (
          <Input
            {...props}
            value={draft.title}
            maxLength={TOOL_TEXT_MAX.short}
            onChange={(e) => update({ title: e.target.value })}
          />
        )}
      </Field>
      <Field label="What it covers" hint="Optional: the goal, in a sentence." error={errors.about}>
        {(props) => (
          <Textarea
            {...props}
            rows={2}
            value={draft.about}
            maxLength={TOOL_TEXT_MAX.text}
            onChange={(e) => update({ about: e.target.value })}
          />
        )}
      </Field>
      <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
        <LinkSelect
          label="Sprint"
          value={draft.sprintId}
          options={sprints}
          none="No sprint"
          onChange={(sprintId) => update({ sprintId })}
        />
        <LinkSelect
          label="Epic"
          value={draft.epicId}
          options={epics}
          none="No epic"
          onChange={(epicId) => update({ epicId })}
        />
      </div>
    </div>
  );
}

export function ScopeFields({
  form,
  stories,
  epics,
}: {
  form: ItemFormState<ScopeDraft, ScopeField>;
  stories: readonly LinkOption[];
  epics: readonly LinkOption[];
}) {
  const { draft, update, errors } = form;
  return (
    <div className="space-y-3">
      <div className="grid grid-cols-1 gap-3 sm:grid-cols-[minmax(0,1fr)_8rem]">
        <Field label="Scope" hint="A piece of work, in a few words." error={errors.title} required>
          {(props) => (
            <Input
              {...props}
              value={draft.title}
              maxLength={TOOL_TEXT_MAX.short}
              onChange={(e) => update({ title: e.target.value })}
            />
          )}
        </Field>
        <Field label="Position" hint="0 to 100" error={errors.position} required>
          {(props) => (
            <Input
              {...props}
              inputMode="numeric"
              value={draft.position}
              onChange={(e) => update({ position: e.target.value })}
            />
          )}
        </Field>
      </div>
      <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
        <LinkSelect
          label="Story"
          hint="Its status shows beside the scope."
          value={draft.storyId}
          options={stories}
          none="No story"
          onChange={(storyId) => update({ storyId })}
        />
        <LinkSelect
          label="Epic"
          value={draft.epicId}
          options={epics}
          none="No epic"
          onChange={(epicId) => update({ epicId })}
        />
      </div>
      <Field label="Note" hint="Optional: what is still unknown." error={errors.note}>
        {(props) => (
          <Textarea
            {...props}
            rows={2}
            value={draft.note}
            maxLength={TOOL_TEXT_MAX.capture}
            onChange={(e) => update({ note: e.target.value })}
          />
        )}
      </Field>
    </div>
  );
}
