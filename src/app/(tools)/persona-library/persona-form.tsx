"use client";

import { useState } from "react";
import { AiButton } from "@/components/ai";
import { ItemForm, type ItemFormState } from "@/components/shared/item-form";
import { Field } from "@/components/ui/field";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { ToggleGroup } from "@/components/ui/toggle-group";
import {
  personaFromNotesTask,
  PERSONA_NOTES_MAX,
  PERSONA_NOTES_MIN,
  type PersonaFromNotesInput,
  type PersonaFromNotesOutput,
} from "@/lib/ai/tasks/persona-library.lite";
import type { AiSource } from "@/lib/ai/task-types";
import { interviewNotes } from "@/lib/personas/interviews";
import {
  EVIDENCE_LABEL,
  PERSONA_CONTEXT_MAX,
  PERSONA_INTERVIEWS_MAX,
  PERSONA_LISTS,
  PERSONA_NAME_MAX,
  PERSONA_QUOTE_MAX,
  PERSONA_ROLE_MAX,
  PERSONA_SUMMARY_MAX,
  TIER_LABEL,
  type PersonaList,
} from "@/lib/personas/model";
import {
  PERSONA_EVIDENCE,
  PERSONA_TIERS,
  type Interview,
  type PersonaEvidence,
  type PersonaTier,
} from "@/lib/stores/workspace-types";
import { redactPii } from "@/lib/utils/redact-pii";
import { cn } from "@/lib/utils";
import type { PersonaField, PersonaFields } from "./form";
import { PointsField } from "./points-field";

/** Decision D4's lines beside the two draft buttons, and the form's name hint, word for word. */
export const NOTES_AI_LINE =
  "Names and contact details aren't all caught. Take them out before you ask Amr.";
export const INTERVIEWS_AI_LINE =
  "Participant names become Participant 1, 2… Other names in quotes aren't caught, so check before you ask Amr.";
export const NAME_HINT = "Use a made-up name. Don't describe a real person.";

/** Notes as they go to Amr or the rules: contact details taken out, then capped. */
export const draftableNotes = (text: string) =>
  redactPii(text).trim().slice(0, PERSONA_NOTES_MAX).trim();

const n = (x: number) => x.toLocaleString("en-GB");
const day = (iso: string) => (iso ?? "").slice(0, 10);

export interface PersonaFormProps {
  form: ItemFormState<PersonaFields, PersonaField>;
  submitLabel: string;
  onCancel?: () => void;
  /** Another persona already has the name typed. */
  duplicateName?: string;
  /** The User Interview Log's interviews, to link and draft from. */
  interviews: readonly Interview[];
  /** Names in the library, which a draft avoids. */
  names: readonly string[];
  draftedBy: AiSource | null;
  /** Adding a persona for an Impact Map actor (`?fromMap=&actor=`). */
  forActor: { actor: string; map: string } | null;
  onDraft: (data: PersonaFromNotesOutput, source: AiSource, interviewIds: string[]) => void;
  onAddPoint: (list: PersonaList, point: string) => string | null;
  onRemovePoint: (list: PersonaList, index: number) => void;
}

/**
 * The add and edit form: drafting from notes (folded away until opened),
 * the persona's fields and lists, and the interviews it comes from, which
 * can also be drafted from. A draft only fills the form; nothing is saved
 * until Save.
 */
