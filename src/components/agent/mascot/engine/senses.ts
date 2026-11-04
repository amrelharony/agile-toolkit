/**
 * Everything Amr notices without being touched, installed once his figure is on
 * screen (mascot-sprite.tsx): the page (interactions/page.ts), the phone's motion
 * (interactions/sensors.ts, when the visitor allows it), the day, the weather and
 * the hour (interactions/context.ts) and the idle ladder (idle.ts), all speaking
 * to the store and all sharing one director, so the unprompted ones stay rare.
 * Paused while the tab is hidden.
 */

import { useAgentStore } from "@/lib/agent/store";
import { useMascotStore } from "@/lib/agent/mascot/store";
import type { PackId } from "../mascot-packs";
import { createDirector } from "./director";
import { createIdleLadder, firstMorningVisit } from "./idle";
import { installContextSenses } from "./interactions/context";
import { installPageSenses } from "./interactions/page";
import { fetchVisitorWeather } from "@/lib/agent/mascot/context/weather";
import { visitorWeekend } from "@/lib/agent/mascot/context/moments";
import { canFeelPhone, feelsPhone, installMotionSenses } from "./interactions/sensors";

export interface SensesOptions {
  reducedMotion: boolean;
  /** Where he stands: the figure's box. */
  figure: () => HTMLElement | null;
  /** Load packs ahead of need. */
  want(packs: PackId[]): void;
}

const INPUTS = ["pointerdown", "pointermove", "keydown", "wheel", "touchstart", "scroll"] as const;

export function installSenses(opts: SensesOptions): () => void {
  const mascot = () => useMascotStore.getState();
  const director = createDirector();
  const isPhone = () => window.matchMedia?.("(max-width: 639px)").matches === true;
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
  let disposeMotion: (() => void) | null = null;
  const syncMotion = () => {
    const on = !opts.reducedMotion && canFeelPhone() && feelsPhone(mascot().feelPhone);
    if (on && !disposeMotion) {
      opts.want(["balance"]);
      disposeMotion = installMotionSenses({
        hold,
        act: (r) => mascot().queueReaction(r),
        playNow: (r) => mascot().playNow(r),
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

  // The day, the weather where the visitor is, the hour, the page.
  const context = installContextSenses({
    act: (r) => mascot().queueReaction(r),
    allow: director.allow,
    busy,
    want: opts.want,
    path: () => window.location.pathname,
    weather: () => fetchVisitorWeather(),
    weekend: visitorWeekend,
  });

  // Nobody around → pass the time, yawn, sit, doze. Any input wakes him.
  const ladder = createIdleLadder({
    act: (r) => mascot().queueReaction(r),
    playNow: (r) => mascot().playNow(r),
    hold,
    allow: director.allow,
    busy,
    play: () => context.play(),
    canStroll: () =>
      !opts.reducedMotion &&
      !isPhone() &&
      window.matchMedia?.("(pointer: fine)").matches === true &&
      !parkedTop(),
    want: opts.want,
  });
  const onInput = () => ladder.input();
  INPUTS.forEach((e) => window.addEventListener(e, onInput, { passive: true }));
  let ticker: ReturnType<typeof setInterval> | undefined;
  const run = () => {
    clearInterval(ticker);
    ticker = undefined;
    if (document.hidden) return;
    ladder.input(); // back from a hidden tab counts as being here
    ticker = setInterval(() => {
      ladder.tick();
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

  return () => {
    disposePage();
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
