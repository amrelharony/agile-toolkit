/**
 * Amr's mind: the mood that builds from what happens to him, what he remembers
 * between visits, how he varies what he does, and what has his eye.
 */

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  ATTENTION_MS,
  createAttention,
  scrollLook,
} from "@/components/agent/mascot/engine/attention";
import { createClickInteraction } from "@/components/agent/mascot/engine/interactions/clicks";
import { pickPastime } from "@/components/agent/mascot/engine/interactions/context";
import { createDirector } from "@/components/agent/mascot/engine/director";
import { helloFor } from "@/components/agent/mascot/engine/senses";
import {
  HIDE_MS,
  POKE_MEMORY_MS,
  WORK_REACTIONS,
  pickFresh,
  pokeAnswer,
  remember,
} from "@/lib/agent/mascot/brain/choose";
import {
  BUSY_GAP_MS,
  GAP_MS,
  PACE,
  START,
  createBrain,
  energyAt,
  moodOf,
  temperamentOf,
} from "@/lib/agent/mascot/brain/state";
import {
  MEMORY_KEY,
  RECENT_KEPT,
  counted,
  daysBetween,
  loadMemory,
  localDay,
  noteVisit,
  recalled,
  saveMemory,
} from "@/lib/agent/mascot/memory";
import {
  __resetMindForTests,
  did,
  feel,
  getMind,
  recentlyDid,
  takeArrival,
} from "@/lib/agent/mascot/mind";
import type { MascotHold, MascotReaction } from "@/lib/agent/mascot/store";

describe("his inner state", () => {
  const brainAt = (hour = 10) => {
    let t = 0;
    const brain = createBrain({ now: () => t, hour: () => hour });
    return { brain, wait: (ms: number) => ((t += ms), brain.tick()) };
  };

  it("starts calm in the daytime and sleepy late at night", () => {
    expect(brainAt(10).brain.temperament()).toBe("calm");
    expect(brainAt(1).brain.temperament()).toBe("sleepy");
    expect(energyAt(10)).toBeGreaterThan(energyAt(23));
  });

  it("warms to being patted and thanked", () => {
    const { brain } = brainAt();
    brain.note("pat");
    brain.note("thanked");
    expect(brain.temperament()).toBe("affectionate");
    expect(brain.mood().valence).toBeGreaterThan(0.55);
  });

  it("turns playful with play, and the feeling fades", () => {
    const { brain, wait } = brainAt();
    brain.note("tickle");
    brain.note("highFive");
    brain.note("played");
    expect(brain.temperament()).toBe("playful");
    expect(brain.mood().energy).toBeGreaterThan(0.55);
    wait(20 * 60_000);
    expect(brain.temperament()).toBe("calm");
  });

  it("gets fed up with being prodded, and gets over it within a few minutes", () => {
    const { brain, wait } = brainAt();
    for (let i = 0; i < 6; i++) brain.note("poke");
    expect(brain.temperament()).toBe("grumpy");
    expect(brain.mood().valence).toBeLessThan(0.4);
    wait(3 * 60_000);
    expect(brain.temperament()).not.toBe("grumpy");
  });

  it("is won round by a thank-you", () => {
    const { brain } = brainAt();
    for (let i = 0; i < 6; i++) brain.note("poke");
    brain.note("thanked");
    brain.note("pat");
    expect(brain.temperament()).not.toBe("grumpy");
  });

  it("keeps every drive within 0 and 1, however much happens", () => {
    const { brain } = brainAt();
    for (let i = 0; i < 50; i++) {
      brain.note("shaken");
      brain.note("highFive");
    }
    for (const v of Object.values(brain.drives())) {
      expect(v).toBeGreaterThanOrEqual(0);
      expect(v).toBeLessThanOrEqual(1);
    }
  });

  it("sets his pace and how often he does something unprompted", () => {
    const { brain } = brainAt();
    expect(brain.gapMs(false)).toBe(GAP_MS.calm);
    expect(brain.pace()).toBe(PACE.calm);
    // While the visitor types he keeps to himself, whatever his mood.
    expect(brain.gapMs(true)).toBe(BUSY_GAP_MS);
    brain.note("tickle");
    brain.note("highFive");
    brain.note("played");
    expect(brain.gapMs(false)).toBe(GAP_MS.playful);
    expect(GAP_MS.playful).toBeLessThan(GAP_MS.calm);
    expect(PACE.sleepy).toBeLessThan(1);
  });

  it("names a temperament for any drives, and a mood within range", () => {
    expect(temperamentOf(START)).toBe("calm");
    expect(temperamentOf({ ...START, energy: 0.2 })).toBe("sleepy");
    expect(temperamentOf({ ...START, arousal: 0.7, affection: 0.3 })).toBe("shy");
    const best = moodOf({ energy: 1, affection: 1, playfulness: 1, arousal: 1, annoyance: 0 });
    expect(best.valence).toBeGreaterThan(0.9);
    expect(best.energy).toBe(1);
    const worst = moodOf({ energy: 0, affection: 0, playfulness: 0, arousal: 0, annoyance: 1 });
    expect(worst.valence).toBe(0);
    expect(worst.energy).toBeGreaterThanOrEqual(0);
  });

  it("plays at an even pace when nothing has happened, whatever the hour", () => {
    for (let hour = 0; hour < 24; hour++) {
      const mood = createBrain({ now: () => 0, hour: () => hour }).mood();
      expect(mood.valence).toBe(0.5);
      expect(mood.energy).toBeGreaterThan(0.35);
      expect(mood.energy).toBeLessThan(0.6);
    }
  });

  it("lets the director's gap follow him", () => {
    let t = 0;
    let gap = 20_000;
    const d = createDirector(
      () => t,
      () => gap
    );
    expect(d.allow("a", 0)).toBe(true);
    t = 13_000;
    expect(d.allow("b", 0)).toBe(false);
    gap = 12_000; // he's turned playful
    expect(d.allow("b", 0)).toBe(true);
  });
});

