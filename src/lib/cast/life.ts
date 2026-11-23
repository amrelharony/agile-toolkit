/**
 * Life for the cast figures on a page. components/cast/cast-life.tsx loads it
 * when the browser is idle, never under reduced motion, Save-Data or 2G, and
 * never for an intro (the intro's scene moves its own figures).
 *
 * It reads only the figures' DOM attributes (data-cast, data-sig,
 * data-travel, the sockets and the choices) and imports no rig.
 *
 * - **Awake:** a figure at least PACE.awakeRatio on screen, ranked by how much
 *   shows, at most LIMITS.awakePhone under PACE.narrowPx and awakeWide wider,
 *   across every host on the page. An awake figure gets data-cast-awake, so
 *   the module's breathe and blink run, each figure in a phase of its own,
 *   and it looks toward the mouse or the last touch on springs
 *   (lib/motion/spring.ts). Nothing is awake while it's
 *   quiet (lib/notify/quiet-now.ts), while an intro holds the stage, while
 *   presenting, in a hidden tab, or under an open dialog (the always-present
 *   intro overlay doesn't count).
 * - **Answers:** a tap on a figure with data-tap plays its signature moves in
 *   turn; a `cast:react` event on the host plays the guess reaction on each
 *   figure, staggered. Both are answered even while it's quiet, without
 *   overshoot while presenting. Reactions are added over the idle with the Web
 *   Animations API (composite "add") and swaps flip data-on. The look waits
 *   while a move plays, and the move turns the head, the lean and the pupils
 *   only within the share of their range the look leaves, so the two never
 *   add up past a limit. One move per figure per PACE.cooldownMs; a burst of
 *   taps is ignored for a while.
 *
 * A figure is moved by the first life started over it; a later one over the
 * same figures (the whole page, say) leaves them alone. startLife returns a
 * dispose that takes every listener, timer and animation back and leaves the
 * figures at rest.
 */

import {
  LIMITS,
  PACE,
  clipFor,
  type Clip,
  type Ease,
  type GuessKind,
  type Layer,
  type Track,
} from "./clips";
import { isAtRest, springFor, stepSpring, type SpringState } from "@/lib/motion/spring";
import { isIntroOnStage } from "@/lib/motion/stage";
import { EASE, EASE_FALLBACK } from "@/lib/motion/tokens";
import { OPEN_DIALOG_SELECTOR, POPOVER_WRAPPER_SELECTOR } from "@/lib/notify/dialog-open";
import { isQuietNow } from "@/lib/notify/quiet-now";

/** Dispatched on a host (or inside it) after the reader's own guess. */
export const REACT_EVENT = "cast:react";

export interface ReactDetail {
  kind: GuessKind;
  /** The cast id of the story's first speaker, who answers a match with more. */
  first?: string;
}

/** What life asks of the page; tests pass their own. */
export interface LifeEnv {
  quiet(): boolean;
  introOnStage(): boolean;
  presenting(): boolean;
  dialogOpen(): boolean;
  hidden(): boolean;
  reducedMotion(): boolean;
  /** Under PACE.narrowPx wide. */
  narrow(): boolean;
  finePointer(): boolean;
  now(): number;
}

const OVERLAY = "[data-intro-overlay]";

/**
 * A modal dialog or sheet is open: lib/notify/dialog-open.ts's selectors,
 * without popovers and without the intro overlay, which is always in the
 * page as a dialog and shows only while an intro plays.
 */
export function isCastDialogOpen(root: ParentNode = document): boolean {
  const found = root.querySelectorAll(OPEN_DIALOG_SELECTOR);
  for (let i = 0; i < found.length; i++) {
    if (!found[i].closest(POPOVER_WRAPPER_SELECTOR) && !found[i].closest(OVERLAY)) return true;
  }
  return false;
}

const media = (query: string) => typeof matchMedia === "function" && matchMedia(query).matches;

/** The page's own answers. `pathname` returns usePathname()'s latest value. */
export function lifeEnv(pathname: () => string | null = () => null): LifeEnv {
  const html = () => document.documentElement;
  return {
    quiet: () => isQuietNow(pathname()),
    introOnStage: () => isIntroOnStage(html()),
    presenting: () => html().dataset.presenting === "true",
    dialogOpen: () => isCastDialogOpen(),
    hidden: () => document.visibilityState === "hidden",
    reducedMotion: () => media("(prefers-reduced-motion: reduce)"),
    narrow: () => window.innerWidth < PACE.narrowPx,
    finePointer: () => media("(pointer: fine)"),
    now: () => performance.now(),
  };
}

