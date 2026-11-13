"use client";

/**
 * <AiSuggestions>: a review list for what Amr suggested. The person adds one
 * item, adds them all, or dismisses the list; nothing reaches the tool until
 * they do, and each accepted item goes through the tool's own store (with its
 * Undo), in the caller's `onAccept`. When the items are alternatives to one
 * another (`pickOne`: three answers to the same question), there is no "all"
 * button: the person picks one, and the caller usually closes the list.
 *
 * Text shows as plain text only: React escapes it, there is no Markdown, no
 * link and never dangerouslySetInnerHTML, so an answer can't inject anything
 * into the page. When the list came from the task's fallback, it says
 * "Suggested without AI".
 *
 * Callers should pass the answer as it came (the kit hides what was added),
 * but each row follows its own key (`itemKey`, else the item's contents), so
 * a caller that drops an added item from `items` still works: a list that
 * only loses added items keeps going, and one with an item it didn't have
 * before starts afresh.
 *
 * Keyboard focus never falls back to the page: adding an item moves focus to
 * the next item's Add button (or the one before), and when none is left, or
 * after "Add all", to the list's heading, with "All added." announced. If
 * the caller moves focus somewhere else in `onAccept` (it closed the list
 * and focused the field it filled), focus stays there. If the row focus went
 * to disappears too, the next one left gets it. If the list goes while focus
 * is in it, focus goes to `returnFocus`. On Dismiss the list goes, so the
 * caller says where focus goes back to (`returnFocus`, usually the button
 * that asked); without it, the caller moves focus itself in `onDismiss`.
 */

import { useEffect, useId, useLayoutEffect, useRef, useState } from "react";
import { Check, PenLine, Plus, X } from "lucide-react";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";
import type { AiSource } from "@/lib/ai/task-types";

/** What one suggestion shows: a line, or a line with a detail under it. */
export type AiSuggestionText = string | { title: string; detail?: string };

export interface AiSuggestionsProps<T> {
  items: readonly T[];
  /** The text for one item. Default: the item itself when it is a string. */
  render?: (item: T) => AiSuggestionText;
  /**
   * One item's key, stable while the list is shown. Default: the item's
   * contents (JSON). Give one when an item's contents can change while it
   * is shown (its text read live), so it stays the same row.
   */
  itemKey?: (item: T) => string;
  /** Add one item (through the tool's store). */
  onAccept: (item: T, index: number) => void;
  /** Add every item still in the list. Default: onAccept for each, in order. */
  onAcceptAll?: (items: T[]) => void;
  /** Close the list without adding the rest. */
  onDismiss: () => void;
  /**
   * Where keyboard focus goes on Dismiss, before the list unmounts, and when
   * the list goes while focus is in it: usually the button that asked.
   * Queried when needed, so a re-created button is found. Nothing moves
   * when it is absent or returns nothing.
   */
  returnFocus?: () => HTMLElement | null | undefined;
  /** Where the items came from. */
  source: AiSource;
  /** Heading; default "Amr's suggestions". */
  title?: string;
  /** The add button's word; default "Add". */
  acceptLabel?: string;
  /**
   * The items are alternatives (answers to the same question), so adding
   * all of them makes no sense: no "{acceptLabel} all" button.
   */
  pickOne?: boolean;
  className?: string;
}

function textOf(value: AiSuggestionText): { title: string; detail?: string } {
  return typeof value === "string" ? { title: value } : value;
}

function defaultRender(item: unknown): AiSuggestionText {
  return typeof item === "string" ? item : String(item);
}

function contentsOf(item: unknown): string {
  try {
    return JSON.stringify(item) ?? String(item);
  } catch {
    return String(item);
  }
}

/** Each item's key; equal items get their place among equals added. */
function keysOf<T>(items: readonly T[], itemKey?: (item: T) => string): string[] {
  const seen = new Map<string, number>();
  return items.map((item) => {
    const base = itemKey ? itemKey(item) : contentsOf(item);
    const n = seen.get(base) ?? 0;
    seen.set(base, n + 1);
    return n === 0 ? base : `${base}\u0000${n}`;
  });
}

