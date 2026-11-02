// @vitest-environment node
/**
 * Status and accent colours sit on tints of themselves all over the app:
 * `bg-accent/10 text-accent` (the toolkit button, the Next step eyebrow),
 * `bg-warning/10 text-warning` badges, selected and hover states up to /20.
 * A tint is `color-mix(in srgb, var(--x) N%, transparent)` (see
 * tailwind.config.ts), so over an opaque surface it paints
 * N% · x + (1 − N%) · surface.
 *
 * This parses all three themes from globals.css (comic, night comic, high
 * contrast), composites every such text colour on its own 0–20% tint over each
 * opaque surface a tint lands on, and holds it to WCAG AA for normal text
 * (4.5:1). scripts/check-ui-classes.mjs keeps call sites at /20 or less.
 */
import { readFileSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { FACES } from "@/app/(tools)/mood-tracker/faces";
import { SEVERITY_SCALE } from "@/lib/utils/severity-color";

const css = readFileSync(path.resolve(__dirname, "../../src/app/globals.css"), "utf8").replace(
  /\/\*[\s\S]*?\*\//g,
  ""
);

function block(selector: string): Record<string, string> {
  const escaped = selector.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  const match = css.match(new RegExp(`${escaped}\\s*\\{([^}]*)\\}`));
  if (!match) throw new Error(`no ${selector} block in globals.css`);
  return Object.fromEntries(
    Array.from(match[1].matchAll(/--([\w-]+):\s*([^;]+);/g), (m) => [m[1], m[2].trim()])
  );
}

const night = block(":root");
const THEMES: [string, Record<string, string>][] = [
  ["comic", { ...night, ...block('[data-theme="light"]') }],
  ["night", night],
  ["high contrast", { ...night, ...block('[data-theme="hc"]') }],
];

type Rgb = [number, number, number];

function hex(theme: Record<string, string>, token: string): Rgb {
  let value = theme[token];
  for (let m = value?.match(/^var\(--([\w-]+)\)$/); m; m = value.match(/^var\(--([\w-]+)\)$/)) {
    value = theme[m[1]];
  }
  const m = value?.match(/^#([0-9a-f]{6})$/i);
  if (!m) throw new Error(`--${token}: expected a 6-digit hex colour, got ${value}`);
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

function tint(colour: Rgb, over: Rgb, amount: number): Rgb {
  return colour.map((c, i) => c * amount + over[i] * (1 - amount)) as Rgb;
}

/** Tokens used as text on a tint of themselves (`text-X` with `bg-X/N`). */
const TEXT_TOKENS = [
  "text",
  "accent", // also accent-cyan, primary
  "accent2",
  "accent3",
  "success", // also status-green
  "warning", // also status-yellow
  "danger", // also error, status-red
  "destructive",
  "info",
  "neon-green", // accent-green
  "neon-amber", // accent-amber
  "neon-magenta", // accent-magenta
];
/** The opaque surfaces tints are laid on. */
const SURFACES = ["card", "bg", "surface", "surface-deep"];
const TINTS = [0, 0.05, 0.1, 0.15, 0.2];
const AA = 4.5;
const NON_TEXT = 3;

describe.each(THEMES)("%s theme", (_name, theme) => {
  it("keeps text, accent and status colours at AA on their own tints", () => {
    const failures: string[] = [];
    for (const token of TEXT_TOKENS) {
      const text = hex(theme, token);
      for (const surface of SURFACES) {
        for (const amount of TINTS) {
          const ratio = contrast(text, tint(text, hex(theme, surface), amount));
          if (ratio < AA) {
            failures.push(
              `text-${token} on bg-${token}/${Math.round(amount * 100)} over --${surface}: ${ratio.toFixed(2)}:1`
            );
          }
        }
      }
    }
    expect(failures).toEqual([]);
  });

  it("keeps muted text at AA on every surface", () => {
    for (const surface of [...SURFACES, "surface-hover"]) {
      expect(contrast(hex(theme, "sub"), hex(theme, surface))).toBeGreaterThanOrEqual(AA);
    }
  });

  it("keeps words on solid fills at AA", () => {
    expect(
      contrast(hex(theme, "primary-foreground"), hex(theme, "primary"))
    ).toBeGreaterThanOrEqual(AA);
    expect(
      contrast(hex(theme, "destructive-foreground"), hex(theme, "destructive"))
    ).toBeGreaterThanOrEqual(AA);
  });

  it("draws outlines and field edges at 3:1 or better", () => {
    for (const line of ["border", "input"]) {
      for (const surface of SURFACES) {
        expect(contrast(hex(theme, line), hex(theme, surface))).toBeGreaterThanOrEqual(NON_TEXT);
      }
    }
  });

  it("gives every chart series a distinct colour that reads on the paper", () => {
    const series = ["chart-1", "chart-2", "chart-3", "chart-4", "chart-5"];
    for (const token of series) {
      for (const surface of ["bg", "card", "surface"]) {
        expect(contrast(hex(theme, token), hex(theme, surface))).toBeGreaterThanOrEqual(NON_TEXT);
      }
    }
    expect(new Set(series.map((t) => theme[t])).size).toBe(series.length);
  });

  it("keeps the words on a mood face at AA, however the fill is mixed", () => {
    const failures: string[] = [];
    for (const face of FACES) {
      const [, fill, pct] = face.bg.match(/^bg-([\w-]+?)(?:\/(\d+))?$/) ?? [];
      const [, words] = face.text.match(/^text-([\w-]+)$/) ?? [];
      const amount = pct ? Number(pct) / 100 : 1;
      for (const surface of SURFACES) {
        const ratio = contrast(
          hex(theme, words),
          tint(hex(theme, fill), hex(theme, surface), amount)
        );
        if (ratio < AA) failures.push(`${face.label} over --${surface}: ${ratio.toFixed(2)}:1`);
      }
    }
    expect(failures).toEqual([]);
  });

  it("keeps Sprint Compare's scores and sprint names at AA", () => {
    // ScoreCell: page text on a tint up to 25% (a 10), muted text up to 15% (a 6),
    // over a card or a hovered row. Names and averages print in the series colour.
    const failures: string[] = [];
    for (const token of ["chart-1", "chart-2", "chart-3", "chart-4", "chart-5"]) {
      const series = hex(theme, token);
      for (const surface of ["card", "cardH"]) {
        const ground = hex(theme, surface);
        const pairs: [string, number][] = [
          [`text on ${token}/25`, contrast(hex(theme, "text"), tint(series, ground, 0.25))],
          [`sub on ${token}/15`, contrast(hex(theme, "sub"), tint(series, ground, 0.15))],
          [`${token} as text`, contrast(series, ground)],
        ];
        for (const [what, ratio] of pairs) {
          if (ratio < AA) failures.push(`${what} over --${surface}: ${ratio.toFixed(2)}:1`);
        }
      }
    }
    expect(failures).toEqual([]);
  });

  it("gives severities four colours that can't be mistaken for each other", () => {
    const tokens = Object.values(SEVERITY_SCALE).map(
      (v) => v.match(/^var\(--([\w-]+),/)?.[1] ?? ""
    );
    // Readable as labels on their own tints: the first test holds these.
    for (const token of tokens) expect(TEXT_TOKENS).toContain(token);
    const colours = tokens.map((t) => hex(theme, t));
    for (let i = 0; i < colours.length; i++) {
      for (let j = i + 1; j < colours.length; j++) {
        const distance = Math.hypot(...colours[i].map((c, k) => c - colours[j][k]));
        expect(distance, `${tokens[i]} vs ${tokens[j]}`).toBeGreaterThanOrEqual(50);
      }
    }
  });

  it("draws the focus ring at 3:1 or better on everything it lands on", () => {
    for (const surface of [...SURFACES, "cardH"]) {
      expect(contrast(hex(theme, "ring"), hex(theme, surface))).toBeGreaterThanOrEqual(NON_TEXT);
    }
  });
});

it("composites like the browser", () => {
  // The old light theme's #0066ff on bg-accent/10 over white, measured at about
  // 4.2:1 in the Phase 7 browser pass.
  const old: Rgb = [0, 102, 255];
  expect(contrast(old, tint(old, [255, 255, 255], 0.1))).toBeCloseTo(4.19, 2);
});