const CHANNELS = ["head", "lean", "px", "py"] as const;
type Channel = (typeof CHANNELS)[number];
type Aim = Record<Channel, number>;

interface Fig {
  el: HTMLElement;
  id: string;
  ratio: number;
  awake: boolean;
  head: HTMLElement[];
  body: HTMLElement[];
  pupils: HTMLElement[];
  /** The closed eyes, which the module blinks. */
  lids: HTMLElement[];
  travel: readonly [number, number];
  look: Record<Channel, SpringState>;
  /** The look waits until then: a move is playing. */
  holdUntil: number;
  coolUntil: number;
  taps: number[];
  ignoreUntil: number;
  turn: number;
  anims: Animation[];
}

interface Life {
  env: LifeEnv;
  figs: Fig[];
  kick(): void;
}

/** Every started host, so the awake cap holds for the whole page. */
const lives = new Set<Life>();
/** Every figure a life moves: one life each, or two would wake it and play each tap twice. */
const claimed = new WeakSet<Element>();

const AT_REST: Aim = { head: 0, lean: 0, px: 0, py: 0 };
/** IntersectionObserver's ratio can land a hair under the threshold it crossed. */
const SLACK = 0.001;

function asleep(env: LifeEnv): boolean {
  return (
    env.hidden() ||
    env.reducedMotion() ||
    env.introOnStage() ||
    env.presenting() ||
    env.dialogOpen() ||
    env.quiet()
  );
}

/** A breathing phase from 0 to 4 s, fixed per character (FNV-1a of the id). */
function phase(id: string): number {
  let h = 2166136261;
  for (let i = 0; i < id.length; i++) h = Math.imul(h ^ id.charCodeAt(i), 16777619);
  return ((h >>> 0) % 4000) / 1000;
}

/** Whether it changed. */
function wake(fig: Fig, on: boolean): boolean {
  if (fig.awake === on) return false;
  fig.awake = on;
  fig.el.toggleAttribute("data-cast-awake", on);
  const at = phase(fig.id);
  for (const el of fig.body) el.style.animationDelay = on ? `-${at}s` : "";
  // The blink's 5.4 s cycle at the same point as the breath's 4 s one, so
  // figures woken together don't blink together.
  for (const el of fig.lids) el.style.animationDelay = on ? `-${round(at * 1.35)}s` : "";
  return true;
}

/**
 * Wake the most-seen figures on the page, up to the cap, and let the rest
 * sleep. A host whose figures changed runs its look once more, so a figure
 * falling asleep comes back to rest.
 */
function rank(): void {
  const seen: Fig[] = [];
  let env: LifeEnv | null = null;
  for (const life of Array.from(lives)) {
    env = env ?? life.env;
    if (asleep(life.env)) continue;
    for (const fig of life.figs) if (fig.ratio + SLACK >= PACE.awakeRatio) seen.push(fig);
  }
  if (!env) return;
  seen.sort(
    (a, b) =>
      b.ratio - a.ratio ||
      (a.el.compareDocumentPosition(b.el) & Node.DOCUMENT_POSITION_FOLLOWING ? -1 : 1)
  );
  const keep = new Set(seen.slice(0, env.narrow() ? LIMITS.awakePhone : LIMITS.awakeWide));
  for (const life of Array.from(lives)) {
    let changed = false;
    for (const fig of life.figs) changed = wake(fig, keep.has(fig)) || changed;
    if (changed) life.kick();
  }
}

const round = (n: number) => Math.round(n * 100) / 100;
const clamp = (n: number) => Math.max(-1, Math.min(1, n));

function setStyle(els: HTMLElement[], prop: "rotate" | "translate", value: string): void {
  for (const el of els) el.style[prop] = value;
}

const STILL: SpringState = { x: 0, v: 0 };
const still = (): Record<Channel, SpringState> => ({
  head: STILL,
  lean: STILL,
  px: STILL,
  py: STILL,
});

