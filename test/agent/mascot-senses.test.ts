import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { MascotHold, MascotReaction } from "@/lib/agent/mascot/store";
import { createDirector } from "@/components/agent/mascot/engine/director";
import {
  DOZE_MS,
  HURRY_FACTOR,
  SIT_MS,
  YAWN_MS,
  createIdleLadder,
  firstMorningVisit,
  type IdleHooks,
} from "@/components/agent/mascot/engine/idle";
import {
  AWAY_MS,
  atPageEnd,
  createScrollSpeed,
  installPageSenses,
  type PageHooks,
} from "@/components/agent/mascot/engine/interactions/page";
import {
  LEAN_MAX,
  REST_MS,
  SKID_MAX,
  createBump,
  createFreeFall,
  createPose,
  createRest,
  createShake,
  createTilt,
  createTwist,
  feelsPhone,
  installMotionSenses,
  leanFor,
  restingFrame,
  screenPitch,
  screenTilt,
  skidFor,
} from "@/components/agent/mascot/engine/interactions/sensors";
import { tiltLook } from "@/components/agent/mascot/engine/sprite-poses";

describe("the director", () => {
  it("allows one unprompted reaction every 20 s, each with its own cooldown", () => {
    let t = 0;
    const d = createDirector(() => t);
    expect(d.allow("wind", 10_000)).toBe(true);
    t = 5_000;
    expect(d.allow("thumbsUp", 10_000)).toBe(false); // inside the shared gap
    t = 21_000;
    expect(d.allow("thumbsUp", 10_000)).toBe(true);
    t = 45_000;
    expect(d.allow("thumbsUp", 30_000)).toBe(false); // its own cooldown
    expect(d.allow("wind", 10_000)).toBe(true);
  });

  it("never plays the same one twice running within a minute", () => {
    let t = 0;
    const d = createDirector(() => t);
    expect(d.allow("wind", 0)).toBe(true);
    t = 25_000;
    expect(d.allow("wind", 0)).toBe(false);
    t = 61_000;
    expect(d.allow("wind", 0)).toBe(true);
  });

  it("lets urgent ones skip the gap", () => {
    let t = 0;
    const d = createDirector(() => t);
    d.allow("wind");
    t = 1000;
    expect(d.allow("downcast", 10_000, true)).toBe(true);
  });
});

function ladderHarness(hour = 14, extra: Partial<IdleHooks> = {}) {
  let t = 0;
  const acts: MascotReaction[] = [];
  const holds = new Set<MascotHold>();
  const wanted: string[] = [];
  let busy = false;
  const hooks: IdleHooks = {
    act: (r) => acts.push(r),
    playNow: (r) => acts.push(r),
    hold: (h, on) => (on ? holds.add(h) : holds.delete(h)),
    allow: () => true,
    busy: () => busy,
    canStroll: () => false,
    want: (p) => wanted.push(...p),
    now: () => t,
    hour: () => hour,
    random: () => 0.5,
    ...extra,
  };
  const ladder = createIdleLadder(hooks);
  const run = (to: number) => {
    while (t < to) {
      t += 1000;
      ladder.tick();
    }
  };
  return {
    ladder,
    acts,
    holds,
    wanted,
    run,
    setBusy: (b: boolean) => (busy = b),
    at: () => t,
  };
}

