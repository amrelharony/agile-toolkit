/**
 * Build the review page for Amr's interactive-pet clips: every reaction and held
 * pose from src/components/agent/mascot/engine/clips.ts and every scene from
 * engine/scenes.ts whose sheet has shipped, playing at the size he stands on the
 * site (132 px desktop, 96 px phone), on the site's light and dark grounds, with
 * an exposure-sheet strip of its timing, plus every frame of every pack and the
 * identity check against the live sheet.
 *
 *     node scripts/build-mascot-review.mjs <out folder>
 *
 * Writes <out>/index.html and copies the sheet and the packs into <out>/mascot/.
 * Reads the clips straight from the TypeScript (Node's type stripping), so the
 * page plays exactly what the site plays. Nothing here ships with the site.
 */

import { copyFileSync, mkdirSync, readFileSync, readdirSync, writeFileSync } from "node:fs";
import { register } from "node:module";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

// scenes.ts imports "./clips" as the bundler resolves it, with no extension;
// Node needs one, so a relative specifier that misses is tried again as .ts.
register(
  "data:text/javascript," +
    encodeURIComponent(`export async function resolve(spec, ctx, next) {
  try { return await next(spec, ctx); }
  catch (e) {
    const relative = spec.startsWith("./") || spec.startsWith("../");
    const name = spec.slice(spec.lastIndexOf("/") + 1);
    if (relative && !name.includes(".")) return next(spec + ".ts", ctx);
    throw e;
  }
}`)
);

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const MASCOT = path.join(ROOT, "src", "components", "agent", "mascot");
const load = (...parts) => import(pathToFileURL(path.join(MASCOT, ...parts)).href);
const { PACKS, FRAMES, PACK_CELL, PACK_COLUMNS } = await load("mascot-packs.ts");
const clips = await load("engine", "clips.ts");
const { SCENES } = await load("engine", "scenes.ts");
const FX = await load("engine", "scene-fx.ts");
// The site's own styles for the air around a scene (its CSS-module names, unscoped here).
const FX_CSS = readFileSync(path.join(MASCOT, "mascot-fx.module.css"), "utf8");
const SPEC = JSON.parse(
  readFileSync(path.join(ROOT, "docs", "mascot", "context-sheets.json"), "utf8")
);

const out = process.argv[2];
if (!out) {
  console.error("usage: node scripts/build-mascot-review.mjs <out folder>");
  process.exit(1);
}

const { ACT_CLIPS, HOLD_CLIPS, TALK_CLIP, LIFTED_CLIP, STROLL_FROM_RIGHT, STROLL_FROM_LEFT } =
  clips;

