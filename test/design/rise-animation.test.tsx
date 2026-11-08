/**
 * The tool-page entrance (`motion-safe:animate-rise` on ToolPageWrapper's
 * root) must leave no transform on the wrapper once it ends. A leftover
 * transform, even translateY(0), makes the wrapper the containing block for
 * every `position: fixed` element inside a tool: on a scrolled page the
 * Kanban drag overlay drew a scroll's height off-screen and drops never
 * landed. This compiles the wrapper's real classes against the real
 * tailwind.config.ts and checks what a browser would compute.
 */
import { describe, expect, it } from "vitest";
import postcss from "postcss";
import tailwindcss from "tailwindcss";
import { renderToString } from "react-dom/server";
import config from "../../tailwind.config";
import { ToolPageWrapper } from "@/components/layout/tool-page-wrapper";

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

/** The root element's class list, as the server renders it. */
function wrapperClasses(): string {
  const html = renderToString(
    <ToolPageWrapper title="Kanban Board" description="Visualise work" showInsights={false}>
      <p>Board</p>
    </ToolPageWrapper>
  );
  const match = html.match(/^<div class="([^"]*)"/);
  if (!match) throw new Error(`no root class in ${html.slice(0, 80)}`);
  return match[1];
}

/** Every `@keyframes` block in the CSS, keyed by name. */
function keyframeBlocks(css: string): Map<string, string> {
  const blocks = new Map<string, string>();
  for (
    let start = css.indexOf("@keyframes");
    start >= 0;
    start = css.indexOf("@keyframes", start + 1)
  ) {
    const name = css.slice(start + "@keyframes".length, css.indexOf("{", start)).trim();
    let depth = 0;
    for (let i = css.indexOf("{", start); i < css.length; i++) {
      if (css[i] === "{") depth++;
      if (css[i] === "}" && --depth === 0) {
        blocks.set(name, css.slice(start, i + 1));
        break;
      }
    }
  }
  return blocks;
}

/** The `animation` shorthand on a rule, with its fill mode picked out. */
function animation(css: string): { value: string; fillMode: string } {
  const value = css.match(/animation:\s*([^;}]*rise[^;}]*)/)?.[1].trim() ?? "";
  const fillModes = ["none", "forwards", "backwards", "both"];
  // A fill mode keyword in the shorthand; none of them given means `none`.
  const fillMode = value.split(/\s+/).find((t) => fillModes.includes(t)) ?? "none";
  return { value, fillMode };
}

describe("tool page entrance", () => {
  it("is still the motion-safe rise on the wrapper", () => {
    expect(wrapperClasses().split(/\s+/)).toContain("motion-safe:animate-rise");
  });

  it("fills backwards only, so nothing is held once the entrance ends", async () => {
    const css = await compile(wrapperClasses());
    // Still only when motion is welcome.
    expect(css).toMatch(/@media \(prefers-reduced-motion: no-preference\)/);
    const { value, fillMode } = animation(css);
    expect(value).toMatch(/^rise 0\.35s/);
    expect(fillMode).toBe("backwards");
  });

  it("ends at no transform at all, not an identity one", async () => {
    const frames = keyframeBlocks(await compile("animate-rise")).get("rise") ?? "";
    expect(frames).toMatch(/from\s*\{\s*transform:\s*translateY\(8px\)/);
    expect(frames).toMatch(/to\s*\{\s*transform:\s*none/);
  });

  it("gives the wrapper nothing else that would trap fixed descendants", async () => {
    const css = await compile(wrapperClasses());
    // Keyframes are what the entrance animates, not what it leaves behind.
    let outsideKeyframes = css;
    for (const block of Array.from(keyframeBlocks(css).values())) {
      outsideKeyframes = outsideKeyframes.replace(block, "");
    }
    expect(outsideKeyframes).not.toMatch(
      /(^|[\s;{])(transform|filter|backdrop-filter|perspective|will-change|contain)\s*:/
    );
  });
});
