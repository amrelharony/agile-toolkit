// @vitest-environment node
/**
 * The touch-target classes have to win in the real cascade, not just be in
 * the className: same-specificity rules are settled by their order in the
 * emitted CSS. This builds globals.css with the project's Tailwind config for
 * a handful of classes and checks the order.
 */
import { readFileSync } from "node:fs";
import path from "node:path";
import postcss from "postcss";
import tailwindcss from "tailwindcss";
import loadConfig from "tailwindcss/loadConfig";
import { beforeAll, describe, expect, it } from "vitest";

const ROOT = path.resolve(__dirname, "../..");
const CLASSES = [
  "min-h-[36px]",
  "min-touch",
  "min-touch-coarse",
  "pointer-coarse:min-h-11",
  "md-fine:h-9",
  "md:h-7",
  "h-7",
];

let css = "";

beforeAll(async () => {
  const config = loadConfig(path.join(ROOT, "tailwind.config.ts"));
  const source = readFileSync(path.join(ROOT, "src/app/globals.css"), "utf8");
  const result = await postcss([
    tailwindcss({
      ...config,
      content: [{ raw: `<div class="${CLASSES.join(" ")}"></div>`, extension: "html" }],
    }),
  ]).process(source, { from: undefined });
  // Comments mention the class names; only the rules matter here.
  css = result.css.replace(/\/\*[\s\S]*?\*\//g, "");
}, 60_000);

/** Position of the rule for `selector` (escaped as Tailwind emits it). */
function rule(selector: string): number {
  const at = css.indexOf(`${selector} {`);
  expect(at, `${selector} is emitted`).toBeGreaterThanOrEqual(0);
  return at;
}

describe("touch-target CSS order", () => {
  it("emits min-touch-coarse after Button sm's min-h-[36px], so it wins on touch", () => {
    // Mobile audit #29: in @layer components the utility won and a small
    // Button with min-touch-coarse stayed 36 px tall on phones.
    expect(rule(".min-touch-coarse")).toBeGreaterThan(rule(".min-h-\\[36px\\]"));
    expect(rule(".min-touch")).toBeGreaterThan(rule(".min-h-\\[36px\\]"));
  });

  it("scopes min-touch-coarse to coarse pointers and md-fine to a mouse on md+", () => {
    expect(css).toMatch(
      /@media \(pointer: coarse\) \{\s*\.min-touch-coarse \{\s*min-inline-size: 2\.75rem;/
    );
    expect(css).toMatch(
      /@media \(min-width: 768px\) and \(pointer: fine\) \{\s*\.md-fine\\:h-9 \{\s*height: 2\.25rem;/
    );
    expect(css).toMatch(
      /@media \(pointer: coarse\) \{\s*\.pointer-coarse\\:min-h-11 \{\s*min-height: 2\.75rem;/
    );
  });

  it("sorts the md-fine shrink after plain utilities and before a call site's md: size", () => {
    // Before: a plain `h-7` lost to the base size's shrink, and `md:h-7`
    // replaced it (tailwind-merge). Both still hold with md-fine.
    expect(rule(".md-fine\\:h-9")).toBeGreaterThan(rule(".h-7"));
    expect(rule(".md-fine\\:h-9")).toBeLessThan(rule(".md\\:h-7"));
  });
});
