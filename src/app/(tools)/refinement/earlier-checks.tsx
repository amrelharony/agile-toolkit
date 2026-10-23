"use client";

import { useEffect, useId, useRef, useState, type Ref } from "react";
import Link from "next/link";
import { ListChecks, ListPlus, Pencil, Plus, Save, Trash2 } from "lucide-react";
import { ConfirmDialog } from "@/components/shared/confirm-dialog";
import { useInlineEdit } from "@/components/shared/inline-item-editor";
import { ItemForm, useItemForm } from "@/components/shared/item-form";
import { Button } from "@/components/ui/button";
import { Field } from "@/components/ui/field";
import { IconButton } from "@/components/ui/icon-button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { todayLocalISO } from "@/lib/utils/formatters";
import { cn } from "@/lib/utils";
import {
  validateCheck,
  validateCheckEdit,
  type CheckDraft,
  type CheckEditDraft,
  type CheckEditValues,
  type CheckField,
} from "./session";
import {
  useRefinementStore,
  type CheckValues,
  type Criterion,
  type RefinementStore,
  type StorySave,
} from "./store";

const emptyDraft = (today: string): CheckDraft => ({
  storyName: "",
  description: "",
  date: today,
  checked: [],
});

function pctClass(passRate: number): string {
  return passRate === 100 ? "text-accent-green" : passRate > 0 ? "text-warning" : "text-danger";
}

/** A workspace story a check by name stands for: the one it was sent to, or one with its title. */
export interface BacklogMatch {
  id: string;
  title: string;
  /** Not started yet, so the session lists it. */
  inSession: boolean;
}

/**
 * Checks saved by name: how stories were checked before the session read
 * the backlog, and still the way to check one that isn't in it (another
 * team's story, a ticket from elsewhere). "Add to backlog" turns one into a
 * backlog story, ticks included, which the session then picks up; a check
 * naming a story the backlog already has links to it instead.
 */
export function EarlierChecks({
  history,
  criteria,
  onAdd,
  onEdit,
  onRemove,
  onClear,
  onAddToBacklog,
  backlogStoryOf,
  backlogStoryNamed,
  onOpenStory,
}: {
  history: readonly StorySave[];
  criteria: readonly Criterion[];
  onAdd: (values: CheckValues) => void;
  onEdit: (id: string, values: CheckEditValues) => void;
  onRemove: (check: StorySave) => void;
  onClear: () => void;
  onAddToBacklog: (check: StorySave) => void;
  /** The backlog story a check was sent to (while it exists), or one with its name. */
  backlogStoryOf: (check: StorySave) => BacklogMatch | null;
  /** A backlog story with this name, if there is one. */
  backlogStoryNamed: (name: string) => BacklogMatch | null;
  /** Open a story in the session panel. */
  onOpenStory: (id: string) => void;
}) {
  const [open, setOpen] = useState(false);
  const [confirmClear, setConfirmClear] = useState(false);
  const formId = useId();
  const count = history.length;
  const label = `${count} earlier ${count === 1 ? "check" : "checks"}`;

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center gap-2">
        <Button
          type="button"
          variant="outline"
          size="sm"
          className="gap-1.5"
          aria-expanded={open}
          aria-controls={formId}
          onClick={() => setOpen((o) => !o)}
        >
          <Plus aria-hidden="true" />
          Check a story by name
        </Button>
        {count > 0 && (
          <Button
            type="button"
            variant="danger-ghost"
            size="sm"
            className="ml-auto text-xs"
            onClick={() => setConfirmClear(true)}
          >
            Clear earlier checks
          </Button>
        )}
      </div>

      <div id={formId} hidden={!open}>
        <CheckByNameForm
          criteria={criteria}
          onOpen={() => setOpen(true)}
          onClose={() => setOpen(false)}
          onAdd={onAdd}
          backlogStoryNamed={backlogStoryNamed}
          onOpenStory={onOpenStory}
        />
      </div>

      {count === 0 ? (
        <p className="text-sm text-sub">
          No earlier checks. Stories in the backlog are checked in the session above; check one that
          isn&rsquo;t there by name.
        </p>
      ) : (
        <ol aria-label="Earlier checks" className="divide-y divide-border">
          {history.map((h) => (
            <CheckItem
              key={h.id}
              check={h}
              backlogStory={backlogStoryOf(h)}
              onEdit={(values) => onEdit(h.id, values)}
              onRemove={() => onRemove(h)}
              onAddToBacklog={() => onAddToBacklog(h)}
              onOpenStory={onOpenStory}
            />
          ))}
        </ol>
      )}

      <ConfirmDialog
        open={confirmClear}
        onOpenChange={setConfirmClear}
        title="Clear the earlier checks?"
        description={`All ${label} will be removed, and the pass-rate trend loses them. Readiness saved on backlog stories stays.`}
        confirmLabel="Clear checks"
        onConfirm={onClear}
      />
    </div>
  );
}

