/**
 * Whether a modal dialog or sheet is open, read from the DOM when the
 * notification policy decides or the deferred queue flushes. Nothing
 * observes or polls: one query, only when asked.
 *
 * Counts as open:
 * - Radix dialogs, alert dialogs and sheets: `role="dialog"` /
 *   `role="alertdialog"` with `data-state="open"`;
 * - hand-built modals (canvas share, session share, import, templates, card
 *   detail): `role="dialog"` with `aria-modal="true"` and no data-state;
 * - a native `<dialog open>`.
 *
 * A Radix Popover also renders `role="dialog" data-state="open"`, inside a
 * `[data-radix-popper-content-wrapper]`: it is not a modal and is left out.
 * globals.css raises the toaster over the same selectors (a test keeps the
 * two in step). No "use client": on the server it reports false.
 */

export const OPEN_DIALOG_SELECTORS = [
  '[role="dialog"][data-state="open"]',
  '[role="alertdialog"][data-state="open"]',
  '[role="dialog"][aria-modal="true"]',
  '[role="alertdialog"][aria-modal="true"]',
  "dialog[open]",
] as const;

export const OPEN_DIALOG_SELECTOR = OPEN_DIALOG_SELECTORS.join(", ");

/** Popovers render role="dialog" inside this wrapper; they are not modals. */
export const POPOVER_WRAPPER_SELECTOR = "[data-radix-popper-content-wrapper]";

export function isDialogOpen(root?: ParentNode | null): boolean {
  const scope = root ?? (typeof document === "undefined" ? null : document);
  if (!scope) return false;
  try {
    const found = scope.querySelectorAll(OPEN_DIALOG_SELECTOR);
    for (let i = 0; i < found.length; i++) {
      if (!found[i].closest(POPOVER_WRAPPER_SELECTOR)) return true;
    }
    return false;
  } catch {
    return false;
  }
}
