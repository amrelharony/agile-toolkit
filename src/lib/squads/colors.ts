/**
 * Squad-profile color palette. Lives in its own module so both the
 * client-side join form and the server-side validator can import it
 * without dragging in `server-only` symbols.
 *
 * Keep in sync with the COLORS array in src/lib/realtime/use-room.ts —
 * presence + profile share the same palette so a guest's profile color
 * matches their realtime cursor color.
 */

export const SQUAD_COLORS = [
  "#00f0ff",
  "#a855f7",
  "#f472b6",
  "#facc15",
  "#34d399",
  "#fb923c",
  "#60a5fa",
  "#f87171",
] as const;

export type SquadColor = (typeof SQUAD_COLORS)[number];

/**
 * Words on an identity colour. These fills are bright in every mode, so the ink
 * is fixed rather than a page token: `text-bg` turns to paper in the comic.
 */
export const IDENTITY_INK = "#111111";

const COLOR_SET = new Set<string>(SQUAD_COLORS);

export function isValidColor(input: unknown): input is SquadColor {
  return typeof input === "string" && COLOR_SET.has(input);
}
