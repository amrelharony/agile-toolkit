// @vitest-environment node
/**
 * The card frame in globals.css's VIEW TRANSITIONS block: a tapped card's
 * frame grows into the new page's header panel (lib/motion/page-transition.ts
 * moves the data-vt-active mark from the card to the header). Read from the
 * source with postcss. The name sits on whatever carries the mark, and only
 * there; the layer draws the .panel look only for a card that lands on a
 * header (data-vt-frame="pair"); the timing is set with longhands, so the
 * browser's own keyframes that move and stretch the frame stay; and a card
 * with no header to land on fades out on its own (:only-child).
 */
import { readFileSync } from "node:fs";
import path from "node:path";
import postcss, { type AtRule, type ChildNode, type Container, type Rule } from "postcss";
import { describe, expect, it } from "vitest";
import { DUR, EASE } from "@/lib/motion/tokens";

const ROOT = path.resolve(__dirname, "../..");
const css = readFileSync(path.join(ROOT, "src/app/globals.css"), "utf8");
const tree = postcss.parse(css);

const PAIR = 'html[data-vt-frame="pair"]';
const GROUP = "::view-transition-group(tool-frame)";
const OLD = "::view-transition-old(tool-frame)";
const NEW = "::view-transition-new(tool-frame)";
const EXIT = "::view-transition-old(tool-frame):only-child";

/** The .panel look, as the layer draws it. */
const FRAME_LOOK: Record<string, string> = {
  "box-sizing": "border-box",
  border: "var(--panel-w) solid var(--border)",
  "border-radius": "var(--panel-radius)",
  "background-color": "var(--card)",
  "box-shadow": "var(--shadow-3)",
  overflow: "clip",
};

function rules(): Rule[] {
  const out: Rule[] = [];
  tree.walkRules((r) => {
    // Keyframe steps (40%, from, to) are rules to postcss; they are not selectors.
    if (r.parent?.type === "atrule" && (r.parent as AtRule).name === "keyframes") return;
    out.push(r);
  });
  return out;
}

function atRulesAround(node: ChildNode): AtRule[] {
  const out: AtRule[] = [];
  let p = node.parent as Container | undefined;
  while (p && p.type !== "root") {
    if (p.type === "atrule") out.push(p as AtRule);
    p = p.parent as Container | undefined;
  }
  return out;
}

/** Inside @supports (view-transition-name: none), and then @media screen within it. */
function inScreenBlock(node: ChildNode): boolean {
  const around = atRulesAround(node);
  const supports = around.findIndex(
    (a) => a.name === "supports" && a.params === "(view-transition-name: none)"
  );
  const screen = around.findIndex((a) => a.name === "media" && a.params === "screen");
  return supports >= 0 && screen >= 0 && screen < supports;
}

/** Rules (outside keyframes) that list exactly `selector` among theirs. */
function rulesFor(selector: string): Rule[] {
  return rules().filter((r) => r.selectors.includes(selector));
}

/** Every declaration the rules listing `selector` give, all in the screen block. */
function declsFor(selector: string): Record<string, string> {
  const found = rulesFor(selector);
  expect(found.length, `${selector} has rules`).toBeGreaterThan(0);
  const out: Record<string, string> = {};
  for (const r of found) {
    expect(inScreenBlock(r), `${selector} sits in the screen block`).toBe(true);
    r.walkDecls((d) => {
      out[d.prop] = d.value;
    });
  }
  return out;
}

/** A @keyframes block by name: its steps as { "40%": { opacity: "0" } }, and the block. */
function keyframes(name: string): { block: AtRule; steps: Record<string, Record<string, string>> } {
  const found: AtRule[] = [];
  tree.walkAtRules("keyframes", (a) => {
    if (a.params === name) found.push(a);
  });
  expect(found, `@keyframes ${name}`).toHaveLength(1);
  const steps: Record<string, Record<string, string>> = {};
  found[0].walkRules((r) => {
    for (const step of r.selectors) {
      const decls: Record<string, string> = (steps[step] ??= {});
      r.walkDecls((d) => {
        decls[d.prop] = d.value;
      });
    }
  });
  return { block: found[0], steps };
}

/** The tool-frame pseudo-element selectors in the sheet, and the rules they sit in. */
const frameRules = () => rules().filter((r) => r.selectors.some((s) => /\(tool-frame\)/.test(s)));

describe("the card frame's name", () => {
  it("is given only through html[data-vt-frame] [data-vt-active], in the screen block", () => {
    const naming: Rule[] = [];
    tree.walkDecls("view-transition-name", (d) => {
      if (d.value === "tool-frame") naming.push(d.parent as Rule);
    });
    expect(naming).toHaveLength(1);
    expect(naming[0].selectors).toEqual(["html[data-vt-frame] [data-vt-active]"]);
    expect(inScreenBlock(naming[0])).toBe(true);
    // Nothing else in the rule: the mark names the element and nothing more.
    const decls: string[] = [];
    naming[0].walkDecls((d) => {
      decls.push(d.prop);
    });
    expect(decls).toEqual(["view-transition-name"]);
  });
});

