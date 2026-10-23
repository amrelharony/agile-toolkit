"use client";

import { useEffect } from "react";
import { Plus } from "lucide-react";
import { Field } from "@/components/ui/field";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { ItemForm, useItemForm, type ItemFormState } from "@/components/shared/item-form";
import { ScalePicker, type ScaleStep } from "@/components/shared/scale-picker";
import { parseNumber, type Validation } from "@/lib/utils/form";
import { ChoiceField, SelectField, TeamField } from "../dependency-map/fields";
import type { PiItemKind, PiObjective, PiTeam } from "./store";

const NAME_MAX = 120;
const TITLE_MAX = 240;
const TEXT_MAX = 2000;
const DAY = /^\d{4}-\d{2}-\d{2}$/;

const nameKey = (s: string) => s.trim().toLowerCase();

/** Focus the editor's first field when it opens, where the keyboard user was heading. */
function useFocusFirst(form: { formRef: React.RefObject<HTMLFormElement> }) {
  const { formRef } = form;
  useEffect(() => {
    formRef.current?.querySelector<HTMLElement>("input, textarea, select")?.focus();
  }, [formRef]);
}

/* ── Teams ──────────────────────────────────────────────────────────── */

export interface TeamDraft {
  name: string;
  velocity: string;
  description: string;
}
export interface TeamValues {
  name: string;
  velocity?: number;
  description?: string;
}
type TeamField = keyof TeamDraft;

export const EMPTY_TEAM: TeamDraft = { name: "", velocity: "", description: "" };

export const teamDraftFrom = (t: PiTeam): TeamDraft => ({
  name: t.name,
  velocity: t.velocity ? String(t.velocity) : "",
  description: t.description ?? "",
});

/**
 * A team needs a name no other team on the board has (the Dependency Map
 * finds a team by its name). Velocity is optional: blank means "not set",
 * which the board shows as such instead of comparing against 0. A typed 0
 * is an error, not a silent "not set": no load can be checked against it.
 */
export function validateTeam(
  d: TeamDraft,
  teams: readonly PiTeam[],
  selfId?: string
): Validation<TeamValues, TeamField> {
  const errors: Partial<Record<TeamField, string>> = {};
  const name = d.name.trim();
  if (!name) errors.name = "Name the team.";
  else if (teams.some((t) => t.id !== selfId && nameKey(t.name) === nameKey(name))) {
    errors.name = `“${name}” is already on the board.`;
  }
  const velocity = parseNumber(d.velocity);
  if (velocity !== undefined && (!Number.isFinite(velocity) || velocity <= 0)) {
    errors.velocity = "Enter points per iteration (more than 0), or leave it blank.";
  }
  if (Object.keys(errors).length > 0) return { ok: false, errors };
  const description = d.description.trim();
  return {
    ok: true,
    values: {
      name: name.slice(0, NAME_MAX),
      ...(velocity ? { velocity } : {}),
      ...(description ? { description: description.slice(0, TEXT_MAX) } : {}),
    },
  };
}

function TeamFields({ form }: { form: ItemFormState<TeamDraft, TeamField> }) {
  const { draft, update, errors } = form;
  return (
    <>
      <div className="grid grid-cols-1 gap-3 sm:grid-cols-[1fr_12rem]">
        <Field label="Team name" error={errors.name} required>
          {(props) => (
            <Input
              {...props}
              maxLength={NAME_MAX}
              value={draft.name}
              onChange={(e) => update({ name: e.target.value })}
              placeholder="e.g. Payments"
            />
          )}
        </Field>
        <Field label="Velocity" hint="Points per iteration. Optional." error={errors.velocity}>
          {(props) => (
            <Input
              {...props}
              type="number"
              inputMode="decimal"
              min={0}
              value={draft.velocity}
              onChange={(e) => update({ velocity: e.target.value })}
            />
          )}
        </Field>
      </div>
      <Field label="Description" hint="Optional">
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
    </>
  );
}

