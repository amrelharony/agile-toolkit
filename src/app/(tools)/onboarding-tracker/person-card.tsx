"use client";

import { useEffect, useState } from "react";
import { Check, Pencil, Trash2, UserPlus } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { IconButton } from "@/components/ui/icon-button";
import { Input } from "@/components/ui/input";
import { BlurInput } from "@/components/shared/blur-fields";
import { InlineItemEditor, useInlineEdit } from "@/components/shared/inline-item-editor";
import { cn } from "@/lib/utils";
import { TargetField } from "./fields";
import {
  MARK_LABELS,
  dayOf,
  daysToComplete,
  isIsoDay,
  markOf,
  milestoneStatus,
  type Milestone,
  type Onboardee,
} from "./model";
import { PersonForm, type PersonValues } from "./person-form";

/**
 * The day a milestone was reached: backdatable, never after today nor
 * before the start. The field shows what is typed (a year typed digit by
 * digit passes through "0002-…") and saves only a day in range; leaving it
 * on one out of range puts the saved day back.
 */
function ReachedOnField({
  value,
  min,
  max,
  label,
  onCommit,
}: {
  value: string;
  min?: string;
  max: string;
  label: string;
  onCommit: (day: string) => void;
}) {
  const [draft, setDraft] = useState(value);
  useEffect(() => setDraft(value), [value]);
  const inRange = (d: string) => isIsoDay(d) && d <= max && (!min || d >= min);
  return (
    <Input
      type="date"
      value={draft}
      min={min}
      max={max}
      aria-label={label}
      aria-invalid={draft !== value && !inRange(draft) ? true : undefined}
      onChange={(e) => {
        const day = e.target.value;
        setDraft(day);
        if (inRange(day) && day !== value) onCommit(day);
      }}
      onBlur={() => setDraft(value)}
      className="h-8 w-auto border-border bg-surface text-xs"
    />
  );
}

/** "Day 12", "Starts in 3 days", or "No start date". */
export function dayLabel(day: number | null): string {
  if (day === null) return "No start date";
  if (day < 0) return `Starts in ${-day === 1 ? "1 day" : `${-day} days`}`;
  return `Day ${day}`;
}

function MilestoneRow({
  person,
  milestone: m,
  today,
  elapsed,
  onToggle,
  onPatch,
}: {
  person: Onboardee;
  milestone: Milestone;
  today: string;
  elapsed: number;
  onToggle: () => void;
  onPatch: (patch: Partial<Milestone>) => void;
}) {
  const edit = useInlineEdit();
  const completed = Boolean(m.completedAt);
  const status = milestoneStatus(elapsed, m);
  const days = daysToComplete(person, m);
  const mark = markOf(m);
  return (
    <li
      className={cn(
        "rounded-md border p-2",
        completed
          ? "border-success/40 bg-success/5"
          : status === "overdue"
            ? "border-danger/40 bg-danger/5"
            : status === "at-risk"
              ? "border-warning/40 bg-warning/5"
              : "border-border bg-bg"
      )}
    >
      <div className="flex items-start gap-2">
        <button
          type="button"
          onClick={onToggle}
          className={cn(
            "mt-0.5 w-5 h-5 rounded border flex items-center justify-center shrink-0 transition min-touch-coarse",
            completed
              ? "bg-success/20 border-success/60 text-success"
              : "border-border bg-surface text-transparent hover:text-sub"
          )}
          role="checkbox"
          aria-checked={completed}
          aria-label={`${m.name} (${person.name})`}
        >
          <Check className="w-3 h-3" aria-hidden="true" />
        </button>
        <div className="min-w-0 flex-1 space-y-1">
          <div className="flex flex-wrap items-center gap-x-2 gap-y-1">
            {edit.editing ? (
              <InlineItemEditor
                label="Edit milestone"
                title={m.name}
                titleLabel="Milestone name"
                titleMaxLength={80}
                className="min-w-0 flex-1 basis-40"
                onDone={(next, opts) => {
                  if (next) onPatch({ name: next.title });
                  edit.stop(opts);
                }}
              />
            ) : (
              <button
                ref={edit.triggerRef}
                type="button"
                onClick={edit.start}
                className="group inline-flex items-center gap-1 rounded text-left text-sm font-medium text-text focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent"
                aria-label={`Rename ${m.name} (${person.name})`}
              >
                <span>{m.name}</span>
                <Pencil
                  className="h-3 w-3 text-sub opacity-0 group-hover:opacity-100 group-focus-visible:opacity-100"
                  aria-hidden="true"
                />
              </button>
            )}
            <span className="inline-flex items-center gap-1 text-xs text-sub font-data">
              target
              <TargetField
                value={m.targetDays}
                label={`Target days for ${m.name} (${person.name})`}
                onCommit={(targetDays) => onPatch({ targetDays })}
              />
            </span>
            {mark && <span className="text-xs text-sub">· {MARK_LABELS[mark]}</span>}
            {completed && days !== null && (
              <span className="text-xs text-success font-data">done in {days}d</span>
            )}
            {status === "overdue" && <span className="text-xs text-danger font-data">overdue</span>}
            {status === "at-risk" && (
              <span className="text-xs text-warning font-data">at risk</span>
            )}
          </div>
          {completed && (
            <label className="inline-flex items-center gap-1.5 text-xs text-sub">
              Reached on
              {/* Backdated to when it happened; never emptied, past today or before the start. */}
              <ReachedOnField
                value={m.completedAt ?? ""}
                min={isIsoDay(person.startDate) ? person.startDate : undefined}
                max={today}
                label={`${m.name} (${person.name}) reached on`}
                onCommit={(completedAt) => onPatch({ completedAt })}
              />
            </label>
          )}
          <BlurInput
            value={m.notes ?? ""}
            onCommit={(v) => onPatch({ notes: v.trim() || undefined })}
            placeholder="Note (optional)"
            className="bg-surface border-border h-7 text-xs"
            aria-label={`Note for ${m.name} (${person.name})`}
          />
        </div>
      </div>
    </li>
  );
}

