"use client";

import { useId, useState } from "react";
import { Plus } from "lucide-react";
import { Button } from "@/components/ui/button";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import type { Sprint } from "@/lib/stores/workspace-types";
import { hasSyntheticDates } from "@/lib/sprints/series";
import { NewSprintDialog } from "./new-sprint-dialog";

const STATUS_LABEL: Record<Sprint["status"], string> = {
  planned: "Planned",
  active: "Active",
  completed: "Done",
  cancelled: "Cancelled",
};

const shortDate = (iso: string) => {
  const m = /^(\d{4})-(\d{2})-(\d{2})/.exec(iso);
  if (!m) return "";
  return new Date(Number(m[1]), Number(m[2]) - 1, Number(m[3])).toLocaleDateString(undefined, {
    day: "numeric",
    month: "short",
  });
};

/** "Sprint 7 · 5 Oct – 16 Oct · Active" */
export function sprintLabel(sprint: Sprint): string {
  const dates = hasSyntheticDates(sprint)
    ? ""
    : ` · ${shortDate(sprint.startDate)} – ${shortDate(sprint.endDate)}`;
  return `${sprint.name}${dates} · ${STATUS_LABEL[sprint.status]}`;
}

/** Next name in a "Sprint N" sequence, from the existing names. */
export function nextSprintName(sprints: readonly Sprint[]): string {
  let max = 0;
  for (const s of sprints) {
    const m = /^sprint\s+(\d+)$/i.exec(s.name.trim());
    if (m) max = Math.max(max, Number(m[1]));
  }
  return `Sprint ${max + 1}`;
}

export interface SprintPickerProps {
  /** Every sprint, newest first (see `useSelectedSprint`). */
  sprints: Sprint[];
  selectedId: string | undefined;
  onSelect: (id: string) => void;
  /** Visible label; defaults to "Sprint". */
  label?: string;
  /** Hide "New sprint" (for read-only views). */
  allowCreate?: boolean;
  /** Called with a sprint made through "New sprint" (after it is selected). */
  onCreated?: (sprint: Sprint) => void;
  className?: string;
}

/**
 * Which shared sprint a tool is showing, plus "New sprint". The choice is
 * shared by every sprint tool (`useSelectedSprint`).
 */
export function SprintPicker({
  sprints,
  selectedId,
  onSelect,
  label = "Sprint",
  allowCreate = true,
  onCreated,
  className,
}: SprintPickerProps) {
  const [creating, setCreating] = useState(false);
  const triggerId = useId();

  return (
    <div className={`flex flex-wrap items-end gap-2 ${className ?? ""}`}>
      {sprints.length > 0 && (
        <div className="flex min-w-0 flex-col gap-1">
          <label htmlFor={triggerId} className="text-xs font-medium text-sub">
            {label}
          </label>
          <Select value={selectedId} onValueChange={onSelect}>
            <SelectTrigger id={triggerId} className="min-w-[14rem] max-w-full">
              <SelectValue placeholder="Choose a sprint" />
            </SelectTrigger>
            <SelectContent>
              {sprints.map((s) => (
                <SelectItem key={s.id} value={s.id}>
                  {sprintLabel(s)}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>
      )}
      {allowCreate && (
        <>
          <Button type="button" variant="outline" size="sm" onClick={() => setCreating(true)}>
            <Plus className="mr-1 h-4 w-4" aria-hidden="true" />
            New sprint
          </Button>
          <NewSprintDialog
            open={creating}
            onOpenChange={setCreating}
            defaultName={nextSprintName(sprints)}
            onCreated={(sprint) => {
              onSelect(sprint.id);
              onCreated?.(sprint);
            }}
          />
        </>
      )}
    </div>
  );
}
