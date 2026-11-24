/**
 * What a PNG export (lib/utils/export's exportToPNG) leaves out of its
 * picture. Its own module, so a component can mark its controls without
 * loading html-to-image.
 */

/**
 * Marks a control inside a PNG export's target that the picture leaves out
 * (a part's Edit and Delete, a form, Amr's draft card): spread it on the
 * element, `<div {...EXPORT_SKIP}>`. Everything under it goes too.
 */
export const EXPORT_SKIP = { "data-export-skip": "" } as const;

/** html-to-image's filter: false for an element marked with EXPORT_SKIP, true for the rest. */
export function keepInExport(node: Node): boolean {
  return !(node instanceof Element && node.hasAttribute("data-export-skip"));
}
