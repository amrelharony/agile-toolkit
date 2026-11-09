/**
 * Everything Amr notices without being touched, installed once his figure is on
 * screen (mascot-sprite.tsx): the page (interactions/page.ts), the phone's motion
 * (interactions/sensors.ts, when the visitor allows it), the day, the weather and
 * the hour (interactions/context.ts) and the idle ladder (idle.ts), all speaking
 * to the store and all sharing one director, so the unprompted ones stay rare.
 * Paused while the tab is hidden.
 *
 * His mind (lib/agent/mascot/mind.ts) ticks along here too: his temperament sets
 * how often he does something unprompted and how soon he tires, his mood reaches
 * the sprite, someone he knows gets a wave, and he remembers what he's played.
 * And he reads how the visit is going (interactions/intent.ts): an offer of help
 * when someone seems stuck, quiet while they read, a stretch after a long haul.
 */

import { useAgentStore } from "@/lib/agent/store";
import { HELP_OFFER, STRETCH_OFFER, WELCOME_BACK, streakLine } from "@/lib/agent/mascot/lines";
import { did, feel, getMind, recentlyDid, takeArrival } from "@/lib/agent/mascot/mind";
import { say } from "@/lib/agent/mascot/say";
import { useMascotStore, type MascotReaction } from "@/lib/agent/mascot/store";
import type { PackId } from "../mascot-packs";
import { createDirector } from "./director";
import { createIdleLadder, firstMorningVisit, type IdleLadder } from "./idle";
import { installContextSenses } from "./interactions/context";
import { installIntentSenses, type IntentSenses } from "./interactions/intent";
import { installPageSenses } from "./interactions/page";
import { moodFor } from "./mood";
import { fetchVisitorWeather } from "@/lib/agent/mascot/context/weather";
import { visitorWeekend } from "@/lib/agent/mascot/context/moments";
import {
  canFeelPhone,
  feelsPhone,
  installMotionSenses,
  type MotionFrame,
} from "./interactions/sensors";
import { isPhoneViewport } from "@/lib/layout/breakpoints";
import { CONTROL_SELECTOR } from "../mascot-nudge";

export interface SensesOptions {
  reducedMotion: boolean;
  /** Where he stands: the figure's box. */
  figure: () => HTMLElement | null;
  /** Load packs ahead of need. */
  want(packs: PackId[]): void;
  /** Where the phone's pose is kept for the sprite's tick (see sensors.ts). */
  motion?: MotionFrame;
}

const INPUTS = ["pointerdown", "pointermove", "keydown", "wheel", "touchstart", "scroll"] as const;
/** Keys this recently mean the visitor is typing: he keeps to himself. */
const TYPING_MS = 8000;
/** He greets someone he knows this long after arriving. */
const HELLO_MS = 1600;

/** His own figure, panel and bubble: a tap there is answered by him. */
const HIS_OWN = "[data-mascot-hit], [data-agent-sheet-root], [data-amr-bubble]";

/** How he greets someone he knows: a wave, or a cheer on the third and seventh day running. */
export function helloFor(arrival: ReturnType<typeof takeArrival>): MascotReaction | null {
  if (arrival.kind === "back") return "wave";
  if (arrival.kind !== "next-day") return null;
  return arrival.streak === 3 || arrival.streak === 7 ? "cheer" : "wave";
}

