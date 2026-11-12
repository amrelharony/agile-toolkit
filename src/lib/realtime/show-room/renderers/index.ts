/**
 * Show rooms: the renderer registry, per tool and frame kind.
 *
 * Built from small files, one per tool (`picker.tsx`, `team-mixer.tsx`,
 * `card-decks.tsx`), plus the generic "text" renderer every tool gets. The
 * `/join` page reaches this through the generic show view, so nothing here
 * may import tool page code. `registerShowRenderer` adds (or replaces) one
 * at run time, for a tool's page or a test; it returns how to take it out.
 */

import { isFrameKind, isShowRoomTool, type ShowRoomTool } from "../protocol";
import { TEXT_FRAME_KIND } from "../frames";
import { CARD_DECKS_RENDERERS } from "./card-decks";
import { PICKER_RENDERERS } from "./picker";
import { TEAM_MIXER_RENDERERS } from "./team-mixer";
import { TEXT_RENDERER } from "./text";
import type { ShowFrameRenderer, ShowRenderers } from "./types";

export { defineShowRenderer } from "./types";
export type { ShowFrameMeta, ShowFrameRenderer, ShowRendererProps, ShowRenderers } from "./types";
export { TextFrameView } from "./text";

const BUILT_IN: Readonly<Record<ShowRoomTool, ShowRenderers>> = {
  picker: { ...PICKER_RENDERERS, [TEXT_FRAME_KIND]: TEXT_RENDERER },
  "team-mixer": { ...TEAM_MIXER_RENDERERS, [TEXT_FRAME_KIND]: TEXT_RENDERER },
  "card-decks": { ...CARD_DECKS_RENDERERS, [TEXT_FRAME_KIND]: TEXT_RENDERER },
};

const added = new Map<string, ShowFrameRenderer>();
const keyOf = (tool: string, kind: string) => `${tool}\u0000${kind}`;

/**
 * Draw `tool`'s frames of `frameKind` with `component` (it gets the parsed
 * payload). A kind still needs its parser in `../frames/<tool>.ts`, or no
 * frame of it reaches a renderer. Returns a function that takes it out.
 */
export function registerShowRenderer(
  tool: ShowRoomTool,
  frameKind: string,
  component: ShowFrameRenderer
): () => void {
  if (!isShowRoomTool(tool) || !isFrameKind(frameKind)) return () => {};
  const key = keyOf(tool, frameKind);
  added.set(key, component);
  return () => {
    if (added.get(key) === component) added.delete(key);
  };
}

/** The renderer for `tool`'s frames of `frameKind`, or null when there is none. */
export function showRendererFor(tool: unknown, frameKind: unknown): ShowFrameRenderer | null {
  if (!isShowRoomTool(tool) || !isFrameKind(frameKind)) return null;
  const extra = added.get(keyOf(tool, frameKind));
  if (extra) return extra;
  const built = BUILT_IN[tool];
  return Object.prototype.hasOwnProperty.call(built, frameKind) ? built[frameKind] : null;
}
