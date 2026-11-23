/**
 * What the site header and Amr's panel share: the panel's id and the way a
 * Ctrl/⌘ shortcut is written.
 *
 * No imports on purpose: the header is in every page's first load and must
 * not pull the mascot chunk in to name the panel it opens.
 */

/**
 * The id of Amr's chat panel (the dialog), for the aria-controls of every
 * button that opens it: Amr's own button and the header's opener.
 */
export const AMR_PANEL_ID = "amr-panel";

/**
 * A Ctrl/⌘ shortcut as a platform writes it, in the site header's style:
 * "⌘J" on Apple, "Ctrl J" elsewhere. One spelling for the header's search
 * keycap, its Amr opener's tooltip and Amr's panel; each caller says whether
 * it is on Apple (the header after it mounts, so the server render matches).
 */
export function platformShortcut(key: string, apple: boolean): string {
  return apple ? `⌘${key}` : `Ctrl ${key}`;
}
