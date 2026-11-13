"use client";

/**
 * A story's acceptance criteria as Given/When/Then scenarios (`Story.gwt`):
 * read them, and add, change or delete them. They sit beside the free-text
 * acceptance criteria, which stay as they are: neither is made from the
 * other. Each change is handed to `onChange` with the whole list, cleaned
 * and capped by the page's write (lib/stories/fields.ts `withStoryGwt`).
 * A delete offers Undo, which puts the scenario back where it was in the
 * list as it is then. The delete and its Undo tell the page so (`GwtWrite`),
 * so it can put back the story's earlier `refinedAt` on the Undo.
 */

import { useEffect, useId, useRef, useState } from "react";
import { Pencil, Plus, Trash2 } from "lucide-react";
import { ItemForm, useItemForm } from "@/components/shared/item-form";
import { Button } from "@/components/ui/button";
import { Field } from "@/components/ui/field";
import { IconButton } from "@/components/ui/icon-button";
import { Textarea } from "@/components/ui/textarea";
import type { StoryGwt } from "@/lib/stores/workspace-types";
import {
  EMPTY_GWT_DRAFT,
  GWT_PARTS,
  GWT_PART_MAX,
  STORY_GWT_MAX,
  newGwtId,
  validateGwtDraft,
  type GwtDraft,
  type GwtPart,
  type GwtWrite,
} from "@/lib/stories/fields";
import { undoable } from "@/lib/utils/undoable";
import { cn } from "@/lib/utils";

const PART_LABEL: Record<GwtPart, string> = { given: "Given", when: "When", then: "Then" };
const PART_HINT: Record<GwtPart, string> = {
  given: "The situation before: who, and what is already true.",
  when: "What they do.",
  then: "What they see or get, so anyone can check it.",
};

const NO_ROWS: StoryGwt[] = [];

// Each delete's key, shared with its Undo: unique on the page.
let removeSeq = 0;

/** The scenarios, read only: each one's three parts under their words. */
export function GwtList({ gwt, className }: { gwt?: readonly StoryGwt[]; className?: string }) {
  const rows = gwt ?? NO_ROWS;
  if (rows.length === 0) return null;
  return (
    <ol className={cn("space-y-2", className)}>
      {rows.map((row, i) => (
        <li key={row.id} className="rounded-md border border-border bg-card px-2 py-1.5">
          <span className="sr-only">Scenario {i + 1}: </span>
          <GwtParts row={row} />
        </li>
      ))}
    </ol>
  );
}

function GwtParts({ row }: { row: StoryGwt }) {
  return (
    <dl className="grid grid-cols-[auto_minmax(0,1fr)] gap-x-2 gap-y-0.5 text-sm">
      {GWT_PARTS.map((part) => (
        <div key={part} className="contents">
          <dt className="font-semibold text-sub">{PART_LABEL[part]}</dt>
          <dd className="whitespace-pre-wrap break-words text-text">{row[part]}</dd>
        </div>
      ))}
    </dl>
  );
}

function GwtForm({
  initial,
  submitLabel,
  onSave,
  onCancel,
}: {
  initial: GwtDraft;
  submitLabel: string;
  onSave: (values: GwtDraft) => void;
  onCancel: () => void;
}) {
  const form = useItemForm<GwtDraft, GwtDraft, GwtPart>({
    initial,
    validate: validateGwtDraft,
    onSave,
    resetOnSave: false,
  });
  const first = useRef<HTMLTextAreaElement>(null);
  useEffect(() => first.current?.focus(), []);
  return (
    <ItemForm form={form} submitLabel={submitLabel} onCancel={onCancel} className="space-y-2">
      {GWT_PARTS.map((part, i) => (
        <Field key={part} label={PART_LABEL[part]} hint={PART_HINT[part]} error={form.errors[part]}>
          {(control) => (
            <Textarea
              {...control}
              ref={i === 0 ? first : undefined}
              rows={2}
              maxLength={GWT_PART_MAX}
              value={form.draft[part]}
              onChange={(e) => form.update({ [part]: e.target.value } as Partial<GwtDraft>)}
            />
          )}
        </Field>
      ))}
    </ItemForm>
  );
}

export interface GwtEditorProps {
  /** The story's title, for the controls' names. */
  title: string;
  gwt?: readonly StoryGwt[];
  /**
   * Save the whole list (an empty list clears it). `write` marks a delete
   * and its Undo, with one key.
   */
  onChange: (gwt: StoryGwt[], write?: GwtWrite) => void;
}

/**
 * The scenarios with an Edit and a Delete on each, and "Add a scenario".
 * At most STORY_GWT_MAX scenarios: past that, Add says so.
 */
