"use client";

/**
 * A note's form, for a new note and for editing one: the day (backdated is
 * fine), an optional title, the text, tags, the event it came from and the
 * tool it is about. A template drops its prompts into the text. "Ask Amr for
 * tags" suggests tags from the text; an added tag goes into the form, and
 * only Save writes the note. Nothing is saved until the text is there and
 * the day has happened. The suggestions are announced when they arrive, and
 * dismissing them puts focus back on the button that asked.
 */

import { useId, useRef, useState, type ReactNode } from "react";
import { FileText, Plus } from "lucide-react";
import { useAnnounce } from "@/components/a11y/live-announcer";
import { AiButton, AiSuggestions } from "@/components/ai";
import { ItemForm, useItemForm } from "@/components/shared/item-form";
import { Button } from "@/components/ui/button";
import { Field } from "@/components/ui/field";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import type { AiSource } from "@/lib/ai/task-types";
import { notebookTagInput, notebookTagTask } from "@/lib/ai/tasks/sm-notebook";
import {
  NOTEBOOK_EVENTS,
  NOTE_BODY_MAX,
  NOTE_TAG_MAX,
  NOTE_TITLE_MAX,
  eventLabel,
  isDay,
  isKnownEvent,
  normTags,
  parseTags,
} from "@/lib/notebook/model";
import { NOTE_TEMPLATES } from "@/lib/notebook/templates";
import { pickableTools } from "@/lib/notebook/tools";
import type { NotebookEntry } from "@/lib/stores/workspace-types";
import { cn } from "@/lib/utils";
import {
  draftWithTag,
  draftWithTemplate,
  validateNote,
  type NoteDraft,
  type NoteField,
  type NoteValues,
} from "./form";

/** The native selects, sized like the kit's Input (44 px on touch). */
export const SELECT_CLASS =
  "flex h-11 pointer-coarse:min-h-11 pointer-fine:md:h-9 w-full rounded-md border border-input bg-card px-3 py-1 text-base text-text pointer-fine:md:text-sm focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring";

interface Suggested {
  tags: string[];
  source: AiSource;
}

