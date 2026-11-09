"use client";

import { useEffect, useId, useRef, useState } from "react";
import { CheckCircle2, Pencil, RotateCcw } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Field } from "@/components/ui/field";
import { Input } from "@/components/ui/input";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import type { Sprint } from "@/lib/stores/workspace-types";
import { cn } from "@/lib/utils";
import { InkHighlight } from "@/components/ink/ink-highlight";
import { InkMoment } from "@/components/ink/ink-moment";
import { dayForDate, hasSyntheticDates, sprintLengthDays } from "@/lib/sprints/series";
import { STATUS_LABEL, fmt, sprintDates, sprintDayLine } from "@/lib/sprints/hub-view";

const STATUS_BADGE: Record<Sprint["status"], string> = {
  planned: "border-border text-sub",
  active: "border-success/40 bg-success/10 text-success",
  completed: "border-accent/40 bg-accent/10 text-accent",
  cancelled: "border-border text-sub",
};

export function StatusBadge({ status }: { status: Sprint["status"] }) {
  return (
    <span
      className={cn(
        "inline-flex items-center rounded-md border px-2 py-0.5 text-xs font-medium",
        STATUS_BADGE[status]
      )}
    >
      {STATUS_LABEL[status]}
    </span>
  );
}

/** A text value edited in a draft and saved on blur or Enter (Escape reverts). */
function useDraft(value: string): [string, (v: string) => void] {
  const [draft, setDraft] = useState(value);
  useEffect(() => setDraft(value), [value]);
  return [draft, setDraft];
}

const commitKeys = (onCommit: () => void, onRevert: () => void) => ({
  onKeyDown: (e: React.KeyboardEvent<HTMLInputElement>) => {
    if (e.key === "Enter") {
      e.preventDefault();
      onCommit();
    } else if (e.key === "Escape") {
      e.preventDefault();
      onRevert();
    }
  },
});

const isIsoDate = (s: string) => /^\d{4}-\d{2}-\d{2}$/.test(s);

export interface SprintHeaderProps {
  sprint: Sprint;
  today: string;
  /** Example preview: nothing can be changed. */
  readOnly?: boolean;
  detailsOpen: boolean;
  onDetailsOpenChange: (open: boolean) => void;
  /** Focus this field when the details open (from a "Set real dates" nudge). */
  focusField?: "dates" | null;
  onEdit: (patch: Partial<Omit<Sprint, "id">>) => void;
  /** Ask to close the sprint (opens the dialog). */
  onRequestClose: () => void;
  onReopen: (status: Exclude<Sprint["status"], "completed">) => void;
}

/** The selected sprint: name, dates, day, goal and status, with Close sprint / Reopen. */
export function SprintHeader({
  sprint,
  today,
  readOnly = false,
  detailsOpen,
  onDetailsOpenChange,
  focusField,
  onEdit,
  onRequestClose,
  onReopen,
}: SprintHeaderProps) {
  const headingId = useId();
  const detailsId = useId();
  const dates = sprintDates(sprint);
  const dayLine = sprintDayLine(sprint, today);
  const goal = sprint.goal?.trim();
  const closable = sprint.status === "planned" || sprint.status === "active";
  // Closing is the main action once the last day has passed; before that it's a quiet option.
  const day = hasSyntheticDates(sprint) ? null : dayForDate(sprint, today);
  const ended = day !== null && day > sprintLengthDays(sprint);

  return (
    <section
      aria-labelledby={headingId}
      className="rounded-lg border border-border bg-card p-4 sm:p-5"
    >
      <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
        <div className="min-w-0 flex-1">
          <div className="flex flex-wrap items-center gap-2">
            <h2
              id={headingId}
              className="min-w-0 break-words font-display text-xl font-semibold text-text"
            >
              {sprint.name}
            </h2>
            <StatusBadge status={sprint.status} />
            {/* An ink moment: stamped Done once it's closed. The badge says so. */}
            {sprint.status === "completed" && <InkMoment mark="stamp" />}
          </div>
          <p className="mt-1 text-sm text-sub">
            {dates ? (
              <>
                {dates} · <span className="text-text">{dayLine}</span>
              </>
            ) : (
              "No dates set"
            )}
          </p>
          <p className="mt-2 break-words text-sm">
            {goal ? (
              <>
                <span className="text-sub">Goal: </span>
                {/* The one sentence the sprint is for, underlined by hand. */}
                <InkHighlight delay={700} className="text-text">
                  {goal}
                </InkHighlight>
              </>
            ) : (
              <span className="text-sub">No sprint goal yet.</span>
            )}
          </p>
        </div>
        {!readOnly && (
          <div className="flex shrink-0 flex-wrap gap-2">
            <Button
              type="button"
              variant="outline"
              size="sm"
              aria-expanded={detailsOpen}
              aria-controls={detailsOpen ? detailsId : undefined}
              onClick={() => onDetailsOpenChange(!detailsOpen)}
            >
              <Pencil className="mr-1 h-4 w-4" aria-hidden="true" />
              {detailsOpen ? "Done editing" : "Edit details"}
            </Button>
            {closable ? (
              <Button
                type="button"
                size="sm"
                variant={ended ? "default" : "outline"}
                onClick={onRequestClose}
              >
                <CheckCircle2 className="mr-1 h-4 w-4" aria-hidden="true" />
                Close sprint
              </Button>
            ) : (
              <Button type="button" variant="outline" size="sm" onClick={() => onReopen("active")}>
                <RotateCcw className="mr-1 h-4 w-4" aria-hidden="true" />
                Reopen
              </Button>
            )}
          </div>
        )}
      </div>
      {!readOnly && detailsOpen && (
        <SprintDetailsForm
          id={detailsId}
          sprint={sprint}
          focusField={focusField}
          onEdit={onEdit}
          onRequestClose={onRequestClose}
          onReopen={onReopen}
        />
      )}
    </section>
  );
}

