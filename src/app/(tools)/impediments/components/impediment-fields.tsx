"use client";

/**
 * The fields of an impediment, shared by the log form and the editor:
 * title, severity (unset until picked), optional category, description,
 * who raised it and who owns it (from the team roster), the raised day
 * (backdatable), a due date, and the resolved day on a resolved one.
 */

import { useEffect, useId, useRef } from "react";
import { CalendarPlus } from "lucide-react";
import type { ItemFormState } from "@/components/shared/item-form";
import { PersonPicker } from "@/components/team/person-picker";
import { Button } from "@/components/ui/button";
import { Field } from "@/components/ui/field";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { ToggleGroup, type ToggleOption } from "@/components/ui/toggle-group";
import type { ImpedimentCategory, ImpedimentSeverity } from "@/lib/stores/workspace-types";
import {
  IMPEDIMENT_CATEGORIES,
  IMPEDIMENT_CATEGORY_LABEL,
  IMPEDIMENT_SEVERITIES,
  IMPEDIMENT_SEVERITY_LABEL,
  addDays,
  dayOf,
} from "@/lib/impediments/model";
import { NAME_MAX, TEXT_MAX, TITLE_MAX } from "../constants";
import { dayLabel, daysText } from "../helpers";
import { earliestDay, type ImpedimentDraft, type ImpedimentField } from "../form";

/** Matches <Input>: 44 px / 16 px on touch, 36 px / 14 px for a mouse at md+. */
const SELECT_CLASS =
  "flex h-11 pointer-fine:md:h-9 w-full rounded-md border border-input bg-background px-3 py-1 text-base pointer-fine:md:text-sm text-text shadow-sm focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring";

/** The same meanings as the tool's guide (lib/tools/guides/ceremonies.ts). */
const SEVERITY_MEANING: Record<ImpedimentSeverity, string> = {
  low: "A nuisance; work carries on",
  medium: "Slows the team down",
  high: "Blocks a story or a person",
  critical: "Blocks the sprint goal or a release",
};

const SEVERITY_OPTIONS: ToggleOption<ImpedimentSeverity>[] = IMPEDIMENT_SEVERITIES.map((s) => ({
  value: s,
  label: IMPEDIMENT_SEVERITY_LABEL[s],
  description: SEVERITY_MEANING[s],
}));

export type ImpedimentFormState = ItemFormState<ImpedimentDraft, ImpedimentField>;

