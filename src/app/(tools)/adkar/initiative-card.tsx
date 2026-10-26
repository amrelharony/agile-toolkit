"use client";

import { useId, useState } from "react";
import {
  AlertTriangle,
  ArrowLeft,
  ArrowRight,
  Check,
  Pencil,
  Plus,
  Save,
  Trash2,
  Users,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Field } from "@/components/ui/field";
import { IconButton } from "@/components/ui/icon-button";
import { Input } from "@/components/ui/input";
import { DayInput } from "@/components/shared/day-input";
import { EditableName } from "@/components/shared/editable-name";
import { useInlineEdit } from "@/components/shared/inline-item-editor";
import { ItemForm, useItemForm } from "@/components/shared/item-form";
import { ScalePicker } from "@/components/shared/scale-picker";
import { cn } from "@/lib/utils";
import { nameKey } from "@/lib/team/names";
import { formatDate } from "@/lib/utils/formatters";
import type { Validation } from "@/lib/utils/form";
import type {
  AdkarElement,
  AdkarGroup,
  AdkarInitiative,
  AdkarScore,
} from "@/lib/stores/workspace-types";
import {
  ADKAR_ELEMENTS,
  ADKAR_SCORE_STEPS,
  BARRIER_MAX,
  ELEMENT_BLURB,
  ELEMENT_LABEL,
  assessedAtError,
  barrierPoint,
  barrierText,
  completedStages,
  daysInStage,
  initiativeBarrier,
  moveDateError,
  nameError,
  pastBarrier,
  scoreOf,
  stageDurations,
  stageIndex,
  type NewInitiative,
} from "@/lib/adkar/model";
import { InitiativeForm } from "./initiative-form";

const daysWord = (n: number) => (n === 1 ? "1 day" : `${n} days`);

/** Check a new group's name: required, and not one the initiative already has. */
export function validateGroup(
  d: { name: string },
  groups: readonly AdkarGroup[]
): Validation<{ name: string }, "name"> {
  const error = nameError(d.name, "group");
  if (error) return { ok: false, errors: { name: error } };
  if (groups.some((g) => nameKey(g.name) === nameKey(d.name))) {
    return { ok: false, errors: { name: `“${d.name.trim()}” is already a group here.` } };
  }
  return { ok: true, values: { name: d.name.trim() } };
}

/** The scale per element: the number, with what it means in the tooltip. */
const SCORE_STEPS = ADKAR_SCORE_STEPS.map((s) => ({
  value: s.value,
  meaning: `${s.name}: ${s.meaning}`,
}));

function GroupRow({
  initiative,
  group,
  today,
  onScore,
  onPatch,
  onRemove,
}: {
  initiative: AdkarInitiative;
  group: AdkarGroup;
  today: string;
  onScore: (element: AdkarElement, score: AdkarScore | null) => void;
  onPatch: (patch: { name?: string; assessedAt?: string | null }) => void;
  onRemove: () => void;
}) {
  const b = barrierPoint(group.scores);
  return (
    <li className="space-y-2 rounded-lg border border-border bg-card p-3">
      <div className="flex flex-wrap items-center gap-2">
        <EditableName
          value={group.name}
          onChange={(name) => onPatch({ name })}
          ariaLabel={`Rename ${group.name}`}
          className="min-w-0 flex-1 text-sm font-medium text-text"
        />
        <DayInput
          label={`Day ${group.name} was scored`}
          value={group.assessedAt ?? ""}
          max={today}
          validate={(day) => assessedAtError(day, today)}
          onCommit={(day) => onPatch({ assessedAt: day || null })}
          inputClassName="h-8 w-40"
        />
        <IconButton
          label={`Delete the group ${group.name} from ${initiative.name}`}
          icon={<Trash2 className="h-3.5 w-3.5" />}
          className="h-8 w-8 text-sub hover:text-danger"
          onClick={onRemove}
        />
      </div>
      <p className={cn("text-xs", b.element ? "font-medium text-warning" : "text-sub")}>
        {barrierText(group)}
      </p>
      <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 xl:grid-cols-5">
        {ADKAR_ELEMENTS.map((el) => {
          const isBarrier = b.element === el;
          return (
            <div
              key={el}
              className={cn(
                "rounded-md p-1.5",
                isBarrier && "border border-warning/50 bg-warning/10"
              )}
            >
              <ScalePicker
                label={`${group.name}: ${ELEMENT_LABEL[el]}${isBarrier ? " (barrier)" : ""}`}
                steps={SCORE_STEPS}
                value={scoreOf(group.scores[el])}
                onValueChange={(v) => onScore(el, v as AdkarScore)}
                onClear={() => onScore(el, null)}
                size="sm"
              />
            </div>
          );
        })}
      </div>
    </li>
  );
}

