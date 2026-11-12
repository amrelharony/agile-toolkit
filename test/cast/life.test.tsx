/**
 * Life (lib/cast/life.ts) on figures drawn by CastFigure: who is awake (the
 * most-seen, at least 60% in view, three on a phone and six wider, none while
 * it's quiet, an intro plays, presenting, in a hidden tab or under a real
 * dialog), the look on springs, taps and the reader's guess answered with
 * added animations and swaps, the cooldown and tap limit, a dispose that
 * leaves nothing behind, and lifeEnv's reading of the page.
 */

import { render } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { CastFigure } from "@/components/cast/cast-figure";
import { CLIPS, LIMITS, PACE } from "@/lib/cast/clips";
import type { RigManifest } from "@/lib/cast/rig-types";
import { REACT_EVENT, isCastDialogOpen, lifeEnv, startLife, type LifeEnv } from "@/lib/cast/life";
import { EASE } from "@/lib/motion/tokens";
import { ARMLESS_PUPPET, FAN_PUPPET, TEST_PUPPET } from "./fixtures/rig-fixture";

const quiet = vi.hoisted(() => ({
  isQuietNow: vi.fn<(path: string | null) => boolean>(() => true),
}));
vi.mock("@/lib/notify/quiet-now", () => quiet);

class FakeIO {
  static all: FakeIO[] = [];
  observed = new Set<Element>();
  disconnected = false;
  constructor(
    public cb: IntersectionObserverCallback,
    public options?: IntersectionObserverInit
  ) {
    FakeIO.all.push(this);
  }
  observe(el: Element) {
    this.observed.add(el);
  }
  unobserve(el: Element) {
    this.observed.delete(el);
  }
  disconnect() {
    this.observed.clear();
    this.disconnected = true;
  }
  takeRecords() {
    return [];
  }
  fire(list: [Element, number][]) {
    const entries = list.map(
      ([target, ratio]) =>
        ({
          target,
          intersectionRatio: ratio,
          isIntersecting: ratio > 0,
        }) as IntersectionObserverEntry
    );
    this.cb(entries, this as unknown as IntersectionObserver);
  }
}

const flags = {
  quiet: false,
  intro: false,
  presenting: false,
  dialog: false,
  hidden: false,
  reduced: false,
  narrow: false,
  fine: true,
};

const env: LifeEnv = {
  quiet: () => flags.quiet,
  introOnStage: () => flags.intro,
  presenting: () => flags.presenting,
  dialogOpen: () => flags.dialog,
  hidden: () => flags.hidden,
  reducedMotion: () => flags.reduced,
  narrow: () => flags.narrow,
  finePointer: () => flags.fine,
  now: () => Date.now(),
};

const frames = new Map<number, FrameRequestCallback>();
let nextFrame = 1;
function flush(now: number) {
  const run = Array.from(frames.values());
  frames.clear();
  for (const cb of run) cb(now);
}

type Animate = (frames: Keyframe[], options?: KeyframeAnimationOptions) => { cancel: () => void };
const animate = vi.fn<Animate>(() => ({ cancel: vi.fn() }));

let disposers: (() => void)[] = [];

beforeEach(() => {
  vi.useFakeTimers();
  vi.setSystemTime(10_000);
  FakeIO.all = [];
  frames.clear();
  Object.assign(flags, {
    quiet: false,
    intro: false,
    presenting: false,
    dialog: false,
    hidden: false,
    reduced: false,
    narrow: false,
    fine: true,
  });
  vi.stubGlobal("IntersectionObserver", FakeIO);
  vi.stubGlobal("requestAnimationFrame", (cb: FrameRequestCallback) => {
    frames.set(nextFrame, cb);
    return nextFrame++;
  });
  vi.stubGlobal("cancelAnimationFrame", (id: number) => frames.delete(id));
  animate.mockClear();
  Element.prototype.animate = animate as unknown as Element["animate"];
});

afterEach(() => {
  for (const d of disposers) d();
  disposers = [];
  vi.unstubAllGlobals();
  vi.useRealTimers();
  delete (Element.prototype as Partial<Element>).animate;
  document.body.innerHTML = "";
});

