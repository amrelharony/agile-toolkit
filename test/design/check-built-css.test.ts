// @vitest-environment node
/**
 * scripts/check-built-css.mjs reads the minified build; this holds its markers
 * to what they claim, on hand-written sheets and on globals.css itself.
 */
import { readFileSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { MARKERS, checkMarkers, stripWhitespace } from "../../scripts/check-built-css.mjs";

/** A source stylesheet as written, comments out and whitespace removed. */
const source = (file: string) =>
  stripWhitespace(
    readFileSync(path.join(process.cwd(), file), "utf8").replace(/\/\*[\s\S]*?\*\//g, "")
  );

const globals = source("src/app/globals.css");
const INTRO = "src/app/(tools)/comics/components/intro";
const look = source(`${INTRO}/intro-look.module.css`);
const book = source(`${INTRO}/book-intro.module.css`);
const poster = source(`${INTRO}/poster-intro.module.css`);
const vip = source(`${INTRO}/vip-intro.module.css`);

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

/** I1's book look, minified the way the build writes it (class names hashed, quotes dropped). */
const MASK = `.g_x{--look-grain:${TILE};display:none;-webkit-mask-image:var(--look-grain);mask-image:var(--look-grain);-webkit-mask-size:61px 61px;mask-size:61px 61px;-webkit-mask-repeat:repeat;mask-repeat:repeat}`;
const SHOWN = "@supports (mask-image:none) or (-webkit-mask-image:none){.g_x{display:block}}";
const HIDE = ".hc [data-look],[data-theme=hc] [data-look]{display:none!important}";
const BOWED =
  "@supports (clip-path:shape(from 0 0,line to 100% 0)){.c_x{animation:b-ink .4s both}@keyframes b-ink{0%{clip-path:shape(from 0 0,line to 0 0)}to{clip-path:shape(from 0 0,line to 100% 0)}}}";
const BOOK = MASK + SHOWN + HIDE + BOWED;

/** I2's bowed twins for the poster's sheet and the VIP opening ink, minified (names hashed). */
const SHAPE_IF = "@supports (clip-path:shape(from 0 0,line to 100% 0))";
const POSTER_INK =
  "@keyframes p-ink{0%{clip-path:shape(from 0 0,line to 0 0,curve to 0 0 with 0 0,close)}to{clip-path:shape(from 0 0,line to calc(200% + 2rem) 0,curve to 0 calc(200% + 2rem) with calc(100% + 1rem) calc(100% + 1rem),close)}}";
const POSTER_BOWED = `${SHAPE_IF}{.p_x{animation:p-ink .42s both}${POSTER_INK}}`;
const VIP_INK =
  "@keyframes v-ink{0%,12%{clip-path:shape(from -30% 100%,curve to 0 0 with -15% 50%,line to 130% 0,line to 130% 100%,close)}to{clip-path:shape(from 100% 100%,curve to 130% 0 with 115% 50%,line to 130% 0,line to 130% 100%,close)}}";
const VIP_BOWED = `${SHAPE_IF}{.v_x{animation:v-ink .9s both}${VIP_INK}}`;
const SCENES_BOWED = POSTER_BOWED + VIP_BOWED;

const F2_HELD = MARKERS.F2[0].name;
const F2_READY = MARKERS.F2[1].name;
const F2_CALM = MARKERS.F2[3].name;

function failing(...sheets: string[]): string[] {
  return checkMarkers(sheets.map(stripWhitespace))
    .filter((r: { ok: boolean }) => !r.ok)
    .map((r: { name: string }) => r.name);
}
/** The same, for a describe that narrows `failing` to its own PR's markers. */
const failingAll = failing;

describe("check-built-css", () => {
  it("lists each PR's markers", () => {
    expect(Object.keys(MARKERS)).toEqual(["F1", "F2", "I1", "I2"]);
    expect(MARKERS.F1).toHaveLength(5);
    expect(MARKERS.F2).toHaveLength(4);
    expect(MARKERS.I1).toHaveLength(4);
    expect(MARKERS.I2).toHaveLength(2);
  });

  it("finds every marker in the source stylesheets as written", () => {
    expect(failing(globals, look, book, poster, vip)).toEqual([]);
  });

  it("finds every marker in a minified sheet that keeps them", () => {
    expect(failing(FALLBACK + LINEAR + GRAIN + OFF + VT + BOOK + SCENES_BOWED)).toEqual([]);
  });

  it("flags linear() that comes before its fallback, or outside @supports", () => {
    expect(failing(LINEAR + FALLBACK + GRAIN + OFF + VT + BOOK + SCENES_BOWED)).toHaveLength(2);
    const unguarded = ":root{--ease-settle:linear(0,1.08,1);--ease-pop:linear(0,1.16,1)}";
    expect(failing(FALLBACK + unguarded + GRAIN + OFF + VT + BOOK + SCENES_BOWED)).toHaveLength(2);
    expect(failing(LINEAR + GRAIN + OFF + VT + BOOK + SCENES_BOWED)).toHaveLength(2);
  });

  it("flags a grain rule that lost a layer or its selector, and a missing removal", () => {
    const oneLayer = `html.light body{background-image:${TILE}}html.dark body{background-image:${TILE},${TILE}}`;
    expect(failing(FALLBACK + LINEAR + oneLayer + OFF + VT + BOOK + SCENES_BOWED)).toEqual([
      "paper grain: two url(data:image/svg+xml) layers on html.light body",
    ]);
    expect(failing(FALLBACK + LINEAR + GRAIN + VT + BOOK + SCENES_BOWED)).toEqual([
      "paper grain: removed for print, forced colours and more contrast",
    ]);
  });

  it("passes a marker found in any one of several files", () => {
    expect(failing(FALLBACK + LINEAR, GRAIN + OFF, VT, BOOK, POSTER_BOWED, VIP_BOWED)).toEqual([]);
  });
});

describe("check-built-css: F2's held layers", () => {
  // Every other PR's markers, so only F2's can be missing.
  const F1 = FALLBACK + LINEAR + GRAIN + OFF + BOOK + SCENES_BOWED;

  it("lists every F2 marker as missing without the VIEW TRANSITIONS block", () => {
    expect(failing(F1)).toEqual(MARKERS.F2.map((m: { name: string }) => m.name));
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

describe("check-built-css: I1's book look", () => {
  const OTHERS = FALLBACK + LINEAR + GRAIN + OFF + VT;
  const [PAIRED, SUPPORTS, HIDDEN, SHAPE] = MARKERS.I1.map((m: { name: string }) => m.name);
  // I1's own markers only. I2's pass only with its twins in the sheet, and
  // those are shape() wipes in @supports too, which would pass I1's book
  // title marker in every case below.
  const failing = (...sheets: string[]) =>
    failingAll(...sheets).filter((name) => [PAIRED, SUPPORTS, HIDDEN, SHAPE].includes(name));

  it("lists every I1 marker as missing without the book look", () => {
    expect(failing(OTHERS)).toEqual([PAIRED, SUPPORTS, HIDDEN, SHAPE]);
  });

  it("flags a mask whose -webkit- name was dropped, comes second or differs", () => {
    const plainOnly = MASK.replace("-webkit-mask-image:var(--look-grain);", "");
    expect(failing(OTHERS + plainOnly + SHOWN + HIDE + BOWED)).toEqual([PAIRED]);
    const swapped = MASK.replace(
      "-webkit-mask-image:var(--look-grain);mask-image:var(--look-grain);",
      "mask-image:var(--look-grain);-webkit-mask-image:var(--look-grain);"
    );
    expect(swapped).not.toBe(MASK);
    expect(failing(OTHERS + swapped + SHOWN + HIDE + BOWED)).toEqual([PAIRED]);
    const differs = MASK.replace(";mask-image:var(--look-grain);", ";mask-image:none;");
    expect(differs).not.toBe(MASK);
    expect(failing(OTHERS + differs + SHOWN + HIDE + BOWED)).toEqual([PAIRED]);
  });

  it("flags a grain rule whose mask size or repeat lost its -webkit- twin", () => {
    for (const twin of ["-webkit-mask-size:61px 61px;", "-webkit-mask-repeat:repeat;"]) {
      const dropped = MASK.replace(twin, "");
      expect(dropped, twin).not.toBe(MASK);
      expect(failing(OTHERS + dropped + SHOWN + HIDE + BOWED), twin).toEqual([PAIRED]);
    }
  });

  it("never takes another sheet's paired mask for the book's", () => {
    // Amr's mascot-fx pairs its own masks; the build puts them in another file.
    const mascot =
      ".m_x{-webkit-mask-image:radial-gradient(ellipse 50% 55% at 50% 55%,#000 60%,transparent 100%);mask-image:radial-gradient(ellipse 50% 55% at 50% 55%,#000 60%,transparent 100%)}";
    const plainOnly = MASK.replace("-webkit-mask-image:var(--look-grain);", "");
    expect(failing(OTHERS + plainOnly + SHOWN + HIDE + BOWED, mascot)).toEqual([PAIRED]);
    expect(failing(OTHERS + mascot + plainOnly + SHOWN + HIDE + BOWED)).toEqual([PAIRED]);
  });

  it("flags grain shown outside its @supports, behind only one mask name, or not the grain", () => {
    expect(failing(OTHERS + MASK + ".g_x{display:block}" + HIDE + BOWED)).toEqual([SUPPORTS]);
    const one = "@supports (mask-image:none){.g_x{display:block}}";
    expect(failing(OTHERS + MASK + one + HIDE + BOWED)).toEqual([SUPPORTS]);
    const other = SHOWN.replace(".g_x{", ".o_x{");
    expect(failing(OTHERS + MASK + other + HIDE + BOWED)).toEqual([SUPPORTS]);
  });

  it("flags the high-contrast rule without !important or without one of its selectors", () => {
    const soft = HIDE.replace("!important", "");
    expect(failing(OTHERS + MASK + SHOWN + soft + BOWED)).toEqual([HIDDEN]);
    const half = ".hc [data-look]{display:none!important}";
    expect(failing(OTHERS + MASK + SHOWN + half + BOWED)).toEqual([HIDDEN]);
    const quoted = HIDE.replace("=hc]", '="hc"]');
    expect(failing(OTHERS + MASK + SHOWN + quoted + BOWED)).toEqual([]);
  });

  it("flags a shape() wipe that left its @supports", () => {
    const bare =
      ".c_x{animation:b-ink .4s both}@keyframes b-ink{to{clip-path:shape(from 0 0,line to 100% 0)}}";
    expect(failing(OTHERS + MASK + SHOWN + HIDE + bare)).toEqual([SHAPE]);
  });
});

describe("check-built-css: I2's bowed poster and VIP inks", () => {
  // Every other PR's markers, the book's own bowed title included.
  const OTHERS = FALLBACK + LINEAR + GRAIN + OFF + VT + BOOK;
  const [POSTER, VIP] = MARKERS.I2.map((m: { name: string }) => m.name);

  it("lists both as missing without the scenes' twins, whatever the book's title does", () => {
    expect(failing(OTHERS)).toEqual([POSTER, VIP]);
  });

  it("finds each scene's twin by what it draws, not by the other's", () => {
    expect(failing(OTHERS + VIP_BOWED)).toEqual([POSTER]);
    expect(failing(OTHERS + POSTER_BOWED)).toEqual([VIP]);
    expect(failing(OTHERS, POSTER_BOWED, VIP_BOWED)).toEqual([]);
  });

  it("flags a twin that left its @supports", () => {
    const bare = `.p_x{animation:p-ink .42s both}${POSTER_INK}`;
    expect(failing(OTHERS + bare + VIP_BOWED)).toEqual([POSTER]);
    const elsewhere = `@supports (display:grid){.v_x{animation:v-ink .9s both}${VIP_INK}}`;
    expect(failing(OTHERS + POSTER_BOWED + elsewhere)).toEqual([VIP]);
  });

  it("flags a twin that no rule in its block runs", () => {
    const unused = POSTER_BOWED.replace("animation:p-ink", "animation:other-ink");
    expect(unused).not.toBe(POSTER_BOWED);
    expect(failing(OTHERS + unused + VIP_BOWED)).toEqual([POSTER]);
  });

  it("never takes a straight polygon for the bowed edge", () => {
    const straight =
      "@keyframes p-ink{0%{clip-path:polygon(0 0,0 0,0 0)}to{clip-path:polygon(0 0,calc(200% + 2rem) 0,0 calc(200% + 2rem))}}";
    expect(failing(OTHERS + `${SHAPE_IF}{.p_x{animation:p-ink .42s both}${straight}}`)).toEqual([
      POSTER,
      VIP,
    ]);
  });
});
