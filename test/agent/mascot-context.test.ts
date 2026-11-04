import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import spec from "../../docs/mascot/context-sheets.json";
import type { MascotReaction } from "@/lib/agent/mascot/store";
import {
  momentsNow,
  OCCASION_SCENES,
  PLAY_SCENES,
  WEATHER_SCENES,
  type MomentInput,
} from "@/lib/agent/mascot/context/moments";
import { fetchVisitorWeather, type WeatherNow } from "@/lib/agent/mascot/context/weather";
import { sceneForAction } from "@/lib/agent/mascot/use-tool-reactions";
import { SCENES } from "@/components/agent/mascot/engine/scenes";
import { clip, clipFrames, s as step, type FrameRef } from "@/components/agent/mascot/engine/clips";
import {
  actClip,
  chooseShot,
  clipShipped,
  reactionSeconds,
  shippedScene,
} from "@/components/agent/mascot/engine/sprite-poses";
import {
  installContextSenses,
  pickGreeting,
  pickPastime,
  type ContextHooks,
} from "@/components/agent/mascot/engine/interactions/context";

const specFrames = new Set(spec.sheets.flatMap((s) => s.slots.map((slot) => slot.id)));

describe("the scenes and their sheets", () => {
  it("draws every scene from frames the context sheets ask for", () => {
    for (const [name, c] of Object.entries(SCENES)) {
      for (const f of clipFrames(c)) {
        if (!f.startsWith("base:")) expect(specFrames.has(f), `${name}: ${f}`).toBe(true);
      }
    }
  });

  it("puts every pose that's asked for into some scene", () => {
    const used = new Set(Object.values(SCENES).flatMap(clipFrames));
    expect(Array.from(specFrames).filter((f) => !used.has(f as never))).toEqual([]);
  });

  it("names only scenes that exist, wherever they're asked for", () => {
    const asked = [
      ...Object.values(OCCASION_SCENES).flat(),
      ...Object.values(WEATHER_SCENES).flat(),
      ...PLAY_SCENES,
      "lights.dark",
      "lights.light",
      "phone.low",
      "phone.charged",
      "focus",
      "focus.music",
      "iftar",
      "suhoor",
      "sweets",
      "fireworks",
      "reading",
      "coffee",
      "breakfast",
      "koshary",
      "evening",
      "late",
      "weekend",
      "winter",
      "summer",
      "school",
    ];
    for (const s of asked) expect(SCENES[s], s).toBeDefined();
    // And the toolkit's own moments.
    for (const action of [
      "card_added",
      "vote_cast",
      "votes_revealed",
      "timer_started",
      "kudos_sent",
    ]) {
      const scene = sceneForAction(
        action,
        () => true,
        () => 0
      );
      expect(scene && SCENES[scene], action).toBeTruthy();
    }
  });

  it("gives each sheet one pack, eight frames with its stance, and frame ids named after it", () => {
    expect(spec.sheets).toHaveLength(54);
    const packs = new Set(spec.sheets.map((s) => s.pack));
    expect(packs.size).toBe(54);
    for (const s of spec.sheets) {
      expect(s.slots).toHaveLength(7);
      for (const slot of s.slots) expect(slot.id.startsWith(`${s.pack}.`)).toBe(true);
    }
    expect(specFrames.size).toBe(54 * 7);
  });
});

const shotFor = (reaction: MascotReaction, ready: (pack: string) => boolean = () => true) =>
  chooseShot({
    drag: null,
    reaction,
    micro: null,
    talking: false,
    look: null,
    reducedMotion: false,
    speed: 1,
    ready,
  });

describe("a scene whose sheet has shipped", () => {
  it("is every scene: all 54 sheets are in the manifest", () => {
    for (const name of Object.keys(SCENES)) expect(shippedScene(name), name).toBeDefined();
  });

  it("plays its clip, timed by its steps, once its pack is in", () => {
    const r: MascotReaction = "scene:rain";
    expect(actClip(r)).toBe(SCENES.rain);
    expect(reactionSeconds(r)).toBeGreaterThan(1);
    const shot = shotFor(r);
    expect(shot.anim).toBe("clip");
    expect(shot.key).toBe("clip:scene:rain");
  });

  it("stands in its live-sheet pose while the pack loads", () => {
    const shot = shotFor("scene:rain", () => false);
    expect(shot.anim).toBe("frames");
    expect(shot.needs).toEqual(["rain"]);
  });

  it("plays for a toolkit action", () => {
    expect(sceneForAction("votes_revealed", (s) => shippedScene(s) !== undefined)).toBe(
      "poker.reveal"
    );
  });
});