/** Figures in a host, with life started on it. */
function stage(rigs: RigManifest[], { tap = true } = {}) {
  const { container } = render(
    <div data-testid="host">
      {rigs.map((rig, i) => (
        <CastFigure key={i} rig={rig} height="160px" tap={tap} />
      ))}
    </div>
  );
  const host = container.firstElementChild as HTMLElement;
  const figs = Array.from(host.querySelectorAll<HTMLElement>("[data-cast]"));
  const stop = startLife(host, env);
  disposers.push(stop);
  return { host, figs, stop, io: FakeIO.all[FakeIO.all.length - 1] };
}

const awake = (figs: HTMLElement[]) => figs.map((f) => f.hasAttribute("data-cast-awake"));
const rerank = () => window.dispatchEvent(new Event("resize"));

function pointer(type: string, x: number, y: number, pointerType: string): Event {
  const event = new Event(type, { bubbles: true });
  Object.defineProperties(event, {
    clientX: { value: x },
    clientY: { value: y },
    pointerType: { value: pointerType },
  });
  return event;
}

/** The elements animate() was called on, and with what. */
function calls() {
  return animate.mock.calls.map((args, i) => ({
    el: animate.mock.contexts[i] as unknown as HTMLElement,
    frames: args[0],
    options: args[1]!,
  }));
}

const on = (fig: HTMLElement, slot: string) =>
  Array.from(fig.querySelectorAll<HTMLElement>(`[data-swap="${slot}"][data-on]`)).map(
    (el) => el.dataset.choice
  );

describe("awake", () => {
  const eight = Array.from({ length: 8 }, (_, i) => ({
    ...TEST_PUPPET,
    id: `AAW-${10 + i}` as const,
  }));

  it("wakes the most-seen figures at least 60% in view: six wide, three on a phone", () => {
    const { figs, io } = stage(eight);
    expect(io.options?.threshold).toContain(PACE.awakeRatio);
    expect(awake(figs).some(Boolean)).toBe(false);
    const ratios = [0.65, 1, 0.3, 0.8, 0.6, 0.9, 0.59, 0.7];
    io.fire(figs.map((f, i) => [f, ratios[i]]));
    expect(awake(figs)).toEqual([true, true, false, true, true, true, false, true]);

    flags.narrow = true;
    rerank();
    // 1, 0.9 and 0.8 show most.
    expect(awake(figs)).toEqual([false, true, false, true, false, true, false, false]);
    expect(LIMITS.awakePhone).toBe(3);
  });

  it("keeps every figure asleep while it's quiet, an intro plays, presenting, hidden or under a dialog", () => {
    const { figs, io } = stage([TEST_PUPPET]);
    io.fire([[figs[0], 1]]);
    expect(awake(figs)).toEqual([true]);
    for (const flag of ["quiet", "intro", "presenting", "dialog", "hidden"] as const) {
      flags[flag] = true;
      rerank();
      expect(awake(figs), flag).toEqual([false]);
      flags[flag] = false;
      rerank();
      expect(awake(figs), flag).toEqual([true]);
    }
  });

  it("falls asleep when a hidden tab says so, and wakes when it shows again", () => {
    const { figs, io } = stage([TEST_PUPPET]);
    io.fire([[figs[0], 1]]);
    flags.hidden = true;
    document.dispatchEvent(new Event("visibilitychange"));
    expect(awake(figs)).toEqual([false]);
    flags.hidden = false;
    document.dispatchEvent(new Event("visibilitychange"));
    expect(awake(figs)).toEqual([true]);
  });

  it("breathes and blinks in a phase fixed per character", () => {
    const { figs, io } = stage([TEST_PUPPET, ARMLESS_PUPPET]);
    io.fire(figs.map((f) => [f, 1]));
    const delay = (f: HTMLElement) =>
      f.querySelector<HTMLElement>('[data-socket="body"]')!.style.animationDelay;
    const lids = (f: HTMLElement) =>
      f.querySelector<HTMLElement>('[data-slot="eyes"] > [data-choice="closed"]')!.style
        .animationDelay;
    expect(delay(figs[0])).toMatch(/^-\d(\.\d+)?s$/);
    expect(delay(figs[0])).not.toBe(delay(figs[1]));
    expect(lids(figs[0])).toMatch(/^-\d(\.\d+)?s$/);
    expect(lids(figs[0])).not.toBe(lids(figs[1]));
    // The same point in the blink's cycle as in the breath's.
    for (const f of figs) {
      const share = (s: string, cycle: number) => -parseFloat(s) / cycle;
      expect(
        share(lids(f), CLIPS["idle.blink"].ms / 1000) -
          share(delay(f), CLIPS["idle.breathe"].ms / 1000)
      ).toBeCloseTo(0, 2);
    }
    const again = [delay(figs[0]), lids(figs[0])];
    flags.quiet = true;
    rerank();
    expect([delay(figs[0]), lids(figs[0])]).toEqual(["", ""]);
    flags.quiet = false;
    rerank();
    expect([delay(figs[0]), lids(figs[0])]).toEqual(again);
  });

  it("never wakes or answers a figure inside an intro overlay", () => {
    const { container } = render(
      <div>
        <div data-intro-overlay="book" role="dialog" aria-modal="true">
          <CastFigure rig={TEST_PUPPET} height="160px" tap />
        </div>
      </div>
    );
    const host = container.firstElementChild as HTMLElement;
    disposers.push(startLife(host, env));
    expect(FakeIO.all).toHaveLength(0);
    host.querySelector<HTMLElement>("[data-cast]")!.click();
    expect(animate).not.toHaveBeenCalled();
  });
});

