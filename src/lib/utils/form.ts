/**
 * Small helpers for the tools' draft-then-save forms.
 *
 * The UX contract (plan: tool UX contract, items 1–2) is that nothing is
 * saved until it is valid, a blank input is an error rather than a silent
 * default, and after a failed save the first invalid field gets focus.
 * `useItemForm` (components/shared/item-form) sequences that; these are the
 * pure pieces it and hand-rolled forms share.
 */

/** Field → message, for the fields that failed. */
export type FormErrors<K extends string = string> = Partial<Record<K, string>>;

/** A checked draft: the clean values, or why it can't be saved. */
export type Validation<V, K extends string = string> =
  | { ok: true; values: V }
  | { ok: false; errors: FormErrors<K> };

/** True for undefined, null, NaN and strings that are only whitespace. */
export function isBlank(value: unknown): boolean {
  if (value === undefined || value === null) return true;
  if (typeof value === "string") return value.trim() === "";
  if (typeof value === "number") return Number.isNaN(value);
  return false;
}

/**
 * The message for every blank field in `values` that has one in `messages`.
 *
 *   requiredErrors({ title, owner }, { title: "Enter a title." })
 *   // → { title: "Enter a title." } when the title is blank
 */
export function requiredErrors<K extends string>(
  values: Partial<Record<K, unknown>>,
  messages: Partial<Record<K, string>>
): FormErrors<K> {
  const errors: FormErrors<K> = {};
  for (const key of Object.keys(messages) as K[]) {
    if (isBlank(values[key])) errors[key] = messages[key];
  }
  return errors;
}

/**
 * A number typed into a text or number input: undefined when blank, NaN when
 * it isn't a number. Never 0 for an empty field — that was the silent default
 * behind "clearing a field writes 0".
 */
export function parseNumber(raw: string | number | null | undefined): number | undefined {
  if (raw === null || raw === undefined) return undefined;
  if (typeof raw === "number") return raw;
  if (raw.trim() === "") return undefined;
  return Number(raw);
}

export function hasErrors(errors: FormErrors): boolean {
  return Object.values(errors).some(Boolean);
}

/**
 * Move focus to the first invalid control under `root`: an input marked
 * aria-invalid, or the checked/first option of a scale with an error.
 */
export function focusFirstInvalid(root: HTMLElement | null): void {
  root
    ?.querySelector<HTMLElement>(
      '[aria-invalid="true"], [data-scale-invalid="true"] [role="radio"][tabindex="0"]'
    )
    ?.focus();
}