export function TeamAddForm({
  teams,
  onAdd,
}: {
  teams: readonly PiTeam[];
  onAdd: (v: TeamValues) => void;
}) {
  const form = useItemForm<TeamDraft, TeamValues, TeamField>({
    initial: EMPTY_TEAM,
    validate: (d) => validateTeam(d, teams),
    onSave: onAdd,
  });
  return (
    <ItemForm
      form={form}
      submitLabel="Add team"
      submitIcon={<Plus className="h-4 w-4" aria-hidden="true" />}
    >
      <TeamFields form={form} />
    </ItemForm>
  );
}

export function TeamEditor({
  team,
  teams,
  onSave,
  onCancel,
}: {
  team: PiTeam;
  teams: readonly PiTeam[];
  onSave: (v: TeamValues) => void;
  onCancel: () => void;
}) {
  const form = useItemForm<TeamDraft, TeamValues, TeamField>({
    initial: () => teamDraftFrom(team),
    validate: (d) => validateTeam(d, teams, team.id),
    onSave,
    resetOnSave: false,
  });
  useFocusFirst(form);
  return (
    <ItemForm form={form} submitLabel="Save team" onCancel={onCancel}>
      <TeamFields form={form} />
    </ItemForm>
  );
}

/* ── Items ──────────────────────────────────────────────────────────── */

export interface ItemDraft {
  title: string;
  kind: PiItemKind | null;
  points: string;
  dependsOn: string;
  due: string;
  description: string;
}
export interface ItemValues {
  title: string;
  kind: PiItemKind;
  points?: number;
  dependsOn?: string;
  /** "" when cleared; only dependencies carry one (on their edge). */
  due: string;
  description?: string;
}
type ItemField = keyof ItemDraft;

export const EMPTY_ITEM: ItemDraft = {
  title: "",
  kind: null,
  points: "",
  dependsOn: "",
  due: "",
  description: "",
};

const KIND_OPTIONS: { value: PiItemKind; label: string; description: string }[] = [
  { value: "feature", label: "Feature", description: "Counts toward the team's load." },
  {
    value: "dependency",
    label: "Dependency",
    description: "Waits on another team; tracked on the Dependency Map.",
  },
  { value: "risk", label: "Risk", description: "Something that could stop the plan." },
];

/**
 * An item needs a title and a kind (never a silent "feature"); points are
 * optional (blank is "not sized", not 0); a dependency names the team it
 * waits on, which can't be its own.
 */
export function validateItem(d: ItemDraft, teamName: string): Validation<ItemValues, ItemField> {
  const errors: Partial<Record<ItemField, string>> = {};
  const title = d.title.trim();
  if (!title) errors.title = "Name the item.";
  if (!d.kind) errors.kind = "Pick a kind.";
  const points = parseNumber(d.points);
  if (points !== undefined && (!Number.isFinite(points) || points < 0)) {
    errors.points = "Points are a number, 0 or more. Leave it blank if it isn't sized yet.";
  }
  const dependsOn = d.dependsOn.trim();
  if (d.kind === "dependency") {
    if (!dependsOn) errors.dependsOn = "Name the team it waits on.";
    else if (nameKey(dependsOn) === nameKey(teamName)) {
      errors.dependsOn = "Pick another team: a team can't wait on itself.";
    }
    if (d.due && !DAY.test(d.due)) errors.due = "Use a date like 2026-11-02.";
  }
  if (Object.keys(errors).length > 0) return { ok: false, errors };
  const description = d.description.trim();
  const dependency = d.kind === "dependency";
  return {
    ok: true,
    values: {
      title: title.slice(0, TITLE_MAX),
      kind: d.kind as PiItemKind,
      ...(points !== undefined ? { points } : {}),
      ...(dependency ? { dependsOn: dependsOn.slice(0, NAME_MAX) } : {}),
      due: dependency ? d.due : "",
      ...(description ? { description: description.slice(0, TEXT_MAX) } : {}),
    },
  };
}

