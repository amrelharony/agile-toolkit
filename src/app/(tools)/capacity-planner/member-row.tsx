"use client";

import { useEffect, useId, useState } from "react";
import { Trash2, UserPlus } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Field } from "@/components/ui/field";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { BlurInput, BlurTextarea } from "@/components/shared/blur-fields";
import { ItemForm, useItemForm } from "@/components/shared/item-form";
import { PersonPicker } from "@/components/team/person-picker";
import { useWorkspaceStore } from "@/lib/stores/workspace-store";
import type { CapacityMember, TeamMember } from "@/lib/stores/workspace-types";
import { findRosterMember, nameKey } from "@/lib/team/use-team-roster";
import { NumberField } from "./number-field";
import {
  AVAILABILITY_RULE,
  EMPTY_MEMBER_DRAFT,
  daysOffRule,
  fmt,
  validateMember,
  type MemberDraft,
  type MemberField,
  type MemberValues,
} from "./model";

/**
 * The name change for a row: a name on the Team page links the row to that
 * person (as "Sync from team" does); a name that no longer matches the
 * linked person drops the link, so a later sync doesn't rename it back.
 */
export function nameChange(
  member: Pick<CapacityMember, "teamMemberId">,
  name: string,
  roster: readonly TeamMember[]
): Partial<CapacityMember> {
  const match = findRosterMember(roster, name);
  if (match) return { name, teamMemberId: match.id };
  const linked = roster.find((r) => r.id === member.teamMemberId);
  if (member.teamMemberId && (!linked || nameKey(linked.name) !== nameKey(name))) {
    return { name, teamMemberId: undefined };
  }
  return { name };
}

/**
 * The row's name, kept in a draft and saved on blur or Enter like the role
 * beside it. Saving every keystroke made the row blank for a moment while a
 * name was retyped, and a blank row is nobody: the totals dropped and came
 * back. A name picked from the team (or just added to it) is saved at once,
 * since the roster's "Add to the team" button goes away when it is clicked
 * and no blur follows.
 */
function NameField({
  member,
  roster,
  onUpdate,
}: {
  member: CapacityMember;
  roster: readonly TeamMember[];
  onUpdate: (updates: Partial<CapacityMember>) => void;
}) {
  const [draft, setDraft] = useState(member.name);
  useEffect(() => setDraft(member.name), [member.name]);
  const commit = (name: string, team: readonly TeamMember[] = roster) => {
    if (name !== member.name) onUpdate(nameChange(member, name, team));
  };
  return (
    // PersonPicker has no onBlur of its own: the wrapper hears its input's
    // blur and Enter as they bubble. It adds no role of its own.
    <div
      role="presentation"
      className="col-span-2 md:col-span-1"
      onBlur={() => commit(draft)}
      onKeyDown={(e) => {
        if (e.key === "Enter" && e.target instanceof HTMLInputElement) {
          e.preventDefault();
          commit(draft);
        }
      }}
    >
      <PersonPicker
        label="Name"
        value={draft}
        onChange={(name) => {
          setDraft(name);
          // Read the roster now: "Add to the team" has just added this name.
          const team = useWorkspaceStore.getState().teamMembers ?? roster;
          if (findRosterMember(team, name)) commit(name, team);
        }}
        placeholder="Team member"
      />
    </div>
  );
}

