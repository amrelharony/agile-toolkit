"use client";

import { Trash2 } from "lucide-react";
import { IconButton } from "@/components/ui/icon-button";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { InlineItemEditor, useInlineEdit } from "@/components/shared/inline-item-editor";
import type { DodCategory, DodCriterion } from "@/lib/stores/workspace-types";
import {
  CRITERION_DESCRIPTION_MAX,
  CRITERION_LABEL_MAX,
  DOD_CATEGORIES,
  DOD_CATEGORY_LABEL,
} from "@/lib/dod/model";
import { cn } from "@/lib/utils";

/**
 * One criterion: its words and description (click to edit in place; an
 * emptied label reverts), Required or optional, its category, and Delete
 * (with Undo).
 */
export function CriterionRow({
  criterion,
  onText,
  onRequired,
  onCategory,
  onDelete,
}: {
  criterion: DodCriterion;
  onText: (c: DodCriterion, label: string, description: string | undefined) => void;
  onRequired: (c: DodCriterion, required: boolean) => void;
  onCategory: (c: DodCriterion, category: DodCategory) => void;
  onDelete: (c: DodCriterion) => void;
}) {
  const edit = useInlineEdit();
  return (
    <li className="flex flex-wrap items-start gap-x-3 gap-y-2 rounded-lg border border-border bg-surface p-3">
      <div className="min-w-0 flex-1 basis-56">
        {edit.editing ? (
          <InlineItemEditor
            label="Edit criterion"
            title={criterion.label}
            titleLabel="Criterion"
            titleMaxLength={CRITERION_LABEL_MAX}
            withDescription
            description={criterion.description}
            descriptionLabel="Criterion description"
            descriptionMaxLength={CRITERION_DESCRIPTION_MAX}
            onDone={(next, { refocus }) => {
              edit.stop({ refocus });
              if (next) onText(criterion, next.title, next.description);
            }}
          />
        ) : (
          <button
            ref={edit.triggerRef}
            type="button"
            onClick={edit.start}
            title="Click to edit"
            className="block w-full cursor-text break-words rounded-sm text-left text-sm text-text transition-colors hover:text-accent focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-accent"
          >
            <span className="font-medium">{criterion.label}</span>
            {criterion.description && (
              <span className="mt-0.5 block whitespace-pre-wrap text-xs text-sub">
                {criterion.description}
              </span>
            )}
            <span className="sr-only"> (edit)</span>
          </button>
        )}
      </div>
      <div className="flex w-full flex-wrap items-center gap-2 sm:w-auto">
        <label
          className={cn(
            "inline-flex min-h-9 cursor-pointer items-center gap-2 rounded-md border px-2 text-xs",
            criterion.required
              ? "border-accent/60 bg-accent/10 text-accent"
              : "border-border text-sub"
          )}
        >
          <input
            type="checkbox"
            className="h-4 w-4 accent-[var(--accent)]"
            checked={criterion.required}
            onChange={(e) => onRequired(criterion, e.target.checked)}
          />
          Required
          <span className="sr-only">: {criterion.label}</span>
        </label>
        <Select
          value={criterion.category}
          onValueChange={(v) => onCategory(criterion, v as DodCategory)}
        >
          <SelectTrigger
            aria-label={`Category of “${criterion.label}”`}
            className="h-9 w-auto min-w-[8.5rem] text-xs"
          >
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            {DOD_CATEGORIES.map((c) => (
              <SelectItem key={c} value={c}>
                {DOD_CATEGORY_LABEL[c]}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
        <IconButton
          label={`Delete “${criterion.label}”`}
          icon={<Trash2 className="h-4 w-4" />}
          className="h-9 w-9 text-sub hover:text-danger"
          onClick={() => onDelete(criterion)}
        />
      </div>
    </li>
  );
}