describe("the idle ladder", () => {
  it("yawns, sits, then dozes when nobody's around", () => {
    const h = ladderHarness();
    h.run(YAWN_MS + 1000);
    expect(h.acts).toEqual(["yawn"]);
    expect(h.wanted).toContain("rest");
    h.run(SIT_MS + 1000);
    expect(Array.from(h.holds)).toEqual(["sitting"]);
    h.run(DOZE_MS + 1000);
    expect(Array.from(h.holds)).toEqual(["dozing"]);
    expect(h.ladder.rest()).toBe("dozing");
  });

  it("wakes him, startled, at any input", () => {
    const h = ladderHarness();
    h.run(DOZE_MS + 1000);
    h.ladder.input();
    expect(h.holds.size).toBe(0);
    expect(h.acts.at(-1)).toBe("wake");
    expect(h.ladder.rest()).toBe("awake");
  });

  it("stands him up if he was only sitting", () => {
    const h = ladderHarness();
    h.run(SIT_MS + 1000);
    h.ladder.input();
    expect(h.acts.at(-1)).toBe("standUp");
  });

  it("tires sooner late at night", () => {
    const h = ladderHarness(23);
    h.run(YAWN_MS * 0.6 + 1000);
    expect(h.acts).toEqual(["yawn"]);
  });

  it("passes the time with a scene once per idle stretch, instead of a stroll", () => {
    let plays = 0;
    const h = ladderHarness(14, {
      canStroll: () => true,
      play: () => {
        plays += 1;
        return true;
      },
    });
    h.run(YAWN_MS - 1000);
    expect(plays).toBe(1);
    expect(h.acts).not.toContain("stroll");
    h.ladder.input();
    h.run(h.at() + YAWN_MS - 1000);
    expect(plays).toBe(2);
  });

  it("still strolls when there's no scene to play", () => {
    const h = ladderHarness(14, { canStroll: () => true, play: () => false });
    h.run(YAWN_MS - 1000);
    expect(h.acts).toContain("stroll");
  });

  it("stays awake while someone's engaged with him", () => {
    const h = ladderHarness();
    h.setBusy(true);
    h.run(DOZE_MS + 1000);
    expect(h.acts).toEqual([]);
    expect(h.holds.size).toBe(0);
  });

  it("tires sooner once the phone has been put down, and not once it's picked up", () => {
    const h = ladderHarness();
    h.ladder.hurry(true);
    h.run(YAWN_MS * HURRY_FACTOR + 1000);
    expect(h.acts).toEqual(["yawn"]);
    h.run(SIT_MS * HURRY_FACTOR + 1000);
    expect(Array.from(h.holds)).toEqual(["sitting"]);

    h.ladder.hurry(false);
    h.ladder.input();
    const from = h.at();
    h.run(from + YAWN_MS * HURRY_FACTOR + 1000);
    expect(h.acts).toEqual(["yawn", "standUp"]);
  });
});

describe("the morning stretch", () => {
  afterEach(() => localStorage.clear());

  it("comes once, on the first visit of a morning", () => {
    const morning = new Date(2026, 10, 4, 8, 30);
    expect(firstMorningVisit(morning)).toBe(true);
    expect(firstMorningVisit(morning)).toBe(false);
    expect(firstMorningVisit(new Date(2026, 10, 5, 15, 0))).toBe(false);
  });
});

