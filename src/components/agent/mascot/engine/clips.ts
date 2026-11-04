/**
 * Amr's clips: the frame-by-frame timing of every reaction and held pose drawn
 * for the interactive pet (docs/mascot/AMR-ART-BRIEF.md, sheets S01–S10). The
 * frames live in the lazy packs (mascot-packs.ts); a few borrow a cell of the
 * live sheet (`base:<row>:<col>`). Pure data, with type-only imports, so the
 * review page builder can load it with Node's type stripping.
 *
 * The art never moves him: hops, swings and the stroll's travel are code. A step
 * with `vx` slides him sideways (sheet px per second) while it shows.
 */

import type { FrameId } from "../mascot-packs";
import type { MascotHold, MascotReaction } from "@/lib/agent/mascot/store";
import type { SpritePose } from "./sprite-poses";

/** A cell of the live sheet. */
export type BaseRef = `base:${number}:${number}`;
export type FrameRef = FrameId | BaseRef;

export interface Step {
  f: FrameRef;
  ms: number;
  /** Slide sideways while this step shows, in sheet px per second. */
  vx?: number;
}

export interface Clip {
  name: string;
  /** Played once: the whole of a reaction, or a hold's way in. */
  steps: readonly Step[];
  /** A hold repeats these after `steps` for as long as it lasts. */
  loop?: readonly Step[];
  /** The one frame shown under reduced motion. */
  still: FrameRef;
  /** The live-sheet pose shown until the clip's pack has loaded. */
  fallback: SpritePose;
  /** Frames picked by code as it goes rather than by the clock. */
  driven?: "talk" | "lifted";
}

export const s = (f: FrameRef, ms: number, vx?: number): Step => (vx ? { f, ms, vx } : { f, ms });

/** These steps, `n` times over. */
export function times(n: number, ...steps: Step[]): Step[] {
  return Array.from({ length: n }, () => steps).flat();
}

export function clip(
  name: string,
  fallback: SpritePose,
  steps: Step[],
  extra: Partial<Pick<Clip, "loop" | "still" | "driven">> = {}
): Clip {
  return { name, fallback, steps, still: extra.still ?? steps[steps.length - 1].f, ...extra };
}

/** One step of the walk, both feet and the passing pose (stroll.*-2) between. */
const WALK_MS = 210;
/** Walking pace, sheet px per second (about 100 screen px over two strides). */
const WALK_V = 90;

function walk(dir: "l" | "r", strides: number): Step[] {
  const v = dir === "l" ? -WALK_V : WALK_V;
  return times(
    strides,
    s(`stroll.${dir}-1`, WALK_MS, v),
    s(`stroll.${dir}-2`, WALK_MS, v),
    s(`stroll.${dir}-3`, WALK_MS, v),
    s(`stroll.${dir}-2`, WALK_MS, v)
  );
}

/** A few steps out along the bottom of the screen, a look at the page, and back. */
function stroll(name: string, out: "l" | "r"): Clip {
  const back = out === "l" ? "r" : "l";
  return clip(
    name,
    out === "l" ? "running-left" : "running-right",
    [
      s("stroll.turn", 240),
      ...walk(out, 2),
      s("stroll.turn", 260),
      s("base:0:0", 1200),
      s("stroll.turn", 260),
      ...walk(back, 2),
      s("stroll.turn", 260),
    ],
    { still: "base:0:0" }
  );
}

export const STROLL_FROM_RIGHT = stroll("stroll", "l");
export const STROLL_FROM_LEFT = stroll("stroll.from-left", "r");

