"use client";

import { Pencil, Trash2, UserRound } from "lucide-react";
import { IconButton } from "@/components/ui/icon-button";
import { cn } from "@/lib/utils";
import { URGENT_WITHIN_DAYS, dueText } from "@/lib/prioritization/methods/eisenhower";
import { urgentReason, type TaskView } from "./model";

/** A due chip's tone: overdue in danger, urgent-soon in warning, later muted. */
function dueTone(days: number): string {
  if (days < 0) return "border-danger/40 text-danger";
  if (days <= URGENT_WITHIN_DAYS) return "border-warning/40 text-warning";
  return "border-border text-sub";
}

/**
 * One task in its pane: the title, a due chip ("2 days overdue", "due in
 * 3 days"), why the date made it urgent, who takes it ("Nobody yet" in
 * Delegate), and Edit and Delete.
 */
export function TaskRow({
  task,
  inDelegate,
  onEdit,
  onRemove,
}: {
  task: TaskView;
  inDelegate: boolean;
  onEdit: () => void;
  onRemove: () => void;
}) {
  const { row } = task.ranked;
  const days = task.urgency.daysToDue;
  const reason = urgentReason(task.urgency);
  return (
    <div className="flex flex-wrap items-start gap-x-3 gap-y-1">
      <div className="min-w-0 flex-1 basis-40 space-y-1">
        <p className="break-words text-sm text-text">{row.title}</p>
        <div className="flex flex-wrap items-center gap-1.5 text-xs">
          {days !== null && task.dueAt && (
            <span
              className={cn("rounded-full border px-2 py-0.5", dueTone(days))}
              title={task.dueAt}
            >
              {dueText(days)}
            </span>
          )}
          {(inDelegate || task.delegateTo) && (
            <span
              className={cn(
                "inline-flex items-center gap-1 rounded-full border px-2 py-0.5",
                task.delegateTo ? "border-border text-text" : "border-warning/40 text-warning"
              )}
            >
              <UserRound className="h-3 w-3" aria-hidden="true" />
              <span className="sr-only">Who takes it: </span>
              {task.delegateTo ?? "Nobody yet"}
            </span>
          )}
        </div>
        {reason && <p className="text-xs text-sub">{reason}.</p>}
      </div>
      <span className="flex shrink-0 items-center">
        <IconButton
          label={`Edit ${row.title}`}
          icon={<Pencil className="h-4 w-4" />}
          className="text-sub hover:text-text"
          onClick={onEdit}
        />
        <IconButton
          label={`Delete ${row.title}`}
          icon={<Trash2 className="h-4 w-4" />}
          className="text-sub hover:text-danger"
          onClick={onRemove}
        />
      </span>
    </div>
  );
}
