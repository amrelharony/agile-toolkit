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

/**
 * The VIEW TRANSITIONS block, minified the way the build writes it (attribute
 * quotes dropped, 240ms as .24s): F2's held layers, and T1's page cross-fade,
 * which every block below carries unless a T1 case leaves it out.
 */
const HELD = ["header", "amr", "amr-bubble", "amr-panel", "dock-timer"];
const each = (pseudo: string, names = HELD) =>
  names.map((n) => `::view-transition-${pseudo}(${n})`).join(",");
const READY = "html{--vt-ready:1}";
const NAMES = HELD.map((n) => `html[data-vt] [data-vt-hold=${n}]{view-transition-name:${n}}`).join(
  ""
);
const HOLD = `${each("group")}{animation:none}${each("old")}{display:none}${each("new")}{animation:none;opacity:1;mix-blend-mode:normal}`;
const STACK = `::view-transition-group(header){z-index:2}${each("group", HELD.slice(1))}{z-index:3}`;
const TAPS = "::view-transition{pointer-events:none}";
const CALM =
  "@media (prefers-reduced-motion:reduce){::view-transition-group(*),::view-transition-image-pair(*),::view-transition-old(*),::view-transition-new(*){animation:none!important}}";
const FADE_ON = ["group", "old", "new"].map(
  (p) => `html[data-vt=page]::view-transition-${p}(root)`
);
const FADE = `${FADE_ON.join(",")}{animation-duration:.24s}`;
const bareVtBlock = (inner: string) =>
  `@supports (view-transition-name:none){@media screen{${inner}}}`;
const vtBlock = (inner: string) => bareVtBlock(inner + FADE);
const VT = vtBlock(READY + NAMES + HOLD + STACK + TAPS + CALM);

const F2_HELD = MARKERS.F2[0].name;
const F2_READY = MARKERS.F2[1].name;
const F2_CALM = MARKERS.F2[3].name;

function failing(...sheets: string[]): string[] {
  return checkMarkers(sheets.map(stripWhitespace))
    .filter((r: { ok: boolean }) => !r.ok)
    .map((r: { name: string }) => r.name);
}

describe("check-built-css", () => {
  it("lists each PR's markers", () => {
    expect(Object.keys(MARKERS)).toEqual(["F1", "F2", "T1"]);
    expect(MARKERS.F1).toHaveLength(5);
    expect(MARKERS.F2).toHaveLength(4);
    expect(MARKERS.T1).toHaveLength(1);
  });

  it("finds every marker in globals.css as written", () => {
    expect(failing(globals)).toEqual([]);
  });

  it("finds every marker in a minified sheet that keeps them", () => {
    expect(failing(FALLBACK + LINEAR + GRAIN + OFF + VT)).toEqual([]);
  });

  it("flags linear() that comes before its fallback, or outside @supports", () => {
    expect(failing(LINEAR + FALLBACK + GRAIN + OFF + VT)).toHaveLength(2);
    const unguarded = ":root{--ease-settle:linear(0,1.08,1);--ease-pop:linear(0,1.16,1)}";
    expect(failing(FALLBACK + unguarded + GRAIN + OFF + VT)).toHaveLength(2);
    expect(failing(LINEAR + GRAIN + OFF + VT)).toHaveLength(2);
  });

  it("flags a grain rule that lost a layer or its selector, and a missing removal", () => {
    const oneLayer = `html.light body{background-image:${TILE}}html.dark body{background-image:${TILE},${TILE}}`;
    expect(failing(FALLBACK + LINEAR + oneLayer + OFF + VT)).toEqual([
      "paper grain: two url(data:image/svg+xml) layers on html.light body",
    ]);
    expect(failing(FALLBACK + LINEAR + GRAIN + VT)).toEqual([
      "paper grain: removed for print, forced colours and more contrast",
    ]);
  });

  it("passes a marker found in any one of several files", () => {
    expect(failing(FALLBACK + LINEAR, GRAIN + OFF, VT)).toEqual([]);
  });
});

