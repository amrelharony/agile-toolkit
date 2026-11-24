/**
 * The size of one cell of Amr's sprite sheet, and the rows his figure stands in.
 *
 * Kept apart from sprite-poses.ts, which pulls in the scenes and clips, so code
 * that only needs his measurements (amr-geometry.ts, which the static shell's
 * bubble and moment chip will read) doesn't drag the engine onto every page.
 * No imports, on purpose. sprite-poses.ts re-exports all three.
 *
 * The sheet comes from the pack's pet_request.json: 8 columns × 11 rows of
 * 192×208 cells.
 */

export const SHEET = { columns: 8, rows: 11, cellW: 192, cellH: 208 } as const;
/** Rows of the cell Amr's figure stands in (below is empty, above is headroom). */
export const FIGURE_TOP = 25;
export const FIGURE_BOTTOM = 202;
