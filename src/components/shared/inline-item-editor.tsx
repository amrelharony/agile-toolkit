"use client";

/**
 * The one way to edit an item after adding it: Retro cards, Kanban cards and
 * Planning Poker stories. The item's text turns into a small inline form.
 *
 *   - Enter in the title saves. In the description, Enter is a new line and
 *     Ctrl/Cmd+Enter saves, as in the tools' add forms.
 *   - Escape cancels. Clicking away saves, like `EditableName`.
 *   - An emptied title reverts. An emptied description is removed: it's
 *     optional.
 *   - Save and Cancel buttons for pointer and touch.
 *
 * The title is a growing textarea so a long card wraps while it's edited,
 * but it stays one line: line breaks become spaces.
 *
 * Pair it with `useInlineEdit` for the trigger (the item's text, or an Edit
 * button). After a keyboard save or cancel, or either button, focus goes
 * back to the trigger; after clicking away it stays where the user clicked.
 */

import {
  useCallback,
  useEffect,
  useRef,
  useState,
  type FocusEvent,
  type KeyboardEvent,
  type MouseEvent,
} from "react";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { cn } from "@/lib/utils";

export interface ItemText {
  title: string;
  /** Set when the editor shows a description field. "" removes it. */
  description?: string;
}

export interface InlineItemEditorProps {
  /** Accessible name of the whole form ("Edit card", "Edit story"). */
  label?: string;
  title: string;
  description?: string;
  /** Show a description field under the title. */
  withDescription?: boolean;
  /** Accessible name of the title field ("Card text", "Story title"). */
  titleLabel: string;
  descriptionLabel?: string;
  titleMaxLength?: number;
  descriptionMaxLength?: number;
  /**
   * Called once when the edit ends. `next` is null when it was cancelled,
   * the title was emptied, or nothing changed. `refocus` asks the caller to
   * put focus back on the trigger.
   */
  onDone: (next: ItemText | null, opts: { refocus: boolean }) => void;
  className?: string;
}

/** One line, trimmed: pasted line breaks become spaces. */
function oneLine(text: string): string {
  return text.replace(/\s*[\r\n]+\s*/g, " ").trim();
}

/** Grow a textarea to fit its text, borders included. */
function fit(el: HTMLTextAreaElement | null) {
  if (!el) return;
  el.style.height = "auto";
  el.style.height = `${el.scrollHeight + (el.offsetHeight - el.clientHeight)}px`;
}

/** Keep focus in the editor when a button is pressed, so the blur-save doesn't fire first. */
const keepFocus = (e: MouseEvent) => e.preventDefault();