function AddGroupForm({
  groups,
  onAdd,
}: {
  groups: readonly AdkarGroup[];
  onAdd: (name: string) => void;
}) {
  const form = useItemForm<{ name: string }, { name: string }, "name">({
    initial: { name: "" },
    validate: (d) => validateGroup(d, groups),
    onSave: (v) => onAdd(v.name),
  });
  return (
    <ItemForm
      form={form}
      submitLabel="Add group"
      submitIcon={<Plus className="h-4 w-4" aria-hidden="true" />}
    >
      <Field label="Group affected" error={form.errors.name} required>
        {(props) => (
          <Input
            {...props}
            value={form.draft.name}
            onChange={(e) => form.update({ name: e.target.value })}
            placeholder="e.g. Support, On-call engineers"
          />
        )}
      </Field>
    </ItemForm>
  );
}

export interface CardHandlers {
  onEdit: (values: NewInitiative) => void;
  onMove: (direction: "advance" | "back", on: string) => void;
  onRemove: () => void;
  onAddGroup: (name: string) => void;
  onScore: (groupId: string, element: AdkarElement, score: AdkarScore | null) => void;
  onGroupPatch: (groupId: string, patch: { name?: string; assessedAt?: string | null }) => void;
  onRemoveGroup: (group: AdkarGroup) => void;
}

/**
 * One initiative: its stage on a five-step stepper, dated moves forward
 * and back, the history with days per stage, and its groups' scores with
 * the barrier point named in words (never colour alone).
 */
