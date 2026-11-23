"use client";

import { useEffect, useRef, useState, type FormEvent } from "react";
import { Button } from "@/components/ui/button";
import { Field } from "@/components/ui/field";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { TEAM_TIME_MAX, TOOL_TEXT_MAX, type TeamTimePerson } from "@/lib/stores/workspace-types";
import {
  validatePerson,
  type PersonDraft,
  type PersonField,
  type PersonValues,
} from "@/lib/team-time/validate";
import type { FormErrors } from "@/lib/utils/form";
import { DayPicker, ZonePicker } from "./fields";

/** A blank person for the form, for a roster member (`name`, `teamMemberId`) or a guest. */
export function blankDraft(over: Partial<PersonDraft> = {}): PersonDraft {
  return {
    name: "",
    timeZone: "",
    start: "09:00",
    end: "17:00",
    workingDays: [1, 2, 3, 4, 5],
    officeDays: [],
    site: "",
    note: "",
    ...over,
  };
}

/** A saved person as the form holds it. */
export function draftOf(p: TeamTimePerson): PersonDraft {
  return {
    name: p.name,
    ...(p.teamMemberId ? { teamMemberId: p.teamMemberId } : {}),
    timeZone: p.timeZone,
    start: p.start,
    end: p.end,
    workingDays: p.workingDays,
    officeDays: p.officeDays ?? [],
    site: p.site ?? "",
    note: p.note ?? "",
  };
}

/**
 * One person's zone, hours and days. Nothing is saved until it checks out
 * (`validatePerson`, the same rules as Amr's set_person); after a failed
 * save the first field with a problem gets focus.
 */
export function PersonForm({
  initial,
  others,
  nameLocked,
  submitLabel,
  now,
  onSave,
  onCancel,
}: {
  initial: PersonDraft;
  /** The rows already saved, this one left out (one row per person). */
  others: readonly TeamTimePerson[];
  /** A roster member's name comes from the roster. */
  nameLocked?: boolean;
  submitLabel: string;
  now: Date;
  onSave: (values: PersonValues) => void;
  onCancel: () => void;
}) {
  const [draft, setDraft] = useState<PersonDraft>(initial);
  const [errors, setErrors] = useState<FormErrors<PersonField>>({});
  const [tries, setTries] = useState(0);
  const formRef = useRef<HTMLFormElement>(null);
  const set = <K extends keyof PersonDraft>(key: K, value: PersonDraft[K]) =>
    setDraft((d) => ({ ...d, [key]: value }));

  useEffect(() => {
    if (tries === 0) return;
    formRef.current?.querySelector<HTMLElement>('[aria-invalid="true"]')?.focus();
  }, [tries]);

  const submit = (e: FormEvent) => {
    e.preventDefault();
    const checked = validatePerson(draft, others);
    if (!checked.ok) {
      setErrors(checked.errors);
      setTries((n) => n + 1);
      return;
    }
    setErrors({});
    onSave(checked.values);
  };

  return (
    <form ref={formRef} onSubmit={submit} noValidate className="space-y-3" aria-label="Person">
      <div className="grid gap-3 sm:grid-cols-2">
        <Field label="Name" error={errors.name} required>
          {(control) => (
            <Input
              {...control}
              value={draft.name}
              maxLength={TOOL_TEXT_MAX.short}
              readOnly={nameLocked}
              onChange={(e) => set("name", e.target.value)}
            />
          )}
        </Field>
        <Field
          label="Time zone"
          error={errors.timeZone}
          required
          hint="Their own zone, picked from the list"
        >
          {(control) => (
            <ZonePicker
              control={control}
              value={draft.timeZone}
              now={now}
              onChange={(zone) => set("timeZone", zone)}
            />
          )}
        </Field>
        <Field label="Day starts" error={errors.start} hint="On their own clock">
          {(control) => (
            <Input
              {...control}
              type="time"
              value={draft.start}
              onChange={(e) => set("start", e.target.value)}
            />
          )}
        </Field>
        <Field label="Day ends" error={errors.end} hint="Earlier than the start: a night shift">
          {(control) => (
            <Input
              {...control}
              type="time"
              value={draft.end}
              onChange={(e) => set("end", e.target.value)}
            />
          )}
        </Field>
      </div>
      <DayPicker
        legend="Working days"
        value={draft.workingDays}
        error={errors.workingDays}
        onChange={(days) =>
          setDraft((d) => ({
            ...d,
            workingDays: days,
            officeDays: d.officeDays.filter((x) => days.includes(x)),
          }))
        }
      />
      <DayPicker
        legend="Office days"
        hint="Leave empty for someone who works remotely."
        value={draft.officeDays}
        allowed={draft.workingDays}
        error={errors.officeDays}
        onChange={(days) => set("officeDays", days)}
      />
      <div className="grid gap-3 sm:grid-cols-2">
        <Field
          label="Office"
          hint="Such as London office; people in one office share office days"
          error={errors.site}
        >
          {(control) => (
            <Input
              {...control}
              value={draft.site}
              maxLength={TEAM_TIME_MAX.site}
              onChange={(e) => set("site", e.target.value)}
            />
          )}
        </Field>
        <Field label="Note" error={errors.note}>
          {(control) => (
            <Textarea
              {...control}
              rows={2}
              value={draft.note}
              maxLength={TOOL_TEXT_MAX.text}
              onChange={(e) => set("note", e.target.value)}
            />
          )}
        </Field>
      </div>
      <div className="flex flex-wrap gap-2">
        <Button type="submit" size="sm">
          {submitLabel}
        </Button>
        <Button type="button" size="sm" variant="ghost" onClick={onCancel}>
          Cancel
        </Button>
      </div>
    </form>
  );
}
