// @vitest-environment node
/**
 * The page cross-fade in globals.css: a page change (html[data-vt="page"])
 * fades the root pictures in DUR.page. Read from the source with postcss;
 * the build keeping the VIEW TRANSITIONS block is F2's check-built-css marker.
 */
import { readFileSync } from "node:fs";
import path from "node:path";
import postcss, { type AtRule, type ChildNode, type Container, type Rule } from "postcss";
import { describe, expect, it } from "vitest";
import { DUR } from "@/lib/motion/tokens";

const ROOT = path.resolve(__dirname, "../..");
const tree = postcss.parse(readFileSync(path.join(ROOT, "src/app/globals.css"), "utf8"));

const PICTURES = ["group", "old", "new"].map(
  (p) => `html[data-vt="page"]::view-transition-${p}(root)`
);

function rules(): Rule[] {
  const out: Rule[] = [];
  tree.walkRules((r) => {
    out.push(r);
  });
  return out;
}

/** Inside @supports (view-transition-name: none), and then @media screen within it. */
function inScreenBlock(node: ChildNode): boolean {
  const around: AtRule[] = [];
  let p = node.parent as Container | undefined;
  while (p && p.type !== "root") {
    if (p.type === "atrule") around.push(p as AtRule);
    p = p.parent as Container | undefined;
  }
  const supports = around.findIndex(
    (a) => a.name === "supports" && a.params === "(view-transition-name: none)"
  );
  const screen = around.findIndex((a) => a.name === "media" && a.params === "screen");
  return supports >= 0 && screen >= 0 && screen < supports;
}

describe("the page cross-fade", () => {
  it.each(PICTURES)("%s lasts DUR.page, in the screen block", (selector) => {
    const found = rules().filter((r) => r.selectors.includes(selector));
    expect(found).toHaveLength(1);
    const [rule] = found;
    expect(inScreenBlock(rule)).toBe(true);
    const decls: Record<string, string> = {};
    rule.walkDecls((d) => {
      decls[d.prop] = d.value;
    });
    // The longhand only: the shorthand would also reset the browser's own fade.
    expect(decls).toEqual({ "animation-duration": `${DUR.page}ms` });
  });

  it("leaves the root pictures of every other kind alone", () => {
    const rootPseudo = /::view-transition-(group|image-pair|old|new)\(root\)/;
    const touched = rules()
      .flatMap((r) => r.selectors)
      .filter((s) => rootPseudo.test(s));
    expect(touched.length).toBeGreaterThan(0);
    for (const s of touched) expect(s, s).toMatch(/^html\[data-vt="[a-z-]+"\]::/);
  });
});
