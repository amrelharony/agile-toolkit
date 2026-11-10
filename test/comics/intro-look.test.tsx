/**
 * The look a drawn book wears in the comic intros (components/intro/intro-look):
 * a static stylesheet whose one url() is the page paper's grain mask, masks
 * written for every browser that has them, and parts that high contrast takes
 * away. Further down, the locks every intro stylesheet shares.
 */

import { readFileSync } from "node:fs";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { cleanup, render } from "@testing-library/react";
import {
  CoverLettering,
  Grain,
  Ground,
  Light,
  PageEdges,
  TurnShade,
} from "@/app/(tools)/comics/components/intro/intro-look";
import { grainMask } from "@/lib/ink/grain";
import { EASE, EASE_FALLBACK } from "@/lib/motion/tokens";

const DIR = "src/app/(tools)/comics/components/intro";
const LOOK = `${DIR}/intro-look.module.css`;
const BOOK = `${DIR}/book-intro.module.css`;
const POSTER = `${DIR}/poster-intro.module.css`;
const VIP = `${DIR}/vip-intro.module.css`;

/** Every intro stylesheet: the three scenes and the look they share. */
const INTRO_SHEETS = [BOOK, POSTER, VIP, LOOK];
/** The scenes, which are the ones that animate. */
const SCENES = [BOOK, POSTER, VIP];
/**
 * Each scene's clip-path wipes, by keyframes name: the ink wipes, which carry
 * a bowed shape() twin, and the ones kept straight on purpose. A poster
 * window's edge runs exactly on its band's leading edge, which a bow on either
 * would break; the VIP rule is a pen stroke a few pixels tall, where no bow
 * would show.
 */
const WIPES: Record<string, { bowed: string[]; straight: string[] }> = {
  [BOOK]: { bowed: ["book-ink"], straight: [] },
  [POSTER]: { bowed: ["ink"], straight: ["reveal", "band"] },
  [VIP]: { bowed: ["vipInkWipe"], straight: ["vipRule"] },
};

function read(file: string): string {
  return readFileSync(path.join(process.cwd(), file), "utf8");
}

/** A value with its whitespace evened out the way tokens.ts writes one. */
function tidy(value: string): string {
  return value
    .replace(/\s+/g, " ")
    .replace(/\(\s/g, "(")
    .replace(/\s\)/g, ")")
    .replace(/\s,/g, ",")
    .trim();
}

type Decl = [property: string, value: string];

interface Rule {
  selector: string;
  decls: Decl[];
  /** The at-rules around it, outermost first, as written. */
  at: string[];
}

interface Keyframes {
  name: string;
  at: string[];
  steps: { offsets: string; decls: Decl[] }[];
}

function decls(body: string): Decl[] {
  return body
    .split(";")
    .map((d) => d.trim())
    .filter(Boolean)
    .map((d) => {
      const colon = d.indexOf(":");
      return [d.slice(0, colon).trim(), tidy(d.slice(colon + 1))];
    });
}

