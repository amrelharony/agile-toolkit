"use client";

/**
 * One section of a sectioned document (lib/sectioned: Kickoff, Product
 * Canvas), on the shared SectionCard shell: its label, prompt and hint, then
 * what it holds.
 *
 * - A list: each item's text (click or Enter to edit in place; an emptied
 *   text reverts), the tool's extras under it, then the tool's actions and
 *   Delete (with Undo). Below `sm` the actions sit under the text, so a
 *   phone never scrolls sideways. A field at the end adds a line on Enter
 *   (or Add), up to the section's `max`; a full section says so.
 * - A single or long answer: one field (a growing box for long), saved when
 *   the field is left. Clearing it removes the answer, with Undo.
 *
 * The card holds no document state: `items` in, `onChange(next)` out. The
 * tool's store write may refuse a change by returning a sentence (say, the
 * row would be too big to save); the card shows it and keeps what was
 * typed. A delete is never refused, but its Undo may be (the line no longer
 * fits): the card then says so and leaves the list as it is.
 *
 * Undo of a delete can run seconds later, after other changes. Without
 * `update`, it goes through the newest `onChange`, over the list as last
 * written, so an `onChange` that closes over the page's state is fine. Key
 * the card by the document and the section, so that opening another document
 * mounts new cards: a card that goes closes its Undo toasts, which could no
 * longer land in the right document. With `update`, the delete and its Undo
 * go through the `update` the delete was made with, and its Undo stays.
 *
 * `disabled` shows the text read only, without the card's own add, edit
 * and delete; the tool's slots still render, and the tool decides what
 * they offer then.
 */

import { useEffect, useId, useMemo, useRef, useState, type ReactNode } from "react";
import { nanoid } from "nanoid";
import { Plus, Trash2 } from "lucide-react";
import { SectionCard } from "@/components/shared/section-card";
import { BlurInput, BlurTextarea } from "@/components/shared/blur-fields";
import { InlineItemEditor, useInlineEdit } from "@/components/shared/inline-item-editor";
import { Button } from "@/components/ui/button";
import { IconButton } from "@/components/ui/icon-button";
import { Input } from "@/components/ui/input";
import { roomLeft, type SectionDef } from "@/lib/sectioned/model";
import type { SectionItem } from "@/lib/stores/workspace-types";
import { cutText } from "@/lib/utils/cut-text";
import { toast } from "@/lib/utils/toast";
import { removeWithUndo } from "@/lib/utils/undoable";

export interface SectionItemsCardProps<I extends SectionItem> {
  def: SectionDef;
  items: readonly I[] | undefined;
  /**
   * The section's items after a change. Return a sentence to refuse it: the
   * card shows it and keeps what was typed. A delete is never refused.
   */
  onChange: (next: I[]) => string | void;
  /**
   * A functional write for a delete and its Undo (removeWithUndo's
   * `update`): `fn` takes the section's items as the tool holds them when it
   * runs, and returns the new list. Return a sentence to refuse. Bind it to
   * the document (a store action that reads the newest row by its id): the
   * Undo then puts the line back in the document it came from, whatever
   * changed or opened since. Adds and edits still go through `onChange`.
   */
  update?: (fn: (items: readonly I[]) => I[]) => string | void;
  /** The cap on one item's text: the tool's item cap, or its long cap for a long section. */
  itemMax: number;
  /** Under an item's text: the tool's own fields (owner, ratings, fact or guess). */
  renderExtras?: (item: I) => ReactNode;
  /** Beside Delete: the tool's own buttons (the send menu). */
  renderActions?: (item: I) => ReactNode;
  /** Just before an item's text: a short mark or chips ("~" for a guess). */
  itemLabel?: (item: I) => ReactNode;
  disabled?: boolean;
  /** A new item from typed text; default `{ id: nanoid(8), text }`. */
  makeItem?: (text: string) => I;
  /** Beside the title: the section's links ("Open Skills Matrix") and the like. */
  actions?: ReactNode;
  /** Under the items: anything else the tool shows in this section. */
  children?: ReactNode;
  className?: string;
}

const EMPTY: readonly never[] = [];

/** One line, trimmed: line breaks and runs of spaces become one space. */
const oneLine = (text: string) => text.replace(/\s+/g, " ").trim();

/** An item's words for a button's name or an Undo line, cut to a phrase. */
function short(text: string, max = 60): string {
  const t = oneLine(text);
  return t.length > max ? `${cutText(t, max - 1).trimEnd()}…` : t;
}

