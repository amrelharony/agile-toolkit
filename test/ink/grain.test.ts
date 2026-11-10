// @vitest-environment node
/**
 * The paper grain (lib/ink/grain.ts, globals.css PAPER; DNA-SPEC lines 11, 13
 * and 27): the tiles in globals.css are the ones grain.ts writes, each stays
 * small, still and filter-free, specks sit on whole pixels without lining up,
 * the grain is only the body's background in Comic and Night, and text on the
 * worst pixel, where both tiles' specks overlap, still clears 4.5:1.
 */
import { readdirSync, readFileSync, statSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import {
  GRAIN_A,
  GRAIN_B,
  GRAIN_C,
  PAPER_GRAIN,
  grainMask,
  grainSpecks,
  grainTiles,
  paperGrain,
  type GrainStrength,
  type GrainTheme,
} from "@/lib/ink/grain";

const SRC = path.join(process.cwd(), "src");
const GLOBALS = path.join(SRC, "app/globals.css");
const css = readFileSync(GLOBALS, "utf8");
const bare = css.replace(/\/\*[\s\S]*?\*\//g, "");

/**
 * Files besides globals.css allowed to hold a tile string. The intro book
 * stylesheet (intro-look.module.css) joins when it lands.
 */
const ALLOWED: string[] = [];

const THEMES: GrainTheme[] = ["light", "dark"];
const STRENGTHS: [string, GrainStrength][] = [
  ["A", GRAIN_A],
  ["B", GRAIN_B],
  ["C", GRAIN_C],
];

/** The SVG inside a data URI. */
function svgOf(uri: string): string {
  expect(uri.startsWith("data:image/svg+xml,")).toBe(true);
  return decodeURIComponent(uri.slice("data:image/svg+xml,".length));
}

function attr(svg: string, name: string): string | undefined {
  return svg.match(new RegExp(`\\s${name}='([^']*)'`))?.[1];
}

interface ParsedSpeck {
  x: number;
  y: number;
  len: number;
}

/** Specks read back from the path: an absolute move, then relative moves, each with one h. */
function specksOf(svg: string): ParsedSpeck[] {
  const d = attr(svg, "d")!;
  expect(d).toMatch(/^M[\d.]+ [\d.]+h[12](m-?\d+ \d+h[12])*$/);
  const specks: ParsedSpeck[] = [];
  let x = 0;
  let y = 0;
  for (const m of Array.from(d.matchAll(/([Mm])(-?[\d.]+) (-?[\d.]+)h(\d+)/g))) {
    const [dx, dy, len] = [Number(m[2]), Number(m[3]), Number(m[4])];
    if (m[1] === "M") [x, y] = [dx, dy];
    else [x, y] = [x + dx, y + dy];
    specks.push({ x, y, len });
    x += len;
  }
  return specks;
}

/** Each rule in plain CSS text as selector and body (one level of @media unwrapped). */
function rules(text: string): { selector: string; body: string; media: string }[] {
  const out: { selector: string; body: string; media: string }[] = [];
  const walk = (chunk: string, media: string) => {
    let i = 0;
    while (i < chunk.length) {
      const open = chunk.indexOf("{", i);
      if (open === -1) break;
      const head = chunk.slice(i, open).trim();
      let depth = 0;
      let j = open;
      for (; j < chunk.length; j++) {
        if (chunk[j] === "{") depth++;
        if (chunk[j] === "}" && --depth === 0) break;
      }
      const inner = chunk.slice(open + 1, j);
      if (head.startsWith("@")) walk(inner, head);
      else out.push({ selector: head.replace(/\s+/g, " "), body: inner, media });
      i = j + 1;
    }
  };
  walk(text, "");
  return out;
}

const RULES = rules(bare);

function value(body: string, prop: string): string | undefined {
  const m = body.match(new RegExp(`(?:^|;|\\s)${prop}:\\s*([^;]+);`));
  return m?.[1].replace(/\s*\n\s*/g, " ").trim();
}

describe("the tiles in globals.css", () => {
  for (const theme of THEMES) {
    it(`html.${theme} body carries paperGrain('${theme}') as its background image`, () => {
      const rule = RULES.find((r) => r.selector === `html.${theme} body` && r.media === "");
      expect(rule).toBeDefined();
      expect(value(rule!.body, "background-image")).toBe(paperGrain(theme));
      expect(Array.from(rule!.body.matchAll(/url\("([^"]*)"\)/g), (m) => m[1])).toEqual(
        grainTiles(theme)
      );
      // The image only: no shorthand that would reset the colour, nothing fixed.
      expect(rule!.body.replace(/\s+/g, " ").trim()).toMatch(/^background-image: [^;]+;$/);
    });
  }

  it("uses strength B, the default, until the owner picks from the captures", () => {
    expect(PAPER_GRAIN).toBe(GRAIN_B);
    const opacities = THEMES.map((theme) =>
      grainTiles(theme).map((t) => Number(attr(svgOf(t), "opacity")))
    );
    expect(opacities).toEqual([
      [0.1, 0.1],
      [0.08, 0.08],
    ]);
  });
});

describe("every tile", () => {
  const all = STRENGTHS.flatMap(([name, s]) =>
    THEMES.flatMap((theme) => grainTiles(theme, s).map((uri) => ({ name, s, theme, uri })))
  );

  it("is 450 bytes or less, mask included", () => {
    for (const { name, theme, uri } of all) {
      expect(Buffer.byteLength(uri), `${name} ${theme}`).toBeLessThanOrEqual(450);
    }
    expect(Buffer.byteLength(grainMask())).toBeLessThanOrEqual(450);
  });

  it("comes in pairs whose sides share no factor", () => {
    const gcd = (a: number, b: number): number => (b === 0 ? a : gcd(b, a % b));
    for (const [name, s] of STRENGTHS) {
      expect(gcd(s.tiles[0], s.tiles[1]), name).toBe(1);
      for (const theme of THEMES) {
        const sizes = grainTiles(theme, s).map((t) => Number(attr(svgOf(t), "width")));
        expect(sizes).toEqual([...s.tiles]);
      }
    }
    expect(PAPER_GRAIN.tiles).toEqual([61, 47]);
  });

  it("has no filter, turbulence, image, link, animation or dash pattern", () => {
    for (const { uri } of [...all, { uri: grainMask() }]) {
      const svg = svgOf(uri);
      expect(svg).not.toMatch(/filter|turbulence|image|href|animate|set\b|dasharray/i);
      expect(svg.match(/<\w+/g)).toEqual(["<svg", "<path"]);
    }
  });

  it("names its colour with a keyword, never a hex", () => {
    for (const { uri } of [...all, { uri: grainMask() }]) {
      const svg = svgOf(uri);
      expect(svg).not.toContain("#");
      expect(attr(svg, "stroke")).toMatch(/^(black|white)$/);
      expect(attr(svg, "fill")).toBeUndefined();
    }
  });

  it("keeps each layer at 10% or less, black in Comic and white in Night", () => {
    for (const { name, s, theme, uri } of all) {
      const svg = svgOf(uri);
      const opacity = Number(attr(svg, "opacity"));
      expect(opacity, `${name} ${theme}`).toBe(s.opacity[theme]);
      expect(opacity).toBeLessThanOrEqual(0.1);
      expect(attr(svg, "stroke")).toBe(theme === "light" ? "black" : "white");
    }
  });
});

describe("the specks", () => {
  it("each start on a whole pixel on a half-pixel row, inside the tile", () => {
    for (const [name, s] of STRENGTHS) {
      grainTiles("light", s).forEach((uri, i) => {
        const size = s.tiles[i];
        const specks = specksOf(svgOf(uri));
        expect(specks, `${name} ${size}`).toHaveLength(s.specks);
        for (const sp of specks) {
          expect(Number.isInteger(sp.x)).toBe(true);
          expect(Number.isInteger(sp.y - 0.5)).toBe(true);
          expect([1, 2]).toContain(sp.len);
          expect(sp.x).toBeGreaterThanOrEqual(0);
          expect(sp.x + sp.len).toBeLessThanOrEqual(size);
          expect(sp.y).toBeLessThan(size);
        }
        // The path is the generator's speck list, in its order.
        expect(specks).toEqual(
          grainSpecks(size, s.specks).map((g) => ({ x: g.x, y: g.row + 0.5, len: g.len }))
        );
      });
    }
  });

  it("never line up: no x or y value is used by more than 4 specks in a tile", () => {
    for (const [, s] of STRENGTHS) {
      for (const uri of grainTiles("light", s)) {
        const specks = specksOf(svgOf(uri));
        for (const key of ["x", "y"] as const) {
          const counts = new Map<number, number>();
          for (const sp of specks) counts.set(sp[key], (counts.get(sp[key]) ?? 0) + 1);
          expect(Math.max(...Array.from(counts.values()))).toBeLessThanOrEqual(4);
        }
      }
    }
  });

  it("are the same in both themes", () => {
    for (const [, s] of STRENGTHS) {
      const [light, dark] = THEMES.map((t) => grainTiles(t, s).map((u) => attr(svgOf(u), "d")));
      expect(dark).toEqual(light);
    }
  });

  it("cover about 1.5%, 3.5% and 6% of the paper for A, B and C", () => {
    const coverage = (s: GrainStrength) =>
      1 -
      grainTiles("light", s).reduce((clear, uri, i) => {
        const px = specksOf(svgOf(uri)).reduce((n, sp) => n + sp.len, 0);
        return clear * (1 - px / s.tiles[i] ** 2);
      }, 1);
    expect(coverage(GRAIN_A)).toBeGreaterThan(0.01);
    expect(coverage(GRAIN_A)).toBeLessThan(0.02);
    expect(coverage(GRAIN_B)).toBeGreaterThan(0.03);
    expect(coverage(GRAIN_B)).toBeLessThan(0.04);
    expect(coverage(GRAIN_C)).toBeGreaterThan(0.05);
    expect(coverage(GRAIN_C)).toBeLessThan(0.07);
  });

  it("grainMask() is the 61 px tile with the same specks, opaque, for an alpha mask", () => {
    const mask = svgOf(grainMask());
    const page = svgOf(grainTiles("light")[0]);
    expect(attr(mask, "width")).toBe("61");
    expect(attr(mask, "height")).toBe("61");
    expect(attr(mask, "d")).toBe(attr(page, "d"));
    expect(attr(mask, "opacity")).toBeUndefined();
    expect(grainMask().startsWith("url(")).toBe(false);
  });
});

describe("where the grain may be", () => {
  it("is set only as background-image on html.light body and html.dark body", () => {
    const holders = RULES.filter((r) => r.body.includes("data:image/svg+xml"));
    expect(holders.map((r) => `${r.media}|${r.selector}`)).toEqual([
      "|html.light body",
      "|html.dark body",
    ]);
    // Nothing for high contrast: the boot script leaves only one of light, dark or hc on <html>.
    const hc = RULES.filter((r) => /\.hc\b|data-theme="hc"/.test(r.selector));
    expect(hc.some((r) => /background-image/.test(r.body))).toBe(false);
  });

  it("comes off for print, forced colours and a request for more contrast, after it is set", () => {
    const off = RULES.filter(
      (r) =>
        /print/.test(r.media) &&
        /\(forced-colors: active\)/.test(r.media) &&
        /\(prefers-contrast: more\)/.test(r.media) &&
        value(r.body, "background-image") === "none"
    );
    expect(off).toHaveLength(1);
    expect(off[0].selector.split(/,\s*/).sort()).toEqual(["html.dark body", "html.light body"]);
    const setAt = Math.max(bare.indexOf("html.light body {"), bare.indexOf("html.dark body {"));
    expect(
      bare.indexOf("@media print, (forced-colors: active), (prefers-contrast: more)")
    ).toBeGreaterThan(setAt);
  });

  it("never moves: no keyframes animate an image, and none that shift a background run on the body", () => {
    const keyframes = Array.from(bare.matchAll(/@keyframes\s+([\w-]+)\s*\{/g), (m) => {
      const start = m.index! + m[0].length;
      let depth = 1;
      let i = start;
      for (; i < bare.length && depth > 0; i++) {
        if (bare[i] === "{") depth++;
        if (bare[i] === "}") depth--;
      }
      return { name: m[1], body: bare.slice(start, i) };
    });
    expect(keyframes.length).toBeGreaterThan(0);
    for (const k of keyframes) expect(k.body, k.name).not.toMatch(/background-image|background:/);
    // The skeleton shimmer and Amr's sprite frames shift their own backgrounds.
    expect(keyframes.filter((k) => /background-position/.test(k.body)).map((k) => k.name)).toEqual([
      "skeleton-shimmer",
      "intro-amr-frames",
    ]);
    const onBody = RULES.filter((r) => r.selector.split(/,\s*/).some((s) => /(^|\s)body$/.test(s)));
    expect(onBody.length).toBeGreaterThan(0);
    for (const r of onBody) {
      expect(r.body, r.selector).not.toMatch(/animation|background-attachment|will-change/);
    }
  });

  it("switches with the theme at once: the body transition names background-color, not background", () => {
    const transitions = RULES.filter((r) => r.selector === "body")
      .map((r) => value(r.body, "transition"))
      .filter(Boolean);
    expect(transitions).toEqual(["background-color 0.6s, color 0.6s"]);
  });

  it("appears nowhere else in src, outside the allow-list", () => {
    const needles = [
      ...STRENGTHS.flatMap(([, s]) => THEMES.flatMap((t) => grainTiles(t, s))),
      ...grainTiles("light").map((u) => attr(svgOf(u), "d")!),
      grainMask(),
    ];
    const walk = (dir: string): string[] =>
      readdirSync(dir).flatMap((entry) => {
        const full = path.join(dir, entry);
        return statSync(full).isDirectory() ? walk(full) : [full];
      });
    const holders = new Set<string>();
    for (const file of walk(SRC)) {
      if (!/\.(css|tsx?|jsx?|mjs|json|svg|html|md)$/.test(file)) continue;
      const text = readFileSync(file, "utf8");
      if (needles.some((n) => text.includes(n))) {
        holders.add(path.relative(process.cwd(), file).split(path.sep).join("/"));
      }
    }
    expect(Array.from(holders).sort()).toEqual(["src/app/globals.css", ...ALLOWED].sort());
  });
});

describe("contrast on the worst pixel", () => {
  type Rgb = [number, number, number];

  function block(selector: string): Record<string, string> {
    const escaped = selector.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
    const match = bare.match(new RegExp(`${escaped}\\s*\\{([^}]*)\\}`));
    if (!match) throw new Error(`no ${selector} block in globals.css`);
    return Object.fromEntries(
      Array.from(match[1].matchAll(/--([\w-]+):\s*([^;]+);/g), (m) => [m[1], m[2].trim()])
    );
  }

  const night = block(":root");
  const PALETTES: Record<GrainTheme, Record<string, string>> = {
    light: { ...night, ...block('[data-theme="light"]') },
    dark: night,
  };

  function hex(theme: Record<string, string>, token: string): Rgb {
    const m = theme[token]?.match(/^#([0-9a-f]{6})$/i);
    if (!m) throw new Error(`--${token}: expected a 6-digit hex colour`);
    return [0, 2, 4].map((i) => parseInt(m[1].slice(i, i + 2), 16)) as Rgb;
  }

  function luminance([r, g, b]: Rgb): number {
    const lin = (c: number) => {
      const s = c / 255;
      return s <= 0.04045 ? s / 12.92 : ((s + 0.055) / 1.055) ** 2.4;
    };
    return 0.2126 * lin(r) + 0.7152 * lin(g) + 0.0722 * lin(b);
  }

  function contrast(a: Rgb, b: Rgb): number {
    const [hi, lo] = [luminance(a), luminance(b)].sort((x, y) => y - x);
    return (hi + 0.05) / (lo + 0.05);
  }

  /** Paper under a speck from each tile: two layers composited in sRGB, as browsers do. */
  function worstPaper(theme: GrainTheme, strength: GrainStrength): Rgb {
    const ink: Rgb = theme === "light" ? [0, 0, 0] : [255, 255, 255];
    let paper = hex(PALETTES[theme], "bg");
    for (const uri of grainTiles(theme, strength)) {
      const a = Number(attr(svgOf(uri), "opacity"));
      paper = paper.map((c, i) => ink[i] * a + c * (1 - a)) as Rgb;
    }
    return paper;
  }

  for (const theme of THEMES) {
    it(`keeps --text, --sub and --accent at 4.5:1 or more in ${theme === "light" ? "Comic" : "Night"}, at every strength`, () => {
      for (const [name, s] of STRENGTHS) {
        const paper = worstPaper(theme, s);
        for (const token of ["text", "sub", "accent"]) {
          const ratio = contrast(hex(PALETTES[theme], token), paper);
          expect(ratio, `${name} --${token}`).toBeGreaterThanOrEqual(4.5);
        }
      }
    });
  }
});
