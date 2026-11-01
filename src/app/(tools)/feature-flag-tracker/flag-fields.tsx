"use client";

/**
 * A flag's fields, shared by the add form and the editor: its name, what
 * it's for (unset until picked; it decides when the flag goes stale), its
 * owner from the team roster, environment, the day it was created
 * (backdatable), the day the team plans to remove it (with the purpose's
 * typical lifetime as a hint, never filled in), the release it ships
 * behind, a description, and the retired day on a retired flag.
 */

import { useEffect, useId, useRef } from "react";
import type { ItemFormState } from "@/components/shared/item-form";
import { PersonPicker } from "@/components/team/person-picker";
import { Field } from "@/components/ui/field";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { ToggleGroup, type ToggleOption } from "@/components/ui/toggle-group";
import type { FeatureFlagEnv, FeatureFlagPurpose } from "@/lib/stores/workspace-types";
import {
  ENV_LABEL,
  FLAG_ENVIRONMENTS,
  FLAG_PURPOSES,
  PURPOSE_HINT,
  PURPOSE_LABEL,
  TYPICAL_LIFETIME_DAYS,
} from "@/lib/flags/model";
import { addDays } from "@/lib/flow/days";
import type { FlagDraft, FlagField, ReleaseOption } from "./form";
import { dayLabel } from "./text";

/** Matches <Input>: 44 px on phones, 36 px from md. */
const SELECT_CLASS =
  "flex h-11 md:h-9 w-full rounded-md border border-input bg-background px-3 py-1 text-base md:text-sm text-text shadow-sm focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring";

const PURPOSE_OPTIONS: ToggleOption<FeatureFlagPurpose>[] = FLAG_PURPOSES.map((p) => ({
  value: p,
  label: PURPOSE_LABEL[p],
  description: PURPOSE_HINT[p],
}));

/** The removal-date hint for a purpose. */
function removeByHint(purpose: FeatureFlagPurpose | null, createdAt: string): string {
  if (!purpose) return "Optional. Pick a purpose to see how long such flags usually live.";
  const days = TYPICAL_LIFETIME_DAYS[purpose];
  if (purpose === "kill_switch") return "Optional. Kill switches can stay: they're never stale.";
  if (days === null) return "Optional. A permission flag goes stale only once this day passes.";
  const due = addDays(createdAt, days);
  const typical = due ? ` (${dayLabel(due)} for this one)` : "";
  return `Optional. ${PURPOSE_LABEL[purpose]}s usually go within ${days} days${typical}; without a date it goes stale after that.`;
}

