// @vitest-environment node
/**
 * scripts/check-built-css.mjs reads the minified build; this holds its markers
 * to what they claim, on hand-written sheets and on globals.css itself.
 */
import { readFileSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { MARKERS, checkMarkers, stripWhitespace } from "../../scripts/check-built-css.mjs";

const globals = stripWhitespace(
  readFileSync(path.join(process.cwd(), "src/app/globals.css"), "utf8").replace(
    /\/\*[\s\S]*?\*\//g,
    ""
  )
);

const TILE = `url("data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg'%3E%3C/svg%3E")`;
const FALLBACK =
  ":root{--ease-settle:cubic-bezier(0.42,1.52,0.1,1);--ease-pop:cubic-bezier(0.38,1.76,0.1,1)}";
const LINEAR =
  "@supports(transition-timing-function:linear(0,1)){:root{--ease-settle:linear(0,1.08,1);--ease-pop:linear(0,1.16,1)}}";
const GRAIN = `html.light body{background-image:${TILE},${TILE}}html.dark body{background-image:${TILE},${TILE}}`;
const OFF =
  "@media print,(forced-colors:active),(prefers-contrast:more){html.light body,html.dark body{background-image:none}}";

function failing(...sheets: string[]): string[] {
  return checkMarkers(sheets.map(stripWhitespace))
    .filter((r: { ok: boolean }) => !r.ok)
    .map((r: { name: string }) => r.name);
}

describe("check-built-css", () => {
  it("lists F1's markers", () => {
    expect(Object.keys(MARKERS)).toEqual(["F1"]);
    expect(MARKERS.F1).toHaveLength(5);
  });

  it("finds every marker in globals.css as written", () => {
    expect(failing(globals)).toEqual([]);
  });

  it("finds every marker in a minified sheet that keeps them", () => {
    expect(failing(FALLBACK + LINEAR + GRAIN + OFF)).toEqual([]);
  });

  it("flags linear() that comes before its fallback, or outside @supports", () => {
    expect(failing(LINEAR + FALLBACK + GRAIN + OFF)).toHaveLength(2);
    const unguarded = ":root{--ease-settle:linear(0,1.08,1);--ease-pop:linear(0,1.16,1)}";
    expect(failing(FALLBACK + unguarded + GRAIN + OFF)).toHaveLength(2);
    expect(failing(LINEAR + GRAIN + OFF)).toHaveLength(2);
  });

  it("flags a grain rule that lost a layer or its selector, and a missing removal", () => {
    const oneLayer = `html.light body{background-image:${TILE}}html.dark body{background-image:${TILE},${TILE}}`;
    expect(failing(FALLBACK + LINEAR + oneLayer + OFF)).toEqual([
      "paper grain: two url(data:image/svg+xml) layers on html.light body",
    ]);
    expect(failing(FALLBACK + LINEAR + GRAIN)).toEqual([
      "paper grain: removed for print, forced colours and more contrast",
    ]);
  });

  it("passes a marker found in any one of several files", () => {
    expect(failing(FALLBACK + LINEAR, GRAIN + OFF)).toEqual([]);
  });
});
