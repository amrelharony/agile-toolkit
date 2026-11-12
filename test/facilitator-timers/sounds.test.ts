/**
 * The facilitator's sounds (lib/facilitator-timers/sounds.ts) are made with
 * Web Audio, never loaded from files: each soundboard sound schedules its
 * own tones and noise on a fresh context that closes after, a focus sound
 * loops until stopped, and without Web Audio nothing breaks.
 */

import { readFileSync } from "node:fs";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  FOCUS_SOUNDS,
  SOUNDBOARD_SECONDS,
  SOUNDBOARD_SOUNDS,
  canPlaySounds,
  fillNoise,
  playSoundboard,
  startFocusSound,
} from "@/lib/facilitator-timers/sounds";
import { createRng } from "@/lib/utils/random";

/** A stand-in AudioContext that records what is made and started. */
class FakeParam {
  value = 0;
  setValueAtTime = vi.fn();
  exponentialRampToValueAtTime = vi.fn();
  linearRampToValueAtTime = vi.fn();
  setTargetAtTime = vi.fn();
}
class FakeNode {
  connect = vi.fn((n: unknown) => n);
}
class FakeSource extends FakeNode {
  buffer: unknown = null;
  loop = false;
  frequency = new FakeParam();
  type = "";
  start = vi.fn();
  stop = vi.fn();
}
const made = { contexts: [] as FakeContext[] };
class FakeContext {
  currentTime = 0;
  sampleRate = 8000;
  destination = new FakeNode();
  sources: FakeSource[] = [];
  close = vi.fn(async () => undefined);
  constructor() {
    made.contexts.push(this);
  }
  createGain() {
    return Object.assign(new FakeNode(), { gain: new FakeParam() });
  }
  createOscillator() {
    const o = new FakeSource();
    this.sources.push(o);
    return o;
  }
  createBufferSource() {
    const s = new FakeSource();
    this.sources.push(s);
    return s;
  }
  createBiquadFilter() {
    return Object.assign(new FakeNode(), {
      type: "",
      frequency: new FakeParam(),
      Q: new FakeParam(),
    });
  }
  createBuffer(_channels: number, length: number, rate: number) {
    const data = new Float32Array(length);
    return { duration: length / rate, getChannelData: () => data };
  }
}

beforeEach(() => {
  vi.useFakeTimers();
  made.contexts = [];
  vi.stubGlobal("AudioContext", FakeContext);
});
afterEach(() => {
  vi.unstubAllGlobals();
  vi.useRealTimers();
});

describe("the soundboard", () => {
  it.each(SOUNDBOARD_SOUNDS)("plays %s on its own context, then closes it", (sound) => {
    expect(playSoundboard(sound)).toBe(true);
    const [ctx] = made.contexts;
    expect(ctx.sources.length).toBeGreaterThan(0);
    for (const s of ctx.sources) expect(s.start).toHaveBeenCalled();
    expect(ctx.close).not.toHaveBeenCalled();
    vi.advanceTimersByTime((SOUNDBOARD_SECONDS[sound] + 0.5) * 1000);
    expect(ctx.close).toHaveBeenCalledTimes(1);
  });

  it("does nothing without Web Audio", () => {
    vi.stubGlobal("AudioContext", undefined);
    expect(canPlaySounds()).toBe(false);
    expect(playSoundboard("gong")).toBe(false);
    expect(startFocusSound("rain", 0.5)).toBeNull();
  });
});

describe("focus sounds", () => {
  it.each(FOCUS_SOUNDS)("loops %s until stopped, then fades and closes", (sound) => {
    const handle = startFocusSound(sound, 0.5);
    expect(handle?.sound).toBe(sound);
    const [ctx] = made.contexts;
    const loop = ctx.sources.find((s) => s.loop);
    expect(loop?.start).toHaveBeenCalled();
    handle!.setVolume(0.2);
    handle!.stop();
    handle!.stop();
    vi.advanceTimersByTime(500);
    expect(loop?.stop).toHaveBeenCalledTimes(1);
    expect(ctx.close).toHaveBeenCalledTimes(1);
  });
});

describe("noise", () => {
  it.each(["white", "pink", "brown"] as const)("keeps %s noise within -1 to 1", (colour) => {
    const out = fillNoise(new Float32Array(4000), colour, createRng(7));
    expect(Math.max(...out)).toBeLessThanOrEqual(1);
    expect(Math.min(...out)).toBeGreaterThanOrEqual(-1);
    expect(out.some((v) => v !== 0)).toBe(true);
  });
});

describe("no audio files", () => {
  it("the sounds, the soundboard and the tool load no audio from anywhere", () => {
    const files = [
      "src/lib/facilitator-timers/sounds.ts",
      "src/components/soundboard/soundboard-buttons.tsx",
      "src/components/presentation/soundboard-dock.tsx",
      "src/app/(tools)/facilitator-timers/sounds-card.tsx",
      "src/app/(tools)/facilitator-timers/facilitator-timers-client.tsx",
    ];
    for (const rel of files) {
      const src = readFileSync(path.join(process.cwd(), rel), "utf8");
      expect(src, rel).not.toMatch(/new Audio\(|\.(mp3|wav|ogg|m4a)\b|decodeAudioData|fetch\(/);
    }
  });
});
