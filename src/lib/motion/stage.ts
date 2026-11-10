/**
 * Whether a comic intro holds the stage. lib/comics/intro.ts puts
 * `data-intro="<kind>"` on <html> while one plays, and removes it when the
 * intro ends. This is the same rule the quiet state reads first
 * (lib/notify/quiet-state.ts): any non-empty value counts. Motion code asks
 * here so a page change or a scroll arrival never starts under an intro.
 */

import { defaultQuietDom, type QuietDom } from "@/lib/notify/quiet-state";

/** @param root the <html> element (or anything with its dataset); null on the server */
export function isIntroOnStage(root: QuietDom | null | undefined = defaultQuietDom()): boolean {
  return Boolean(root?.dataset.intro);
}
