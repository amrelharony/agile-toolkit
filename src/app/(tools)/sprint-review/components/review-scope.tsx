"use client";

import { SprintPicker } from "@/components/sprints/sprint-picker";
import { Button } from "@/components/ui/button";
import type { Sprint, SprintReview } from "@/lib/stores/workspace-types";
import { contentSummary } from "../doc";

const BANNER =
  "flex flex-col gap-2 rounded-lg border border-info/30 bg-info/10 p-3 text-sm text-text";

/**
 * Which review is on screen: a sprint's (picked with the shared sprint
 * picker) or the draft that isn't tied to one. A draft with content is
 * never hidden: while the chosen sprint's review is empty it is offered as
 * its starting point, and otherwise it can still be opened.
 */
export function ReviewScope({
  sprints,
  selected,
  inDraft,
  draft,
  sprintHasContent,
  onSelect,
  onOpenDraft,
  onCloseDraft,
  onStartFromDraft,
}: {
  /** Every sprint, newest first. */
  sprints: Sprint[];
  /** The shared sprint choice. */
  selected: Sprint | undefined;
  /** Showing the draft although a sprint is chosen. */
  inDraft: boolean;
  /** The draft, when it holds demo items, feedback or a checklist. */
  draft: SprintReview | null;
  /** Whether the chosen sprint's review has any of those yet. */
  sprintHasContent: boolean;
  onSelect: (sprintId: string) => void;
  onOpenDraft: () => void;
  onCloseDraft: () => void;
  onStartFromDraft: () => void;
}) {
  const onSprint = Boolean(selected) && !inDraft;
  const caption = !selected
    ? "This review isn't tied to a sprint. Add a sprint to build its review from the sprint's goal and done stories."
    : inDraft
      ? "Showing the draft that isn't tied to a sprint."
      : `One review per sprint. The goal, the done stories and the points come from ${selected.name}.`;
  const offer = Boolean(selected && draft && !sprintHasContent);

  return (
    <div className="flex flex-col gap-3">
      <div className="flex flex-wrap items-end gap-x-4 gap-y-2">
        <SprintPicker
          sprints={sprints}
          selectedId={onSprint ? selected?.id : undefined}
          onSelect={onSelect}
          label="Review of"
        />
        <p className="min-w-0 flex-1 basis-64 text-sm text-sub">{caption}</p>
      </div>

      {selected && inDraft && (
        <div className={BANNER} role="status">
          <p>
            {offer
              ? `${selected.name}'s review is empty. Start it from this draft: its demo items, feedback and checklist are copied, and the draft stays.`
              : `Back to ${selected.name} to review the sprint itself.`}
          </p>
          <div className="flex flex-wrap gap-2">
            {offer && (
              <Button type="button" size="sm" onClick={onStartFromDraft}>
                Start {selected.name}&apos;s review from it
              </Button>
            )}
            <Button type="button" size="sm" variant="outline" onClick={onCloseDraft}>
              Back to {selected.name}
            </Button>
          </div>
        </div>
      )}

      {selected && !inDraft && draft && (
        <div className={BANNER} role="status">
          <p>
            {offer
              ? `You have a review draft that isn't tied to a sprint: ${contentSummary(draft)}.`
              : "There's also a review draft that isn't tied to a sprint."}
          </p>
          <div className="flex flex-wrap gap-2">
            {offer && (
              <Button type="button" size="sm" onClick={onStartFromDraft}>
                Start from the draft
              </Button>
            )}
            <Button type="button" size="sm" variant="outline" onClick={onOpenDraft}>
              Open draft
            </Button>
          </div>
        </div>
      )}
    </div>
  );
}
