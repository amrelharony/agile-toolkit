// @vitest-environment node
/**
 * The CSS half of the phone form-field fixes:
 *  - `min-h-screen-dvh` writes 100vh and then 100dvh, so a centred card sits
 *    in the visible area under mobile browser bars and old iOS still gets a
 *    full-height minimum;
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

function rule(css: string, selector: string): string {
  const escaped = selector.replace(/[.*+?^${}()|[\]\\/]/g, "\\$&");
  const match = css.match(new RegExp(`${escaped}\\s*\\{([^}]*)\\}`));
  return match ? match[1] : "";
}

describe("min-h-screen-dvh", () => {
  it("writes a 100vh fallback and then 100dvh", async () => {
    const body = rule(await compile("min-h-screen-dvh"), ".min-h-screen-dvh");
    const decls = body
      .split(";")
      .map((d) => d.trim())
      .filter(Boolean);
    expect(decls).toEqual(["min-height: 100vh", "min-height: 100dvh"]);
  });

  it("works with variants", async () => {
    const css = await compile("md:min-h-screen-dvh");
    expect(css).toMatch(/@media \(min-width: 768px\)\s*\{\s*\.md\\:min-h-screen-dvh\s*\{/);
  });
});

describe("pointer-fine:md: order", () => {
  it("comes after md: in the stylesheet, so it beats a bare md: override", async () => {
    const css = await compile("md:h-8 pointer-fine:md:h-9");
    const bare = css.indexOf(".md\\:h-8");
    const fine = css.indexOf(".pointer-fine\\:md\\:h-9");
    expect(bare).toBeGreaterThan(-1);
    expect(fine).toBeGreaterThan(bare);
    expect(css).toContain("@media (pointer: fine)");
  });

  it("comes after sm:, so a caller's h-8 sm:h-7 stays 36px for a mouse at md+, as with md:h-9", async () => {
    const css = await compile("h-8 sm:h-7 pointer-fine:md:h-9");
    const sm = css.indexOf(".sm\\:h-7");
    const fine = css.indexOf(".pointer-fine\\:md\\:h-9");
    expect(sm).toBeGreaterThan(-1);
    expect(fine).toBeGreaterThan(sm);
  });
});

describe("pointer-coarse:min-h-11", () => {
  it("is a 44px min-height for touch screens only", async () => {
    const css = await compile("pointer-coarse:min-h-11");
    expect(css).toMatch(
      /@media \(pointer: coarse\)\s*\{\s*\.pointer-coarse\\:min-h-11\s*\{\s*min-height: 2\.75rem/
    );
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