function SprintDetailsForm({
  id,
  sprint,
  focusField,
  onEdit,
  onRequestClose,
  onReopen,
}: {
  id: string;
  sprint: Sprint;
  focusField?: "dates" | null;
  onEdit: SprintHeaderProps["onEdit"];
  onRequestClose: () => void;
  onReopen: SprintHeaderProps["onReopen"];
}) {
  const [name, setName] = useDraft(sprint.name);
  const [goal, setGoal] = useDraft(sprint.goal ?? "");
  const [start, setStart] = useDraft(sprint.startDate.slice(0, 10));
  const [end, setEnd] = useDraft(sprint.endDate.slice(0, 10));
  const [planned, setPlanned] = useDraft(fmt(sprint.pointsPlanned));
  const [errors, setErrors] = useState<{ name?: string; dates?: string; points?: string }>({});
  const startRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    if (focusField === "dates") startRef.current?.focus();
  }, [focusField]);

  const saveName = () => {
    const trimmed = name.trim();
    if (!trimmed) {
      setErrors((e) => ({ ...e, name: "A sprint needs a name." }));
      setName(sprint.name);
      return;
    }
    setErrors((e) => ({ ...e, name: undefined }));
    if (trimmed !== sprint.name) onEdit({ name: trimmed });
  };

  const saveGoal = () => {
    const trimmed = goal.trim();
    if (trimmed !== (sprint.goal ?? "").trim()) onEdit({ goal: trimmed || undefined });
  };

  const saveDates = (nextStart: string, nextEnd: string) => {
    if (!isIsoDate(nextStart) || !isIsoDate(nextEnd)) {
      // A half-filled pair waits for the other date.
      if (nextStart || nextEnd)
        setErrors((e) => ({ ...e, dates: "Pick both the first and last day." }));
      return;
    }
    if (nextEnd <= nextStart) {
      setErrors((e) => ({ ...e, dates: "The last day comes after the first." }));
      return;
    }
    setErrors((e) => ({ ...e, dates: undefined }));
    if (nextStart !== sprint.startDate.slice(0, 10) || nextEnd !== sprint.endDate.slice(0, 10)) {
      onEdit({ startDate: nextStart, endDate: nextEnd });
    }
  };

  const savePlanned = () => {
    const n = planned.trim() === "" ? NaN : Number(planned);
    if (!Number.isFinite(n) || n < 0) {
      setErrors((e) => ({ ...e, points: "Enter 0 or more points." }));
      return;
    }
    setErrors((e) => ({ ...e, points: undefined }));
    if (n !== sprint.pointsPlanned) onEdit({ pointsPlanned: n });
  };

  const changeStatus = (next: string) => {
    const status = next as Sprint["status"];
    if (status === sprint.status) return;
    if (status === "completed") onRequestClose();
    else if (sprint.status === "completed") onReopen(status);
    else onEdit({ status });
  };

  return (
    <div
      id={id}
      className="mt-4 grid gap-4 border-t border-border pt-4 sm:grid-cols-2 lg:grid-cols-3"
    >
      <Field label="Name" required error={errors.name}>
        {(control) => (
          <Input
            {...control}
            value={name}
            maxLength={80}
            onChange={(e) => setName(e.target.value)}
            onBlur={saveName}
            {...commitKeys(saveName, () => setName(sprint.name))}
          />
        )}
      </Field>
      <Field label="Sprint goal">
        {(control) => (
          <Input
            {...control}
            value={goal}
            maxLength={200}
            placeholder="What this sprint is for"
            onChange={(e) => setGoal(e.target.value)}
            onBlur={saveGoal}
            {...commitKeys(saveGoal, () => setGoal(sprint.goal ?? ""))}
          />
        )}
      </Field>
      <Field label="Status">
        {(control) => (
          <Select value={sprint.status} onValueChange={changeStatus}>
            <SelectTrigger {...control}>
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              {(Object.keys(STATUS_LABEL) as Sprint["status"][]).map((s) => (
                <SelectItem key={s} value={s}>
                  {STATUS_LABEL[s]}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        )}
      </Field>
      <Field label="Committed points" error={errors.points}>
        {(control) => (
          <Input
            {...control}
            type="number"
            inputMode="decimal"
            min={0}
            value={planned}
            onChange={(e) => setPlanned(e.target.value)}
            onBlur={savePlanned}
            {...commitKeys(savePlanned, () => setPlanned(fmt(sprint.pointsPlanned)))}
          />
        )}
      </Field>
      <Field label="First day" error={errors.dates}>
        {(control) => (
          <Input
            {...control}
            ref={startRef}
            type="date"
            value={start}
            onChange={(e) => setStart(e.target.value)}
            onBlur={() => saveDates(start, end)}
            {...commitKeys(
              () => saveDates(start, end),
              () => setStart(sprint.startDate.slice(0, 10))
            )}
          />
        )}
      </Field>
      <Field label="Last day">
        {(control) => (
          <Input
            {...control}
            type="date"
            value={end}
            onChange={(e) => setEnd(e.target.value)}
            onBlur={() => saveDates(start, end)}
            {...commitKeys(
              () => saveDates(start, end),
              () => setEnd(sprint.endDate.slice(0, 10))
            )}
          />
        )}
      </Field>
    </div>
  );
}
