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

/** F2's VIEW TRANSITIONS block, minified the way the build writes it (attribute quotes dropped). */
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
const vtBlock = (inner: string) => `@supports (view-transition-name:none){@media screen{${inner}}}`;
const VT = vtBlock(READY + NAMES + HOLD + STACK + TAPS + CALM);

/**
 * The chat strip's rules (AMR), minified the way the build writes them: one colon
 * before before/after, no quotes, no leading zeros, the forced-colours pair reordered.
 */
const RIGHT =
  ".balloon[data-tail=right]:before,[data-amr-side=right] .balloon[data-tail=amr]:before{left:auto;right:-.8rem;border-width:.4rem 0 .4rem .8rem;border-color:transparent transparent transparent var(--border)}" +
  ".balloon[data-tail=right]:after,[data-amr-side=right] .balloon[data-tail=amr]:after{left:auto;right:-.6rem;border-width:.3rem 0 .3rem .65rem;border-color:transparent transparent transparent var(--balloon-fill)}";
const TOP =
  ".balloon[data-tail-from=top]:before,[data-amr-edge=top] .balloon[data-tail=amr]:before{top:var(--tail-at);bottom:auto}" +
  ".balloon[data-tail-from=top]:after,[data-amr-edge=top] .balloon[data-tail=amr]:after{top:calc(var(--tail-at) + .1rem);bottom:auto}";
const YOU =
  ".comic-caption[data-voice=you]{background-color:var(--surface);border:var(--line-w) solid var(--border)}";
const WASH =
  "@supports (background-color:color-mix(in srgb,red 50%,blue)){.comic-caption[data-voice=you]{background-color:color-mix(in srgb,var(--accent2) 14%,var(--card))}}";
const TAILS_OFF = "@media (forced-colors:active){.balloon:after,.balloon:before{display:none}}";
const AMR = RIGHT + TOP + YOU + WASH + TAILS_OFF;

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
    expect(Object.keys(MARKERS)).toEqual(["F1", "F2", "AMR"]);
    expect(MARKERS.F1).toHaveLength(5);
    expect(MARKERS.F2).toHaveLength(4);
    expect(MARKERS.AMR).toHaveLength(4);
  });

  it("finds every marker in globals.css as written", () => {
    expect(failing(globals)).toEqual([]);
  });

  it("finds every marker in a minified sheet that keeps them", () => {
    expect(failing(FALLBACK + LINEAR + GRAIN + OFF + VT + AMR)).toEqual([]);
  });

  it("flags linear() that comes before its fallback, or outside @supports", () => {
    expect(failing(LINEAR + FALLBACK + GRAIN + OFF + VT + AMR)).toHaveLength(2);
    const unguarded = ":root{--ease-settle:linear(0,1.08,1);--ease-pop:linear(0,1.16,1)}";
    expect(failing(FALLBACK + unguarded + GRAIN + OFF + VT + AMR)).toHaveLength(2);
    expect(failing(LINEAR + GRAIN + OFF + VT + AMR)).toHaveLength(2);
  });

  it("flags a grain rule that lost a layer or its selector, and a missing removal", () => {
    const oneLayer = `html.light body{background-image:${TILE}}html.dark body{background-image:${TILE},${TILE}}`;
    expect(failing(FALLBACK + LINEAR + oneLayer + OFF + VT + AMR)).toEqual([
      "paper grain: two url(data:image/svg+xml) layers on html.light body",
    ]);
    expect(failing(FALLBACK + LINEAR + GRAIN + VT + AMR)).toEqual([
      "paper grain: removed for print, forced colours and more contrast",
    ]);
  });

  it("passes a marker found in any one of several files", () => {
    expect(failing(FALLBACK + LINEAR, GRAIN + OFF, VT, AMR)).toEqual([]);
  });
});

