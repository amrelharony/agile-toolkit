/**
 * Amr's chat as the phone's full-height sheet, as every-page code sees it,
 * without importing any of Amr's code: mascot-assistant sets
 * `html[data-amr-sheet]` while his panel is open in that layout (and only
 * then), and closes the sheet when asked to here.
 *
 * Another full-screen surface opening over the sheet (the sidebar, search,
 * the trophy case, AI settings, Activity, the account menu) closes it first,
 * so two never stack. No "use client" and no imports: on the server the sheet
 * is never open.
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
