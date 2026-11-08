/**
 * Whether a modal dialog or sheet is open, read from the DOM when the
 * notification policy decides or the deferred queue flushes. Nothing
 * observes or polls: one query, only when asked.
 *
 * Radix dialogs, alert dialogs and sheets render `role="dialog"` /
 * `role="alertdialog"` with `data-state="open"`; a native <dialog open>
 * counts too. No "use client": on the server it reports false.
 */

export const OPEN_DIALOG_SELECTOR = [
  '[role="dialog"][data-state="open"]',
  '[role="alertdialog"][data-state="open"]',
  "dialog[open]",
].join(", ");

export function isDialogOpen(root?: ParentNode | null): boolean {
  const scope = root ?? (typeof document === "undefined" ? null : document);
  if (!scope) return false;
  try {
    return scope.querySelector(OPEN_DIALOG_SELECTOR) !== null;
  } catch {
    return false;
  }
}