describe("a scene whose sheet hasn't shipped", () => {
  const unshipped = clip("scene:unshipped", "review", [step("nope.frame" as FrameRef, 500)]);

  it("is held back: one frame missing from the manifest is enough", () => {
    expect(clipShipped(unshipped)).toBe(false);
    expect(clipShipped(SCENES.rain)).toBe(true);
  });

  it("plays nothing, takes no time, and leaves him as he was, if it isn't a scene at all", () => {
    const r: MascotReaction = "scene:no-such-scene";
    expect(shippedScene("no-such-scene")).toBeUndefined();
    expect(actClip(r)).toBeUndefined();
    expect(reactionSeconds(r)).toBe(0);
    expect(shotFor(r).anim).toBe("idle");
  });

  it("gets the pose an action always had, not its scene", () => {
    expect(sceneForAction("votes_revealed", () => false)).toBeNull();
  });
});

const weather = (w: Partial<WeatherNow> = {}): WeatherNow => ({
  code: 0,
  temp: 24,
  feels: 24,
  wind: 5,
  gusts: 10,
  isDay: true,
  dust: null,
  sunrise: null,
  sunset: null,
  south: false,
  ...w,
});

/**
 * A moment of the visitor's day: `when` is their local clock ("2026-10-06 09:00"),
 * or an instant ("…Z") where only the instant matters.
 */
function at(when: string, w: WeatherNow | null = null, path = "/"): MomentInput {
  const m = when.match(/^(\d{4})-(\d{2})-(\d{2}) (\d{2}):(\d{2})$/);
  const now = m ? new Date(+m[1], +m[2] - 1, +m[3], +m[4], +m[5]) : new Date(when);
  return { now, weather: w, path, weekend: [5, 6] };
}
const ids = (input: MomentInput) => momentsNow(input).map((m) => m.id);

describe("moments", () => {
  it("puts the day's occasion first, then the weather, then the hour", () => {
    // 6 October 2026 is a Tuesday: no weekend in Egypt.
    const m = ids(at("2026-10-06 09:00", weather({ code: 63 })));
    expect(m.slice(0, 3)).toEqual(["oct-6", "weather:rain", "coffee"]);
  });

  it("breaks the fast at sunset in Ramadan, and keeps food out of the day", () => {
    const sunset = "2027-02-10T15:40:00.000Z";
    const noon = ids(at("2027-02-10 12:00", weather({ sunset })));
    expect(noon).toContain("ramadan");
    expect(noon).not.toContain("lunch");
    expect(noon).not.toContain("iftar");
    expect(ids(at("2027-02-10T15:30:00Z", weather({ sunset })))[0]).toBe("iftar");
    expect(ids(at("2027-02-10T18:00:00Z", weather({ sunset })))).toContain("ramadan-night");
    expect(ids(at("2027-02-11 02:00"))[0]).toBe("suhoor");
  });

  it("falls back to Cairo's sunset when the visitor's weather isn't known", () => {
    // Cairo's sunset on 10 February 2027 is about 17:40 there, 15:40 UTC.
    expect(ids(at("2027-02-10T15:45:00Z"))[0]).toBe("iftar");
  });

  it("brings out the fireworks on a festive evening", () => {
    expect(ids(at("2026-10-06 20:00"))).toContain("fireworks");
    expect(ids(at("2026-10-06 10:00"))).not.toContain("fireworks");
  });

  it("knows the visitor's weekend, and turns the seasons round in the south", () => {
    // Friday 6 November 2026.
    expect(ids(at("2026-11-06 13:00"))).toContain("weekend");
    expect(ids(at("2026-11-06 18:00"))).not.toContain("evening");
    expect(ids(at("2026-07-15 13:00"))).toContain("summer");
    expect(ids(at("2026-07-15 13:00", weather({ south: true })))).toContain("winter");
  });

  it("reads on the comics pages", () => {
    expect(ids(at("2026-11-04 13:00", null, "/comics/ep/3"))).toContain("comics");
  });
});

describe("choosing a scene", () => {
  const all = () => true;

  it("greets with the first moment not marked today", () => {
    const moments = momentsNow(at("2026-10-06 09:00", weather({ code: 63 })));
    expect(pickGreeting(moments, {}, "2026-10-06", all)?.scene).toBe("flag");
    expect(pickGreeting(moments, { "oct-6": "2026-10-06" }, "2026-10-06", all)?.scene).toBe("rain");
    // Yesterday's mark doesn't count.
    expect(pickGreeting(moments, { "oct-6": "2026-10-05" }, "2026-10-06", all)?.scene).toBe("flag");
  });

  it("skips a moment whose greeting hasn't shipped", () => {
    const moments = momentsNow(at("2026-10-06 09:00", weather({ code: 63 })));
    expect(pickGreeting(moments, {}, "2026-10-06", (s) => s === "rain")?.scene).toBe("rain");
    expect(pickGreeting(moments, {}, "2026-10-06", () => false)).toBeNull();
  });

  it("passes the time with the day's scenes or a game, never the same twice", () => {
    const moments = momentsNow(at("2026-11-04 13:00", weather({ code: 63 })));
    const seen = new Set<string>();
    let last: string | null = null;
    for (let i = 0; i < 200; i++) {
      const s = pickPastime(moments, all, () => (i * 0.137) % 1, last);
      expect(s).not.toBe(last);
      seen.add(s!);
      last = s;
    }
    expect(seen.has("rain")).toBe(true);
    expect(pickPastime(moments, () => false, Math.random, null)).toBeNull();
  });
});

