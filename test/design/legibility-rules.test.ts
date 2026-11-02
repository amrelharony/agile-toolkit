// @vitest-environment node
/**
 * Rules that keep things readable on the comic's paper and can't be read off the
 * tokens alone: what marks a link, what marks a focused field, and which raw
 * colours may reach the page as words. These scan the source because they are
 * about where a class or a hex is used, in code that only renders behind data.
 */
import { readFileSync, readdirSync, statSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { WMO_CODES, temperatureColor } from "@/lib/weather/wmo";
import { IDENTITY_INK, SQUAD_COLORS } from "@/lib/squads/colors";
import { themed } from "@/lib/utils/theme-color";

const SRC = path.resolve(__dirname, "../../src");

function read(rel: string): string {
  return readFileSync(path.join(SRC, rel), "utf8");
}

function walk(dir: string, out: string[] = []): string[] {
  for (const name of readdirSync(dir)) {
    const full = path.join(dir, name);
    if (statSync(full).isDirectory()) walk(full, out);
    else if (name.endsWith(".tsx")) out.push(full);
  }
  return out;
}

const SOURCES = walk(SRC).map((file) => ({
  file: path.relative(SRC, file).replace(/\\/g, "/"),
  text: readFileSync(file, "utf8"),
}));

const CSS = read("app/globals.css").replace(/\/\*[\s\S]*?\*\//g, "");

function luminance(value: string): number {
  const [r, g, b] = [1, 3, 5].map((i) => {
    const s = parseInt(value.slice(i, i + 2), 16) / 255;
    return s <= 0.04045 ? s / 12.92 : ((s + 0.055) / 1.055) ** 2.4;
  });
  return 0.2126 * r + 0.7152 * g + 0.0722 * b;
}

function contrast(a: string, b: string): number {
  const [hi, lo] = [luminance(a), luminance(b)].sort((x, y) => y - x);
  return (hi + 0.05) / (lo + 0.05);
}

describe("links", () => {
  it("underlines inline links at rest in every mode, not only high contrast", () => {
    const rule = CSS.match(/([^{}]*)\{\s*text-decoration-line: underline;/)?.[1] ?? "";
    expect(rule).toContain(":where(p, dd, figcaption) a");
    expect(rule).toContain("a:where(.hover\\:underline)");
    expect(rule).not.toMatch(/\.hc|data-theme/);
  });

  it("gives every text-coloured link something besides its colour", () => {
    // Accent, primary and info sit at almost the lightness of muted text. A link in
    // one of them needs hover:underline (which the rule above turns into a resting
    // underline), a plain underline, or the frame of a pill or a nav item.
    const link = /<(?:Link|a)\b[^>]*?className="([^"]*)"/g;
    const bare: string[] = [];
    for (const { file, text } of SOURCES) {
      for (const m of Array.from(text.matchAll(link))) {
        const classes = m[1].split(/\s+/);
        if (!classes.some((c) => /^text-(accent|primary|info)$/.test(c))) continue;
        const marked = classes.some((c) => c === "underline" || c === "hover:underline");
        const framed = classes.some((c) => /^(border|rounded|bg-|block$)/.test(c));
        if (!marked && !framed) bare.push(`${file}: ${m[1]}`);
      }
    }
    expect(bare).toEqual([]);
  });
});

describe("field focus", () => {
  it("draws a ring outside the edge of every field, whatever classes it carries", () => {
    const rule = CSS.match(
      /([^{}]*:focus-visible)\s*\{\s*outline: 2px solid var\(--ring\) !important;/
    );
    expect(rule?.[1]).toContain('[role="combobox"]');
    expect(rule?.[1]).toContain("textarea");
    expect(rule?.[1]).not.toMatch(/\.hc|data-theme/);
  });
});

describe("chart chrome", () => {
  it("leaves no chart with a fixed tooltip ground or tick colour", () => {
    // A hex here is one theme's answer: Insights kept a near-black tooltip whose
    // label inherited the page's ink, 1.1:1 on the paper.
    const fixed =
      /contentStyle=\{\{[^}]*background(Color)?: "#|tick=\{\{ fill: "#|cursor=\{\{ (fill|stroke): "#/;
    const found = SOURCES.filter(({ text }) => fixed.test(text)).map(({ file }) => file);
    expect(found).toEqual([]);
  });
});

describe("identity colours", () => {
  it("keeps the fixed ink at AA on every colour a person can have", () => {
    for (const colour of SQUAD_COLORS) {
      expect(contrast(IDENTITY_INK, colour), colour).toBeGreaterThanOrEqual(4.5);
    }
  });

  it("never prints on an identity fill in a page token, or a name in the raw colour", () => {
    const avatars = [
      "components/shared/multiplayer-chip.tsx",
      "app/(guest)/guest/guest-home-client.tsx",
    ];
    for (const file of avatars) {
      expect(read(file), file).toContain("IDENTITY_INK");
      expect(read(file), file).not.toMatch(/text-bg\b/);
    }
    const nameAsColour = /style=\{\{\s*color: (profile|m|member|session)\.color/;
    // A Canvas board is a dark stage, and its cursors carry their own ink.
    const found = SOURCES.filter(
      ({ file, text }) => !file.startsWith("app/(tools)/canvas/") && nameAsColour.test(text)
    ).map(({ file }) => file);
    expect(found).toEqual([]);
  });
});

describe("weather", () => {
  it("maps every colour the widget can show onto a theme token", () => {
    const colours = [
      ...Object.values(WMO_CODES).map((info) => info.color),
      ...[0, 10, 20, 30, 40].map(temperatureColor),
    ];
    for (const colour of colours) expect(themed(colour), colour).toMatch(/^var\(--/);
  });

  it("prints the temperature in page text, with the colour on the icon only", () => {
    const widget = read("lib/weather/widget.tsx");
    expect(widget).toMatch(/className="tabular-nums text-text"/);
    expect(widget).toContain("themed(resolveAccent(");
  });
});

describe("Amr's phone strip", () => {
  it("keeps Canvas's AI Insights panel clear of it, at either end of the screen", () => {
    // Same z-index as the strip, which is mounted later and would paint over it.
    const panel = read("app/(tools)/canvas/components/ai-insights-panel.tsx");
    expect(panel).toContain("bottom-[calc(0.75rem+var(--amr-band-bottom,0px))]");
    expect(panel).toContain("top-[calc(5rem+var(--amr-band-top,0px))]");
  });
});
