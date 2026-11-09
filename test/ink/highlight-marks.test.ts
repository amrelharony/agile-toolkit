/**
 * The hand-drawn highlight marks ship as data (lib/ink/highlight-marks.ts), so
 * perfect-freehand never reaches the browser for them. This keeps the data equal
 * to what the generator (lib/ink/highlight.ts) draws from each recipe.
 *
 * After changing a recipe or the generator, rewrite the data with:
 *   UPDATE_INK_MARKS=1 npx vitest run test/ink/highlight-marks.test.ts
 */
import { describe, expect, it } from "vitest";
import { writeFileSync } from "node:fs";
import path from "node:path";
import { highlightShape } from "@/lib/ink/highlight";
import { HIGHLIGHT_MARKS, HIGHLIGHT_RECIPES, type HighlightMark } from "@/lib/ink/highlight-marks";

const names = Object.keys(HIGHLIGHT_RECIPES) as HighlightMark[];
const drawn = (name: HighlightMark) => {
  const r = HIGHLIGHT_RECIPES[name];
  return highlightShape(r.kind, r.seed, r.passes);
};

function source(): string {
  const recipes = names
    .map((n) => {
      const r = HIGHLIGHT_RECIPES[n];
      return `  ${JSON.stringify(n)}: { kind: ${JSON.stringify(r.kind)}, seed: ${r.seed}, passes: ${r.passes} },`;
    })
    .join("\n");
  const marks = names.map((n) => `  ${JSON.stringify(n)}: ${JSON.stringify(drawn(n))},`).join("\n");
  return `import type { HighlightShape } from "./highlight";

/**
 * The hand-drawn marks InkHighlight can put on a phrase, as data. Each is
 * drawn once by lib/ink/highlight.ts (perfect-freehand) from its recipe, so the
 * browser downloads three short paths instead of the pen library.
 *
 * Generated: don't edit HIGHLIGHT_MARKS by hand. Change a recipe, then run
 *   UPDATE_INK_MARKS=1 npx vitest run test/ink/highlight-marks.test.ts
 */
export const HIGHLIGHT_RECIPES = {
${recipes}
} as const;

export type HighlightMark = keyof typeof HIGHLIGHT_RECIPES;

export const HIGHLIGHT_MARKS: Record<HighlightMark, HighlightShape> = {
${marks}
};
`;
}

describe("highlight marks", () => {
  if (process.env.UPDATE_INK_MARKS) {
    it("rewrites the data from the recipes", () => {
      writeFileSync(path.join(process.cwd(), "src/lib/ink/highlight-marks.ts"), source());
    });
    return;
  }

  it.each(names)("stores %s exactly as the generator draws it", (name) => {
    expect(HIGHLIGHT_MARKS[name]).toEqual(drawn(name));
  });

  it("keeps a circle's box apart from an underline's", () => {
    expect(HIGHLIGHT_MARKS.circle.viewBox).toBe("0 0 100 40");
    expect(HIGHLIGHT_MARKS.underline.viewBox).toBe("0 0 100 12");
  });
});
