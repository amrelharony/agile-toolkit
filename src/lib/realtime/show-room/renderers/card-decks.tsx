/**
 * Card Decks' show-room renderers: frame kind → component, one per kind
 * in `../frames/card-decks.ts`. Empty in the room kit; the Card Decks
 * builder adds them here (`defineShowRenderer`). Keep this file small and
 * free of tool page code: the `/join` page loads it for every show room.
 */

import type { ShowRenderers } from "./types";

export const CARD_DECKS_RENDERERS: ShowRenderers = {};