/** Add an item to a cell, or edit one in place. Enter saves, Escape cancels. */
export function PiItemEditor({
  initial,
  teamName,
  otherTeams,
  submitLabel,
  onSave,
  onCancel,
}: {
  initial: ItemDraft;
  teamName: string;
  /** Suggestions for "Waits on": the board's other teams. */
  otherTeams: readonly string[];
  submitLabel: string;
  onSave: (v: ItemValues) => void;
  onCancel: () => void;
}) {
  const form = useItemForm<ItemDraft, ItemValues, ItemField>({
    initial,
    validate: (d) => validateItem(d, teamName),
    onSave,
    resetOnSave: false,
  });
  useFocusFirst(form);
  const { draft, update, errors } = form;
  return (
    <ItemForm form={form} submitLabel={submitLabel} onCancel={onCancel} className="space-y-2">
      <Field label="Item" error={errors.title} required>
        {(props) => (
          <Input
            {...props}
            maxLength={TITLE_MAX}
            value={draft.title}
            onChange={(e) => update({ title: e.target.value })}
          />
        )}
      </Field>
      <ChoiceField
        label="Kind"
        required
        options={KIND_OPTIONS}
        value={draft.kind}
        onChange={(kind) => update({ kind })}
        error={errors.kind}
      />
      <Field label="Points" hint="Blank if not sized yet." error={errors.points}>
        {(props) => (
          <Input
            {...props}
            type="number"
            inputMode="decimal"
            min={0}
            value={draft.points}
            onChange={(e) => update({ points: e.target.value })}
          />
        )}
      </Field>
      {draft.kind === "dependency" && (
        <>
          <TeamField
            label="Waits on"
            required
            teams={otherTeams}
            value={draft.dependsOn}
            onChange={(dependsOn) => update({ dependsOn })}
            error={errors.dependsOn}
            hint="Added to the Dependency Map as this team needing that one."
          />
          <Field label="Due" hint="Optional. Kept on the Dependency Map." error={errors.due}>
            {(props) => (
              <Input
                {...props}
                type="date"
                value={draft.due}
                onChange={(e) => update({ due: e.target.value })}
              />
            )}
          </Field>
        </>
      )}
      <Field label="Description" hint="Optional">
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
    </ItemForm>
  );
}

/* ── Objectives ─────────────────────────────────────────────────────── */

type Commitment = "committed" | "uncommitted";

export interface ObjectiveDraft {
  teamId: string;
  title: string;
  businessValue: number | null;
  commitment: Commitment | null;
}
export interface ObjectiveValues {
  teamId: string;
  title: string;
  businessValue?: number;
  committed: boolean;
}
type ObjectiveField = keyof ObjectiveDraft;

export const EMPTY_OBJECTIVE: ObjectiveDraft = {
  teamId: "",
  title: "",
  businessValue: null,
  commitment: null,
};

export const objectiveDraftFrom = (o: PiObjective): ObjectiveDraft => ({
  teamId: o.teamId,
  title: o.title,
  businessValue: o.businessValue ?? null,
  commitment: o.committed ? "committed" : "uncommitted",
});

/** SAFe business value, 1–10, set by the business owners at the end of planning. */
export const BUSINESS_VALUE_STEPS: readonly ScaleStep[] = Array.from({ length: 10 }, (_, i) => ({
  value: i + 1,
  meaning:
    i + 1 <= 3
      ? "Nice to have"
      : i + 1 <= 6
        ? "Clear value to the business"
        : i + 1 <= 8
          ? "High value"
          : "Critical to the business",
}));

const COMMITMENT_OPTIONS: { value: Commitment; label: string; description: string }[] = [
  { value: "committed", label: "Committed", description: "The team promises to deliver it." },
  {
    value: "uncommitted",
    label: "Uncommitted",
    description: "A stretch goal: planned for, not promised.",
  },
];

/**
 * An objective needs a team, a title and a commitment (committed or a
 * stretch goal, never assumed). Business value may wait for the business
 * owners: unset reads "Not scored", not a middle value.
 */
