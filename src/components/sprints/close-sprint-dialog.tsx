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
import type { Sprint, SprintSeries } from "@/lib/stores/workspace-types";
import { fmt, suggestedCompletedPoints } from "@/lib/sprints/hub-view";

export interface CloseSprintDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  sprint: Sprint;
  series: SprintSeries | undefined;
  /** "close": mark it done with its points. "points": only add the missing points. */
  mode: "close" | "points";
  onConfirm: (pointsCompleted: number) => void;
}

/**
 * Close a sprint: it becomes "Done" with the points the team finished.
 * The number is suggested from the daily log and can be changed first.
 */
export function CloseSprintDialog({
  open,
  onOpenChange,
  sprint,
  series,
  mode,
  onConfirm,
}: CloseSprintDialogProps) {
  const [value, setValue] = useState("");
  const [error, setError] = useState<string | undefined>();
  const suggestion = suggestedCompletedPoints(sprint, series);

  // A fresh suggestion each time it opens.
  useEffect(() => {
    if (!open) return;
    setValue(suggestion.points === null ? "" : fmt(suggestion.points));
    setError(undefined);
    // Only on opening: the suggestion must not overwrite what's being typed.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open]);

  const hint =
    suggestion.fromDay !== null
      ? `Suggested from day ${suggestion.fromDay} of the daily log. Change it if it's wrong.`
      : "Nothing is logged yet, so enter what the team finished.";

  const submit = (e: React.FormEvent) => {
    e.preventDefault();
    const n = value.trim() === "" ? NaN : Number(value);
    if (!Number.isFinite(n) || n < 0) {
      setError("Enter 0 or more points.");
      return;
    }
    onConfirm(n);
    onOpenChange(false);
  };

  const closing = mode === "close";
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-md">
        <form onSubmit={submit} noValidate className="flex flex-col gap-4">
          <DialogHeader>
            <DialogTitle>{closing ? `Close ${sprint.name}` : "Add completed points"}</DialogTitle>
            <DialogDescription>
              {closing
                ? "The sprint is marked done. Velocity, Release Planner and the dashboard use its completed points."
                : "Velocity and forecasts skip a finished sprint until it has completed points."}
            </DialogDescription>
          </DialogHeader>
          <Field label="Completed points" required hint={hint} error={error}>
            {(control) => (
              <Input
                {...control}
                type="number"
                inputMode="decimal"
                min={0}
                value={value}
                onChange={(e) => setValue(e.target.value)}
                autoFocus
              />
            )}
          </Field>
          <p className="text-xs text-sub">Committed: {fmt(sprint.pointsPlanned)} points.</p>
          <DialogFooter className="gap-2 sm:gap-0">
            <Button type="button" variant="outline" onClick={() => onOpenChange(false)}>
              Cancel
            </Button>
            <Button type="submit">{closing ? "Close sprint" : "Save points"}</Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
