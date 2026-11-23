// @vitest-environment node
/**
 * The cast figure's stylesheet (components/cast/cast-figure.module.css):
 * scoped for CSS Modules' pure mode, plain (no images by url, no gradients,
 * filters, blends or will-change, never fixed), swaps by visibility, the idle
 * only on an awake figure with motion allowed and paused under a real dialog
 * or an intro, and the high contrast, print and reduced-motion rules.
 */

import { readFileSync } from "node:fs";
import { createRequire } from "node:module";
import path from "node:path";
import postcss, {
  type AtRule,
  type ChildNode,
  type Container,
  type Declaration,
  type Rule,
} from "postcss";
import { describe, expect, it } from "vitest";

import { CLIPS } from "@/lib/cast/clips";
import { EASE, EASE_FALLBACK } from "@/lib/motion/tokens";
import { OPEN_DIALOG_SELECTORS, POPOVER_WRAPPER_SELECTOR } from "@/lib/notify/dialog-open";

const FILE = "src/components/cast/cast-figure.module.css";
const css = readFileSync(path.join(process.cwd(), FILE), "utf8");
const tree = postcss.parse(css);

const NO_MOTION = "(prefers-reduced-motion: no-preference)";
const REDUCE = "(prefers-reduced-motion: reduce)";

function atRulesAround(node: ChildNode): AtRule[] {
  const out: AtRule[] = [];
  let p = node.parent as Container | undefined;
  while (p && p.type !== "root") {
    if (p.type === "atrule") out.push(p as AtRule);
    p = p.parent as Container | undefined;
  }
  return out;
}

const inKeyframes = (node: ChildNode) => atRulesAround(node).some((a) => a.name === "keyframes");
const inMedia = (node: ChildNode, query: string) =>
  atRulesAround(node).some((a) => a.name === "media" && a.params === query);

/** Style rules (not keyframe steps). */
function styleRules(): Rule[] {
  const out: Rule[] = [];
  tree.walkRules((r) => {
    if (!inKeyframes(r)) out.push(r);
  });
  return out;
}

function decls(): Declaration[] {
  const out: Declaration[] = [];
  tree.walkDecls((d) => {
    out.push(d);
  });
  return out;
}

/**
 * The declarations of the style rule that lists `selector`, inside `media`
 * (or at top level): the one with the fewest other selectors, so a shared
 * layout rule doesn't hide the rule of its own.
 */
function ruleFor(selector: string, media?: string): Record<string, string> {
  const rule = styleRules()
    .filter(
      (r) =>
        r.selectors.map((s) => s.replace(/\s+/g, " ")).includes(selector) &&
        (media ? inMedia(r, media) : atRulesAround(r).length === 0)
    )
    .sort((a, b) => a.selectors.length - b.selectors.length)[0];
  expect(rule, `${selector} ${media ?? ""}`).toBeDefined();
  const out: Record<string, string> = {};
  rule!.walkDecls((d) => {
    out[d.prop] = d.important ? `${d.value} !important` : d.value;
  });
  return out;
}

const KEYFRAME_PROPS = new Set([
  "rotate",
  "translate",
  "scale",
  "visibility",
  "animation-timing-function",
]);
const STYLE_PROPS = new Set([
  "position",
  "display",
  "flex",
  "vertical-align",
  "max-height",
  "isolation",
  "contain",
  "pointer-events",
  "touch-action",
  "-webkit-tap-highlight-color",
  "inset",
  "left",
  "top",
  "width",
  "height",
  "z-index",
  "translate",
  "border-radius",
  "background-image",
  "background-repeat",
  "background-color",
  "opacity",
  "visibility",
  "animation",
  "animation-play-state",
]);

