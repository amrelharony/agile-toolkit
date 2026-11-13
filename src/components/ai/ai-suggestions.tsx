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
 * Keyboard focus never falls back to the page: adding an item moves focus to
 * the next item's Add button (or the one before), and when none is left, or
 * after "Add all", to the list's heading, with "All added." announced.
 */

import { useEffect, useId, useMemo, useRef, useState } from "react";
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
  /** Add one item (through the tool's store). */
  onAccept: (item: T, index: number) => void;
  /** Add every item still in the list. Default: onAccept for each, in order. */
  onAcceptAll?: (items: T[]) => void;
  /** Close the list without adding the rest. */
  onDismiss: () => void;
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

export function AiSuggestions<T>({
  items,
  render,
  onAccept,
  onAcceptAll,
  onDismiss,
  source,
  title = "Amr's suggestions",
  acceptLabel = "Add",
  pickOne = false,
  className,
}: AiSuggestionsProps<T>) {
  const headingId = useId();
  const headingRef = useRef<HTMLHeadingElement>(null);
  /** Each shown item's Add button, by the item's index. */
  const addButtons = useRef(new Map<number, HTMLButtonElement>());
  // Items already added, by index. A list with different contents starts
  // afresh; the same contents passed again (a new array each render) don't.
  const [taken, setTaken] = useState<ReadonlySet<number>>(() => new Set());
  const signature = useMemo(() => {
    try {
      return JSON.stringify(items);
    } catch {
      return `${items.length}`;
    }
  }, [items]);
  useEffect(() => {
    setTaken(new Set());
  }, [signature]);

  const left = useMemo(
    () => items.map((item, index) => ({ item, index })).filter(({ index }) => !taken.has(index)),
    [items, taken]
  );
  const show = render ?? (defaultRender as (item: T) => AiSuggestionText);

  if (items.length === 0) return null;

  const acceptOne = (item: T, index: number) => {
    onAccept(item, index);
    // The focused Add button is about to go: focus the next one first.
    const at = left.findIndex((entry) => entry.index === index);
    const next = left[at + 1] ?? left[at - 1];
    const target = next ? addButtons.current.get(next.index) : null;
    if (target) target.focus();
    else headingRef.current?.focus();
    setTaken((prev) => new Set(prev).add(index));
  };
  const acceptAll = () => {
    const rest = left.map(({ item }) => item);
    if (onAcceptAll) onAcceptAll(rest);
    else left.forEach(({ item, index }) => onAccept(item, index));
    headingRef.current?.focus();
    setTaken(new Set(items.map((_, index) => index)));
  };

  return (
    <section
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
          onClick={onDismiss}
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
          <ul className="mt-2 space-y-2">
            {left.map(({ item, index }) => {
              const { title: line, detail } = textOf(show(item));
              return (
                <li
                  key={index}
                  className="flex items-start justify-between gap-2 rounded-md border border-border bg-surface px-2 py-2"
                >
                  <div className="min-w-0 break-words">
                    <p className="text-sm text-text">{line}</p>
                    {detail && <p className="mt-0.5 text-xs text-sub">{detail}</p>}
                  </div>
                  <Button
                    ref={(el) => {
                      if (el) addButtons.current.set(index, el);
                      else addButtons.current.delete(index);
                    }}
                    type="button"
                    size="sm"
                    variant="outline"
                    onClick={() => acceptOne(item, index)}
                    className="shrink-0 gap-1"
                    aria-label={`${acceptLabel}: ${line}`}
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
