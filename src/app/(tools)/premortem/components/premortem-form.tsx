"use client";

import { useEffect, useMemo } from "react";
import { Plus } from "lucide-react";
import { ItemForm, useItemForm } from "@/components/shared/item-form";
import { Field } from "@/components/ui/field";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { requiredErrors, type Validation } from "@/lib/utils/form";
import { KIND_LABEL, linkValue, type LinkOption } from "../links";
import type { Premortem, PremortemLink } from "../model";

const SELECT_CLASS =
  "flex h-11 w-full min-w-0 rounded-md border border-input bg-transparent px-3 text-base text-text focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring md:h-9 md:text-sm";

export interface PremortemDraft {
  title: string;
  scenario: string;
  /** "" (Not linked), "release:<id>" or "epic:<id>". */
  link: string;
}

export type PremortemField = keyof PremortemDraft;

export interface PremortemValues {
  title: string;
  scenario: string;
  link?: PremortemLink;
}

export const EMPTY_PREMORTEM_DRAFT: PremortemDraft = { title: "", scenario: "", link: "" };

export const SCENARIO_HINT =
  "Picture the day it is over and it went badly: what does the failure look like?";

/** The draft of an existing premortem, for "Edit details". */
export function draftFrom(p: Premortem): PremortemDraft {
  return { title: p.title, scenario: p.scenario, link: linkValue(p.link) };
}

/**
 * Check a draft. The name and the imagined failure are required (a
 * premortem with no failure to imagine is a brainstorm); the link is
 * optional, and "Not linked" is an explicit choice in the list. `current`
 * is the premortem's own link, kept even when its release or epic is gone.
 */
export function validatePremortem(
  d: PremortemDraft,
  options: readonly LinkOption[],
  current?: PremortemLink
): Validation<PremortemValues, PremortemField> {
  const errors = requiredErrors<PremortemField>(d, {
    title: "Name the premortem, e.g. the release or project it is for.",
    scenario: "Describe the failure you imagine.",
  });
  let link: PremortemLink | undefined;
  if (d.link) {
    const picked = options.find((o) => linkValue(o) === d.link);
    if (picked) link = { kind: picked.kind, id: picked.id, name: picked.name };
    else if (current && linkValue(current) === d.link) link = current;
    else errors.link = "That release or epic is gone. Pick another, or Not linked.";
  }
  if (Object.keys(errors).length > 0) return { ok: false, errors };
  return { ok: true, values: { title: d.title.trim(), scenario: d.scenario.trim(), link } };
}

/**
 * New premortem, or Edit details of one: its name, the imagined failure,
 * and what it is about. Nothing is saved until the name and the failure
 * are written; Enter in the name saves.
 */
export function PremortemForm({
  options,
  premortem,
  onSave,
  onCancel,
  autoFocus = false,
}: {
  options: readonly LinkOption[];
  /** The premortem being edited; absent for a new one. */
  premortem?: Premortem;
  onSave: (values: PremortemValues) => void;
  onCancel?: () => void;
  /**
   * Focus the name when the form opens. Always so when editing; for a new
   * premortem only when a button opened the form (that button is gone
   * now), not on the first visit, where the page itself is what to read.
   */
  autoFocus?: boolean;
}) {
  const current = premortem?.link;
  const form = useItemForm<PremortemDraft, PremortemValues, PremortemField>({
    initial: () => (premortem ? draftFrom(premortem) : EMPTY_PREMORTEM_DRAFT),
    validate: (d) => validatePremortem(d, options, current),
    onSave,
    resetOnSave: !premortem,
  });
  const { formRef } = form;
  const focusOnOpen = premortem !== undefined || autoFocus;
  // The form opens on the name, where the keyboard user was heading.
  useEffect(() => {
    if (focusOnOpen) formRef.current?.querySelector<HTMLElement>("input")?.focus();
  }, [focusOnOpen, formRef]);

  const releases = options.filter((o) => o.kind === "release");
  const epics = options.filter((o) => o.kind === "epic");
  // The premortem's own link stays on offer when its target is gone.
  const orphan = useMemo(
    () =>
      current && !options.some((o) => linkValue(o) === linkValue(current)) ? current : undefined,
    [current, options]
  );

  return (
    <ItemForm
      form={form}
      submitLabel={premortem ? "Save details" : "Start premortem"}
      submitIcon={premortem ? undefined : <Plus className="h-4 w-4" aria-hidden="true" />}
      onCancel={onCancel}
    >
      <div className="grid grid-cols-1 gap-3 md:grid-cols-2">
        <Field label="Name" error={form.errors.title} required>
          {(props) => (
            <Input
              {...props}
              value={form.draft.title}
              maxLength={120}
              onChange={(e) => form.update({ title: e.target.value })}
              placeholder="e.g. Mobile checkout launch"
            />
          )}
        </Field>
        <Field
          label="For"
          hint={
            options.length === 0 && !orphan
              ? "Add releases in Release Readiness or epics on the Epic Roadmap to link one."
              : "Optional: the release or epic this premortem is about."
          }
          error={form.errors.link}
        >
          {(props) => (
            <select
              {...props}
              className={SELECT_CLASS}
              value={form.draft.link}
              onChange={(e) => form.update({ link: e.target.value })}
            >
              <option value="">Not linked</option>
              {orphan && (
                <option value={linkValue(orphan)}>
                  {`${KIND_LABEL[orphan.kind]}: ${orphan.name} (removed)`}
                </option>
              )}
              {releases.length > 0 && (
                <optgroup label="Releases">
                  {releases.map((o) => (
                    <option key={linkValue(o)} value={linkValue(o)}>
                      {o.detail ? `${o.name} (${o.detail})` : o.name}
                    </option>
                  ))}
                </optgroup>
              )}
              {epics.length > 0 && (
                <optgroup label="Epics">
                  {epics.map((o) => (
                    <option key={linkValue(o)} value={linkValue(o)}>
                      {o.detail ? `${o.name} (${o.detail})` : o.name}
                    </option>
                  ))}
                </optgroup>
              )}
            </select>
          )}
        </Field>
      </div>
      <Field label="Imagined failure" hint={SCENARIO_HINT} error={form.errors.scenario} required>
        {(props) => (
          <Textarea
            {...props}
            rows={3}
            value={form.draft.scenario}
            maxLength={2000}
            onChange={(e) => form.update({ scenario: e.target.value })}
            placeholder="It's six months from now. It shipped, and it is widely seen as a failure: conversion fell and support is flooded…"
          />
        )}
      </Field>
    </ItemForm>
  );
}
