"use client";

import { useEffect, useState } from "react";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Field } from "@/components/ui/field";
import { Input } from "@/components/ui/input";
import type { Sprint } from "@/lib/stores/workspace-types";
import { DEFAULT_SPRINT_DAYS, endDateFor, statusFromDates, todayIso } from "@/lib/sprints/series";
import { createSprint } from "@/lib/sprints/store";

export interface NewSprintDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  /** Called with the saved sprint. */
  onCreated: (sprint: Sprint) => void;
  /** Suggested name, e.g. "Sprint 7". */
  defaultName?: string;
  /** Suggested start date (YYYY-MM-DD); defaults to today. */
  defaultStart?: string;
  /** Suggested length in days; defaults to 10. */
  defaultLengthDays?: number;
}

interface Errors {
  name?: string;
  start?: string;
  end?: string;
  points?: string;
}

/**
 * Create a shared sprint: name, dates and planned points. Every sprint tool
 * and the Sprint Metrics hub see it at once. Its status follows its dates
 * (planned, active, or completed for one entered after the fact).
 */
export function NewSprintDialog({
  open,
  onOpenChange,
  onCreated,
  defaultName = "",
  defaultStart,
  defaultLengthDays = DEFAULT_SPRINT_DAYS,
}: NewSprintDialogProps) {
  const [name, setName] = useState(defaultName);
  const [start, setStart] = useState("");
  const [end, setEnd] = useState("");
  const [points, setPoints] = useState("");
  const [errors, setErrors] = useState<Errors>({});

  // Fresh suggestions each time it opens.
  useEffect(() => {
    if (!open) return;
    const s = defaultStart ?? todayIso();
    setName(defaultName);
    setStart(s);
    setEnd(endDateFor(s, defaultLengthDays));
    setPoints("");
    setErrors({});
  }, [open, defaultName, defaultStart, defaultLengthDays]);

  const submit = (e: React.FormEvent) => {
    e.preventDefault();
    const next: Errors = {};
    const trimmed = name.trim();
    if (!trimmed) next.name = "Give the sprint a name.";
    if (!/^\d{4}-\d{2}-\d{2}$/.test(start)) next.start = "Pick the first day of the sprint.";
    if (!/^\d{4}-\d{2}-\d{2}$/.test(end)) next.end = "Pick the last day of the sprint.";
    else if (!next.start && end <= start) next.end = "The last day comes after the first.";
    const planned = points.trim() === "" ? 0 : Number(points);
    if (!Number.isFinite(planned) || planned < 0) next.points = "Enter 0 or more points.";
    setErrors(next);
    if (Object.keys(next).length > 0) return;

    const status = statusFromDates({ startDate: start, endDate: end });
    const sprint = createSprint({
      name: trimmed,
      startDate: start,
      endDate: end,
      pointsPlanned: planned,
      status,
    });
    onCreated(sprint);
    onOpenChange(false);
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-md">
        <form onSubmit={submit} noValidate className="flex flex-col gap-4">
          <DialogHeader>
            <DialogTitle>New sprint</DialogTitle>
            <DialogDescription>
              Shared by Burndown, Burnup, Velocity, Sprint Comparison and Sprint Metrics.
            </DialogDescription>
          </DialogHeader>
          <Field label="Name" required error={errors.name}>
            {(control) => (
              <Input
                {...control}
                value={name}
                onChange={(e) => setName(e.target.value)}
                placeholder="Sprint 7"
                maxLength={80}
                autoFocus
              />
            )}
          </Field>
          <div className="grid grid-cols-2 gap-3">
            <Field label="First day" required error={errors.start}>
              {(control) => (
                <Input
                  {...control}
                  type="date"
                  value={start}
                  onChange={(e) => setStart(e.target.value)}
                />
              )}
            </Field>
            <Field label="Last day" required error={errors.end}>
              {(control) => (
                <Input
                  {...control}
                  type="date"
                  value={end}
                  onChange={(e) => setEnd(e.target.value)}
                />
              )}
            </Field>
          </div>
          <Field
            label="Planned points"
            hint="What the team committed to. You can change it later."
            error={errors.points}
          >
            {(control) => (
              <Input
                {...control}
                type="number"
                inputMode="decimal"
                min={0}
                value={points}
                onChange={(e) => setPoints(e.target.value)}
                placeholder="0"
              />
            )}
          </Field>
          <DialogFooter className="gap-2 sm:gap-0">
            <Button type="button" variant="outline" onClick={() => onOpenChange(false)}>
              Cancel
            </Button>
            <Button type="submit">Create sprint</Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
