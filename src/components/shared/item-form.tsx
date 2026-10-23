"use client";

import {
  useCallback,
  useEffect,
  useRef,
  useState,
  type FormEvent,
  type KeyboardEvent,
  type ReactNode,
  type RefObject,
} from "react";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";
import { focusFirstInvalid, type FormErrors, type Validation } from "@/lib/utils/form";

export interface UseItemFormOptions<D, V, K extends string> {
  /** The empty draft (add forms) or the item's current values (edit forms). */
  initial: D | (() => D);
  /** Check a draft. Blank values are errors, never silent defaults. */
  validate: (draft: D) => Validation<V, K>;
  /** Called only with values that passed `validate`. */
  onSave: (values: V, draft: D) => void;
  /** Start again from `initial` after a save. Default true (add forms). */
  resetOnSave?: boolean;
}

export interface ItemFormState<D, K extends string> {
  draft: D;
  /** Merge a change into the draft. */
  update: (patch: Partial<D>) => void;
  /** Errors to show: empty until the first failed save, then live. */
  errors: FormErrors<K>;
  /** Validate and save. Returns whether it saved. */
  submit: (e?: FormEvent) => boolean;
  /** Back to `initial` (or `next`) with no errors showing. */
  reset: (next?: D) => void;
  formRef: RefObject<HTMLFormElement>;
}

/**
 * Draft-then-save for a tool's add or edit form.
 *
 * Several tools saved a blank record on "New" or silently ignored an Add
 * with a missing field. Here nothing reaches `onSave` until `validate`
 * passes; a failed save shows each field's message and focuses the first
 * invalid control, and from then on the messages update as the user types,
 * so fixing a field clears its error at once.
 *
 *   const form = useItemForm({ initial: EMPTY, validate, onSave: add });
 *   <ItemForm form={form} submitLabel="Add idea">…fields…</ItemForm>
 */
export function useItemForm<D extends object, V, K extends string = Extract<keyof D, string>>({
  initial,
  validate,
  onSave,
  resetOnSave = true,
}: UseItemFormOptions<D, V, K>): ItemFormState<D, K> {
  const initialRef = useRef(initial);
  initialRef.current = initial;
  const fresh = useCallback(() => {
    const i = initialRef.current;
    return typeof i === "function" ? (i as () => D)() : i;
  }, []);

  const [draft, setDraft] = useState<D>(fresh);
  const [attempt, setAttempt] = useState(0);
  const formRef = useRef<HTMLFormElement>(null);

  useEffect(() => {
    if (attempt > 0) focusFirstInvalid(formRef.current);
  }, [attempt]);

  const result = validate(draft);
  const errors: FormErrors<K> = attempt > 0 && !result.ok ? result.errors : {};

  const update = useCallback((patch: Partial<D>) => setDraft((d) => ({ ...d, ...patch })), []);

  const reset = useCallback(
    (next?: D) => {
      setDraft(next ?? fresh());
      setAttempt(0);
    },
    [fresh]
  );

  const submit = (e?: FormEvent) => {
    e?.preventDefault();
    if (!result.ok) {
      setAttempt((a) => a + 1);
      return false;
    }
    onSave(result.values, draft);
    if (resetOnSave) reset();
    else setAttempt(0);
    return true;
  };

  return { draft, update, errors, submit, reset, formRef };
}

/**
 * The <form> around a `useItemForm`: Enter in a field saves, Escape cancels
 * (when there is a Cancel), and the save button is never disabled — pressing
 * it on an incomplete draft is how the user finds out what's missing.
 */
export function ItemForm<D, K extends string>({
  form,
  submitLabel,
  submitIcon,
  onCancel,
  cancelLabel = "Cancel",
  footer,
  className,
  children,
}: {
  form: ItemFormState<D, K>;
  /** Names the action: "Add idea", "Save". Never "OK". */
  submitLabel: string;
  submitIcon?: ReactNode;
  onCancel?: () => void;
  cancelLabel?: string;
  /** Extra controls after the buttons (e.g. "Import from backlog"). */
  footer?: ReactNode;
  className?: string;
  children: ReactNode;
}) {
  const onKeyDown = (e: KeyboardEvent<HTMLFormElement>) => {
    if (e.key !== "Escape" || !onCancel) return;
    e.preventDefault();
    onCancel();
  };

  return (
    // Escape is a convenience on top of the visible Cancel button.
    // eslint-disable-next-line jsx-a11y/no-noninteractive-element-interactions
    <form
      ref={form.formRef}
      onSubmit={form.submit}
      onKeyDown={onKeyDown}
      noValidate
      className={cn("space-y-3", className)}
    >
      {children}
      <div className="flex flex-wrap items-center gap-2">
        <Button type="submit" className="gap-1">
          {submitIcon}
          {submitLabel}
        </Button>
        {onCancel && (
          <Button type="button" variant="ghost" onClick={onCancel}>
            {cancelLabel}
          </Button>
        )}
        {footer}
      </div>
    </form>
  );
}