/** The reactions drawn for the interactive pet. The rest play live-sheet rows. */
export const ACT_CLIPS = {
  poke: clip("poke", "jumping", [s("touch.poke", 340), s("touch.giggle", 760)]),
  tickle: clip("tickle", "jumping", [
    ...times(5, s("touch.tickle-l", 150), s("touch.tickle-r", 150)),
    s("touch.giggle", 520),
  ]),
  patLeft: clip("patLeft", "review", [s("touch.pat-l", 1200)]),
  patRight: clip("patRight", "review", [s("touch.pat-r", 1200)]),
  bashful: clip("bashful", "waiting", [s("touch.bashful", 1700)]),
  highFive: clip("highFive", "waving", [s("social.hi5", 280), s("social.hi5-after", 760)]),
  land: clip("land", "jumping", [
    s("lifted.land", 170),
    s("lifted.recover", 280),
    s("lifted.tidy", 650),
  ]),
  startle: clip("startle", "jumping", [s("face.surprised", 900)]),
  happy: clip("happy", "review", [s("face.happy", 1300)]),
  concerned: clip("concerned", "failed", [s("face.concerned", 1800)]),
  lookAround: clip(
    "lookAround",
    "waiting",
    [s("face.surprised", 450), s("base:10:4", 450), s("base:9:4", 450), s("base:9:0", 300)],
    { still: "face.surprised" }
  ),
  dizzy: clip("dizzy", "failed", [
    ...times(5, s("dizzy.a", 220), s("dizzy.b", 220)),
    s("dizzy.shake-off", 650),
  ]),
  steady: clip("steady", "idle", [s("balance.steady", 1000)]),
  yes: clip("yes", "jumping", [s("page.yes", 1200)]),
  clap: clip(
    "clap",
    "jumping",
    [...times(4, s("page.clap-a", 160), s("page.clap-b", 160)), s("page.yes", 450)],
    { still: "page.clap-b" }
  ),
  downcast: clip("downcast", "failed", [s("page.downcast", 2000)]),
  shrug: clip("shrug", "failed", [s("explain.shrug", 1500)]),
  thumbsUp: clip("thumbsUp", "review", [s("base:8:4", 1300)]),
  pointLeft: clip("pointLeft", "waving", [s("point.l", 1900)]),
  pointUpLeft: clip("pointUpLeft", "waving", [s("point.ul", 1900)]),
  pointUp: clip("pointUp", "waving", [s("point.u", 2400)]),
  pointUpRight: clip("pointUpRight", "waving", [s("point.ur", 1900)]),
  pointRight: clip("pointRight", "waving", [s("point.r", 1900)]),
  pointDownLeft: clip("pointDownLeft", "waving", [s("point.dl", 1900)]),
  pointDownRight: clip("pointDownRight", "waving", [s("point.dr", 1900)]),
  cheer: clip("cheer", "review", [s("social.you", 1500)]),
  bow: clip("bow", "waving", [s("social.bow", 1400)]),
  peekFound: clip("peekFound", "waving", [s("social.peek-found", 1000)]),
  yawn: clip("yawn", "waiting", [s("rest.yawn", 1500)]),
  stretch: clip("stretch", "waiting", [s("rest.yawn", 800), s("rest.stretch", 1500)]),
  wake: clip("wake", "jumping", [s("rest.startled", 650), s("rest.sit-down", 350)], {
    still: "rest.startled",
  }),
  standUp: clip("standUp", "idle", [s("rest.sit-down", 400)]),
  stroll: STROLL_FROM_RIGHT,
} satisfies Partial<Record<MascotReaction, Clip>>;

/** Held poses. */
export const HOLD_CLIPS: Record<MascotHold, Clip> = {
  highFive: clip("hold.highFive", "waving", [s("social.hi5-offer", 400)]),
  falling: clip("hold.falling", "jumping", [s("lifted.hang", 400)]),
  flying: clip("hold.flying", "jumping", [s("lifted.flail", 400)]),
  whoa: clip("hold.whoa", "jumping", [s("balance.whoa", 400)]),
  tipLeft: clip("hold.tipLeft", "idle", [s("balance.tip-l", 400)]),
  tipRight: clip("hold.tipRight", "idle", [s("balance.tip-r", 400)]),
  wind: clip("hold.wind", "waiting", [], {
    loop: [s("page.wind-a", 170), s("page.wind-b", 170)],
    still: "page.wind-a",
  }),
  peekHide: clip("hold.peekHide", "idle", [s("social.peek-hide", 400)]),
  watching: clip("hold.watching", "waiting", [s("page.watching", 400)]),
  dozing: clip("hold.dozing", "idle", [], {
    loop: [s("rest.doze-a", 1600), s("rest.doze-b", 1600)],
    still: "rest.doze-a",
  }),
  sitting: clip("hold.sitting", "idle", [s("rest.sit-down", 380)], {
    loop: [s("rest.sitting", 2000)],
    still: "rest.sitting",
  }),
};

/** Talking: S02 gestures with S01 mouths, picked by the lip-sync (engine/talk.ts). */
export const TALK_CLIP: Clip = clip("talk", "review", [s("face.default", 400)], {
  driven: "talk",
});

/** Carried: hanging, swinging or flailing with the drag's speed. */
export const LIFTED_CLIP: Clip = clip("lifted", "running-right", [s("lifted.hang", 400)], {
  driven: "lifted",
});

/** How long a clip's own steps take, in ms (a hold's loop excluded). */
export function clipMs(c: Clip): number {
  return c.steps.reduce((sum, st) => sum + st.ms, 0);
}

/**
 * The step showing `ms` into a clip, and how far its walking has carried him
 * (sheet px). Past its steps a hold cycles its loop; a reaction keeps its last frame.
 */
export function clipFrameAt(c: Clip, ms: number): { f: FrameRef; x: number } {
  let t = Math.max(0, ms);
  let x = 0;
  for (const st of c.steps) {
    if (t < st.ms) return { f: st.f, x: x + ((st.vx ?? 0) * t) / 1000 };
    t -= st.ms;
    x += ((st.vx ?? 0) * st.ms) / 1000;
  }
  if (c.loop && c.loop.length) {
    const cycle = c.loop.reduce((sum, st) => sum + st.ms, 0);
    t %= cycle;
    for (const st of c.loop) {
      if (t < st.ms) return { f: st.f, x };
      t -= st.ms;
    }
  }
  const last = c.steps[c.steps.length - 1] ?? c.loop?.[0];
  return { f: last ? last.f : c.still, x };
}

/** Every frame a clip can show. */
export function clipFrames(c: Clip): FrameRef[] {
  return [...c.steps, ...(c.loop ?? [])].map((st) => st.f).concat(c.still);
}