describe("page moments", () => {
  it("measures scroll speed, ignoring a first jump", () => {
    const s = createScrollSpeed();
    expect(s.sample(0, 0)).toBe(0);
    expect(s.sample(100, 16)).toBeGreaterThan(2500);
    // A long pause starts over.
    expect(s.sample(5000, 2000)).toBe(0);
  });

  it("knows the end of a long page", () => {
    expect(atPageEnd(1200, 800, 2000)).toBe(true);
    expect(atPageEnd(600, 800, 2000)).toBe(false);
    // Too short to have an end worth pointing at.
    expect(atPageEnd(400, 800, 1200)).toBe(false);
  });

  describe("installPageSenses", () => {
    let acts: MascotReaction[];
    let holds: Set<MascotHold>;
    let dispose: () => void;
    let t: number;

    const install = (over: Partial<PageHooks> = {}) => {
      dispose = installPageSenses({
        act: (r) => acts.push(r),
        hold: (h, on) => (on ? holds.add(h) : holds.delete(h)),
        allow: () => true,
        isPhone: () => false,
        isOpen: () => false,
        parkedTop: () => false,
        reducedMotion: false,
        now: () => t,
        ...over,
      });
    };

    beforeEach(() => {
      vi.useFakeTimers();
      acts = [];
      holds = new Set();
      t = 0;
    });
    afterEach(() => {
      dispose?.();
      vi.useRealTimers();
    });

    it("thumbs-up a copy, cheers a sent form, saddens offline", () => {
      install();
      document.dispatchEvent(new Event("copy"));
      document.dispatchEvent(new Event("submit"));
      window.dispatchEvent(new Event("offline"));
      window.dispatchEvent(new Event("online"));
      expect(acts).toEqual(["thumbsUp", "yes", "downcast", "yes"]);
    });

    it("watches typing on the page, not in his own panel or on a phone", () => {
      install();
      const field = document.createElement("input");
      document.body.appendChild(field);
      field.dispatchEvent(new Event("input", { bubbles: true }));
      expect(holds.has("watching")).toBe(true);
      vi.advanceTimersByTime(3000);
      expect(holds.has("watching")).toBe(false);

      const panel = document.createElement("div");
      panel.setAttribute("data-agent-sheet-root", "");
      const inside = document.createElement("textarea");
      panel.appendChild(inside);
      document.body.appendChild(panel);
      inside.dispatchEvent(new Event("input", { bubbles: true }));
      expect(holds.has("watching")).toBe(false);
      field.remove();
      panel.remove();
    });

    it("plays peekaboo when the pointer leaves the window and comes back", () => {
      install();
      const root = document.documentElement;
      root.dispatchEvent(new MouseEvent("mouseleave", { relatedTarget: null }));
      vi.advanceTimersByTime(400);
      expect(holds.has("peekHide")).toBe(true);
      root.dispatchEvent(new MouseEvent("mouseenter"));
      expect(holds.has("peekHide")).toBe(false);
      expect(acts).toEqual(["peekFound"]);
    });

    it("skips peekaboo for a pointer that's barely gone", () => {
      install();
      const root = document.documentElement;
      root.dispatchEvent(new MouseEvent("mouseleave", { relatedTarget: null }));
      vi.advanceTimersByTime(100);
      root.dispatchEvent(new MouseEvent("mouseenter"));
      vi.advanceTimersByTime(1000);
      expect(holds.size).toBe(0);
      expect(acts).toEqual([]);
    });

    it("waves when the visitor comes back after a while", () => {
      install();
      const hidden = vi.spyOn(document, "hidden", "get");
      hidden.mockReturnValue(true);
      document.dispatchEvent(new Event("visibilitychange"));
      t = AWAY_MS + 1000;
      hidden.mockReturnValue(false);
      document.dispatchEvent(new Event("visibilitychange"));
      expect(acts).toEqual(["wave"]);
      hidden.mockRestore();
    });

    it("braces against the wind of a fast scroll until it settles", () => {
      install();
      let y = 0;
      const scrollY = vi.spyOn(window, "scrollY", "get").mockImplementation(() => y);
      for (let i = 0; i < 6; i++) {
        t += 16;
        y += 200; // 12,500 px/s
        window.dispatchEvent(new Event("scroll"));
      }
      expect(holds.has("wind")).toBe(true);
      vi.advanceTimersByTime(400);
      expect(holds.has("wind")).toBe(false);
      scrollY.mockRestore();
    });

    it("points back up at the end of a long page, once per page", () => {
      install();
      let y = 0;
      const scrollY = vi.spyOn(window, "scrollY", "get").mockImplementation(() => y);
      const docH = vi
        .spyOn(document.documentElement, "scrollHeight", "get")
        .mockImplementation(() => window.innerHeight * 3);
      const end = window.innerHeight * 2;
      for (y = 0; y <= end; y += window.innerHeight / 4) {
        t += 200;
        window.dispatchEvent(new Event("scroll"));
      }
      vi.advanceTimersByTime(500);
      window.dispatchEvent(new Event("scroll"));
      vi.advanceTimersByTime(500);
      expect(acts).toEqual(["pointUp"]);
      scrollY.mockRestore();
      docH.mockRestore();
    });

    it("obeys the director", () => {
      install({ allow: () => false });
      document.dispatchEvent(new Event("copy"));
      expect(acts).toEqual([]);
    });
  });
});

describe("feeling the phone", () => {
  it("reads sideways tilt however the phone is held", () => {
    // Flat on a table, right edge down 20°.
    expect(screenTilt(0, 20)).toBeCloseTo(20, 0);
    // Upright and level.
    expect(screenTilt(90, 0)).toBeCloseTo(0, 5);
    // Upright, turned like a steering wheel to the right (Euler angles as browsers report them).
    expect(screenTilt(70, 90)).toBeGreaterThan(15);
    // Landscape: the screen's own left and right.
    expect(Math.abs(screenTilt(0, 0, 90))).toBeLessThan(1);
  });

  it("tips at 15°, windmills past 35°, steadies under 8°", () => {
    const tilt = createTilt();
    expect(tilt.update(0, 0)).toBe("level");
    expect(tilt.update(12, 100)).toBe("level");
    expect(tilt.update(20, 200)).toBe("right");
    expect(tilt.update(-40, 300)).toBe("whoa");
    expect(tilt.update(-20, 400)).toBe("left");
    expect(tilt.update(1, 500)).toBe("level");
  });

  it("gets used to the way the phone is held", () => {
    const tilt = createTilt();
    tilt.update(0, 0);
    let state = tilt.update(25, 100);
    expect(state).toBe("right");
    for (let t = 200; t < 30_000; t += 200) state = tilt.update(25, t);
    expect(state).toBe("level");
  });

  it("counts three sharp jolts within a second as a shake", () => {
    const shake = createShake();
    expect(shake.sample(20, 0)).toBe(false);
    expect(shake.sample(5, 100)).toBe(false); // too gentle
    expect(shake.sample(20, 300)).toBe(false);
    expect(shake.sample(20, 600)).toBe(true);
    // Spread over more than a second, it isn't.
    expect(shake.sample(20, 2000)).toBe(false);
    expect(shake.sample(20, 2800)).toBe(false);
    expect(shake.sample(20, 3600)).toBe(false);
  });

  it("tips, windmills and steadies with the phone, and gets dizzy when it's shaken", () => {
    let t = 0;
    const holds = new Set<MascotHold>();
    const acts: MascotReaction[] = [];
    const dispose = installMotionSenses({
      hold: (h, on) => (on ? holds.add(h) : holds.delete(h)),
      act: (r) => acts.push(r),
      playNow: (r) => acts.push(r),
      now: () => t,
    });
    const tilt = (gamma: number) => {
      t += 100;
      window.dispatchEvent(Object.assign(new Event("deviceorientation"), { beta: 0, gamma }));
    };
    tilt(0);
    tilt(25);
    expect(Array.from(holds)).toEqual(["tipRight"]);
    tilt(-45);
    expect(Array.from(holds)).toEqual(["whoa"]);
    tilt(0);
    expect(holds.size).toBe(0);
    expect(acts).toEqual(["steady"]);
    for (let i = 0; i < 3; i++) {
      t += 200;
      window.dispatchEvent(
        Object.assign(new Event("devicemotion"), { acceleration: { x: 20, y: 0, z: 0 } })
      );
    }
    expect(acts).toEqual(["steady", "dizzy"]);
    dispose();
    tilt(30);
    expect(holds.size).toBe(0);
  });

  it("follows the visitor's choice, and asks first where the browser does", () => {
    expect(feelsPhone(true)).toBe(true);
    expect(feelsPhone(false)).toBe(false);
    // jsdom has no permission prompt, like Android.
    expect(feelsPhone(null)).toBe(true);
  });
});