export function validateObjective(d: ObjectiveDraft): Validation<ObjectiveValues, ObjectiveField> {
  const errors: Partial<Record<ObjectiveField, string>> = {};
  if (!d.teamId) errors.teamId = "Choose the team.";
  const title = d.title.trim();
  if (!title) errors.title = "Write the objective.";
  if (!d.commitment) errors.commitment = "Say whether the team commits to it.";
  if (d.businessValue !== null && (d.businessValue < 1 || d.businessValue > 10)) {
    errors.businessValue = "Business value runs from 1 to 10.";
  }
  if (Object.keys(errors).length > 0) return { ok: false, errors };
  return {
    ok: true,
    values: {
      teamId: d.teamId,
      title: title.slice(0, TITLE_MAX),
      ...(d.businessValue !== null ? { businessValue: d.businessValue } : {}),
      committed: d.commitment === "committed",
    },
  };
}

function ObjectiveFields({
  form,
  teams,
}: {
  form: ItemFormState<ObjectiveDraft, ObjectiveField>;
  teams: readonly PiTeam[];
}) {
  const { draft, update, errors } = form;
  return (
    <>
      <div className="grid grid-cols-1 gap-3 sm:grid-cols-[12rem_1fr]">
        <SelectField
          label="Team"
          required
          placeholder="Choose a team"
          options={teams.map((t) => ({ value: t.id, label: t.name }))}
          value={draft.teamId}
          onChange={(teamId) => update({ teamId })}
          error={errors.teamId}
        />
        <Field label="Objective" error={errors.title} required>
          {(props) => (
            <Input
              {...props}
              maxLength={TITLE_MAX}
              value={draft.title}
              onChange={(e) => update({ title: e.target.value })}
              placeholder="e.g. Customers can refund an order in one step"
            />
          )}
        </Field>
      </div>
      <div className="flex flex-wrap gap-x-8 gap-y-3">
        <ScalePicker
          label="Business value"
          size="sm"
          optionsClassName="grid grid-cols-5 sm:inline-flex"
          steps={BUSINESS_VALUE_STEPS}
          value={draft.businessValue}
          onValueChange={(businessValue) => update({ businessValue })}
          onClear={() => update({ businessValue: null })}
          hint="1 nice to have · 5 clear value · 10 critical. Leave unset until the business owners score it."
          error={errors.businessValue}
        />
        <ChoiceField
          label="Commitment"
          required
          options={COMMITMENT_OPTIONS}
          value={draft.commitment}
          onChange={(commitment) => update({ commitment })}
          error={errors.commitment}
        />
      </div>
    </>
  );
}

export function ObjectiveAddForm({
  teams,
  onAdd,
}: {
  teams: readonly PiTeam[];
  onAdd: (v: ObjectiveValues) => void;
}) {
  const form = useItemForm<ObjectiveDraft, ObjectiveValues, ObjectiveField>({
    initial: EMPTY_OBJECTIVE,
    validate: validateObjective,
    onSave: onAdd,
  });
  return (
    <ItemForm
      form={form}
      submitLabel="Add objective"
      submitIcon={<Plus className="h-4 w-4" aria-hidden="true" />}
    >
      <ObjectiveFields form={form} teams={teams} />
    </ItemForm>
  );
}

export function ObjectiveEditor({
  objective,
  teams,
  onSave,
  onCancel,
}: {
  objective: PiObjective;
  teams: readonly PiTeam[];
  onSave: (v: ObjectiveValues) => void;
  onCancel: () => void;
}) {
  const form = useItemForm<ObjectiveDraft, ObjectiveValues, ObjectiveField>({
    initial: () => objectiveDraftFrom(objective),
    validate: validateObjective,
    onSave,
    resetOnSave: false,
  });
  useFocusFirst(form);
  return (
    <ItemForm form={form} submitLabel="Save objective" onCancel={onCancel}>
      <ObjectiveFields form={form} teams={teams} />
    </ItemForm>
  );
}