export function InitiativeCard({
  initiative: i,
  today,
  preview,
  handlers,
}: {
  initiative: AdkarInitiative;
  today: string;
  preview: boolean;
  handlers: CardHandlers;
}) {
  // Edit swaps the header for the form: focus goes into it, and back to Edit after.
  const edit = useInlineEdit();
  const editing = edit.editing;
  const [moveOn, setMoveOn] = useState(today);
  const [moveError, setMoveError] = useState<string | null>(null);
  const dateId = useId();
  const at = stageIndex(i.currentStage);
  const done = new Set(completedStages(i));
  const days = daysInStage(i, today);
  const since = i.stageHistory[i.stageHistory.length - 1]?.enteredAt ?? i.startDate;
  const barrier = initiativeBarrier(i);
  const past = pastBarrier(i);
  const durations = stageDurations(i, today);
  const groups = i.groups ?? [];

  const move = (direction: "advance" | "back") => {
    const error = moveDateError(i, moveOn, today);
    setMoveError(error);
    if (error) return;
    handlers.onMove(direction, moveOn);
  };

  return (
    <Card className="border-border bg-surface">
      <CardContent className="space-y-4 p-4">
        {editing ? (
          <InitiativeForm
            today={today}
            editing={i}
            submitLabel="Save"
            submitIcon={<Save className="h-4 w-4" aria-hidden="true" />}
            offerAddToRoster={!preview}
            autoFocus
            onCancel={() => edit.stop({ refocus: true })}
            onSave={(values) => {
              handlers.onEdit(values);
              edit.stop({ refocus: true });
            }}
          />
        ) : (
          <div className="flex flex-col gap-2 xs:flex-row xs:items-start xs:justify-between">
            <div className="min-w-0 flex-1">
              <h3 className="text-sm font-semibold text-text">{i.name}</h3>
              <p className="mt-0.5 text-xs text-sub">
                {i.owner && `${i.owner} · `}started {formatDate(i.startDate)}
              </p>
              {i.description && (
                <p className="mt-1 whitespace-pre-wrap text-xs text-sub">{i.description}</p>
              )}
            </div>
            <div className="flex items-center gap-1">
              <Button
                ref={edit.triggerRef}
                type="button"
                size="sm"
                variant="ghost"
                onClick={edit.start}
                aria-label={`Edit ${i.name}`}
              >
                <Pencil aria-hidden="true" />
                Edit
              </Button>
              <IconButton
                label={`Delete ${i.name}`}
                icon={<Trash2 className="h-3.5 w-3.5" />}
                className="text-sub hover:text-danger"
                onClick={handlers.onRemove}
              />
            </div>
          </div>
        )}

        <div className="space-y-2">
          <p className="text-sm text-text">
            Stage {at + 1} of 5:{" "}
            <span className="font-semibold">{ELEMENT_LABEL[i.currentStage]}</span>
            <span className="text-sub">
              {" "}
              · {daysWord(days)}, since {formatDate(since)}
            </span>
          </p>
          <ol className="grid grid-cols-5 gap-1" aria-label={`${i.name}: stages`}>
            {ADKAR_ELEMENTS.map((el, idx) => {
              const isDone = done.has(el);
              const isCurrent = el === i.currentStage;
              return (
                <li
                  key={el}
                  aria-current={isCurrent ? "step" : undefined}
                  title={ELEMENT_BLURB[el]}
                  className={cn(
                    "flex min-w-0 items-center justify-center gap-1 rounded-md border px-1 py-1 text-center text-xs",
                    isDone
                      ? "border-success/50 bg-success/10 text-success"
                      : isCurrent
                        ? "border-accent/60 bg-accent/10 font-semibold text-accent"
                        : "border-border bg-bg text-sub"
                  )}
                >
                  {isDone && <Check className="h-3 w-3 shrink-0" aria-hidden="true" />}
                  <span className="sm:hidden">{idx + 1}</span>
                  <span className="hidden truncate sm:inline">{ELEMENT_LABEL[el]}</span>
                  <span className="sr-only">
                    {` ${ELEMENT_LABEL[el]}`}
                    {isDone ? " (done)" : isCurrent ? " (current)" : ""}
                  </span>
                </li>
              );
            })}
          </ol>
          <div className="flex flex-wrap items-end gap-2">
            <div className="flex flex-col gap-1">
              <label htmlFor={dateId} className="text-xs text-sub">
                Moved on
              </label>
              <Input
                id={dateId}
                type="date"
                max={today}
                className="h-9 w-40"
                value={moveOn}
                aria-invalid={moveError ? true : undefined}
                aria-describedby={moveError ? `${dateId}-error` : undefined}
                onChange={(e) => {
                  setMoveOn(e.target.value);
                  setMoveError(null);
                }}
              />
            </div>
            <Button
              type="button"
              size="sm"
              variant="ghost"
              disabled={at === 0}
              onClick={() => move("back")}
              aria-label={`Step ${i.name} back to ${at > 0 ? ELEMENT_LABEL[ADKAR_ELEMENTS[at - 1]] : "an earlier stage"}`}
            >
              <ArrowLeft aria-hidden="true" />
              Step back
            </Button>
            <Button
              type="button"
              size="sm"
              variant="outline"
              disabled={at === ADKAR_ELEMENTS.length - 1}
              onClick={() => move("advance")}
              aria-label={
                at === ADKAR_ELEMENTS.length - 1
                  ? `${i.name} is at the final stage`
                  : `Advance ${i.name} to ${ELEMENT_LABEL[ADKAR_ELEMENTS[at + 1]]}`
              }
            >
              <ArrowRight aria-hidden="true" />
              {at === ADKAR_ELEMENTS.length - 1 ? "At final stage" : "Advance stage"}
            </Button>
          </div>
          {moveError && (
            <p id={`${dateId}-error`} role="alert" className="text-xs text-danger">
              {moveError}
            </p>
          )}
        </div>

        {barrier && (
          <p className="rounded-md border border-warning/40 bg-warning/10 px-3 py-2 text-sm text-text">
            <span className="font-medium">Barrier: {ELEMENT_LABEL[barrier.element]}</span> (
            {barrier.groupName} scored {barrier.score}/5). Work on it before the later elements.
          </p>
        )}
        {past.map((p) => (
          <p
            key={p.group.id}
            role="status"
            className="flex items-start gap-2 rounded-md border border-warning/40 bg-warning/10 px-3 py-2 text-sm text-text"
          >
            <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0 text-warning" aria-hidden="true" />
            <span>
              At {ELEMENT_LABEL[i.currentStage]}, but {p.group.name}&apos;s barrier is{" "}
              {ELEMENT_LABEL[p.barrier]}: step back, or work on {ELEMENT_LABEL[p.barrier]} with
              them.
            </span>
          </p>
        ))}

        <details className="rounded-lg border border-border bg-card px-3 py-2">
          <summary className="min-h-9 cursor-pointer py-1 text-sm font-medium text-text">
            Stage history ({durations.length} {durations.length === 1 ? "stage" : "stages"})
          </summary>
          <ol className="mt-1 space-y-1 text-sm text-sub">
            {durations.map((d, k) => (
              <li key={`${d.stage}-${d.from}-${k}`}>
                <span className="text-text">{ELEMENT_LABEL[d.stage]}</span> ·{" "}
                {d.to
                  ? `${formatDate(d.from)} to ${formatDate(d.to)} · ${daysWord(d.days)}`
                  : `since ${formatDate(d.from)} · ${daysWord(d.days)} so far`}
              </li>
            ))}
          </ol>
        </details>

        <div className="space-y-2">
          <h4 className="flex items-center gap-2 text-sm font-semibold text-text">
            <Users className="h-4 w-4 text-accent" aria-hidden="true" />
            Groups ({groups.length})
          </h4>
          {groups.length === 0 ? (
            <p className="text-sm text-sub">
              Add the groups this change affects, then score each on the five elements (1-5) to find
              its barrier point: the first element at {BARRIER_MAX} or lower.
            </p>
          ) : (
            <ul className="space-y-2">
              {groups.map((g) => (
                <GroupRow
                  key={g.id}
                  initiative={i}
                  group={g}
                  today={today}
                  onScore={(el, score) => handlers.onScore(g.id, el, score)}
                  onPatch={(patch) => handlers.onGroupPatch(g.id, patch)}
                  onRemove={() => handlers.onRemoveGroup(g)}
                />
              ))}
            </ul>
          )}
          <AddGroupForm groups={groups} onAdd={handlers.onAddGroup} />
        </div>
      </CardContent>
    </Card>
  );
}
