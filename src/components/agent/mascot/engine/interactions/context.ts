/**
 * Amr in context: on arrival he marks the day, the weather or the hour with one
 * scene (docs/mascot/context-sheets.json), each moment once a day; idle, he
 * passes the time with the day's scenes or a game; he reaches for a torch when
 * the theme goes dark, frets when the phone's battery runs low, and notices a
 * long stretch of typing.
 *
 * Only scenes whose sheets have shipped are ever asked for (shippedScene), so
 * this does nothing at all until the packs exist. Unprompted, so it all goes
 * through the director's restraint.
 */

import type { MascotReaction } from "@/lib/agent/mascot/store";
import { cairoDay } from "@/lib/agent/mascot/context/occasions";
import { momentsNow, PLAY_SCENES, type Moment } from "@/lib/agent/mascot/context/moments";
import { toolPageScenes } from "@/lib/agent/mascot/context/tool-scenes";
import type { WeatherNow } from "@/lib/agent/mascot/context/weather";
import type { PackId } from "../../mascot-packs";
import { clipPacks, shippedScene } from "../sprite-poses";
import { sceneReaction } from "../scenes";

export interface ContextHooks {
  act(r: MascotReaction): void;
  allow(name: string, cooldownMs?: number, urgent?: boolean): boolean;
  /** Someone's engaged with him: the panel is open, a reply streams, he's carried. */
  busy(): boolean;
  /** Load these packs ahead of the moment they're needed. */
  want(packs: PackId[]): void;
  /** The page's path. */
  path(): string;
  /** The visitor's weather (null when it isn't known). */
  weather(): Promise<WeatherNow | null>;
  /** The visitor's weekend days, 0 = Sunday. */
  weekend(): readonly number[];
  /** Whether a scene's sheet has shipped. */
  shipped?: (scene: string) => boolean;
  /** The last things he did (lib/agent/mascot/mind.ts): pastimes among them step back. */
  recent?: () => readonly string[];
  /** He's about to play this scene. */
  played?: (scene: string) => void;
  now?: () => Date;
  random?: () => number;
  storage?: Pick<Storage, "getItem" | "setItem"> | null;
  /** setTimeout, injectable for tests. */
  later?: (fn: () => void, ms: number) => unknown;
}

export interface ContextSenses {
  /** The visitor has been idle a while: pass the time with a scene. True if one plays. */
  play(): boolean;
  /** Look again: a new page, or the hour turned. */
  check(): void;
  dispose(): void;
}

/** He greets this long after arriving, once he's settled in. */
export const GREET_MS = 6000;
/** Waiting for the weather no longer than this before choosing. */
const WEATHER_WAIT_MS = 4000;
/** A pack this long to load before its scene plays. */
const LOAD_MS = 1200;
const GREETED_KEY = "mascot_greeted";

/** Which moments he has marked, and on which Cairo day. */
function readGreeted(storage: ContextHooks["storage"]): Record<string, string> {
  try {
    const raw = storage?.getItem(GREETED_KEY);
    if (!raw || raw.length > 8192) return {};
    const parsed = JSON.parse(raw) as unknown;
    return parsed && typeof parsed === "object" ? (parsed as Record<string, string>) : {};
  } catch {
    return {};
  }
}

/** The greeting for the first moment not yet marked today whose scene has shipped. */
export function pickGreeting(
  moments: readonly Moment[],
  greeted: Record<string, string>,
  today: string,
  shipped: (scene: string) => boolean
): { moment: Moment; scene: string } | null {
  for (const m of moments) {
    if (greeted[m.id] === today) continue;
    const scene = m.scenes[0];
    if (scene && shipped(scene)) return { moment: m, scene };
  }
  return null;
}

/**
 * A scene to pass the time: the day's own twice as likely as a game, never the
 * one he just played, and the ones he hasn't played lately (`recent`) before the
 * ones he has.
 */
export function pickPastime(
  moments: readonly Moment[],
  shipped: (scene: string) => boolean,
  random: () => number,
  last: string | null,
  recent: readonly string[] = []
): string | null {
  const pool: string[] = [];
  for (const m of moments) for (const s of m.scenes) if (shipped(s)) pool.push(s, s);
  for (const s of PLAY_SCENES) if (shipped(s)) pool.push(s);
  const choices = pool.filter((s) => s !== last);
  if (!choices.length) return null;
  const fresh = choices.filter((s) => !recent.includes(s));
  const from = fresh.length ? fresh : choices;
  return from[Math.floor(random() * from.length) % from.length];
}

/** Within the last ten minutes, this many keys is a stretch of real work. */
export const FOCUS_KEYS = 300;
const FOCUS_WINDOW_MS = 10 * 60_000;

