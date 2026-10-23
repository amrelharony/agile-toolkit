"use client";

import { useEffect } from "react";
import { Plus } from "lucide-react";
import { Field } from "@/components/ui/field";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { ItemForm, useItemForm, type ItemFormState } from "@/components/shared/item-form";
import type { SosEntry } from "@/lib/stores/workspace-types";
import type { Validation } from "@/lib/utils/form";
import { ChoiceField, TeamField } from "../dependency-map/fields";
import { parseDay } from "../dependency-map/format";
import { KIND_LABEL, KIND_ORDER, isTracked, meetingDay, type EntryKind } from "./agenda";

const TEAM_MAX = 120;
const TEXT_MAX = 2000;

export interface EntryDraft {
  meetingDate: string;
  team: string;
  kind: EntryKind | null;
  text: string;
  blockedBy: string;
}
export interface EntryValues {
  meetingDate: string;
  team: string;
  kind: EntryKind;
  text: string;
  blockedBy?: string;
}
type EntryField = keyof EntryDraft;

export const emptyEntry = (meetingDate: string): EntryDraft => ({
  meetingDate,
  team: "",
  kind: null,
  text: "",
  blockedBy: "",
});

/** An entry's meeting date is read as its day ("" when unreadable, so the editor asks for one). */
export const entryDraftFrom = (e: SosEntry): EntryDraft => ({
  meetingDate: meetingDay(e),
  team: e.team,
  kind: e.kind,
  text: e.text,
  blockedBy: e.blockedBy ?? "",
});

const KIND_MEANING: Record<EntryKind, string> = {
  blocker: "Something stopping a team now. Tracked until resolved.",
  dependency:
    "One team waiting on another. Tracked until resolved, and can go on the Dependency Map.",
  decision: "Something the teams agreed. A record, no follow-up.",
  update: "News for the other teams. A record, no follow-up.",
};

const KIND_OPTIONS = KIND_ORDER.map((k) => ({
  value: k,
  label: KIND_LABEL[k].one,
  description: KIND_MEANING[k],
}));

/**
 * An entry needs its meeting, a team, a kind (never a silent "update") and
 * what happened. A dependency names the team it waits on, which can't be
 * its own; only blockers and dependencies keep a "waits on" at all.
 */
export function validateEntry(d: EntryDraft): Validation<EntryValues, EntryField> {
  const errors: Partial<Record<EntryField, string>> = {};
  if (!parseDay(d.meetingDate)) errors.meetingDate = "Pick the meeting date.";
  const team = d.team.trim();
  if (!team) errors.team = "Name the team.";
  if (!d.kind) errors.kind = "Pick what kind of entry it is.";
  const text = d.text.trim();
  if (!text) errors.text = "Say what it is.";
  const blockedBy = d.blockedBy.trim();
  if (d.kind === "dependency" && !blockedBy) errors.blockedBy = "Name the team it waits on.";
  else if (
    d.kind &&
    isTracked(d.kind) &&
    blockedBy &&
    blockedBy.toLowerCase() === team.toLowerCase()
  ) {
    errors.blockedBy = "Pick another team: a team can't wait on itself.";
  }
  if (Object.keys(errors).length > 0) return { ok: false, errors };
  const kind = d.kind as EntryKind;
  return {
    ok: true,
    values: {
      meetingDate: d.meetingDate,
      team: team.slice(0, TEAM_MAX),
      kind,
      text: text.slice(0, TEXT_MAX),
      ...(isTracked(kind) && blockedBy ? { blockedBy: blockedBy.slice(0, TEAM_MAX) } : {}),
    },
  };
}

function EntryFields({
  form,
  teams,
}: {
  form: ItemFormState<EntryDraft, EntryField>;
  teams: readonly string[];
}) {
  const { draft, update, errors } = form;
  return (
    <>
      <div className="grid grid-cols-1 gap-3 sm:grid-cols-[11rem_1fr]">
        <Field
          label="Meeting date"
          error={errors.meetingDate}
          required
          hint="Backdate it to log a past meeting."
        >
          {(props) => (
            <Input
              {...props}
              type="date"
              value={draft.meetingDate}
              onChange={(e) => update({ meetingDate: e.target.value })}
            />
          )}
        </Field>
        <TeamField
          label="Team"
          required
          teams={teams}
          value={draft.team}
          onChange={(team) => update({ team })}
          error={errors.team}
        />
      </div>
      <ChoiceField
        label="Kind"
        required
        options={KIND_OPTIONS}
        value={draft.kind}
        onChange={(kind) => update({ kind })}
        error={errors.kind}
      />
      <Field label="Details" error={errors.text} required>
        {(props) => (
          <Textarea
            {...props}
            rows={2}
            maxLength={TEXT_MAX}
            value={draft.text}
            onChange={(e) => update({ text: e.target.value })}
            className="resize-none"
          />
        )}
      </Field>
      {draft.kind && isTracked(draft.kind) && (
        <TeamField
          label={draft.kind === "dependency" ? "Waits on" : "Blocked by"}
          required={draft.kind === "dependency"}
          hint={draft.kind === "blocker" ? "Optional: the team that can unblock it." : undefined}
          teams={teams.filter((t) => t.toLowerCase() !== draft.team.trim().toLowerCase())}
          value={draft.blockedBy}
          onChange={(blockedBy) => update({ blockedBy })}
          error={errors.blockedBy}
        />
      )}
    </>
  );
}

/** Log an entry; the date follows the meeting on screen until changed. */
export function EntryAddForm({
  meetingDate,
  teams,
  onAdd,
}: {
  meetingDate: string;
  teams: readonly string[];
  onAdd: (v: EntryValues) => void;
}) {
  const form = useItemForm<EntryDraft, EntryValues, EntryField>({
    initial: () => emptyEntry(meetingDate),
    validate: validateEntry,
    onSave: onAdd,
  });
  const { update } = form;
  useEffect(() => update({ meetingDate }), [meetingDate, update]);
  return (
    <ItemForm
      form={form}
      submitLabel="Log entry"
      submitIcon={<Plus className="h-4 w-4" aria-hidden="true" />}
    >
      <EntryFields form={form} teams={teams} />
    </ItemForm>
  );
}

/** Edit an entry in place. Enter saves, Escape cancels. */
export function EntryEditor({
  entry,
  teams,
  onSave,
  onCancel,
}: {
  entry: SosEntry;
  teams: readonly string[];
  onSave: (v: EntryValues) => void;
  onCancel: () => void;
}) {
  const form = useItemForm<EntryDraft, EntryValues, EntryField>({
    initial: () => entryDraftFrom(entry),
    validate: validateEntry,
    onSave,
    resetOnSave: false,
  });
  const { formRef } = form;
  useEffect(() => {
    formRef.current?.querySelector<HTMLElement>("textarea")?.focus();
  }, [formRef]);
  return (
    <ItemForm form={form} submitLabel="Save" onCancel={onCancel}>
      <EntryFields form={form} teams={teams} />
    </ItemForm>
  );
}
