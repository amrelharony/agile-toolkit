// @vitest-environment node
/**
 * The chat strip's CSS contract (globals.css, PANELS; DNA-SPEC §4 and §6):
 *  - radius tokens in every mode, plain in high contrast;
 *  - a bare .balloon (EmptyState, the VIP intro) looks as it always has;
 *  - a chat balloon (.balloon[data-tail]) has capped corners, never a pill, and
 *    its tail on the edge it names, or toward the real Amr for `amr`;
 *  - the caption voices: narration, you (with its outline) and scene, plus the
 *    error tone;
 *  - forced colours hide the tails, which are drawn from transparent borders;
 *  - the page scrolls smoothly only for readers who haven't asked for less motion.
 * The last block builds globals.css the way Next does (Tailwind, then its
 * minifier) and runs the AMR markers of scripts/check-built-css.mjs on it.
 */
import { readFileSync } from "node:fs";
import { createRequire } from "node:module";
import path from "node:path";
import postcss from "postcss";
import tailwindcss from "tailwindcss";
import loadConfig from "tailwindcss/loadConfig";
import { describe, expect, it } from "vitest";
import { MARKERS, checkMarkers, stripWhitespace } from "../../scripts/check-built-css.mjs";

const ROOT = path.resolve(__dirname, "../..");
const SOURCE = readFileSync(path.join(ROOT, "src/app/globals.css"), "utf8");
const COMMENTS = /\/\*[\s\S]*?\*\//g;
const CSS = SOURCE.replace(COMMENTS, "");

/** A block's custom properties, as theme-contrast.test.ts reads them. */
function tokens(selector: string): Record<string, string> {
  const escaped = selector.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  const match = CSS.match(new RegExp(`${escaped}\\s*\\{([^}]*)\\}`));
  if (!match) throw new Error(`no ${selector} block in globals.css`);
  return Object.fromEntries(
    Array.from(match[1].matchAll(/--([\w-]+):\s*([^;]+);/g), (m) => [m[1], m[2].trim()])
  );
}

const NIGHT = tokens(":root");
const COMIC = tokens('[data-theme="light"]');
const HC = tokens('[data-theme="hc"]');

/** From one section banner to the next named one, comments taken out. */
function section(name: string, next: string): string {
  const banner = SOURCE.lastIndexOf("/*", SOURCE.indexOf(`   ${name}`));
  const end = SOURCE.lastIndexOf("/*", SOURCE.indexOf(`   ${next}`));
  expect(banner, name).toBeGreaterThan(-1);
  expect(end, next).toBeGreaterThan(banner);
  return SOURCE.slice(banner, end).replace(COMMENTS, "");
}

const PANELS = section("PANELS", "MOTION FOUNDATIONS");
const RESET = section("RESET & BASE", "PAPER");

/** The index of the `}` closing the block whose `{` comes first at or after `from`. */
function close(css: string, from: number): number {
  let depth = 0;
  for (let i = css.indexOf("{", from); i < css.length; i++) {
    if (css[i] === "{") depth++;
    if (css[i] === "}" && --depth === 0) return i;
  }
  return -1;
}

type Rule = { selectors: string[]; body: Record<string, string>; at: number };

/** Innermost rules, selectors with their whitespace collapsed. */
function rules(css: string): Rule[] {
  return Array.from(css.matchAll(/([^{};]*)\{([^{}]*)\}/g), (m) => ({
    at: m.index ?? 0,
    selectors: m[1].split(",").map((s) => s.replace(/\s+/g, " ").trim()),
    body: Object.fromEntries(
      m[2]
        .split(";")
        .map((d) => d.trim())
        .filter(Boolean)
        .map((d) => {
          const colon = d.indexOf(":");
          return [d.slice(0, colon).trim(), d.slice(colon + 1).trim()];
        })
    ),
  }));
}

const PANEL_RULES = rules(PANELS);

/** Every rule that names `selector`, in source order. */
function naming(selector: string): Rule[] {
  return PANEL_RULES.filter((r) => r.selectors.includes(selector));
}

/** The declarations the rules naming `selector` give it, later rules winning. */
function style(selector: string): Record<string, string> {
  const found = naming(selector);
  expect(found.length, `a rule for ${selector}`).toBeGreaterThan(0);
  return Object.assign({}, ...found.map((r) => r.body));
}