export function installSenses(opts: SensesOptions): () => void {
  const mascot = () => useMascotStore.getState();
  const mind = getMind();
  let lastKeyAt = -Infinity;
  const typing = () => Date.now() - lastKeyAt < TYPING_MS;
  let intent: IntentSenses | null = null;
  // While the visitor types or reads, he keeps to himself.
  const director = createDirector(
    () => Date.now(),
    () => mind.brain.gapMs(typing() || intent?.reading() === true)
  );
  const isPhone = isPhoneViewport;
  const parkedTop = () => {
    const r = opts.figure()?.getBoundingClientRect();
    return !!r && r.top + r.height / 2 < window.innerHeight / 2;
  };
  const hold = (h: Parameters<ReturnType<typeof mascot>["setHold"]>[0], on: boolean) =>
    mascot().setHold(h, on);

  const disposePage = installPageSenses({
    act: (r) => mascot().queueReaction(r),
    hold,
    allow: director.allow,
    isPhone,
    isOpen: () => useAgentStore.getState().open,
    parkedTop,
    reducedMotion: opts.reducedMotion,
  });

  // Phone motion: follows the visitor's choice as it changes.
  let ladder: IdleLadder | null = null;
  let disposeMotion: (() => void) | null = null;
  const syncMotion = () => {
    const on = !opts.reducedMotion && canFeelPhone() && feelsPhone(mascot().feelPhone);
    if (on && !disposeMotion) {
      // Tips and windmills, being tossed and hanging on, a glad face when it's turned back over.
      opts.want(["balance", "lifted", "social"]);
      disposeMotion = installMotionSenses({
        hold,
        act: (r) => mascot().queueReaction(r),
        playNow: (r) => {
          if (r === "dizzy") feel("shaken");
          else if (r === "land") feel("thrown");
          else if (r === "startle") feel("startled");
          mascot().playNow(r);
        },
        frame: opts.motion,
        // Put down, he tires sooner; picked up, that's someone here.
        rest: (resting) => {
          ladder?.hurry(resting);
          if (!resting) ladder?.input();
        },
      });
    } else if (!on && disposeMotion) {
      disposeMotion();
      disposeMotion = null;
    }
  };
  syncMotion();
  const unsubMotion = useMascotStore.subscribe((s, prev) => {
    if (s.feelPhone !== prev.feelPhone) syncMotion();
  });

  const busy = () => {
    const m = mascot();
    return useAgentStore.getState().open || m.talking || m.drag !== null;
  };

  // How the visit is going: stuck, reading, or at it for a long while.
  intent = installIntentSenses({
    act: (r) => mascot().queueReaction(r),
    allow: director.allow,
    busy,
    path: () => window.location.pathname,
    offerHelp: () =>
      say("help", {
        id: "help",
        text: HELP_OFFER,
        onTap: () => useAgentStore.getState().openSheet(),
      }),
    suggestStretch: () => {
      opts.want(["rest"]);
      say("stretch", { id: "stretch", text: STRETCH_OFFER });
    },
    isControl: (target) => {
      const el = target as Element | null;
      return !!el?.closest?.(`${CONTROL_SELECTOR}, ${HIS_OWN}`);
    },
  });

  // The day, the weather where the visitor is, the hour, the page.
  const context = installContextSenses({
    act: (r) => mascot().queueReaction(r),
    allow: director.allow,
    busy,
    want: opts.want,
    path: () => window.location.pathname,
    weather: () => fetchVisitorWeather(),
    weekend: visitorWeekend,
    recent: recentlyDid,
    played: did,
  });

  // Nobody around → pass the time, yawn, sit, doze. Any input wakes him.
  ladder = createIdleLadder({
    act: (r) => mascot().queueReaction(r),
    playNow: (r) => mascot().playNow(r),
    hold,
    allow: director.allow,
    busy,
    play: () => {
      const playing = context.play();
      if (playing) feel("played");
      return playing;
    },
    pace: () => mind.brain.pace(),
    canStroll: () =>
      !opts.reducedMotion &&
      !isPhone() &&
      window.matchMedia?.("(pointer: fine)").matches === true &&
      !parkedTop(),
    want: opts.want,
  });
  const idle = ladder;
  const onInput = () => idle.input();
  INPUTS.forEach((e) => window.addEventListener(e, onInput, { passive: true }));
  const onKey = () => {
    lastKeyAt = Date.now();
  };
  window.addEventListener("keydown", onKey, { passive: true });

  // His mood reaches the sprite when it changes enough to show (its speed, the drone).
  let moodName = moodFor(mascot().mood.valence, mascot().mood.energy);
  const publishMood = () => {
    const mood = mind.brain.mood();
    const name = moodFor(mood.valence, mood.energy);
    if (name === moodName) return;
    moodName = name;
    mascot().setMood(mood);
  };
  let ticker: ReturnType<typeof setInterval> | undefined;
  const run = () => {
    clearInterval(ticker);
    ticker = undefined;
    if (document.hidden) return;
    idle.input(); // back from a hidden tab counts as being here
    ticker = setInterval(() => {
      mind.brain.tick();
      publishMood();
      idle.tick();
      context.check();
    }, 1000);
  };
  document.addEventListener("visibilitychange", run);
  run();

  // The first visit of a morning: a stretch, once he's settled in.
  const isMorning = firstMorningVisit();
  if (isMorning) opts.want(["rest"]);
  const morning = isMorning
    ? setTimeout(() => {
        if (director.allow("stretch", 60_000)) mascot().queueReaction("stretch");
      }, 2500)
    : undefined;

  // Someone he knows: a wave when they're back, a cheer on a run of days.
  const arrival = takeArrival();
  const hello = helloFor(arrival);
  const helloTimer = hello
    ? setTimeout(() => {
        if (!director.allow("hello", 60_000, true)) return;
        feel("greeted");
        mascot().queueReaction(hello);
        if (arrival.kind === "back") say("welcome", { id: "welcome", text: WELCOME_BACK });
        else if (hello === "cheer" && arrival.kind === "next-day") {
          say("streak", { id: "streak", text: streakLine(arrival.streak) });
        }
      }, HELLO_MS)
    : undefined;

  return () => {
    disposePage();
    clearTimeout(helloTimer);
    intent?.dispose();
    window.removeEventListener("keydown", onKey);
    context.dispose();
    unsubMotion();
    disposeMotion?.();
    INPUTS.forEach((e) => window.removeEventListener(e, onInput));
    document.removeEventListener("visibilitychange", run);
    clearInterval(ticker);
    clearTimeout(morning);
    const m = mascot();
    m.setHold("sitting", false);
    m.setHold("dozing", false);
  };
}