/**
 * One earlier check, edited in place. Save, Cancel or Escape puts focus
 * back on its Edit button, as the criteria list does.
 */
function CheckItem({
  check,
  backlogStory,
  onEdit,
  onRemove,
  onAddToBacklog,
  onOpenStory,
}: {
  check: StorySave;
  backlogStory: BacklogMatch | null;
  onEdit: (values: CheckEditValues) => void;
  onRemove: () => void;
  onAddToBacklog: () => void;
  onOpenStory: (id: string) => void;
}) {
  const edit = useInlineEdit();
  return (
    <li className="py-3">
      {edit.editing ? (
        <CheckEditor
          check={check}
          onSave={(values) => {
            edit.stop({ refocus: true });
            onEdit(values);
          }}
          onCancel={() => edit.stop({ refocus: true })}
        />
      ) : (
        <CheckRow
          check={check}
          backlogStory={backlogStory}
          editRef={edit.triggerRef}
          onEdit={edit.start}
          onRemove={onRemove}
          onAddToBacklog={onAddToBacklog}
          onOpenStory={onOpenStory}
        />
      )}
    </li>
  );
}

function CheckRow({
  check,
  backlogStory,
  editRef,
  onEdit,
  onRemove,
  onAddToBacklog,
  onOpenStory,
}: {
  check: StorySave;
  backlogStory: BacklogMatch | null;
  editRef: Ref<HTMLButtonElement>;
  onEdit: () => void;
  onRemove: () => void;
  onAddToBacklog: () => void;
  onOpenStory: (id: string) => void;
}) {
  return (
    <div className="flex flex-wrap items-start gap-x-3 gap-y-2">
      <div className="min-w-0 flex-1 basis-40">
        <p className="break-words text-sm font-medium text-text">{check.storyName}</p>
        {check.description && (
          <p className="mt-0.5 whitespace-pre-wrap break-words text-xs text-sub">
            {check.description}
          </p>
        )}
        <p className="mt-1 text-xs text-sub">
          {check.date} · {check.metCount}/{check.totalCriteria} criteria met
        </p>
      </div>
      <span className={cn("font-data text-sm font-semibold", pctClass(check.passRate))}>
        {check.passRate}%
      </span>
      <span className="flex shrink-0 items-center gap-1">
        {backlogStory?.inSession ? (
          <Button
            type="button"
            size="sm"
            variant="ghost"
            className="gap-1 text-xs"
            aria-label={`Open in session: ${backlogStory.title}`}
            onClick={() => onOpenStory(backlogStory.id)}
          >
            <ListChecks aria-hidden="true" />
            Open in session
          </Button>
        ) : backlogStory ? (
          <Link
            href="/sprint-planning"
            className="px-2 text-xs text-accent underline-offset-2 hover:underline"
          >
            In the backlog
          </Link>
        ) : (
          <Button
            type="button"
            size="sm"
            variant="ghost"
            className="gap-1 text-xs"
            aria-label={`Add to backlog: ${check.storyName}`}
            onClick={onAddToBacklog}
          >
            <ListPlus aria-hidden="true" />
            Add to backlog
          </Button>
        )}
        <IconButton
          ref={editRef}
          label={`Edit ${check.storyName}`}
          icon={<Pencil className="h-4 w-4" />}
          className="text-sub hover:text-text"
          onClick={onEdit}
        />
        <IconButton
          label={`Delete ${check.storyName}`}
          icon={<Trash2 className="h-4 w-4" />}
          className="text-sub hover:text-danger"
          onClick={onRemove}
        />
      </span>
    </div>
  );
}