/** Where focus goes once the list has re-rendered after an add. */
interface FocusPlan {
  /** The rows after the added one, then the ones before it (nearest first). */
  order: string[];
  /** The added row's place, for when none of `order` is left. */
  at: number;
}

const useIsomorphicLayoutEffect = typeof window === "undefined" ? useEffect : useLayoutEffect;

const lostFocus = (el: Element | null) => !el || el === document.body || !el.isConnected;

export function AiSuggestions<T>({
  items,
  render,
  itemKey,
  onAccept,
  onAcceptAll,
  onDismiss,
  returnFocus,
  source,
  title = "Amr's suggestions",
  acceptLabel = "Add",
  pickOne = false,
  className,
}: AiSuggestionsProps<T>) {
  const headingId = useId();
  const headingRef = useRef<HTMLHeadingElement>(null);
  const sectionRef = useRef<HTMLElement>(null);
  const listRef = useRef<HTMLUListElement>(null);
  /** Each shown item's Add button, by the item's key. */
  const addButtons = useRef(new Map<string, HTMLButtonElement>());
  /** Set by an add until the re-renders it causes are done. */
  const plan = useRef<FocusPlan | null>(null);
  /** The section as last rendered (for the unmount). */
  const lastSection = useRef<HTMLElement | null>(null);
  const returnFocusRef = useRef(returnFocus);
  returnFocusRef.current = returnFocus;

  const keys = keysOf(items, itemKey);
  const signature = keys.join("\u0001");
  // Items already added, by key. A list that only lost added items (the
  // caller dropped what was accepted) or came again with the same items
  // keeps them; a list with any item it didn't have starts afresh.
  const [book, setBook] = useState(() => ({
    signature,
    keys: new Set(keys),
    taken: new Set<string>() as ReadonlySet<string>,
  }));
  let taken = book.taken;
  if (book.signature !== signature) {
    const now = new Set(keys);
    const onlyLostTaken =
      keys.every((k) => book.keys.has(k)) &&
      Array.from(book.keys).every((k) => now.has(k) || book.taken.has(k));
    if (!onlyLostTaken) taken = new Set();
    setBook({ signature, keys: now, taken });
  }

  const left = items
    .map((item, index) => ({ item, index, key: keys[index] }))
    .filter(({ key }) => !taken.has(key));
  const show = render ?? (defaultRender as (item: T) => AiSuggestionText);

  /**
   * Focus the first row of the plan still shown, else (after a re-render
   * changed the rows) the one in the added row's place, else the heading;
   * with the list gone, `returnFocus`.
   */
  const placeFocus = (p: FocusPlan, rerendered: boolean) => {
    const section = sectionRef.current;
    if (!section?.isConnected) {
      returnFocusRef.current?.()?.focus();
      return;
    }
    for (const key of p.order) {
      const button = addButtons.current.get(key);
      if (button?.isConnected) {
        button.focus();
        return;
      }
    }
    const rows = rerendered
      ? Array.from(
          listRef.current?.querySelectorAll<HTMLButtonElement>("button[data-suggestion-add]") ?? []
        )
      : [];
    const near = rows[Math.min(p.at, rows.length - 1)];
    if (near) near.focus();
    else headingRef.current?.focus();
  };

  // After an add, React may have re-rendered the rows (the caller dropped
  // the added item, or more): if the focused row went, focus the next one.
  useIsomorphicLayoutEffect(() => {
    lastSection.current = sectionRef.current;
    const p = plan.current;
    if (!p) return;
    const active = document.activeElement;
    if (lostFocus(active)) placeFocus(p, true);
  });

  // The list goes (the caller unmounted it) while focus is in it.
  useIsomorphicLayoutEffect(
    () => () => {
      const section = lastSection.current;
      const active = document.activeElement;
      const inside = Boolean(section && active && section.contains(active));
      if (inside || (lostFocus(active) && plan.current)) returnFocusRef.current?.()?.focus();
    },
    []
  );

  if (items.length === 0 && taken.size === 0) return null;

  /** Keep `p` for the re-renders this add causes, then drop it. */
  const holdPlan = (p: FocusPlan) => {
    plan.current = p;
    window.setTimeout(() => {
      if (plan.current === p) plan.current = null;
    }, 0);
  };

  /** Did the caller move focus out of the list (to the field it filled)? */
  const callerMovedFocus = (before: Element | null) => {
    const now = document.activeElement;
    return now !== before && !lostFocus(now) && !sectionRef.current?.contains(now);
  };

  const acceptOne = (item: T, key: string, index: number) => {
    const at = left.findIndex((entry) => entry.key === key);
    const p: FocusPlan = {
      order: [
        ...left.slice(at + 1).map((entry) => entry.key),
        ...left
          .slice(0, Math.max(0, at))
          .map((entry) => entry.key)
          .reverse(),
      ],
      at,
    };
    const before = document.activeElement;
    setBook((b) => ({ ...b, taken: new Set(b.taken).add(key) }));
    onAccept(item, index);
    if (callerMovedFocus(before)) return;
    // The focused Add button is about to go: focus the next one first.
    holdPlan(p);
    placeFocus(p, false);
  };
  const acceptAll = () => {
    const rest = left;
    const before = document.activeElement;
    setBook((b) => ({ ...b, taken: new Set([...Array.from(b.taken), ...keys]) }));
    if (onAcceptAll) onAcceptAll(rest.map(({ item }) => item));
    else rest.forEach(({ item, index }) => onAccept(item, index));
    if (callerMovedFocus(before)) return;
    holdPlan({ order: [], at: Number.MAX_SAFE_INTEGER });
    headingRef.current?.focus();
  };
  const dismiss = () => {
    plan.current = null;
    // The focused Dismiss button is about to go with the list.
    returnFocus?.()?.focus();
    onDismiss();
  };

  return (
    <section
      ref={sectionRef}
      aria-labelledby={headingId}
      data-testid="ai-suggestions"
      className={cn("rounded-lg border border-border bg-card p-3", className)}
    >
      <div className="flex flex-wrap items-start justify-between gap-2">
        <div className="min-w-0">
          <h3
            id={headingId}
            ref={headingRef}
            tabIndex={-1}
            className="flex items-center gap-1.5 rounded-sm text-sm font-semibold text-text focus:outline-none focus-visible:ring-2 focus-visible:ring-ring"
          >
            <PenLine className="h-4 w-4 shrink-0 text-accent" aria-hidden="true" />
            {title}
          </h3>
          <p className="mt-0.5 text-xs text-sub">
            {source === "fallback"
              ? "Suggested without AI. Check before you add."
              : "Suggested by Amr's AI. Check before you add."}
          </p>
        </div>
        <Button
          type="button"
          size="sm"
          variant="ghost"
          onClick={dismiss}
          className="gap-1"
          aria-label="Dismiss suggestions"
        >
          <X aria-hidden="true" />
          Dismiss
        </Button>
      </div>

      {left.length === 0 ? (
        <p role="status" className="mt-2 flex items-center gap-1.5 text-sm text-text">
          <Check className="h-4 w-4 shrink-0 text-success" aria-hidden="true" />
          All added.
        </p>
      ) : (
        <>
          <ul ref={listRef} className="mt-2 space-y-2">
            {left.map(({ item, index, key }) => {
              const { title: line, detail } = textOf(show(item));
              return (
                <li
                  key={key}
                  className="flex items-start justify-between gap-2 rounded-md border border-border bg-surface px-2 py-2"
                >
                  <div className="min-w-0 break-words">
                    <p className="text-sm text-text">{line}</p>
                    {detail && <p className="mt-0.5 text-xs text-sub">{detail}</p>}
                  </div>
                  <Button
                    ref={(el) => {
                      if (el) addButtons.current.set(key, el);
                      else addButtons.current.delete(key);
                    }}
                    type="button"
                    size="sm"
                    variant="outline"
                    onClick={() => acceptOne(item, key, index)}
                    className="shrink-0 gap-1"
                    aria-label={`${acceptLabel}: ${line}`}
                    data-suggestion-add=""
                  >
                    <Plus aria-hidden="true" />
                    {acceptLabel}
                  </Button>
                </li>
              );
            })}
          </ul>
          {left.length > 1 && !pickOne && (
            <div className="mt-2">
              <Button type="button" size="sm" variant="toolkit" onClick={acceptAll}>
                {acceptLabel} all {left.length}
              </Button>
            </div>
          )}
        </>
      )}
    </section>
  );
}
