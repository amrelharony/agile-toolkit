/**
 * The paper's grain (DNA-SPEC sections 1 and 8): still specks in the page paper
 * in Comic and Night, and on the faces of a drawn book. One recipe: specks
 * placed by mulberry32, so every run writes the same tiles and globals.css can
 * hold them as literal strings (test/ink/grain.test.ts holds them equal).
 *
 * A tile is one path of short horizontal strokes, 1 px wide, each starting on a
 * whole pixel and centred on a half-pixel row, so a speck fills whole pixels at
 * 1x, 2x and 3x. The page lays two tiles whose sides share no factor over each
 * other, so the pair repeats only every a·b px and no grid shows. No filter and
 * no dash pattern (dashes restart on every subpath and line specks up in rows).
 */
import { mulberry32 } from "./rng";

export type GrainTheme = "light" | "dark";

export interface GrainStrength {
  /** The two tile sides in px; they share no factor. */
  readonly tiles: readonly [number, number];
  /** Specks in each tile. */
  readonly specks: number;
  /** Speck opacity: black in Comic, white in Night. */
  readonly opacity: Readonly<Record<GrainTheme, number>>;
}

/** A: about 1.5% of the paper, the first draft. Hard to see on a phone. */
export const GRAIN_A: GrainStrength = {
  tiles: [61, 47],
  specks: 14,
  opacity: { light: 0.06, dark: 0.05 },
};

/** B, the default: about 3.5% of the paper. Seen up close, not at a glance. */
export const GRAIN_B: GrainStrength = {
  tiles: [61, 47],
  specks: 34,
  opacity: { light: 0.1, dark: 0.08 },
};

/** C: about 6% of the paper, B's specks on smaller tiles. */
export const GRAIN_C: GrainStrength = {
  tiles: [47, 37],
  specks: 34,
  opacity: { light: 0.1, dark: 0.08 },
};

/** The strength globals.css PAPER uses. */
export const PAPER_GRAIN: GrainStrength = GRAIN_B;

const INK: Record<GrainTheme, string> = { light: "black", dark: "white" };

export interface Speck {
  /** Left edge, a whole pixel. */
  readonly x: number;
  /** Pixel row; the stroke runs along row + 0.5. */
  readonly row: number;
  readonly len: 1 | 2;
}

/** Specks per row and per start column, so no line of them shows. */
const MAX_PER_LINE = 2;

/** Distance between two positions on a ring of `size`, since tiles repeat. */
function ringGap(a: number, b: number, size: number): number {
  const d = Math.abs(a - b) % size;
  return Math.min(d, size - d);
}

/**
 * Place `count` specks in a `size` px tile, sorted by row then x. Each keeps
 * two clear pixels on its own row and one on the rows above and below, across
 * the tile's edges too, so specks never join into a dash or a blot when the
 * tile repeats.
 */
export function grainSpecks(size: number, count: number): Speck[] {
  const rand = mulberry32(size * 1009 + count);
  const specks: Speck[] = [];
  const perRow = new Map<number, number>();
  const perX = new Map<number, number>();
  for (let tries = 0; specks.length < count; tries++) {
    if (tries > 20000) throw new Error(`grain: cannot fit ${count} specks in ${size} px`);
    const len: 1 | 2 = rand() < 0.5 ? 1 : 2;
    const x = Math.floor(rand() * (size - len + 1));
    const row = Math.floor(rand() * size);
    if ((perRow.get(row) ?? 0) >= MAX_PER_LINE || (perX.get(x) ?? 0) >= MAX_PER_LINE) continue;
    const crowded = specks.some((s) => {
      const rows = ringGap(s.row, row, size);
      if (rows > 1) return false;
      const margin = rows === 0 ? 2 : 1;
      for (let a = s.x; a < s.x + s.len; a++) {
        for (let b = x - margin; b < x + len + margin; b++) {
          if (ringGap(a, b, size) === 0) return true;
        }
      }
      return false;
    });
    if (crowded) continue;
    specks.push({ x, row, len });
    perRow.set(row, (perRow.get(row) ?? 0) + 1);
    perX.set(x, (perX.get(x) ?? 0) + 1);
  }
  return specks.sort((a, b) => a.row - b.row || a.x - b.x);
}

/** "0.5" as ".5", "3.5" as is: the path's numbers, short. */
function short(n: number): string {
  return String(n).replace(/^0\./, ".").replace(/^-0\./, "-.");
}

/**
 * The specks as one path: an absolute move to the first, then relative moves
 * from the end of each stroke to the start of the next, which keeps a tile
 * under 450 bytes.
 */
export function grainPath(specks: readonly Speck[]): string {
  let d = "";
  let px = 0;
  let prow = 0;
  specks.forEach((s, i) => {
    d += i === 0 ? `M${s.x} ${short(s.row + 0.5)}` : `m${s.x - px} ${s.row - prow}`;
    d += `h${s.len}`;
    px = s.x + s.len;
    prow = s.row;
  });
  return d;
}

function tileSvg(size: number, count: number, paint: string): string {
  const d = grainPath(grainSpecks(size, count));
  return (
    `<svg xmlns='http://www.w3.org/2000/svg' width='${size}' height='${size}'>` +
    `<path d='${d}' ${paint}/></svg>`
  );
}

/**
 * As a data URI for a double-quoted url(). The SVG holds no #, % or double
 * quote, so escaping the angle brackets is all any browser needs.
 */
function dataUri(svg: string): string {
  return `data:image/svg+xml,${svg.replace(/</g, "%3C").replace(/>/g, "%3E")}`;
}

/** The page's two tiles for a theme, as data URIs, larger first. */
export function grainTiles(theme: GrainTheme, strength: GrainStrength = PAPER_GRAIN): string[] {
  const paint = `stroke='${INK[theme]}' opacity='${short(strength.opacity[theme])}'`;
  return strength.tiles.map((size) => dataUri(tileSvg(size, strength.specks, paint)));
}

/** The page paper's whole background-image value for a theme. */
export function paperGrain(theme: GrainTheme, strength: GrainStrength = PAPER_GRAIN): string {
  return grainTiles(theme, strength)
    .map((tile) => `url("${tile}")`)
    .join(", ");
}

/**
 * The page's larger tile alone, specks opaque, as a data URI for an alpha mask:
 * a drawn book's faces show their grain through it at their own strength.
 */
export function grainMask(strength: GrainStrength = PAPER_GRAIN): string {
  return dataUri(tileSvg(strength.tiles[0], strength.specks, "stroke='black'"));
}
