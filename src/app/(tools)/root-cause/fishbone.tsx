"use client";

/**
 * The fishbone (Ishikawa) diagram as a phone-friendly board: the problem
 * as the head, then a box per category with its causes, each with how
 * often it happened. The six starting categories can be renamed (every
 * cause in one moves with the new name) and the team can add its own.
 * A category with no causes is only on this screen until a cause goes in
 * it: a category is the name on its causes.
 *
 * Counts feed the Pareto chart below. Ask Amr suggests which category a
 * cause belongs under; each move the person accepts goes through the
 * store, with Undo.
 */

import { useId, useMemo, useRef, useState, type FormEvent } from "react";
import { Minus, Pencil, Plus, Target, Trash2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { InlineItemEditor, useInlineEdit } from "@/components/shared/inline-item-editor";
import { AiButton, AiSuggestions } from "@/components/ai";
import { categoriesTask } from "@/lib/ai/tasks/root-cause";
import type { AiSource } from "@/lib/ai/task-types";
import {
  TOOL_LIST_MAX,
  TOOL_TEXT_MAX,
  type RootCauseAnalysis,
  type RootCauseCause,
} from "@/lib/stores/workspace-types";
import {
  CATEGORY_MAX,
  CAUSE_COUNT_MAX,
  categoriesOf,
  causesIn,
  cleanCount,
  type NewCause,
} from "@/lib/root-cause/model";
import { cn } from "@/lib/utils";

export interface FishboneProps {
  analysis: RootCauseAnalysis;
  readOnlyAi?: boolean;
  onAdd: (cause: NewCause) => void;
  onPatch: (causeId: string, patch: Partial<Omit<RootCauseCause, "id">>) => void;
  onRemove: (cause: RootCauseCause) => void;
  onRename: (from: string, to: string) => void;
  onMarkRoot: (text: string) => void;
  /** An accepted category suggestion (with Undo). */
  onMove: (causeId: string, category: string) => void;
}

export interface CauseDraft {
  category: string;
  text: string;
  count: string;
}

/** A new cause checked: its text, a category, and a whole count from 0. */
export function validateCause(
  draft: CauseDraft
):
  | { ok: true; value: NewCause }
  | { ok: false; errors: Partial<Record<keyof CauseDraft, string>> } {
  const errors: Partial<Record<keyof CauseDraft, string>> = {};
  const text = draft.text.trim();
  if (!text) errors.text = "Write the cause.";
  else if (text.length > TOOL_TEXT_MAX.text)
    errors.text = `Keep it to ${TOOL_TEXT_MAX.text} characters.`;
  if (!draft.category.trim()) errors.category = "Pick a category.";
  const n = Number(draft.count);
  if (draft.count.trim() === "" || !Number.isInteger(n) || n < 0 || n > CAUSE_COUNT_MAX) {
    errors.count = `A whole number from 0 to ${CAUSE_COUNT_MAX}.`;
  }
  if (Object.keys(errors).length > 0) return { ok: false, errors };
  return { ok: true, value: { category: draft.category.trim(), text, count: n } };
}

function CauseRow({
  cause,
  isRoot,
  onPatch,
  onRemove,
  onMarkRoot,
}: {
  cause: RootCauseCause;
  isRoot: boolean;
  onPatch: (patch: Partial<Omit<RootCauseCause, "id">>) => void;
  onRemove: () => void;
  onMarkRoot: () => void;
}) {
  const edit = useInlineEdit();
  return (
    <li
      className={cn(
        "space-y-1.5 rounded-md border bg-bg px-2.5 py-2",
        isRoot ? "border-accent" : "border-border"
      )}
    >
      {edit.editing ? (
        <InlineItemEditor
          label="Edit cause"
          title={cause.text}
          titleLabel="Cause"
          titleMaxLength={TOOL_TEXT_MAX.text}
          onDone={(next, { refocus }) => {
            edit.stop({ refocus });
            if (next) onPatch({ text: next.title });
          }}
        />
      ) : (
        <button
          ref={edit.triggerRef}
          type="button"
          onClick={edit.start}
          aria-label={`${cause.text}. Edit`}
          className="block w-full break-words text-left text-sm text-text hover:underline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent"
        >
          {cause.text}
        </button>
      )}
      <div className="flex flex-wrap items-center gap-1.5">
        <div
          className="inline-flex items-center gap-1"
          role="group"
          aria-label={`How often: ${cause.count}`}
        >
          <Button
            type="button"
            variant="outline"
            size="sm"
            className="h-7 w-7 p-0"
            aria-label={`One less for “${cause.text}”`}
            disabled={cause.count <= 0}
            onClick={() => onPatch({ count: cleanCount(cause.count - 1) })}
          >
            <Minus className="h-3.5 w-3.5" aria-hidden="true" />
          </Button>
          <span className="min-w-[2ch] text-center font-mono text-sm text-text" aria-hidden="true">
            {cause.count}
          </span>
          <Button
            type="button"
            variant="outline"
            size="sm"
            className="h-7 w-7 p-0"
            aria-label={`One more for “${cause.text}”`}
            disabled={cause.count >= CAUSE_COUNT_MAX}
            onClick={() => onPatch({ count: cleanCount(cause.count + 1) })}
          >
            <Plus className="h-3.5 w-3.5" aria-hidden="true" />
          </Button>
        </div>
        {isRoot ? (
          <span className="inline-flex items-center gap-1 text-xs font-semibold text-accent">
            <Target className="h-3.5 w-3.5" aria-hidden="true" />
            Root cause
          </span>
        ) : (
          <Button
            type="button"
            size="sm"
            variant="ghost"
            className="h-7 gap-1 px-2 text-xs"
            onClick={onMarkRoot}
            aria-label={`Mark “${cause.text}” as the root cause`}
          >
            <Target className="h-3.5 w-3.5" aria-hidden="true" />
            Root cause?
          </Button>
        )}
        <Button
          type="button"
          size="sm"
          variant="ghost"
          className="min-touch-coarse ml-auto h-7 px-2 text-sub hover:text-danger"
          onClick={onRemove}
          aria-label={`Delete “${cause.text}”`}
        >
          <Trash2 className="h-3.5 w-3.5" aria-hidden="true" />
        </Button>
      </div>
    </li>
  );
}

function CategoryName({
  name,
  canRename,
  onRename,
}: {
  name: string;
  canRename: boolean;
  onRename: (to: string) => void;
}) {
  const [editing, setEditing] = useState(false);
  const [value, setValue] = useState(name);
  const buttonRef = useRef<HTMLButtonElement>(null);
  const finish = (save: boolean) => {
    const to = value.trim();
    setEditing(false);
    if (save && to && to !== name) onRename(to);
    else setValue(name);
    requestAnimationFrame(() => buttonRef.current?.focus());
  };
  if (editing) {
    return (
      <Input
        autoFocus
        aria-label={`New name for ${name}`}
        value={value}
        maxLength={CATEGORY_MAX}
        className="h-8"
        onChange={(e) => setValue(e.target.value)}
        onBlur={() => finish(true)}
        onKeyDown={(e) => {
          if (e.key === "Enter") {
            e.preventDefault();
            finish(true);
          } else if (e.key === "Escape") {
            e.preventDefault();
            finish(false);
          }
        }}
      />
    );
  }
  return (
    <div className="flex items-center gap-1">
      <h4 className="text-sm font-semibold text-text">{name}</h4>
      {canRename && (
        <Button
          ref={buttonRef}
          type="button"
          variant="ghost"
          size="sm"
          className="h-7 w-7 p-0 text-sub"
          aria-label={`Rename ${name}`}
          onClick={() => {
            setValue(name);
            setEditing(true);
          }}
        >
          <Pencil className="h-3.5 w-3.5" aria-hidden="true" />
        </Button>
      )}
    </div>
  );
}

export function Fishbone({
  analysis,
  readOnlyAi = false,
  onAdd,
  onPatch,
  onRemove,
  onRename,
  onMarkRoot,
  onMove,
}: FishboneProps) {
  const [extra, setExtra] = useState<string[]>([]);
  const categories = useMemo(() => categoriesOf(analysis.causes, extra), [analysis.causes, extra]);
  const [draft, setDraft] = useState<CauseDraft>({ category: "Process", text: "", count: "1" });
  const [errors, setErrors] = useState<Partial<Record<keyof CauseDraft, string>>>({});
  const [newCategory, setNewCategory] = useState("");
  const [suggested, setSuggested] = useState<{
    moves: { causeId: string; category: string }[];
    source: AiSource;
  } | null>(null);
  const textRef = useRef<HTMLInputElement>(null);
  const formId = useId();
  const full = analysis.causes.length >= TOOL_LIST_MAX.causes;
  const root = analysis.rootCause?.trim() ?? "";

  const submit = (e: FormEvent) => {
    e.preventDefault();
    const checked = validateCause(draft);
    if (!checked.ok) {
      setErrors(checked.errors);
      if (checked.errors.text) textRef.current?.focus();
      return;
    }
    onAdd(checked.value);
    setDraft((d) => ({ ...d, text: "", count: "1" }));
    setErrors({});
    textRef.current?.focus();
  };

  const addCategory = () => {
    const name = newCategory.trim().slice(0, CATEGORY_MAX);
    if (!name) return;
    if (!categories.some((c) => c.toLowerCase() === name.toLowerCase())) {
      setExtra((list) => [...list, name]);
    }
    setDraft((d) => ({ ...d, category: name }));
    setNewCategory("");
  };

  const causeById = new Map(analysis.causes.map((c) => [c.id, c]));
  const moves = (suggested?.moves ?? []).filter((m) => {
    const c = causeById.get(m.causeId);
    return c && c.category.trim().toLowerCase() !== m.category.trim().toLowerCase();
  });

  return (
    <section aria-labelledby="fishbone-heading" className="space-y-3">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <h3 id="fishbone-heading" className="text-sm font-semibold text-text">
          Fishbone
        </h3>
        {!readOnlyAi && analysis.causes.length > 0 && (
          <AiButton
            task={categoriesTask}
            input={() => ({
              problem: [analysis.title, analysis.problem]
                .filter((s) => s.trim())
                .join(". ")
                .slice(0, 1000),
              categories: categories.slice(0, 12),
              causes: analysis.causes.slice(0, 100).map((c) => ({
                id: c.id.slice(0, 64),
                text: c.text.slice(0, 1000),
                category: c.category.slice(0, 60),
              })),
            })}
            label="Ask Amr to sort the causes"
            fallbackLabel="Sort without AI"
            onResult={(data, meta) => setSuggested({ moves: data.moves, source: meta.source })}
          />
        )}
      </div>
      <p className="rounded-md border border-dashed border-border px-3 py-2 text-sm text-text">
        <span className="font-semibold">Effect:</span> {analysis.title}
      </p>

      {suggested &&
        (moves.length > 0 ? (
          <AiSuggestions
            items={moves}
            source={suggested.source}
            title="Better categories"
            acceptLabel="Move"
            render={(m) => ({
              title: `Move “${causeById.get(m.causeId)?.text ?? ""}” to ${m.category}`,
              detail: `Now under ${causeById.get(m.causeId)?.category ?? ""}.`,
            })}
            onAccept={(m) => onMove(m.causeId, m.category)}
            onDismiss={() => setSuggested(null)}
          />
        ) : (
          <p role="status" className="text-xs text-sub">
            Every cause already sits where it fits.
          </p>
        ))}

      <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-3">
        {categories.map((category) => {
          const list = causesIn(analysis.causes, category);
          return (
            <div
              key={category}
              className="space-y-2 rounded-lg border border-border bg-card p-3"
              aria-label={`${category}: ${list.length} ${list.length === 1 ? "cause" : "causes"}`}
              role="group"
            >
              <CategoryName
                name={category}
                canRename={list.length > 0}
                onRename={(to) => onRename(category, to)}
              />
              {list.length === 0 ? (
                <p className="text-xs text-sub">No causes here yet.</p>
              ) : (
                <ul className="space-y-1.5">
                  {list.map((c) => (
                    <CauseRow
                      key={c.id}
                      cause={c}
                      isRoot={root !== "" && c.text.trim() === root}
                      onPatch={(patch) => onPatch(c.id, patch)}
                      onRemove={() => onRemove(c)}
                      onMarkRoot={() => onMarkRoot(c.text)}
                    />
                  ))}
                </ul>
              )}
            </div>
          );
        })}
      </div>

      {full ? (
        <p className="text-xs text-sub">
          The fishbone holds {TOOL_LIST_MAX.causes} causes, the most it can. Delete one to add
          another.
        </p>
      ) : (
        <form
          onSubmit={submit}
          aria-label="Add a cause"
          className="space-y-2 rounded-lg border border-border bg-card p-3"
          noValidate
        >
          <div className="grid gap-2 sm:grid-cols-[minmax(0,10rem)_minmax(0,1fr)_6rem]">
            <div>
              <label htmlFor={`${formId}-cat`} className="mb-1 block text-xs font-medium text-sub">
                Category
              </label>
              <select
                id={`${formId}-cat`}
                value={draft.category}
                onChange={(e) => setDraft((d) => ({ ...d, category: e.target.value }))}
                aria-invalid={errors.category ? true : undefined}
                className="flex h-9 w-full rounded-md border border-input bg-background px-2 text-sm text-text focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
              >
                {categories.map((c) => (
                  <option key={c} value={c}>
                    {c}
                  </option>
                ))}
              </select>
            </div>
            <div>
              <label htmlFor={`${formId}-text`} className="mb-1 block text-xs font-medium text-sub">
                Cause
              </label>
              <Input
                id={`${formId}-text`}
                ref={textRef}
                value={draft.text}
                maxLength={TOOL_TEXT_MAX.text}
                aria-invalid={errors.text ? true : undefined}
                aria-describedby={errors.text ? `${formId}-text-error` : undefined}
                placeholder="No alert on the error rate"
                onChange={(e) => setDraft((d) => ({ ...d, text: e.target.value }))}
              />
              {errors.text && (
                <p id={`${formId}-text-error`} className="mt-1 text-xs text-danger">
                  {errors.text}
                </p>
              )}
            </div>
            <div>
              <label
                htmlFor={`${formId}-count`}
                className="mb-1 block text-xs font-medium text-sub"
              >
                How often
              </label>
              <Input
                id={`${formId}-count`}
                type="number"
                inputMode="numeric"
                min={0}
                max={CAUSE_COUNT_MAX}
                step={1}
                value={draft.count}
                aria-invalid={errors.count ? true : undefined}
                aria-describedby={errors.count ? `${formId}-count-error` : undefined}
                onChange={(e) => setDraft((d) => ({ ...d, count: e.target.value }))}
              />
              {errors.count && (
                <p id={`${formId}-count-error`} className="mt-1 text-xs text-danger">
                  {errors.count}
                </p>
              )}
            </div>
          </div>
          <div className="flex flex-wrap items-end gap-2">
            <Button type="submit" size="sm" className="gap-1.5">
              <Plus className="h-4 w-4" aria-hidden="true" />
              Add cause
            </Button>
            <div className="ml-auto flex items-end gap-1.5">
              <div>
                <label
                  htmlFor={`${formId}-newcat`}
                  className="mb-1 block text-xs font-medium text-sub"
                >
                  Your own category
                </label>
                <Input
                  id={`${formId}-newcat`}
                  value={newCategory}
                  maxLength={CATEGORY_MAX}
                  className="h-9 w-40"
                  placeholder="Suppliers"
                  onChange={(e) => setNewCategory(e.target.value)}
                  onKeyDown={(e) => {
                    if (e.key === "Enter") {
                      e.preventDefault();
                      addCategory();
                    }
                  }}
                />
              </div>
              <Button type="button" size="sm" variant="outline" onClick={addCategory}>
                Add category
              </Button>
            </div>
          </div>
        </form>
      )}
    </section>
  );
}
