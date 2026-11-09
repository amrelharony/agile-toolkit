/**
 * How Amr reads the visit (stuck, reading, a long haul), when he may speak, and
 * the scene a tap carries on with.
 */

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  READING_MS,
  STRETCH_AFTER_MS,
  createLongStretch,
  createRageTaps,
  createReading,
  createRefusals,
  installIntentSenses,
  type IntentHooks,
} from "@/components/agent/mascot/engine/interactions/intent";
import {
  OWN_SCENES,
  followUp,
  sceneFamily,
  sceneOfShot,
} from "@/components/agent/mascot/engine/scene-taps";
import { useBubbleStore } from "@/lib/agent/mascot/bubble";
import { HELP_OFFER, LINES_AT, MOTION_INVITE, STRETCH_OFFER } from "@/lib/agent/mascot/lines";
import { maySay, say } from "@/lib/agent/mascot/say";
import type { MascotReaction } from "@/lib/agent/mascot/store";
import { DEFAULT_NOTIFICATION_PREFS } from "@/lib/notify/prefs";
import { useNotificationPrefsStore } from "@/lib/stores/notification-prefs-store";

describe("signs that someone is stuck", () => {
  it("counts three taps on the same dead spot, close together", () => {
    const rage = createRageTaps();
    expect(rage.sample(100, 100, 0)).toBe(false);
    expect(rage.sample(104, 98, 300)).toBe(false);
    expect(rage.sample(101, 103, 600)).toBe(true);
    // It starts over after that.
    expect(rage.sample(101, 103, 700)).toBe(false);
  });

  it("doesn't count taps that wander or dawdle", () => {
    const rage = createRageTaps();
    rage.sample(100, 100, 0);
    rage.sample(300, 100, 200);
    expect(rage.sample(100, 100, 400)).toBe(false);
    const slow = createRageTaps();
    slow.sample(100, 100, 0);
    slow.sample(100, 100, 1000);
    expect(slow.sample(100, 100, 2000)).toBe(false);
  });

  it("counts a form refusing its input twice in a row", () => {
    const refusals = createRefusals();
    expect(refusals.sample(0)).toBe(false);
    expect(refusals.sample(5000)).toBe(true);
    expect(refusals.sample(60_000)).toBe(false);
  });
});

describe("signs that someone is reading, or has been at it a long while", () => {
  it("takes steady scrolling for reading, and stops when it stops", () => {
    const r = createReading();
    let y = 0;
    for (let t = 0; t <= 3500; t += 250) r.scroll((y += 60), t);
    expect(r.reading(3600)).toBe(true);
    expect(r.reading(3500 + READING_MS + 1)).toBe(false);
  });

  it("doesn't take a fling down the page for reading", () => {
    const r = createReading();
    let y = 0;
    for (let t = 0; t <= 3500; t += 100) r.scroll((y += 400), t);
    expect(r.reading(3600)).toBe(false);
  });

  it("calls for a stretch after 25 minutes without a pause, once an hour", () => {
    const s = createLongStretch();
    let fired = 0;
    for (let t = 0; t <= STRETCH_AFTER_MS + 60_000; t += 30_000) if (s.input(t)) fired++;
    expect(fired).toBe(1);
    // Another 25 minutes straight on: still inside the hour.
    for (let t = STRETCH_AFTER_MS + 90_000; t <= 2 * STRETCH_AFTER_MS + 120_000; t += 30_000) {
      if (s.input(t)) fired++;
    }
    expect(fired).toBe(1);
  });

  it("starts the count again after a real pause", () => {
    const s = createLongStretch();
    let fired = 0;
    for (let t = 0; t < 20 * 60_000; t += 30_000) if (s.input(t)) fired++;
    // Ten minutes away, then ten more minutes of work: 30 on the clock, but not in one go.
    for (let t = 30 * 60_000; t < 40 * 60_000; t += 30_000) if (s.input(t)) fired++;
    expect(fired).toBe(0);
  });
});