describe("how he varies what he does", () => {
  it("never gives the same answer twice running, and brings back the older ones", () => {
    let recent: string[] = [];
    const seen: string[] = [];
    for (let i = 0; i < 12; i++) {
      const pick = pickFresh(WORK_REACTIONS, recent, () => (i * 0.37) % 1)!;
      seen.push(pick);
      recent = remember(recent, pick, 2);
    }
    for (let i = 1; i < seen.length; i++) expect(seen[i]).not.toBe(seen[i - 1]);
    expect(new Set(seen).size).toBe(WORK_REACTIONS.length);
  });

  it("has only one answer when there's only one, and none when there are none", () => {
    expect(pickFresh(["nod"], ["nod"])).toBe("nod");
    expect(pickFresh([], [])).toBeNull();
  });

  it("lets a temperament weigh the answers", () => {
    const pick = pickFresh(
      ["a", "b"],
      [],
      () => 0.9,
      (o) => (o === "a" ? 9 : 1)
    );
    expect(pick).toBe("b"); // the last tenth is b's
    expect(
      pickFresh(
        ["a", "b"],
        [],
        () => 0.5,
        (o) => (o === "a" ? 9 : 1)
      )
    ).toBe("a");
  });

  it("wears thin when he's poked again and again", () => {
    expect([1, 2, 3, 4, 5, 6].map((n) => pokeAnswer(n, "calm"))).toEqual([
      "poke",
      "poke",
      "bashful",
      "shrug",
      "hide",
      "hide",
    ]);
    // A playful Amr has more patience, a grumpy one less.
    expect(pokeAnswer(4, "playful")).toBe("poke");
    expect(pokeAnswer(2, "grumpy")).toBe("bashful");
  });

  it("prefers pastimes he hasn't played lately", () => {
    const moments = [{ id: "m", kind: "time" as const, priority: 1, scenes: ["coffee"] }];
    const all = () => true;
    const picks = new Set<string>();
    for (let i = 0; i < 40; i++) {
      picks.add(
        pickPastime(moments, all, () => (i * 0.137) % 1, null, ["coffee", "ball", "music"])!
      );
    }
    expect(picks.has("coffee")).toBe(false);
    expect(picks.has("ball")).toBe(false);
    expect(picks.size).toBeGreaterThan(2);
    // When he's played them all lately, any but the last will do.
    const everything = ["coffee", "ball", "ball.kick", "ball.spin", "music", "music.drum", "phone"];
    const pick = pickPastime(moments, all, () => 0, "coffee", [
      ...everything,
      "phone.scroll",
      "reading.doze",
    ]);
    expect(pick).not.toBeNull();
    expect(pick).not.toBe("coffee");
  });
});

