/**
 * Show rooms: the renderer registry with every tool's renderers in it.
 *
 * Built from small files, one per tool (`picker.tsx`, `team-mixer.tsx`,
 * `card-decks.tsx`), plus the generic "text" renderer every tool gets.
 * Importing this file puts all three tools' sets in the registry at once,
 * for code that needs them all synchronously, such as tests. The rooms
 * themselves use `./registry`, which loads only their own tool's set (see
 * there), so a page never downloads another tool's renderers. Nothing here
 * may import tool page code. `registerShowRenderer` adds (or replaces) one
 * at run time, for a tool's page or a test; it returns how to take it out.
 */

import { CARD_DECKS_RENDERERS } from "./card-decks";
import { PICKER_RENDERERS } from "./picker";
import { TEAM_MIXER_RENDERERS } from "./team-mixer";
import { seedShowRenderers } from "./registry";

seedShowRenderers("picker", PICKER_RENDERERS);
seedShowRenderers("team-mixer", TEAM_MIXER_RENDERERS);
seedShowRenderers("card-decks", CARD_DECKS_RENDERERS);

export { defineShowRenderer } from "./types";
export type { ShowFrameMeta, ShowFrameRenderer, ShowRendererProps, ShowRenderers } from "./types";
export { TextFrameView } from "./text";
export {
  loadShowRenderers,
  loadedShowRenderers,
  registerShowRenderer,
  showRendererFor,
} from "./registry";