/** Every move and the look back at rest at once, with no spring. */
function toRest(fig: Fig): void {
  for (const anim of fig.anims) anim.cancel();
  fig.anims = [];
  fig.look = still();
  setStyle([...fig.head, ...fig.body], "rotate", "");
  setStyle(fig.pupils, "translate", "");
}

let linearOk: boolean | null = null;

function easing(ease: Ease, presenting: boolean): string {
  if (presenting || ease === "calm") return EASE.calm;
  if (ease === "sine") return "ease-in-out";
  if (linearOk === null) {
    linearOk =
      typeof CSS !== "undefined" &&
      typeof CSS.supports === "function" &&
      CSS.supports("animation-timing-function", "linear(0, 1)");
  }
  return linearOk ? EASE[ease] : EASE_FALLBACK[ease];
}

/** `share`: the part of the track's turn (or, for the pupils, travel) it plays. */
function keyframes(
  track: Track,
  travel: readonly [number, number],
  ease: string,
  share: number
): Keyframe[] {
  const keys = track.keys;
  const turns = keys.some((k) => k.rotate !== undefined);
  const moves = keys.some((k) => k.x !== undefined || k.y !== undefined);
  const sizes = keys.some((k) => k.sx !== undefined || k.sy !== undefined);
  const eyes = track.socket === "pupils";
  const unit = eyes ? "%" : "px";
  return keys.map((k) => {
    const frame: Keyframe = { offset: k.t, easing: ease };
    if (turns) frame.rotate = `${round((k.rotate ?? 0) * share)}deg`;
    if (moves) {
      const x = round((k.x ?? 0) * (eyes ? travel[0] * share : 1));
      const y = round((k.y ?? 0) * (eyes ? travel[1] * share : 1));
      frame.translate = `${x}${unit} ${y}${unit}`;
    }
    if (sizes) frame.scale = `${k.sx ?? 1} ${k.sy ?? 1}`;
    return frame;
  });
}

/** Show `choice` in a slot, or its rest choice for null; a rig without that choice keeps what it shows. */
function show(root: HTMLElement, slot: string, choice: string | null): void {
  const els = Array.from(root.querySelectorAll<HTMLElement>(`[data-swap="${slot}"]`));
  if (choice !== null && !els.some((el) => el.dataset.choice === choice)) return;
  for (const el of els) {
    el.toggleAttribute(
      "data-on",
      choice === null ? el.hasAttribute("data-rest") : el.dataset.choice === choice
    );
  }
}

function makeFig(el: HTMLElement): Fig {
  const all = (selector: string) => Array.from(el.querySelectorAll<HTMLElement>(selector));
  const [tx, ty] = (el.dataset.travel ?? "").split(" ").map(Number);
  return {
    el,
    id: el.dataset.cast ?? "",
    ratio: 0,
    awake: false,
    head: all('[data-socket="head"]'),
    body: all('[data-socket="body"]'),
    pupils: all("[data-pupil]"),
    lids: all('[data-slot="eyes"] > [data-choice="closed"]'),
    travel: [tx || 0, ty || 0],
    look: still(),
    holdUntil: -Infinity,
    coolUntil: -Infinity,
    taps: [],
    ignoreUntil: -Infinity,
    turn: 0,
    anims: [],
  };
}

