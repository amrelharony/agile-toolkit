"use client";

/**
 * The fishbone (Ishikawa) diagram as a phone-friendly board: the problem
 * as the head, then a box per category with its causes, each with how
 * often it happened. Any category can be renamed (every cause in one moves
 * with the new name), an empty one removed, and the team can add its own.
 * A category is the name on its causes: one of the team's own with no
 * causes is only on this screen until a cause goes in it, and a starting
 * category renamed or removed stays hidden for this analysis (in this
 * browser, checks-store) until a cause is filed under it again.
 *
 * Counts feed the Pareto chart below. Ask Amr suggests which category a
 * cause belongs under (only the board's own categories); each move the
 * person accepts goes through the store, with Undo.
 */

import {
  useEffect,
  useId,
  useMemo,
  useRef,
  useState,
  type FormEvent,
  type MutableRefObject,
} from "react";
import { Minus, Pencil, Plus, Target, Trash2, X } from "lucide-react";
import { useAnnounce } from "@/components/a11y/live-announcer";
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
  DEFAULT_CATEGORIES,
  categoriesOf,
  causesIn,
  cleanCount,
  type NewCause,
} from "@/lib/root-cause/model";
import { cn } from "@/lib/utils";
import { undoable } from "@/lib/utils/undoable";
import { setCategoryHidden, useHiddenCategories } from "./checks-store";

/** A native select the size of the other fields: 44 px and 16 px text on a phone (no iOS zoom). */
const SELECT_CLASS =
  "flex h-11 w-full rounded-md border border-input bg-background px-2 text-base text-text focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring pointer-fine:md:h-9 pointer-fine:md:text-sm";

const short = (s: string, max = 60) => {
  const t = s.replace(/\s+/g, " ").trim();
  return t.length > max ? `${t.slice(0, max - 1).trimEnd()}…` : t;
};

