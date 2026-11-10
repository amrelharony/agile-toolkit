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

const DIR = "src/app/(tools)/comics/components/intro";
const LOOK = `${DIR}/intro-look.module.css`;

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
    let masks = 0;
    for (const rule of look.rules) {
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
    expect(masks).toBeGreaterThanOrEqual(3);
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