describe("a real dialog", () => {
  it("counts, but the always-present intro overlay and a popover don't", () => {
    document.body.innerHTML = `
      <div data-intro-overlay="book" role="dialog" aria-modal="true"></div>
      <div data-radix-popper-content-wrapper><div role="dialog" data-state="open"></div></div>`;
    expect(isCastDialogOpen()).toBe(false);
    document.body.insertAdjacentHTML("beforeend", `<div role="dialog" aria-modal="true"></div>`);
    expect(isCastDialogOpen()).toBe(true);
  });
});

describe("lifeEnv", () => {
  const html = document.documentElement;
  const width = window.innerWidth;
  afterEach(() => {
    delete html.dataset.presenting;
    delete html.dataset.intro;
    Object.defineProperty(window, "innerWidth", { value: width, configurable: true });
    Object.defineProperty(document, "visibilityState", { value: "visible", configurable: true });
    quiet.isQuietNow.mockClear();
  });

  it("reads presenting, an intro and the page's dialogs from the DOM", () => {
    const page = lifeEnv();
    expect([page.presenting(), page.introOnStage()]).toEqual([false, false]);
    html.dataset.presenting = "false";
    expect(page.presenting()).toBe(false);
    html.dataset.presenting = "true";
    html.dataset.intro = "book";
    expect([page.presenting(), page.introOnStage()]).toEqual([true, true]);

    document.body.innerHTML = `<div data-intro-overlay="book" role="dialog" aria-modal="true"></div>`;
    expect(page.dialogOpen()).toBe(false);
    document.body.insertAdjacentHTML(
      "beforeend",
      `<div role="alertdialog" data-state="open"></div>`
    );
    expect(page.dialogOpen()).toBe(true);
  });

  it("asks the quiet state about the route the page names now", () => {
    let route = "/comics";
    const page = lifeEnv(() => route);
    expect(page.quiet()).toBe(true);
    route = "/retro";
    page.quiet();
    expect(quiet.isQuietNow.mock.calls.map((c) => c[0])).toEqual(["/comics", "/retro"]);
    quiet.isQuietNow.mockReturnValueOnce(false);
    expect(page.quiet()).toBe(false);
    lifeEnv().quiet();
    expect(quiet.isQuietNow).toHaveBeenLastCalledWith(null);
  });

  it("reads the tab, the width, the motion setting, the pointer and the clock", () => {
    vi.stubGlobal("matchMedia", (query: string) => ({ matches: query === "(pointer: fine)" }));
    const page = lifeEnv();
    Object.defineProperty(window, "innerWidth", { value: PACE.narrowPx - 1, configurable: true });
    expect(page.narrow()).toBe(true);
    Object.defineProperty(window, "innerWidth", { value: PACE.narrowPx, configurable: true });
    expect(page.narrow()).toBe(false);
    expect(page.hidden()).toBe(false);
    Object.defineProperty(document, "visibilityState", { value: "hidden", configurable: true });
    expect(page.hidden()).toBe(true);
    expect([page.reducedMotion(), page.finePointer()]).toEqual([false, true]);
    vi.stubGlobal("matchMedia", (query: string) => ({
      matches: query === "(prefers-reduced-motion: reduce)",
    }));
    expect([page.reducedMotion(), page.finePointer()]).toEqual([true, false]);
    const clock = vi.spyOn(performance, "now").mockReturnValue(1234.5);
    expect(page.now()).toBe(1234.5);
    clock.mockRestore();
  });
});

