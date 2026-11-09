/**
 * The ink graphics' CSS contract (globals.css, "INK GRAPHICS"; DNA-SPEC §9):
 * colours come from tokens, high contrast is plain line art, the line boil only
 * runs under a mouse hover, and reduced motion shows every drawing finished and
 * still. The global reduced-motion rule only shortens animations, which would
 * leave delayed strokes hidden for a moment and the boil and scribble ticking.
 */
import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import path from "node:path";
import postcss from "postcss";
import tailwindcss from "tailwindcss";
import config from "../../tailwind.config";
import { INK_TONES } from "@/lib/ink/types";

const css = readFileSync(path.join(process.cwd(), "src/app/globals.css"), "utf8");
const start = css.indexOf("INK GRAPHICS");
const end = css.indexOf("COMIC INTROS", start);
const block = css.slice(start, end);

/** The body of the first `@media <query> {…}` inside the ink block. */
function media(query: string): string {
  const at = block.indexOf(`@media ${query}`);
  expect(at, query).toBeGreaterThan(-1);
  let depth = 0;
  let i = block.indexOf("{", at);
  const open = i;
  for (; i < block.length; i++) {
    if (block[i] === "{") depth++;
    if (block[i] === "}" && --depth === 0) break;
  }
  return block.slice(open + 1, i);
}

describe("ink graphics CSS", () => {
  it("has a stroke and a fill class for every tone, each a custom property", () => {
    for (const tone of INK_TONES) {
      expect(block).toMatch(new RegExp(`\\.ink-tone-${tone}\\s*\\{\\s*stroke:\\s*var\\(--`));
      expect(block).toMatch(new RegExp(`\\.ink-fill-${tone}\\s*\\{\\s*fill:\\s*var\\(--`));
    }
  });

  it("uses no hard-coded colours", () => {
    expect(block).not.toMatch(/#[0-9a-f]{3,8}\b/i);
    expect(block).not.toMatch(/rgba?\(/);
  });

  it("shows the finished drawing, still, under reduced motion", () => {
    const rm = media("(prefers-reduced-motion: reduce)");
    for (const sel of [
      ".ink-line",
      ".ink-fill",
      ".ink-wash",
      ".ink-boil",
      ".ink-scribble .ink-line",
    ]) {
      expect(rm).toContain(sel);
    }
    expect(rm).toMatch(/animation:\s*none\s*!important/);
    expect(rm).toMatch(/\.ink-boil\s*\{\s*filter:\s*none\s*!important/);
  });

  it("boils only while a mouse hovers the host", () => {
    const hover = media("(hover: hover) and (pointer: fine)");
    expect(hover).toMatch(/\.ink-host:hover \.ink-boil\s*\{\s*animation:\s*ink-boil/);
    expect(block.replace(hover, "")).not.toMatch(/animation:\s*ink-boil/);
  });

  it("keeps high contrast plain: no washes or colour fills, ink in the text colour, no boil", () => {
    // Paper fills stay (the card colour), so a shape in front still hides
    // the lines behind it.
    expect(block).toMatch(
      /\.hc \.ink-wash-group,\s*\.hc \.ink-fill:not\(\.ink-fill-paper\)\s*\{\s*display:\s*none/
    );
    expect(block).toMatch(
      /\.hc \.ink-art \.ink-line:not\(\.ink-hl-pen\)\s*\{\s*stroke:\s*var\(--text\)/
    );
    expect(block).toMatch(/\.hc \.ink-boil\s*\{\s*animation:\s*none !important/);
  });

  it("never prints decorative ink", () => {
    expect(media("print")).toMatch(/\.ink-art\s*\{\s*display:\s*none/);
  });

  it("keeps the art click-through, so it never covers a control or Amr's hit test", () => {
    expect(block).toMatch(/\.ink-art\s*\{[^}]*pointer-events:\s*none/);
  });

  it("survives Tailwind's purge: the tone classes built from data are safelisted", async () => {
    // InkArt writes `ink-fill-${tone}`, which the content scan never sees; a
    // purged fill falls back to SVG's default black.
    const layer = css.slice(css.indexOf("@layer components", start), css.lastIndexOf("/*", end));
    const result = await postcss([
      tailwindcss({
        ...config,
        content: [{ raw: "<div></div>", extension: "html" }],
        corePlugins: { ...(config.corePlugins as object), preflight: false },
      }),
    ]).process(`@tailwind components;\n${layer}`, { from: undefined });
    for (const tone of INK_TONES) {
      expect(result.css).toContain(`.ink-tone-${tone}`);
      expect(result.css).toContain(`.ink-fill-${tone}`);
    }
  });
});
