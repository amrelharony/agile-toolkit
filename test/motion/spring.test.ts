// @vitest-environment node
/**
 * The live spring (lib/motion/spring.ts) that carries the hand's speed into a
 * landing. It is driven here through its pure step, so every number is exact;
 * the requestAnimationFrame runner gets a hand-cranked frame queue.
 */
import { afterEach, describe, expect, it, vi } from "vitest";
import {
  DEFAULT_REST,
  criticalSpring,
  isAtRest,
  runSpring,
  springFor,
  stepSpring,
  type Rest,
  type SpringState,
} from "@/lib/motion/spring";
import { DUR, EASE, SETTLE_SPRING, SPRING_STEPS, dampingRatio } from "@/lib/motion/tokens";

const FRAME = 1 / 60;

/** Step at 60 fps until rest (or `seconds` run out); every state along the way. */
function run(start: SpringState, target: number, presenting = false, seconds = 2): SpringState[] {
  const config = springFor(presenting);
  const states = [start];
  let s = start;
  for (let t = 0; t < seconds && !isAtRest(s, target); t += FRAME) {
    s = stepSpring(s, target, FRAME, config, presenting);
    states.push(s);
  }
  return states;
}

describe("the spring's constants", () => {
  it("is settle's spring from tokens.ts", () => {
    expect(springFor(false)).toBe(SETTLE_SPRING);
    expect(SETTLE_SPRING).toEqual({ stiffness: 1024, damping: 40, mass: 1 });
  });

  it("is critically damped while presenting, with the same stiffness and mass", () => {
    const calm = springFor(true);
    expect(calm.stiffness).toBe(SETTLE_SPRING.stiffness);
    expect(calm.mass).toBe(SETTLE_SPRING.mass);
    expect(calm.damping).toBe(64);
    expect(dampingRatio(calm)).toBe(1);
    expect(criticalSpring()).toEqual(calm);
  });

  it("traces the settle easing: released from rest, it passes the same points", () => {
    const ease = EASE.settle.slice("linear(".length, -1).split(", ").map(Number);
    const window = DUR.settle / 1000;
    let s: SpringState = { x: 0, v: 0 };
    for (let i = 1; i < SPRING_STEPS; i++) {
      s = stepSpring(s, 1, window / SPRING_STEPS);
      expect(s.x).toBeCloseTo(ease[i], 3);
    }
  });
});