const isDefault = (name: string) =>
  DEFAULT_CATEGORIES.some((d) => d.toLowerCase() === name.trim().toLowerCase());

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
  textRef,
}: {
  cause: RootCauseCause;
  isRoot: boolean;
  onPatch: (patch: Partial<Omit<RootCauseCause, "id">>) => void;
  onRemove: () => void;
  onMarkRoot: () => void;
  /** The cause's text button, so focus can land here after a delete. */
  textRef: (el: HTMLButtonElement | null) => void;
}) {
  const edit = useInlineEdit();
  const announce = useAnnounce();
  const lessRef = useRef<HTMLButtonElement>(null);
  const moreRef = useRef<HTMLButtonElement>(null);
  /** Change the count, say the new one, and keep focus off a button that just turned off. */
  const step = (by: 1 | -1) => {
    const next = cleanCount(cause.count + by);
    onPatch({ count: next });
    announce(`“${short(cause.text)}”: ${next}`);
    if (next <= 0) moreRef.current?.focus();
    else if (next >= CAUSE_COUNT_MAX) lessRef.current?.focus();
  };
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
          ref={(el) => {
            (edit.triggerRef as MutableRefObject<HTMLButtonElement | null>).current = el;
            textRef(el);
          }}
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
            ref={lessRef}
            type="button"
            variant="outline"
            size="sm"
            className="min-touch-coarse h-7 w-7 p-0"
            aria-label={`One less for “${cause.text}”`}
            disabled={cause.count <= 0}
            onClick={() => step(-1)}
          >
            <Minus className="h-3.5 w-3.5" aria-hidden="true" />
          </Button>
          <span className="min-w-[2ch] text-center font-mono text-sm text-text" aria-hidden="true">
            {cause.count}
          </span>
          <Button
            ref={moreRef}
            type="button"
            variant="outline"
            size="sm"
            className="min-touch-coarse h-7 w-7 p-0"
            aria-label={`One more for “${cause.text}”`}
            disabled={cause.count >= CAUSE_COUNT_MAX}
            onClick={() => step(1)}
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
  onRename,
  onRemove,
  renameRef,
}: {
  name: string;
  onRename: (to: string) => void;
  /** Remove the category: offered only while it holds no cause. */
  onRemove?: () => void;
  /** The Rename button, so focus can come back to it (or the new name's) from outside. */
  renameRef: (el: HTMLButtonElement | null) => void;
}) {
  const [editing, setEditing] = useState(false);
  const [value, setValue] = useState(name);
  const buttonRef = useRef<HTMLButtonElement | null>(null);
  const finish = (save: boolean) => {
    const to = value.trim();
    setEditing(false);
    // A rename remounts the box under its new name: the Fishbone focuses
    // the new name's button. Otherwise focus comes back here.
    if (save && to && to !== name) onRename(to);
    else {
      setValue(name);
      requestAnimationFrame(() => buttonRef.current?.focus());
    }
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
      <h4 className="min-w-0 break-words text-sm font-semibold text-text">{name}</h4>
      <Button
        ref={(el) => {
          buttonRef.current = el;
          renameRef(el);
        }}
        type="button"
        variant="ghost"
        size="sm"
        className="min-touch-coarse h-7 w-7 shrink-0 p-0 text-sub"
        aria-label={`Rename ${name}`}
        onClick={() => {
          setValue(name);
          setEditing(true);
        }}
      >
        <Pencil className="h-3.5 w-3.5" aria-hidden="true" />
      </Button>
      {onRemove && (
        <Button
          type="button"
          variant="ghost"
          size="sm"
          className="min-touch-coarse h-7 w-7 shrink-0 p-0 text-sub hover:text-danger"
          aria-label={`Remove ${name}`}
          onClick={onRemove}
        >
          <X className="h-3.5 w-3.5" aria-hidden="true" />
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
  const hidden = useHiddenCategories(analysis.id);
  const categories = useMemo(
    () => categoriesOf(analysis.causes, extra, hidden),
    [analysis.causes, extra, hidden]
  );
  const announce = useAnnounce();
  /** Each category's Rename button and each cause's text button, for focus after a change. */
  const renameButtons = useRef(new Map<string, HTMLButtonElement>());
  const causeButtons = useRef(new Map<string, HTMLButtonElement>());
  const addCategoryRef = useRef<HTMLInputElement>(null);
  /** What to focus after the next render: a category (its Rename button) or a cause. */
  const pendingFocus = useRef<{ category?: string; causeId?: string } | null>(null);
  useEffect(() => {
    const want = pendingFocus.current;
    if (!want) return;
    pendingFocus.current = null;
    const target =
      (want.causeId ? causeButtons.current.get(want.causeId) : undefined) ??
      (want.category ? renameButtons.current.get(want.category.toLowerCase()) : undefined) ??
      addCategoryRef.current;
    target?.focus();
  });
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

  /**
   * Rename a category. One with causes moves them to the new name (the
   * store, logged); an empty one just changes its name here. A starting
   * category renamed stays hidden for this analysis, so it doesn't come
   * back empty beside its new name.
   */
  const renameCategory = (from: string, to: string) => {
    const target = to.replace(/\s+/g, " ").trim().slice(0, CATEGORY_MAX);
    if (!target || target === from) return;
    const key = from.trim().toLowerCase();
    if (causesIn(analysis.causes, from).length > 0) onRename(from, target);
    else announce(`Renamed ${from} to ${target}.`);
    if (isDefault(from)) setCategoryHidden(analysis.id, from, true);
    if (isDefault(target)) setCategoryHidden(analysis.id, target, false);
    setExtra((list) => {
      const rest = list.filter((n) => n.trim().toLowerCase() !== key);
      const known = [...categoriesOf(analysis.causes), ...rest].some(
        (n) => n.toLowerCase() === target.toLowerCase()
      );
      return known && !isDefault(target) ? rest : [...rest, target];
    });
    setDraft((d) => (d.category.trim().toLowerCase() === key ? { ...d, category: target } : d));
    pendingFocus.current = { category: target };
  };

  /** Remove an empty category (with Undo): the next box's Rename button gets focus. */
  const removeCategory = (name: string) => {
    const at = categories.findIndex((c) => c === name);
    const neighbour = categories[at + 1] ?? categories[at - 1];
    const key = name.trim().toLowerCase();
    const wasExtra = extra.find((n) => n.trim().toLowerCase() === key);
    undoable({
      label: `Removed ${name}`,
      kind: "success",
      apply: () => {
        if (isDefault(name)) setCategoryHidden(analysis.id, name, true);
        setExtra((list) => list.filter((n) => n.trim().toLowerCase() !== key));
      },
      revert: () => {
        if (isDefault(name)) setCategoryHidden(analysis.id, name, false);
        else if (wasExtra) setExtra((list) => [...list, wasExtra]);
      },
    });
    setDraft((d) =>
      d.category.trim().toLowerCase() === key ? { ...d, category: neighbour ?? "Other" } : d
    );
    pendingFocus.current = { category: neighbour };
    announce(`Removed ${name}.`);
  };

  /** Delete a cause: focus moves to the next cause in its box, else the box's name. */
  const removeCause = (cause: RootCauseCause) => {
    const list = causesIn(analysis.causes, cause.category);
    const at = list.findIndex((c) => c.id === cause.id);
    const neighbour = list[at + 1] ?? list[at - 1];
    onRemove(cause);
    pendingFocus.current = { causeId: neighbour?.id, category: cause.category };
  };

  const causeById = new Map(analysis.causes.map((c) => [c.id, c]));
  // Only the board's own categories, in its spelling, and one move per cause.
  const spelling = new Map(categories.map((c) => [c.toLowerCase(), c]));
  const movedCauses = new Set<string>();
  const moves = (suggested?.moves ?? []).flatMap((m) => {
    const c = causeById.get(m.causeId);
    const to = spelling.get(m.category.trim().toLowerCase());
    if (!c || !to || movedCauses.has(m.causeId)) return [];
    if (c.category.trim().toLowerCase() === to.toLowerCase()) return [];
    movedCauses.add(m.causeId);
    return [{ causeId: m.causeId, category: to }];
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
            onResult={(data, meta) => {
              setSuggested({ moves: data.moves, source: meta.source });
              const known = new Set(categories.map((c) => c.toLowerCase()));
              const n = new Set(
                data.moves
                  .filter((m) => {
                    const c = causeById.get(m.causeId);
                    const to = m.category.trim().toLowerCase();
                    return c && known.has(to) && c.category.trim().toLowerCase() !== to;
                  })
                  .map((m) => m.causeId)
              ).size;
              announce(
                n === 0
                  ? "Every cause already sits where it fits."
                  : `${n} suggested ${n === 1 ? "move" : "moves"} below.`
              );
            }}
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
                onRename={(to) => renameCategory(category, to)}
                onRemove={list.length === 0 ? () => removeCategory(category) : undefined}
                renameRef={(el) => {
                  if (el) renameButtons.current.set(category.toLowerCase(), el);
                  else renameButtons.current.delete(category.toLowerCase());
                }}
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
                      onRemove={() => removeCause(c)}
                      onMarkRoot={() => onMarkRoot(c.text)}
                      textRef={(el) => {
                        if (el) causeButtons.current.set(c.id, el);
                        else causeButtons.current.delete(c.id);
                      }}
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
                className={SELECT_CLASS}
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
            <div className="flex w-full min-w-0 items-end gap-1.5 sm:ml-auto sm:w-auto">
              <div className="min-w-0 flex-1 sm:flex-none">
                <label
                  htmlFor={`${formId}-newcat`}
                  className="mb-1 block text-xs font-medium text-sub"
                >
                  Your own category
                </label>
                <Input
                  id={`${formId}-newcat`}
                  ref={addCategoryRef}
                  value={newCategory}
                  maxLength={CATEGORY_MAX}
                  className="w-full min-w-0 sm:w-40"
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