export function ImpedimentFields({
  form,
  today,
  resolved = false,
  typicalDays = null,
}: {
  form: ImpedimentFormState;
  today: string;
  /** Show the resolved day (the editor of a resolved impediment). */
  resolved?: boolean;
  /** The team's average days to resolve, offered as a due date. Null hides it. */
  typicalDays?: number | null;
}) {
  const { draft, update, errors } = form;
  const raised = dayOf(draft.raisedAt);
  // Nothing is due or resolved before it was raised (or before today, when
  // an agent's UTC stamp reads as tomorrow here).
  const floor = earliestDay(draft.raisedAt, today) ?? undefined;
  const suggested = typicalDays !== null && raised ? addDays(raised, typicalDays) : null;
  const severityErrorId = useId();
  const severityRef = useRef<HTMLDivElement>(null);
  // Mark the severity group required and link its message, as Field does
  // for the inputs. ToggleGroup takes no ARIA props, so set them on its
  // radio group here; React leaves attributes it doesn't render alone. Not
  // aria-invalid: focusFirstInvalid would then pick the group itself, which
  // can't take focus, instead of its radio.
  useEffect(() => {
    const group = severityRef.current?.querySelector('[role="radiogroup"]');
    if (!group) return;
    group.setAttribute("aria-required", "true");
    if (errors.severity) group.setAttribute("aria-describedby", severityErrorId);
    else group.removeAttribute("aria-describedby");
  }, [errors.severity, severityErrorId]);

  return (
    <>
      <Field label="Impediment" error={errors.title} required>
        {(props) => (
          <Input
            {...props}
            maxLength={TITLE_MAX}
            value={draft.title}
            onChange={(e) => update({ title: e.target.value })}
            placeholder="What is in the team's way?"
          />
        )}
      </Field>

      <div
        ref={severityRef}
        className="flex min-w-0 flex-col gap-1.5"
        data-scale-invalid={errors.severity ? "true" : undefined}
      >
        {/* The radio group carries the same name; this is the visible label. */}
        <span className="text-sm text-text" aria-hidden="true">
          Severity<span className="ml-0.5 text-danger">*</span>
        </span>
        <ToggleGroup
          label="Severity"
          size="sm"
          options={SEVERITY_OPTIONS}
          value={draft.severity}
          onValueChange={(severity) => update({ severity })}
        />
        <p className="text-xs text-sub">
          {draft.severity
            ? SEVERITY_MEANING[draft.severity]
            : "Low: a nuisance · Medium: slows the team down · High: blocks a story or a person · Critical: blocks the sprint goal or a release."}
        </p>
        {errors.severity && (
          <p id={severityErrorId} className="text-xs text-danger" role="alert">
            {errors.severity}
          </p>
        )}
      </div>

      <Field label="Description" hint="Optional. What it blocks and since when.">
        {(props) => (
          <Textarea
            {...props}
            rows={2}
            maxLength={TEXT_MAX}
            value={draft.description}
            onChange={(e) => update({ description: e.target.value })}
            className="resize-none"
          />
        )}
      </Field>

      <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
        <Field label="Category" hint="Optional.">
          {(props) => (
            <select
              {...props}
              className={SELECT_CLASS}
              value={draft.category}
              onChange={(e) => update({ category: e.target.value as ImpedimentCategory | "" })}
            >
              <option value="">No category</option>
              {IMPEDIMENT_CATEGORIES.map((c) => (
                <option key={c} value={c}>
                  {IMPEDIMENT_CATEGORY_LABEL[c]}
                </option>
              ))}
            </select>
          )}
        </Field>
        <PersonPicker
          label="Owner"
          hint="Who is removing it. Optional."
          value={draft.owner}
          onChange={(owner) => update({ owner: owner.slice(0, NAME_MAX) })}
        />
        <PersonPicker
          label="Raised by"
          hint="Optional."
          value={draft.raisedBy}
          onChange={(raisedBy) => update({ raisedBy: raisedBy.slice(0, NAME_MAX) })}
        />
        <Field
          label="Raised on"
          hint="Move it back if it started before today."
          error={errors.raisedAt}
          required
        >
          {(props) => (
            <Input
              {...props}
              type="date"
              max={today}
              value={draft.raisedAt}
              onChange={(e) => update({ raisedAt: e.target.value })}
            />
          )}
        </Field>
        <div className="flex min-w-0 flex-col gap-1">
          <Field
            label="Due by"
            hint="Optional. Past this day it shows as overdue."
            error={errors.dueDate}
          >
            {(props) => (
              <Input
                {...props}
                type="date"
                min={floor}
                value={draft.dueDate}
                onChange={(e) => update({ dueDate: e.target.value })}
              />
            )}
          </Field>
          {suggested && typicalDays !== null && draft.dueDate !== suggested && (
            <Button
              type="button"
              variant="ghost"
              size="sm"
              className="min-touch-coarse self-start gap-1 px-1 text-xs text-accent hover:bg-accent/10"
              onClick={() => update({ dueDate: suggested })}
            >
              <CalendarPlus className="h-3.5 w-3.5" aria-hidden="true" />
              Due {dayLabel(suggested)}: your average of {daysText(typicalDays)}
            </Button>
          )}
        </div>
        {resolved && (
          <Field label="Resolved on" error={errors.resolvedAt} required>
            {(props) => (
              <Input
                {...props}
                type="date"
                min={floor}
                max={today}
                value={draft.resolvedAt}
                onChange={(e) => update({ resolvedAt: e.target.value })}
              />
            )}
          </Field>
        )}
      </div>
    </>
  );
}