/** What sets each clip off on the site (docs/mascot/AMR-ART-BRIEF.md, Appendix A). */
const GROUPS = [
  {
    title: "Touch",
    note: "Taps answer at once; a burst never queues up behind itself.",
    clips: [
      [ACT_CLIPS.poke, "Tap his tummy"],
      [ACT_CLIPS.tickle, "Three quick taps, or rub back and forth over him"],
      [ACT_CLIPS.patLeft, "Tap the left of his head, or stroke across it leftward"],
      [ACT_CLIPS.patRight, "Tap the right of his head, or stroke across it rightward"],
      [ACT_CLIPS.bashful, "Rest the mouse on him for 1.2 s (desktop)"],
      [HOLD_CLIPS.highFive, "Press and hold him for half a second"],
      [ACT_CLIPS.highFive, "…and let go"],
    ],
  },
  {
    title: "Picked up",
    note: "He hangs from the collar and swings with the drag's speed; the code adds the pendulum and the flight to his corner.",
    clips: [
      [LIFTED_CLIP, "Drag him (here the drag speeds up and slows down)"],
      [HOLD_CLIPS.falling, "Let go: he drops to the nearest corner"],
      [HOLD_CLIPS.flying, "Let go fast: he's thrown, in an arc"],
      [ACT_CLIPS.land, "Touching down"],
    ],
  },
  {
    title: "Faces and talking",
    note: "Talking puts the S01 mouths on the S02 gestures, so one head stays on every frame.",
    clips: [
      [TALK_CLIP, "While a chat reply streams (here, simulated words)"],
      [ACT_CLIPS.startle, "A pointer whizzing past him"],
      [ACT_CLIPS.happy, "A warm chat reply"],
      [ACT_CLIPS.concerned, "A failed chat turn, or the rate limit reached"],
      [ACT_CLIPS.lookAround, "The phone turned to landscape"],
    ],
  },
  {
    title: "Feeling the phone",
    note: "Phones only, after “Let Amr feel your phone” in his panel. Readings never leave the device.",
    clips: [
      [HOLD_CLIPS.tipLeft, "Phone tilted 15° to the left"],
      [HOLD_CLIPS.tipRight, "Phone tilted 15° to the right"],
      [HOLD_CLIPS.whoa, "Tilted past 35°"],
      [ACT_CLIPS.steady, "Level again"],
      [ACT_CLIPS.dizzy, "Phone shaken, or seven quick taps"],
    ],
  },
  {
    title: "Nobody around",
    note: "Late at night (23:00–05:00) it all comes sooner.",
    clips: [
      [ACT_CLIPS.yawn, "Quiet for 45 s"],
      [ACT_CLIPS.stretch, "The first visit of a morning"],
      [HOLD_CLIPS.sitting, "Quiet for 2 minutes"],
      [HOLD_CLIPS.dozing, "Quiet for 4 minutes"],
      [ACT_CLIPS.wake, "Any input while he dozes"],
      [ACT_CLIPS.standUp, "Any input while he sits"],
    ],
  },
  {
    title: "Page moments",
    note: "Unprompted, so at most one every 20 s and never the same twice running.",
    clips: [
      [HOLD_CLIPS.wind, "Scrolling faster than 2,500 px/s"],
      [HOLD_CLIPS.watching, "Typing in a field on the page (desktop)"],
      [ACT_CLIPS.yes, "A form sent; back online"],
      [ACT_CLIPS.clap, "A tool finished something: a sprint completed, a release shipped"],
      [ACT_CLIPS.downcast, "Gone offline; a tool action failed"],
      [ACT_CLIPS.shrug, "A guide search with no match"],
      [ACT_CLIPS.thumbsUp, "Copying text (a live-sheet frame)"],
    ],
  },
  {
    title: "Pointing",
    note: "He points at his panel when it opens, from whichever corner he's in.",
    clips: [
      [ACT_CLIPS.pointUp, "The end of a long page: back to the top"],
      [ACT_CLIPS.pointUpLeft, "The panel, up and to the left"],
      [ACT_CLIPS.pointUpRight, "The panel, up and to the right"],
      [ACT_CLIPS.pointLeft, "The panel, to the left"],
      [ACT_CLIPS.pointRight, "The panel, to the right"],
      [ACT_CLIPS.pointDownLeft, "The panel, down and to the left (parked at the top)"],
      [ACT_CLIPS.pointDownRight, "The panel, down and to the right (parked at the top)"],
    ],
  },
  {
    title: "Social",
    note: "",
    clips: [
      [HOLD_CLIPS.peekHide, "The pointer leaves the window (desktop)"],
      [ACT_CLIPS.peekFound, "…and comes back"],
      [ACT_CLIPS.cheer, "Picking a tool in his guide"],
      [ACT_CLIPS.bow, "Thanked in the chat"],
    ],
  },
  {
    title: "Stroll",
    note: "Desktop only, parked at the bottom, idle for half a minute or so. The code slides him; the art walks in place.",
    clips: [
      [STROLL_FROM_RIGHT, "Parked on the right: out to the left and back"],
      [STROLL_FROM_LEFT, "Parked on the left: out to the right and back"],
    ],
  },
];

/**
 * The scenes, a group per context group (docs/mascot/context-sheets.json), each
 * under its sheet's moment. Only scenes whose frames are all in the manifest: the
 * ones the site can play.
 */
function sceneGroups() {
  const sheetOf = Object.fromEntries(SPEC.sheets.map((s) => [s.pack, s]));
  const shipped = (c) => c.steps.every((st) => st.f.startsWith("base:") || st.f in FRAMES);
  return SPEC.groups
    .map((g) => ({
      title: "Scenes: " + g.title,
      note:
        g.id === "agile"
          ? "Played by the toolkit's own moments: a card added, votes revealed, a sprint shipped."
          : g.id === "play"
            ? "Idle play, the theme switch, a phone's battery, a long stretch of typing."
            : "His greeting on arrival marks the first moment of the day; the rest pass the time while it lasts." +
              (g.id === "weather"
                ? " Rain, snow, wind, fog, dust and stars come with the air the site draws behind him."
                : ""),
      clips: Object.values(SCENES)
        .filter((c) => shipped(c) && sheetOf[FRAMES[c.steps[0].f]?.[0]]?.group === g.id)
        .map((c) => {
          const sheet = sheetOf[FRAMES[c.steps[0].f][0]];
          return [c, sheet.sheet + " · " + sheet.when];
        }),
    }))
    .filter((g) => g.clips.length);
}

mkdirSync(path.join(out, "mascot"), { recursive: true });
const publicMascot = path.join(ROOT, "public", "mascot");
const base = readdirSync(publicMascot).find((f) => /^amr\.[0-9a-f]{8}\.webp$/.test(f));
const files = [base, ...Object.values(PACKS).flatMap((p) => [p.src, p.src2x])].map((u) =>
  path.basename(u)
);
for (const f of files) copyFileSync(path.join(publicMascot, f), path.join(out, "mascot", f));