describe("the phone's pose, all the time", () => {
  it("reads how far the screen leans back", () => {
    expect(screenPitch(90, 0)).toBeCloseTo(0, 5); // held upright
    expect(screenPitch(45, 0)).toBeCloseTo(45, 5);
    expect(screenPitch(0, 0)).toBeCloseTo(90, 5); // flat on a table, facing up
    expect(screenPitch(180, 0)).toBeCloseTo(-90, 5); // facing the floor
  });

  it("follows a tilt, smoothed, then gets used to it", () => {
    const pose = createPose();
    pose.update(0, 40, 0);
    let p = pose.update(20, 40, 16);
    // One reading isn't the whole tilt: a shaky hand isn't a shaky Amr.
    expect(p.roll).toBeGreaterThan(1);
    expect(p.roll).toBeLessThan(8);
    for (let t = 32; t <= 600; t += 16) p = pose.update(20, 40, t);
    expect(p.roll).toBeGreaterThan(16);
    expect(Math.abs(p.pitch)).toBeLessThan(0.5);
    for (let t = 700; t < 40_000; t += 100) p = pose.update(20, 40, t);
    expect(Math.abs(p.roll)).toBeLessThan(1);
  });

  it("leans against the tilt, part of the way, up to ten degrees", () => {
    expect(leanFor(0)).toBe(0);
    expect(leanFor(10)).toBe(-5);
    expect(leanFor(-10)).toBe(5);
    expect(leanFor(60)).toBe(-LEAN_MAX);
    expect(leanFor(-60)).toBe(LEAN_MAX);
  });

  it("skids toward the low side once the tilt is past eight degrees", () => {
    expect(skidFor(5)).toBe(0);
    expect(skidFor(-8)).toBe(0);
    expect(skidFor(19)).toBeCloseTo(SKID_MAX / 2, 5);
    expect(skidFor(45)).toBe(SKID_MAX);
    expect(skidFor(-45)).toBe(-SKID_MAX);
  });

  it("looks where the phone tips, and at the visitor near level", () => {
    expect(tiltLook(2, 2)).toBeNull();
    expect(tiltLook(20, 0)).toBe(4); // right side down: right
    expect(tiltLook(-20, 0)).toBe(12);
    expect(tiltLook(0, 20)).toBe(0); // leaned back: up
    expect(tiltLook(0, -20)).toBe(8); // brought upright: down
  });
});