/**
 * The ink (::before) and paper (::after) triangles of a balloon: the bare
 * balloon's rules, then each variant's in turn (every variant selector is more
 * specific than the bare one).
 */
function triangles(...variants: string[]) {
  const of = (pseudo: "before" | "after") => {
    const out: Record<string, string> = {};
    for (const selector of [".balloon", ...variants]) {
      for (const r of naming(`${selector}::${pseudo}`)) Object.assign(out, r.body);
    }
    return out;
  };
  return { ink: of("before"), paper: of("after") };
}

/** A length in px, with --tail-at and a 16px rem filled in; null for auto. */
function px(value: string | undefined, tailAt = "1rem"): number | null {
  if (value === undefined || value === "auto") return null;
  const text = value.replace(/var\(--tail-at\)/g, tailAt).replace(/^calc\((.*)\)$/, "$1");
  return text
    .split(/\s+(?=[+-]\s)/)
    .map((term) => term.replace(/^\+\s*/, "").replace(/^-\s+/, "-"))
    .reduce((sum, term) => {
      const m = term.match(/^(-?[\d.]+)(rem|px)?$/);
      if (!m) throw new Error(`can't read ${value}`);
      return sum + Number(m[1]) * (m[2] === "rem" ? 16 : 1);
    }, 0);
}

/** Every length in a radius or border-width shorthand, in px. */
function lengths(value: string): number[] {
  return value
    .split(/[\s/]+/)
    .filter(Boolean)
    .map((v) => px(v) ?? NaN);
}

const near = (values: number[]) => values.map((v) => expect.closeTo(v, 5));

/** Today's tail, as master a463a894 drew it: bottom 1rem, the paper 0.1rem higher. */
const TODAY = {
  ink: { bottom: 16, left: -12.8, widths: [6.4, 12.8, 6.4, 0] },
  paper: { bottom: 17.6, left: -9.6, widths: [4.8, 10.4, 4.8, 0] },
};

describe("radius tokens", () => {
  it("keeps the page balloon's corners as they were", () => {
    expect(NIGHT["balloon-radius-page"]).toBe(
      "1.25rem 1.5rem 1.35rem 1.1rem / 1.35rem 1.1rem 1.5rem 1.25rem"
    );
  });

  it("caps every corner of a chat balloon at 12px, inside DNA's 2-12px", () => {
    const corners = lengths(NIGHT["balloon-radius"]);
    expect(corners).toHaveLength(8);
    for (const c of corners) {
      expect(c).toBeGreaterThanOrEqual(2);
      expect(c).toBeLessThanOrEqual(12);
    }
  });

  it("makes a caption all but square, and squarer than a balloon", () => {
    const corners = lengths(NIGHT["caption-radius"]);
    expect(corners.length).toBeGreaterThan(0);
    for (const c of corners) {
      expect(c).toBeGreaterThanOrEqual(2);
      expect(c).toBeLessThanOrEqual(4);
    }
    expect(Math.max(...corners)).toBeLessThan(Math.min(...lengths(NIGHT["balloon-radius"])));
  });

  it("gives Comic the Night shapes, and high contrast plain corners", () => {
    for (const token of ["balloon-radius-page", "balloon-radius", "caption-radius"]) {
      expect(COMIC[token], `Comic leaves --${token} to Night`).toBeUndefined();
    }
    expect(HC["balloon-radius-page"]).toBe("4px");
    expect(HC["balloon-radius"]).toBe("4px");
    expect(HC["caption-radius"]).toBe("2px");
  });
});