describe("the look", () => {
  function lookAt(fig: HTMLElement) {
    fig.getBoundingClientRect = () =>
      ({ left: 100, top: 100, width: 80, height: 160, right: 180, bottom: 260 }) as DOMRect;
  }

  it("turns the head, eyes and body toward the mouse on springs, never past the limits", () => {
    const { figs, io } = stage([TEST_PUPPET]);
    const fig = figs[0];
    lookAt(fig);
    io.fire([[fig, 1]]);
    window.dispatchEvent(pointer("pointermove", 2000, 100 + 160 * 0.3, "mouse"));
    const head = fig.querySelector<HTMLElement>('[data-socket="head"]')!;
    let most = 0;
    for (let t = 16; t <= 1500; t += 16) {
      flush(t);
      most = Math.max(most, parseFloat(head.style.rotate || "0"));
    }
    expect(head.style.rotate).toBe(`${LIMITS.lookDeg}deg`);
    expect(most).toBeLessThanOrEqual(LIMITS.lookDeg);
    expect(fig.querySelector<HTMLElement>('[data-socket="body"]')!.style.rotate).toBe(
      `${PACE.lookLeanDeg}deg`
    );
    for (const p of Array.from(fig.querySelectorAll<HTMLElement>("[data-pupil]"))) {
      expect(p.style.translate).toBe("30% 0%");
    }
    // No frame is asked for once it's still.
    expect(frames.size).toBe(0);

    // Asleep, it comes back to rest and clears its styles.
    flags.quiet = true;
    rerank();
    for (let t = 1516; t <= 3000; t += 16) flush(t);
    expect(head.style.rotate).toBe("");
    expect(frames.size).toBe(0);
  });

  it("drops to the rest pose at once when reduced motion comes on, with no spring back", () => {
    const { figs, io } = stage([TEST_PUPPET]);
    const fig = figs[0];
    lookAt(fig);
    io.fire([[fig, 1]]);
    window.dispatchEvent(pointer("pointermove", 2000, 148, "mouse"));
    for (let t = 16; t <= 1500; t += 16) flush(t);
    const head = fig.querySelector<HTMLElement>('[data-socket="head"]')!;
    expect(head.style.rotate).toBe(`${LIMITS.lookDeg}deg`);
    fig.click();
    const move = animate.mock.results[0].value as { cancel: ReturnType<typeof vi.fn> };

    flags.reduced = true;
    rerank();
    flush(1516);
    expect(head.style.rotate).toBe("");
    expect(fig.querySelector<HTMLElement>('[data-socket="body"]')!.style.rotate).toBe("");
    for (const p of Array.from(fig.querySelectorAll<HTMLElement>("[data-pupil]"))) {
      expect(p.style.translate).toBe("");
    }
    expect(move.cancel).toHaveBeenCalled();
    expect(frames.size).toBe(0);
  });

  it("follows the last touch on a touch screen, for a moment", () => {
    flags.fine = false;
    const { figs, io } = stage([TEST_PUPPET]);
    const fig = figs[0];
    lookAt(fig);
    io.fire([[fig, 1]]);
    const head = fig.querySelector<HTMLElement>('[data-socket="head"]')!;
    flush(8);
    window.dispatchEvent(pointer("pointermove", -2000, 148, "mouse"));
    expect(frames.size).toBe(0);
    window.dispatchEvent(pointer("pointerdown", -2000, 148, "touch"));
    for (let t = 16; t <= 1000; t += 16) flush(t);
    expect(head.style.rotate).toBe(`-${LIMITS.lookDeg}deg`);
    vi.advanceTimersByTime(PACE.lookHoldMs);
    for (let t = 1016; t <= 2500; t += 16) flush(t);
    expect(head.style.rotate).toBe("");
  });

  it("waits while a move plays, and the move turns only within the room the look leaves", () => {
    const { host, figs, io } = stage([{ ...TEST_PUPPET, signature: ["sig.swivel"] }]);
    const fig = figs[0];
    lookAt(fig);
    io.fire([[fig, 1]]);
    const head = fig.querySelector<HTMLElement>('[data-socket="head"]')!;
    const body = fig.querySelector<HTMLElement>('[data-socket="body"]')!;
    window.dispatchEvent(pointer("pointermove", 2000, 148, "mouse"));
    for (let t = 16; t <= 1500; t += 16) flush(t);
    expect(head.style.rotate).toBe(`${LIMITS.lookDeg}deg`);

    // Each clip stays within its limit at its peak (clips.test.ts); scaled by
    // the share of the range the look leaves, look and move together do too.
    const turnsOn = (el: HTMLElement) =>
      calls()
        .filter((c) => c.el === el)
        .flatMap((c) => c.frames.map((f) => parseFloat(String(f.rotate))));
    const scaled = (keys: readonly { rotate?: number }[], share: number) =>
      keys.map((k) => Math.round((k.rotate ?? 0) * share * 100) / 100);
    fig.click();
    expect(turnsOn(head)).toEqual(
      scaled(CLIPS["sig.swivel"].tracks[0].keys, 1 - LIMITS.lookDeg / LIMITS.headDeg)
    );

    // The look holds still while the move plays...
    window.dispatchEvent(pointer("pointermove", -2000, 148, "mouse"));
    for (let t = 1516; t <= 2500; t += 16) flush(t);
    expect(head.style.rotate).toBe(`${LIMITS.lookDeg}deg`);
    expect(frames.size).toBe(0);
    // ...and turns again once it ends.
    vi.advanceTimersByTime(CLIPS["sig.swivel"].ms);
    for (let t = 2516; t <= 4000; t += 16) flush(t);
    expect(head.style.rotate).toBe(`-${LIMITS.lookDeg}deg`);

    // The lean leaves half its range, so a reaction leans half as far.
    animate.mockClear();
    host.dispatchEvent(new CustomEvent(REACT_EVENT, { detail: { kind: "differed" } }));
    vi.advanceTimersByTime(LIMITS.guessDelayMs);
    expect(turnsOn(body)).toEqual(
      scaled(CLIPS["guess.differed"].tracks[0].keys, 1 - PACE.lookLeanDeg / LIMITS.leanDeg)
    );
  });
});

