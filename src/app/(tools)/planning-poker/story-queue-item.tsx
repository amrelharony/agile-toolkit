"use client";

/**
 * One story in the Planning Poker queue. Everyone sees the title, the
 * description and the estimate; the host can also open it for estimating
 * (the row itself), edit it, and delete it.
 *
 * Edit turns the row into the shared inline form (title and description):
 * Enter saves from the title, Ctrl/Cmd+Enter from the description, Escape
 * cancels, an emptied title reverts. Guests and visitor-room participants
 * get no Edit or Delete control.
 */

import { Pencil, Trash2 } from "lucide-react";
import { IconButton } from "@/components/ui/icon-button";
import {
  InlineItemEditor,
  useInlineEdit,
  type ItemText,
} from "@/components/shared/inline-item-editor";
import { cn } from "@/lib/utils";
import type { Story } from "./types";
import { STORY_DESCRIPTION_MAX, STORY_TITLE_MAX } from "./stories";

export function StoryQueueItem({
  story,
  current,
  isHost,
  onSelect,
  onEdit,
  onDelete,
}: {
  story: Story;
  /** This is the story being estimated. */
  current: boolean;
  isHost: boolean;
  onSelect: () => void;
  onEdit: (next: ItemText) => void;
  onDelete: () => void;
}) {
  const edit = useInlineEdit();

  if (edit.editing && isHost) {
    return (
      <div className="rounded-lg border border-accent/30 bg-surface-deep p-2">
        <InlineItemEditor
          label="Edit story"
          title={story.title}
          description={story.description ?? ""}
          withDescription
          titleLabel="Story title"
          descriptionLabel="Story description"
          titleMaxLength={STORY_TITLE_MAX}
          descriptionMaxLength={STORY_DESCRIPTION_MAX}
          onDone={(next, { refocus }) => {
            edit.stop({ refocus });
            if (next) onEdit(next);
          }}
        />
      </div>
    );
  }

  return (
    <div
      className={cn(
        "flex items-start rounded-lg text-xs transition-colors",
        current
          ? "bg-accent/10 border border-accent/30 text-accent"
          : "text-sub hover:bg-surface-hover hover:text-text"
      )}
    >
      <button
        type="button"
        onClick={onSelect}
        disabled={!isHost}
        aria-current={current ? "true" : undefined}
        className={cn(
          "flex min-w-0 flex-1 items-start justify-between gap-2 rounded-lg px-3 py-2 text-left",
          !isHost && "cursor-default"
        )}
      >
        <div className="flex-1 min-w-0">
          {/* Two lines, not one: the host's Edit and Delete share the row. */}
          <div className="line-clamp-2 break-words">{story.title}</div>
          {story.description && (
            <div className="text-sub text-xs mt-0.5 whitespace-pre-wrap break-words font-normal opacity-80">
              {story.description}
            </div>
          )}
        </div>
        {story.finalEstimate !== null ? (
          <span className="font-data shrink-0 text-accent-green">{story.finalEstimate}</span>
        ) : current ? (
          <span className="shrink-0 opacity-60">now</span>
        ) : null}
      </button>
      {isHost && (
        <div className="flex shrink-0 items-center gap-0.5 py-1 pr-1">
          <IconButton
            ref={edit.triggerRef}
            label={`Edit ${story.title}`}
            icon={<Pencil aria-hidden="true" />}
            tooltip={false}
            onClick={edit.start}
            className="h-7 w-7 md:h-7 md:w-7 text-sub hover:text-text [&_svg]:size-3.5"
          />
          <IconButton
            label={`Delete ${story.title}`}
            icon={<Trash2 aria-hidden="true" />}
            tooltip={false}
            variant="danger-ghost"
            onClick={onDelete}
            className="h-7 w-7 md:h-7 md:w-7 [&_svg]:size-3.5"
          />
        </div>
      )}
    </div>
  );
}