describe("installIntentSenses", () => {
  let t: number;
  let acts: MascotReaction[];
  let offers: number;
  let stretches: number;
  let dispose: () => void;
  let path: string;
  const store = new Map<string, string>();
  const storage = {
    getItem: (k: string) => store.get(k) ?? null,
    setItem: (k: string, v: string) => void store.set(k, v),
  };

  const install = (over: Partial<IntentHooks> = {}) => {
    const senses = installIntentSenses({
      act: (r) => acts.push(r),
      allow: () => true,
      busy: () => false,
      path: () => path,
      offerHelp: () => {
        offers++;
        return true;
      },
      suggestStretch: () => {
        stretches++;
      },
      isControl: (target) => (target as Element | null)?.tagName === "BUTTON",
      now: () => t,
      storage,
      ...over,
    });
    dispose = senses.dispose;
    return senses;
  };
  const tap = (el: Element, x = 100, y = 100) =>
    el.dispatchEvent(
      new MouseEvent("pointerdown", { bubbles: true, clientX: x, clientY: y, button: 0 })
    );

  beforeEach(() => {
    vi.useFakeTimers();
    t = 0;
    acts = [];
    offers = 0;
    stretches = 0;
    path = "/retro";
    store.clear();
  });
  afterEach(() => {
    dispose?.();
    vi.useRealTimers();
  });

  it("looks concerned, then offers a hand, when the same dead spot is tapped three times", () => {
    install();
    for (let i = 0; i < 3; i++) {
      t += 200;
      tap(document.body);
    }
    expect(acts).toEqual(["concerned"]);
    expect(offers).toBe(0);
    vi.advanceTimersByTime(1300);
    expect(offers).toBe(1);
  });

  it("offers once per page in a visit", () => {
    install();
    const rage = () => {
      for (let i = 0; i < 3; i++) {
        t += 200;
        tap(document.body);
      }
      vi.advanceTimersByTime(1300);
    };
    rage();
    t += 10 * 60_000;
    rage();
    expect(offers).toBe(1);
    path = "/planning-poker";
    t += 10 * 60_000;
    rage();
    expect(offers).toBe(2);
  });

  it("doesn't take a mouse's triple-click, which selects a paragraph, for someone stuck", () => {
    install();
    for (let i = 0; i < 3; i++) {
      t += 150;
      document.body.dispatchEvent(
        Object.assign(
          new MouseEvent("pointerdown", { bubbles: true, clientX: 100, clientY: 100 }),
          {
            pointerType: "mouse",
          }
        )
      );
    }
    expect(acts).toEqual([]);
  });

  it("leaves taps on a control alone: those answer for themselves", () => {
    install();
    const button = document.createElement("button");
    document.body.appendChild(button);
    for (let i = 0; i < 5; i++) {
      t += 150;
      tap(button);
    }
    expect(acts).toEqual([]);
    button.remove();
  });

  it("offers a hand when a form refuses twice", () => {
    install();
    const field = document.createElement("input");
    document.body.appendChild(field);
    field.dispatchEvent(new Event("invalid"));
    t += 4000;
    field.dispatchEvent(new Event("invalid"));
    expect(acts).toEqual(["concerned"]);
    field.remove();
  });

  it("stays out of it while he's already engaged, or the director says not now", () => {
    install({ busy: () => true });
    for (let i = 0; i < 3; i++) tap(document.body);
    expect(acts).toEqual([]);
    dispose();
    install({ allow: () => false });
    for (let i = 0; i < 3; i++) tap(document.body);
    expect(acts).toEqual([]);
  });

  it("stretches after a long haul, and says when the visitor is reading", () => {
    const senses = install();
    for (t = 0; t <= STRETCH_AFTER_MS + 30_000; t += 30_000) {
      window.dispatchEvent(new Event("keydown"));
    }
    expect(acts).toEqual(["stretch"]);
    expect(stretches).toBe(1);

    expect(senses.reading()).toBe(false);
    const scrollY = vi.spyOn(window, "scrollY", "get");
    let y = 0;
    for (let i = 0; i < 16; i++) {
      t += 250;
      scrollY.mockReturnValue((y += 60));
      window.dispatchEvent(new Event("scroll"));
    }
    expect(senses.reading()).toBe(true);
    scrollY.mockRestore();
  });
});

