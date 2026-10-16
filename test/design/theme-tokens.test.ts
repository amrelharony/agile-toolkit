// @vitest-environment node
/**
 * Compiles a handful of utilities against the real tailwind.config.ts and
 * pins the colour-token behaviour that the UI depends on:
 *  - opacity modifiers on CSS-variable colours emit CSS (they used to emit
 *    nothing, which left 700+ tints, hovers and focus rings unstyled);
 *  - unmodified token classes still emit a plain `var(--x)`;
 *  - `text-glow` is the text-shadow helper from globals.css, not a colour.
 */
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

describe("theme colour tokens", () => {
  it("emits CSS for opacity modifiers on variable-backed colours", async () => {
    const css = await compile("bg-accent/10 text-sub/60 border-accent/40 ring-accent/50");
    expect(rule(css, ".bg-accent\\/10")).toContain(
      "color-mix(in srgb, var(--accent) 10%, transparent)"
    );
    expect(rule(css, ".text-sub\\/60")).toContain(
      "color-mix(in srgb, var(--sub) 60%, transparent)"
    );
    expect(rule(css, ".border-accent\\/40")).toContain("var(--accent) 40%");
    expect(css).toContain("var(--accent) 50%");
  });

  it("keeps unmodified token classes as a plain variable", async () => {
    const css = await compile("bg-accent text-sub border-border");
    expect(rule(css, ".bg-accent")).toContain("background-color: var(--accent)");
    expect(rule(css, ".text-sub")).toContain("color: var(--sub)");
    expect(rule(css, ".border-border")).toContain("border-color: var(--border)");
  });

  it("supports arbitrary opacity values", async () => {
    const css = await compile("bg-surface/[.35]");
    expect(css).toContain("var(--surface) 35%");
  });

  it("does not generate a text colour for text-glow", async () => {
    const css = await compile("text-glow");
    expect(rule(css, ".text-glow")).toBe("");
  });

  it("exposes the glow colours under non-colliding names", async () => {
    const css = await compile("via-glow-color");
    expect(css).toContain("var(--glow)");
  });
});
