// @vitest-environment node
/**
 * The CSS half of the phone form-field fixes:
 *  - the iOS no-zoom guard in globals.css covers touch screens of any width
 *    (a landscape iPhone is 812-932px wide), not only narrow windows;
 *  - `pointer-fine:md:` sorts after `md:`, which is why Input/Textarea callers
 *    must use the same prefix to change the desktop size.
 */
import { readFileSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import postcss from "postcss";
import tailwindcss from "tailwindcss";
import config from "../../tailwind.config";

async function compile(classes: string): Promise<string> {
  const result = await postcss([
    tailwindcss({
      ...config,
      content: [{ raw: `<div class="${classes}"></div>`, extension: "html" }],
      corePlugins: { ...(config.corePlugins as object), preflight: false },
    }),
  ]).process("@tailwind utilities;", { from: undefined });
  return result.css;
}

describe("pointer-fine:md: order", () => {
  it("comes after md: in the stylesheet, so it beats a bare md: override", async () => {
    const css = await compile("md:h-8 pointer-fine:md:h-9");
    const bare = css.indexOf(".md\\:h-8");
    const fine = css.indexOf(".pointer-fine\\:md\\:h-9");
    expect(bare).toBeGreaterThan(-1);
    expect(fine).toBeGreaterThan(bare);
    expect(css).toContain("@media (pointer: fine)");
  });
});

describe("iOS no-zoom guard", () => {
  const css = readFileSync(path.join(__dirname, "../../src/app/globals.css"), "utf8").replace(
    /\/\*[\s\S]*?\*\//g,
    ""
  );

  it("forces 16px on fields for coarse pointers as well as narrow windows", () => {
    const guard = css.match(/@media ([^{]+)\{\s*input:not\(\[type="checkbox"\]\)[^{]*\{([^}]*)\}/);
    expect(guard).not.toBeNull();
    const query = guard![1];
    expect(query).toContain("(pointer: coarse)");
    expect(query).toContain("(max-width: 768px)");
    expect(guard![2]).toContain("font-size: max(16px, 1rem) !important");
  });
});