export function startLife(host: HTMLElement, env: LifeEnv = lifeEnv()): () => void {
  if (host.closest(OVERLAY)) return () => {};
  const figs = Array.from(host.querySelectorAll<HTMLElement>("[data-cast]"))
    .filter((el) => !el.closest(OVERLAY) && !claimed.has(el))
    .map(makeFig);
  if (figs.length === 0) return () => {};
  for (const fig of figs) claimed.add(fig.el);

  const timers = new Set<ReturnType<typeof setTimeout>>();
  const later = (ms: number, fn: () => void) => {
    if (ms <= 0) return fn();
    const t = setTimeout(() => {
      timers.delete(t);
      fn();
    }, ms);
    timers.add(t);
  };

  let target: { x: number; y: number } | null = null;
  let hold: ReturnType<typeof setTimeout> | undefined;
  let frame = 0;
  let last = 0;
  let ranked = -Infinity;

  const aimOf = (fig: Fig): Aim => {
    if (!fig.awake || !target) return AT_REST;
    const rect = fig.el.getBoundingClientRect();
    if (!rect.height) return AT_REST;
    const reach = rect.height * PACE.lookReach;
    const nx = clamp((target.x - (rect.left + rect.width / 2)) / reach);
    const ny = clamp((target.y - (rect.top + rect.height * 0.3)) / reach);
    return { head: nx * LIMITS.lookDeg, lean: nx * PACE.lookLeanDeg, px: nx, py: ny };
  };

  const tick = (now: number) => {
    // Reduced motion came on mid-visit: the rest pose straight away.
    if (env.reducedMotion()) {
      figs.forEach(toRest);
      frame = 0;
      last = 0;
      return;
    }
    if (now - ranked > 250) {
      ranked = now;
      rank();
    }
    const dt = last ? Math.min((now - last) / 1000, 0.064) : 1 / 60;
    last = now;
    const presenting = env.presenting();
    const config = springFor(presenting);
    // Every read before any write, so no frame forces a layout.
    const aims = figs.map(aimOf);
    const at = env.now();
    let moving = false;
    figs.forEach((fig, i) => {
      // A move is playing; play() asks for a frame when it ends.
      if (at < fig.holdUntil) return;
      for (const ch of CHANNELS) {
        const to = aims[i][ch];
        // Never past its aim, so a look stays within LIMITS.lookDeg.
        const next = stepSpring(fig.look[ch], to, dt, config, true);
        if (isAtRest(next, to)) fig.look[ch] = { x: to, v: 0 };
        else {
          fig.look[ch] = next;
          moving = true;
        }
      }
      const { head, lean, px, py } = fig.look;
      setStyle(fig.head, "rotate", head.x ? `${round(head.x)}deg` : "");
      setStyle(fig.body, "rotate", lean.x ? `${round(lean.x)}deg` : "");
      setStyle(
        fig.pupils,
        "translate",
        px.x || py.x ? `${round(px.x * fig.travel[0])}% ${round(py.x * fig.travel[1])}%` : ""
      );
    });
    if (moving) frame = requestAnimationFrame(tick);
    else {
      frame = 0;
      last = 0;
    }
  };

  const kick = () => {
    if (!frame && !env.hidden()) frame = requestAnimationFrame(tick);
  };

  const play = (fig: Fig, clip: Clip, first = false): boolean => {
    const now = env.now();
    if (now < fig.coolUntil || env.hidden() || env.reducedMotion()) return false;
    fig.coolUntil = now + PACE.cooldownMs;
    fig.holdUntil = now + clip.ms;
    later(clip.ms, kick);
    fig.anims = [];
    // Each clip stays within a joint's limit at its peak (clips.test.ts), so
    // scaled by the share of the range the held look leaves, the sum does too.
    const { head, lean, px, py } = fig.look;
    const room: Partial<Record<Track["socket"], number>> = {
      head: 1 - Math.abs(head.x) / LIMITS.headDeg,
      body: 1 - Math.abs(lean.x) / LIMITS.leanDeg,
      pupils: 1 - Math.max(Math.abs(px.x), Math.abs(py.x)),
    };
    const layers: Layer[] = [clip];
    if (first && clip.first) layers.push(clip.first);
    if (clip.armless && !fig.el.querySelector('[data-slot^="arm-"]')) layers.push(clip.armless);
    const presenting = env.presenting();
    for (const layer of layers) {
      for (const track of layer.tracks) {
        const els =
          track.socket === "pupils"
            ? fig.pupils
            : Array.from(fig.el.querySelectorAll<HTMLElement>(`[data-socket="${track.socket}"]`));
        const frames = keyframes(
          track,
          fig.travel,
          easing(track.ease, presenting),
          room[track.socket] ?? 1
        );
        for (const el of els) {
          if (typeof el.animate !== "function") continue;
          fig.anims.push(el.animate(frames, { duration: clip.ms, composite: "add" }));
        }
      }
      for (const swap of layer.swaps ?? []) {
        const dot = swap.key.indexOf(".");
        const slot = swap.key.slice(0, dot);
        later(swap.from * clip.ms, () => show(fig.el, slot, swap.key.slice(dot + 1)));
        later(swap.to * clip.ms, () => show(fig.el, slot, null));
      }
    }
    return true;
  };

  const onTap = (event: Event) => {
    const el = (event.target as Element | null)?.closest?.("[data-cast]");
    const fig = figs.find((f) => f.el === el);
    if (!fig || !fig.el.hasAttribute("data-tap")) return;
    const now = env.now();
    if (now < fig.ignoreUntil) return;
    fig.taps = fig.taps.filter((t) => now - t < PACE.tapWindowMs);
    fig.taps.push(now);
    if (fig.taps.length >= PACE.tapBurst) {
      fig.taps = [];
      fig.ignoreUntil = now + PACE.tapIgnoreMs;
      return;
    }
    const moves = (fig.el.dataset.sig ?? "")
      .split(" ")
      .filter((id) => id.startsWith("sig."))
      .map(clipFor)
      .filter((c): c is Clip => c !== null);
    if (moves.length && play(fig, moves[fig.turn % moves.length])) fig.turn += 1;
  };

  const onReact = (event: Event) => {
    const detail = (event as CustomEvent<ReactDetail | null>).detail;
    const clip = detail ? clipFor(`guess.${detail.kind}`) : null;
    if (!detail || !clip) return;
    figs.forEach((fig, i) =>
      later(LIMITS.guessDelayMs + i * LIMITS.staggerMs, () => {
        play(fig, clip, fig.id === detail.first);
      })
    );
  };

  const onMove = (event: PointerEvent) => {
    if (event.pointerType !== "mouse" || !env.finePointer()) return;
    target = { x: event.clientX, y: event.clientY };
    kick();
  };

  const onDown = (event: PointerEvent) => {
    if (event.pointerType === "mouse") return;
    target = { x: event.clientX, y: event.clientY };
    clearTimeout(hold);
    hold = setTimeout(() => {
      target = null;
      kick();
    }, PACE.lookHoldMs);
    kick();
  };

  // Each host its own listener: the same function added twice is one listener.
  const onResize = () => rank();

  const onVisibility = () => {
    if (env.hidden() && frame) {
      cancelAnimationFrame(frame);
      frame = 0;
      last = 0;
    }
    rank();
  };

  const io =
    typeof IntersectionObserver === "undefined"
      ? null
      : new IntersectionObserver(
          (entries) => {
            for (const entry of entries) {
              const fig = figs.find((f) => f.el === entry.target);
              if (fig) fig.ratio = entry.isIntersecting ? entry.intersectionRatio : 0;
            }
            rank();
          },
          { threshold: [0, 0.2, 0.4, PACE.awakeRatio, 0.8, 1] }
        );
  for (const fig of figs) io?.observe(fig.el);

  const mo = typeof MutationObserver === "undefined" ? null : new MutationObserver(rank);
  mo?.observe(document.documentElement, {
    attributes: true,
    attributeFilter: ["data-intro", "data-presenting"],
  });
  // Quiet hours, Focus and dialogs change without an event of their own.
  const every = setInterval(rank, 10_000);

  host.addEventListener("click", onTap);
  host.addEventListener(REACT_EVENT, onReact);
  window.addEventListener("pointermove", onMove, { passive: true });
  window.addEventListener("pointerdown", onDown, { passive: true });
  window.addEventListener("resize", onResize, { passive: true });
  document.addEventListener("visibilitychange", onVisibility);

  const life: Life = { env, figs, kick };
  lives.add(life);
  rank();

  return () => {
    if (!lives.delete(life)) return;
    io?.disconnect();
    mo?.disconnect();
    clearInterval(every);
    clearTimeout(hold);
    timers.forEach(clearTimeout);
    timers.clear();
    if (frame) cancelAnimationFrame(frame);
    frame = 0;
    host.removeEventListener("click", onTap);
    host.removeEventListener(REACT_EVENT, onReact);
    window.removeEventListener("pointermove", onMove);
    window.removeEventListener("pointerdown", onDown);
    window.removeEventListener("resize", onResize);
    document.removeEventListener("visibilitychange", onVisibility);
    for (const fig of figs) {
      claimed.delete(fig.el);
      toRest(fig);
      wake(fig, false);
      for (const el of Array.from(fig.el.querySelectorAll("[data-swap]"))) {
        el.toggleAttribute("data-on", el.hasAttribute("data-rest"));
      }
    }
    rank();
  };
}
