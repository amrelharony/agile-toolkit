"use client";

/**
 * A Kanban card's title and description, click-to-edit. Clicking the title
 * (or Enter on it) opens one inline form for both, so a card without a
 * description can get one. Enter saves from the title, Ctrl/Cmd+Enter from
 * the description, Escape cancels, an emptied title reverts and an emptied
 * description is removed.
 */

import {
  InlineItemEditor,
  useInlineEdit,
  type ItemText,
} from "@/components/shared/inline-item-editor";

/** The add form's caps, so an edit can't grow a card past them. */
export const KANBAN_TITLE_MAX = 240;
export const KANBAN_DESCRIPTION_MAX = 4000;

export function KanbanCardText({
  title,
  description,
  onSave,
}: {
  title: string;
  description?: string;
  onSave: (next: ItemText) => void;
}) {
  const edit = useInlineEdit();

  if (edit.editing) {
    return (
      <InlineItemEditor
        className="mb-1.5"
        label="Edit card"
        title={title}
        description={description ?? ""}
        withDescription
        titleLabel="Card title"
        descriptionLabel="Card description"
        titleMaxLength={KANBAN_TITLE_MAX}
        descriptionMaxLength={KANBAN_DESCRIPTION_MAX}
        onDone={(next, { refocus }) => {
          edit.stop({ refocus });
          if (next) onSave(next);
        }}
      />
    );
  }

  return (
    <>
      <button
        ref={edit.triggerRef}
        type="button"
        onClick={edit.start}
        title="Click to edit"
        // On touch a one-line title is a 36 px target, like the card's
        // selects, not a 16 px strip of text. It still fits beside the 44 px
        // grip, so a card without a description doesn't grow.
        className="block w-full rounded-sm text-left font-medium text-text break-words cursor-text transition-colors hover:text-accent focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring pointer-coarse:py-2.5"
      >
        {title}
      </button>
      {description ? (
        <div className="text-sub text-xs mt-0.5 mb-1.5 whitespace-pre-wrap break-words">
          {description}
        </div>
      ) : (
        <div className="mb-1.5" />
      )}
    </>
  );
}
