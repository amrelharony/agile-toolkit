/**
 * Fun names for groups, without AI: drawn from the toolkit's themed lists
 * (lib/picker/themes, the same lists Picker and the `picker.theme_names`
 * task's fallback use), for a theme someone typed ("planets", "riv"). A
 * theme the lists don't know gets a list at random. Names only: nothing
 * here reads who is in a group.
 *
 * Seeded through src/lib/utils/random.ts. Pure and server-safe.
 */

import { NAME_THEMES, themeForText, type NameTheme } from "@/lib/picker/themes";
import { createRng, pick, shuffle, type Rng } from "@/lib/utils/random";
import { MIXER_LIMITS } from "./model";

/**
 * `count` different names for groups, from the list the typed `text`
 * points at (or one picked at random). Past a list's length the names
 * repeat with a number: "Oak 2".
 */
export function suggestGroupNames(
  text: string,
  count: number,
  rng: Rng = createRng()
): { theme: NameTheme; names: string[] } {
  const theme = themeForText(text) ?? pick(NAME_THEMES, { rng })!;
  const n = Math.max(0, Math.min(Math.floor(count), MIXER_LIMITS.groups));
  const order = shuffle(theme.names, rng);
  const names = Array.from({ length: n }, (_, i) => {
    const base = order[i % order.length];
    const lap = Math.floor(i / order.length);
    return (lap === 0 ? base : `${base} ${lap + 1}`).slice(0, MIXER_LIMITS.groupName);
  });
  return { theme, names };
}