describe("taps that wear thin", () => {
  let played: MascotReaction[];
  let holds: Set<MascotHold>;
  let felt: string[];

  beforeEach(() => {
    vi.useFakeTimers();
    played = [];
    holds = new Set();
    felt = [];
  });
  afterEach(() => vi.useRealTimers());

  const make = () =>
    createClickInteraction({
      playNow: (r) => played.push(r),
      hold: (h, on) => (on ? holds.add(h) : holds.delete(h)),
      sound: () => {},
      temperament: () => "calm",
      feel: (e) => felt.push(e),
    });

  it("giggles, goes shy, shrugs, then hides his eyes till he's left alone", () => {
    const clicks = make();
    for (let i = 0; i < 4; i++) {
      clicks.onClick("body");
      vi.advanceTimersByTime(1200);
    }
    expect(played).toEqual(["poke", "poke", "bashful", "shrug"]);
    expect(holds.has("peekHide")).toBe(false);
    // The fifth: he covers his eyes, for a moment.
    clicks.onClick("body");
    expect(played).toHaveLength(4);
    expect(felt).toEqual(["poke", "poke", "poke", "poke", "poke"]);
    expect(holds.has("peekHide")).toBe(true);
    vi.advanceTimersByTime(HIDE_MS + 10);
    expect(holds.has("peekHide")).toBe(false);
    // Left alone for a minute, it's forgiven.
    vi.advanceTimersByTime(POKE_MEMORY_MS);
    clicks.onClick("body");
    expect(played.at(-1)).toBe("poke");
    clicks.dispose();
  });

  it("never tires of a pat", () => {
    const clicks = make();
    for (let i = 0; i < 6; i++) {
      clicks.onClick("head", "left");
      vi.advanceTimersByTime(1200);
    }
    expect(played).toEqual(Array(6).fill("patLeft"));
    expect(felt).toEqual(Array(6).fill("pat"));
    clicks.dispose();
  });

  it("lets go of his eyes when he's taken off the page", () => {
    const clicks = make();
    for (let i = 0; i < 5; i++) {
      vi.advanceTimersByTime(1200);
      clicks.onClick("body");
    }
    expect(holds.has("peekHide")).toBe(true);
    clicks.dispose();
    expect(holds.has("peekHide")).toBe(false);
  });
});

describe("what he remembers", () => {
  const day = (s: string) => new Date(`${s}T10:00:00`);

  it("counts days and days running, and says how a visit begins", () => {
    let { memory, arrival } = noteVisit(null, day("2026-11-01"));
    expect(arrival).toEqual({ kind: "first" });
    expect(memory).toMatchObject({ firstDay: "2026-11-01", days: 1, streak: 1 });

    ({ memory, arrival } = noteVisit(memory, day("2026-11-01")));
    expect(arrival).toEqual({ kind: "same-day" });
    expect(memory.days).toBe(1);

    ({ memory, arrival } = noteVisit(memory, day("2026-11-02")));
    expect(arrival).toEqual({ kind: "next-day", streak: 2 });
    ({ memory, arrival } = noteVisit(memory, day("2026-11-03")));
    expect(arrival).toEqual({ kind: "next-day", streak: 3 });

    ({ memory, arrival } = noteVisit(memory, day("2026-11-10")));
    expect(arrival).toEqual({ kind: "back", daysAway: 7 });
    expect(memory).toMatchObject({ days: 4, streak: 1, lastDay: "2026-11-10" });
  });

  it("reads days across a month's end and a clock change", () => {
    expect(daysBetween("2026-10-31", "2026-11-01")).toBe(1);
    expect(daysBetween("2026-03-28", "2026-03-30")).toBe(2);
    expect(localDay(new Date(2026, 0, 5, 23, 59))).toBe("2026-01-05");
  });

  it("keeps the last thirty things he did, and its counters in check", () => {
    let memory = noteVisit(null, day("2026-11-01")).memory;
    for (let i = 0; i < 50; i++) memory = recalled(memory, `scene${i}`);
    expect(memory.recent).toHaveLength(RECENT_KEPT);
    expect(memory.recent.at(-1)).toBe("scene49");
    for (let i = 0; i < 60; i++) memory = counted(memory, `thing${i}`);
    memory = counted(counted(memory, "poke"), "poke");
    expect(Object.keys(memory.counts).length).toBeLessThanOrEqual(24);
    expect(memory.counts.poke).toBe(2);
  });

  it("stays small, survives a round trip, and refuses what isn't its own", () => {
    let memory = noteVisit(null, day("2026-11-01")).memory;
    for (let i = 0; i < 60; i++) memory = recalled(counted(memory, `thing${i}`), `scene.name.${i}`);
    saveMemory(localStorage, memory);
    expect(localStorage.getItem(MEMORY_KEY)!.length).toBeLessThan(4096);
    expect(loadMemory(localStorage)).toEqual(memory);

    localStorage.setItem(MEMORY_KEY, "not json");
    expect(loadMemory(localStorage)).toBeNull();
    localStorage.setItem(MEMORY_KEY, JSON.stringify({ v: 99, firstDay: "x" }));
    expect(loadMemory(localStorage)).toBeNull();
    localStorage.setItem(MEMORY_KEY, "x".repeat(9000));
    expect(loadMemory(localStorage)).toBeNull();
    expect(loadMemory(null)).toBeNull();
  });
});