export function PersonaForm({
  form,
  submitLabel,
  onCancel,
  duplicateName,
  interviews,
  names,
  draftedBy,
  forActor,
  onDraft,
  onAddPoint,
  onRemovePoint,
}: PersonaFormProps) {
  const { draft, update, errors } = form;
  const [notes, setNotes] = useState("");
  const aiNames = names.slice(0, 30).map((x) => x.slice(0, 200));
  const notesText = draftableNotes(notes);
  const picked = interviews.filter((i) => draft.interviewIds.includes(i.id));
  const pickedText = interviewNotes(picked);
  const atMost = draft.interviewIds.length >= PERSONA_INTERVIEWS_MAX;

  const notesInput = (): PersonaFromNotesInput => ({
    notes: notesText,
    tier: draft.tier,
    names: aiNames,
  });
  const interviewsInput = (): PersonaFromNotesInput => ({
    notes: pickedText,
    tier: draft.tier,
    names: aiNames,
  });
  const toggleInterview = (id: string, on: boolean) =>
    update({
      interviewIds: on
        ? Array.from(new Set([...draft.interviewIds, id])).slice(0, PERSONA_INTERVIEWS_MAX)
        : draft.interviewIds.filter((x) => x !== id),
    });

  return (
    <div className="space-y-4" data-persona-form>
      {forActor && (
        <p className="rounded-md border border-border bg-surface-deep px-3 py-2 text-sm text-text">
          A persona for the actor “{forActor.actor}” on “{forActor.map}”. Its role starts as the
          actor&rsquo;s words.
        </p>
      )}

      <details className="rounded-md border border-border px-3 py-2">
        <summary className="min-h-11 cursor-pointer py-2 text-sm font-medium text-text">
          Draft from notes
        </summary>
        <div className="space-y-2 pb-2">
          <Field
            label="Research notes"
            hint={
              <span className={cn(notes.length >= PERSONA_NOTES_MAX && "text-warning")}>
                {n(notes.length)} of {n(PERSONA_NOTES_MAX)} characters. Contact details are taken
                out before anything is read.
              </span>
            }
          >
            {(p) => (
              <Textarea
                {...p}
                rows={5}
                value={notes}
                maxLength={PERSONA_NOTES_MAX}
                onChange={(e) => setNotes(e.target.value)}
              />
            )}
          </Field>
          <div className="space-y-1">
            <AiButton
              task={personaFromNotesTask}
              input={notesInput}
              onResult={(data, meta) => onDraft(data, meta.source, [])}
              label="Ask Amr to draft a persona"
              fallbackLabel="Draft without AI"
              disabledReason={
                notesText.length < PERSONA_NOTES_MIN
                  ? `Paste at least ${PERSONA_NOTES_MIN} characters of notes first.`
                  : null
              }
            />
            <p className="text-xs text-sub">{NOTES_AI_LINE}</p>
          </div>
        </div>
      </details>

      <ItemForm form={form} submitLabel={submitLabel} onCancel={onCancel}>
        {draftedBy && (
          <p role="status" className="rounded-md bg-accent/10 px-3 py-2 text-sm text-text">
            {draftedBy === "ai" ? "Drafted by Amr." : "Drafted without AI."} Check every line and
            change what isn&rsquo;t right: nothing is saved until you press {submitLabel}.
          </p>
        )}
        <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
          <Field
            label="Name"
            required
            error={errors.name}
            hint={
              <>
                {NAME_HINT}
                {duplicateName && (
                  <span className="mt-1 block text-warning">
                    Another persona is already called “{duplicateName}”. Pick another name so the
                    two are easy to tell apart.
                  </span>
                )}
              </>
            }
          >
            {(p) => (
              <Input
                {...p}
                value={draft.name}
                maxLength={PERSONA_NAME_MAX}
                onChange={(e) => update({ name: e.target.value })}
              />
            )}
          </Field>
          <Field label="Role" required error={errors.role} hint="What they do, in a few words.">
            {(p) => (
              <Input
                {...p}
                value={draft.role}
                maxLength={PERSONA_ROLE_MAX}
                onChange={(e) => update({ role: e.target.value })}
              />
            )}
          </Field>
        </div>

        <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
          <div className="min-w-0 space-y-1.5">
            <p className="text-sm text-text" aria-hidden="true">
              Tier
            </p>
            <ToggleGroup<PersonaTier>
              label="Tier"
              size="sm"
              value={draft.tier}
              onValueChange={(tier) => update({ tier })}
              options={PERSONA_TIERS.map((t) => ({ value: t, label: TIER_LABEL[t] }))}
            />
          </div>
          <div className="min-w-0 space-y-1.5">
            <p className="text-sm text-text" aria-hidden="true">
              Evidence
            </p>
            <ToggleGroup<PersonaEvidence>
              label="Evidence"
              size="sm"
              value={draft.evidence}
              onValueChange={(evidence) => update({ evidence })}
              options={PERSONA_EVIDENCE.map((x) => ({ value: x, label: EVIDENCE_LABEL[x] }))}
            />
          </div>
        </div>

        <Field label="Summary" error={errors.summary} hint="One or two sentences about them.">
          {(p) => (
            <Textarea
              {...p}
              rows={2}
              value={draft.summary}
              maxLength={PERSONA_SUMMARY_MAX}
              onChange={(e) => update({ summary: e.target.value })}
            />
          )}
        </Field>

        <div className="grid grid-cols-1 gap-4 md:grid-cols-3">
          {PERSONA_LISTS.map((list) => (
            <PointsField
              key={list}
              list={list}
              items={draft[list]}
              error={errors[list]}
              onAdd={(point) => onAddPoint(list, point)}
              onRemove={(i) => onRemovePoint(list, i)}
            />
          ))}
        </div>

        <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
          <Field label="Quote" error={errors.quote} hint="A line in their voice, paraphrased.">
            {(p) => (
              <Input
                {...p}
                value={draft.quote}
                maxLength={PERSONA_QUOTE_MAX}
                onChange={(e) => update({ quote: e.target.value })}
              />
            )}
          </Field>
          <Field label="Tags" error={errors.tags} hint="Separate them with commas.">
            {(p) => (
              <Input {...p} value={draft.tags} onChange={(e) => update({ tags: e.target.value })} />
            )}
          </Field>
        </div>
        <Field label="Context" error={errors.context} hint="Where and when they meet the product.">
          {(p) => (
            <Textarea
              {...p}
              rows={2}
              value={draft.context}
              maxLength={PERSONA_CONTEXT_MAX}
              onChange={(e) => update({ context: e.target.value })}
            />
          )}
        </Field>

        {interviews.length > 0 && (
          <fieldset className="min-w-0 space-y-2 rounded-md border border-border px-3 py-2">
            <legend className="px-1 text-sm text-text">Interviews it comes from</legend>
            <p className="text-xs text-sub">
              From the User Interviews log. Tick up to {PERSONA_INTERVIEWS_MAX}.
            </p>
            <ul className="max-h-64 space-y-1 overflow-y-auto">
              {interviews.map((i) => {
                const checked = draft.interviewIds.includes(i.id);
                return (
                  <li key={i.id}>
                    <label className="flex min-h-11 cursor-pointer items-center gap-2 text-sm text-text">
                      <input
                        type="checkbox"
                        className="h-4 w-4 shrink-0"
                        checked={checked}
                        disabled={!checked && atMost}
                        onChange={(e) => toggleInterview(i.id, e.target.checked)}
                      />
                      <span className="min-w-0 break-words">
                        {i.participant?.trim() || "No name"} · {day(i.date)} ·{" "}
                        {i.quotes?.length === 1 ? "1 quote" : `${i.quotes?.length ?? 0} quotes`}
                      </span>
                    </label>
                  </li>
                );
              })}
            </ul>
            {errors.interviewIds && (
              <p className="text-xs text-danger" role="alert">
                {errors.interviewIds}
              </p>
            )}
            <div className="space-y-1">
              <AiButton
                task={personaFromNotesTask}
                input={interviewsInput}
                onResult={(data, meta) =>
                  onDraft(
                    data,
                    meta.source,
                    picked.map((i) => i.id)
                  )
                }
                label="Ask Amr to draft from these interviews"
                fallbackLabel="Draft from the interviews without AI"
                disabledReason={
                  picked.length === 0
                    ? "Tick the interviews to draft from first."
                    : pickedText.length < PERSONA_NOTES_MIN
                      ? "Those interviews hold too little text to draft from."
                      : null
                }
              />
              <p className="text-xs text-sub">{INTERVIEWS_AI_LINE}</p>
            </div>
          </fieldset>
        )}
      </ItemForm>
    </div>
  );
}
