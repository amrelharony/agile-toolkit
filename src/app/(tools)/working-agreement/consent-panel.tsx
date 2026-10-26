"use client";

import { Plus } from "lucide-react";
import { Field } from "@/components/ui/field";
import { Input } from "@/components/ui/input";
import { ToggleGroup, type ToggleOption } from "@/components/ui/toggle-group";
import { BlurInput } from "@/components/shared/blur-fields";
import { ItemForm, useItemForm } from "@/components/shared/item-form";
import { PersonPicker } from "@/components/team/person-picker";
import type { CharterConsent, CharterConsentVote, CharterRule } from "@/lib/stores/workspace-types";
import { findRosterMember, nameKey } from "@/lib/team/names";
import { CONSENT_NOTE_MAX, consentEntries } from "@/lib/working-agreement/model";
import {
  EMPTY_CONSENT,
  validateConsent,
  type ConsentDraft,
  type ConsentField,
  type ConsentValues,
} from "./form";

type VoteChoice = CharterConsentVote | "none";

const VOTE_OPTIONS: ToggleOption<VoteChoice>[] = [
  { value: "none", label: "No answer", description: "Not asked yet, or no answer given" },
  { value: "consent", label: "Consent", description: "Agrees to work by this rule" },
  {
    value: "concern",
    label: "Concern",
    description: "Can live with it, with a reservation worth hearing",
  },
  { value: "object", label: "Object", description: "Can't work by it as written" },
];

/** The answer options for someone not yet answering (no "No answer"). */
const ANSWER_OPTIONS = VOTE_OPTIONS.filter((o) => o.value !== "none") as ToggleOption<
  CharterConsentVote | ""
>[];

export const VOTE_LABEL: Record<CharterConsentVote, string> = {
  consent: "Consent",
  concern: "Concern",
  object: "Object",
};

/** One person's answer, edited in place: the vote, and for a concern or objection, why. */
function ConsentRow({
  name,
  entry,
  ruleText,
  onVote,
}: {
  name: string;
  entry: CharterConsent | undefined;
  ruleText: string;
  onVote: (name: string, vote: CharterConsentVote | null, note?: string) => void;
}) {
  const vote: VoteChoice = entry?.vote ?? "none";
  return (
    <li className="space-y-1.5 py-2">
      <div className="flex flex-wrap items-center gap-x-3 gap-y-1.5">
        <span className="min-w-0 flex-1 basis-28 truncate text-sm text-text">{name}</span>
        <ToggleGroup
          label={`${name}'s answer to “${ruleText}”`}
          size="sm"
          value={vote}
          options={VOTE_OPTIONS}
          onValueChange={(v) => onVote(name, v === "none" ? null : v, entry?.note)}
        />
      </div>
      {entry && entry.vote !== "consent" && (
        <BlurInput
          value={entry.note ?? ""}
          maxLength={CONSENT_NOTE_MAX}
          onCommit={(note) => onVote(name, entry.vote, note)}
          placeholder={
            entry.vote === "object" ? "What would make it workable?" : "What's the concern?"
          }
          className="h-8 text-xs"
          aria-label={`${name}'s note on “${ruleText}”`}
        />
      )}
    </li>
  );
}

/**
 * Consent to one rule, person by person: everyone on the team gets a row
 * (an unanswered row is "No answer", never a silent consent), people who
 * answered but aren't on the roster keep theirs, and anyone else can be
 * added by name.
 */
export function ConsentPanel({
  rule,
  roster,
  offerAddToRoster,
  onVote,
}: {
  rule: CharterRule;
  roster: readonly { id: string; name: string }[];
  /** Never for the example: its people aren't the team's. */
  offerAddToRoster: boolean;
  onVote: (name: string, vote: CharterConsentVote | null, note?: string) => void;
}) {
  const entries = consentEntries(rule);
  const byKey = new Map(entries.map((e) => [nameKey(e.name), e]));
  const others = entries.filter((e) => !findRosterMember(roster, e.name));

  const form = useItemForm<ConsentDraft, ConsentValues, ConsentField>({
    initial: EMPTY_CONSENT,
    validate: validateConsent,
    onSave: (v) => onVote(findRosterMember(roster, v.name)?.name ?? v.name, v.vote, v.note),
  });
  const { draft, update, errors } = form;

  return (
    <div className="space-y-3">
      {roster.length > 0 || others.length > 0 ? (
        <ul className="divide-y divide-border" aria-label={`Answers to “${rule.text}”`}>
          {roster.map((m) => (
            <ConsentRow
              key={m.id}
              name={m.name}
              entry={byKey.get(nameKey(m.name))}
              ruleText={rule.text}
              onVote={onVote}
            />
          ))}
          {others.map((e) => (
            <ConsentRow
              key={nameKey(e.name)}
              name={e.name}
              entry={e}
              ruleText={rule.text}
              onVote={onVote}
            />
          ))}
        </ul>
      ) : null}
      <ItemForm
        form={form}
        submitLabel="Record answer"
        submitIcon={<Plus className="h-4 w-4" aria-hidden="true" />}
      >
        <div className="grid grid-cols-1 gap-3 sm:grid-cols-[minmax(0,14rem)_minmax(0,1fr)]">
          <PersonPicker
            label="Someone else"
            value={draft.name}
            onChange={(name) => update({ name })}
            error={errors.name}
            placeholder="Name"
            offerAddToRoster={offerAddToRoster}
          />
          <div
            className="flex min-w-0 flex-col gap-1.5"
            // focusFirstInvalid looks for this marker to focus the checked (or first) answer.
            data-scale-invalid={errors.vote ? "true" : undefined}
          >
            <span className="text-sm text-text">Their answer</span>
            <ToggleGroup
              label="Their answer"
              size="sm"
              value={draft.vote}
              options={ANSWER_OPTIONS}
              onValueChange={(vote) => update({ vote })}
            />
            {errors.vote && (
              <p className="text-xs text-danger" role="alert">
                {errors.vote}
              </p>
            )}
          </div>
        </div>
        {draft.vote && draft.vote !== "consent" && (
          <Field label="Why (optional)" error={errors.note}>
            {(props) => (
              <Input
                {...props}
                value={draft.note}
                maxLength={CONSENT_NOTE_MAX}
                onChange={(e) => update({ note: e.target.value })}
              />
            )}
          </Field>
        )}
      </ItemForm>
    </div>
  );
}