export function NoteForm({
  initial,
  today,
  stored,
  knownTags,
  submitLabel,
  onSave,
  onCancel,
  resetOnSave = true,
  className,
}: {
  initial: () => NoteDraft;
  today: string;
  /** The saved note, when editing. */
  stored?: NotebookEntry;
  /** The notebook's tags, most used first, for Amr to reuse. */
  knownTags: readonly string[];
  submitLabel: string;
  onSave: (values: NoteValues) => void;
  onCancel?: () => void;
  resetOnSave?: boolean;
  className?: string;
}) {
  const [suggested, setSuggested] = useState<Suggested | null>(null);
  const form = useItemForm<NoteDraft, NoteValues, NoteField>({
    initial,
    validate: (d) => validateNote(d, today, stored),
    onSave: (values) => {
      setSuggested(null);
      onSave(values);
    },
    resetOnSave,
  });
  const { draft, update, errors } = form;
  const tools = pickableTools(draft.linkedTool || stored?.linkedTool);
  const blank = !draft.body.trim();
  const announce = useAnnounce();
  const tagAskRef = useRef<HTMLDivElement>(null);
  // An agent may have saved a day the calendar doesn't have; the date
  // field can't show it, so say what it is.
  const oddDay = stored && !isDay(stored.date) && draft.date === stored.date ? stored.date : null;

  const takeTags = (tags: readonly string[], source: AiSource) => {
    const have = parseTags(draft.tags);
    const fresh = normTags(tags).filter((t) => t.length <= NOTE_TAG_MAX && !have.includes(t));
    setSuggested({ tags: fresh, source });
    if (fresh.length === 0) announce("No new tags to suggest for this note.");
    else {
      const who = source === "fallback" ? "Suggested without AI" : "Amr suggests";
      announce(
        `${who}: ${fresh.length === 1 ? "1 tag" : `${fresh.length} tags`}, ${fresh.join(", ")}.`
      );
    }
  };
  /** The button that asked: focus goes back to it when the list is dismissed. */
  const tagAskButton = () => tagAskRef.current?.querySelector<HTMLElement>("button");
  const addTags = (tags: readonly string[]) =>
    update({ tags: normTags([...parseTags(draft.tags), ...tags]).join(", ") });

  return (
    <ItemForm
      form={form}
      submitLabel={submitLabel}
      submitIcon={<Plus className="h-4 w-4" aria-hidden="true" />}
      onCancel={onCancel}
      className={className}
    >
      <fieldset className="flex flex-wrap items-center gap-2">
        <legend className="mb-1.5 text-xs font-medium text-sub">Start from a template</legend>
        {NOTE_TEMPLATES.map((t) => (
          <Button
            key={t.id}
            type="button"
            size="sm"
            variant="outline"
            className="min-touch-coarse gap-1"
            onClick={() => update(draftWithTemplate(draft, t))}
          >
            <FileText aria-hidden="true" />
            {t.label}
          </Button>
        ))}
      </fieldset>

      <div className="grid grid-cols-1 gap-3 sm:grid-cols-[11rem_1fr]">
        <Field
          label="Day"
          hint={
            oddDay
              ? `Saved as ${oddDay}, which isn't on the calendar. Pick the day it's about.`
              : undefined
          }
          error={errors.date}
          required
        >
          {(props) => (
            <Input
              {...props}
              type="date"
              max={today}
              value={draft.date}
              onChange={(e) => update({ date: e.target.value })}
            />
          )}
        </Field>
        <Field label="Title" hint="Optional." error={errors.title}>
          {(props) => (
            <Input
              {...props}
              maxLength={Math.max(NOTE_TITLE_MAX, stored?.title?.length ?? 0)}
              value={draft.title}
              onChange={(e) => update({ title: e.target.value })}
              placeholder="Quiet Daily Scrum"
            />
          )}
        </Field>
      </div>

      <Field
        label="Note"
        hint="What you saw or tried, not what you think of people."
        error={errors.body}
        required
      >
        {(props) => (
          <Textarea
            {...props}
            rows={5}
            maxLength={Math.max(NOTE_BODY_MAX, stored?.body.length ?? 0)}
            value={draft.body}
            onChange={(e) => update({ body: e.target.value })}
          />
        )}
      </Field>

      <div className="space-y-2">
        <Field
          label="Tags"
          hint="Separate them with commas, such as blockers, participation."
          error={errors.tags}
        >
          {(props) => (
            <Input
              {...props}
              value={draft.tags}
              onChange={(e) => update({ tags: e.target.value })}
            />
          )}
        </Field>
        <div ref={tagAskRef}>
          <AiButton
            task={notebookTagTask}
            input={() =>
              notebookTagInput(
                { title: draft.title, body: draft.body, tags: parseTags(draft.tags) },
                knownTags
              )
            }
            onResult={(data, meta) => takeTags(data.tags, meta.source)}
            label="Ask Amr for tags"
            fallbackLabel="Suggest tags"
            variant="outline"
            disabledReason={blank ? "Write the note first, then ask for tags." : null}
          />
        </div>
        {suggested &&
          (suggested.tags.length > 0 ? (
            <AiSuggestions
              items={suggested.tags}
              source={suggested.source}
              title="Tags Amr suggests"
              acceptLabel="Add tag"
              onAccept={(tag) => update(draftWithTag(draft, tag))}
              onAcceptAll={(tags) => addTags(tags)}
              returnFocus={tagAskButton}
              onDismiss={() => setSuggested(null)}
            />
          ) : (
            // Announced when it comes (takeTags): a live region mounted with its text is often missed.
            <p className="text-xs text-sub">No new tags to suggest for this note.</p>
          ))}
      </div>

      <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
        <Field label="Event" hint="Where you noticed it." error={errors.event}>
          {(props) => (
            <select
              {...props}
              className={SELECT_CLASS}
              value={draft.event}
              onChange={(e) => update({ event: e.target.value })}
            >
              <option value="">No event</option>
              {NOTEBOOK_EVENTS.map((ev) => (
                <option key={ev.id} value={ev.id}>
                  {ev.label}
                </option>
              ))}
              {draft.event && !isKnownEvent(draft.event) && (
                <option value={draft.event}>{eventLabel(draft.event)}</option>
              )}
            </select>
          )}
        </Field>
        <Field
          label="About a tool"
          hint="Optional: the tool it concerns."
          error={errors.linkedTool}
        >
          {(props) => (
            <select
              {...props}
              className={SELECT_CLASS}
              value={draft.linkedTool}
              onChange={(e) => update({ linkedTool: e.target.value })}
            >
              <option value="">No tool</option>
              {tools.map((t) => (
                <option key={t.id} value={t.id}>
                  {t.name}
                </option>
              ))}
            </select>
          )}
        </Field>
      </div>
    </ItemForm>
  );
}

/** The card around the new-note form. */
export function NewNoteCard({ children, className }: { children: ReactNode; className?: string }) {
  const headingId = useId();
  return (
    <section
      aria-labelledby={headingId}
      className={cn("rounded-lg border border-border bg-card p-4", className)}
    >
      <h2 id={headingId} className="mb-3 text-base font-semibold text-text">
        New note
      </h2>
      {children}
    </section>
  );
}
