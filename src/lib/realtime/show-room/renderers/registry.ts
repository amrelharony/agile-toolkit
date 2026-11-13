/**
 * Show rooms: the renderer registry, without any tool's renderers in it.
 *
 * The generic "text" renderer is built in. Each tool's own renderers
 * (`picker.tsx`, `team-mixer.tsx`, `card-decks.tsx`) load on demand,
 * one tool at a time (`loadShowRenderers`), so a room for one tool never
 * downloads another tool's renderers (Card Decks never gets the Picker's
 * wheel). `ShowFrameView` loads its tool's set when it mounts and draws a
 * frame once it is in. `./index` imports every tool's set up front, for
 * code that needs them all at once, such as tests.
 *
 * `registerShowRenderer` adds (or replaces) one at run time, for a tool's
 * page or a test; it returns how to take it out. Nothing here may import
 * tool page code: the `/join` page reaches it through the generic views.
 */

import { isFrameKind, isShowRoomTool, type ShowRoomTool } from "../protocol";
import { TEXT_FRAME_KIND } from "../frames";
import { TEXT_RENDERER } from "./text";
import type { ShowFrameRenderer, ShowRenderers } from "./types";

/** Each tool's renderers, as its own chunk. */
const LOADERS: Readonly<Record<ShowRoomTool, () => Promise<ShowRenderers>>> = {
  picker: () => import("./picker").then((m) => m.PICKER_RENDERERS),
  "team-mixer": () => import("./team-mixer").then((m) => m.TEAM_MIXER_RENDERERS),
  "card-decks": () => import("./card-decks").then((m) => m.CARD_DECKS_RENDERERS),
};

/** The tools' sets that have loaded. */
const loaded = new Map<ShowRoomTool, ShowRenderers>();
/** Loads under way (or done), so each tool's set is fetched once. */
const loading = new Map<ShowRoomTool, Promise<ShowRenderers>>();

const added = new Map<string, ShowFrameRenderer>();
const keyOf = (tool: string, kind: string) => `${tool}\u0000${kind}`;

/** Puts a tool's set in the registry now (`./index` does this for every tool). */
export function seedShowRenderers(tool: ShowRoomTool, renderers: ShowRenderers): void {
  loaded.set(tool, renderers);
  loading.set(tool, Promise.resolve(renderers));
}

/** `tool`'s own renderers if they have loaded, else null. */
export function loadedShowRenderers(tool: ShowRoomTool): ShowRenderers | null {
  return loaded.get(tool) ?? null;
}

/**
 * Loads `tool`'s own renderers, once. A failed load (say, a chunk the
 * network lost) is forgotten, so a later call tries again.
 */
export function loadShowRenderers(tool: ShowRoomTool): Promise<ShowRenderers> {
  const known = loading.get(tool);
  if (known) return known;
  const next = LOADERS[tool]().then(
    (renderers) => {
      loaded.set(tool, renderers);
      return renderers;
    },
    (error: unknown) => {
      loading.delete(tool);
      throw error;
    }
  );
  loading.set(tool, next);
  return next;
}

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

/**
 * The renderer for `tool`'s frames of `frameKind`, or null when there is
 * none: one registered at run time, the built-in text one, or the tool's
 * own, once its set has loaded (null before).
 */
export function showRendererFor(tool: unknown, frameKind: unknown): ShowFrameRenderer | null {
  if (!isShowRoomTool(tool) || !isFrameKind(frameKind)) return null;
  const extra = added.get(keyOf(tool, frameKind));
  if (extra) return extra;
  if (frameKind === TEXT_FRAME_KIND) return TEXT_RENDERER;
  const own = loaded.get(tool);
  return own && Object.prototype.hasOwnProperty.call(own, frameKind) ? own[frameKind] : null;
}