describe("installContextSenses", () => {
  let acted: MascotReaction[];
  let wanted: string[][];
  let store: Map<string, string>;

  beforeEach(() => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date(2026, 9, 6, 9, 0)); // 09:00 on the visitor's clock
    acted = [];
    wanted = [];
    store = new Map();
  });
  afterEach(() => {
    vi.useRealTimers();
    document.documentElement.removeAttribute("data-theme");
  });

  function install(over: Partial<ContextHooks> = {}) {
    return installContextSenses({
      act: (r) => acted.push(r),
      allow: () => true,
      busy: () => false,
      want: (p) => wanted.push(p),
      path: () => "/",
      weather: async () => weather({ code: 63 }),
      weekend: () => [5, 6],
      shipped: () => true,
      storage: { getItem: (k) => store.get(k) ?? null, setItem: (k, v) => void store.set(k, v) },
      ...over,
    });
  }

  it("greets once he's settled, and only once a day", async () => {
    const c = install();
    await vi.advanceTimersByTimeAsync(5000);
    expect(acted).toEqual([]);
    await vi.advanceTimersByTimeAsync(2000);
    expect(acted).toEqual(["scene:flag"]);
    c.dispose();

    acted = [];
    const again = install();
    await vi.advanceTimersByTimeAsync(7000);
    // The flag is marked for today, so the next moment greets.
    expect(acted).toEqual(["scene:rain"]);
    again.dispose();
  });

  it("does nothing at all until a sheet has shipped", async () => {
    const c = install({ shipped: () => false });
    await vi.advanceTimersByTimeAsync(10_000);
    expect(c.play()).toBe(false);
    document.documentElement.dataset.theme = "light";
    document.documentElement.dataset.theme = "dark";
    await vi.advanceTimersByTimeAsync(2000);
    expect(acted).toEqual([]);
    c.dispose();
  });

  it("holds back while someone's engaged with him", async () => {
    const c = install({ busy: () => true });
    await vi.advanceTimersByTimeAsync(10_000);
    expect(acted).toEqual([]);
    expect(c.play()).toBe(false);
    c.dispose();
  });

  it("reaches for the torch when the theme goes dark", async () => {
    document.documentElement.dataset.theme = "light";
    const c = install();
    document.documentElement.dataset.theme = "dark";
    await vi.advanceTimersByTimeAsync(700);
    expect(acted).toContain("scene:lights.dark");
    c.dispose();
  });

  it("passes the time when asked, loading the pack first", async () => {
    const c = install();
    expect(c.play()).toBe(true);
    await vi.advanceTimersByTimeAsync(700);
    expect(acted).toHaveLength(1);
    expect(acted[0]).toMatch(/^scene:/);
    c.dispose();
  });
});

describe("fetchVisitorWeather", () => {
  const realFetch = globalThis.fetch;
  afterEach(() => {
    globalThis.fetch = realFetch;
    sessionStorage.clear();
  });

  it("asks once per half hour, remembering even that the place is unknown", async () => {
    const spy = vi.fn(async () => new Response(null, { status: 204 }));
    globalThis.fetch = spy as unknown as typeof fetch;
    expect(await fetchVisitorWeather({ now: 0 })).toBeNull();
    expect(await fetchVisitorWeather({ now: 60_000 })).toBeNull();
    expect(spy).toHaveBeenCalledTimes(1);
    await fetchVisitorWeather({ now: 31 * 60_000 });
    expect(spy).toHaveBeenCalledTimes(2);
  });

  it("asks again after a server error, and ignores a reading that makes no sense", async () => {
    globalThis.fetch = vi.fn(
      async () => new Response("x", { status: 500 })
    ) as unknown as typeof fetch;
    expect(await fetchVisitorWeather({ now: 0 })).toBeNull();
    globalThis.fetch = vi.fn(async () => Response.json({ code: "x" })) as unknown as typeof fetch;
    expect(await fetchVisitorWeather({ now: 1 })).toBeNull();
    const w = weather({ code: 61 });
    sessionStorage.clear();
    globalThis.fetch = vi.fn(async () => Response.json(w)) as unknown as typeof fetch;
    expect(await fetchVisitorWeather({ now: 2 })).toEqual(w);
  });
});
