// @vitest-environment node
/**
 * Status and accent colours sit on tints of themselves all over the app:
 * `bg-accent/10 text-accent` (the toolkit button, the Next step eyebrow),
 * `bg-warning/10 text-warning` badges, selected and hover states up to /20.
 * A tint is `color-mix(in srgb, var(--x) N%, transparent)` (see
 * tailwind.config.ts), so over an opaque surface it paints
 * N% · x + (1 − N%) · surface.
 *
 * This parses the light theme from globals.css, composites every such text
 * colour on its own 0–20% tint over each opaque surface a tint lands on, and
 * holds it to WCAG AA for normal text (4.5:1). The light theme's #0066ff,
 * #b45309 and #15803d fell to 3.5–4.4:1 here. scripts/check-ui-classes.mjs
 * keeps call sites at /20 or less.
 */
import { readFileSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";

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

const light = { ...block(":root"), ...block('[data-theme="light"]') };

type Rgb = [number, number, number];

function hex(value: string): Rgb {
  const m = value.match(/^#([0-9a-f]{6})$/i);
  if (!m) throw new Error(`expected a 6-digit hex colour, got ${value}`);
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
  "accent", // also accent-cyan, primary
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
const SURFACES = ["card", "bg", "surface-deep"];
const TINTS = [0, 0.05, 0.1, 0.15, 0.2];
const AA = 4.5;

describe("light theme text on its own tint", () => {
  it("meets WCAG AA for every tinted text colour", () => {
    const failures: string[] = [];
    for (const token of TEXT_TOKENS) {
      const text = hex(light[token]);
      for (const surface of SURFACES) {
        for (const amount of TINTS) {
          const ratio = contrast(text, tint(text, hex(light[surface]), amount));
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

  it("keeps the chart colours on the tokens they stand in for", () => {
    expect(light["chart-1"]).toBe(light.accent);
    expect(light["chart-2"]).toBe(light["neon-magenta"]);
    expect(light["chart-3"]).toBe(light["neon-green"]);
    expect(light["chart-4"]).toBe(light["neon-amber"]);
  });

  it("composites like the browser", () => {
    // The light theme's old #0066ff on bg-accent/10 over white, measured at
    // about 4.2:1 in the Phase 7 browser pass.
    const old = hex("#0066ff");
    expect(contrast(old, tint(old, hex("#ffffff"), 0.1))).toBeCloseTo(4.19, 2);
  });
});
