"use client";

/**
 * The host's "add a story" form at the top of the queue. Enter adds from
 * the title and Ctrl/Cmd+Enter from the description; the title keeps focus
 * for the next one. An empty title or a full queue says so under the box
 * (./stories `validateStory`) instead of doing nothing.
 */

import { useRef, type ClipboardEvent, type ReactNode } from "react";
import { Plus } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Field } from "@/components/ui/field";
import { useItemForm } from "@/components/shared/item-form";
import {
  EMPTY_STORY_DRAFT,
  STORY_DESCRIPTION_MAX,
  STORY_TITLE_MAX,
  validateStory,
  type StoryDraft,
} from "./stories";

export function AddStoryForm({
  storyCount,
  onAdd,
  onPaste,
  footer,
}: {
  /** Stories in the queue now, for the full-queue check. */
  storyCount: number;
  onAdd: (story: StoryDraft) => void;
  /** Several pasted lines become one story each (the session screen handles it). */
  onPaste: (e: ClipboardEvent<HTMLInputElement>) => void;
  /** Extra controls after the Add button ("Add queued stories"). */
  footer?: ReactNode;
}) {
  const titleRef = useRef<HTMLInputElement>(null);
  const form = useItemForm<StoryDraft, StoryDraft, "title">({
    initial: EMPTY_STORY_DRAFT,
    validate: (d) => validateStory(d, storyCount),
    onSave: (story) => {
      onAdd(story);
      titleRef.current?.focus();
    },
  });

  return (
    <form
      ref={form.formRef}
      onSubmit={form.submit}
      noValidate
      className="flex flex-col gap-2"
      aria-label="Add a story"
    >
      <Field label="New story title" hideLabel error={form.errors.title}>
        {(props) => (
          <Input
            {...props}
            ref={titleRef}
            value={form.draft.title}
            onChange={(e) => form.update({ title: e.target.value })}
            onKeyDown={(e) => {
              // Handled here, not left to the form's implicit submit, so an
              // IME composition's Enter doesn't add a half-typed story.
              if (e.key !== "Enter" || e.nativeEvent.isComposing) return;
              e.preventDefault();
              form.submit();
            }}
            onPaste={onPaste}
            maxLength={STORY_TITLE_MAX}
            placeholder="Story title…"
            className="h-9 pointer-coarse:min-h-11 text-sm bg-surface-deep border-border text-text"
          />
        )}
      </Field>
      <Textarea
        value={form.draft.description}
        onChange={(e) => form.update({ description: e.target.value })}
        onKeyDown={(e) => {
          if (e.key === "Enter" && (e.metaKey || e.ctrlKey)) {
            e.preventDefault();
            form.submit();
          }
        }}
        placeholder="Description (optional)..."
        rows={2}
        maxLength={STORY_DESCRIPTION_MAX}
        className="bg-surface-deep border-border resize-none text-xs text-text"
        aria-label="New story description"
      />
      <div className="flex flex-wrap items-center gap-2">
        <Button type="submit" size="sm" className="gap-1.5 pointer-coarse:min-h-11">
          <Plus aria-hidden="true" />
          Add story
        </Button>
        {footer}
      </div>
    </form>
  );
}
