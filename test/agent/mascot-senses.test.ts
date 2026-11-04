import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { MascotHold, MascotReaction } from "@/lib/agent/mascot/store";
import { createDirector } from "@/components/agent/mascot/engine/director";
import {
  DOZE_MS,
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
  createShake,
  createTilt,
  feelsPhone,
  installMotionSenses,
  screenTilt,
} from "@/components/agent/mascot/engine/interactions/sensors";

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