describe("check-built-css: F2's held layers", () => {
  const OTHERS = FALLBACK + LINEAR + GRAIN + OFF + AMR;

  it("lists every F2 marker as missing without the VIEW TRANSITIONS block", () => {
    expect(failing(OTHERS)).toEqual(MARKERS.F2.map((m: { name: string }) => m.name));
  });

  it("reads the held names with or without quotes", () => {
    const quoted = NAMES.replace(/hold=([a-z-]+)\]/g, 'hold="$1"]');
    expect(quoted).not.toBe(NAMES);
    expect(failing(OTHERS + vtBlock(READY + quoted + HOLD + STACK + TAPS + CALM))).toEqual([]);
  });

  it("flags a held name given outside html[data-vt] or outside @media screen", () => {
    const always = NAMES.replace(/html\[data-vt\] /g, "");
    expect(failing(OTHERS + vtBlock(READY + always + HOLD + STACK + TAPS + CALM))).toEqual([
      F2_HELD,
    ]);
    const unscreened = `@supports (view-transition-name:none){${NAMES}}`;
    expect(failing(OTHERS + unscreened + vtBlock(READY + HOLD + STACK + TAPS + CALM))).toEqual([
      F2_HELD,
    ]);
  });

  it("flags a held group that lost its order, or an old picture still drawn", () => {
    const flat = STACK.replace("z-index:2", "z-index:3");
    expect(failing(OTHERS + vtBlock(READY + NAMES + HOLD + flat + TAPS + CALM))).toEqual([F2_HELD]);
    const drawn = HOLD.replace("{display:none}", "{opacity:0}");
    expect(failing(OTHERS + vtBlock(READY + NAMES + drawn + STACK + TAPS + CALM))).toEqual([
      F2_HELD,
    ]);
  });

  it("flags --vt-ready outside the screen block, or missing", () => {
    const outside = `@supports (view-transition-name:none){${READY}}`;
    expect(failing(OTHERS + outside + vtBlock(NAMES + HOLD + STACK + TAPS + CALM))).toEqual([
      F2_READY,
    ]);
    expect(failing(OTHERS + READY + vtBlock(NAMES + HOLD + STACK + TAPS + CALM))).toEqual([
      F2_READY,
    ]);
  });

  it("flags a reduced-motion rule that lost !important or left the block", () => {
    const soft = CALM.replace("!important", "");
    expect(failing(OTHERS + vtBlock(READY + NAMES + HOLD + STACK + TAPS + soft))).toEqual([
      F2_CALM,
    ]);
    expect(failing(OTHERS + CALM + vtBlock(READY + NAMES + HOLD + STACK + TAPS))).toEqual([
      F2_CALM,
    ]);
  });
});

describe("check-built-css: the chat strip (AMR)", () => {
  const OTHERS = FALLBACK + LINEAR + GRAIN + OFF + VT;
  const [RIGHT_TAIL, YOU_CAPTION, ALIAS, GUARD] = MARKERS.AMR.map((m: { name: string }) => m.name);

  it("lists every AMR marker as missing without the chat rules", () => {
    expect(failing(OTHERS)).toEqual([RIGHT_TAIL, YOU_CAPTION, ALIAS, GUARD]);
  });

  it("reads the source's quotes, double colons and leading zeros as the build's", () => {
    const source = (RIGHT + TOP)
      .replace(/=([a-z-]+)\]/g, '="$1"]')
      .replace(/:(before|after)/g, "::$1")
      .replace(/(^|[^\d])\.(\d)/g, "$10.$2");
    expect(source).toContain('[data-tail="right"]::before');
    expect(source).toContain("right:-0.8rem");
    expect(source).toContain("+ 0.1rem");
    expect(failing(OTHERS + source + YOU + WASH + TAILS_OFF)).toEqual([]);
  });

  it("flags a right tail that lost its paper colour, and an alias left out of it", () => {
    const card = RIGHT.replace("var(--balloon-fill)", "var(--card)");
    expect(failing(OTHERS + card + TOP + YOU + WASH + TAILS_OFF)).toEqual([RIGHT_TAIL, ALIAS]);
    const noAlias = RIGHT.replace(/,\[data-amr-side=right\] \.balloon\[data-tail=amr\]:\w+/g, "");
    expect(noAlias).not.toContain("data-amr-side");
    expect(failing(OTHERS + noAlias + TOP + YOU + WASH + TAILS_OFF)).toEqual([ALIAS]);
    const noTop = TOP.replace(/,\[data-amr-edge=top\] \.balloon\[data-tail=amr\]:\w+/g, "");
    expect(noTop).not.toContain("data-amr-edge");
    expect(failing(OTHERS + RIGHT + noTop + YOU + WASH + TAILS_OFF)).toEqual([ALIAS]);
  });

  it("flags a you wash outside @supports or before its fallback, and a lost outline", () => {
    const bare =
      ".comic-caption[data-voice=you]{background-color:color-mix(in srgb,var(--accent2) 14%,var(--card))}";
    expect(failing(OTHERS + RIGHT + TOP + YOU + bare + TAILS_OFF)).toEqual([YOU_CAPTION]);
    expect(failing(OTHERS + RIGHT + TOP + WASH + YOU + TAILS_OFF)).toEqual([YOU_CAPTION]);
    const unlined = YOU.replace(";border:var(--line-w) solid var(--border)", "");
    expect(failing(OTHERS + RIGHT + TOP + unlined + WASH + TAILS_OFF)).toEqual([YOU_CAPTION]);
  });

  it("flags tails hidden only for print, or only one of the two", () => {
    const print = TAILS_OFF.replace("(forced-colors:active)", "print");
    expect(failing(OTHERS + RIGHT + TOP + YOU + WASH + print)).toEqual([GUARD]);
    const half = "@media (forced-colors:active){.balloon:before{display:none}}";
    expect(failing(OTHERS + RIGHT + TOP + YOU + WASH + half)).toEqual([GUARD]);
  });
});