export function installContextSenses(hooks: ContextHooks): ContextSenses {
  const now = hooks.now ?? (() => new Date());
  const random = hooks.random ?? Math.random;
  const later = hooks.later ?? ((fn: () => void, ms: number) => setTimeout(fn, ms));
  const shipped = hooks.shipped ?? ((scene: string) => shippedScene(scene) !== undefined);
  const storage = hooks.storage === undefined ? safeLocalStorage() : hooks.storage;
  let disposed = false;
  let weather: WeatherNow | null = null;
  let lastPastime: string | null = null;
  const timers: unknown[] = [];

  const after = (ms: number, fn: () => void) => {
    timers.push(later(() => !disposed && fn(), ms));
  };
  const moments = () =>
    momentsNow({ now: now(), weather, path: hooks.path(), weekend: hooks.weekend() });
  const packsOf = (scene: string) => {
    const c = shippedScene(scene);
    return c ? clipPacks(c) : [];
  };
  /** Load the scene's pack, then play it. */
  const stage = (scene: string, delay = LOAD_MS) => {
    hooks.want(packsOf(scene));
    hooks.played?.(scene);
    after(delay, () => hooks.act(sceneReaction(scene)));
  };

  function greet(urgent: boolean): void {
    if (hooks.busy()) return;
    const today = cairoDay(now());
    const greeted = readGreeted(storage);
    const pick = pickGreeting(moments(), greeted, today, shipped);
    if (!pick || !hooks.allow("context", 60_000, urgent)) return;
    // Forget other days' marks, keep today's.
    const next: Record<string, string> = { [pick.moment.id]: today };
    for (const [id, day] of Object.entries(greeted)) if (day === today) next[id] = day;
    try {
      storage?.setItem(GREETED_KEY, JSON.stringify(next));
    } catch {
      /* he may greet again on the next visit */
    }
    stage(pick.scene);
  }

  // Arrival: wait for the weather (briefly), then greet once he's settled.
  let greetedOnArrival = false;
  const arrive = () => {
    if (greetedOnArrival) return;
    greetedOnArrival = true;
    greet(true);
  };
  void hooks.weather().then(
    (w) => {
      weather = w;
    },
    () => undefined
  );
  after(Math.max(GREET_MS - LOAD_MS, WEATHER_WAIT_MS), arrive);

  // The theme going dark or light.
  let theme = typeof document !== "undefined" ? document.documentElement.dataset.theme : undefined;
  const themeWatch =
    typeof MutationObserver !== "undefined" && typeof document !== "undefined"
      ? new MutationObserver(() => {
          const next = document.documentElement.dataset.theme;
          if (next === theme) return;
          const was = theme;
          theme = next;
          if (!was) return;
          const scene = next === "dark" ? "lights.dark" : next === "light" ? "lights.light" : null;
          if (scene && shipped(scene) && hooks.allow("lights", 15_000, true)) stage(scene, 600);
        })
      : null;
  themeWatch?.observe(document.documentElement, {
    attributes: true,
    attributeFilter: ["data-theme"],
  });

  // The phone's battery: low, then charging again.
  let battery: BatteryLike | null = null;
  let wasLow = false;
  const onBattery = () => {
    if (!battery) return;
    const low = !battery.charging && battery.level <= 0.15;
    if (low && !wasLow && shipped("phone.low") && hooks.allow("battery", 30 * 60_000, true)) {
      stage("phone.low");
    }
    if (
      wasLow &&
      battery.charging &&
      shipped("phone.charged") &&
      hooks.allow("charged", 60_000, true)
    ) {
      stage("phone.charged");
    }
    if (low) wasLow = true;
    else if (battery.charging) wasLow = false;
  };
  const nav = typeof navigator !== "undefined" ? (navigator as NavigatorWithBattery) : null;
  if (nav?.getBattery && (shipped("phone.low") || shipped("phone.charged"))) {
    nav.getBattery().then(
      (b) => {
        if (disposed) return;
        battery = b;
        b.addEventListener("levelchange", onBattery);
        b.addEventListener("chargingchange", onBattery);
        onBattery();
      },
      () => undefined
    );
  }

  // A long stretch of typing.
  const keys: number[] = [];
  const onKey = () => {
    const t = now().getTime();
    keys.push(t);
    while (keys.length && t - keys[0] > FOCUS_WINDOW_MS) keys.shift();
    if (keys.length >= FOCUS_KEYS && shipped("focus") && hooks.allow("focus", 30 * 60_000)) {
      keys.length = 0;
      stage(random() < 0.5 ? "focus" : shipped("focus.music") ? "focus.music" : "focus");
    }
  };
  if (typeof window !== "undefined") window.addEventListener("keydown", onKey, { passive: true });

  /** On a tool's page, load the packs its moments play, before the first one happens. */
  const preloadTool = (path: string) => {
    const packs = Array.from(new Set(toolPageScenes(path).filter(shipped).flatMap(packsOf)));
    if (packs.length) hooks.want(packs);
  };

  let lastPath = hooks.path();
  preloadTool(lastPath);

  return {
    play() {
      if (hooks.busy()) return false;
      const scene = pickPastime(moments(), shipped, random, lastPastime, hooks.recent?.() ?? []);
      if (!scene || !hooks.allow("pastime", 2 * 60_000)) return false;
      lastPastime = scene;
      stage(scene, 600);
      return true;
    },
    check() {
      const path = hooks.path();
      if (path === lastPath) return;
      lastPath = path;
      preloadTool(path);
      if (greetedOnArrival) greet(false); // a new page may have its own moment
    },
    dispose() {
      disposed = true;
      themeWatch?.disconnect();
      if (battery) {
        battery.removeEventListener("levelchange", onBattery);
        battery.removeEventListener("chargingchange", onBattery);
      }
      if (typeof window !== "undefined") window.removeEventListener("keydown", onKey);
      timers.forEach((t) => clearTimeout(t as ReturnType<typeof setTimeout>));
    },
  };
}

interface BatteryLike extends EventTarget {
  charging: boolean;
  level: number;
}
type NavigatorWithBattery = Navigator & { getBattery?: () => Promise<BatteryLike> };

function safeLocalStorage(): Storage | null {
  try {
    return typeof localStorage !== "undefined" ? localStorage : null;
  } catch {
    return null;
  }
}