describe("taps", () => {
  it("answer with the signature moves in turn, added over the idle, even while it's quiet", () => {
    flags.quiet = true;
    const { figs } = stage([TEST_PUPPET]);
    const fig = figs[0];
    fig.click();
    let made = calls();
    expect(made.map((c) => c.el.dataset.socket)).toEqual(["tail"]);
    expect(made[0].options).toEqual({ duration: CLIPS["sig.tail"].ms, composite: "add" });
    expect(made[0].frames[0]).toMatchObject({ offset: 0, rotate: "0deg" });
    expect(made[0].frames[made[0].frames.length - 1]).toMatchObject({ offset: 1, rotate: "0deg" });

    vi.advanceTimersByTime(PACE.cooldownMs);
    animate.mockClear();
    fig.click();
    made = calls();
    expect(made.map((c) => c.el.dataset.socket)).toEqual(["arm-r"]);
    vi.advanceTimersByTime(CLIPS["sig.wave"].ms * 0.05 + 1);
    expect(on(fig, "arm-r")).toEqual(["wave"]);
    vi.advanceTimersByTime(CLIPS["sig.wave"].ms);
    expect(on(fig, "arm-r")).toEqual(["rest"]);
  });

  it("fold a fan that rests open and spread it again, open by the move's end", () => {
    const { figs } = stage([FAN_PUPPET]);
    const fig = figs[0];
    const shown = [on(fig, "fan").join()];
    fig.click();
    for (let ms = 0; ms < CLIPS["sig.fan"].ms; ms += 10) {
      vi.advanceTimersByTime(10);
      const now = on(fig, "fan").join();
      if (now !== shown[shown.length - 1]) shown.push(now);
    }
    expect(shown).toEqual(["open", "closed", "open"]);
  });

  it("wait out the cooldown, and a burst of three in 2 s is ignored for 2 s", () => {
    const { figs } = stage([TEST_PUPPET]);
    const fig = figs[0];
    const tapAt = (ms: number) => {
      vi.setSystemTime(10_000 + ms);
      animate.mockClear();
      fig.click();
      return animate.mock.calls.length > 0;
    };
    expect(tapAt(0)).toBe(true);
    expect(tapAt(500)).toBe(false); // cooling down
    expect(tapAt(950)).toBe(false); // the third tap within 2 s
    expect(tapAt(2500)).toBe(false); // ignored for 2 s
    expect(tapAt(3000)).toBe(true);
  });

  it("play once when a second life starts over the same figures, which it leaves alone", () => {
    const { figs, io } = stage([TEST_PUPPET]);
    const whole = startLife(document.body, env);
    disposers.push(whole);
    // The page-wide life found no figure of its own: no observer, no listener.
    expect(FakeIO.all.at(-1)).toBe(io);
    io.fire([[figs[0], 1]]);
    expect(awake(figs)).toEqual([true]);
    figs[0].click();
    expect(calls().map((c) => c.el.dataset.socket)).toEqual(["tail"]);

    // Once the first is gone, the figures are free for another.
    for (const d of disposers.splice(0)) d();
    animate.mockClear();
    disposers.push(startLife(document.body, env));
    vi.advanceTimersByTime(PACE.cooldownMs);
    figs[0].click();
    expect(calls().map((c) => c.el.dataset.socket)).toEqual(["tail"]);
  });

  it("are ignored on a figure that doesn't take them", () => {
    const { figs } = stage([TEST_PUPPET], { tap: false });
    figs[0].click();
    expect(animate).not.toHaveBeenCalled();
  });
});