describe("cast-figure.module.css", () => {
  it("builds in CSS Modules' pure mode, as Next runs it", async () => {
    const require = createRequire(path.join(process.cwd(), "package.json"));
    const local = require("next/dist/compiled/postcss-modules-local-by-default");
    await expect(
      postcss([local({ mode: "pure" })]).process(css, { from: FILE })
    ).resolves.toBeTruthy();
  });

  it("scopes every selector under .figure", () => {
    for (const rule of styleRules()) {
      for (const sel of rule.selectors) {
        const local = sel.replace(/:global\([^)]*\)/g, "");
        expect(local, sel).toMatch(/\.figure\b/);
        expect(local.replace(/\.figure\b/g, ""), sel).not.toMatch(/\.[a-z]/i);
      }
    }
  });

  it("stays plain: no images by url, gradients, filters, blends, will-change or fixed boxes", () => {
    // An @supports test names an image it never loads.
    const code = css.replace(/\/\*[\s\S]*?\*\//g, "").replace(/@supports[^{]*/g, "");
    expect(code).not.toMatch(/url\(/i);
    expect(code).not.toMatch(/gradient\(/i);
    expect(code).not.toMatch(/#[0-9a-f]{3,8}\b|rgba?\(|hsla?\(/i);
    for (const d of decls()) {
      expect(d.prop, d.toString()).not.toMatch(/filter|blend|will-change/);
      if (d.prop === "position") expect(d.value).not.toMatch(/fixed|sticky/);
    }
  });

  it("uses only the properties it needs, and declares no custom property", () => {
    for (const d of decls()) {
      const allowed = inKeyframes(d) ? KEYFRAME_PROPS : STYLE_PROPS;
      expect(allowed.has(d.prop), `${d.prop} in ${(d.parent as Rule).selector}`).toBe(true);
      expect(d.prop.startsWith("--")).toBe(false);
    }
  });

  it("animates only rotate, translate, scale and visibility in its keyframes", () => {
    let blocks = 0;
    tree.walkAtRules("keyframes", (k) => {
      blocks += 1;
      k.walkDecls((d) => {
        expect([
          "rotate",
          "translate",
          "scale",
          "visibility",
          "animation-timing-function",
        ]).toContain(d.prop);
      });
    });
    expect(blocks).toBeGreaterThan(0);
  });

  it("uses linear() only as the settle or pop spring, after its fallback", () => {
    const springs = new Map<string, string>([
      [EASE.settle, EASE_FALLBACK.settle],
      [EASE.pop, EASE_FALLBACK.pop],
    ]);
    for (const d of decls()) {
      if (!d.value.includes("linear(")) continue;
      expect(springs.has(d.value), d.toString()).toBe(true);
      const before = d.prev();
      expect(
        before?.type === "decl" && before.prop === d.prop && before.value === springs.get(d.value)
      ).toBe(true);
    }
  });

  it("swaps by visibility alone: one choice per slot shows, the one with data-on", () => {
    expect(ruleFor(".figure [data-choice]")).toEqual({ visibility: "hidden" });
    expect(ruleFor(".figure [data-choice][data-on]")).toEqual({ visibility: "visible" });
  });

  it("paints the atlas from the root's properties, 2x where image-set() works, deferred until near", () => {
    expect(ruleFor(".figure [data-sprite]")["background-image"]).toBe("var(--cast-x1)");
    const upgrades: [string, string][] = [];
    tree.walkAtRules("supports", (s) => {
      s.walkDecls("background-image", (d) => {
        upgrades.push([s.params, d.value]);
      });
    });
    // The prefixed form first (Safari 14-16), so the standard one wins where both work.
    expect(upgrades).toEqual([
      [
        "(background-image: -webkit-image-set(url(x.webp) 1x))",
        "-webkit-image-set(var(--cast-x1) 1x, var(--cast-x2) 2x)",
      ],
      [
        '(background-image: image-set("x.webp" 1x))',
        "image-set(var(--cast-x1) 1x, var(--cast-x2) 2x)",
      ],
    ]);
    expect(ruleFor(".figure[data-defer]:not([data-near]) [data-sprite]")).toEqual({
      "background-image": "none",
    });
  });

  it("idles only on an awake figure, only with motion allowed, in step with the clips", () => {
    for (const d of decls()) {
      if (d.prop !== "animation" || d.value === "none") continue;
      expect(inMedia(d, NO_MOTION), d.toString()).toBe(true);
      for (const sel of (d.parent as Rule).selectors)
        expect(sel).toMatch(/^\.figure\[data-cast-awake\] /);
    }
    tree.walkAtRules("keyframes", (k) => {
      expect(inMedia(k, NO_MOTION), k.params).toBe(true);
    });

    const breathe = ruleFor('.figure[data-cast-awake] [data-socket="body"]', NO_MOTION).animation;
    expect(breathe).toBe(`cast-breathe ${CLIPS["idle.breathe"].ms / 1000}s ease-in-out infinite`);
    const peak = CLIPS["idle.breathe"].tracks[0].keys.find((k) => k.t === 0.5)!;
    expect(css).toMatch(new RegExp(`50% \\{\\s*scale: 1 ${peak.sy};`));

    const blink = Object.entries(
      ruleFor(
        '.figure[data-cast-awake] [data-slot="eyes"]:has(> [data-rest][data-on]) > [data-choice="closed"]',
        NO_MOTION
      )
    );
    expect(blink).toEqual([
      ["animation", `cast-blink ${CLIPS["idle.blink"].ms / 1000}s step-end infinite`],
    ]);
    const lids = CLIPS["idle.blink"].swaps![0];
    expect(lids.key).toBe("eyes.closed");
    const shown = Math.round(lids.from * 10000) / 100;
    expect(css).toMatch(new RegExp(`${shown}%,\\s*100% \\{\\s*visibility: visible;`));
    // 0.1 s of lids in every cycle.
    expect(Math.round((1 - lids.from) * CLIPS["idle.blink"].ms)).toBe(100);
  });

  it("pauses the idle under the dialogs life counts, never the intro overlay, and while an intro plays", () => {
    const rule = styleRules().find((r) => r.toString().includes("animation-play-state"))!;
    expect(rule).toBeDefined();
    const sels = rule.selectors.map((s) =>
      s.replace(/\s+/g, " ").replace(/\( /g, "(").replace(/ \)/g, ")")
    );
    expect(sels).toContain(":global(html[data-intro]) .figure[data-cast-awake] *");
    const dialog = sels.find((s) => s.startsWith(":global(body):has("))!;
    expect(dialog).toMatch(/\) \.figure\[data-cast-awake\] \*$/);
    const inner = dialog.slice(dialog.indexOf(":has(") + 5, dialog.lastIndexOf(") .figure"));
    const alternatives = inner.split(",").map((s) => s.trim());
    // lib/notify/dialog-open.ts's selectors, one each, as life reads them.
    expect(alternatives).toHaveLength(OPEN_DIALOG_SELECTORS.length);
    for (const selector of OPEN_DIALOG_SELECTORS) {
      const alt = alternatives.find((a) => a === selector || a.startsWith(`${selector}:not(`));
      expect(alt, selector).toBeDefined();
      // The overlay is a div with role="dialog" aria-modal="true" (intro-parts.tsx).
      if (selector.startsWith("[")) expect(alt, alt).toContain(":not([data-intro-overlay])");
    }
    // A Radix Popover renders role="dialog" data-state="open" in its wrapper: not a modal.
    expect(alternatives.find((a) => a.startsWith('[role="dialog"][data-state="open"]'))).toContain(
      `:not(${POPOVER_WRAPPER_SELECTOR} *)`
    );
    expect(rule.nodes.map((n) => n.toString())).toEqual(["animation-play-state: paused"]);
  });

  it("shows the rest pose under reduced motion", () => {
    expect(ruleFor(".figure", REDUCE)).toEqual({ animation: "none !important" });
    expect(ruleFor(".figure *", REDUCE)).toEqual({ animation: "none !important" });
  });

  it("drops the drawn extras in high contrast, on both of master's selectors", () => {
    for (const sel of [
      ":global(.hc) .figure [data-look]",
      ':global([data-theme="hc"]) .figure [data-look]',
    ]) {
      expect(ruleFor(sel)).toEqual({ display: "none !important" });
    }
  });

  it("leaves the figures out of print", () => {
    expect(ruleFor(".figure", "print")).toEqual({ display: "none !important" });
  });

  it("stays small", () => {
    expect(Buffer.byteLength(css)).toBeLessThan(12 * 1024);
  });
});
