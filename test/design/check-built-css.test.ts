// @vitest-environment node
/**
 * scripts/check-built-css.mjs reads the minified build; this holds its markers
 * to what they claim, on hand-written sheets and on the sources themselves
 * (globals.css, and the mascot's CSS module for the chat panel's entrance).
 */
import { readFileSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { MARKERS, checkMarkers, stripWhitespace } from "../../scripts/check-built-css.mjs";

/** A source stylesheet with its comments and whitespace taken out. */
function source(file: string): string {
  return stripWhitespace(
    readFileSync(path.join(process.cwd(), file), "utf8").replace(/\/\*[\s\S]*?\*\//g, "")
  );
}

const globals = source("src/app/globals.css");
const mascotModule = source("src/components/agent/mascot/mascot-assistant.module.css");

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
const EDGE =
  "@media (forced-colors:active){.comic-caption[data-voice=you]{border-inline-start-width:calc(var(--line-w)*3)}}";
/** PR 1's chat strip: balloons and captions. */
const STRIP = RIGHT + TOP + YOU + WASH + EDGE + TAILS_OFF;
/** PR 5's panel frame: the panel's down tail and the name plate (globals.css). */
const DOWN =
  '.comic-tailed[data-tail=down]:before{content:"";bottom:-.8rem;left:var(--tail-at);border-width:.8rem .4rem 0;border-color:var(--border) transparent transparent}' +
  '.comic-tailed[data-tail=down]:after{content:"";bottom:-.6rem;left:calc(var(--tail-at) + .1rem);border-width:.65rem .3rem 0;border-color:var(--card) transparent transparent}';
const PLATE =
  ".comic-name-plate{--plate-line:var(--line-w);display:inline-block;padding:.125rem .5rem;background-color:var(--card);border:var(--plate-line) solid var(--border);box-shadow:var(--shadow-1);rotate:-1deg}";
const FLAT = ".hc .comic-name-plate,[data-theme=hc] .comic-name-plate{rotate:none;box-shadow:none}";
/** The panel's entrance, from the CSS module, its class hashed the way Next names it. */
const PANEL_ENTER = ".mascot-assistant_panelEnter__Ab1c2";
const ENTRANCE =
  `${PANEL_ENTER}{transform-origin:var(--panel-origin,50% 100%)}` +
  `@media (prefers-reduced-motion:no-preference){${PANEL_ENTER}{transition:opacity var(--dur-surface-in) var(--ease-calm),scale var(--dur-surface-in) var(--ease-calm)}` +
  `@starting-style{${PANEL_ENTER}{opacity:0;scale:.96}}}`;
const FRAME = DOWN + PLATE + FLAT + ENTRANCE;
const AMR = STRIP + FRAME;

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
    expect(MARKERS.AMR).toHaveLength(8);
  });

  it("finds every marker in the sources as written: globals.css, and the entrance in the mascot's module", () => {
    expect(failing(globals, mascotModule)).toEqual([]);
    const ENTRANCE_MARKER = MARKERS.AMR[7].name;
    expect(failing(globals)).toEqual([ENTRANCE_MARKER]);
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
  // The panel frame's rules stay in, so each case below flags only the strip's.
  const OTHERS = FALLBACK + LINEAR + GRAIN + OFF + VT + FRAME;
  const [RIGHT_TAIL, YOU_CAPTION, ALIAS, GUARD, YOU_EDGE] = MARKERS.AMR.map(
    (m: { name: string }) => m.name
  );

  it("lists every AMR marker as missing without the chat rules", () => {
    expect(failing(FALLBACK + LINEAR + GRAIN + OFF + VT)).toEqual(
      MARKERS.AMR.map((m: { name: string }) => m.name)
    );
    expect(failing(OTHERS)).toEqual([RIGHT_TAIL, YOU_CAPTION, ALIAS, GUARD, YOU_EDGE]);
  });

  it("reads the source's quotes, double colons and leading zeros as the build's", () => {
    const source = (RIGHT + TOP)
      .replace(/=([a-z-]+)\]/g, '="$1"]')
      .replace(/:(before|after)/g, "::$1")
      .replace(/(^|[^\d])\.(\d)/g, "$10.$2");
    expect(source).toContain('[data-tail="right"]::before');
    expect(source).toContain("right:-0.8rem");
    expect(source).toContain("+ 0.1rem");
    expect(failing(OTHERS + source + YOU + WASH + EDGE + TAILS_OFF)).toEqual([]);
  });

  it("flags a right tail that lost its paper colour, and an alias left out of it", () => {
    const card = RIGHT.replace("var(--balloon-fill)", "var(--card)");
    expect(failing(OTHERS + card + TOP + YOU + WASH + EDGE + TAILS_OFF)).toEqual([
      RIGHT_TAIL,
      ALIAS,
    ]);
    const noAlias = RIGHT.replace(/,\[data-amr-side=right\] \.balloon\[data-tail=amr\]:\w+/g, "");
    expect(noAlias).not.toContain("data-amr-side");
    expect(failing(OTHERS + noAlias + TOP + YOU + WASH + EDGE + TAILS_OFF)).toEqual([ALIAS]);
    const noTop = TOP.replace(/,\[data-amr-edge=top\] \.balloon\[data-tail=amr\]:\w+/g, "");
    expect(noTop).not.toContain("data-amr-edge");
    expect(failing(OTHERS + RIGHT + noTop + YOU + WASH + EDGE + TAILS_OFF)).toEqual([ALIAS]);
  });

  it("flags a you wash outside @supports or before its fallback, and a lost outline", () => {
    const bare =
      ".comic-caption[data-voice=you]{background-color:color-mix(in srgb,var(--accent2) 14%,var(--card))}";
    expect(failing(OTHERS + RIGHT + TOP + YOU + bare + EDGE + TAILS_OFF)).toEqual([YOU_CAPTION]);
    expect(failing(OTHERS + RIGHT + TOP + WASH + YOU + EDGE + TAILS_OFF)).toEqual([YOU_CAPTION]);
    const unlined = YOU.replace(";border:var(--line-w) solid var(--border)", "");
    expect(failing(OTHERS + RIGHT + TOP + unlined + WASH + EDGE + TAILS_OFF)).toEqual([
      YOU_CAPTION,
    ]);
  });

  it("flags tails hidden only for print, or only one of the two", () => {
    const print = TAILS_OFF.replace("(forced-colors:active)", "print");
    expect(failing(OTHERS + RIGHT + TOP + YOU + WASH + EDGE + print)).toEqual([GUARD]);
    const half = "@media (forced-colors:active){.balloon:before{display:none}}";
    expect(failing(OTHERS + RIGHT + TOP + YOU + WASH + EDGE + half)).toEqual([GUARD]);
  });

  it("flags a you caption edge outside forced colours, missing, or no heavier than narration's", () => {
    const CHAT = OTHERS + RIGHT + TOP + YOU + WASH + TAILS_OFF;
    expect(failing(CHAT)).toEqual([YOU_EDGE]);
    const unguarded =
      ".comic-caption[data-voice=you]{border-inline-start-width:calc(var(--line-w)*3)}";
    expect(failing(CHAT + unguarded)).toEqual([YOU_EDGE]);
    expect(failing(CHAT + EDGE.replace("(forced-colors:active)", "print"))).toEqual([YOU_EDGE]);
    expect(failing(CHAT + EDGE.replace("calc(var(--line-w)*3)", "var(--line-w)"))).toEqual([
      YOU_EDGE,
    ]);
    expect(failing(CHAT + EDGE.replace("data-voice=you", "data-voice=narration"))).toEqual([
      YOU_EDGE,
    ]);
    // The source keeps the attribute's quotes; the marker reads both.
    expect(failing(CHAT + EDGE.replace("data-voice=you", 'data-voice="you"'))).toEqual([]);
  });
});