/** Every rule and @keyframes in a stylesheet, comments out, at-rules unwrapped. */
function parse(text: string): { rules: Rule[]; keyframes: Keyframes[] } {
  const rules: Rule[] = [];
  const keyframes: Keyframes[] = [];
  const walk = (chunk: string, at: string[]) => {
    let i = 0;
    while (i < chunk.length) {
      const open = chunk.indexOf("{", i);
      if (open === -1) break;
      const head = tidy(chunk.slice(i, open));
      let depth = 0;
      let j = open;
      for (; j < chunk.length; j++) {
        if (chunk[j] === "{") depth += 1;
        if (chunk[j] === "}" && --depth === 0) break;
      }
      const inner = chunk.slice(open + 1, j);
      if (head.startsWith("@keyframes")) {
        keyframes.push({
          name: head.split(" ")[1],
          at,
          steps: Array.from(inner.matchAll(/([^{}]+)\{([^{}]*)\}/g), (m) => ({
            offsets: tidy(m[1]),
            decls: decls(m[2]),
          })),
        });
      } else if (head.startsWith("@")) walk(inner, [...at, head]);
      else rules.push({ selector: head, decls: decls(inner), at });
      i = j + 1;
    }
  };
  walk(text.replace(/\/\*[\s\S]*?\*\//g, ""), []);
  return { rules, keyframes };
}

const look = parse(read(LOOK));
const lookText = read(LOOK).replace(/\/\*[\s\S]*?\*\//g, "");

function rulesFor(selector: string): Rule[] {
  return look.rules.filter((r) => r.selector.split(/,\s*/).includes(selector));
}

/** The one top-level rule written for `selector` alone. */
function own(selector: string): Rule {
  const found = look.rules.filter((r) => r.selector === selector && r.at.length === 0);
  expect(found, selector).toHaveLength(1);
  return found[0];
}

function value(rule: Rule, property: string): string | undefined {
  return rule.decls.find(([p]) => p === property)?.[1];
}

/**
 * Holds every mask longhand in `rules` to its -webkit- twin, written first
 * with the same value, and every -webkit- one to its plain twin; no mask
 * shorthand. Returns how many plain mask longhands it checked.
 */
function checkMaskTwins(rules: Rule[]): number {
  let masks = 0;
  for (const rule of rules) {
    rule.decls.forEach(([property, v], i) => {
      expect(property, rule.selector).not.toMatch(/^(?:-webkit-)?mask$/);
      if (!property.startsWith("mask-")) return;
      masks += 1;
      const twin = rule.decls.findIndex(([p]) => p === `-webkit-${property}`);
      expect(twin, `${rule.selector}: -webkit-${property}`).toBeGreaterThan(-1);
      expect(twin, `${rule.selector}: -webkit-${property} before ${property}`).toBeLessThan(i);
      expect(rule.decls[twin][1]).toBe(v);
    });
    for (const [property] of rule.decls) {
      if (!property.startsWith("-webkit-mask-")) continue;
      const plain = property.slice("-webkit-".length);
      expect(
        rule.decls.some(([p]) => p === plain),
        `${rule.selector}: ${plain}`
      ).toBe(true);
    }
  }
  return masks;
}

afterEach(cleanup);

describe("intro-look.module.css", () => {
  it("is static: no keyframes, no animation, no transition", () => {
    expect(look.keyframes).toEqual([]);
    expect(lookText).not.toMatch(/@keyframes|\banimation(?:-[a-z-]+)?\s*:|\btransition\s*:/);
  });

  it("draws no gradient, and colours with the theme's tokens only", () => {
    expect(lookText).not.toMatch(/gradient\(/);
    expect(lookText).not.toMatch(
      /#[0-9a-f]{3,8}\b|\b(?:rgba?|hsla?|hwb|lab|lch|oklab|oklch|color|color-mix)\(/i
    );
  });

  it("holds one url(), the grain mask from lib/ink/grain.ts, written once as --look-grain", () => {
    expect(lookText.match(/url\(/g)).toHaveLength(1);
    const grain = own(".grain");
    expect(value(grain, "--look-grain")).toBe(`url("${grainMask()}")`);
  });

  it("writes every mask property's -webkit- twin first, with the same value, and no mask shorthand", () => {
    expect(checkMaskTwins(look.rules)).toBeGreaterThanOrEqual(3);
  });

  it("masks the grain with the tile at its own size, repeating", () => {
    const grain = own(".grain");
    const size = decodeURIComponent(grainMask()).match(/width='(\d+)' height='(\d+)'/)!;
    expect(value(grain, "mask-image")).toBe("var(--look-grain)");
    expect(value(grain, "mask-size")).toBe(`${size[1]}px ${size[2]}px`);
    expect(value(grain, "mask-repeat")).toBe("repeat");
  });

  it("shows the grain only where masks work, so other browsers show the plain face", () => {
    const shown = rulesFor(".grain").filter((r) => value(r, "display") !== undefined);
    expect(shown.map((r) => [r.at, value(r, "display")])).toEqual([
      [[], "none"],
      [["@supports (mask-image: none) or (-webkit-mask-image: none)"], "block"],
    ]);
  });

  it("gives the grain the text ink at 6%, and never moves it", () => {
    const grain = own(".grain");
    expect(value(grain, "background-color")).toBe("var(--text)");
    expect(value(grain, "opacity")).toBe("0.06");
    expect(lookText).not.toMatch(/position:\s*fixed|background-attachment|will-change/);
  });

  it("lights Comic with a 10% shadow-ink shade and a clear stripe, Night with a 7% text-ink stripe and no shade", () => {
    const shade = own(".lightShade");
    expect(value(shade, "background-color")).toBe("var(--shadow-color)");
    expect(value(shade, "opacity")).toBe("0.1");
    const stripe = own(".lightStripe");
    expect(value(stripe, "background-color")).toBeUndefined();
    const nightShade = own(":global(html.dark) .lightShade");
    expect(value(nightShade, "opacity")).toBe("0");
    const nightStripe = own(":global(html.dark) .lightStripe");
    expect(value(nightStripe, "background-color")).toBe("var(--text)");
    expect(value(nightStripe, "opacity")).toBe("0.07");
  });

  it("starts a turning face's shade clear, so only its scene darkens it", () => {
    const turn = own(".turn");
    expect(value(turn, "background-color")).toBe("var(--shadow-color)");
    expect(value(turn, "opacity")).toBe("0");
  });
});

describe("the look's parts", () => {
  const parts = [
    ["grain", <Grain key="grain" />],
    ["light", <Light key="light" />],
    ["turn", <TurnShade key="turn" />],
    ["edges", <PageEdges key="edges" />],
    ["ground", <Ground key="ground" />],
  ] as const;

  it.each(parts)("%s is decorative and carries data-look", (name, part) => {
    const { container } = render(part);
    const el = container.firstElementChild!;
    expect(el).toHaveAttribute("aria-hidden", "true");
    expect(el).toHaveAttribute("data-look", name);
    expect(el.textContent).toBe("");
    expect(container.querySelector("img, svg, canvas, video, picture")).toBeNull();
  });

  it("takes its scene's class, which is how a part moves", () => {
    const { container } = render(
      <>
        <Grain className="g" />
        <Light className="l" trackClassName="t" />
        <TurnShade className="s" />
        <Ground className="d" />
      </>
    );
    expect(container.querySelector('[data-look="grain"]')).toHaveClass("g");
    expect(container.querySelector('[data-look="light"]')).toHaveClass("l");
    expect(container.querySelector('[data-look="light"] > span')).toHaveClass("t");
    expect(container.querySelector('[data-look="turn"]')).toHaveClass("s");
    expect(container.querySelector('[data-look="ground"]')).toHaveClass("d");
  });

  it("draws one clear stripe between two shades", () => {
    const { container } = render(<Light />);
    const slant = container.querySelector('[data-look="light"] > span > span')!;
    expect(slant.children).toHaveLength(3);
  });

  it("draws four page-edge lines", () => {
    const { container } = render(<PageEdges />);
    expect(container.querySelector('[data-look="edges"]')!.children).toHaveLength(4);
    expect([1, 2, 3, 4].every((n) => rulesFor(`.edge:nth-child(${n})`).length === 1)).toBe(true);
  });

  it("letters the cover in words, not as a look part, so high contrast keeps it", () => {
    const { container } = render(<CoverLettering />);
    const words = Array.from(container.querySelectorAll("p"), (p) => p.textContent);
    expect(words).toEqual(["Agile at Work", "Workplace comics by Amr Elharony"]);
    expect(container.querySelector("[data-look]")).toBeNull();
    const bare = render(<CoverLettering byline={false} />).container;
    expect(Array.from(bare.querySelectorAll("p"), (p) => p.textContent)).toEqual(["Agile at Work"]);
  });

  it("is not a client component, so the server page renders it", () => {
    const tsx = read(`${DIR}/intro-look.tsx`);
    expect(tsx).not.toMatch(/^\s*["']use client["']/m);
    expect(tsx).not.toMatch(/\buse[A-Z]\w*\(/);
  });
});

describe("high contrast in globals.css", () => {
  const css = read("src/app/globals.css");
  const banner = (name: string) => new RegExp(`^ {3}${name}\\b`, "m").exec(css)?.index ?? -1;

  it("has a BOOK LOOK block after VIEW TRANSITIONS (so after REDUCED MOTION) and before MOBILE FOUNDATION", () => {
    const reduced = banner("REDUCED MOTION");
    const vt = banner("VIEW TRANSITIONS");
    const book = banner("BOOK LOOK");
    const mobile = banner("MOBILE FOUNDATION");
    expect(reduced).toBeGreaterThan(-1);
    expect(vt).toBeGreaterThan(reduced);
    expect(book).toBeGreaterThan(vt);
    expect(mobile).toBeGreaterThan(book);
  });

  it("hides every look part under .hc and [data-theme=hc], anywhere a book is drawn", () => {
    const start = banner("BOOK LOOK");
    const block = css.slice(start, banner("MOBILE FOUNDATION"));
    const { rules } = parse(block.slice(block.indexOf("═══ */") + "═══ */".length));
    expect(rules.map((r) => [r.selector, r.decls, r.at])).toEqual([
      [`.hc [data-look], [data-theme="hc"] [data-look]`, [["display", "none !important"]], []],
    ]);
    expect(block).not.toContain("data-intro-overlay");
  });

  it("says none of the words other tests slice globals.css at", () => {
    const block = css.slice(banner("BOOK LOOK"), banner("MOBILE FOUNDATION"));
    for (const words of ["INK GRAPHICS", "COMIC INTROS", "HOVER INTERACTION PATTERNS"]) {
      expect(block).not.toContain(words);
    }
  });
});

/** Split on `sep` outside parentheses: a timing function has commas of its own. */
function splitTop(text: string, sep: string): string[] {
  const parts = [""];
  let depth = 0;
  for (const char of text) {
    if (char === "(") depth += 1;
    if (char === ")") depth -= 1;
    if (char === sep && depth === 0) parts.push("");
    else parts[parts.length - 1] += char;
  }
  return parts.map((p) => p.trim()).filter(Boolean);
}

/** Each animation a rule runs, as [keyframes name, the one animation as written]. */
function animationsOf(rule: Rule, names: Set<string>): [string, string][] {
  return rule.decls
    .filter(([p]) => p === "animation")
    .flatMap(([, v]) => splitTop(v, ","))
    .map((one) => [splitTop(one, " ").find((token) => names.has(token)) ?? "", one]);
}

const sheets = INTRO_SHEETS.map((file) => ({ file, text: read(file), ...parse(read(file)) }));

describe("every intro stylesheet", () => {
  it("draws no gradient", () => {
    for (const { file, text } of sheets) {
      expect(text.replace(/\/\*[\s\S]*?\*\//g, ""), file).not.toMatch(/gradient\(/);
    }
  });

  it.each(INTRO_SHEETS)(
    "writes every mask property in %s after its -webkit- twin, with the same value",
    (file) => {
      checkMaskTwins(parse(read(file)).rules);
    }
  );

  it("uses linear() only inside keyframes, and only as tokens.ts's settle or pop spring", () => {
    const springs: string[] = [EASE.settle, EASE.pop];
    let used = 0;
    const byFile = new Map<string, number>();
    for (const { file, text, rules, keyframes } of sheets) {
      for (const rule of rules) {
        for (const [p, v] of rule.decls) {
          expect(v, `${file} ${rule.selector} ${p}`).not.toMatch(/linear\(/);
        }
      }
      let inKeyframes = 0;
      for (const k of keyframes) {
        for (const step of k.steps) {
          for (const [p, v] of step.decls) {
            if (!v.includes("linear(")) continue;
            inKeyframes += 1;
            expect(p, `${file} ${k.name}`).toBe("animation-timing-function");
            expect(springs, `${file} ${k.name}: ${v}`).toContain(v);
          }
        }
      }
      // Nowhere else either: not in a selector, a condition or a custom property.
      const all = text.replace(/\/\*[\s\S]*?\*\//g, "").match(/linear\(/g) ?? [];
      expect(all.length, file).toBe(inKeyframes);
      used += inKeyframes;
      byFile.set(file, inKeyframes);
    }
    expect(used).toBeGreaterThan(0);
    // Every scene lands on them: the poster and the VIP intro as the book does.
    for (const scene of SCENES) expect(byFile.get(scene), scene).toBeGreaterThan(0);
  });

  it("keeps the spring's own one-overshoot cubic-bezier in every shorthand whose keyframes use it", () => {
    const fallback: Record<string, string> = {
      [EASE.settle]: EASE_FALLBACK.settle,
      [EASE.pop]: EASE_FALLBACK.pop,
    };
    let checked = 0;
    const byFile = new Map<string, number>();
    for (const { file, rules, keyframes } of sheets) {
      const before = checked;
      const names = new Set(keyframes.map((k) => k.name));
      const springOf = new Map(
        keyframes.map((k) => {
          const used = new Set(
            k.steps.flatMap((s) => s.decls.map(([, v]) => v)).filter((v) => v in fallback)
          );
          expect(used.size, `${file} ${k.name}: one spring per keyframes`).toBeLessThanOrEqual(1);
          return [k.name, Array.from(used)[0]] as const;
        })
      );
      for (const rule of rules) {
        for (const [name, one] of animationsOf(rule, names)) {
          const spring = springOf.get(name);
          if (!spring) continue;
          checked += 1;
          const curves = one.match(/cubic-bezier\([^)]*\)/g) ?? [];
          expect(curves, `${file} ${rule.selector}: ${one}`).toEqual([fallback[spring]]);
          const [, y1, , y2] = fallback[spring].slice(13, -1).split(",").map(Number);
          expect(Math.max(y1, y2), one).toBeGreaterThan(1);
        }
      }
      byFile.set(file, checked - before);
    }
    expect(checked).toBeGreaterThanOrEqual(3);
    for (const scene of SCENES) expect(byFile.get(scene), scene).toBeGreaterThan(0);
  });

  // The two tests above see only linear(). A hand-made overshoot hides in a
  // curve that passes its value or in a step part-way through a landing, so
  // these hold the scenes to "the settle and pop springs only" for both.
  it("passes a value only on a spring: any other curve that would is a spring's own fallback", () => {
    const springOf: Record<string, string> = {
      [EASE_FALLBACK.settle]: EASE.settle,
      [EASE_FALLBACK.pop]: EASE.pop,
    };
    let fallbacks = 0;
    for (const file of SCENES) {
      const { rules, keyframes } = sheets.find((s) => s.file === file)!;
      const names = new Set(keyframes.map((k) => k.name));
      for (const k of keyframes) {
        for (const step of k.steps) {
          for (const [p, v] of step.decls) {
            for (const curve of v.match(/cubic-bezier\([^)]*\)/g) ?? []) {
              expect(overshoots(curve), `${file} ${k.name} ${step.offsets} ${p}: ${curve}`).toBe(
                false
              );
            }
          }
        }
      }
      for (const rule of rules) {
        for (const [p, v] of rule.decls) {
          if (p === "animation") continue;
          expect(v, `${file} ${rule.selector} ${p}`).not.toMatch(/cubic-bezier\(/);
        }
        for (const [name, one] of animationsOf(rule, names)) {
          for (const curve of one.match(/cubic-bezier\([^)]*\)/g) ?? []) {
            if (!overshoots(curve)) continue;
            fallbacks += 1;
            // Only as the fallback of the spring that animation's keyframes run.
            expect(Object.keys(springOf), `${file} ${rule.selector}: ${one}`).toContain(curve);
            const values = keyframes
              .filter((k) => k.name === name)
              .flatMap((k) => k.steps.flatMap((s) => s.decls.map(([, v]) => v)));
            expect(values, `${file} ${rule.selector}: ${one}`).toContain(springOf[curve]);
          }
        }
      }
    }
    expect(fallbacks).toBeGreaterThan(0);
  });

  it("lands every move that stays shown in one leg, its pace set on its first step alone", () => {
    for (const file of SCENES) {
      const { keyframes } = sheets.find((s) => s.file === file)!;
      const landings = keyframes.filter(staysShown);
      expect(landings.length, file).toBeGreaterThan(0);
      for (const k of landings) {
        const offsets = k.steps.map((s) => s.offsets);
        if (LEGS[file].includes(k.name)) {
          expect(offsets.length, `${file} ${k.name}`).toBeGreaterThan(2);
          continue;
        }
        expect(offsets.length, `${file} ${k.name}: ${offsets.join(" | ")}`).toBe(2);
        expect(offsets[0], `${file} ${k.name}`).toMatch(/^(?:from|0%)$/);
        expect(offsets[1], `${file} ${k.name}`).toMatch(/^(?:to|100%)$/);
        const paced = k.steps.filter((s) =>
          s.decls.some(([p]) => p === "animation-timing-function")
        );
        expect(
          paced.every((s) => s === k.steps[0]),
          `${file} ${k.name}`
        ).toBe(true);
      }
      // Every move allowed its legs is in the sheet, and stays shown.
      for (const name of LEGS[file]) {
        expect(
          landings.map((k) => k.name),
          `${file} ${name}`
        ).toContain(name);
      }
    }
  });

  it("lifts each turning sheet to upright before it lets it fall, with a spring only on the fall", () => {
    const turns = SCENES.flatMap((file) =>
      sheets
        .find((s) => s.file === file)!
        .keyframes.filter((k) => LEGS[file].includes(k.name) && k.name !== "vipFan")
        .map((k) => [file, k] as const)
    );
    expect(turns.map(([, k]) => k.name)).toEqual([
      "book-open",
      "book-leaf1",
      "book-leaf2",
      "vipBookOpen",
    ]);
    for (const [file, k] of turns) {
      const label = `${file} ${k.name}`;
      expect(k.steps, label).toHaveLength(3);
      const [lift, upright, fall] = k.steps;
      const transform = (s: (typeof k.steps)[number]) =>
        s.decls.find(([p]) => p === "transform")?.[1];
      expect(transform(lift), label).toMatch(/^rotateY\(0deg\)/);
      expect(transform(upright), label).toMatch(/^rotateY\(-90deg\)/);
      expect(transform(fall), label).toMatch(/^rotateY\(-1[56]\d(?:\.\d+)?deg\)/);
      for (const step of [lift, fall]) {
        for (const [, v] of step.decls) expect(v, label).not.toMatch(/linear\(/);
      }
      expect(
        fall.decls.map(([p]) => p),
        label
      ).not.toContain("animation-timing-function");
    }
  });
});

/** Whether a cubic-bezier passes its end value or backs away first: a y outside 0 to 1. */
function overshoots(curve: string): boolean {
  const [, y1, , y2] = curve.slice(13, -1).split(",").map(Number);
  return [y1, y2].some((y) => y < 0 || y > 1);
}

/** A keyframes that moves its element and leaves it shown: a landing, or a drift. */
function staysShown(k: Keyframes): boolean {
  const moves = k.steps.some((s) => s.decls.some(([p]) => p === "transform"));
  const hides = k.steps
    .at(-1)!
    .decls.some(
      ([p, v]) => (p === "opacity" && Number(v) === 0) || (p === "visibility" && v === "hidden")
    );
  return moves && !hides;
}

/**
 * The moves allowed more than one leg, by scene, none of them past its place
 * part-way. A sheet or cover lifted to upright and let fall: the lift is no
 * landing, and a spring, if any, is on the fall (the test above). The VIP
 * covers rise as one stack, then fan out (vipFan, left as it was).
 */
const LEGS: Record<string, string[]> = {
  [BOOK]: ["book-open", "book-leaf1", "book-leaf2"],
  [POSTER]: [],
  [VIP]: ["vipBookOpen", "vipFan"],
};

/** Whether a declaration would flatten an element that keeps the 3D space open. */
function flattens([property, v]: Decl): boolean {
  if (property === "opacity") return (v.endsWith("%") ? parseFloat(v) / 100 : Number(v)) < 1;
  if (/^overflow(?:-[xy])?$/.test(property)) return v !== "visible";
  if (/^(?:-webkit-)?mask(?:-|$)/.test(property)) return true;
  if (property === "clip-path") return v !== "none";
  if (/^(?:-webkit-)?(?:backdrop-)?filter$/.test(property)) return v !== "none";
  if (property === "mix-blend-mode") return v !== "normal";
  if (property === "isolation") return v === "isolate";
  if (property === "contain") return /paint|strict|content/.test(v);
  return false;
}

/**
 * Everything that would flatten an element that sets transform-style:
 * preserve-3d: in any rule for its selector, or in a step of keyframes one of
 * those rules runs.
 */
function flatteners(text: string): string[] {
  const { rules, keyframes } = parse(text);
  const names = new Set(keyframes.map((k) => k.name));
  const open = new Set(
    rules
      .filter((r) => r.decls.some(([p, v]) => p === "transform-style" && v === "preserve-3d"))
      .flatMap((r) => r.selector.split(/,\s*/))
  );
  const found: string[] = [];
  for (const rule of rules) {
    if (!rule.selector.split(/,\s*/).some((s) => open.has(s))) continue;
    for (const d of rule.decls) if (flattens(d)) found.push(`${rule.selector} { ${d.join(": ")} }`);
    for (const [name] of animationsOf(rule, names)) {
      for (const k of keyframes.filter((each) => each.name === name)) {
        for (const step of k.steps) {
          for (const d of step.decls) {
            if (flattens(d))
              found.push(`${rule.selector}: ${name} ${step.offsets} { ${d.join(": ")} }`);
          }
        }
      }
    }
  }
  return found;
}

describe("the 3D rule: what keeps the 3D space open moves by transform alone", () => {
  it("catches each way an element is flattened, in its rule or its keyframes", () => {
    for (const d of [
      "opacity: 0.5",
      "overflow: hidden",
      "-webkit-mask-image: none",
      "mask-size: 4px",
      "clip-path: inset(0)",
      "filter: blur(1px)",
      "backdrop-filter: blur(1px)",
      "mix-blend-mode: multiply",
      "isolation: isolate",
      "contain: paint",
    ]) {
      expect(flatteners(`.a { transform-style: preserve-3d; ${d}; }`), d).toHaveLength(1);
      const keyed = `.a { transform-style: preserve-3d; animation: k 1s both; } @keyframes k { from { ${d}; } }`;
      expect(flatteners(keyed), d).toHaveLength(1);
    }
    expect(
      flatteners(`.a { transform-style: preserve-3d; } .a { overflow: hidden; }`)
    ).toHaveLength(1);
    const fine = `.a { transform-style: preserve-3d; opacity: 1; overflow: visible; isolation: auto; }`;
    expect(flatteners(fine)).toEqual([]);
  });

  it.each(INTRO_SHEETS)("holds in %s", (file) => {
    expect(flatteners(read(file))).toEqual([]);
  });

  it("keeps the book's 3D space open from the lift down to each sheet, and fades only the camera", () => {
    const { rules } = parse(read(BOOK));
    const open = rules
      .filter((r) => r.decls.some(([p, v]) => p === "transform-style" && v === "preserve-3d"))
      .map((r) => r.selector);
    expect(open).toEqual([".lift", ".push", ".glide", ".book", ".cover", ".leaf1", ".leaf2"]);
    // The camera sets the perspective, not preserve-3d, so its fade flattens nothing.
    const scene = rules.find((r) => r.selector === ".scene" && r.at.length === 0)!;
    expect(scene.decls.map(([p]) => p)).toEqual(
      expect.arrayContaining(["perspective", "animation"])
    );
    expect(scene.decls.some(([p]) => p === "transform-style")).toBe(false);
  });

  it("keeps the VIP book's 3D space open from its drop to its cover, and fades only the camera and the wrapper", () => {
    const { rules } = parse(read(VIP));
    const open = rules
      .filter((r) => r.decls.some(([p, v]) => p === "transform-style" && v === "preserve-3d"))
      .map((r) => r.selector);
    expect(open).toEqual([".bookDrop", ".bookCover"]);
    // The camera sets the perspective and the wrapper steps the book back:
    // neither keeps the 3D space open, so their fades flatten nothing.
    for (const selector of [".bookCamera", ".book"]) {
      const own = rules.filter((r) => r.selector === selector && r.at.length === 0);
      expect(own, selector).toHaveLength(1);
      expect(own[0].decls.some(([p]) => p === "transform-style")).toBe(false);
    }
    const camera = rules.find((r) => r.selector === ".bookCamera")!;
    expect(camera.decls.map(([p]) => p)).toEqual(
      expect.arrayContaining(["perspective", "animation"])
    );
  });

  it("holds the poster to it too: nothing there keeps a 3D space open", () => {
    const { rules } = parse(read(POSTER));
    expect(rules.filter((r) => r.decls.some(([p]) => p === "transform-style"))).toEqual([]);
  });
});

type Vec = Record<"%" | "rem" | "px", number>;

/** A length as so much %, rem and px: 0, -0.5rem, 100%, calc(100% + 0.5rem). */
function length(token: string): Vec {
  const v: Vec = { "%": 0, rem: 0, px: 0 };
  const inner = /^calc\((.*)\)$/.exec(token)?.[1] ?? token;
  for (const [, sign, n, unit] of Array.from(
    ` + ${inner}`.matchAll(/\s([+-])\s(-?[\d.]+)(%|rem|px)?/g)
  )) {
    v[(unit ?? "px") as keyof Vec] += (sign === "-" ? -1 : 1) * Number(n);
  }
  return v;
}

const add = (a: Vec, b: Vec, k = 1): Vec => ({
  "%": a["%"] + k * b["%"],
  rem: a.rem + k * b.rem,
  px: a.px + k * b.px,
});
const vecKey = (v: Vec) => [v["%"], v.rem, v.px].map((n) => n.toFixed(3)).join(" ");
const pointKey = (x: Vec, y: Vec) => `${vecKey(x)} | ${vecKey(y)}`;
const FULL = length("100%");

/** The corners a straight clip-path draws, as keys: inset() or polygon(). */
function corners(clip: string): string[] {
  const args = /^(inset|polygon)\((.*)\)$/.exec(clip);
  if (!args) throw new Error(`not a straight clip: ${clip}`);
  if (args[1] === "polygon") {
    return splitTop(args[2], ",").map((pair) => {
      const [x, y] = splitTop(pair, " ").map(length);
      return pointKey(x, y);
    });
  }
  const [t, r = t, b = t, l = r] = splitTop(args[2], " ").map(length);
  const right = add(FULL, r, -1);
  const bottom = add(FULL, b, -1);
  return [pointKey(l, t), pointKey(right, t), pointKey(right, bottom), pointKey(l, bottom)];
}

type Point = [x: Vec, y: Vec];

/**
 * Whether `c` lies on the straight edge from `a` to `b` for a box of any size:
 * the same fraction of the way along in every unit, on both axes.
 */
function onEdge(a: Point, b: Point, c: Point): boolean {
  const flat = (p: Point) => p.flatMap((v) => [v["%"], v.rem, v.px]);
  const [pa, pb, pc] = [flat(a), flat(b), flat(c)];
  const d = pb.map((v, i) => v - pa[i]);
  const k = d.findIndex((v) => Math.abs(v) > 1e-9);
  if (k === -1) return pc.every((v, i) => Math.abs(v - pa[i]) < 1e-6);
  const t = (pc[k] - pa[k]) / d[k];
  return t >= -1e-9 && t <= 1 + 1e-9 && pc.every((v, i) => Math.abs(v - pa[i] - t * d[i]) < 1e-6);
}

/**
 * A shape()'s points, as keys and as lengths, and whether each curve's control
 * lies on its own straight edge (so the shape draws only straight edges).
 */
function shapePoints(clip: string): { points: string[]; ends: Point[]; straight: boolean } {
  const args = /^shape\((.*)\)$/.exec(clip);
  if (!args) throw new Error(`not a shape(): ${clip}`);
  const points: string[] = [];
  const ends: Point[] = [];
  let straight = true;
  let last: Point | null = null;
  for (const command of splitTop(args[1], ",")) {
    const words = splitTop(command, " ");
    if (words[0] === "close") continue;
    const at = words[0] === "from" ? 1 : 2;
    const end: Point = [length(words[at]), length(words[at + 1])];
    if (words[0] === "curve") {
      const control: Point = [length(words[at + 3]), length(words[at + 4])];
      if (!onEdge(last!, end, control)) straight = false;
    }
    points.push(pointKey(end[0], end[1]));
    ends.push(end);
    last = end;
  }
  return { points, ends, straight };
}

/** A step's offsets as fractions: `from`, `0%, 12%`, `to` → [0], [0, 0.12], [1]. */
const offsetsOf = (offsets: string) =>
  offsets.split(/,\s*/).map((o) => (o === "from" ? 0 : o === "to" ? 1 : parseFloat(o) / 100));

/** The four numbers of the first cubic-bezier() in `value`. */
function bezierOf(value: string | undefined): number[] {
  const args = /cubic-bezier\(([^)]*)\)/.exec(value ?? "");
  if (!args) throw new Error(`no cubic-bezier in ${value}`);
  return args[1].split(",").map(Number);
}

/**
 * A curve cut in two at its middle (de Casteljau at t = 0.5): where the cut
 * falls in time and progress, and each half as a curve of its own from 0 to 1.
 */
function halves([x1, y1, x2, y2]: number[]) {
  const mx = (3 * x1 + 3 * x2 + 1) / 8;
  const my = (3 * y1 + 3 * y2 + 1) / 8;
  const left = [x1 / 2 / mx, y1 / 2 / my, (2 * x1 + x2) / 4 / mx, (2 * y1 + y2) / 4 / my];
  const right = [
    ((x1 + 2 * x2 + 1) / 4 - mx) / (1 - mx),
    ((y1 + 2 * y2 + 1) / 4 - my) / (1 - my),
    ((x2 + 1) / 2 - mx) / (1 - mx),
    ((y2 + 1) / 2 - my) / (1 - my),
  ];
  return { mx, my, left, right };
}

const stepEase = (step: Keyframes["steps"][number]) =>
  step.decls.find(([p]) => p === "animation-timing-function")?.[1];

const clipOf = (step: Keyframes["steps"][number]) =>
  step.decls.find(([p]) => p === "clip-path")?.[1];

describe("the ink wipes", () => {
  it.each(SCENES)("clip with inset() or polygon() only, outside @supports, in %s", (file) => {
    const { rules, keyframes } = parse(read(file));
    const unguarded = (at: string[]) => at.every((a) => !a.startsWith("@supports"));
    const outside = [
      ...rules.filter((r) => unguarded(r.at)).flatMap((r) => r.decls),
      ...keyframes.filter((k) => unguarded(k.at)).flatMap((k) => k.steps.flatMap((s) => s.decls)),
    ];
    for (const [p, v] of outside) {
      if (p === "clip-path") expect(v, file).toMatch(/^(?:inset|polygon)\(|^none$/);
    }
    // shape() is only ever behind its own @supports.
    for (const k of keyframes) {
      if (k.steps.some((s) => /shape\(/.test(clipOf(s) ?? ""))) {
        expect(
          k.at.some((a) => /^@supports \(clip-path: shape\(/.test(a)),
          k.name
        ).toBe(true);
      }
    }
  });

  it.each(SCENES)("name every clip-path wipe in %s as bowed or kept straight", (file) => {
    const { keyframes } = parse(read(file));
    const wipes = keyframes
      .filter((k) => k.at.length === 0 && k.steps.some((s) => clipOf(s) !== undefined))
      .map((k) => k.name);
    expect(wipes.slice().sort()).toEqual([...WIPES[file].bowed, ...WIPES[file].straight].sort());
  });

  it.each(SCENES)(
    "give every ink wipe in %s a bowed twin: its own name, the same shorthand, the same first and last frames",
    (file) => {
      const { rules, keyframes } = parse(read(file));
      const names = new Set(keyframes.map((k) => k.name));
      const wipes = keyframes.filter(
        (k) =>
          k.at.length === 0 &&
          k.steps.some((s) => clipOf(s) !== undefined) &&
          WIPES[file].bowed.includes(k.name)
      );
      expect(wipes.map((k) => k.name)).toEqual(WIPES[file].bowed);
      for (const wipe of wipes) {
        const users = rules.filter(
          (r) => r.at.length === 0 && animationsOf(r, names).some(([n]) => n === wipe.name)
        );
        expect(users.length, wipe.name).toBeGreaterThan(0);
        for (const user of users) {
          const [, straight] = animationsOf(user, names).find(([n]) => n === wipe.name)!;
          const twinRule = rules.find(
            (r) =>
              r.selector === user.selector &&
              r.at.length === 1 &&
              /^@supports \(clip-path: shape\(/.test(r.at[0])
          );
          expect(twinRule, `${user.selector}: a rule inside @supports for shape()`).toBeDefined();
          const [[twinName, bowed]] = animationsOf(twinRule!, names);
          expect(twinName).not.toBe(wipe.name);
          // The whole shorthand again, with only the name changed.
          expect(bowed).toBe(straight.replace(wipe.name, twinName));
          const twin = keyframes.find((k) => k.name === twinName)!;
          expect(twin.at).toEqual(twinRule!.at);
          const clips = twin.steps.map((s) => clipOf(s)!);
          expect(
            clips.every((c) => /^shape\(/.test(c)),
            twinName
          ).toBe(true);
          for (const end of [0, -1]) {
            const shape = shapePoints(clips.at(end)!);
            expect(shape.straight, `${twinName} at ${end}: a straight edge`).toBe(true);
            expect(shape.points.slice().sort()).toEqual(
              corners(clipOf(wipe.steps.at(end)!)!)
                .slice()
                .sort()
            );
          }
          // And somewhere between, it bows.
          expect(
            clips.slice(1, -1).some((c) => !shapePoints(c).straight),
            twinName
          ).toBe(true);

          // At the straight wipe's pace. That wipe moves on its shorthand's
          // curve alone (its steps set none); the twin cuts that curve in two
          // at its middle, so its one middle step comes when the straight
          // wipe is halfway along the curve, with every point that far on its
          // way, and each half keeps its half of the curve.
          expect(wipe.steps, wipe.name).toHaveLength(2);
          expect(
            wipe.steps.every((s) => stepEase(s) === undefined),
            wipe.name
          ).toBe(true);
          const { mx, my, left, right } = halves(bezierOf(straight));
          const start = Math.max(...offsetsOf(wipe.steps[0].offsets));
          expect(twin.steps, twinName).toHaveLength(3);
          const [first, middle, last] = twin.steps;
          expect(first.offsets).toBe(wipe.steps[0].offsets);
          expect(offsetsOf(middle.offsets)).toEqual([expect.closeTo(start + (1 - start) * mx, 3)]);
          expect(offsetsOf(last.offsets)).toEqual([1]);
          bezierOf(stepEase(first)).forEach((v, i) => expect(v, twinName).toBeCloseTo(left[i], 3));
          bezierOf(stepEase(middle)).forEach((v, i) =>
            expect(v, twinName).toBeCloseTo(right[i], 3)
          );
          const [a, m, b] = [first, middle, last].map((s) => shapePoints(clipOf(s)!).ends);
          expect(m).toHaveLength(a.length);
          m.forEach((point, k) =>
            point.forEach((axis, xy) => {
              for (const unit of ["%", "rem", "px"] as const) {
                const want = a[k][xy][unit] + my * (b[k][xy][unit] - a[k][xy][unit]);
                expect(axis[unit], `${twinName} point ${k}`).toBeCloseTo(want, 2);
              }
            })
          );
        }
      }
    }
  );
});
