import type { InkTone } from "./types";

/**
 * The Comic theme's colours as hex, for places that can't read CSS custom
 * properties: the link-preview images (app/og), which an image renderer
 * draws on the server. Each equals its token in globals.css's `.light`
 * block (test/ink/palette.test.ts reads them from there).
 */
export const COMIC_PALETTE: Record<InkTone, string> = {
  ink: "#1d1a18", // --text
  sub: "#574e44", // --sub
  paper: "#fffcf5", // --card
  accent: "#873a16", // --accent
  accent2: "#1c4f94", // --accent2
  accent3: "#6a3560", // --accent3
  success: "#1c5f3d", // --success
  warning: "#6f510c", // --warning
  danger: "#9c1c2e", // --danger
  info: "#174f9c", // --info
  moss: "#4c5b20", // --neon-green
  wood: "#784a10", // --neon-amber
  plum: "#8a2a54", // --neon-magenta
};

/** The page itself: paper, and the ink a panel is outlined in. */
export const COMIC_PAGE = {
  bg: "#f7f1e6", // --bg
  border: "#2b2622", // --border
} as const;

/** Which custom property each tone stands for (the palette test checks these). */
export const TONE_TOKEN: Record<InkTone, string> = {
  ink: "--text",
  sub: "--sub",
  paper: "--card",
  accent: "--accent",
  accent2: "--accent2",
  accent3: "--accent3",
  success: "--success",
  warning: "--warning",
  danger: "--danger",
  info: "--info",
  moss: "--neon-green",
  wood: "--neon-amber",
  plum: "--neon-magenta",
};