/** The tool's sentence when it refused a write; null when the write went through. */
const refusal = (result: string | void): string | null =>
  typeof result === "string" && result ? result : null;

/** `item` as a list holds it: this very object (so a repeated id stays), or else the first with its id. */
function pickItem<I extends SectionItem>(items: readonly I[], item: I): I | undefined {
  return items.includes(item) ? item : items.find((x) => x.id === item.id);
}

/** React keys from ids, a repeated id getting its own key so the rows stay apart. */
function rowKeys(items: readonly SectionItem[]): string[] {
  const count = new Map<string, number>();
  return items.map((item) => {
    const n = (count.get(item.id) ?? 0) + 1;
    count.set(item.id, n);
    return n === 1 ? item.id : `${item.id}#${n}`;
  });
}

export function SectionItemsCard<I extends SectionItem>({
  def,
  items,
  onChange,
  update,
  itemMax,
  renderExtras,
  renderActions,
  itemLabel,
  disabled = false,
  makeItem,
  actions,
  children,
  className,
}: SectionItemsCardProps<I>) {
  const list: readonly I[] = items ?? EMPTY;
  const [problem, setProblem] = useState<string | null>(null);
  const problemId = useId();
  // The list as last written, for Undo: it may run after the page has moved on.
  const latest = useRef<readonly I[]>(list);
  useEffect(() => {
    latest.current = list;
  }, [list]);
  // The newest onChange, for an Undo that runs renders after its delete: the
  // tool's onChange may close over the page's state as it was then.
  const onChangeRef = useRef(onChange);
  onChangeRef.current = onChange;
  const mounted = useRef(false);
  // Undo toasts that write through onChange: closed when the card goes.
  const undoToasts = useRef(new Set<string | number>());
  useEffect(() => {
    mounted.current = true;
    const open = undoToasts.current;
    return () => {
      mounted.current = false;
      // Another document or format took its place, or the page went: the
      // newest onChange is frozen now, and an Undo through it could write
      // the line into the wrong document or over a newer change.
      open.forEach((id) => toast.dismiss(id));
      open.clear();
    };
  }, []);

  /** Write a change; false when the tool refused it (its sentence then shows). */
  const write = (next: I[]): boolean => {
    const refused = refusal(onChange(next));
    if (refused) {
      setProblem(refused);
      return false;
    }
    latest.current = next;
    setProblem(null);
    return true;
  };

  /** Remove one item (this object: a repeated id stays), with Undo. */
  const removeItem = (item: I, label: string) => {
    setProblem(null);
    // The delete's own `update`, bound to the document it was made in.
    const through = update;
    // The item as the list being changed holds it (see pickItem).
    let target: I | undefined;
    const run = (fn: (items: readonly I[]) => I[], items: readonly I[]) => {
      target = pickItem(items, item);
      return fn(items);
    };
    // removeWithUndo runs the delete at once; a later call is the Undo.
    let deleting = true;
    const toastId = removeWithUndo<I>({
      label,
      update: (fn) => {
        let refused: string | null;
        if (through) {
          let next = undefined as I[] | undefined;
          refused = refusal(through((items) => (next = run(fn, items))));
          // The delete, as written now, until the page shows it. An Undo is
          // left to the page: the card may be showing another document by then.
          if (deleting && next && !refused) latest.current = next;
        } else {
          const next = run(fn, latest.current);
          refused = refusal(onChangeRef.current(next));
          // A refused Undo leaves the list as it was: the next change builds
          // on what the tool holds, never on the line it didn't take back.
          if (!refused) latest.current = next;
        }
        if (refused && mounted.current) setProblem(refused);
      },
      match: (x) => x === target,
    });
    deleting = false;
    if (!through && toastId !== undefined) undoToasts.current.add(toastId);
  };

  const newItem = (text: string): I => (makeItem ? makeItem(text) : ({ id: nanoid(8), text } as I));

  const isList = def.kind === "list";
  const suffix = [def.required ? "Required" : null, isList ? `${list.length} of ${def.max}` : null]
    .filter(Boolean)
    .join(" · ");

  return (
    <SectionCard
      title={def.label}
      titleSuffix={suffix || undefined}
      actions={actions}
      className={className}
      contentClassName="space-y-3"
    >
      <div className="space-y-1">
        <p className="text-sm text-sub">{def.prompt}</p>
        {def.hint && <p className="text-xs text-sub">{def.hint}</p>}
      </div>
      {isList ? (
        <ListBody
          def={def}
          list={list}
          itemMax={itemMax}
          disabled={disabled}
          problemId={problem ? problemId : undefined}
          renderExtras={renderExtras}
          renderActions={renderActions}
          itemLabel={itemLabel}
          onAdd={(text) => write([...latest.current, newItem(text)])}
          onText={(item, text) =>
            write(latest.current.map((x) => (x === item ? { ...x, text } : x)))
          }
          onDelete={(item) => removeItem(item, `Deleted “${short(item.text) || def.label}”`)}
        />
      ) : (
        <AnswerBody
          def={def}
          list={list}
          itemMax={itemMax}
          disabled={disabled}
          renderExtras={renderExtras}
          renderActions={renderActions}
          itemLabel={itemLabel}
          onCommit={(raw) => {
            const text = cutText(
              def.kind === "long" ? raw.replace(/\r\n?/g, "\n").trim() : oneLine(raw),
              itemMax
            );
            const first = latest.current[0];
            if (!first) {
              if (text) write([newItem(text)]);
              return;
            }
            if (!text) {
              removeItem(first, `Cleared “${short(def.label)}”`);
              return;
            }
            if (text === first.text) return;
            write(latest.current.map((x, i) => (i === 0 ? { ...x, text } : x)));
          }}
        />
      )}
      {problem && (
        <p id={problemId} role="alert" className="text-sm text-danger">
          {problem}
        </p>
      )}
      {children}
    </SectionCard>
  );
}