export function GwtEditor({ title, gwt, onChange }: GwtEditorProps) {
  const rows = gwt ?? NO_ROWS;
  // The list as the page holds it now, for an Undo that runs after more edits.
  const latest = useRef(rows);
  latest.current = rows;
  const [editing, setEditing] = useState<string | null>(null);
  const [adding, setAdding] = useState(false);
  const addButton = useRef<HTMLButtonElement>(null);
  // Each scenario's Edit button, by id: focus goes back to it once its form closes.
  const editButtons = useRef(new Map<string, HTMLButtonElement>());
  const headingId = useId();
  const full = rows.length >= STORY_GWT_MAX;

  const closeEdit = (id: string) => {
    setEditing(null);
    requestAnimationFrame(() => (editButtons.current.get(id) ?? addButton.current)?.focus());
  };

  const closeAdd = () => {
    setAdding(false);
    requestAnimationFrame(() => addButton.current?.focus());
  };

  const add = (values: GwtDraft) => {
    const taken = new Set(latest.current.map((r) => r.id));
    onChange([...latest.current, { id: newGwtId(taken), ...values }]);
    closeAdd();
  };

  const save = (id: string, values: GwtDraft) => {
    onChange(latest.current.map((r) => (r.id === id ? { ...r, ...values } : r)));
    closeEdit(id);
  };

  const remove = (row: StoryGwt, index: number) => {
    const key = `gwt-remove-${++removeSeq}`;
    undoable({
      label: `Deleted scenario ${index + 1} of “${title.length > 40 ? `${title.slice(0, 39)}…` : title}”`,
      apply: () =>
        onChange(
          latest.current.filter((r) => r.id !== row.id),
          { kind: "remove", key }
        ),
      revert: () => {
        const now = latest.current;
        if (now.some((r) => r.id === row.id)) return;
        const next = [...now];
        next.splice(Math.min(index, next.length), 0, row);
        onChange(next, { kind: "restore", key });
      },
    });
    // The row's buttons go with it: focus moves to Add once the list redraws.
    requestAnimationFrame(() => addButton.current?.focus());
  };

  return (
    <section aria-labelledby={headingId} className="space-y-2">
      <h4 id={headingId} className="text-xs font-medium text-sub">
        Given / When / Then
      </h4>
      {rows.length === 0 && !adding && (
        <p className="text-sm text-sub">
          No scenarios yet. Each one says the situation, what someone does and what they get.
        </p>
      )}
      {rows.length > 0 && (
        <ol className="space-y-2" aria-label={`Scenarios for ${title}`}>
          {rows.map((row, i) => (
            <li key={row.id} className="rounded-md border border-border bg-card p-2">
              {editing === row.id ? (
                <GwtForm
                  initial={{ given: row.given, when: row.when, then: row.then }}
                  submitLabel="Save scenario"
                  onSave={(values) => save(row.id, values)}
                  onCancel={() => closeEdit(row.id)}
                />
              ) : (
                <div className="flex items-start gap-2">
                  <div className="min-w-0 flex-1">
                    <span className="sr-only">Scenario {i + 1}: </span>
                    <GwtParts row={row} />
                  </div>
                  <div className="flex shrink-0 gap-1">
                    <IconButton
                      ref={(el) => {
                        if (el) editButtons.current.set(row.id, el);
                        else editButtons.current.delete(row.id);
                      }}
                      label={`Edit scenario ${i + 1}`}
                      icon={<Pencil className="h-4 w-4" aria-hidden="true" />}
                      onClick={() => setEditing(row.id)}
                    />
                    <IconButton
                      label={`Delete scenario ${i + 1}`}
                      icon={<Trash2 className="h-4 w-4" aria-hidden="true" />}
                      onClick={() => remove(row, i)}
                    />
                  </div>
                </div>
              )}
            </li>
          ))}
        </ol>
      )}
      {adding ? (
        <div className="rounded-md border border-border bg-card p-2">
          <GwtForm
            initial={EMPTY_GWT_DRAFT}
            submitLabel="Add scenario"
            onSave={add}
            onCancel={closeAdd}
          />
        </div>
      ) : full ? (
        <p className="text-xs text-sub">
          {STORY_GWT_MAX} scenarios is the most a story keeps. Split the story if it needs more.
        </p>
      ) : (
        <Button
          ref={addButton}
          type="button"
          size="sm"
          variant="outline"
          className="gap-1.5"
          onClick={() => setAdding(true)}
        >
          <Plus aria-hidden="true" />
          Add a scenario
          <span className="sr-only">: {title}</span>
        </Button>
      )}
    </section>
  );
}