/** One person's row: who they are, how much of the sprint they're here, and their hours. */
export function MemberRow({
  member,
  effectiveHours,
  counted = true,
  sprintDays,
  roster,
  onUpdate,
  onRemove,
}: {
  member: CapacityMember;
  effectiveHours: number;
  /** False for a blank row (no name, role or description): it isn't in the totals. */
  counted?: boolean;
  /** Days off can't exceed the sprint's working days. */
  sprintDays: number;
  roster: readonly TeamMember[];
  onUpdate: (updates: Partial<CapacityMember>) => void;
  onRemove: () => void;
}) {
  const fieldId = useId();
  const who = member.name.trim() || "member";
  return (
    // Every row has fields named "Name", "Availability", "Days off": the
    // group's name says whose they are.
    <div
      role="group"
      aria-label={member.name.trim() || "Unnamed member"}
      className="flex flex-col gap-2 border-b border-border pb-4 last:border-b-0 last:pb-0"
    >
      <div className="grid grid-cols-2 gap-3 md:grid-cols-[1.2fr_1fr_0.6fr_0.6fr_0.5fr_auto] md:items-start">
        <NameField member={member} roster={roster} onUpdate={onUpdate} />

        <div className="col-span-2 flex flex-col gap-1.5 md:col-span-1">
          <Label htmlFor={`${fieldId}-role`} className="text-sm text-text">
            Role
          </Label>
          <BlurInput
            id={`${fieldId}-role`}
            placeholder="e.g. Developer"
            value={member.role}
            onCommit={(role) => onUpdate({ role })}
          />
        </div>

        <NumberField
          label="Availability"
          value={member.availability}
          onCommit={(availability) => onUpdate({ availability })}
          rule={AVAILABILITY_RULE}
          step={5}
          suffix="%"
        />

        <NumberField
          label="Days off"
          value={member.daysOff}
          onCommit={(daysOff) => onUpdate({ daysOff })}
          rule={daysOffRule(sprintDays)}
          step={0.5}
        />

        <div className="flex flex-col gap-1.5">
          <span className="text-sm text-text">Hours</span>
          <div className="flex h-9 items-center rounded-md border border-accent/20 bg-accent/5 px-3">
            {counted ? (
              <span className="font-data font-semibold text-accent">
                {fmt(effectiveHours)}
                <span className="sr-only"> effective hours</span>
              </span>
            ) : (
              <span className="font-data text-sub">
                <span aria-hidden="true">—</span>
                <span className="sr-only">Not counted</span>
              </span>
            )}
          </div>
        </div>

        <div className="flex flex-col items-end gap-1.5 md:items-stretch">
          <span className="invisible text-sm" aria-hidden="true">
            Remove
          </span>
          <Button
            variant="danger-ghost"
            size="icon"
            onClick={onRemove}
            aria-label={`Remove member ${member.name || "(unnamed)"}`}
            className="h-9 w-9"
          >
            <Trash2 className="h-4 w-4" aria-hidden="true" />
          </Button>
        </div>
      </div>

      {!counted && (
        <p className="text-xs text-sub">
          Not counted in the totals until the row has a name or a role.
        </p>
      )}

      {/* Optional description spans the row under the inputs. */}
      <BlurTextarea
        placeholder="Description (optional): specialty, coverage notes…"
        value={member.description ?? ""}
        onCommit={(text) => onUpdate({ description: text.trim() ? text : undefined })}
        rows={2}
        className="resize-none text-xs text-text"
        aria-label={`Description for ${who}`}
      />
    </div>
  );
}

/**
 * "Add member": a name is required, and availability and days off are
 * checked before the row exists. Adding used to append a blank row that
 * counted a full person's hours until someone filled it in.
 */
export function MemberAddForm({
  sprintDays,
  roster,
  onAdd,
}: {
  sprintDays: number;
  roster: readonly TeamMember[];
  onAdd: (values: MemberValues & Pick<CapacityMember, "teamMemberId">) => void;
}) {
  const form = useItemForm<MemberDraft, MemberValues, MemberField>({
    initial: EMPTY_MEMBER_DRAFT,
    validate: (d) => validateMember(d, sprintDays),
    onSave: (values) => {
      const match = findRosterMember(roster, values.name);
      onAdd(match ? { ...values, teamMemberId: match.id } : values);
    },
  });
  const { draft, update, errors } = form;
  return (
    <ItemForm
      form={form}
      submitLabel="Add member"
      submitIcon={<UserPlus className="h-4 w-4" aria-hidden="true" />}
      className="rounded-lg border border-dashed border-border p-3"
    >
      <div className="grid grid-cols-2 gap-3 md:grid-cols-[1.2fr_1fr_0.6fr_0.6fr] md:items-start">
        <PersonPicker
          label="New member"
          required
          value={draft.name}
          onChange={(name) => update({ name })}
          error={errors.name}
          placeholder="Pick or type a name"
          className="col-span-2 md:col-span-1"
        />
        <Field label="Role" className="col-span-2 md:col-span-1">
          {(control) => (
            <Input
              {...control}
              value={draft.role}
              placeholder="e.g. Developer"
              onChange={(e) => update({ role: e.target.value })}
            />
          )}
        </Field>
        <Field label="Availability %" error={errors.availability}>
          {(control) => (
            <Input
              {...control}
              type="number"
              inputMode="decimal"
              min={0}
              max={100}
              step={5}
              value={draft.availability}
              onChange={(e) => update({ availability: e.target.value })}
              className="font-data"
            />
          )}
        </Field>
        <Field label="Days off this sprint" error={errors.daysOff}>
          {(control) => (
            <Input
              {...control}
              type="number"
              inputMode="decimal"
              min={0}
              max={sprintDays}
              step={0.5}
              value={draft.daysOff}
              onChange={(e) => update({ daysOff: e.target.value })}
              className="font-data"
            />
          )}
        </Field>
      </div>
    </ItemForm>
  );
}