interface SlotProps<I extends SectionItem> {
  renderExtras?: (item: I) => ReactNode;
  renderActions?: (item: I) => ReactNode;
  itemLabel?: (item: I) => ReactNode;
}

function ListBody<I extends SectionItem>({
  def,
  list,
  itemMax,
  disabled,
  problemId,
  renderExtras,
  renderActions,
  itemLabel,
  onAdd,
  onText,
  onDelete,
}: SlotProps<I> & {
  def: SectionDef;
  list: readonly I[];
  itemMax: number;
  disabled: boolean;
  problemId?: string;
  onAdd: (text: string) => boolean;
  onText: (item: I, text: string) => void;
  onDelete: (item: I) => void;
}) {
  const [draft, setDraft] = useState("");
  const addRef = useRef<HTMLInputElement>(null);
  const fullId = useId();
  const keys = useMemo(() => rowKeys(list), [list]);
  const full = roomLeft(def, list) === 0;

  const add = () => {
    if (full || disabled) return;
    const text = cutText(oneLine(draft), itemMax);
    if (!text) return;
    if (onAdd(text)) setDraft("");
  };

  const describedBy = [full ? fullId : null, problemId ?? null].filter(Boolean).join(" ");

  return (
    <>
      {list.length > 0 ? (
        <ul aria-label={def.label} className="space-y-2">
          {list.map((item, i) => (
            <ItemRow
              key={keys[i]}
              item={item}
              itemMax={itemMax}
              disabled={disabled}
              extras={renderExtras?.(item)}
              actions={renderActions?.(item)}
              label={itemLabel?.(item)}
              onText={(text) => onText(item, text)}
              onDelete={() => {
                onDelete(item);
                // The row is gone: carry on from the add field.
                addRef.current?.focus();
              }}
            />
          ))}
        </ul>
      ) : (
        disabled && <p className="text-sm text-sub">Nothing here yet.</p>
      )}
      {!disabled && (
        <div className="flex flex-col gap-2 sm:flex-row sm:items-center">
          <Input
            ref={addRef}
            value={draft}
            readOnly={full}
            maxLength={itemMax}
            enterKeyHint="done"
            aria-label={`Add to ${def.label}`}
            aria-describedby={describedBy || undefined}
            placeholder={full ? "This section is full" : (def.starter ?? "Add a line")}
            onChange={(e) => setDraft(e.target.value)}
            onKeyDown={(e) => {
              if (e.key !== "Enter" || e.nativeEvent.isComposing) return;
              e.preventDefault();
              add();
            }}
            className="min-w-0 sm:flex-1"
          />
          <Button
            type="button"
            variant="toolkit"
            aria-disabled={full || undefined}
            onClick={add}
            className="shrink-0 aria-disabled:opacity-40"
          >
            <Plus aria-hidden="true" />
            Add
          </Button>
        </div>
      )}
      {full && !disabled && (
        <p id={fullId} role="status" className="text-sm text-sub">
          This section is full: it holds {def.max}. Delete a line to add another.
        </p>
      )}
    </>
  );
}

