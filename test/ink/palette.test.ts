/**
 * The link-preview images can't read CSS, so COMIC_PALETTE carries the Comic
 * theme's colours as hex. This keeps it equal to globals.css's `.light` block,
 * so a token change reaches the previews too.
 */
import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import path from "node:path";
import { COMIC_PAGE, COMIC_PALETTE, TONE_TOKEN } from "@/lib/ink/palette";
import { drawingToSvg } from "@/lib/ink/svg-string";
import { INK_TONES, TONE_VAR } from "@/lib/ink/types";
import { SECTION_ART } from "@/lib/ink/drawings/sections";

const css = readFileSync(path.join(process.cwd(), "src/app/globals.css"), "utf8");
const at = css.indexOf('[data-theme="light"] {');
const light = css.slice(at, css.indexOf("}", at));
const token = (name: string) => light.match(new RegExp(`${name}:\\s*(#[0-9a-f]{6})`, "i"))?.[1];

describe("COMIC_PALETTE", () => {
  it.each(INK_TONES.map((t) => [t] as const))("%s equals its Comic token", (tone) => {
    expect(TONE_VAR[tone]).toBe(`var(${TONE_TOKEN[tone]})`);
    expect(COMIC_PALETTE[tone].toLowerCase()).toBe(token(TONE_TOKEN[tone]));
  });

  it("keeps the page's paper and ink equal to the Comic tokens", () => {
    expect(COMIC_PAGE.bg).toBe(token("--bg"));
    expect(COMIC_PAGE.border).toBe(token("--border"));
  });
});

describe("drawingToSvg", () => {
  it("writes a standalone, still SVG with the palette's colours", () => {
    const svg = drawingToSvg(SECTION_ART.plan, COMIC_PALETTE, 200);
    expect(svg).toMatch(/^<svg xmlns="http:\/\/www\.w3\.org\/2000\/svg" viewBox="0 0 96 96"/);
    expect(svg).toContain(`stroke="${COMIC_PALETTE.ink}"`);
    expect(svg).toContain(`fill="${COMIC_PALETTE.warning}" fill-opacity="0.22"`);
    expect(svg).not.toMatch(/var\(|class=|filter|animation/);
  });
});
