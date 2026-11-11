// @vitest-environment node
/**
 * The cast's one vocabulary of moves (lib/cast/clips.ts): small turns within
 * the build contract's ranges, short moves that start and end at rest, and
 * guess reactions with nothing sad or mocking in them.
 */

import { readFileSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";

import {
  CLIPS,
  LIMITS,
  PACE,
  SIG_NAMES,
  clipFor,
  turnLimit,
  type Clip,
  type Layer,
  type Track,
} from "@/lib/cast/clips";

const clips = Object.values(CLIPS);
const layersOf = (clip: Clip): Layer[] =>
  [clip, clip.first, clip.armless].filter((l): l is Layer => Boolean(l));
const tracksOf = (clip: Clip): Track[] => layersOf(clip).flatMap((l) => l.tracks);

describe("the limits", () => {
  it("are the approved numbers", () => {
    expect(LIMITS).toEqual({
      headDeg: 10,
      lookDeg: 8,
      shoulderDeg: 15,
      hipDeg: 10,
      tailDeg: 15,
      earDeg: 12,
      leanDeg: 4,
      risePx: 12,
      maxMs: 900,
      awakePhone: 3,
      awakeWide: 6,
      guessDelayMs: 250,
      staggerMs: 80,
    });
    expect(LIMITS.lookDeg).toBeLessThanOrEqual(LIMITS.headDeg);
    expect(PACE.cooldownMs).toBe(LIMITS.maxMs);
    expect(PACE.lookLeanDeg).toBeLessThanOrEqual(LIMITS.leanDeg);
  });

  it("match the turns the build contract states (docs/cast/CAST-BUILD.md)", () => {
    const doc = readFileSync(path.join(process.cwd(), "docs/cast/CAST-BUILD.md"), "utf8");
    const stated = (label: string) => {
      const m = new RegExp(`${label} ±(\\d+)°`).exec(doc);
      expect(m, label).not.toBeNull();
      return Number(m![1]);
    };
    expect(stated("head")).toBe(turnLimit("head"));
    expect(stated("an arm")).toBe(turnLimit("arm-r"));
    expect(stated("hip")).toBe(turnLimit("leg-l"));
    expect(stated("tail")).toBe(turnLimit("tail"));
    expect(stated("ears")).toBe(turnLimit("ear-r"));
    expect(stated("tie")).toBe(turnLimit("tie"));
    expect(stated("cord")).toBe(turnLimit("cord"));
    expect(stated("a tentacle or spider leg")).toBe(turnLimit("limb-3"));
  });
});

describe("the module", () => {
  it("loads under Node's type stripping: type-only imports, no @/ alias", () => {
    const src = readFileSync(path.join(process.cwd(), "src/lib/cast/clips.ts"), "utf8");
    const imports = src.match(/^import .*$/gm) ?? [];
    expect(imports).toEqual(['import type { SocketId, SwapKey } from "./rig-types";']);
    expect(src).not.toMatch(/\benum\b|\bnamespace\b/);
  });
});

describe("every clip", () => {
  it("is keyed by its id, and every signature name has one", () => {
    for (const [id, clip] of Object.entries(CLIPS)) expect(clip.id).toBe(id);
    for (const name of SIG_NAMES) expect(clipFor(`sig.${name}`), name).not.toBeNull();
    expect(clipFor("sig.nope")).toBeNull();
    expect(clipFor("toString")).toBeNull();
  });

  it("is short: a move is at most LIMITS.maxMs (the idle loops are CSS)", () => {
    for (const clip of clips) {
      if (clip.id.startsWith("idle.")) continue;
      expect(clip.ms, clip.id).toBeGreaterThan(0);
      expect(clip.ms, clip.id).toBeLessThanOrEqual(LIMITS.maxMs);
    }
  });

  it("starts and ends at rest, with its moments in order", () => {
    for (const clip of clips) {
      for (const track of tracksOf(clip)) {
        const ts = track.keys.map((k) => k.t);
        expect(ts[0], clip.id).toBe(0);
        expect(ts[ts.length - 1], clip.id).toBe(1);
        for (let i = 1; i < ts.length; i++) expect(ts[i], clip.id).toBeGreaterThan(ts[i - 1]);
        for (const k of [track.keys[0], track.keys[track.keys.length - 1]]) {
          expect(Object.keys(k), clip.id).toEqual(["t"]);
        }
      }
    }
  });

  it("turns each socket within its range, and rises no more than LIMITS.risePx", () => {
    for (const clip of clips) {
      for (const track of tracksOf(clip)) {
        for (const k of track.keys) {
          if (track.socket !== "pupils") {
            expect(Math.abs(k.rotate ?? 0), `${clip.id} ${track.socket}`).toBeLessThanOrEqual(
              turnLimit(track.socket)
            );
            expect(Math.abs(k.x ?? 0), clip.id).toBeLessThanOrEqual(LIMITS.risePx);
            expect(Math.abs(k.y ?? 0), clip.id).toBeLessThanOrEqual(LIMITS.risePx);
          } else {
            // A share of the rig's own pupil travel.
            expect(Math.abs(k.x ?? 0)).toBeLessThanOrEqual(1);
            expect(Math.abs(k.y ?? 0)).toBeLessThanOrEqual(1);
            expect(k.rotate).toBeUndefined();
          }
          for (const s of [k.sx ?? 1, k.sy ?? 1]) {
            expect(Math.abs(s - 1), clip.id).toBeLessThanOrEqual(0.1);
          }
        }
      }
    }
  });

  it("moves at most ten parts at once", () => {
    for (const clip of clips) {
      const sockets = new Set(tracksOf(clip).map((t) => t.socket));
      expect(sockets.size, clip.id).toBeLessThanOrEqual(10);
    }
  });

  it("shows each swap within the clip and names a real slot", () => {
    for (const clip of clips) {
      for (const layer of layersOf(clip)) {
        for (const swap of layer.swaps ?? []) {
          expect(swap.key).toMatch(/^(eyes|mouth|arm-r|arm-l|fan)\.[a-z-]+$/);
          expect(swap.from).toBeGreaterThanOrEqual(0);
          expect(swap.to).toBeLessThanOrEqual(1);
          expect(swap.to).toBeGreaterThan(swap.from);
        }
      }
    }
  });
});

describe("the guess reactions", () => {
  const guess = [CLIPS["guess.matched"], CLIPS["guess.differed"], CLIPS["guess.skipped"]];

  it("show only glad, surprised or open faces and poses: nothing sad or mocking", () => {
    const allowed = new Set([
      "eyes.happy",
      "eyes.wide",
      "mouth.smile",
      "mouth.o",
      "arm-r.up",
      "arm-l.up",
      "arm-r.open",
      "arm-l.open",
    ]);
    for (const clip of guess) {
      for (const layer of layersOf(clip)) {
        for (const swap of layer.swaps ?? []) expect(allowed.has(swap.key), swap.key).toBe(true);
      }
    }
    expect(JSON.stringify(guess)).not.toMatch(/sad|frown|cry|mock|smirk|sneer|laugh|angry|wrong/i);
  });

  it("are glad for a match, a friendly surprise for a difference, a shrug for a skip", () => {
    const keys = (clip: Clip) => (clip.swaps ?? []).map((s) => s.key);
    expect(keys(CLIPS["guess.matched"])).toEqual(["eyes.happy", "mouth.smile"]);
    expect(keys(CLIPS["guess.differed"])).toEqual(["eyes.wide", "mouth.o"]);
    expect(keys(CLIPS["guess.skipped"])).toEqual(["arm-r.open", "arm-l.open"]);
    // The first speaker hops with both arms up on a match.
    const first = CLIPS["guess.matched"].first!;
    expect(first.swaps!.map((s) => s.key)).toEqual(["arm-r.up", "arm-l.up"]);
    expect(Math.min(...first.tracks[0].keys.map((k) => k.y ?? 0))).toBe(-LIMITS.risePx);
    // An armless rig tilts its head instead of shrugging.
    expect(CLIPS["guess.skipped"].armless!.tracks[0].socket).toBe("head");
  });
});

describe("the signature moves", () => {
  it("show a prop for 0.6 s and sway the limbs in turn", () => {
    const prop = CLIPS["sig.prop"].swaps![0];
    expect(prop.key).toBe("arm-l.sig");
    expect(Math.round((prop.to - prop.from) * CLIPS["sig.prop"].ms)).toBe(600);
    const ripple = CLIPS["sig.ripple"].tracks;
    expect(ripple.map((t) => t.socket)).toEqual([1, 2, 3, 4, 5, 6, 7, 8].map((n) => `limb-${n}`));
    const peaks = ripple.map((t) => t.keys[1].t);
    for (let i = 1; i < peaks.length; i++) expect(peaks[i]).toBeGreaterThan(peaks[i - 1]);
  });
});