describe("check-built-css: F2's held layers", () => {
  const F1 = FALLBACK + LINEAR + GRAIN + OFF;

  it("lists every F2 marker as missing without the VIEW TRANSITIONS block", () => {
    expect(failing(F1)).toEqual(
      [...MARKERS.F2, ...MARKERS.T1].map((m: { name: string }) => m.name)
    );
  });

  it("reads the held names with or without quotes", () => {
    const quoted = NAMES.replace(/hold=([a-z-]+)\]/g, 'hold="$1"]');
    expect(quoted).not.toBe(NAMES);
    expect(failing(F1 + vtBlock(READY + quoted + HOLD + STACK + TAPS + CALM))).toEqual([]);
  });

  it("flags a held name given outside html[data-vt] or outside @media screen", () => {
    const always = NAMES.replace(/html\[data-vt\] /g, "");
    expect(failing(F1 + vtBlock(READY + always + HOLD + STACK + TAPS + CALM))).toEqual([F2_HELD]);
    const unscreened = `@supports (view-transition-name:none){${NAMES}}`;
    expect(failing(F1 + unscreened + vtBlock(READY + HOLD + STACK + TAPS + CALM))).toEqual([
      F2_HELD,
    ]);
  });

  it("flags a held group that lost its order, or an old picture still drawn", () => {
    const flat = STACK.replace("z-index:2", "z-index:3");
    expect(failing(F1 + vtBlock(READY + NAMES + HOLD + flat + TAPS + CALM))).toEqual([F2_HELD]);
    const drawn = HOLD.replace("{display:none}", "{opacity:0}");
    expect(failing(F1 + vtBlock(READY + NAMES + drawn + STACK + TAPS + CALM))).toEqual([F2_HELD]);
  });

  it("flags --vt-ready outside the screen block, or missing", () => {
    const outside = `@supports (view-transition-name:none){${READY}}`;
    expect(failing(F1 + outside + vtBlock(NAMES + HOLD + STACK + TAPS + CALM))).toEqual([F2_READY]);
    expect(failing(F1 + READY + vtBlock(NAMES + HOLD + STACK + TAPS + CALM))).toEqual([F2_READY]);
  });

  it("flags a reduced-motion rule that lost !important or left the block", () => {
    const soft = CALM.replace("!important", "");
    expect(failing(F1 + vtBlock(READY + NAMES + HOLD + STACK + TAPS + soft))).toEqual([F2_CALM]);
    expect(failing(F1 + CALM + vtBlock(READY + NAMES + HOLD + STACK + TAPS))).toEqual([F2_CALM]);
  });
});

describe("check-built-css: T1's page cross-fade", () => {
  const F1 = FALLBACK + LINEAR + GRAIN + OFF;
  const F2 = READY + NAMES + HOLD + STACK + TAPS + CALM;
  const T1_FADE = MARKERS.T1[0].name;

  it("reads the duration as written or as the minifier writes it, quotes or not", () => {
    expect(failing(F1 + bareVtBlock(F2 + FADE))).toEqual([]);
    expect(failing(F1 + bareVtBlock(F2 + FADE.replace(".24s", "240ms")))).toEqual([]);
    const quoted = FADE.replace(/data-vt=page/g, 'data-vt="page"');
    expect(failing(F1 + bareVtBlock(F2 + quoted))).toEqual([]);
  });

  it("flags a fade that is missing, retimed, unscoped, partial or outside the screen block", () => {
    expect(failing(F1 + bareVtBlock(F2))).toEqual([T1_FADE]);
    expect(failing(F1 + bareVtBlock(F2 + FADE.replace(".24s", ".25s")))).toEqual([T1_FADE]);
    const unscoped = FADE.replace(/html\[data-vt=page\]/g, "");
    expect(failing(F1 + bareVtBlock(F2 + unscoped))).toEqual([T1_FADE]);
    const onePicture = "html[data-vt=page]::view-transition-old(root){animation-duration:.24s}";
    expect(failing(F1 + bareVtBlock(F2 + onePicture))).toEqual([T1_FADE]);
    expect(failing(F1 + FADE + bareVtBlock(F2))).toEqual([T1_FADE]);
  });
});
