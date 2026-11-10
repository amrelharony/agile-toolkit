"use client";

/**
 * A story's acceptance criteria, notes, ticket key and link: read them, and
 * edit them in place. Sprint Planning opens the panel from a story's row;
 * Refinement shows it beside the Definition of Ready ticks for the story
 * being refined. Both save through `onSave` with the cleaned values, so the
 * same caps and the same link rule hold on either page
 * (lib/stories/fields.ts).
 */

import { useEffect, useRef, useState } from "react";
import { ExternalLink, Pencil, Plus } from "lucide-react";
import { ItemForm, useItemForm } from "@/components/shared/item-form";
import { Button } from "@/components/ui/button";
import { Field } from "@/components/ui/field";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import type { Story } from "@/lib/stores/workspace-types";
import {
  STORY_CRITERIA_MAX,
  STORY_LINK_MAX,
  STORY_NOTES_MAX,
  STORY_TICKET_KEY_MAX,
  hasStoryDetails,
  storyDetailsDraft,
  storyLink,
  validateStoryDetails,
  type StoryDetails,
  type StoryDetailsDraft,
  type StoryTextField,
} from "@/lib/stories/fields";
import { cn } from "@/lib/utils";

type DetailedStory = Pick<Story, "title" | StoryTextField>;

/**
 * The story's ticket: its key as a link to the issue in the team's tracker,
 * opened in a new tab. With a key and no link it is plain text; with a link
 * and no key the link reads "Open issue". Nothing when it has neither. The
 * link is checked again here, so only an http or https address ever reaches
 * an `href`, whatever a synced row holds.
 */
export function StoryTicket({ story, className }: { story: DetailedStory; className?: string }) {
  const key = story.ticketKey?.trim();
  const href = storyLink(story.link);
  if (!href) {
    return key ? <span className={cn("font-data text-xs text-sub", className)}>{key}</span> : null;
  }
  return (
    <a
      href={href}
      target="_blank"
      rel="noopener noreferrer"
      className={cn(
        "group inline-flex items-center rounded text-xs text-accent focus-visible:outline-none pointer-coarse:min-h-11",
        className
      )}
    >
      <span className="inline-flex items-center gap-1 rounded underline underline-offset-2 group-focus-visible:ring-2 group-focus-visible:ring-accent">
        <span className={key ? "font-data" : undefined}>{key ?? "Open issue"}</span>
        <ExternalLink className="h-3 w-3 shrink-0" aria-hidden="true" />
      </span>
      <span className="sr-only">
        : {key ? "open the issue for " : ""}
        {story.title} (opens in a new tab)
      </span>
    </a>
  );
}

const TEXT = "mt-0.5 whitespace-pre-wrap break-words text-sm text-text";
const TERM = "text-xs font-medium text-sub";

/** The four fields as text. Renders nothing for a story with none of them. */
function DetailsView({ story }: { story: DetailedStory }) {
  const criteria = story.acceptanceCriteria?.trim();
  const notes = story.notes?.trim();
  const ticket = Boolean(story.ticketKey?.trim() || storyLink(story.link));
  if (!criteria && !notes && !ticket) return null;
  return (
    <dl className="space-y-3">
      {criteria && (
        <div>
          <dt className={TERM}>Acceptance criteria</dt>
          <dd className={TEXT}>{criteria}</dd>
        </div>
      )}
      {notes && (
        <div>
          <dt className={TERM}>Notes</dt>
          <dd className={TEXT}>{notes}</dd>
        </div>
      )}
      {ticket && (
        <div>
          <dt className={TERM}>Ticket</dt>
          <dd className="mt-0.5">
            <StoryTicket story={story} className="text-sm" />
          </dd>
        </div>
      )}
    </dl>
  );
}