describe("the frame's group", () => {
  it("sits at z-index 1: over the page, under the top bar (2) and Amr and the timer (3)", () => {
    expect(declsFor(GROUP)["z-index"]).toBe("1");
    expect(declsFor("::view-transition-group(header)")["z-index"]).toBe("2");
  });

  it("moves for DUR.travel on the glide easing, set as longhands", () => {
    expect(DUR.travel).toBe(360);
    expect(declsFor(GROUP)).toMatchObject({
      "animation-duration": `${DUR.travel}ms`,
      "animation-timing-function": EASE.glide,
    });
  });

  it("never uses the animation shorthand, which would reset the browser's own move and stretch", () => {
    for (const r of frameRules()) {
      r.walkDecls((d) => {
        expect(d.prop, `${r.selector} { ${d.prop} }`).not.toBe("animation");
      });
    }
  });

  it("draws the .panel look only for a card landing on a header (pair)", () => {
    expect(declsFor(`${PAIR}${GROUP}`)).toMatchObject(FRAME_LOOK);
    // The look's properties appear on no tool-frame selector without the pair attribute.
    for (const r of frameRules()) {
      r.walkDecls((d) => {
        if (!(d.prop in FRAME_LOOK)) return;
        for (const s of r.selectors)
          expect(s, `${s} { ${d.prop} }`).toMatch(/^html\[data-vt-frame="pair"\]::/);
      });
    }
  });

  it("matches the .panel rule the cards and headers use", () => {
    const panel = rules().filter((r) => r.selectors.includes(".panel"));
    expect(panel).toHaveLength(1);
    const decls: Record<string, string> = {};
    panel[0].walkDecls((d) => {
      decls[d.prop] = d.value;
    });
    expect(decls).toEqual({
      "background-color": FRAME_LOOK["background-color"],
      border: FRAME_LOOK.border,
      "border-radius": FRAME_LOOK["border-radius"],
      "box-shadow": FRAME_LOOK["box-shadow"],
    });
  });

  it("has no offset shadow in high contrast: the token it draws is transparent there", () => {
    const hc = rules().find((r) => r.selectors.includes(".hc"));
    expect(hc).toBeDefined();
    let shadow = "";
    hc!.walkDecls("--shadow-3", (d) => {
      shadow = d.value;
    });
    expect(shadow).toMatch(/transparent/);
  });
});

describe("the frame's two pictures", () => {
  it.each([OLD, NEW])("%s keeps its natural size, pinned to the frame's inner corner", (pic) => {
    expect(declsFor(`${PAIR}${pic}`)).toMatchObject({
      width: "auto",
      height: "auto",
      top: "calc(var(--panel-w) * -1)",
      left: "calc(var(--panel-w) * -1)",
      "mix-blend-mode": "normal",
      "animation-duration": `${DUR.travel}ms`,
      "animation-timing-function": "linear",
      "animation-fill-mode": "both",
    });
  });

  it("fades the card's words out over the first 40% of the move", () => {
    const name = declsFor(`${PAIR}${OLD}`)["animation-name"];
    const { block, steps } = keyframes(name);
    expect(inScreenBlock(block)).toBe(true);
    expect(steps).toEqual({ "40%": { opacity: "0" }, "100%": { opacity: "0" } });
  });

  it("brings the header's words in between 15% and 60%", () => {
    const name = declsFor(`${PAIR}${NEW}`)["animation-name"];
    const { block, steps } = keyframes(name);
    expect(inScreenBlock(block)).toBe(true);
    expect(steps).toEqual({
      "0%": { opacity: "0" },
      "15%": { opacity: "0" },
      "60%": { opacity: "1" },
      "100%": { opacity: "1" },
    });
  });
});

describe("a card with no header to land on", () => {
  it("fades out alone in 120ms (:only-child: no new picture)", () => {
    const decls = declsFor(EXIT);
    expect(decls).toMatchObject({
      "animation-duration": "120ms",
      "animation-fill-mode": "both",
    });
    const { block, steps } = keyframes(decls["animation-name"]);
    expect(inScreenBlock(block)).toBe(true);
    expect(steps).toEqual({ to: { opacity: "0" } });
  });
});

describe("the VIEW TRANSITIONS block", () => {
  const banner = /^ {3}VIEW TRANSITIONS\b/m.exec(css)!.index;
  const mobile = /^ {3}MOBILE FOUNDATION\b/m.exec(css)!.index;
  const block = css.slice(banner, mobile);

  it("never blends with plus-lighter", () => {
    expect(block).not.toContain("plus-lighter");
  });

  it("keeps every tool-frame rule and keyframe inside @supports and then @media screen", () => {
    expect(frameRules().length).toBeGreaterThan(0);
    for (const r of frameRules()) expect(inScreenBlock(r), r.selector).toBe(true);
    tree.walkAtRules("keyframes", (a) => {
      if (a.params.startsWith("tool-frame")) expect(inScreenBlock(a), a.params).toBe(true);
    });
  });

  it("times the page at DUR.page and the frame at DUR.travel", () => {
    expect(DUR.page).toBe(240);
    expect(declsFor('html[data-vt="page"]::view-transition-group(root)')).toMatchObject({
      "animation-duration": "240ms",
    });
    expect(declsFor(GROUP)["animation-duration"]).toBe("360ms");
  });
});