export function FlagFields({
  form,
  today,
  releases,
  retired = false,
  offerAddToRoster = true,
  label,
}: {
  form: ItemFormState<FlagDraft, FlagField>;
  today: string;
  releases: readonly ReleaseOption[];
  /** Show the retired day (the editor of a retired flag). */
  retired?: boolean;
  offerAddToRoster?: boolean;
  /** Names the group of fields, e.g. "Edit checkout_v2". */
  label?: string;
}) {
  const { draft, update, errors } = form;
  const purposeErrorId = useId();
  const purposeRef = useRef<HTMLDivElement>(null);
  // Mark the purpose group required and link its message, as Field does
  // for inputs. ToggleGroup takes no ARIA props, so they're set on its
  // radio group here. Not aria-invalid: focusFirstInvalid would then pick
  // the group, which can't take focus, rather than its radio.
  useEffect(() => {
    const group = purposeRef.current?.querySelector('[role="radiogroup"]');
    if (!group) return;
    group.setAttribute("aria-required", "true");
    if (errors.purpose) group.setAttribute("aria-describedby", purposeErrorId);
    else group.removeAttribute("aria-describedby");
  }, [errors.purpose, purposeErrorId]);
  const linked = draft.releaseId && !releases.some((r) => r.id === draft.releaseId);

  return (
    <div role="group" aria-label={label} className="grid grid-cols-1 gap-3 sm:grid-cols-2">
      <Field label="Name" error={errors.name} required className="sm:col-span-2">
        {(props) => (
          <Input
            {...props}
            className="font-data"
            value={draft.name}
            onChange={(e) => update({ name: e.target.value })}
            placeholder="e.g. checkout_v2_rollout"
          />
        )}
      </Field>

      <div
        ref={purposeRef}
        className="flex flex-col gap-1.5 sm:col-span-2"
        // focusFirstInvalid looks for this marker to focus the checked (or first) radio.
        data-scale-invalid={errors.purpose ? "true" : undefined}
      >
        <span className="text-sm text-text" aria-hidden="true">
          Purpose
          <span className="ml-0.5 text-danger">*</span>
        </span>
        <ToggleGroup
          label="Purpose"
          size="sm"
          options={PURPOSE_OPTIONS}
          value={draft.purpose}
          onValueChange={(purpose) => update({ purpose })}
        />
        <p className="text-xs text-sub">
          {draft.purpose ? PURPOSE_HINT[draft.purpose] : "What is the flag for?"}
        </p>
        {errors.purpose && (
          <p id={purposeErrorId} className="text-xs text-danger" role="alert">
            {errors.purpose}
          </p>
        )}
      </div>

      <PersonPicker
        label="Owner"
        value={draft.owner}
        onChange={(owner) => update({ owner })}
        error={errors.owner}
        placeholder="Who removes it"
        offerAddToRoster={offerAddToRoster}
      />
      <Field label="Environment">
        {(props) => (
          <select
            {...props}
            className={SELECT_CLASS}
            value={draft.environment}
            onChange={(e) => update({ environment: e.target.value as FeatureFlagEnv | "" })}
          >
            <option value="">Not set</option>
            {FLAG_ENVIRONMENTS.map((env) => (
              <option key={env} value={env}>
                {ENV_LABEL[env]}
              </option>
            ))}
          </select>
        )}
      </Field>

      <Field
        label="Created on"
        error={errors.createdAt}
        required
        hint="Backdate it for a flag that's been in the code a while."
      >
        {(props) => (
          <Input
            {...props}
            type="date"
            max={today}
            value={draft.createdAt}
            onChange={(e) => update({ createdAt: e.target.value })}
          />
        )}
      </Field>
      <Field
        label="Planned removal"
        error={errors.removeBy}
        hint={removeByHint(draft.purpose, draft.createdAt)}
      >
        {(props) => (
          <Input
            {...props}
            type="date"
            min={draft.createdAt || undefined}
            value={draft.removeBy}
            onChange={(e) => update({ removeBy: e.target.value })}
          />
        )}
      </Field>

      {retired && (
        <Field label="Retired on" error={errors.retiredAt} required>
          {(props) => (
            <Input
              {...props}
              type="date"
              min={draft.createdAt || undefined}
              max={today}
              value={draft.retiredAt}
              onChange={(e) => update({ retiredAt: e.target.value })}
            />
          )}
        </Field>
      )}

      <Field
        label="Ships with"
        hint="The Release Readiness release it ships behind: its Feature flag ready gate checks this flag."
      >
        {(props) => (
          <select
            {...props}
            className={SELECT_CLASS}
            value={draft.releaseId}
            onChange={(e) => update({ releaseId: e.target.value })}
          >
            <option value="">Not linked</option>
            {releases.map((r) => (
              <option key={r.id} value={r.id}>
                {r.label}
              </option>
            ))}
            {linked && <option value={draft.releaseId}>A release no longer listed</option>}
          </select>
        )}
      </Field>

      <Field label="Description" error={errors.description} className="sm:col-span-2">
        {(props) => (
          <Textarea
            {...props}
            rows={2}
            className="resize-none text-sm"
            value={draft.description}
            onChange={(e) => update({ description: e.target.value })}
            placeholder="What it gates, and how to remove it"
          />
        )}
      </Field>
    </div>
  );
}
