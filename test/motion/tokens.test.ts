// @vitest-environment node
/**
 * The shared motion tokens (lib/motion/tokens.ts) and their mirror in
 * globals.css MOTION FOUNDATIONS: the same strings, springs whose peaks are the
 * overshoot DNA-SPEC section 8 names, fallbacks declared before the linear()
 * that replaces them, presenting mapped to calm, and Tailwind keys that read
 * the variables. The block sits before the ink rules, whose test slices the
 * file at the first "INK GRAPHICS", so its comments must not use those words.
 */
import { readFileSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import config from "../../tailwind.config";
import {
  DUR,
  EASE,
  EASE_FALLBACK,
  LINEAR_SUPPORTS,
  POP_SPRING,
  SETTLE_SPRING,
  SPRING_STEPS,
  dampedSpring,
  dampingRatio,
} from "@/lib/motion/tokens";
import * as durations from "@/lib/motion/durations";

const css = readFileSync(path.join(process.cwd(), "src/app/globals.css"), "utf8");
const SLICING_WORDS = ["INK GRAPHICS", "COMIC INTROS", "HOVER INTERACTION PATTERNS"];
const BANNERS = ["MOTION FOUNDATIONS", "PAGE SETTLE", "DATA MOTION", "SURFACES", "PRESS", "BOARDS"];

/** Where a banner's own line starts, e.g. "\n   PRESS — …". */
function bannerAt(name: string): number {
  const m = new RegExp(`\\n   ${name}(?= — |\\r?\\n)`).exec(css);
  return m ? m.index : -1;
}

/** Where the comment holding that banner opens. */
function commentAt(name: string): number {
  return css.lastIndexOf("/*", bannerAt(name));
}

function uncommented(text: string): string {
  return text.replace(/\/\*[\s\S]*?\*\//g, "");
}

const foundations = uncommented(
  css.slice(commentAt("MOTION FOUNDATIONS"), commentAt("PAGE SETTLE"))
);

/** The body of the first `head {…}` in `text`, braces matched. */
function body(text: string, head: string): string {
  const at = text.indexOf(head);
  expect(at, head).toBeGreaterThan(-1);
  let depth = 0;
  let i = text.indexOf("{", at);
  const open = i;
  for (; i < text.length; i++) {
    if (text[i] === "{") depth++;
    if (text[i] === "}" && --depth === 0) break;
  }
  return text.slice(open + 1, i);
}

/** Custom properties in a rule body, values on one line as tokens.ts writes them. */
function props(text: string): Record<string, string> {
  return Object.fromEntries(
    Array.from(text.matchAll(/(--[\w-]+):\s*([^;]+);/g), (m) => [
      m[1],
      m[2].replace(/\s+/g, " ").replace(/\(\s/g, "(").replace(/\s\)/g, ")").trim(),
    ])
  );
}

const supports = body(foundations, `@supports ${LINEAR_SUPPORTS}`);
// The first :root is the one outside @supports.
const root = props(body(foundations, ":root"));
const linear = props(body(supports, ":root"));
const presenting = props(body(foundations, 'html[data-presenting="true"]'));

function points(ease: string): number[] {
  const m = ease.match(/^linear\((.*)\)$/);
  expect(m, ease).not.toBeNull();
  return m![1].split(",").map((p) => {
    expect(p.trim(), "evenly spaced points carry no percentages").toMatch(/^-?\d*\.?\d+$/);
    return Number(p);
  });
}

/** y(t) of a cubic-bezier, sampled along t; its max is the curve's peak. */
function bezier(ease: string): number[] {
  const m = ease.match(/^cubic-bezier\(([^)]*)\)$/);
  expect(m, ease).not.toBeNull();
  const [x1, y1, x2, y2] = m![1].split(",").map(Number);
  expect(x1).toBeGreaterThanOrEqual(0);
  expect(x1).toBeLessThanOrEqual(1);
  expect(x2).toBeGreaterThanOrEqual(0);
  expect(x2).toBeLessThanOrEqual(1);
  return Array.from({ length: 1001 }, (_, i) => {
    const t = i / 1000;
    return 3 * (1 - t) ** 2 * t * y1 + 3 * (1 - t) * t ** 2 * y2 + t ** 3;
  });
}

/** Rises to one peak and comes back down to 1 without dipping under it. */
function oneOvershoot(ys: number[]): boolean {
  const peak = ys.indexOf(Math.max(...ys));
  const rises = ys.slice(0, peak + 1).every((y, i) => i === 0 || y >= ys[i - 1] - 1e-12);
  const falls = ys.slice(peak).every((y, i, a) => i === 0 || y <= a[i - 1] + 1e-12);
  return rises && falls && Math.min(...ys.slice(peak)) >= 1 - 1e-9;
}

describe("MOTION FOUNDATIONS mirrors lib/motion/tokens.ts", () => {
  it("declares calm, glide and the two fallbacks on :root", () => {
    expect(root["--ease-calm"]).toBe(EASE.calm);
    expect(root["--ease-glide"]).toBe(EASE.glide);
    expect(root["--ease-settle"]).toBe(EASE_FALLBACK.settle);
    expect(root["--ease-pop"]).toBe(EASE_FALLBACK.pop);
    expect(EASE.calm).toBe("cubic-bezier(0.16, 1, 0.3, 1)");
  });

  it("replaces only settle and pop with their linear() lists inside the @supports test", () => {
    expect(linear).toEqual({ "--ease-settle": EASE.settle, "--ease-pop": EASE.pop });
    expect(Object.values(root).join(" ")).not.toContain("linear(");
  });

  it("declares each fallback before the @supports block that overrides it", () => {
    const at = foundations.indexOf("@supports");
    expect(foundations.indexOf("--ease-settle: cubic-bezier(")).toBeLessThan(at);
    expect(foundations.indexOf("--ease-pop: cubic-bezier(")).toBeLessThan(at);
    expect(foundations.indexOf("--ease-settle: linear(")).toBeGreaterThan(at);
    expect(foundations.indexOf("--ease-pop: linear(")).toBeGreaterThan(at);
  });

  it("writes every duration in ms", () => {
    expect(DUR).toEqual({
      press: 90,
      settle: 320,
      data: 450,
      "surface-in": 220,
      "surface-out": 140,
      "sheet-in": 280,
      "sheet-out": 200,
      page: 240,
      travel: 360,
    });
    for (const [name, ms] of Object.entries(DUR)) expect(root[`--dur-${name}`]).toBe(`${ms}ms`);
  });

  it("declares nothing else on :root", () => {
    const names = [
      ...Object.keys(EASE).map((n) => `--ease-${n}`),
      ...Object.keys(DUR).map((n) => `--dur-${n}`),
    ];
    expect(Object.keys(root).sort()).toEqual(names.sort());
  });

  it("maps glide, settle and pop to calm while presenting", () => {
    expect(presenting).toEqual({
      "--ease-glide": "var(--ease-calm)",
      "--ease-settle": "var(--ease-calm)",
      "--ease-pop": "var(--ease-calm)",
    });
  });
});

describe("the springs and their peaks", () => {
  it("starts each linear() list at 0, ends it at 1, with evenly spaced points", () => {
    for (const ease of [EASE.settle, EASE.pop]) {
      const ys = points(ease);
      expect(ys).toHaveLength(SPRING_STEPS + 1);
      expect(ys[0]).toBe(0);
      expect(ys.at(-1)).toBe(1);
    }
  });

  it("peaks at calm 1.0, glide at most 1.03, settle 1.06-1.10 and pop 1.14-1.18", () => {
    expect(Math.max(...bezier(EASE.calm))).toBeCloseTo(1, 9);
    const glide = Math.max(...bezier(EASE.glide));
    expect(glide).toBeGreaterThanOrEqual(1);
    expect(glide).toBeLessThanOrEqual(1.03);
    const settle = Math.max(...points(EASE.settle));
    expect(settle).toBeGreaterThanOrEqual(1.06);
    expect(settle).toBeLessThanOrEqual(1.1);
    const pop = Math.max(...points(EASE.pop));
    expect(pop).toBeGreaterThanOrEqual(1.14);
    expect(pop).toBeLessThanOrEqual(1.18);
  });

  it("gives each fallback one overshoot of about its spring's height", () => {
    const settle = bezier(EASE_FALLBACK.settle);
    const pop = bezier(EASE_FALLBACK.pop);
    expect(oneOvershoot(settle)).toBe(true);
    expect(oneOvershoot(pop)).toBe(true);
    expect(Math.max(...settle)).toBeGreaterThanOrEqual(1.06);
    expect(Math.max(...settle)).toBeLessThanOrEqual(1.1);
    expect(Math.max(...pop)).toBeGreaterThanOrEqual(1.14);
    expect(Math.max(...pop)).toBeLessThanOrEqual(1.18);
    expect(oneOvershoot(bezier(EASE.glide))).toBe(true);
  });

  it("samples one damped spring: the peak a spring of that damping ratio reaches", () => {
    for (const [spring, ease] of [
      [SETTLE_SPRING, EASE.settle],
      [POP_SPRING, EASE.pop],
    ] as const) {
      const z = dampingRatio(spring);
      const theory = 1 + Math.exp((-z * Math.PI) / Math.sqrt(1 - z * z));
      expect(Math.abs(Math.max(...points(ease)) - theory)).toBeLessThan(0.005);
    }
    expect(dampingRatio(SETTLE_SPRING)).toBe(0.625);
    expect(dampingRatio(POP_SPRING)).toBe(0.5);
  });

  it("has each spring within 0.5% of its target by the end of the settle duration", () => {
    for (const spring of [SETTLE_SPRING, POP_SPRING]) {
      const { d } = dampedSpring(spring, -1, 0, DUR.settle / 1000);
      expect(Math.abs(d)).toBeLessThan(0.005);
    }
  });
});

describe("Tailwind reads the variables", () => {
  const theme = config.theme?.extend as unknown as {
    transitionTimingFunction: Record<string, string>;
    transitionDuration: Record<string, string>;
  };

  it("has an ease-* key for every easing and keeps spring and elastic", () => {
    const { spring, elastic, ...tokens } = theme.transitionTimingFunction;
    expect(spring).toBe("cubic-bezier(0.16, 1, 0.3, 1)");
    expect(elastic).toBe("cubic-bezier(0.175, 0.885, 0.32, 1.275)");
    expect(tokens).toEqual(
      Object.fromEntries(Object.keys(EASE).map((n) => [n, `var(--ease-${n})`]))
    );
  });

  it("has a duration-* key for every duration, each naming a declared variable", () => {
    const tokens = Object.fromEntries(
      Object.entries(theme.transitionDuration).filter(([, v]) => v.startsWith("var("))
    );
    expect(tokens).toEqual(Object.fromEntries(Object.keys(DUR).map((n) => [n, `var(--dur-${n})`])));
    for (const value of [
      ...Object.values(tokens),
      ...Object.keys(EASE).map((n) => `var(--ease-${n})`),
    ]) {
      const name = value.slice(4, -1);
      expect(root[name], name).toBeDefined();
    }
  });
});

describe("the plain values in lib/motion/durations.ts", () => {
  const read = (file: string) => readFileSync(path.join(process.cwd(), file), "utf8");

  it("are the same durations and cubic-bezier easings tokens.ts exports", () => {
    expect(DUR).toBe(durations.DUR);
    expect(durations.CURVE).toEqual({ calm: EASE.calm, glide: EASE.glide });
  });

  it("import nothing, so a file reading them never pulls in the spring solver", () => {
    expect(read("src/lib/motion/durations.ts")).not.toMatch(/^\s*(import|export\s.*\sfrom)\s/m);
  });

  it("are what the header grow reads: it loads on every tool page", () => {
    const grow = read("src/lib/motion/grow-from.ts");
    expect(grow).toMatch(/from "\.\/durations"/);
    expect(grow).not.toMatch(/from "(\.\/|@\/lib\/motion\/)tokens"/);
  });
});

describe("where the block sits", () => {
  it("puts MOTION FOUNDATIONS and the five empty banners, in order, just before INK GRAPHICS", () => {
    const at = BANNERS.map(bannerAt);
    at.forEach((a, i) => {
      expect(a, BANNERS[i]).toBeGreaterThan(-1);
      if (i > 0) expect(a, BANNERS[i]).toBeGreaterThan(at[i - 1]);
    });
    expect(bannerAt("INK GRAPHICS")).toBeGreaterThan(at.at(-1)!);
    // The five banners hold no rules yet, and nothing sits between them and INK.
    expect(uncommented(css.slice(commentAt("PAGE SETTLE"), commentAt("INK GRAPHICS"))).trim()).toBe(
      ""
    );
  });

  it("keeps the slicing words out of its comments, so the first match is still each real banner", () => {
    const region = css.slice(bannerAt("MOTION FOUNDATIONS"), bannerAt("INK GRAPHICS"));
    for (const word of SLICING_WORDS) expect(region).not.toContain(word);
    expect(css.indexOf("INK GRAPHICS")).toBe(bannerAt("INK GRAPHICS") + 4);
    expect(css.indexOf("COMIC INTROS")).toBe(bannerAt("COMIC INTROS") + 4);
    expect(css.indexOf("HOVER INTERACTION PATTERNS")).toBe(
      bannerAt("HOVER INTERACTION PATTERNS") + 4
    );
  });
});