describe("the balloon", () => {
  it("keeps a bare balloon on the page radius and caps a chat balloon's", () => {
    expect(style(".balloon")["border-radius"]).toBe("var(--balloon-radius-page)");
    // :where keeps it at one class, so a call site's rounded-* still wins.
    expect(style(".balloon:where([data-tail])")["border-radius"]).toBe("var(--balloon-radius)");
    expect(PANELS).not.toMatch(/\.balloon\[data-tail\]\s*\{/);
  });

  it("paints the balloon from --balloon-fill, the card by default, framed in ink", () => {
    const balloon = style(".balloon");
    expect(balloon["--balloon-fill"]).toBe("var(--card)");
    expect(balloon["background-color"]).toBe("var(--balloon-fill)");
    expect(balloon.border).toBe("var(--panel-w) solid var(--border)");
    expect(balloon["box-shadow"]).toBeUndefined();
  });

  it("declares --tail-at on every balloon, so a panel's own never leaks in", () => {
    expect(style(".balloon")["--tail-at"]).toBe("1rem");
  });

  it("draws the default tail exactly where today's sits", () => {
    const { ink, paper } = triangles();
    const tailAt = style(".balloon")["--tail-at"];
    for (const [got, want] of [
      [ink, TODAY.ink],
      [paper, TODAY.paper],
    ] as const) {
      const margin = px(got["margin-bottom"] ?? "0") ?? 0;
      expect((px(got.bottom, tailAt) ?? NaN) + margin).toBeCloseTo(want.bottom, 5);
      expect(px(got.left)).toBeCloseTo(want.left, 5);
      expect(lengths(got["border-width"])).toEqual(near(want.widths));
      expect(got["border-color"]).toBe("transparent");
    }
    expect(ink["border-right-color"]).toBe("var(--border)");
    expect(paper["border-right-color"]).toBe("var(--balloon-fill)");
    expect(ink.content).toBe('""');
    expect(ink.position).toBe("absolute");
  });

  it("mirrors the tail onto the right edge", () => {
    const { ink, paper } = triangles('.balloon[data-tail="right"]');
    expect(ink.left).toBe("auto");
    expect(px(ink.right)).toBeCloseTo(TODAY.ink.left, 5);
    expect(px(ink.bottom)).toBeCloseTo(TODAY.ink.bottom, 5);
    expect(lengths(ink["border-width"])).toEqual(near([6.4, 0, 6.4, 12.8]));
    expect(ink["border-color"]).toBe("transparent transparent transparent var(--border)");
    expect(paper.left).toBe("auto");
    expect(px(paper.right)).toBeCloseTo(TODAY.paper.left, 5);
    expect(px(paper.bottom)).toBeCloseTo(TODAY.paper.bottom, 5);
    expect(lengths(paper["border-width"])).toEqual(near([4.8, 0, 4.8, 10.4]));
    expect(paper["border-color"]).toBe("transparent transparent transparent var(--balloon-fill)");
  });

  it("counts a side tail from the top when asked", () => {
    const { ink, paper } = triangles('.balloon[data-tail-from="top"]');
    expect(ink.bottom).toBe("auto");
    expect(px(ink.top, "2rem")).toBe(32);
    expect(paper.bottom).toBe("auto");
    expect(px(paper.top, "2rem")).toBeCloseTo(33.6, 5);
  });

  it("puts a down or up tail on its edge, --tail-at from the left or the right", () => {
    const down = triangles('.balloon[data-tail="down"]');
    expect(down.ink.top).toBe("auto");
    expect(px(down.ink.bottom)).toBeCloseTo(-12.8, 5);
    expect(px(down.ink.left, "3rem")).toBe(48);
    expect(down.ink["border-color"]).toBe("var(--border) transparent transparent");
    expect(px(down.paper.bottom)).toBeCloseTo(-9.6, 5);
    expect(px(down.paper.left, "3rem")).toBeCloseTo(49.6, 5);
    expect(down.paper["border-color"]).toBe("var(--balloon-fill) transparent transparent");

    const up = triangles('.balloon[data-tail="up"]');
    expect(up.ink.bottom).toBe("auto");
    expect(px(up.ink.top)).toBeCloseTo(-12.8, 5);
    expect(up.ink["border-color"]).toBe("transparent transparent var(--border)");
    expect(px(up.paper.top)).toBeCloseTo(-9.6, 5);
    expect(up.paper["border-color"]).toBe("transparent transparent var(--balloon-fill)");

    for (const edge of ["down", "up"]) {
      const fromRight = triangles(
        `.balloon[data-tail="${edge}"]`,
        `.balloon[data-tail="${edge}"][data-tail-from="right"]`
      );
      expect(fromRight.ink.left).toBe("auto");
      expect(px(fromRight.ink.right, "3rem")).toBe(48);
      expect(fromRight.paper.left).toBe("auto");
      expect(px(fromRight.paper.right, "3rem")).toBeCloseTo(49.6, 5);
    }
  });

  it("puts the down and up rules after the top count, so they win a mixed balloon", () => {
    const top = naming('.balloon[data-tail-from="top"]::before')[0].at;
    expect(naming('.balloon[data-tail="down"]::before')[0].at).toBeGreaterThan(top);
    expect(naming('.balloon[data-tail="up"]::before')[0].at).toBeGreaterThan(top);
  });

  it("centres the paper on the ink: 0.1rem in along the edge and 0.2rem shorter", () => {
    for (const variant of ['.balloon[data-tail="down"]', '.balloon[data-tail="up"]']) {
      const { ink, paper } = triangles(variant);
      expect((px(paper.left) ?? NaN) - (px(ink.left) ?? NaN)).toBeCloseTo(1.6, 5);
      const [, inkSide] = lengths(ink["border-width"]);
      const [, paperSide] = lengths(paper["border-width"]);
      expect(2 * inkSide - 2 * paperSide).toBeCloseTo(3.2, 5);
    }
  });

  it("draws no tail for none", () => {
    const { ink, paper } = triangles('.balloon[data-tail="none"]');
    expect(ink.content).toBe("none");
    expect(paper.content).toBe("none");
  });

  it("points `amr` at the real Amr through the panel root's side and edge", () => {
    // The alias shares the explicit variants' rules, so it can't drift from them.
    for (const pseudo of ["before", "after"]) {
      expect(naming(`.balloon[data-tail="right"]::${pseudo}`)[0].selectors).toContain(
        `[data-amr-side="right"] .balloon[data-tail="amr"]::${pseudo}`
      );
      expect(naming(`.balloon[data-tail-from="top"]::${pseudo}`)[0].selectors).toContain(
        `[data-amr-edge="top"] .balloon[data-tail="amr"]::${pseudo}`
      );
    }
    // With no root saying otherwise, it is the classic lower-left tail.
    const plain = triangles('.balloon[data-tail="amr"]');
    expect(px(plain.ink.left)).toBeCloseTo(TODAY.ink.left, 5);
    expect(px(plain.ink.bottom)).toBeCloseTo(TODAY.ink.bottom, 5);
    const flipped = triangles(
      '[data-amr-side="right"] .balloon[data-tail="amr"]',
      '[data-amr-edge="top"] .balloon[data-tail="amr"]'
    );
    expect(flipped.ink.left).toBe("auto");
    expect(px(flipped.ink.right)).toBeCloseTo(TODAY.ink.left, 5);
    expect(flipped.ink.bottom).toBe("auto");
    expect(px(flipped.ink.top)).toBe(16);
    expect(flipped.paper.bottom).toBe("auto");
    expect(px(flipped.paper.top)).toBeCloseTo(17.6, 5);
  });
});

describe("captions", () => {
  it("draws narration on the deeper paper with a fine ink line and caption corners", () => {
    const caption = style(".comic-caption");
    expect(caption["background-color"]).toBe("var(--surface-deep)");
    expect(caption.border).toBe("var(--line-w) solid var(--border)");
    expect(caption["border-radius"]).toBe("var(--caption-radius)");
    expect(caption.color).toBe("var(--text)");
  });

  it("outlines the you caption and washes it with --accent2 behind an @supports", () => {
    const you = naming('.comic-caption[data-voice="you"]');
    expect(you).toHaveLength(2);
    const [fallback, wash] = you;
    expect(fallback.body.border).toBe("var(--line-w) solid var(--border)");
    expect(fallback.body["background-color"]).toBe("var(--surface)");
    expect(wash.body["background-color"]).toBe(
      "color-mix(in srgb, var(--accent2) 14%, var(--card))"
    );
    const guard = PANELS.lastIndexOf("@supports", wash.at);
    expect(guard).toBeGreaterThan(fallback.at);
    expect(PANELS.slice(guard, wash.at)).toMatch(
      /^@supports \(background-color: color-mix\(in srgb, red 50%, blue\)\) \{\s*$/
    );
  });

  it("sets a scene apart with no paper, a quiet rule and muted, centred words", () => {
    const scene = style('.comic-caption[data-voice="scene"]');
    expect(scene["background-color"]).toBe("transparent");
    expect(scene["border-color"]).toBe("var(--rule)");
    expect(scene.color).toBe("var(--sub)");
    expect(scene["text-align"]).toBe("center");
  });

  it("marks an error with the danger line", () => {
    expect(style('.comic-caption[data-tone="error"]')["border-color"]).toBe("var(--danger)");
  });
});

describe("the balloon and caption rules", () => {
  const ours = PANEL_RULES.filter((r) =>
    r.selectors.some((s) => s.includes(".balloon") || s.includes(".comic-caption"))
  );
  const COLOUR = /(^|-)colou?r$|^background$|^border(-(top|right|bottom|left))?$/;
  const KEYWORDS = ["transparent", "solid", "color-mix", "in", "srgb"];

  it("take every colour from a token", () => {
    expect(ours.length).toBeGreaterThan(10);
    const raw: string[] = [];
    for (const r of ours) {
      for (const [prop, value] of Object.entries(r.body)) {
        if (/#[0-9a-f]{3,8}\b|rgba?\(|hsla?\(/i.test(value)) raw.push(`${r.selectors[0]} ${prop}`);
        if (!COLOUR.test(prop)) continue;
        const words = value
          .replace(/var\(--[\w-]+\)/g, " ")
          .replace(/-?\d[\w.%]*/g, " ")
          .split(/[\s,/()]+/)
          .filter((w) => w && !KEYWORDS.includes(w));
        if (words.length > 0) raw.push(`${r.selectors[0]} ${prop}: ${value}`);
      }
    }
    expect(raw).toEqual([]);
  });

  it("add no shadow, filter, motion or capitals", () => {
    for (const r of ours) {
      for (const prop of [
        "box-shadow",
        "text-shadow",
        "filter",
        "animation",
        "transition",
        "text-transform",
      ]) {
        expect(r.body[prop], `${r.selectors[0]} ${prop}`).toBeUndefined();
      }
    }
  });
});

describe("forced colours", () => {
  const layer = PANELS.indexOf("@layer components");
  const layerEnd = close(PANELS, layer);
  const guard = PANELS.indexOf("@media (forced-colors: active) {");
  const guardBody = PANELS.slice(guard, close(PANELS, guard) + 1);

  it("hide the tails, outside any layer, right after the PANELS layer", () => {
    expect(PANELS.slice(layer, layerEnd)).toContain(".comic-caption");
    expect(guard).toBeGreaterThan(layerEnd);
    // Nothing between the layer's close and the guard: it opens at the top level,
    // still inside PANELS, so before the MOTION FOUNDATIONS banner.
    expect(PANELS.slice(layerEnd + 1, guard).trim()).toBe("");
    expect(guardBody).toMatch(/\.balloon::before,\s*\.balloon::after\s*\{\s*display:\s*none;\s*\}/);
  });

  it("leave every box its outline: the guard takes no border or caption away", () => {
    expect(guardBody).not.toMatch(/comic-caption|border|outline/);
  });
});

describe("page scrolling", () => {
  it("glides only under prefers-reduced-motion: no-preference, in RESET & BASE", () => {
    expect(CSS.match(/scroll-behavior:\s*smooth/g)).toHaveLength(1);
    const smooth = RESET.indexOf("scroll-behavior: smooth");
    expect(smooth).toBeGreaterThan(RESET.indexOf("@layer base"));
    expect(RESET.slice(0, smooth)).toMatch(
      /@media \(prefers-reduced-motion: no-preference\) \{\s*html \{\s*$/
    );
  });
});

describe("the built CSS", () => {
  // Next builds globals.css with Tailwind (postcss.config.mjs), then minifies it
  // with its own cssnano-simple (next/dist/build/webpack/plugins/css-minimizer-plugin.js).
  const require = createRequire(path.join(ROOT, "package.json"));
  const config = loadConfig(path.join(ROOT, "tailwind.config.ts"));

  async function build(classes: string): Promise<string> {
    process.env.BROWSERSLIST_IGNORE_OLD_DATA = "1";
    const nano = require("next/dist/compiled/cssnano-simple");
    const built = await postcss([
      tailwindcss({
        ...config,
        content: [{ raw: `<div class="${classes}"></div>`, extension: "html" }],
      }),
    ]).process(SOURCE, { from: undefined });
    const min = await postcss([nano({}, postcss)]).process(built.css, { from: undefined });
    return stripWhitespace(min.css);
  }

  const failing = (css: string) =>
    checkMarkers([css], { AMR: MARKERS.AMR })
      .filter((r: { ok: boolean }) => !r.ok)
      .map((r: { name: string }) => r.name);

  it("keeps every AMR marker through Tailwind and the minifier", async () => {
    expect(failing(await build("balloon comic-caption"))).toEqual([]);
  }, 60_000);

  it("keeps the forced-colours guard where no caption is used: it is outside the layer", async () => {
    const css = await build("balloon");
    expect(css).not.toContain(".comic-caption");
    expect(failing(css)).toEqual([MARKERS.AMR[1].name]);
  }, 60_000);
});