describe("when he may speak", () => {
  const at = new Date(2026, 10, 9, 14, 0);

  it("says nothing on Quiet, only the useful on Balanced, the friendly extras on Lively", () => {
    const prefs = (celebrationLevel: string) => ({
      ...DEFAULT_NOTIFICATION_PREFS,
      celebrationLevel,
    });
    for (const kind of ["ask", "help", "welcome", "streak", "stretch"] as const) {
      expect(maySay(kind, prefs("quiet"), at)).toBe(false);
      expect(maySay(kind, prefs("lively"), at)).toBe(true);
    }
    expect(maySay("help", prefs("balanced"), at)).toBe(true);
    expect(maySay("welcome", prefs("balanced"), at)).toBe(true);
    expect(maySay("stretch", prefs("balanced"), at)).toBe(false);
    expect(maySay("streak", prefs("balanced"), at)).toBe(false);
    expect(LINES_AT.quiet).toEqual([]);
  });

  it("holds his tongue in Focus and in the quiet hours, whatever the level", () => {
    const lively = { ...DEFAULT_NOTIFICATION_PREFS, celebrationLevel: "lively" };
    expect(maySay("help", { ...lively, focusUntil: at.getTime() + 60_000 }, at)).toBe(false);
    const night = { ...lively, quietHours: { enabled: true, start: "13:00", end: "15:00" } };
    expect(maySay("help", night, at)).toBe(false);
  });

  it("keeps every line short", () => {
    for (const line of [HELP_OFFER, STRETCH_OFFER]) {
      expect(line.split(/\s+/).length).toBeLessThanOrEqual(4);
    }
    expect(MOTION_INVITE.text.length).toBeLessThanOrEqual(32);
  });

  describe("say", () => {
    beforeEach(() => {
      useBubbleStore.setState({ current: null });
      useNotificationPrefsStore.setState({ ...DEFAULT_NOTIFICATION_PREFS });
    });
    afterEach(() => {
      useBubbleStore.setState({ current: null });
      useNotificationPrefsStore.setState({ ...DEFAULT_NOTIFICATION_PREFS });
    });

    it("puts the bubble up when the setting allows it, and not when it doesn't", () => {
      expect(say("help", { id: "help", text: HELP_OFFER })).toBe(true);
      expect(useBubbleStore.getState().current?.id).toBe("help");
      useBubbleStore.setState({ current: null });
      useNotificationPrefsStore.setState({ celebrationLevel: "quiet" });
      expect(say("help", { id: "help", text: HELP_OFFER })).toBe(false);
      expect(useBubbleStore.getState().current).toBeNull();
    });
  });
});

describe("a tap in the middle of a scene", () => {
  const all = () => true;

  it("reads the scene off the sprite", () => {
    expect(sceneOfShot("clip:scene:ball.kick")).toBe("ball.kick");
    expect(sceneOfShot("clip:poke")).toBeNull();
    expect(sceneOfShot("idle@1")).toBeNull();
    expect(sceneOfShot(undefined)).toBeNull();
    expect(sceneFamily("ball.kick")).toBe("ball");
  });

  it("carries on with another scene of the same family", () => {
    expect(["ball.kick", "ball.spin"]).toContain(followUp("ball", all, [], () => 0));
    expect(followUp("music", all, [], () => 0)).toBe("music.drum");
    expect(["ball", "ball.spin"]).toContain(followUp("ball.kick", all, [], () => 0.9));
  });

  it("prefers one he hasn't just played, and only ones that have shipped", () => {
    expect(followUp("ball", all, ["ball.kick"], () => 0)).toBe("ball.spin");
    expect(
      followUp(
        "ball",
        (s) => s !== "ball.kick",
        [],
        () => 0
      )
    ).toBe("ball.spin");
    expect(
      followUp(
        "ball",
        (s) => s === "ball",
        [],
        () => 0
      )
    ).toBeNull();
  });

  it("leaves a tool's scenes alone: each of those means something happened", () => {
    expect(OWN_SCENES).not.toContain("blocker.raised");
    expect(followUp("blocker.raised", all)).toBeNull();
    expect(followUp("poker", all)).toBeNull();
  });
});
