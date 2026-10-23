import type { Epic } from "@/lib/stores/workspace-types";

/**
 * Epic colours, as theme tokens. The roadmap stored fixed hex ("#00f0ff")
 * that ignored the light and high-contrast themes; an epic now stores the
 * token's key ("chart-3") and the theme decides the shade. Keys only ever
 * reach a style through this list, so a hand-edited colour can't inject CSS.
 *
 * Every token must stay a distinct colour, of the hue its name says, in all
 * three themes: `accent2` was indigo in dark and light but the same green
 * as chart-3 in high contrast, so it gave way to the neutral `sub`.
 */
export const EPIC_COLORS = [
  { key: "chart-1", name: "Blue" },
  { key: "chart-2", name: "Pink" },
  { key: "chart-3", name: "Green" },
  { key: "chart-4", name: "Amber" },
  { key: "chart-5", name: "Violet" },
  { key: "sub", name: "Grey" },
  { key: "danger", name: "Red" },
] as const;

export type EpicColorKey = (typeof EPIC_COLORS)[number]["key"];

const KEYS = new Set<string>(EPIC_COLORS.map((c) => c.key));

/**
 * The old palette's hex, each mapped to its own token. The old roadmap
 * handed colours out in turn, so keeping neighbours apart matters more than
 * the hue: indigo, which no token keeps in every theme, maps to grey rather
 * than doubling up with violet. `accent2` is the key indigo had briefly.
 */
const LEGACY_HEX: Record<string, EpicColorKey> = {
  "#00f0ff": "chart-1",
  "#f472b6": "chart-2",
  "#34d399": "chart-3",
  "#f59e0b": "chart-4",
  "#a855f7": "chart-5",
  "#6366f1": "sub",
  accent2: "sub",
  "#ef4444": "danger",
};

export function isEpicColorKey(v: unknown): v is EpicColorKey {
  return typeof v === "string" && KEYS.has(v);
}

/**
 * The epic's colour key: its stored token, the token for a colour from the
 * old palette, or one by position for an epic without a usable colour (an
 * agent's `add_epic` sets none).
 */
export function epicColorKey(epic: Pick<Epic, "color">, index: number): EpicColorKey {
  const c = epic.color?.trim().toLowerCase();
  if (isEpicColorKey(c)) return c;
  if (c && LEGACY_HEX[c]) return LEGACY_HEX[c];
  return EPIC_COLORS[Math.abs(index) % EPIC_COLORS.length].key;
}

/** The CSS colour for a key: a theme variable, never a literal. */
export function colorVar(key: EpicColorKey): string {
  return `var(--${key})`;
}

/** The colour at `percent`% strength over transparent, for tracks and tints. */
export function colorTint(key: EpicColorKey, percent: number): string {
  return `color-mix(in srgb, var(--${key}) ${percent}%, transparent)`;
}

export function colorName(key: EpicColorKey): string {
  return EPIC_COLORS.find((c) => c.key === key)?.name ?? key;
}

/** The first palette colour no epic uses yet (or the next in turn when all are used). */
export function nextColor(epics: readonly Pick<Epic, "color">[]): EpicColorKey {
  const used = new Set(epics.map((e, i) => epicColorKey(e, i)));
  return (
    EPIC_COLORS.find((c) => !used.has(c.key))?.key ??
    EPIC_COLORS[epics.length % EPIC_COLORS.length].key
  );
}
