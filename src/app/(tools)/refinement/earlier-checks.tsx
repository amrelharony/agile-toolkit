"use client";

import { useEffect, useId, useRef, useState } from "react";
import Link from "next/link";
import { ListPlus, Pencil, Plus, Save, Trash2 } from "lucide-react";
import { ConfirmDialog } from "@/components/shared/confirm-dialog";
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
import { useRefinementStore, type CheckValues, type Criterion, type StorySave } from "./store";

const emptyDraft = (today: string): CheckDraft => ({
  storyName: "",
  description: "",
  date: today,
  checked: [],
});

function pctClass(passRate: number): string {
  return passRate === 100 ? "text-accent-green" : passRate > 0 ? "text-warning" : "text-danger";
}

/**
 * Checks saved by name: how stories were checked before the session read
 * the backlog, and still the way to check one that isn't in it (another
 * team's story, a ticket from elsewhere). "Add to backlog" turns one into a
 * backlog story, which the session then picks up.
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
}: {
  history: readonly StorySave[];
  criteria: readonly Criterion[];
  onAdd: (values: CheckValues) => void;
  onEdit: (id: string, values: CheckEditValues) => void;
  onRemove: (check: StorySave) => void;
  onClear: () => void;
  onAddToBacklog: (check: StorySave) => void;
  /** The backlog story a check was sent to, while it still exists. */
  backlogStoryOf: (check: StorySave) => string | null;
}) {
  const [open, setOpen] = useState(false);
  const [confirmClear, setConfirmClear] = useState(false);
  const [editingId, setEditingId] = useState<string | null>(null);
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
            <li key={h.id} className="py-3">
              {editingId === h.id ? (
                <CheckEditor
                  check={h}
                  onSave={(values) => {
                    setEditingId(null);
                    onEdit(h.id, values);
                  }}
                  onCancel={() => setEditingId(null)}
                />
              ) : (
                <CheckRow
                  check={h}
                  backlogStoryId={backlogStoryOf(h)}
                  onEdit={() => setEditingId(h.id)}
                  onRemove={() => onRemove(h)}
                  onAddToBacklog={() => onAddToBacklog(h)}
                />
              )}
            </li>
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

function CheckRow({
  check,
  backlogStoryId,
  onEdit,
  onRemove,
  onAddToBacklog,
}: {
  check: StorySave;
  backlogStoryId: string | null;
  onEdit: () => void;
  onRemove: () => void;
  onAddToBacklog: () => void;
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
        {backlogStoryId ? (
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
  const [today] = useState(() => todayLocalISO());
  const form = useItemForm<CheckEditDraft, CheckEditValues, CheckField>({
    initial: {
      storyName: check.storyName,
      description: check.description ?? "",
      date: check.date,
    },
    validate: (d) => validateCheckEdit(d, today),
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

/**
 * The check-by-name form. Its draft is mirrored into the store, as the
 * page always did, so a half-filled check survives a reload.
 */
function CheckByNameForm({
  criteria,
  onOpen,
  onClose,
  onAdd,
}: {
  criteria: readonly Criterion[];
  onOpen: () => void;
  onClose: () => void;
  onAdd: (values: CheckValues) => void;
}) {
  const [today] = useState(() => todayLocalISO());
  const setDraft = useRefinementStore((s) => s.setDraft);
  const form = useItemForm<CheckDraft, CheckValues, CheckField>({
    initial: () => emptyDraft(today),
    validate: (d) => validateCheck(d, criteria, today),
    onSave: onAdd,
  });
  const { draft, reset } = form;
  const restored = useRef(false);

  // Mirror before restoring: the first run (with the empty draft) is skipped,
  // so it can't overwrite the saved draft before it's read.
  useEffect(() => {
    if (!restored.current) return;
    setDraft({
      storyName: draft.storyName,
      storyDescription: draft.description,
      currentChecks: Object.fromEntries(draft.checked.map((id) => [id, true])),
    });
  }, [draft, setDraft]);

  useEffect(() => {
    if (restored.current) return;
    restored.current = true;
    const s = useRefinementStore.getState();
    const checked = Object.keys(s.currentChecks).filter((id) => s.currentChecks[id]);
    if (s.storyName.trim() || s.storyDescription.trim() || checked.length > 0) {
      reset({ storyName: s.storyName, description: s.storyDescription, date: today, checked });
      onOpen();
    }
  }, [reset, today, onOpen]);

  const ticked = new Set(draft.checked);
  const met = criteria.filter((c) => ticked.has(c.id)).length;

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
