/**
 * The id of Amr's chat panel (the dialog), for the aria-controls of every
 * button that opens it: Amr's own button and the header's opener.
 *
 * No imports on purpose: the header is in every page's first load and must
 * not pull the mascot chunk in to name the panel it opens.
 */
export const AMR_PANEL_ID = "amr-panel";
