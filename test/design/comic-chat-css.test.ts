// @vitest-environment node
/**
 * The chat strip's CSS contract (globals.css, PANELS; DNA-SPEC §4 and §6):
 *  - radius tokens in every mode, plain in high contrast;
 *  - a bare .balloon (EmptyState, the VIP intro) looks as it always has;
 *  - a chat balloon (.balloon[data-tail]) has capped corners, never a pill, and
 *    its tail on the edge it names, or toward the real Amr for `amr`;
 *  - the caption voices: narration, you (with its outline) and scene, plus the
 *    error tone;
 *  - the chat panel's own tail (.comic-tailed[data-tail]): the balloon's
 *    triangles in the panel's ink and paper, on the edge it names, and none
 *    without a side;
 *  - the name plate (.comic-name-plate): lettered, a 1px hard shadow and a
 *    slight tilt, a token focus outline, a launcher variant, flat in high
 *    contrast;
 *  - forced colours hide the tails, which are drawn from transparent borders,
 *    hold the plate's outline, and give the you caption a heavier start edge,
 *    so it never reads as narration once both fills turn to Canvas;
 *  - the panel's entrance (.panelEnter, mascot-assistant.module.css): opacity
 *    and the scale property from its tail, never transform, and nothing at all
 *    under reduced motion;
 *  - the page scrolls smoothly only for readers who haven't asked for less motion.
 * The last block builds globals.css and the module the way Next does (Tailwind
 * or CSS modules, then its minifier) and runs the AMR markers of
 * scripts/check-built-css.mjs on them.
 */
import { readFileSync } from "node:fs";
import { createRequire } from "node:module";
import path from "node:path";
import postcss from "postcss";
import type { AtRule, Rule as CssRule, Declaration } from "postcss";
import tailwindcss from "tailwindcss";
import loadConfig from "tailwindcss/loadConfig";
import { describe, expect, it } from "vitest";
import { MARKERS, checkMarkers, stripWhitespace } from "../../scripts/check-built-css.mjs";

const ROOT = path.resolve(__dirname, "../..");
const SOURCE = readFileSync(path.join(ROOT, "src/app/globals.css"), "utf8");
const COMMENTS = /\/\*[\s\S]*?\*\//g;
const CSS = SOURCE.replace(COMMENTS, "");
/** Amr's CSS module, which holds his chat panel's entrance. */
const MODULE_SOURCE = readFileSync(
  path.join(ROOT, "src/components/agent/mascot/mascot-assistant.module.css"),
  "utf8"
);

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
    // The third is its forced-colours edge (the "forced colours" block below).
    const you = naming('.comic-caption[data-voice="you"]');
    expect(you).toHaveLength(3);
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

const COLOUR = /(^|-)colou?r$|^background$|^border(-(top|right|bottom|left))?$/;
const KEYWORDS = ["transparent", "solid", "color-mix", "in", "srgb"];

