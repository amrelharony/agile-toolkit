/**
 * Team Mixer's show-room renderers: frame kind → component, one per kind
 * in `../frames/team-mixer.ts`. Empty in the room kit; the Team Mixer
 * builder adds them here (`defineShowRenderer`). Keep this file small and
 * free of tool page code: the `/join` page loads it for every show room.
 */

import type { ShowRenderers } from "./types";

export const TEAM_MIXER_RENDERERS: ShowRenderers = {};