/**
 * One new joiner: who, since when, their milestones (tick to mark one
 * reached today, then backdate it; rename or retarget it in place), and
 * their details edited in place.
 */
export function PersonCard({
  person: p,
  today,
  onRoster,
  offerAddToRoster,
  onToggle,
  onPatchMilestone,
  onSaveDetails,
  onAddToRoster,
  onRemove,
}: {
  person: Onboardee;
  today: string;
  /** Whether their name is on the Team roster. */
  onRoster: boolean;
  offerAddToRoster: boolean;
  onToggle: (m: Milestone) => void;
  onPatchMilestone: (m: Milestone, patch: Partial<Milestone>) => void;
  onSaveDetails: (values: PersonValues) => void;
  onAddToRoster: () => void;
  onRemove: () => void;
}) {
  // The form replaces the Edit button; Save and Cancel give focus back to it.
  const edit = useInlineEdit();
  const day = dayOf(p, today);
  const completedCount = p.milestones.filter((m) => m.completedAt).length;
  return (
    <Card className="bg-surface border-border">
      <CardContent className="p-4 space-y-3">
        {edit.editing ? (
          <PersonForm
            initial={{
              name: p.name,
              role: p.role ?? "",
              buddy: p.buddy ?? "",
              startDate: p.startDate,
              description: p.description ?? "",
            }}
            submitLabel="Save"
            offerAddToRoster={offerAddToRoster}
            focusOnOpen
            onSave={(values) => {
              onSaveDetails(values);
              edit.stop({ refocus: true });
            }}
            onCancel={() => edit.stop({ refocus: true })}
          />
        ) : (
          <div className="flex flex-col xs:flex-row xs:items-start xs:justify-between gap-2">
            <div className="min-w-0">
              <div className="text-sm font-semibold text-text break-words">
                {p.name}
                {p.role && <span className="text-sub font-normal ml-2">· {p.role}</span>}
              </div>
              <div className="text-xs text-sub mt-0.5">
                {p.startDate ? `Started ${p.startDate}` : "No start date"} · {dayLabel(day)} ·{" "}
                {completedCount}/{p.milestones.length} milestones
                {p.buddy && ` · buddy ${p.buddy}`}
              </div>
              {p.description && (
                <div className="text-xs text-sub mt-1 whitespace-pre-wrap">{p.description}</div>
              )}
            </div>
            <div className="flex flex-wrap items-center gap-1">
              {!onRoster && offerAddToRoster && (
                <Button
                  type="button"
                  size="sm"
                  variant="ghost"
                  className="gap-1 text-xs text-sub hover:text-text"
                  onClick={onAddToRoster}
                  aria-label={`Add ${p.name} to the team`}
                >
                  <UserPlus className="h-3.5 w-3.5" aria-hidden="true" />
                  Add to the team
                </Button>
              )}
              <IconButton
                ref={edit.triggerRef}
                label={`Edit ${p.name}`}
                icon={<Pencil className="w-3.5 h-3.5" />}
                className="h-8 w-8 text-sub hover:text-text"
                onClick={edit.start}
              />
              <IconButton
                label={`Remove ${p.name}`}
                icon={<Trash2 className="w-3.5 h-3.5" />}
                className="h-8 w-8 text-sub hover:text-danger"
                onClick={onRemove}
              />
            </div>
          </div>
        )}

        {p.milestones.length > 0 && (
          <ul className="space-y-2" aria-label={`Milestones for ${p.name}`}>
            {p.milestones.map((m) => (
              <MilestoneRow
                key={m.id}
                person={p}
                milestone={m}
                today={today}
                elapsed={day ?? 0}
                onToggle={() => onToggle(m)}
                onPatch={(patch) => onPatchMilestone(m, patch)}
              />
            ))}
          </ul>
        )}
      </CardContent>
    </Card>
  );
}