describe("the reader's guess", () => {
  it("plays on each figure after a beat, staggered, with more for the first speaker", () => {
    const { host, figs } = stage([TEST_PUPPET, ARMLESS_PUPPET]);
    host.dispatchEvent(
      new CustomEvent(REACT_EVENT, { detail: { kind: "matched", first: "AAW-90" } })
    );
    vi.advanceTimersByTime(LIMITS.guessDelayMs - 1);
    expect(animate).not.toHaveBeenCalled();
    vi.advanceTimersByTime(1);
    expect(calls().map((c) => c.el.dataset.socket)).toEqual(["head", "body"]);
    expect(on(figs[0], "eyes")).toEqual(["happy"]);
    expect(on(figs[0], "mouth")).toEqual(["smile"]);
    vi.advanceTimersByTime(CLIPS["guess.matched"].ms * 0.05);
    expect(on(figs[0], "arm-r")).toEqual(["up"]);
    expect(on(figs[0], "arm-l")).toEqual(["up"]);

    animate.mockClear();
    vi.advanceTimersByTime(LIMITS.staggerMs);
    // The second has no arms and isn't the first speaker: a nod and a smile.
    expect(calls().map((c) => c.el.closest("[data-cast]")!.getAttribute("data-cast"))).toEqual([
      "AAW-91",
    ]);
    expect(on(figs[1], "eyes")).toEqual(["happy"]);

    vi.advanceTimersByTime(1000);
    for (const fig of figs) {
      for (const slot of ["eyes", "mouth", "arm-r", "arm-l"]) {
        for (const el of Array.from(fig.querySelectorAll(`[data-swap="${slot}"][data-on]`))) {
          expect(el).toHaveAttribute("data-rest");
        }
      }
    }
  });

  it("answers a skip with a shrug, or a head tilt where there are no arms", () => {
    const { host, figs } = stage([TEST_PUPPET, ARMLESS_PUPPET]);
    host.dispatchEvent(new CustomEvent(REACT_EVENT, { detail: { kind: "skipped" } }));
    vi.advanceTimersByTime(LIMITS.guessDelayMs + LIMITS.staggerMs + 100);
    const bySocket = calls().map((c) => [
      c.el.closest("[data-cast]")!.getAttribute("data-cast"),
      c.el.dataset.socket,
    ]);
    expect(bySocket).toEqual([
      ["AAW-90", "body"],
      ["AAW-91", "body"],
      ["AAW-91", "head"],
    ]);
    expect(on(figs[0], "arm-r")).toEqual(["open"]);
  });

  it("moves only rotate, translate and scale, without overshoot while presenting", () => {
    flags.presenting = true;
    const { host } = stage([TEST_PUPPET]);
    host.dispatchEvent(new CustomEvent(REACT_EVENT, { detail: { kind: "differed" } }));
    vi.advanceTimersByTime(LIMITS.guessDelayMs);
    expect(animate).toHaveBeenCalled();
    for (const { frames: list, options } of calls()) {
      expect(options.composite).toBe("add");
      for (const f of list) {
        for (const prop of Object.keys(f)) {
          expect(["offset", "easing", "rotate", "translate", "scale"]).toContain(prop);
        }
        expect(f.easing).toBe(EASE.calm);
      }
    }
  });

  it("ignores a reaction it doesn't know, and plays nothing under reduced motion", () => {
    const { host } = stage([TEST_PUPPET]);
    host.dispatchEvent(new CustomEvent(REACT_EVENT, { detail: { kind: "sad" } }));
    host.dispatchEvent(new CustomEvent(REACT_EVENT, { detail: null }));
    vi.advanceTimersByTime(2000);
    expect(animate).not.toHaveBeenCalled();
    flags.reduced = true;
    host.dispatchEvent(new CustomEvent(REACT_EVENT, { detail: { kind: "matched" } }));
    vi.advanceTimersByTime(2000);
    expect(animate).not.toHaveBeenCalled();
  });
});

