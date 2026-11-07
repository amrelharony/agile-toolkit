/**
 * The four habits the printed posters and kudos cards are colour-coded by, plus
 * the open cards' colour, from print-campaign.json. They're print colours, so
 * they stay the same in every page theme, and like the kudos cards' they are only
 * ever fills under their own ink: as text on the page, Trust and Ownership fail
 * 4.5:1, and in night all but Ownership do.
 */

import campaign from "./print-campaign.json";

export type PrintThemeName = "Focus" | "Ownership" | "Real needs" | "Trust";

export interface PrintTheme {
  name: string;
  /** The printed fill. */
  colour: string;
  /** Text on the fill: dark on Trust, as printed, white on the rest. */
  ink: string;
}

const WHITE = "#ffffff";
/** The open cards' colour, which is also the dark ink the print uses on Trust. */
const PRINT_DARK = "#14252A";

const printed = new Map(campaign.kudos.themes.map((t) => [t.name, t.colour]));

function theme<N extends string>(name: N, ink: string): PrintTheme & { name: N } {
  const colour = printed.get(name);
  if (!colour) throw new Error(`print-campaign.json has no "${name}" theme`);
  return { name, colour, ink };
}

/** In the order the data file gives them. */
export const PRINT_THEMES: readonly (PrintTheme & { name: PrintThemeName })[] = [
  theme("Focus", WHITE),
  theme("Ownership", WHITE),
  theme("Real needs", WHITE),
  theme("Trust", PRINT_DARK),
];

/** The two open kudos cards, "Thank you!" and "Great teamwork!". */
export const OPEN_THEME: PrintTheme = theme("Open", WHITE);

export function isPrintThemeName(value: string): value is PrintThemeName {
  return PRINT_THEMES.some((t) => t.name === value);
}

export function printTheme(name: PrintThemeName): PrintTheme {
  return PRINT_THEMES.find((t) => t.name === name)!;
}