/** Every declaration in `found` that writes a colour other than a token. */
function rawColours(found: Rule[]): string[] {
  const raw: string[] = [];
  for (const r of found) {
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
  return raw;
}

describe("the balloon and caption rules", () => {
  const ours = PANEL_RULES.filter((r) =>
    r.selectors.some((s) => s.includes(".balloon") || s.includes(".comic-caption"))
  );

  it("take every colour from a token", () => {
    expect(ours.length).toBeGreaterThan(10);
    expect(rawColours(ours)).toEqual([]);
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

/**
 * The chat panel's ink (::before) and paper (::after) triangles: the shared
 * rule, then each variant's in turn.
 */
function panelTriangles(...variants: string[]) {
  const of = (pseudo: "before" | "after") => {
    const out: Record<string, string> = {};
    for (const selector of [".comic-tailed", ...variants]) {
      for (const r of naming(`${selector}::${pseudo}`)) Object.assign(out, r.body);
    }
    return out;
  };
  return { ink: of("before"), paper: of("after") };
}

const SIDES = ["down", "up", "left", "right"] as const;

describe("the panel tail", () => {
  it("declares its own --tail-at, on the bare class only, so the panel's `fixed` still wins", () => {
    const tailed = style(".comic-tailed");
    expect(tailed["--tail-at"]).toBe("1rem");
    expect(tailed.position).toBe("relative");
    // A rule on the panel itself with an attribute in it would outrank the
    // panel's position utility; only the pseudo-elements carry attributes.
    const onPanel = PANEL_RULES.filter((r) =>
      r.selectors.some((s) => s.startsWith(".comic-tailed") && !s.includes("::"))
    );
    expect(onPanel.flatMap((r) => r.selectors)).toEqual([".comic-tailed"]);
  });

  it("draws nothing without a side: no data-tail, none, or a value it doesn't know", () => {
    // Only the four side rules give the triangles content.
    const giving = PANEL_RULES.filter(
      (r) => r.body.content === '""' && r.selectors.some((s) => s.startsWith(".comic-tailed"))
    ).flatMap((r) => r.selectors);
    expect(giving.sort()).toEqual(
      SIDES.flatMap((side) =>
        ["after", "before"].map((p) => `.comic-tailed[data-tail="${side}"]::${p}`)
      ).sort()
    );
    const bare = panelTriangles();
    expect(bare.ink.content).toBeUndefined();
    expect(bare.paper.content).toBeUndefined();
    const none = panelTriangles('.comic-tailed[data-tail="none"]');
    expect(none.ink.content).toBe("none");
    expect(none.paper.content).toBe("none");
  });

  it("puts each side's tail on its edge, ink in the panel's line and paper in its card", () => {
    const want = {
      down: {
        edge: "bottom",
        along: "left",
        ink: "var(--border) transparent transparent",
        paper: "var(--card) transparent transparent",
      },
      up: {
        edge: "top",
        along: "left",
        ink: "transparent transparent var(--border)",
        paper: "transparent transparent var(--card)",
      },
      left: {
        edge: "left",
        along: "bottom",
        ink: "transparent var(--border) transparent transparent",
        paper: "transparent var(--card) transparent transparent",
      },
      right: {
        edge: "right",
        along: "bottom",
        ink: "transparent transparent transparent var(--border)",
        paper: "transparent transparent transparent var(--card)",
      },
    } as const;
    for (const side of SIDES) {
      const { ink, paper } = panelTriangles(`.comic-tailed[data-tail="${side}"]`);
      const w = want[side];
      expect(ink.content, side).toBe('""');
      expect(paper.content, side).toBe('""');
      expect(ink.position).toBe("absolute");
      expect(ink["pointer-events"]).toBe("none");
      // Past the edge it names: ink 0.8rem, paper 0.6rem, so a line shows round it.
      expect(px(ink[w.edge]), `${side} ink`).toBeCloseTo(-12.8, 5);
      expect(px(paper[w.edge]), `${side} paper`).toBeCloseTo(-9.6, 5);
      // Along it at --tail-at, the paper 0.1rem further in.
      expect(px(ink[w.along], "3rem"), `${side} ink`).toBe(48);
      expect(px(paper[w.along], "3rem"), `${side} paper`).toBeCloseTo(49.6, 5);
      expect(ink["border-color"], `${side} ink`).toBe(w.ink);
      expect(paper["border-color"], `${side} paper`).toBe(w.paper);
    }
  });

  it("draws the balloon's own triangles, so the panel and the balloons in it share one tail", () => {
    for (const side of SIDES) {
      const panel = panelTriangles(`.comic-tailed[data-tail="${side}"]`);
      // A bare balloon's tail is the left one.
      const balloon = side === "left" ? triangles() : triangles(`.balloon[data-tail="${side}"]`);
      for (const part of ["ink", "paper"] as const) {
        expect(lengths(panel[part]["border-width"]), `${side} ${part}`).toEqual(
          near(lengths(balloon[part]["border-width"]))
        );
      }
    }
    // 0.8rem wide, as amr-geometry's panelTail counts on: the panel sets
    // --tail-at half of that short of Amr's centre line.
    const [, half] = lengths(panelTriangles('.comic-tailed[data-tail="down"]').ink["border-width"]);
    expect(2 * half).toBeCloseTo(12.8, 5);
  });

  it("counts --tail-at from the right for an up or down tail, and from the top for a side one", () => {
    for (const side of ["down", "up"]) {
      const { ink, paper } = panelTriangles(
        `.comic-tailed[data-tail="${side}"]`,
        `.comic-tailed[data-tail="${side}"][data-tail-from="right"]`
      );
      expect(ink.left, side).toBe("auto");
      expect(px(ink.right, "3rem"), side).toBe(48);
      expect(paper.left, side).toBe("auto");
      expect(px(paper.right, "3rem"), side).toBeCloseTo(49.6, 5);
    }
    for (const side of ["left", "right"]) {
      const { ink, paper } = panelTriangles(
        `.comic-tailed[data-tail="${side}"]`,
        `.comic-tailed[data-tail="${side}"][data-tail-from="top"]`
      );
      expect(ink.bottom, side).toBe("auto");
      expect(px(ink.top, "3rem"), side).toBe(48);
      expect(paper.bottom, side).toBe("auto");
      expect(px(paper.top, "3rem"), side).toBeCloseTo(49.6, 5);
    }
  });
});

describe("the name plate", () => {
  it("letters the plate on the card in a fine ink outline, with a 1px hard shadow and a slight tilt", () => {
    const plate = style(".comic-name-plate");
    expect(plate["font-family"]).toBe('theme("fontFamily.display")');
    expect(plate["background-color"]).toBe("var(--card)");
    expect(plate.color).toBe("var(--text)");
    expect(plate["--plate-line"]).toBe("var(--line-w)");
    expect(plate.border).toBe("var(--plate-line) solid var(--border)");
    expect(plate["border-radius"]).toBe("var(--caption-radius)");
    expect(plate["box-shadow"]).toBe("var(--shadow-1)");
    // The rotate property, not transform, so nothing that moves it is overwritten.
    expect(plate.rotate).toBe("-1deg");
    expect(plate.transform).toBeUndefined();
  });

  it("shows focus as a --ring outline, which high contrast's heavier one still beats", () => {
    const focus = style(".comic-name-plate:focus-visible");
    expect(focus.outline).toBe("2px solid var(--ring)");
    expect(focus["outline-offset"]).toBe("2px");
    expect(CSS).toMatch(
      /\[data-theme="hc"\] \*:focus-visible\s*\{\s*outline: 3px solid var\(--accent\) !important;/
    );
  });

  it("frames the launcher plate as a control: the panel's line, pen corners, a 2px shadow, a 44px floor", () => {
    const launcher = style(".comic-name-plate[data-launcher]");
    expect(launcher["--plate-line"]).toBe("var(--panel-w)");
    expect(launcher["border-radius"]).toBe("var(--panel-radius)");
    // Capped corners: a one-word plate is never a pill.
    for (const c of lengths(NIGHT["panel-radius"])) expect(c).toBeLessThanOrEqual(12);
    expect(launcher["box-shadow"]).toBe("var(--shadow-2)");
    expect(px(launcher["min-height"])).toBeGreaterThanOrEqual(44);
  });

  it("lays every plate flat in high contrast: no tilt, no shadow", () => {
    const flat = naming(".hc .comic-name-plate");
    expect(flat).toHaveLength(1);
    expect(flat[0].selectors).toEqual([
      ".hc .comic-name-plate",
      '[data-theme="hc"] .comic-name-plate',
    ]);
    expect(flat[0].body).toEqual({ rotate: "none", "box-shadow": "none" });
    // As specific as the launcher's rule, so it comes after every plate rule
    // that tilts or shades.
    const shaped = PANEL_RULES.filter(
      (r) =>
        r !== flat[0] &&
        r.selectors.some((s) => s.includes(".comic-name-plate")) &&
        (r.body.rotate !== undefined || r.body["box-shadow"] !== undefined)
    );
    expect(shaped.length).toBeGreaterThanOrEqual(2);
    for (const r of shaped) expect(r.at, r.selectors[0]).toBeLessThan(flat[0].at);
    expect(HC["shadow-1"]).toBe("0 0 0 0 transparent");
    expect(HC["shadow-2"]).toBe("0 0 0 0 transparent");
  });
});

describe("the panel tail and name plate rules", () => {
  const ours = PANEL_RULES.filter((r) =>
    r.selectors.some((s) => s.includes(".comic-tailed") || s.includes(".comic-name-plate"))
  );

  it("take every colour from a token", () => {
    expect(ours.length).toBeGreaterThan(10);
    expect(rawColours(ours)).toEqual([]);
  });

  it("add no blur, filter, motion or capitals, and only the hard-offset shadow tokens", () => {
    for (const r of ours) {
      for (const prop of ["text-shadow", "filter", "animation", "transition", "text-transform"]) {
        expect(r.body[prop], `${r.selectors[0]} ${prop}`).toBeUndefined();
      }
      const shadow = r.body["box-shadow"];
      if (shadow !== undefined) expect(shadow).toMatch(/^(var\(--shadow-[1-6]\)|none)$/);
    }
  });
});

describe("forced colours", () => {
  const FORCED = "@media (forced-colors: active) {";
  const layer = PANELS.indexOf("@layer components");
  const layerEnd = close(PANELS, layer);
  // The tail guard: the forced-colours block after the layer.
  const guard = PANELS.indexOf(FORCED, layerEnd);
  const guardBody = PANELS.slice(guard, close(PANELS, guard) + 1);
  /** Every forced-colours block in PANELS, with its innermost rules. */
  const blocks: { at: number; rules: Rule[] }[] = [];
  for (let at = PANELS.indexOf(FORCED); at !== -1; at = PANELS.indexOf(FORCED, at + 1)) {
    blocks.push({ at, rules: rules(PANELS.slice(at + FORCED.length, close(PANELS, at))) });
  }

  it("hide the tails, outside any layer, right after the PANELS layer", () => {
    expect(PANELS.slice(layer, layerEnd)).toContain(".comic-caption");
    expect(guard).toBeGreaterThan(layerEnd);
    // Nothing between the layer's close and the guard: it opens at the top level,
    // still inside PANELS, so before the MOTION FOUNDATIONS banner.
    expect(PANELS.slice(layerEnd + 1, guard).trim()).toBe("");
    expect(guardBody).toMatch(/\.balloon::before,\s*\.balloon::after\s*\{\s*display:\s*none;\s*\}/);
  });

  it("hide the panel's tail too, in the same guard", () => {
    expect(guardBody).toMatch(
      /\.comic-tailed::before,\s*\.comic-tailed::after\s*\{\s*display:\s*none;\s*\}/
    );
  });

  it("leave every box its outline: the guard takes no border, outline or caption away", () => {
    expect(guardBody).not.toMatch(/comic-caption|outline/);
    const guardRules = rules(guardBody.slice(FORCED.length));
    const borders = guardRules.flatMap((r) =>
      Object.entries(r.body)
        .filter(([prop]) => prop.startsWith("border"))
        .map(([prop, value]) => `${r.selectors.join(",")} ${prop}: ${value}`)
    );
    // The only border declarations are the ones that hold the plate's.
    expect(borders).toEqual([
      ".comic-name-plate border-style: solid",
      ".comic-name-plate border-width: var(--plate-line)",
    ]);
  });

  it("hold the name plate's outline solid at its own width, whatever a call site says", () => {
    // Its paper and shadow are gone in forced colours, so the outline is the
    // plate. Outside the layer, it comes after the utilities a call site adds.
    const plate = rules(guardBody.slice(FORCED.length)).filter((r) =>
      r.selectors.includes(".comic-name-plate")
    );
    expect(plate).toHaveLength(1);
    expect(plate[0].body).toEqual({ "border-style": "solid", "border-width": "var(--plate-line)" });
    // --plate-line is the plate's own line: fine, or the panel's for the launcher.
    expect(style(".comic-name-plate")["--plate-line"]).toBe("var(--line-w)");
    expect(style(".comic-name-plate[data-launcher]")["--plate-line"]).toBe("var(--panel-w)");
  });

  it("give the you caption a heavier start edge, inside the layer after its wash", () => {
    // Both fills turn to Canvas, so only a width can keep the reader's words
    // out of narration's frame. In the layer, so it is purged with the caption.
    const edges = blocks.filter((b) =>
      b.rules.some((r) => r.selectors.includes('.comic-caption[data-voice="you"]'))
    );
    expect(edges).toHaveLength(1);
    const [edge] = edges;
    expect(edge.at).toBeGreaterThan(layer);
    expect(edge.at).toBeLessThan(layerEnd);
    const wash = naming('.comic-caption[data-voice="you"]')[1];
    expect(edge.at).toBeGreaterThan(wash.at);
    expect(edge.rules).toHaveLength(1);
    const width = edge.rules[0].body["border-inline-start-width"];
    expect(width).toBe("calc(var(--line-w) * 3)");
    expect(width).not.toBe(style(".comic-caption").border.split(" ")[0]);
  });

  it("leave narration's frame as it is, so the two captions differ", () => {
    for (const b of blocks) {
      for (const r of b.rules) {
        expect(r.selectors, "a forced-colours rule on the base caption").not.toContain(
          ".comic-caption"
        );
        for (const s of r.selectors.filter((x) => x.includes(".comic-caption"))) {
          expect(s, "only the you caption changes in forced colours").toBe(
            '.comic-caption[data-voice="you"]'
          );
        }
      }
    }
  });
});

describe("the panel's entrance (.panelEnter)", () => {
  const tree = postcss.parse(MODULE_SOURCE);
  const mine: CssRule[] = [];
  tree.walkRules((r) => {
    if (r.selectors.some((s) => /\.panelEnter\b/.test(s))) mine.push(r);
  });
  /** The at-rules a rule sits in, innermost first. */
  function within(r: CssRule): AtRule[] {
    const out: AtRule[] = [];
    for (let p = r.parent; p && p.type !== "root"; p = p.parent) {
      if (p.type === "atrule") out.push(p as AtRule);
    }
    return out;
  }
  const decls = (r: CssRule): Record<string, string> =>
    Object.fromEntries(
      r.nodes.filter((n): n is Declaration => n.type === "decl").map((d) => [d.prop, d.value])
    );
  const starting = mine.filter((r) => within(r).some((a) => a.name === "starting-style"));
  const moving = mine.filter((r) => decls(r).transition !== undefined);

  it("never sets transform: opacity and the scale property only", () => {
    expect(mine.length).toBeGreaterThanOrEqual(3);
    for (const r of mine) {
      r.walkDecls((d) => {
        expect(d.prop, r.selector).not.toBe("transform");
        expect(d.prop, r.selector).not.toBe("animation");
      });
    }
    expect(moving).toHaveLength(1);
    const props = decls(moving[0])
      .transition.split(/,(?![^(]*\))/)
      .map((part) => part.trim().split(/\s+/)[0]);
    expect(props).toEqual(["opacity", "scale"]);
  });

  it("starts at opacity 0 and 96% in @starting-style, so the finished state is the fallback", () => {
    expect(starting).toHaveLength(1);
    expect(decls(starting[0])).toEqual({ opacity: "0", scale: "0.96" });
    // Nothing else pins opacity or scale: without @starting-style the panel is simply there.
    for (const r of mine.filter((x) => x !== starting[0])) {
      expect(decls(r).opacity, r.selector).toBeUndefined();
      expect(decls(r).scale, r.selector).toBeUndefined();
    }
  });

  it("eases over --dur-surface-in with --ease-calm, tokens MOTION FOUNDATIONS defines", () => {
    expect(decls(moving[0]).transition.replace(/\s+/g, " ")).toBe(
      "opacity var(--dur-surface-in) var(--ease-calm), scale var(--dur-surface-in) var(--ease-calm)"
    );
    const motion = section("MOTION FOUNDATIONS", "PAGE SETTLE");
    expect(motion).toMatch(/--dur-surface-in:\s*\d+ms;/);
    expect(motion).toMatch(/--ease-calm:\s*cubic-bezier\([^)]*\);/);
  });

  it("moves nothing under reduced motion: the transition and its start live only under no-preference", () => {
    const guarded = (r: CssRule) =>
      within(r).some(
        (a) => a.name === "media" && a.params === "(prefers-reduced-motion: no-preference)"
      );
    expect(guarded(moving[0])).toBe(true);
    expect(guarded(starting[0])).toBe(true);
    // The guard itself is top level, so no other condition hides it.
    const media = within(starting[0]).find((a) => a.name === "media")!;
    expect(media.parent?.type).toBe("root");
  });

  it("grows from the tail tip the panel sets as --panel-origin", () => {
    const base = mine.filter((r) => within(r).length === 0);
    expect(base).toHaveLength(1);
    expect(decls(base[0])).toEqual({ "transform-origin": "var(--panel-origin, 50% 100%)" });
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

  /**
   * The mascot's CSS module as Next builds it: its classes scoped (and hashed,
   * `<file>_<class>__<hash>`) by the CSS-modules plugins css-loader runs, then
   * the same minifier.
   */
  async function buildModule(): Promise<string> {
    process.env.BROWSERSLIST_IGNORE_OLD_DATA = "1";
    const local = require("next/dist/compiled/postcss-modules-local-by-default");
    const scope = require("next/dist/compiled/postcss-modules-scope");
    const nano = require("next/dist/compiled/cssnano-simple");
    const scoped = await postcss([
      local(),
      scope({ generateScopedName: (name: string) => `mascot-assistant_${name}__Ab1c2` }),
    ]).process(MODULE_SOURCE, { from: "mascot-assistant.module.css" });
    const min = await postcss([nano({}, postcss)]).process(scoped.css, { from: undefined });
    return stripWhitespace(min.css);
  }

  const failing = (...css: string[]) =>
    checkMarkers(css, { AMR: MARKERS.AMR })
      .filter((r: { ok: boolean }) => !r.ok)
      .map((r: { name: string }) => r.name);

  it("keeps every AMR marker through Tailwind, CSS modules and the minifier", async () => {
    const globals = await build("balloon comic-caption comic-tailed comic-name-plate");
    const mascot = await buildModule();
    expect(failing(globals, mascot)).toEqual([]);
    // The entrance comes from the module alone, its class hashed but still named.
    expect(mascot).toContain("@starting-style{.mascot-assistant_panelEnter__Ab1c2{");
    expect(failing(globals)).toEqual([MARKERS.AMR[7].name]);
  }, 60_000);

  it("keeps the forced-colours guard where no caption is used: it is outside the layer", async () => {
    const css = await build("balloon comic-tailed comic-name-plate");
    expect(css).not.toContain(".comic-caption");
    // The you caption's markers go with it: its forced-colours edge is in the layer.
    expect(failing(css, await buildModule())).toEqual([MARKERS.AMR[1].name, MARKERS.AMR[4].name]);
  }, 60_000);

  it("keeps the panel's tails hidden and the plate's outline held in forced colours", async () => {
    const css = await build("comic-tailed comic-name-plate");
    const FORCED = "@media(forced-colors:active){";
    const found: Rule[] = [];
    for (let at = css.indexOf(FORCED); at !== -1; at = css.indexOf(FORCED, at + 1)) {
      found.push(...rules(css.slice(at + FORCED.length, close(css, at))));
    }
    const hides = (pseudo: string) =>
      found.some(
        (r) => r.selectors.includes(`.comic-tailed:${pseudo}`) && r.body.display === "none"
      );
    expect(hides("before")).toBe(true);
    expect(hides("after")).toBe(true);
    expect(
      found.some(
        (r) =>
          r.selectors.includes(".comic-name-plate") &&
          r.body["border-style"] === "solid" &&
          r.body["border-width"] === "var(--plate-line)"
      )
    ).toBe(true);
  }, 60_000);
});