describe("stepping", () => {
  it("is exact whatever the frame length: one long step equals many short ones", () => {
    let fine: SpringState = { x: 0, v: 900 };
    for (let i = 0; i < 30; i++) fine = stepSpring(fine, 120, 0.01);
    const coarse = stepSpring({ x: 0, v: 900 }, 120, 0.3);
    expect(fine.x).toBeCloseTo(coarse.x, 9);
    expect(fine.v).toBeCloseTo(coarse.v, 9);
  });

  it("does nothing for a zero or negative step", () => {
    const s = { x: 3, v: 7 };
    expect(stepSpring(s, 0, 0)).toBe(s);
    expect(stepSpring(s, 0, -1)).toBe(s);
  });

  it("comes to rest on its target, and is within half a pixel of it when the settle duration ends", () => {
    const states = run({ x: 0, v: 0 }, 100);
    const last = states.at(-1)!;
    expect(isAtRest(last, 100)).toBe(true);
    expect(Math.abs(last.x - 100)).toBeLessThanOrEqual(DEFAULT_REST.delta);
    // Within half a percent of the way by 320 ms, as the CSS settle ends there.
    const at = Math.round(DUR.settle / 1000 / FRAME);
    expect(Math.abs(states[at].x - 100)).toBeLessThan(0.5);
  });

  it("takes as long to rest as its decay allows: about 0.5 s from rest, 0.6 s for a flung panel", () => {
    // Settle's spring decays at 20/s (damping / 2·mass), so how long it takes
    // to count as at rest depends on the threshold. A reader panel 375 px off,
    // released at up to 4000 px/s either way, is the slowest case R2 meets.
    const restMs = (start: SpringState, rest: Rest) => {
      let s = start;
      let frames = 0;
      while (!isAtRest(s, 0, rest) && frames < 600) {
        s = stepSpring(s, 0, FRAME);
        frames++;
      }
      return (frames * 1000) / 60;
    };
    const panel = (rest: Rest) =>
      Math.max(
        ...[-375, -187, 187, 375].flatMap((x) =>
          [-4000, -2000, 0, 2000, 4000].map((v) => restMs({ x, v }, rest))
        )
      );
    expect(restMs({ x: -100, v: 0 }, DEFAULT_REST)).toBeLessThanOrEqual(520);
    expect(panel(DEFAULT_REST)).toBeGreaterThan(580);
    expect(panel(DEFAULT_REST)).toBeLessThanOrEqual(620);
    // R2 asks for rest within 300 ms. With these constants only a rest as
    // loose as 2 px and 60 px/s gets there; 1 px and 30 px/s does not.
    expect(panel({ delta: 2, speed: 60 })).toBeLessThanOrEqual(300);
    expect(panel({ delta: 1, speed: 30 })).toBeGreaterThan(300);
  });

  it("passes the target once, by about 8%, when let go from rest", () => {
    const peak = Math.max(...run({ x: 0, v: 0 }, 100).map((s) => s.x));
    expect(peak).toBeGreaterThan(106);
    expect(peak).toBeLessThan(110);
  });

  it("overshoots in the direction it was thrown", () => {
    const right = run({ x: 0, v: 400 }, 0).map((s) => s.x);
    expect(Math.max(...right)).toBeGreaterThan(5);
    expect(Math.min(...right)).toBeGreaterThan(-Math.max(...right));
    const left = run({ x: 0, v: -400 }, 0).map((s) => s.x);
    expect(Math.min(...left)).toBeLessThan(-5);
    // A throw toward the target carries it further past than letting go does.
    const thrown = Math.max(...run({ x: 0, v: 3000 }, 100).map((s) => s.x));
    const dropped = Math.max(...run({ x: 0, v: 0 }, 100).map((s) => s.x));
    expect(thrown).toBeGreaterThan(dropped);
  });

  it("never passes its target while presenting, even from a fast fling", () => {
    for (const v of [-4000, -500, 0, 500, 4000, 20000]) {
      const states = run({ x: 0, v }, 100, true);
      expect(Math.max(...states.map((s) => s.x)), `v ${v}`).toBeLessThanOrEqual(100);
      expect(isAtRest(states.at(-1)!, 100), `v ${v}`).toBe(true);
    }
    // Thrown from the target itself it moves off and comes back without crossing.
    const off = run({ x: 0, v: 300 }, 0, true).map((s) => s.x);
    expect(Math.min(...off)).toBeGreaterThanOrEqual(0);
  });
});

describe("runSpring", () => {
  let queue: Map<number, FrameRequestCallback>;
  let now = 0;
  let id = 0;

  function frame(ms = 1000 / 60) {
    now += ms;
    const callbacks = Array.from(queue.values());
    queue.clear();
    for (const cb of callbacks) cb(now);
  }

  function setup() {
    queue = new Map();
    now = 1000;
    id = 0;
    vi.stubGlobal("requestAnimationFrame", (cb: FrameRequestCallback) => {
      queue.set(++id, cb);
      return id;
    });
    vi.stubGlobal("cancelAnimationFrame", (n: number) => queue.delete(n));
    vi.spyOn(performance, "now").mockImplementation(() => now);
  }

  afterEach(() => {
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
  });

  it("steps each frame by the time since the last, then lands on the target and stops", () => {
    setup();
    const seen: number[] = [];
    const onRest = vi.fn();
    runSpring({ from: 0, to: 4, velocity: 0, onUpdate: (x) => seen.push(x), onRest });
    frame();
    expect(seen[0]).toBeCloseTo(stepSpring({ x: 0, v: 0 }, 4, 1 / 60).x, 12);
    for (let i = 0; i < 200 && queue.size > 0; i++) frame();
    expect(queue.size).toBe(0);
    expect(onRest).toHaveBeenCalledTimes(1);
    expect(seen.at(-1)).toBe(4);
  });

  it("stops at once on cancel", () => {
    setup();
    const onUpdate = vi.fn();
    const onRest = vi.fn();
    const cancel = runSpring({ from: 0, to: 4, velocity: 50, onUpdate, onRest });
    frame();
    cancel();
    cancel();
    frame();
    expect(onUpdate).toHaveBeenCalledTimes(1);
    expect(onRest).not.toHaveBeenCalled();
    expect(queue.size).toBe(0);
  });

  it("uses the presenting spring when asked, and never passes the target", () => {
    setup();
    const seen: number[] = [];
    runSpring({ from: 0, to: 4, velocity: 400, presenting: true, onUpdate: (x) => seen.push(x) });
    for (let i = 0; i < 200 && queue.size > 0; i++) frame();
    expect(Math.max(...seen)).toBeLessThanOrEqual(4);
    expect(seen.at(-1)).toBe(4);
  });
});