function ItemRow<I extends SectionItem>({
  item,
  itemMax,
  disabled,
  extras,
  actions,
  label,
  onText,
  onDelete,
}: {
  item: I;
  itemMax: number;
  disabled: boolean;
  extras: ReactNode;
  actions: ReactNode;
  label: ReactNode;
  onText: (text: string) => void;
  onDelete: () => void;
}) {
  const edit = useInlineEdit();
  const words = short(item.text);
  const shown = item.text.trim() ? (
    item.text
  ) : (
    <span className="text-sub">{item.owner ? item.owner : "No words yet"}</span>
  );
  return (
    <li
      data-section-item={item.id}
      className="flex flex-col gap-2 rounded-md border border-border bg-surface p-2.5 sm:flex-row sm:items-start"
    >
      <div data-slot="text" className="min-w-0 flex-1 space-y-1.5">
        <div className="flex min-w-0 items-start gap-1.5">
          {label != null && label !== false && (
            <span data-slot="label" className="shrink-0 text-sm text-sub">
              {label}
            </span>
          )}
          <div className="min-w-0 flex-1">
            {edit.editing ? (
              <InlineItemEditor
                label="Edit line"
                title={item.text}
                titleLabel="Line"
                titleMaxLength={itemMax}
                onDone={(next, { refocus }) => {
                  edit.stop({ refocus });
                  if (next) onText(next.title);
                }}
              />
            ) : disabled ? (
              <p className="whitespace-pre-wrap break-words text-sm text-text">{shown}</p>
            ) : (
              <button
                ref={edit.triggerRef}
                type="button"
                onClick={edit.start}
                title="Click to edit"
                className="block w-full cursor-text whitespace-pre-wrap break-words rounded-sm text-left text-sm text-text transition-colors hover:text-accent focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-accent pointer-coarse:min-h-11"
              >
                {shown} <span className="sr-only">(edit)</span>
              </button>
            )}
          </div>
        </div>
        {extras != null && extras !== false && <div data-slot="extras">{extras}</div>}
      </div>
      {(actions != null && actions !== false) || !disabled ? (
        <div data-slot="actions" className="flex flex-wrap items-center gap-1 sm:shrink-0">
          {actions}
          {!disabled && (
            <IconButton
              label={`Delete “${words || "this line"}”`}
              icon={<Trash2 className="h-4 w-4" />}
              variant="danger-ghost"
              onClick={onDelete}
            />
          )}
        </div>
      ) : null}
    </li>
  );
}

function AnswerBody<I extends SectionItem>({
  def,
  list,
  itemMax,
  disabled,
  renderExtras,
  renderActions,
  itemLabel,
  onCommit,
}: SlotProps<I> & {
  def: SectionDef;
  list: readonly I[];
  itemMax: number;
  disabled: boolean;
  onCommit: (raw: string) => void;
}) {
  const fieldId = useId();
  const first = list[0];
  const label = first ? itemLabel?.(first) : null;
  const extras = first ? renderExtras?.(first) : null;
  const actions = first ? renderActions?.(first) : null;
  return (
    <div className="space-y-2">
      <div className="flex min-w-0 items-start gap-1.5">
        {label != null && label !== false && (
          <span data-slot="label" className="shrink-0 pt-2 text-sm text-sub">
            {label}
          </span>
        )}
        <div className="min-w-0 flex-1">
          {disabled ? (
            first?.text.trim() ? (
              <p className="whitespace-pre-wrap break-words text-sm text-text">{first.text}</p>
            ) : (
              <p className="text-sm text-sub">Nothing here yet.</p>
            )
          ) : def.kind === "long" ? (
            <BlurTextarea
              id={fieldId}
              rows={5}
              value={first?.text ?? ""}
              onCommit={onCommit}
              maxLength={itemMax}
              placeholder={def.starter}
              aria-label={def.label}
            />
          ) : (
            <BlurInput
              id={fieldId}
              value={first?.text ?? ""}
              onCommit={onCommit}
              maxLength={itemMax}
              placeholder={def.starter}
              aria-label={def.label}
            />
          )}
        </div>
      </div>
      {(extras != null && extras !== false) || (actions != null && actions !== false) ? (
        <div className="flex flex-col gap-2 sm:flex-row sm:items-start">
          {extras != null && extras !== false && (
            <div data-slot="extras" className="min-w-0 flex-1">
              {extras}
            </div>
          )}
          {actions != null && actions !== false && (
            <div data-slot="actions" className="flex flex-wrap items-center gap-1 sm:shrink-0">
              {actions}
            </div>
          )}
        </div>
      ) : null}
    </div>
  );
}
