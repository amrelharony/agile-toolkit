import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { MascotHold, MascotReaction } from "@/lib/agent/mascot/store";
import {
  DIZZY_TAPS,
  TICKLE_TAPS,
  createClickInteraction,
} from "@/components/agent/mascot/engine/interactions/clicks";
import {
  DWELL_MS,
  LONG_PRESS_MS,
  createTouchInteraction,
  zoneAt,
  type TouchPoint,
} from "@/components/agent/mascot/engine/interactions/touch";
import { isThanks } from "@/lib/agent/mascot/use-chat-reactions";

const BOX = { left: 100, top: 100, width: 60, height: 120 };
const at = (x: number, y: number, pointerType = "mouse"): TouchPoint => ({
  x,
  y,
  box: BOX,
  pointerType,
});
const HEAD = 110; // y inside the top third
const TUMMY = 180;

describe("taps", () => {
  let played: MascotReaction[];
  let clicks: ReturnType<typeof createClickInteraction>;

  beforeEach(() => {
    vi.useFakeTimers();
    played = [];
    clicks = createClickInteraction({
      playNow: (r) => played.push(r),
      sound: () => {},
    });
  });
  afterEach(() => {
    clicks.dispose();
    vi.useRealTimers();
  });

  it("pokes his tummy and pats his head, toward the side it lands on", () => {
    clicks.onClick("body", "left");
    vi.advanceTimersByTime(1100);
    clicks.onClick("head", "left");
    vi.advanceTimersByTime(1100);
    clicks.onClick("head", "right");
    expect(played).toEqual(["poke", "patLeft", "patRight"]);
  });

  it("tickles at three quick taps and makes him dizzy at seven", () => {
    for (let i = 0; i < DIZZY_TAPS; i++) {
      clicks.onClick("body");
      vi.advanceTimersByTime(150);
    }
    expect(played).toEqual(["poke", "tickle", "dizzy"]);
    expect(TICKLE_TAPS).toBe(3);
  });

  it("starts the count again after a pause", () => {
    clicks.onClick("body");
    clicks.onClick("body");
    vi.advanceTimersByTime(1100);
    clicks.onClick("body");
    expect(played).toEqual(["poke", "poke"]);
  });
});

describe("touching without tapping", () => {
  let played: MascotReaction[];
  let holds: Set<MascotHold>;
  let t: number;
  let touch: ReturnType<typeof createTouchInteraction>;

  beforeEach(() => {
    vi.useFakeTimers();
    played = [];
    holds = new Set();
    t = 0;
    touch = createTouchInteraction({
      playNow: (r) => played.push(r),
      hold: (h, on) => (on ? holds.add(h) : holds.delete(h)),
      sound: () => {},
      now: () => t,
    });
  });
  afterEach(() => {
    touch.dispose();
    vi.useRealTimers();
  });

  it("knows his head from his tummy", () => {
    expect(zoneAt(at(130, HEAD))).toBe("head");
    expect(zoneAt(at(130, TUMMY))).toBe("body");
  });

  it("offers a high five on a long-press and gives it on release", () => {
    touch.down(at(130, TUMMY, "touch"));
    vi.advanceTimersByTime(LONG_PRESS_MS + 10);
    expect(holds.has("highFive")).toBe(true);
    expect(touch.up()).toBe(true);
    expect(holds.has("highFive")).toBe(false);
    expect(played).toEqual(["highFive"]);
  });

  it("lets a short press through as a tap", () => {
    touch.down(at(130, TUMMY, "touch"));
    vi.advanceTimersByTime(200);
    expect(touch.up()).toBe(false);
    expect(played).toEqual([]);
  });

  it("drops the high five when the press becomes a drag", () => {
    touch.down(at(130, TUMMY, "touch"));
    touch.move(at(150, TUMMY, "touch"), true);
    vi.advanceTimersByTime(LONG_PRESS_MS + 10);
    expect(holds.size).toBe(0);
    touch.down(at(130, TUMMY, "touch"));
    vi.advanceTimersByTime(LONG_PRESS_MS + 10);
    touch.dragStart();
    expect(holds.size).toBe(0);
    expect(touch.up()).toBe(false);
  });

  it("turns bashful when a mouse rests on him, once per visit", () => {
    touch.move(at(130, TUMMY), false);
    vi.advanceTimersByTime(DWELL_MS + 10);
    expect(played).toEqual(["bashful"]);
    touch.move(at(131, TUMMY), false);
    vi.advanceTimersByTime(DWELL_MS + 10);
    expect(played).toEqual(["bashful"]);
  });

  it("ignores a finger resting on him (that's a long-press)", () => {
    touch.move(at(130, TUMMY, "touch"), false);
    vi.advanceTimersByTime(DWELL_MS + 10);
    expect(played).toEqual([]);
  });

  it("pats his head the way a mouse strokes across it", () => {
    for (let x = 100; x <= 160; x += 10) {
      t += 40;
      touch.move(at(x, HEAD), false);
    }
    expect(played).toEqual(["patRight"]);
    t += 2000;
    for (let x = 160; x >= 100; x -= 10) {
      t += 40;
      touch.move(at(x, HEAD), false);
    }
    expect(played).toEqual(["patRight", "patLeft"]);
  });

  it("doesn't count a wiggle on his head as a stroke", () => {
    for (const x of [120, 130, 120, 130, 120, 130]) {
      t += 40;
      touch.move(at(x, HEAD), false);
    }
    expect(played).toEqual([]);
  });
});

describe("thanks", () => {
  it("knows a thank-you when it sees one", () => {
    expect(isThanks("Thanks Amr!")).toBe(true);
    expect(isThanks("thank you, that worked")).toBe(true);
    expect(isThanks("shukran")).toBe(true);
    expect(isThanks("make a retro board")).toBe(false);
    expect(isThanks("tyranny")).toBe(false);
  });
});