export function InlineItemEditor({
  label = "Edit",
  title,
  description,
  withDescription = false,
  titleLabel,
  descriptionLabel = "Description",
  titleMaxLength,
  descriptionMaxLength,
  onDone,
  className,
}: InlineItemEditorProps) {
  const [titleDraft, setTitleDraft] = useState(title);
  const [descriptionDraft, setDescriptionDraft] = useState(description ?? "");
  const rootRef = useRef<HTMLDivElement>(null);
  const titleRef = useRef<HTMLTextAreaElement>(null);
  const descriptionRef = useRef<HTMLTextAreaElement>(null);
  // Enter, a button, then the unmount blur: only the first one counts.
  const done = useRef(false);

  useEffect(() => {
    const el = titleRef.current;
    el?.focus();
    el?.select();
  }, []);
  useEffect(() => fit(titleRef.current), [titleDraft]);
  useEffect(() => fit(descriptionRef.current), [descriptionDraft]);

  const finish = useCallback(
    (save: boolean, refocus: boolean) => {
      if (done.current) return;
      done.current = true;
      if (!save) {
        onDone(null, { refocus });
        return;
      }
      const raw = oneLine(titleDraft);
      const nextTitle = titleMaxLength ? raw.slice(0, titleMaxLength) : raw;
      const nextDescription = withDescription ? descriptionDraft.trim() : undefined;
      const unchanged =
        nextTitle === oneLine(title) &&
        (nextDescription === undefined || nextDescription === (description ?? "").trim());
      // An emptied title reverts rather than wiping the item.
      if (!nextTitle || unchanged) {
        onDone(null, { refocus });
        return;
      }
      onDone(
        withDescription ? { title: nextTitle, description: nextDescription } : { title: nextTitle },
        { refocus }
      );
    },
    [description, descriptionDraft, onDone, title, titleDraft, titleMaxLength, withDescription]
  );

  const onTitleKey = (e: KeyboardEvent<HTMLTextAreaElement>) => {
    if (e.nativeEvent.isComposing) return;
    if (e.key === "Enter") {
      e.preventDefault();
      finish(true, true);
    } else if (e.key === "Escape") {
      e.preventDefault();
      e.stopPropagation();
      finish(false, true);
    }
  };

  const onDescriptionKey = (e: KeyboardEvent<HTMLTextAreaElement>) => {
    if (e.nativeEvent.isComposing) return;
    if (e.key === "Enter" && (e.metaKey || e.ctrlKey)) {
      e.preventDefault();
      finish(true, true);
    } else if (e.key === "Escape") {
      e.preventDefault();
      e.stopPropagation();
      finish(false, true);
    }
  };

  // Focus leaving the editor altogether saves; moving between its own
  // fields and buttons doesn't.
  const onBlur = (e: FocusEvent<HTMLElement>) => {
    const next = e.relatedTarget as Node | null;
    if (next && rootRef.current?.contains(next)) return;
    finish(true, false);
  };

  return (
    <div
      ref={rootRef}
      role="group"
      aria-label={label}
      className={cn("flex min-w-0 flex-col gap-1.5", className)}
    >
      <Textarea
        ref={titleRef}
        rows={1}
        value={titleDraft}
        maxLength={titleMaxLength}
        enterKeyHint="done"
        aria-label={titleLabel}
        onChange={(e) => setTitleDraft(e.target.value)}
        onKeyDown={onTitleKey}
        onBlur={onBlur}
        className="min-h-0 resize-none overflow-hidden border-border bg-surface px-2 py-1.5 leading-snug text-text focus-visible:ring-accent/40"
      />
      {withDescription && (
        <Textarea
          ref={descriptionRef}
          rows={2}
          value={descriptionDraft}
          maxLength={descriptionMaxLength}
          placeholder="Description (optional)"
          aria-label={descriptionLabel}
          onChange={(e) => setDescriptionDraft(e.target.value)}
          onKeyDown={onDescriptionKey}
          onBlur={onBlur}
          className="min-h-0 resize-none overflow-hidden border-border bg-surface px-2 py-1.5 text-xs leading-snug text-text pointer-fine:md:text-xs focus-visible:ring-accent/40"
        />
      )}
      <div className="flex justify-end gap-1.5">
        <Button
          type="button"
          size="sm"
          variant="ghost"
          onMouseDown={keepFocus}
          onClick={() => finish(false, true)}
          onBlur={onBlur}
          className="h-7 px-2 text-xs text-sub"
        >
          Cancel
        </Button>
        <Button
          type="button"
          size="sm"
          variant="toolkit"
          onMouseDown={keepFocus}
          onClick={() => finish(true, true)}
          onBlur={onBlur}
          className="h-7 px-2 text-xs"
        >
          Save
        </Button>
      </div>
    </div>
  );
}

/**
 * Edit state for one item, and its trigger. `stop({ refocus: true })` puts
 * focus back on `triggerRef` once the trigger is back on screen.
 */
export function useInlineEdit<T extends HTMLElement = HTMLButtonElement>() {
  const [editing, setEditing] = useState(false);
  const triggerRef = useRef<T>(null);
  const refocus = useRef(false);

  useEffect(() => {
    if (editing || !refocus.current) return;
    refocus.current = false;
    triggerRef.current?.focus();
  }, [editing]);

  const start = useCallback(() => setEditing(true), []);
  const stop = useCallback((opts?: { refocus?: boolean }) => {
    refocus.current = opts?.refocus === true;
    setEditing(false);
  }, []);

  return { editing, start, stop, triggerRef };
}