describe("dispose", () => {
  it("takes back every listener, timer and animation, and leaves the figures at rest", () => {
    const { host, figs, io, stop } = stage([TEST_PUPPET]);
    const fig = figs[0];
    io.fire([[fig, 1]]);
    fig.click();
    vi.advanceTimersByTime(PACE.cooldownMs);
    fig.click();
    vi.advanceTimersByTime(100);
    expect(on(fig, "arm-r")).toEqual(["wave"]);
    const running = animate.mock.results.map(
      (r) => r.value as { cancel: ReturnType<typeof vi.fn> }
    );
    host.dispatchEvent(new CustomEvent(REACT_EVENT, { detail: { kind: "matched" } }));

    stop();
    expect(io.disconnected).toBe(true);
    expect(fig.hasAttribute("data-cast-awake")).toBe(false);
    expect(on(fig, "arm-r")).toEqual(["rest"]);
    expect(running.at(-1)!.cancel).toHaveBeenCalled();
    for (const el of Array.from(fig.querySelectorAll<HTMLElement>("[style]"))) {
      expect(el.style.rotate).toBe("");
      expect(el.style.translate).toBe("");
      expect(el.style.animationDelay).toBe("");
    }

    animate.mockClear();
    vi.advanceTimersByTime(5000);
    fig.click();
    window.dispatchEvent(pointer("pointermove", 0, 0, "mouse"));
    rerank();
    expect(animate).not.toHaveBeenCalled();
    expect(frames.size).toBe(0);
    expect(fig.hasAttribute("data-cast-awake")).toBe(false);
    expect(vi.getTimerCount()).toBe(0);
  });
});