const data = {
  columns: PACK_COLUMNS,
  cell: PACK_CELL,
  base: `mascot/${base}`,
  packs: Object.fromEntries(
    Object.entries(PACKS).map(([id, p]) => [
      id,
      {
        src: `mascot/${path.basename(p.src)}`,
        src2x: `mascot/${path.basename(p.src2x)}`,
        frames: p.frames,
      },
    ])
  ),
  frames: FRAMES,
  groups: [...GROUPS, ...sceneGroups()].map((g) => ({
    title: g.title,
    note: g.note,
    clips: g.clips.map(([c, trigger]) => ({ ...c, trigger, fx: FX.sceneFx(c.name) })),
  })),
};
// The air around the weather and fireworks scenes, laid out as the site lays it out.
const fxKinds = [...new Set(data.groups.flatMap((g) => g.clips.map((c) => c.fx)).filter(Boolean))];
data.fx = {
  spread: FX.FX_SPREAD,
  rays: FX.SPARK_RAYS,
  colours: FX.SPARK_COLOURS,
  particles: Object.fromEntries(fxKinds.map((k) => [k, FX.particles(k)])),
};

const PAGE = String.raw`<meta charset="utf-8">
<title>Amr Clip Review</title>
<meta name="claude:viewport-fit-sides" content="cover">
<link rel="preconnect" href="https://fonts.googleapis.com">
<link rel="preconnect" href="https://fonts.gstatic.com" crossorigin>
<link rel="stylesheet" href="https://fonts.googleapis.com/css2?family=Recursive:slnt,wght,CASL,MONO@-15..0,300..900,0..1,0..1&display=swap">
<style>
/* An animator's light table: a quiet desk, the clips on their two real grounds,
   each with its exposure sheet underneath. */
:root {
  --desk: #eceff2;
  --panel: #ffffff;
  --ink: #1c222b;
  --sub: #5b6573;
  --rule: #d3d8de;
  --shirt: #5f6d12;
  --shirt-wash: #e7edc7;
  --ground-light: #f7f1e6;
  --ground-dark: #13161e;
  --font-display: "Recursive", ui-rounded, system-ui, sans-serif;
  --font-body: "Recursive", system-ui, -apple-system, "Segoe UI", sans-serif;
  --font-mono: "Recursive", ui-monospace, "SFMono-Regular", Menlo, monospace;
}
@media (prefers-color-scheme: dark) {
  :root:not([data-theme="light"]) {
    --desk: #101318; --panel: #181d24; --ink: #e9edf2; --sub: #9aa4b2; --rule: #2a313b;
    --shirt: #bccb61; --shirt-wash: #2b3215; color-scheme: dark;
  }
}
:root[data-theme="dark"] {
  --desk: #101318; --panel: #181d24; --ink: #e9edf2; --sub: #9aa4b2; --rule: #2a313b;
  --shirt: #bccb61; --shirt-wash: #2b3215; color-scheme: dark;
}
* { box-sizing: border-box; }
body {
  background: var(--desk); color: var(--ink);
  font-family: var(--font-body); font-size: 15px; line-height: 1.5;
  font-variation-settings: "CASL" 0, "MONO" 0;
}
.wrap {
  max-width: 1180px; margin: 0 auto;
  padding-left: max(16px, env(safe-area-inset-left, 0px));
  padding-right: max(16px, env(safe-area-inset-right, 0px));
}
header.top { padding-block: 32px 8px; }
.eyebrow {
  margin: 0; font-family: var(--font-mono); font-variation-settings: "MONO" 1;
  font-size: 12px; letter-spacing: 0.08em; text-transform: uppercase; color: var(--shirt);
}
h1 {
  margin: 6px 0 8px; font-family: var(--font-display); font-weight: 800;
  font-variation-settings: "CASL" 1; font-size: clamp(30px, 5vw, 44px); line-height: 1.05;
  text-wrap: balance;
}
.lede { margin: 0; max-width: 64ch; color: var(--sub); }
.controls { display: flex; flex-wrap: wrap; gap: 12px 20px; align-items: center; margin-top: 18px; }
.seg { display: inline-flex; border: 1px solid var(--rule); border-radius: 999px; padding: 3px; background: var(--panel); }
.seg button, .play {
  font: inherit; font-size: 13px; border: 0; background: transparent; color: var(--sub);
  padding: 6px 12px; border-radius: 999px; cursor: pointer;
}
.seg button[aria-pressed="true"] { background: var(--shirt-wash); color: var(--ink); font-weight: 650; }
.play { border: 1px solid var(--rule); background: var(--panel); color: var(--ink); font-weight: 600; }
button:focus-visible { outline: 2px solid var(--shirt); outline-offset: 2px; }
.ctl-label { font-size: 12px; color: var(--sub); margin-right: 6px; }
main { padding-block: 8px 56px; display: flex; flex-direction: column; gap: 40px; }
section > h2 {
  margin: 0; font-family: var(--font-display); font-variation-settings: "CASL" 0.6;
  font-weight: 750; font-size: 22px;
}
section > p.note { margin: 4px 0 14px; color: var(--sub); max-width: 70ch; }
.grid { display: grid; grid-template-columns: repeat(auto-fill, minmax(280px, 1fr)); gap: 14px; }
.card {
  background: var(--panel); border: 1px solid var(--rule); border-radius: 10px;
  padding: 12px; display: flex; flex-direction: column; gap: 10px; min-width: 0;
}
.card.wide { grid-column: span 2; }
@media (max-width: 640px) { .card.wide { grid-column: auto; } }
.stage { display: grid; grid-template-columns: 1fr 1fr; gap: 8px; }
.card.wide .stage { grid-template-columns: 1fr; }
.tile {
  position: relative; display: flex; justify-content: center; align-items: flex-end;
  border-radius: 6px; padding: 10px 6px 6px; min-height: 176px; overflow: hidden;
}
.tile.light { background: var(--ground-light); }
.tile.dark { background: var(--ground-dark); }
.card.wide .tile { min-height: 176px; }
.amr { background-repeat: no-repeat; flex: none; will-change: transform; }
/* A scene's air (the site's mascot-fx.module.css, below) sits behind his figure. */
.tile.fxs { isolation: isolate; }
.tile.fxs .amr { position: relative; }
.amr > .fx { z-index: -1; }
body.paused .fx, body.paused .fx * { animation-play-state: paused; }
__FX_CSS__
.zzz {
  position: absolute; top: 18px; left: 58%; font: 700 13px/1 var(--font-display);
  color: #8a93a3; letter-spacing: 2px;
}
.meta h3 {
  margin: 0; font-family: var(--font-display); font-variation-settings: "CASL" 0.4;
  font-size: 16px; font-weight: 700;
}
.trigger { margin: 2px 0 0; color: var(--sub); font-size: 13.5px; }
.xsheet {
  position: relative; display: flex; height: 26px; margin-top: 10px;
  border: 1px solid var(--rule); border-radius: 4px; overflow: hidden;
  font-family: var(--font-mono); font-variation-settings: "MONO" 1; font-size: 10px;
}
.xsheet span {
  display: flex; align-items: center; padding: 0 4px; white-space: nowrap; overflow: hidden;
  border-right: 1px solid var(--rule); color: var(--sub); min-width: 0;
}
.xsheet span.loop { background: var(--shirt-wash); color: var(--ink); }
.xsheet span:last-of-type { border-right: 0; }
.head { position: absolute; top: 0; bottom: 0; width: 2px; background: var(--shirt); left: 0; }
.facts {
  margin: 6px 0 0; font-family: var(--font-mono); font-variation-settings: "MONO" 1;
  font-size: 11.5px; color: var(--sub); font-variant-numeric: tabular-nums;
}
.frames { display: grid; grid-template-columns: repeat(auto-fill, minmax(104px, 1fr)); gap: 8px; }
.frame { background: var(--panel); border: 1px solid var(--rule); border-radius: 8px; padding: 6px; min-width: 0; }
.frame .tile { min-height: 0; padding: 4px; }
.frame code {
  display: block; margin-top: 4px; font-family: var(--font-mono); font-variation-settings: "MONO" 1;
  font-size: 10.5px; color: var(--sub); overflow-wrap: anywhere;
}
.pack-title { margin: 18px 0 8px; font-weight: 650; font-size: 14px; }
.pack-title small { color: var(--sub); font-weight: 400; font-family: var(--font-mono); font-variation-settings: "MONO" 1; }
.identity { display: flex; flex-wrap: wrap; gap: 14px; }
.identity figure { margin: 0; background: var(--panel); border: 1px solid var(--rule); border-radius: 10px; padding: 10px; }
.identity figcaption { margin-top: 6px; font-size: 13px; color: var(--sub); max-width: 30ch; }
.hair-row { display: flex; flex-wrap: wrap; gap: 8px; margin-bottom: 14px; }
.hair-row figure { margin: 0; background: var(--panel); border: 1px solid var(--rule); border-radius: 8px; padding: 5px; }
.hair-row.live figure { border-color: var(--shirt); }
.hair-row canvas { display: block; width: 112px; height: 96px; background: var(--ground-light); border-radius: 5px; }
.hair-row figcaption {
  margin-top: 3px; max-width: 112px; font-family: var(--font-mono); font-variation-settings: "MONO" 1;
  font-size: 10px; color: var(--sub); overflow-wrap: anywhere;
}
@media (prefers-reduced-motion: reduce) { .head { display: none; } }
</style>

<header class="top">
  <div class="wrap">
    <p class="eyebrow">Interactive pet · hair-corrected art · 10 sheets</p>
    <h1>Amr clip review</h1>
    <p class="lede">Every new reaction and held pose, playing at the size he stands on the site, on the site's own light and dark grounds. The strip under each clip is its exposure sheet: one cell per frame, as long as the frame holds, with the looping part shaded.</p>
    <div class="controls">
      <div><span class="ctl-label" id="size-l">Size</span><span class="seg" role="group" aria-labelledby="size-l"><button type="button" id="size-desktop" aria-pressed="true">Desktop 132 px</button><button type="button" id="size-phone" aria-pressed="false">Phone 96 px</button></span></div>
      <div><span class="ctl-label" id="sharp-l">Cells</span><span class="seg" role="group" aria-labelledby="sharp-l"><button type="button" id="sharp-1" aria-pressed="true">1×</button><button type="button" id="sharp-2" aria-pressed="false">2× (sharp screens)</button></span></div>
      <button type="button" class="play" id="play">Pause</button>
    </div>
  </div>
</header>

<main class="wrap" id="main">
  <section>
    <h2>Identity check</h2>
    <p class="note">The live sheet stays the boot frame and the identity reference. The new frames are registered to it: same height, same floor row, feet on the same spot. Here at twice his desktop size.</p>
    <div class="identity" id="identity"></div>
  </section>
  <section>
    <h2>Hair check</h2>
    <p class="note">His haircut comes from the live sheet: short, smooth and close-cropped, from every angle. The first row is the live sheet's head from eight angles; under it is every new frame's head, cut from the sharp cells. Every tile should show the same haircut.</p>
    <div id="hair"></div>
  </section>
</main>

<script>
const D = __DATA__;
const reduce = matchMedia("(prefers-reduced-motion: reduce)").matches;
let size = { w: 132, h: 143 };
let sharp = false;
let playing = !reduce;
const CELL = { w: 192, h: 208 };

function cellOf(ref) {
  if (ref.startsWith("base:")) {
    const [, r, c] = ref.split(":").map(Number);
    return { url: D.base, rows: 11, idx: r * 8 + c, base: true };
  }
  const [pack, idx] = D.frames[ref];
  const p = D.packs[pack];
  return { url: sharp ? p.src2x : p.src, rows: Math.ceil(p.frames / D.columns), idx, base: false };
}
// A pack's cell has headroom over the live sheet's; tiles stand him on their floor,
// so the taller cell only reaches higher, as on the site.
function paint(el, ref, w, h) {
  const c = cellOf(ref);
  const key = c.url + "#" + c.idx + "@" + w;
  if (el._k === key) return;
  el._k = key;
  const ch = c.base ? h : (h * D.cell.h) / CELL.h;
  el.style.width = w + "px";
  el.style.height = ch + "px";
  el.style.backgroundImage = "url(" + c.url + ")";
  el.style.backgroundSize = w * D.columns + "px " + ch * c.rows + "px";
  el.style.backgroundPosition = -(c.idx % D.columns) * w + "px " + -Math.floor(c.idx / D.columns) * ch + "px";
}
// A scene's air, as mascot-fx.tsx draws it: wider than his box, above it, behind him.
function fxSpan(cls) { const s = document.createElement("span"); s.className = cls; return s; }
function fxLayer(kind, w, h) {
  const X = D.fx;
  const lw = w * (1 + 2 * X.spread.x), lh = h * (1 + X.spread.top);
  const el = document.createElement("div");
  el.className = "fx " + kind;
  el.style.cssText = "left:" + (-w * X.spread.x).toFixed(1) + "px;bottom:0;width:" + lw.toFixed(1) + "px;height:" + lh.toFixed(1) + "px;--w:" + lw.toFixed(1) + "px;--h:" + lh.toFixed(1) + "px";
  if (kind === "storm") el.appendChild(fxSpan("flash"));
  if (kind === "dust") el.appendChild(fxSpan("haze"));
  X.particles[kind].forEach((p, i) => {
    const s = fxSpan(kind === "sparks" ? "burst" : "p");
    s.style.cssText = "--x:" + p.x.toFixed(1) + "%;--yf:" + p.y.toFixed(3) + ";--d:" + p.delay.toFixed(2) + "s;--t:" + p.dur.toFixed(2) + "s;--s:" + p.size.toFixed(2) + (kind === "sparks" ? ";--c:" + X.colours[i % X.colours.length] : "");
    if (kind === "sparks") for (const a of X.rays) { const r = fxSpan("ray"); r.style.setProperty("--a", a + "deg"); s.appendChild(r); }
    el.appendChild(s);
  });
  return el;
}
function placeFx(c) {
  if (!c.clip || !c.clip.fx) return;
  for (const el of c.els) {
    el.querySelector(".fx")?.remove();
    el.appendChild(fxLayer(c.clip.fx, size.w, size.h));
  }
}
const ms = (steps) => steps.reduce((s, x) => s + x.ms, 0);

// The clips' own clock, as engine/clips.ts clipFrameAt does it.
function frameAt(clip, t) {
  let x = 0;
  for (const st of clip.steps) {
    if (t < st.ms) return { f: st.f, x: x + ((st.vx || 0) * t) / 1000 };
    t -= st.ms;
    x += ((st.vx || 0) * st.ms) / 1000;
  }
  if (clip.loop && clip.loop.length) {
    t %= ms(clip.loop);
    for (const st of clip.loop) { if (t < st.ms) return { f: st.f, x }; t -= st.ms; }
  }
  const last = clip.steps[clip.steps.length - 1] || clip.loop[0];
  return { f: last.f, x };
}

// Talking, as engine/talk.ts does it, fed by simulated words.
function makeTalker() {
  const NEXT = { default: ["small", "wide", "closed"], closed: ["small", "wide", "small"], small: ["wide", "closed", "closed"], wide: ["small", "closed", "small"] };
  const FACE = { default: "face.default", closed: "face.talk-closed", small: "face.talk-small", wide: "face.talk-wide" };
  let mouth = "default", mouthUntil = 0, gesture = 0, gestureUntil = 0, nextPulse = 0, lastPulse = -1e9, pauseUntil = 0;
  return (now) => {
    if (now >= nextPulse) {
      if (Math.random() < 0.08) pauseUntil = now + 500 + Math.random() * 500;
      if (now >= pauseUntil) lastPulse = now;
      nextPulse = now + 60 + Math.random() * 90;
    }
    if (now - lastPulse > 280) { mouth = "default"; mouthUntil = 0; }
    else if (now >= mouthUntil) { const o = NEXT[mouth]; mouth = o[Math.floor(Math.random() * o.length)]; mouthUntil = now + 80 + Math.random() * 90; }
    if (now >= gestureUntil) {
      const pick = Math.floor(Math.random() * 8); const g = pick > 6 ? 0 : pick;
      gesture = g === gesture ? (g + 1) % 7 : g; gestureUntil = now + 1500 + Math.random() * 1600;
    }
    return gesture === 0 ? FACE[mouth] : "talk." + gesture + "-" + mouth;
  };
}

const cards = [];
const main = document.getElementById("main");
const short = (f) => f.replace(/^base:(\d+):(\d+)$/, "live $1·$2").replace(/^[a-z]+\./, "");

for (const g of D.groups) {
  const sec = document.createElement("section");
  sec.innerHTML = "<h2></h2>" + (g.note ? '<p class="note"></p>' : "") + '<div class="grid"></div>';
  sec.querySelector("h2").textContent = g.title;
  if (g.note) sec.querySelector(".note").textContent = g.note;
  const grid = sec.querySelector(".grid");
  for (const clip of g.clips) {
    const wide = clip.steps.some((s) => s.vx);
    const card = document.createElement("article");
    card.className = "card" + (wide ? " wide" : "");
    card.innerHTML = '<div class="stage"><div class="tile light"><div class="amr"></div></div><div class="tile dark"><div class="amr"></div></div></div><div class="meta"><h3></h3><p class="trigger"></p><div class="xsheet"><i class="head"></i></div><p class="facts"></p></div>';
    card.querySelector("h3").textContent = clip.name;
    card.querySelector(".trigger").textContent = clip.trigger;
    const xs = card.querySelector(".xsheet");
    const steps = clip.driven ? [] : [...clip.steps.map((s) => ({ ...s, loop: false })), ...(clip.loop || []).map((s) => ({ ...s, loop: true }))];
    const total = ms(steps) || 1;
    for (const st of steps) {
      const span = document.createElement("span");
      span.style.flex = String(st.ms);
      span.textContent = short(st.f);
      span.title = st.f + " · " + st.ms + " ms";
      if (st.loop) span.classList.add("loop");
      xs.insertBefore(span, xs.querySelector(".head"));
    }
    if (clip.driven) {
      const span = document.createElement("span");
      span.style.flex = "1";
      span.classList.add("loop");
      span.textContent = clip.driven === "talk" ? "picked live: mouth by the text's rhythm, gesture every ~2 s" : "picked live: hang · swing · flail by drag speed";
      xs.insertBefore(span, xs.querySelector(".head"));
    }
    const playMs = ms(clip.steps);
    const facts = clip.driven
      ? "driven by code · still: " + clip.still
      : (clip.loop ? "way in " + (playMs / 1000).toFixed(2) + " s, then loops " + (ms(clip.loop) / 1000).toFixed(2) + " s" : (playMs / 1000).toFixed(2) + " s") + " · " + steps.length + " cells · still: " + short(clip.still);
    card.querySelector(".facts").textContent = facts;
    if (clip.name === "hold.dozing") card.querySelectorAll(".tile").forEach((t) => { const z = document.createElement("span"); z.className = "zzz"; z.textContent = "z z Z"; t.appendChild(z); });
    grid.appendChild(card);
    cards.push({ clip, els: [...card.querySelectorAll(".amr")], head: card.querySelector(".head"), total, playMs, talker: clip.driven === "talk" ? makeTalker() : null, swing: { a: 0, v: 0 }, t0: performance.now() });
    if (clip.fx) {
      card.querySelectorAll(".tile").forEach((t) => t.classList.add("fxs"));
      placeFx(cards[cards.length - 1]);
    }
  }
  main.appendChild(sec);
}

// Every frame of every pack.
const all = document.createElement("section");
all.innerHTML = '<h2>Every frame</h2><p class="note">Pack by pack, as they load on the site. Sizes are the 1× and 2× WebP files.</p>';
const KB = (n) => Math.round(n / 1024) + " KB";
for (const [id, p] of Object.entries(D.packs)) {
  const t = document.createElement("p");
  t.className = "pack-title";
  t.innerHTML = id + " <small></small>";
  t.querySelector("small").textContent = p.frames + " frames";
  all.appendChild(t);
  const grid = document.createElement("div");
  grid.className = "frames";
  for (const [fid, [pack]] of Object.entries(D.frames)) {
    if (pack !== id) continue;
    const fr = document.createElement("div");
    fr.className = "frame";
    fr.innerHTML = '<div class="tile light"><div class="amr"></div></div><code></code>';
    fr.querySelector("code").textContent = fid;
    grid.appendChild(fr);
    cards.push({ still: fid, els: [fr.querySelector(".amr")], small: true });
  }
  all.appendChild(grid);
}
main.appendChild(all);

// Identity: the live idle beside the generated stance and a talking gesture.
const ident = document.getElementById("identity");
for (const [ref, cap] of [["base:0:0", "Live sheet, idle (the identity reference, a 1× cell scaled up)"], ["face.default", "New: S01, his default face"], ["talk.5-default", "New: S02 gesture with the S01 head"]]) {
  const fig = document.createElement("figure");
  fig.innerHTML = '<div class="stage"><div class="tile light"><div class="amr"></div></div><div class="tile dark"><div class="amr"></div></div></div><figcaption></figcaption>';
  fig.querySelector("figcaption").textContent = cap;
  ident.appendChild(fig);
  cards.push({ still: ref, els: [...fig.querySelectorAll(".amr")], big: true });
}

// Hair: each head (hair to chin) under the live sheet's head from the angles of
// docs/mascot/reference/ref-hair.png. scripts/build-mascot-packs.py's hair@2x.png is the same check.
const HAIR_ANGLES = [[0, 0], [2, 3], [1, 3], [9, 0], [10, 0], [9, 6], [10, 2], [10, 6]];
const cellCanvas = document.createElement("canvas");
const loadImg = (src) => new Promise((ok, no) => { const im = new Image(); im.onload = () => ok(im); im.onerror = no; im.src = src; });
function headTile(img, idx, k, label, cellH = CELL.h) {
  const cw = CELL.w * k, ch = cellH * k;
  cellCanvas.width = cw; cellCanvas.height = ch;
  const g = cellCanvas.getContext("2d", { willReadFrequently: true });
  g.drawImage(img, (idx % D.columns) * cw, Math.floor(idx / D.columns) * ch, cw, ch, 0, 0, cw, ch);
  // Centred on his hair (its dark pixels), so a pointing arm or raised hands don't pull
  // the crop away; build-mascot-packs.py's head_crop does the same.
  let top = (19 + cellH - CELL.h) * k, cx = 96 * k; // the standing head, if the pixels can't be read back
  try {
    const a = g.getImageData(0, 0, cw, ch).data;
    const at = (x, y) => (y * cw + x) * 4;
    const dark = (x, y) => {
      const i = at(x, y), r = a[i], gr = a[i + 1], b = a[i + 2];
      return a[i + 3] > 200 && 299 * r + 587 * gr + 114 * b < 70000 && Math.max(r, gr, b) - Math.min(r, gr, b) < 45;
    };
    let t = -1;
    for (let y = 0; y < ch && t < 0; y++) for (let x = 0; x < cw; x++) if (a[at(x, y) + 3] > 32) { t = y; break; }
    if (t >= 0) {
      const xs = [];
      for (let y = t; y < Math.min(ch, t + 80 * k); y++) for (let x = 0; x < cw; x++) if (dark(x, y)) xs.push(x);
      top = t - 6 * k;
      if (xs.length >= 20 * k * k) {
        xs.sort((p, q) => p - q);
        cx = xs[xs.length >> 1];
        for (let y = 0; y < ch; y++) {
          let n = 0;
          for (let x = Math.max(0, cx - 20 * k); x < Math.min(cw, cx + 20 * k); x++) if (dark(x, y)) n++;
          if (n >= 5 * k) { top = y - 6 * k; break; }
        }
      }
    }
  } catch { /* a page opened from disk can't read its pixels back */ }
  const fig = document.createElement("figure");
  const cv = document.createElement("canvas");
  cv.width = 224; cv.height = 192;
  const out = cv.getContext("2d");
  out.imageSmoothingQuality = "high";
  out.drawImage(cellCanvas, cx - 56 * k, top, 112 * k, 96 * k, 0, 0, 224, 192);
  const cap = document.createElement("figcaption");
  cap.textContent = label;
  fig.append(cv, cap);
  return fig;
}
async function hairCheck() {
  const box = document.getElementById("hair");
  const row = (live) => { const r = document.createElement("div"); r.className = "hair-row" + (live ? " live" : ""); box.appendChild(r); return r; };
  const base = await loadImg(D.base);
  const liveRow = row(true);
  for (const [r, c] of HAIR_ANGLES) liveRow.appendChild(headTile(base, r * 8 + c, 1, "live " + r + "·" + c));
  for (const [id, p] of Object.entries(D.packs)) {
    const img = await loadImg(p.src2x);
    const r = row(false);
    for (const [fid, [pack, idx]] of Object.entries(D.frames)) if (pack === id) r.appendChild(headTile(img, idx, 2, fid, D.cell.h));
  }
}
hairCheck();

function draw(now) {
  for (const c of cards) {
    if (c.still) {
      const w = c.big ? 264 : c.small ? 96 : size.w, h = c.big ? 286 : c.small ? 104 : size.h;
      c.els.forEach((el) => paint(el, c.still, w, h));
      continue;
    }
    const clip = c.clip;
    let ref, x = 0, rot = 0, head = null;
    if (!playing) {
      ref = clip.driven === "lifted" ? "lifted.hang" : clip.still;
    } else if (clip.driven === "talk") {
      ref = c.talker(now);
    } else if (clip.driven === "lifted") {
      const t = (now - c.t0) / 1000;
      const vx = 1500 * Math.sin(t * 1.3) * Math.min(1, 0.4 + 0.6 * Math.abs(Math.sin(t * 0.37)));
      const v = Math.abs(vx);
      ref = v > 1400 ? "lifted.flail" : v < 140 ? "lifted.hang" : vx > 0 ? "lifted.swing-l" : "lifted.swing-r";
      const target = Math.max(-9, Math.min(9, vx * 0.008));
      c.swing.v += ((target - c.swing.a) * 90 - c.swing.v * 7) / 60;
      c.swing.a += c.swing.v / 60;
      rot = c.swing.a;
    } else {
      const rest = clip.loop ? 0 : 700;
      const cycle = clip.loop ? Math.max(c.total + ms(clip.loop) * 2, 3200) : c.playMs + rest;
      const t = (now - c.t0) % cycle;
      if (!clip.loop && t >= c.playMs) { ref = "base:0:0"; head = 1; }
      else { const fr = frameAt(clip, t); ref = fr.f; x = fr.x; head = Math.min(1, t / c.total); }
    }
    c.els.forEach((el) => {
      paint(el, ref, size.w, size.h);
      const px = (x * size.w) / CELL.w;
      const tf = (px ? "translateX(" + px.toFixed(1) + "px) " : "") + (rot ? "rotate(" + rot.toFixed(2) + "deg)" : "");
      if (el._tf !== tf) { el._tf = tf; el.style.transform = tf; el.style.transformOrigin = "50% 12%"; }
    });
    if (c.head) c.head.style.left = head === null ? "0" : "calc(" + (head * 100).toFixed(2) + "% - 2px)";
  }
  if (playing) requestAnimationFrame(draw);
}

function setPressed(a, b, on) { a.setAttribute("aria-pressed", String(on)); b.setAttribute("aria-pressed", String(!on)); }
const $ = (id) => document.getElementById(id);
$("size-desktop").onclick = () => { size = { w: 132, h: 143 }; setPressed($("size-desktop"), $("size-phone"), true); cards.forEach(placeFx); draw(performance.now()); };
$("size-phone").onclick = () => { size = { w: 96, h: 104 }; setPressed($("size-desktop"), $("size-phone"), false); cards.forEach(placeFx); draw(performance.now()); };
$("sharp-1").onclick = () => { sharp = false; setPressed($("sharp-1"), $("sharp-2"), true); draw(performance.now()); };
$("sharp-2").onclick = () => { sharp = true; setPressed($("sharp-1"), $("sharp-2"), false); draw(performance.now()); };
const play = $("play");
play.textContent = playing ? "Pause" : "Play";
play.onclick = () => { playing = !playing; play.textContent = playing ? "Pause" : "Play"; document.body.classList.toggle("paused", !playing); if (playing) requestAnimationFrame(draw); else draw(performance.now()); };
document.body.classList.toggle("paused", !playing);
draw(performance.now());
</script>
`;

writeFileSync(
  path.join(out, "index.html"),
  PAGE.replace("__FX_CSS__", () => FX_CSS).replace("__DATA__", () =>
    JSON.stringify(data).replace(/</g, "\\u003c")
  ),
  "utf8"
);
console.log(`review page: ${path.join(out, "index.html")} (+ ${files.length} images in mascot/)`);