/** Name, description and date of a saved check, edited in place. */
function CheckEditor({
  check,
  onSave,
  onCancel,
}: {
  check: StorySave;
  onSave: (values: CheckEditValues) => void;
  onCancel: () => void;
}) {
  // Read on every render, not once: a page left open past midnight still
  // accepts today's date.
  const today = todayLocalISO();
  const form = useItemForm<CheckEditDraft, CheckEditValues, CheckField>({
    initial: {
      storyName: check.storyName,
      description: check.description ?? "",
      date: check.date,
    },
    validate: (d) => validateCheckEdit(d, todayLocalISO()),
    onSave,
    resetOnSave: false,
  });
  const { formRef } = form;
  useEffect(() => {
    formRef.current?.querySelector<HTMLElement>("input")?.focus();
  }, [formRef]);

  return (
    <ItemForm form={form} submitLabel="Save" onCancel={onCancel}>
      <Field label="Story name or ID" error={form.errors.storyName} required>
        {(props) => (
          <Input
            {...props}
            value={form.draft.storyName}
            onChange={(e) => form.update({ storyName: e.target.value })}
          />
        )}
      </Field>
      <Field label="Description">
        {(props) => (
          <Textarea
            {...props}
            rows={2}
            value={form.draft.description}
            onChange={(e) => form.update({ description: e.target.value })}
            className="resize-none text-sm"
          />
        )}
      </Field>
      <Field label="Checked on" error={form.errors.date} required>
        {(props) => (
          <Input
            {...props}
            type="date"
            max={today}
            value={form.draft.date}
            onChange={(e) => form.update({ date: e.target.value })}
            className="w-full sm:w-48"
          />
        )}
      </Field>
    </ItemForm>
  );
}

type StoredDraft = Pick<RefinementStore, "storyName" | "storyDescription" | "currentChecks">;

const tickedIds = (checks: Record<string, boolean>) =>
  Object.keys(checks).filter((id) => checks[id]);

/** The stored draft compared by value: what was typed and ticked. */
const draftKey = (d: StoredDraft) =>
  JSON.stringify([d.storyName, d.storyDescription, tickedIds(d.currentChecks).sort()]);

/**
 * The check-by-name form. Its draft is mirrored into the store, as the
 * page always did, so a half-filled check survives a reload. A change to
 * the stored draft from elsewhere (Reset clearing it, its Undo putting it
 * back) is read back into the form, so the two never disagree.
 */