describe("check-built-css: the panel frame (AMR)", () => {
  const OTHERS = FALLBACK + LINEAR + GRAIN + OFF + VT + STRIP;
  const [PANEL_TAIL, PLATE_FLAT, ENTRANCE_MARKER] = MARKERS.AMR.slice(5).map(
    (m: { name: string }) => m.name
  );

  it("lists the frame's three markers as missing without its rules", () => {
    expect(failing(OTHERS)).toEqual([PANEL_TAIL, PLATE_FLAT, ENTRANCE_MARKER]);
  });

  it("finds the entrance in a sheet of its own, as the CSS module builds", () => {
    expect(failing(OTHERS + DOWN + PLATE + FLAT, ENTRANCE)).toEqual([]);
  });

  it("reads the source's quotes, double colons and leading zeros as the build's", () => {
    const source = DOWN.replace(/=([a-z-]+)\]/g, '="$1"]')
      .replace(/:(before|after)/g, "::$1")
      .replace(/(^|[^\d])\.(\d)/g, "$10.$2");
    expect(source).toContain('[data-tail="down"]::before');
    expect(source).toContain("bottom:-0.8rem");
    expect(source).toContain("+ 0.1rem");
    expect(failing(OTHERS + source + PLATE + FLAT + ENTRANCE)).toEqual([]);
    const flat = FLAT.replace("data-theme=hc", 'data-theme="hc"');
    const entrance = ENTRANCE.replace(PANEL_ENTER, ".panelEnter").replace(".96", "0.96");
    expect(failing(OTHERS + DOWN + PLATE + flat + entrance)).toEqual([]);
  });

  it("flags a down tail in another paper, on another edge, or with no content", () => {
    const balloonPaper = DOWN.replace("var(--card)", "var(--balloon-fill)");
    expect(failing(OTHERS + balloonPaper + PLATE + FLAT + ENTRANCE)).toEqual([PANEL_TAIL]);
    const up = DOWN.replace(/data-tail=down/g, "data-tail=up");
    expect(failing(OTHERS + up + PLATE + FLAT + ENTRANCE)).toEqual([PANEL_TAIL]);
    const top = DOWN.replace("bottom:-.8rem", "top:-.8rem");
    expect(failing(OTHERS + top + PLATE + FLAT + ENTRANCE)).toEqual([PANEL_TAIL]);
    const empty = DOWN.replace(/content:"";/g, "");
    expect(failing(OTHERS + empty + PLATE + FLAT + ENTRANCE)).toEqual([PANEL_TAIL]);
  });

  it("flags a plate that lost its tilt or shadow, tilts by transform, or stays tilted in high contrast", () => {
    const upright = PLATE.replace(";rotate:-1deg", "");
    expect(failing(OTHERS + DOWN + upright + FLAT + ENTRANCE)).toEqual([PLATE_FLAT]);
    const turned = PLATE.replace("rotate:-1deg", "transform:rotate(-1deg)");
    expect(failing(OTHERS + DOWN + turned + FLAT + ENTRANCE)).toEqual([PLATE_FLAT]);
    const blurred = PLATE.replace("var(--shadow-1)", "0 1px 3px var(--shadow-color)");
    expect(failing(OTHERS + DOWN + blurred + FLAT + ENTRANCE)).toEqual([PLATE_FLAT]);
    const tilted = FLAT.replace("rotate:none;", "");
    expect(failing(OTHERS + DOWN + PLATE + tilted + ENTRANCE)).toEqual([PLATE_FLAT]);
    const classOnly = FLAT.replace(",[data-theme=hc] .comic-name-plate", "");
    expect(failing(OTHERS + DOWN + PLATE + classOnly + ENTRANCE)).toEqual([PLATE_FLAT]);
    expect(failing(OTHERS + DOWN + PLATE + ENTRANCE)).toEqual([PLATE_FLAT]);
  });

  it("flags an entrance outside the motion guard, without its start, or one that moves by transform", () => {
    const CHAT = OTHERS + DOWN + PLATE + FLAT;
    const unguarded =
      `${PANEL_ENTER}{transition:opacity var(--dur-surface-in) var(--ease-calm),scale var(--dur-surface-in) var(--ease-calm)}` +
      `@starting-style{${PANEL_ENTER}{opacity:0;scale:.96}}`;
    expect(failing(CHAT + unguarded)).toEqual([ENTRANCE_MARKER]);
    const reduce = ENTRANCE.replace("no-preference", "reduce");
    expect(failing(CHAT + reduce)).toEqual([ENTRANCE_MARKER]);
    const transform = ENTRANCE.replace("scale:.96", "transform:scale(.96)");
    expect(failing(CHAT + transform)).toEqual([ENTRANCE_MARKER]);
    const noStart = ENTRANCE.replace(/@starting-style\{.*\}\}$/, "}");
    expect(noStart).not.toContain("@starting-style");
    expect(failing(CHAT + noStart)).toEqual([ENTRANCE_MARKER]);
    const fadeOnly = ENTRANCE.replace(",scale var(--dur-surface-in) var(--ease-calm)", "");
    expect(failing(CHAT + fadeOnly)).toEqual([ENTRANCE_MARKER]);
    const otherClass = ENTRANCE.replace(/panelEnter/g, "float");
    expect(failing(CHAT + otherClass)).toEqual([ENTRANCE_MARKER]);
  });
});