describe("the phone's pose, at moments", () => {
  it("tells one knock from the start of a shake", () => {
    const bump = createBump();
    expect(bump.sample(25, 0)).toBe(false);
    expect(bump.sample(1, 200)).toBe(false);
    expect(bump.sample(1, 460)).toBe(true);
    // A second jolt on its heels: that's shaking, not a knock.
    expect(bump.sample(25, 1000)).toBe(false);
    expect(bump.sample(25, 1200)).toBe(false);
    expect(bump.sample(1, 1500)).toBe(false);
  });

  it("knows a toss from a wobble", () => {
    const fall = createFreeFall();
    expect(fall.sample(9.8, 0)).toBeNull();
    expect(fall.sample(1, 100)).toBeNull();
    expect(fall.sample(9.8, 150)).toBeNull(); // weightless for a blink: a wobble
    expect(fall.sample(1, 200)).toBeNull();
    expect(fall.sample(0.5, 340)).toBe("fall");
    expect(fall.sample(0.5, 500)).toBeNull();
    expect(fall.sample(15, 620)).toBe("land");
    expect(fall.sample(9.8, 700)).toBeNull();
  });

  it("counts a quick turn of the wrist once", () => {
    const twist = createTwist();
    expect(twist.sample(400, 0)).toBe(false);
    expect(twist.sample(420, 100)).toBe(false);
    expect(twist.sample(410, 160)).toBe(true);
    expect(twist.sample(410, 300)).toBe(false); // the same turn
    expect(twist.sample(20, 400)).toBe(false);
    expect(twist.sample(-400, 500)).toBe(false);
    expect(twist.sample(-400, 660)).toBe(true); // back the other way
  });

  it("knows the phone was put down, and picked up again", () => {
    const rest = createRest();
    expect(rest.update(0, 88, 0.99, 0)).toBeNull();
    expect(rest.update(1, 88, 0.99, REST_MS - 1000)).toBeNull();
    expect(rest.update(1, 89, 0.99, REST_MS + 10)).toBe("rest");
    expect(rest.update(1, 89, 0.99, REST_MS + 5000)).toBeNull();
    expect(rest.update(2, 60, 0.6, REST_MS + 6000)).toBe("pickup");
  });

  describe("installMotionSenses", () => {
    let t: number;
    let holds: Set<MascotHold>;
    let acts: MascotReaction[];
    let rested: boolean[];
    let dispose: () => void;
    const frame = restingFrame();

    beforeEach(() => {
      t = 0;
      holds = new Set();
      acts = [];
      rested = [];
      dispose = installMotionSenses({
        hold: (h, on) => (on ? holds.add(h) : holds.delete(h)),
        act: (r) => acts.push(r),
        playNow: (r) => acts.push(r),
        frame,
        rest: (r) => rested.push(r),
        now: () => t,
      });
    });
    afterEach(() => dispose());

    const turn = (beta: number, gamma: number, ms = 100) => {
      t += ms;
      window.dispatchEvent(Object.assign(new Event("deviceorientation"), { beta, gamma }));
    };
    const feel = (withGravity: number, ms = 50) => {
      t += ms;
      window.dispatchEvent(
        Object.assign(new Event("devicemotion"), {
          accelerationIncludingGravity: { x: 0, y: 0, z: withGravity },
        })
      );
    };

    it("keeps the pose for the sprite, without a held pose for a small tilt", () => {
      expect(frame.live).toBe(false);
      turn(0, 0);
      for (let i = 0; i < 10; i++) turn(0, 12, 30);
      expect(frame.live).toBe(true);
      expect(frame.roll).toBeGreaterThan(9);
      expect(frame.roll).toBeLessThan(12);
      expect(frame.at).toBe(t);
      expect(holds.size).toBe(0);
      dispose();
      expect(frame).toEqual(restingFrame());
    });

    it("hangs on while the phone is upside down", () => {
      turn(60, 0);
      turn(-90, 0);
      expect(holds.has("falling")).toBe(false); // a moment's flip isn't enough
      turn(-90, 0, 450);
      expect(holds.has("falling")).toBe(true);
      expect(frame.roll).toBe(0);
      turn(60, 0);
      expect(holds.has("falling")).toBe(false);
      expect(acts).toEqual(["steady"]);
    });

    it("is glad to see the visitor when the phone is turned back over", () => {
      turn(60, 0);
      turn(180, 0);
      turn(180, 0, 600);
      expect(acts).toEqual([]);
      turn(60, 0);
      expect(acts).toEqual(["peekFound"]);
    });

    it("flails while the phone is in the air, and lands when it's caught", () => {
      feel(9.8);
      feel(0.5);
      expect(holds.has("flying")).toBe(false);
      feel(0.4, 80);
      feel(0.3, 80);
      expect(holds.has("flying")).toBe(true);
      feel(14);
      expect(holds.has("flying")).toBe(false);
      expect(acts).toEqual(["land"]);
    });

    it("says when the phone is put down, and looks about when it's picked up", () => {
      for (let i = 0; i < 28; i++) turn(0, 0, 500);
      expect(rested).toEqual([true]);
      turn(50, 0);
      expect(rested).toEqual([true, false]);
      expect(acts).toContain("lookAround");
    });
  });
});
