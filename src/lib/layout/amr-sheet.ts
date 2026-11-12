/**
 * Amr's chat as the phone's full-height sheet, as every-page code sees it,
 * without importing any of Amr's code: mascot-assistant sets
 * `html[data-amr-sheet]` while his panel is open in that layout (and only
 * then), and closes the sheet when asked to here.
 *
 * Another full-screen surface opening over the sheet (the sidebar, search,
 * the trophy case, AI settings, Activity, the account menu) closes it first,
 * so two never stack. Where the toast stack goes beside his open panel is
 * published here too (below). No "use client" and no imports: on the server
 * the sheet is never open.
 */

/** The attribute on <html> while the sheet is open. */
export const AMR_SHEET_ATTR = "data-amr-sheet";

/** The document event that asks the open sheet to close: something else is opening over it. */
export const AMR_SHEET_CLOSE_EVENT = "amr-sheet-close";

/** Whether Amr's chat is open as the phone's full-height sheet right now. */
export function isAmrSheetOpen(): boolean {
  return typeof document !== "undefined" && document.documentElement.hasAttribute(AMR_SHEET_ATTR);
}

/**
 * Close Amr's sheet, if it is open, before another surface opens over it. It
 * closes as when something outside closed it: focus is left to the surface
 * that is opening, and Back's marker is taken out of history.
 */
export function closeAmrSheet(): void {
  if (isAmrSheetOpen()) document.dispatchEvent(new Event(AMR_SHEET_CLOSE_EVENT));
}

/**
 * Where the toast stack can go beside Amr's open panel, as mascot-assistant
 * publishes it on <html> (layout/app-toaster reads the variables, the notify
 * policy the attribute through amrHoldsToasts):
 *   --amr-toast-top        the phone sheet, compact (a keyboard up, or little
 *                          room): the stack's top, just under the sheet's one
 *                          header row, so a toast never covers its Close
 *   --amr-toast-room       the side panel: the width, px, beside it for a toast
 *   data-amr-toasts-held   the side panel leaves too little beside it for one:
 *                          what can wait is held, as in the sheet
 * None of them is there while the panel is shut.
 */
export const AMR_TOAST_TOP_VAR = "--amr-toast-top";
export const AMR_TOAST_ROOM_VAR = "--amr-toast-room";
export const AMR_TOASTS_HELD_ATTR = "data-amr-toasts-held";

/**
 * Whether Amr's open panel leaves the toaster no room of its own: his phone
 * sheet, or a side panel with too little beside it.
 */
export function amrHoldsToasts(): boolean {
  if (typeof document === "undefined") return false;
  const html = document.documentElement;
  return html.hasAttribute(AMR_SHEET_ATTR) || html.hasAttribute(AMR_TOASTS_HELD_ATTR);
}