describe("his mind, for this tab", () => {
  beforeEach(() => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date(2026, 10, 9, 10, 0));
    localStorage.clear();
    __resetMindForTests();
  });
  afterEach(() => {
    __resetMindForTests();
    vi.useRealTimers();
    localStorage.clear();
  });

  it("notes the visit when it's first asked for, and greets an arrival once", () => {
    expect(getMind().arrival).toEqual({ kind: "first" });
    expect(loadMemory(localStorage)).toMatchObject({ days: 1, lastDay: "2026-11-09" });
    expect(takeArrival()).toEqual({ kind: "first" });
    expect(takeArrival()).toEqual({ kind: "same-day" });
  });

  it("knows someone who was here three days ago, and starts a little fonder", () => {
    const first = getMind().brain.drives().affection;
    __resetMindForTests();
    vi.setSystemTime(new Date(2026, 10, 12, 10, 0));
    expect(getMind().arrival).toEqual({ kind: "back", daysAway: 3 });
    expect(getMind().brain.drives().affection).toBeGreaterThan(first);
  });

  it("counts what happens to him and remembers what he did, saved a moment later", () => {
    feel("pat");
    feel("pat");
    did("ball");
    expect(recentlyDid()).toEqual(["ball"]);
    expect(loadMemory(localStorage)!.counts.pat).toBeUndefined(); // not yet
    vi.advanceTimersByTime(2000);
    expect(loadMemory(localStorage)).toMatchObject({ counts: { pat: 2 }, recent: ["ball"] });
  });

  it("waves at someone who's back, cheers a third day running, and leaves a first visit be", () => {
    expect(helloFor({ kind: "first" })).toBeNull();
    expect(helloFor({ kind: "same-day" })).toBeNull();
    expect(helloFor({ kind: "back", daysAway: 5 })).toBe("wave");
    expect(helloFor({ kind: "next-day", streak: 2 })).toBe("wave");
    expect(helloFor({ kind: "next-day", streak: 3 })).toBe("cheer");
    expect(helloFor({ kind: "next-day", streak: 7 })).toBe("cheer");
  });
});

describe("what has his eye", () => {
  it("looks at a finger before a field, and a field before the scroll", () => {
    const a = createAttention();
    expect(a.target(0)).toBeNull();
    a.see("scroll", 10, 500, 0);
    expect(a.target(100)).toMatchObject({ source: "scroll", y: 500 });
    a.see("focus", 200, 300, 100);
    expect(a.target(200)).toMatchObject({ source: "focus", x: 200 });
    a.see("touch", 50, 60, 200);
    expect(a.target(300)).toMatchObject({ source: "touch", x: 50, y: 60 });
  });

  it("lets each one go after its moment, back to the next, then to the visitor", () => {
    const a = createAttention();
    a.see("focus", 200, 300, 0);
    a.see("touch", 50, 60, 0);
    expect(a.target(ATTENTION_MS.touch + 1)).toMatchObject({ source: "focus" });
    expect(a.target(ATTENTION_MS.focus + 1)).toBeNull();
  });

  it("follows the page as it scrolls, down or up", () => {
    const from = { x: 300, y: 700 };
    expect(scrollLook(from, 40)!.y).toBeGreaterThan(700);
    expect(scrollLook(from, -40)!.y).toBeLessThan(700);
    expect(scrollLook(from, 1)).toBeNull();
  });
});