function CheckByNameForm({
  criteria,
  onOpen,
  onClose,
  onAdd,
  backlogStoryNamed,
  onOpenStory,
}: {
  criteria: readonly Criterion[];
  onOpen: () => void;
  onClose: () => void;
  onAdd: (values: CheckValues) => void;
  backlogStoryNamed: (name: string) => BacklogMatch | null;
  onOpenStory: (id: string) => void;
}) {
  // Read on every render, not once: a page left open past midnight still
  // accepts today's date, and a new check starts on it.
  const today = todayLocalISO();
  const setDraft = useRefinementStore((s) => s.setDraft);
  const form = useItemForm<CheckDraft, CheckValues, CheckField>({
    initial: () => emptyDraft(todayLocalISO()),
    validate: (d) => validateCheck(d, criteria, todayLocalISO()),
    onSave: onAdd,
  });
  const { draft, reset } = form;
  const restored = useRef(false);
  // The stored draft as this form last wrote it.
  const mirrored = useRef<string | null>(null);

  // Mirror before restoring: the first run (with the empty draft) is skipped,
  // so it can't overwrite the saved draft before it's read.
  useEffect(() => {
    if (!restored.current) return;
    const next: StoredDraft = {
      storyName: draft.storyName,
      storyDescription: draft.description,
      currentChecks: Object.fromEntries(draft.checked.map((id) => [id, true])),
    };
    mirrored.current = draftKey(next);
    setDraft(next);
  }, [draft, setDraft]);

  useEffect(() => {
    if (restored.current) return;
    restored.current = true;
    const s = useRefinementStore.getState();
    const checked = tickedIds(s.currentChecks);
    if (s.storyName.trim() || s.storyDescription.trim() || checked.length > 0) {
      reset({ storyName: s.storyName, description: s.storyDescription, date: today, checked });
      onOpen();
    }
  }, [reset, today, onOpen]);

  // Anything other than this form's own mirror is an outside change.
  useEffect(
    () =>
      useRefinementStore.subscribe((s, prev) => {
        if (
          s.storyName === prev.storyName &&
          s.storyDescription === prev.storyDescription &&
          s.currentChecks === prev.currentChecks
        ) {
          return;
        }
        const key = draftKey(s);
        if (!restored.current || key === mirrored.current) return;
        mirrored.current = key;
        reset({
          storyName: s.storyName,
          description: s.storyDescription,
          date: todayLocalISO(),
          checked: tickedIds(s.currentChecks),
        });
      }),
    [reset]
  );

  const ticked = new Set(draft.checked);
  const met = criteria.filter((c) => ticked.has(c.id)).length;
  // Checking a story the session lists by name would leave its readiness
  // unset (and count the check twice): point to the session instead.
  const named = draft.storyName.trim() ? backlogStoryNamed(draft.storyName) : null;
  const match = named?.inSession ? named : null;

  return (
    <ItemForm
      form={form}
      submitLabel="Save check"
      submitIcon={<Save className="h-4 w-4" aria-hidden="true" />}
      onCancel={onClose}
      cancelLabel="Close"
      className="rounded-lg border border-border bg-surface-deep/40 p-3"
    >
      <Field label="Story name or ID" error={form.errors.storyName} required>
        {(props) => (
          <Input
            {...props}
            value={draft.storyName}
            onChange={(e) => form.update({ storyName: e.target.value })}
            placeholder="e.g. USER-42 — Add dark mode toggle"
          />
        )}
      </Field>
      {match && (
        <div role="status" className="flex flex-wrap items-center gap-x-2 gap-y-1 text-xs text-sub">
          <span className="min-w-0 break-words">
            &ldquo;{match.title}&rdquo; is already in the backlog. Check it in the session, so its
            readiness is saved on the story.
          </span>
          <Button
            type="button"
            size="sm"
            variant="ghost"
            className="h-7 gap-1 px-2 text-xs"
            onClick={() => onOpenStory(match.id)}
          >
            <ListChecks aria-hidden="true" />
            Open it in the session
          </Button>
        </div>
      )}
      <Field label="Description">
        {(props) => (
          <Textarea
            {...props}
            rows={2}
            value={draft.description}
            onChange={(e) => form.update({ description: e.target.value })}
            className="resize-none text-sm"
          />
        )}
      </Field>
      <Field
        label="Checked on"
        hint="Backdate it if the check happened earlier."
        error={form.errors.date}
        required
      >
        {(props) => (
          <Input
            {...props}
            type="date"
            max={today}
            value={draft.date}
            onChange={(e) => form.update({ date: e.target.value })}
            className="w-full sm:w-48"
          />
        )}
      </Field>
      {criteria.length > 0 && (
        <fieldset className="space-y-1.5">
          <legend className="mb-1 text-sm text-text">
            Criteria met ({met} of {criteria.length})
          </legend>
          {criteria.map((c) => (
            <label key={c.id} className="flex cursor-pointer items-start gap-2 text-sm text-text">
              <input
                type="checkbox"
                className="mt-0.5 h-4 w-4 shrink-0 accent-[var(--accent)]"
                checked={ticked.has(c.id)}
                onChange={(e) =>
                  form.update({
                    checked: e.target.checked
                      ? [...draft.checked, c.id]
                      : draft.checked.filter((x) => x !== c.id),
                  })
                }
              />
              <span className="min-w-0 break-words">{c.label}</span>
            </label>
          ))}
        </fieldset>
      )}
    </ItemForm>
  );
}