function DetailsForm({
  story,
  onSave,
  onCancel,
}: {
  story: DetailedStory;
  onSave: (details: StoryDetails) => void;
  onCancel: () => void;
}) {
  const form = useItemForm<StoryDetailsDraft, StoryDetails, StoryTextField>({
    initial: () => storyDetailsDraft(story),
    validate: validateStoryDetails,
    onSave,
    resetOnSave: false,
  });
  const first = useRef<HTMLTextAreaElement>(null);
  useEffect(() => first.current?.focus(), []);

  return (
    <ItemForm form={form} submitLabel="Save details" onCancel={onCancel}>
      <Field
        label="Acceptance criteria"
        hint="How the team will know it is done right. One per line works well."
        error={form.errors.acceptanceCriteria}
      >
        {(control) => (
          <Textarea
            {...control}
            ref={first}
            rows={4}
            maxLength={STORY_CRITERIA_MAX}
            value={form.draft.acceptanceCriteria}
            onChange={(e) => form.update({ acceptanceCriteria: e.target.value })}
          />
        )}
      </Field>
      <Field label="Notes" error={form.errors.notes}>
        {(control) => (
          <Textarea
            {...control}
            rows={3}
            maxLength={STORY_NOTES_MAX}
            value={form.draft.notes}
            onChange={(e) => form.update({ notes: e.target.value })}
          />
        )}
      </Field>
      <div className="grid gap-3 sm:grid-cols-[minmax(0,10rem)_minmax(0,1fr)]">
        <Field label="Ticket key" error={form.errors.ticketKey}>
          {(control) => (
            <Input
              {...control}
              maxLength={STORY_TICKET_KEY_MAX}
              placeholder="e.g. PAY-12"
              autoComplete="off"
              value={form.draft.ticketKey}
              onChange={(e) => form.update({ ticketKey: e.target.value })}
            />
          )}
        </Field>
        <Field
          label="Link to the issue"
          hint="An address that starts with https://. It opens in a new tab."
          error={form.errors.link}
        >
          {(control) => (
            <Input
              {...control}
              type="url"
              inputMode="url"
              maxLength={STORY_LINK_MAX}
              placeholder="https://"
              autoComplete="off"
              value={form.draft.link}
              onChange={(e) => form.update({ link: e.target.value })}
            />
          )}
        </Field>
      </div>
    </ItemForm>
  );
}

export interface StoryDetailsPanelProps {
  story: DetailedStory;
  /** Save the four fields: a field left out of `details` was cleared. */
  onSave: (details: StoryDetails) => void;
  /** Open on the form instead of the text (a story with nothing to read yet). */
  startEditing?: boolean;
  /**
   * The form closed with nothing to show: cancelled, or saved empty, on a
   * story that has none of the four. A page that opens the panel on demand
   * closes it; one that always shows it leaves this out.
   */
  onEmpty?: () => void;
  id?: string;
  className?: string;
}

/**
 * The details of one story: the text, with a button that turns it into a
 * form. Saving or cancelling puts focus back on that button.
 */
export function StoryDetailsPanel({
  story,
  onSave,
  startEditing = false,
  onEmpty,
  id,
  className,
}: StoryDetailsPanelProps) {
  const [editing, setEditing] = useState(startEditing);
  const editButton = useRef<HTMLButtonElement>(null);
  const refocus = useRef(false);
  useEffect(() => {
    if (editing || !refocus.current) return;
    refocus.current = false;
    editButton.current?.focus();
  }, [editing]);

  const has = hasStoryDetails(story);
  const close = (stillHas: boolean) => {
    refocus.current = true;
    setEditing(false);
    if (!stillHas) onEmpty?.();
  };

  return (
    <div
      id={id}
      role="group"
      aria-label={`Details of ${story.title}`}
      className={cn("space-y-3", className)}
    >
      {editing ? (
        <DetailsForm
          story={story}
          onSave={(details) => {
            onSave(details);
            close(hasStoryDetails(details));
          }}
          onCancel={() => close(has)}
        />
      ) : (
        <>
          {has ? (
            <DetailsView story={story} />
          ) : (
            <p className="text-sm text-sub">No acceptance criteria, notes or link yet.</p>
          )}
          <Button
            ref={editButton}
            type="button"
            size="sm"
            variant="outline"
            className="gap-1.5"
            onClick={() => setEditing(true)}
          >
            {has ? <Pencil aria-hidden="true" /> : <Plus aria-hidden="true" />}
            {has ? "Edit details" : "Add details"}
            <span className="sr-only">: {story.title}</span>
          </Button>
        </>
      )}
    </div>
  );
}
