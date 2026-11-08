"use client";

/**
 * Floating Amr + chat panel — replaces the agent sheet (Phase 3).
 *
 * Amr is always present (bottom-right). Clicking him — or the header
 * button, or Cmd/Ctrl+J — toggles a chat panel that binds to the SAME
 * useAgentStore + sendUserMessage + ConfirmAction as before, so the agent's
 * tool-calling brain, confirm cards, and persistence are unchanged; only the
 * shell is new. Amr "talks" (the review pose) while the agent streams.
 *
 * Amr answers touch: a tap pokes or pats him (by where it lands), quick taps
 * tickle him, a long-press offers a high five, a mouse resting on him or
 * stroking his head gets a shy smile or a pat, and dragging picks him up by the
 * collar — he dangles and swings, and lands where he's dropped or thrown
 * (engine/interactions/clicks.ts, touch.ts). On phones the panel header has a
 * switch that lets him feel the phone's motion (engine/interactions/sensors.ts).
 * On touch screens he steps aside (up, or to the other side) when his figure
 * would sit on one of the page's controls (mascot-nudge.ts).
 *
 * The agent itself is owner-only. Visitors keep the mascot (clicks, Konami,
 * Cmd/Ctrl+J) but the panel shows <VisitorGuide/> — a tool finder — instead
 * of the chat, so their panel never touches /api/agent/* or the agent tables
 * in Supabase. The chat (and the action registry it needs) is a separate
 * dynamic chunk, owner-agent-panel, so visitors never download it either.
 */

import {
  useEffect,
  useLayoutEffect,
  useRef,
  useState,
  type CSSProperties,
  type MouseEvent as ReactMouseEvent,
  type PointerEvent as ReactPointerEvent,
  type RefObject,
} from "react";
import dynamic from "next/dynamic";
import { X, Plus, History, Sparkles, Smartphone } from "lucide-react";
import { cn } from "@/lib/utils";
import { useAgentStore } from "@/lib/agent/store";
import { useOwnerState } from "@/lib/auth/use-is-owner";
import { useMascotStore } from "@/lib/agent/mascot/store";
import { useMascotChatReactions } from "@/lib/agent/mascot/use-chat-reactions";
import { useMascotToolReactions } from "@/lib/agent/mascot/use-tool-reactions";
import { createClickInteraction } from "./engine/interactions/clicks";
import { createTouchInteraction, zoneAt, type TouchPoint } from "./engine/interactions/touch";
import {
  canFeelPhone,
  feelsPhone,
  motionNeedsPermission,
  requestMotionPermission,
} from "./engine/interactions/sensors";
import { installKonami } from "./engine/customization/commands";
import { playMascotSound } from "./engine/audio/mascot-audio";
import { FIGURE_BOTTOM, FIGURE_TOP, SHEET, pointToward, shippedScene } from "./engine/sprite-poses";
import { VisitorGuide } from "./visitor-guide";
import {
  HOME,
  chooseNudge,
  otherSideLeft,
  sameNudge,
  type Nudge,
  type Rect,
  type SideInsets,
} from "./mascot-nudge";
import styles from "./mascot-assistant.module.css";

/** Award XP via the gamification window bridge (no-op if unavailable). */
function addXp(n: number): void {
  (window as unknown as { VDna?: { addXp?: (x: number) => void } }).VDna?.addXp?.(n);
}

/** Which corner the mascot is parked in (drag-to-reposition). */
export type Corner = "topLeft" | "topRight" | "bottomLeft" | "bottomRight";

/** Inset of the float button from its corner. */
/** Which toolkit scenes exist yet (their sheets shipped). Stable, for the hook. */
const sceneShipped = (scene: string) => shippedScene(scene) !== undefined;

const BUTTON_INSET = 4;
/** Size of Amr's box inside that button: one sheet cell at an exact 12:13. */
const MASCOT_BOX = { w: 132, h: 143 };
/** Phones get a smaller figure, with space kept for him (phoneBandHeight). */
const MASCOT_BOX_PHONE = { w: 96, h: 104 };
/** The round launcher shown until the figure is ready (or if the sheet can't load). */
const LAUNCHER_SIZE = 48;
/**
 * How much of the empty box (in sheet px) may sit past the screen edge: all the
 * space below his feet when parked at the bottom, most of the headroom when
 * parked at the top. A margin is left there because he jumps into it.
 */
const FEET_TRIM = SHEET.cellH - FIGURE_BOTTOM;
const HEAD_TRIM = 16;
/**
 * The part of the box that takes clicks: the figure, not the transparent space
 * around it. Fractions of the box width are left clear on each side.
 */
const HIT_SIDE = 0.28;
/** Breathing room between the mascot's silhouette and the panel. */
const PANEL_GAP = 6;
/** Taps closer together than this are play (a tickle), not a request for the panel. */
const TAP_TOGGLE_GAP_MS = 600;
/** Let go faster than this (px/s), he's thrown rather than dropped. */
const THROW_SPEED = 1100;
/** He points at the panel when it opens, at most this often. */
const POINT_AT_PANEL_MS = 60_000;

/** A layout effect in the browser, a plain one on the server (no SSR warning). */
const useIsomorphicLayoutEffect = typeof window === "undefined" ? useEffect : useLayoutEffect;

function prefersReducedMotion(): boolean {
  return window.matchMedia?.("(prefers-reduced-motion: reduce)").matches === true;
}

/** A pointer event as a point on his figure (the hit box), for the touch tracker. */
function touchPoint(
  e: { clientX: number; clientY: number; pointerType?: string },
  hit: Element | null
): TouchPoint | null {
  if (!hit) return null;
  const r = hit.getBoundingClientRect();
  return {
    x: e.clientX,
    y: e.clientY,
    box: { left: r.left, top: r.top, width: r.width, height: r.height },
    pointerType: e.pointerType ?? "mouse",
  };
}

/** Distance of the button's edge from its corner (negative: past the edge). */
function edgeInset(c: Corner, figure: boolean, boxH: number): number {
  if (!figure) return BUTTON_INSET;
  const scale = boxH / SHEET.cellH;
  return BUTTON_INSET - (c.startsWith("top") ? HEAD_TRIM : FEET_TRIM) * scale;
}

/**
 * On a phone the page has no spare margin for him to stand in, so space is kept
 * for him: at the bottom of the screen, or just under the header when he's been
 * dragged up there. Nothing is drawn there; he stands over the page with nothing
 * behind him, the page scrolls behind him, and main's padding lets everything
 * clear him. This is how tall that space has to be to hold him, in px, past any
 * safe area.
 */
function phoneBandHeight(c: Corner, figure: boolean, boxH: number): number {
  if (!figure) return LAUNCHER_SIZE + 2 * BUTTON_INSET;
  const scale = boxH / SHEET.cellH;
  const inset = edgeInset(c, true, boxH);
  const reach = c.startsWith("top") ? FIGURE_BOTTOM * scale : boxH - FIGURE_TOP * scale;
  return Math.ceil(inset + reach) + BUTTON_INSET;
}

/**
 * What his corner's offset is measured from on a phone: the header's bottom (the
 * header publishes its height, top safe area included, as --header-h), or the
 * home indicator.
 */
function phoneEdge(c: Corner): string {
  return c.startsWith("top") ? "var(--header-h, 56px)" : "env(safe-area-inset-bottom, 0px)";
}

/** The same edge, the other side of the screen (where he steps aside to). */
function otherSide(c: Corner): Corner {
  return `${c.startsWith("top") ? "top" : "bottom"}${c.endsWith("Left") ? "Right" : "Left"}` as Corner;
}

/** Offset from his edge: a phone's strip, or the screen clear of the home indicator. */
function edgeOffset(c: Corner, px: number, phone: boolean): string | number {
  if (phone) return `calc(${px}px + ${phoneEdge(c)})`;
  return c.startsWith("top") ? px : `calc(${px}px + env(safe-area-inset-bottom, 0px))`;
}

/** Offset from his side, clear of a landscape iPhone's notch and rounded corners. */
function sideOffset(c: Corner, px: number): CSSProperties {
  return c.endsWith("Left")
    ? { left: `calc(${px}px + env(safe-area-inset-left, 0px))` }
    : { right: `calc(${px}px + env(safe-area-inset-right, 0px))` };
}

/**
 * Fixed-position style for the float button at a corner (default ≈ bottom-1
 * right-2). `lift` moves him off his edge when he steps aside for a control.
 */
function buttonPos(
  c: Corner,
  figure: boolean,
  boxH: number,
  phone: boolean,
  lift = 0
): CSSProperties {
  const offset = edgeOffset(c, edgeInset(c, figure, boxH) + lift, phone);
  return {
    position: "fixed",
    ...(c.startsWith("top") ? { top: offset } : { bottom: offset }),
    ...sideOffset(c, 8),
  };
}

/** Where clicks land inside the figure's box (see HIT_SIDE). */
function hitBox(box: { w: number; h: number }): CSSProperties {
  const scale = box.h / SHEET.cellH;
  return {
    top: FIGURE_TOP * scale,
    bottom: box.h - FIGURE_BOTTOM * scale,
    left: box.w * HIT_SIDE,
    right: box.w * HIT_SIDE,
  };
}

/** The panel's height, as its class sets it (h-[min(68vh,560px)]). */
const PANEL_HEIGHT_CSS = "min(68vh, 560px)";
/** On a short screen the panel gets shorter, down to this: its title row, a few lines, the input. */
const PANEL_MIN_H = 160;
/** Room kept between the panel and the header, or the screen's far edge. */
const PANEL_MARGIN = 8;

/**
 * Chat-panel style for a corner — hugs Amr's silhouette, not his box. `boxH` is
 * the rendered box height (the figure's rows scale with it); with the launcher
 * showing, the panel clears the launcher instead. `lift` is how far he has
 * stepped off his edge for a control, and the panel goes with him.
 *
 * It always stays between the header and the screen's far edge, whatever the
 * lift: first it gets shorter (its body scrolls); only when even PANEL_MIN_H
 * won't fit past him (a landscape phone, him stepped up) does it stop short of
 * following him and keep that much. `100%` is the visible screen (a fixed box's
 * containing block), not 100vh, which on phones counts the hidden URL bar.
 * Exported for tests.
 */
export function panelPos(
  c: Corner,
  figure: boolean,
  boxH: number,
  phone: boolean,
  lift = 0
): CSSProperties {
  const scale = boxH / SHEET.cellH;
  const top = figure ? FIGURE_TOP * scale : 0;
  const bottom = figure ? FIGURE_BOTTOM * scale : LAUNCHER_SIZE;
  const height = figure ? boxH : LAUNCHER_SIZE;
  const inset = edgeInset(c, figure, boxH) + lift;
  const atTop = c.startsWith("top");
  const px = atTop
    ? // Parked up top: clear his feet.
      inset + bottom + PANEL_GAP
    : // Parked at the bottom: clear its head.
      inset + (height - top) + PANEL_GAP;
  const raw = edgeOffset(c, px, phone);
  const offset = typeof raw === "number" ? `${raw}px` : raw;
  // From the edge it's anchored to across to where it must stop: the header for a
  // bottom corner, the bottom of the screen (past the home indicator) for a top one.
  const room = atTop
    ? `100% - ${PANEL_MARGIN}px - env(safe-area-inset-bottom, 0px)`
    : `100% - var(--header-h, 56px) - ${PANEL_MARGIN}px`;
  const anchor = `min(${offset}, calc(${room} - min(${PANEL_HEIGHT_CSS}, ${PANEL_MIN_H}px)))`;
  return {
    ...(atTop ? { top: anchor } : { bottom: anchor }),
    ...sideOffset(c, 16),
    maxHeight: `max(${PANEL_MIN_H}px, calc(${room} - ${offset}))`,
  };
}

/** Whether a media query matches, kept up to date (false on the server). */
function useMediaQuery(query: string): boolean {
  const [matches, setMatches] = useState(false);
  useEffect(() => {
    const mq = window.matchMedia?.(query);
    if (!mq) return;
    const update = () => setMatches(mq.matches);
    update();
    mq.addEventListener?.("change", update);
    return () => mq.removeEventListener?.("change", update);
  }, [query]);
  return matches;
}

/** True below the `sm` breakpoint (640px). */
function useIsPhone(): boolean {
  return useMediaQuery("(max-width: 639px)");
}

/**
 * Keep space for Amr on phones: publishes its height as CSS variables, for main's
 * top padding, scroll padding, and the few things pinned to the bottom of the
 * screen, so they stop clear of him. Nothing is drawn there: the page shows behind
 * him. Zero (removed) on larger screens, where he stands in the corner.
 */
function usePhoneBand(band: { side: "top" | "bottom"; height: number } | null) {
  const side = band?.side;
  const height = band?.height;
  useEffect(() => {
    if (!side || height === undefined) return;
    const root = document.documentElement;
    const name = side === "top" ? "--amr-band-top" : "--amr-band-bottom";
    root.style.setProperty(
      name,
      side === "top" ? `${height}px` : `calc(${height}px + env(safe-area-inset-bottom, 0px))`
    );
    return () => {
      root.style.removeProperty(name);
    };
  }, [side, height]);
}

/** Start the figure this long after load if nobody has interacted yet. */
const MASCOT_DELAY_MS = 2000;

/** True when the visitor asked the browser to save data (Data Saver, Lite mode). */
function savesData(): boolean {
  const nav = navigator as Navigator & { connection?: { saveData?: boolean } };
  return Boolean(nav.connection?.saveData);
}

/**
 * Defer the figure (its chunk and the sprite sheet) until the visitor first
 * interacts (pointer, key, scroll) or a moment after the page has loaded,
 * whichever comes first, then wait for an idle moment, so it never competes with
 * the page's own content. The launcher shows until then. When the visitor asked
 * to save data, only an interaction starts him: the sheet is fetched for someone
 * using the page, and he still shows for everyone.
 */
function useDeferredFigure(): boolean {
  const [ready, setReady] = useState(false);
  useEffect(() => {
    const interactionOnly = savesData();
    const w = window as Window & {
      requestIdleCallback?: (cb: () => void, opts?: { timeout: number }) => number;
      cancelIdleCallback?: (id: number) => void;
    };
    let idleId: number | undefined;
    let timer: number | undefined;
    let started = false;
    const events = ["pointerdown", "keydown", "scroll", "touchstart"] as const;
    const start = () => {
      if (started) return;
      started = true;
      events.forEach((e) => window.removeEventListener(e, start));
      window.clearTimeout(timer);
      if (w.requestIdleCallback)
        idleId = w.requestIdleCallback(() => setReady(true), { timeout: 2000 });
      else timer = window.setTimeout(() => setReady(true), 300);
    };
    events.forEach((e) => window.addEventListener(e, start, { passive: true, once: true }));
    const arm = () => {
      timer = window.setTimeout(start, MASCOT_DELAY_MS);
    };
    // Saving data: no timer, only the first interaction starts him.
    if (!interactionOnly) {
      if (document.readyState === "complete") arm();
      else window.addEventListener("load", arm, { once: true });
    }
    return () => {
      events.forEach((e) => window.removeEventListener(e, start));
      window.removeEventListener("load", arm);
      window.clearTimeout(timer);
      if (idleId !== undefined) w.cancelIdleCallback?.(idleId);
    };
  }, []);
  return ready;
}

/** On phones, step aside while the visitor is typing (the keyboard is up). */
function useTypingOnPhone(isPhone: boolean): boolean {
  const [typing, setTyping] = useState(false);
  useEffect(() => {
    if (!isPhone) {
      setTyping(false);
      return;
    }
    const isField = (t: EventTarget | null) => {
      const el = t as HTMLElement | null;
      return (
        !!el &&
        (el.isContentEditable ||
          el.tagName === "INPUT" ||
          el.tagName === "TEXTAREA" ||
          el.tagName === "SELECT")
      );
    };
    const onIn = (e: FocusEvent) => {
      // Typing inside the assistant panel itself keeps the figure in place.
      const inPanel = (e.target as HTMLElement | null)?.closest?.("[data-agent-sheet-root]");
      if (isField(e.target) && !inPanel) setTyping(true);
    };
    const onOut = (e: FocusEvent) => {
      if (isField(e.target)) setTyping(false);
    };
    document.addEventListener("focusin", onIn);
    document.addEventListener("focusout", onOut);
    return () => {
      document.removeEventListener("focusin", onIn);
      document.removeEventListener("focusout", onOut);
    };
  }, [isPhone]);
  return typing;
}

/** How long the page must be still (no scroll, resize, tap or change) before he looks under him. */
const NUDGE_SETTLE_MS = 250;
/** After he's placed (the figure arriving, a drop, the panel closing): once he has landed. */
const NUDGE_PLACED_MS = 700;

/**
 * The screen's side safe areas (a landscape phone's notch or camera cutout, often
 * on one side only), read off a hidden probe padded by them. 0 where there are none.
 */
function readSideInsets(probe: HTMLElement | null): SideInsets {
  if (!probe) return { left: 0, right: 0 };
  const cs = window.getComputedStyle(probe);
  const px = (v: string) => Math.max(0, parseFloat(v) || 0);
  return { left: px(cs.paddingLeft), right: px(cs.paddingRight) };
}

/**
 * His hit box (or the launcher) at HOME, in viewport px, from the layout: the
 * button's used position, not its painted one, so his float, a stroll or a
 * landing in progress doesn't skew it. Null when there's no layout to read.
 */
function homeHitRect(
  button: HTMLElement,
  hit: HTMLElement | null,
  n: Nudge,
  edge: "top" | "bottom",
  vw: number,
  vh: number,
  insets: SideInsets
): Rect | null {
  const cs = window.getComputedStyle(button);
  const w = button.offsetWidth;
  const h = button.offsetHeight;
  let top = parseFloat(cs.top);
  let left = parseFloat(cs.left);
  if (!Number.isFinite(top)) top = vh - parseFloat(cs.bottom) - h;
  if (!Number.isFinite(left)) left = vw - parseFloat(cs.right) - w;
  if (!w || !h || !Number.isFinite(top) || !Number.isFinite(left)) return null;
  // Undo where he has stepped to.
  if (n.flip) left = otherSideLeft(left, w, vw, insets);
  top += edge === "bottom" ? n.lift : -n.lift;
  if (!hit) return { left, top, width: w, height: h };
  return {
    left: left + hit.offsetLeft,
    top: top + hit.offsetTop,
    width: hit.offsetWidth,
    height: hit.offsetHeight,
  };
}

/**
 * On touch screens he steps aside when his figure sits on one of the page's
 * controls (mascot-nudge.ts): up from his edge, or to the other side. He looks
 * once he's placed and whenever the page settles after a scroll, resize, tap or
 * change, never mid-scroll, so he doesn't jitter, and he slides to the new spot.
 * Frozen while his panel is open or he's carried. A new corner (or box size) is a
 * new home; `reset` sends him home at once (a drop). `figure` says whether the
 * figure or the launcher is showing: he looks again when one gives way to the other.
 */
function useStepAside({
  active,
  frozen,
  edge,
  placeKey,
  figure,
  allowFlip,
  buttonRef,
  hitRef,
  insetProbeRef,
}: {
  active: boolean;
  frozen: boolean;
  edge: "top" | "bottom";
  placeKey: string;
  figure: boolean;
  allowFlip: boolean;
  buttonRef: RefObject<HTMLButtonElement | null>;
  hitRef: RefObject<HTMLSpanElement | null>;
  insetProbeRef: RefObject<HTMLSpanElement | null>;
}): { nudge: Nudge; reset: () => void } {
  const [state, setState] = useState<{ key: string; nudge: Nudge }>({ key: "", nudge: HOME });
  const nudge = state.key === placeKey ? state.nudge : HOME;
  // The check runs from timers and listeners: it reads the latest values here.
  const latest = useRef({ nudge, edge, placeKey, allowFlip });
  latest.current = { nudge, edge, placeKey, allowFlip };
  const fromRef = useRef<DOMRect | null>(null);

  useEffect(() => {
    if (!active || frozen) return;
    let timer: number | undefined;
    let pressed = false;
    const own = (node: Node) =>
      !!buttonRef.current?.contains(node) ||
      (node instanceof Element && !!node.closest("[data-agent-sheet-root]"));
    const check = () => {
      timer = undefined;
      if (pressed) return; // looked at again when the finger lifts
      const button = buttonRef.current;
      if (!button || typeof document.elementsFromPoint !== "function") return;
      const { nudge: current, edge: side, placeKey: key, allowFlip: flip } = latest.current;
      const vw = document.documentElement.clientWidth || window.innerWidth;
      const vh = window.innerHeight;
      const insets = readSideInsets(insetProbeRef.current);
      const home = homeHitRect(button, hitRef.current, current, side, vw, vh, insets);
      if (!home) return;
      const header = document.querySelector("[data-chrome='header']")?.getBoundingClientRect();
      const next = chooseNudge({
        home,
        current,
        edge: side,
        allowFlip: flip,
        viewport: { width: vw, height: vh, minTop: Math.max(0, header?.bottom ?? 0) },
        insets,
        elementsFromPoint: (x, y) => document.elementsFromPoint(x, y),
        ignore: own,
        // The sticky header stacks above him (a top corner tucks him under it).
        above: (el) => !!el.closest("[data-chrome='header']"),
      });
      if (sameNudge(next, current)) return;
      fromRef.current = button.getBoundingClientRect();
      setState({ key, nudge: next });
    };
    // Scrolling and resizing push the look back until they stop; page changes
    // only make sure one is coming (a ticking timer can't put it off forever).
    const settle = () => {
      window.clearTimeout(timer);
      timer = window.setTimeout(check, NUDGE_SETTLE_MS);
    };
    const soon = () => {
      if (timer === undefined) timer = window.setTimeout(check, NUDGE_SETTLE_MS);
    };
    const down = () => {
      pressed = true;
    };
    const up = () => {
      pressed = false;
      settle();
    };
    const observer =
      typeof MutationObserver === "function"
        ? new MutationObserver((records) => {
            if (records.some((r) => !own(r.target))) soon();
          })
        : null;
    observer?.observe(document.body, { childList: true, subtree: true });
    window.addEventListener("scroll", settle, { passive: true, capture: true });
    window.addEventListener("resize", settle);
    document.addEventListener("pointerdown", down, true);
    document.addEventListener("pointerup", up, true);
    document.addEventListener("pointercancel", up, true);
    timer = window.setTimeout(check, NUDGE_PLACED_MS);
    return () => {
      observer?.disconnect();
      window.removeEventListener("scroll", settle, { capture: true });
      window.removeEventListener("resize", settle);
      document.removeEventListener("pointerdown", down, true);
      document.removeEventListener("pointerup", up, true);
      document.removeEventListener("pointercancel", up, true);
      window.clearTimeout(timer);
    };
  }, [active, frozen, placeKey, figure, buttonRef, hitRef, insetProbeRef]);

  // He slides to where he stepped, rather than jumping there.
  useIsomorphicLayoutEffect(() => {
    const from = fromRef.current;
    fromRef.current = null;
    const el = buttonRef.current;
    if (!from || !el || typeof el.animate !== "function" || prefersReducedMotion()) return;
    const to = el.getBoundingClientRect();
    const dx = from.left - to.left;
    const dy = from.top - to.top;
    const dist = Math.hypot(dx, dy);
    if (dist < 2) return;
    el.animate([{ translate: `${dx.toFixed(1)}px ${dy.toFixed(1)}px` }, { translate: "0px 0px" }], {
      duration: Math.min(450, 200 + dist * 0.8),
      easing: "cubic-bezier(0.2, 0.8, 0.2, 1)",
    });
  }, [nudge.flip, nudge.lift, buttonRef]);

  return { nudge, reset: () => setState({ key: "", nudge: HOME }) };
}

const MascotSprite = dynamic(() => import("./mascot-sprite"), { ssr: false });
const OwnerAgentPanel = dynamic(() => import("./owner-agent-panel"), {
  ssr: false,
  loading: () => <div className="min-h-0 flex-1" aria-busy="true" />,
});

export function MascotAssistant() {
  const open = useAgentStore((s) => s.open);
  const toggleSheet = useAgentStore((s) => s.toggleSheet);
  const closeSheet = useAgentStore((s) => s.closeSheet);
  const [showHistory, setShowHistory] = useState(false);
  // `settled` keeps the owner from seeing the visitor notice flash while
  // auth is still loading; no chat component mounts until it's settled.
  const { isOwner, settled } = useOwnerState();
  const isPhone = useIsPhone();
  // Touch screens of any width (a landscape phone, a tablet): his figure there is
  // where a finger lands, so he steps aside for the page's controls.
  const coarsePointer = useMediaQuery("(pointer: coarse)");
  const typingOnPhone = useTypingOnPhone(isPhone);
  const hideFigure = typingOnPhone;
  const box = isPhone ? MASCOT_BOX_PHONE : MASCOT_BOX;

  // The figure loads after the page is idle; until it's ready (or if the sheet
  // can't load) a small launcher keeps the assistant one click away without an
  // invisible hit box over the page.
  const loadFigure = useDeferredFigure();
  const figureReady = useMascotStore((s) => s.ready);
  const [figureFailed, setFigureFailed] = useState(false);
  const mountFigure = loadFigure && !figureFailed;
  const showFigure = mountFigure && figureReady;

  // Owner signed out mid-session: drop the conversation from memory. (The
  // chat panel unmounts at the same moment, which aborts any in-flight turn.)
  const wasOwnerRef = useRef(false);
  useEffect(() => {
    if (isOwner) {
      wasOwnerRef.current = true;
      return;
    }
    if (!wasOwnerRef.current) return;
    wasOwnerRef.current = false;
    useAgentStore.getState().reset();
    setShowHistory(false);
  }, [isOwner]);

  // Click interaction: a flourish + multi-click escalations on top of the chat
  // toggle (the toggle is debounced so rapid taps don't thrash the panel).
  const clickRef = useRef<ReturnType<typeof createClickInteraction> | null>(null);
  if (!clickRef.current) {
    clickRef.current = createClickInteraction({
      playNow: (r) => useMascotStore.getState().playNow(r),
      sound: () => playMascotSound("click"),
      addXp,
    });
  }
  const touchRef = useRef<ReturnType<typeof createTouchInteraction> | null>(null);
  if (!touchRef.current) {
    touchRef.current = createTouchInteraction({
      playNow: (r) => useMascotStore.getState().playNow(r),
      hold: (h, on) => useMascotStore.getState().setHold(h, on),
      sound: () => playMascotSound("click"),
    });
  }
  const buttonRef = useRef<HTMLButtonElement>(null);
  const hitRef = useRef<HTMLSpanElement>(null);
  const insetProbeRef = useRef<HTMLSpanElement>(null);
  const lastTapRef = useRef(0);
  const draggedRef = useRef(false);
  const onMascotClick = (e: ReactMouseEvent<HTMLButtonElement>) => {
    if (draggedRef.current) return; // a drag-release or a high five, not a click
    // Where it landed: his head gets a pat, his tummy a poke. (A keyboard press is a poke.)
    const p = e.detail > 0 ? touchPoint(e, hitRef.current) : null;
    const side = p && p.x < p.box.left + p.box.width / 2 ? "left" : "right";
    clickRef.current?.onClick(p ? zoneAt(p) : "body", side);
    // The first tap of a burst opens or closes the panel; the rest are play.
    const now = Date.now();
    const gap = now - lastTapRef.current;
    lastTapRef.current = now;
    if (gap > TAP_TOGGLE_GAP_MS) toggleSheet();
  };
  useEffect(
    () => () => {
      clickRef.current?.dispose();
      touchRef.current?.dispose();
    },
    []
  );

  // Drag-to-reposition: free-drag past a threshold, then snap to the nearest
  // corner (the chat panel follows via the corner state). Source initDragDrop.
  const [corner, setCorner] = useState<Corner>("bottomRight");
  // Always the figure's height unless it can't load, so the strip doesn't jump
  // when the launcher gives way to him a moment after the page settles. That
  // includes Data Saver: he arrives there too, on the first interaction.
  const bandSide = corner.startsWith("top") ? ("top" as const) : ("bottom" as const);
  const band =
    isPhone && !hideFigure
      ? {
          side: bandSide,
          height: phoneBandHeight(corner, !figureFailed, box.h),
        }
      : null;
  usePhoneBand(band);
  const [dragPos, setDragPos] = useState<{ left: number; top: number } | null>(null);

  // Stepping aside for a control under him. Only once he's settled: the figure,
  // or a launcher that stays (the figure failed, or Data Saver is waiting for the
  // first interaction), not the launcher of the first seconds after load.
  const [dataSaver, setDataSaver] = useState(false);
  useEffect(() => setDataSaver(savesData()), []);
  // Once the visitor has put him on a side, he only steps up or down from it.
  const [sideChosen, setSideChosen] = useState(false);
  const { nudge, reset: resetNudge } = useStepAside({
    active: (isPhone || coarsePointer) && !hideFigure && (showFigure || figureFailed || dataSaver),
    frozen: open || dragPos !== null,
    edge: bandSide,
    placeKey: `${corner}:${box.h}`,
    figure: showFigure,
    allowFlip: !sideChosen,
    buttonRef,
    hitRef,
    insetProbeRef,
  });
  const placed = nudge.flip ? otherSide(corner) : corner;
  // Removes the active drag's document listeners (called on pointerup, on a new
  // drag, or on unmount) so they never leak past an in-progress drag.
  const dragCleanupRef = useRef<(() => void) | null>(null);
  useEffect(() => () => dragCleanupRef.current?.(), []);
  // Dropped or thrown: he flies from where he was let go to his corner, then lands.
  const flightRef = useRef<{ left: number; top: number; thrown: boolean } | null>(null);
  useIsomorphicLayoutEffect(() => {
    const flight = flightRef.current;
    if (!flight || dragPos) return;
    flightRef.current = null;
    const mascot = useMascotStore.getState();
    const hold = flight.thrown ? "flying" : "falling";
    let landed = false;
    const land = () => {
      if (landed) return;
      landed = true;
      mascot.setHold(hold, false);
      mascot.playNow("land");
    };
    const el = buttonRef.current;
    if (!el || typeof el.animate !== "function") return land();
    const r = el.getBoundingClientRect();
    const dx = flight.left - r.left;
    const dy = flight.top - r.top;
    const dist = Math.hypot(dx, dy);
    if (dist < 6) return land();
    // Thrown: an arc, steady sideways. Dropped: a fall that speeds up.
    const arc = flight.thrown ? Math.min(140, 40 + dist * 0.3) : 0;
    const keyframes = Array.from({ length: 13 }, (_, i) => {
      const t = i / 12;
      const fall = t * t;
      const x = dx * (1 - (flight.thrown ? t : fall));
      const y = dy * (1 - fall) - arc * Math.sin(Math.PI * t);
      return { translate: `${x.toFixed(1)}px ${y.toFixed(1)}px` };
    });
    const duration = Math.min(700, 240 + dist * 0.45);
    const anim = el.animate(keyframes, { duration, easing: "linear" });
    anim.onfinish = land;
    anim.oncancel = land;
    // A background tab can stall the animation; he lands regardless (once).
    setTimeout(() => {
      anim.cancel();
      land();
    }, duration + 250);
  }, [corner, dragPos]);

  const onPointerDown = (e: ReactPointerEvent<HTMLButtonElement>) => {
    if (e.button !== 0) return;
    dragCleanupRef.current?.(); // tidy any prior unfinished drag
    const el = e.currentTarget;
    const start = { x: e.clientX, y: e.clientY };
    const rect = el.getBoundingClientRect();
    const offset = { x: rect.left - e.clientX, y: rect.top - e.clientY };
    const w = el.offsetWidth;
    const h = el.offsetHeight;
    const touch = touchRef.current;
    const onFigure = !!(e.target as HTMLElement).closest?.("[data-mascot-hit]");
    const p = onFigure ? touchPoint(e, hitRef.current) : null;
    if (p) touch?.down(p);
    let moved = false;
    let last = { left: rect.left, top: rect.top };
    // Recent pointer positions, for the dangle's swing and the speed he's let go at.
    let samples: { x: number; y: number; t: number }[] = [
      { x: e.clientX, y: e.clientY, t: performance.now() },
    ];
    let vx = 0;
    const onMove = (ev: PointerEvent) => {
      if (!moved && Math.abs(ev.clientX - start.x) + Math.abs(ev.clientY - start.y) > 8) {
        moved = true;
        touch?.dragStart();
      }
      if (!moved) {
        const q = touchPoint(ev, hitRef.current);
        if (q) touch?.move(q, true);
        return;
      }
      last = {
        left: Math.max(0, Math.min(window.innerWidth - w, ev.clientX + offset.x)),
        top: Math.max(0, Math.min(window.innerHeight - h, ev.clientY + offset.y)),
      };
      setDragPos(last);
      // He hangs from the collar and swings with the drag's sideways speed.
      const t = performance.now();
      const prev = samples[samples.length - 1];
      const dt = Math.max(t - prev.t, 1);
      vx = vx * 0.6 + ((ev.clientX - prev.x) / dt) * 1000 * 0.4;
      samples = [...samples.filter((s) => t - s.t < 100), { x: ev.clientX, y: ev.clientY, t }];
      useMascotStore.getState().setDrag(vx);
    };
    const onUp = () => {
      dragCleanupRef.current?.(); // removes all three listeners + nulls the ref
      useMascotStore.getState().setDrag(null);
      if (!moved && touch?.up()) {
        // A high five: the click that follows isn't a tap.
        draggedRef.current = true;
        setTimeout(() => (draggedRef.current = false), 60);
      }
      if (moved) {
        // How fast he was let go: over the last ~80 ms of the drag.
        const t = performance.now();
        const recent = samples.filter((s) => t - s.t < 80);
        let speed = 0;
        if (recent.length > 1) {
          const a = recent[0];
          const b = recent[recent.length - 1];
          speed = (Math.hypot(b.x - a.x, b.y - a.y) / Math.max(b.t - a.t, 1)) * 1000;
        }
        if (!prefersReducedMotion()) {
          const thrown = speed > THROW_SPEED;
          flightRef.current = { left: last.left, top: last.top, thrown };
          useMascotStore.getState().setHold(thrown ? "flying" : "falling", true);
        }
        // Snap from the last DRAGGED position (React batches setDragPos, so the
        // DOM rect may still read the start position here).
        const cx = last.left + w / 2;
        const cy = last.top + h / 2;
        const next = `${cy < window.innerHeight / 2 ? "top" : "bottom"}${
          cx < window.innerWidth / 2 ? "Left" : "Right"
        }` as Corner;
        setCorner(next);
        // Dropped where the visitor wants him: that corner, not where he'd
        // stepped aside to, and he keeps to that side from now on.
        resetNudge();
        setSideChosen(true);
        // Suppress the click that fires right after a drag-release.
        draggedRef.current = true;
        setTimeout(() => (draggedRef.current = false), 60);
      }
      // Always clear the free-drag offset — NOT only when `moved`. On touch,
      // dragging the fixed-position mascot reads as a scroll gesture and the
      // browser fires `pointercancel` instead of `pointerup`; with the reset
      // inside `if (moved)` the mascot stayed pinned at its last dragPos with
      // its float animation dead, and `panelPos(corner)` anchored the chat
      // panel to the stale corner. A later tap never cleared it either.
      setDragPos(null);
    };
    document.addEventListener("pointermove", onMove);
    document.addEventListener("pointerup", onUp);
    // `pointercancel` is the touch-scroll / capture-loss path — same teardown.
    document.addEventListener("pointercancel", onUp);
    dragCleanupRef.current = () => {
      document.removeEventListener("pointermove", onMove);
      document.removeEventListener("pointerup", onUp);
      document.removeEventListener("pointercancel", onUp);
      dragCleanupRef.current = null;
    };
  };

  // Konami easter egg (spin + rainbow + XP) + restore the persisted aura.
  useEffect(() => {
    useMascotStore.getState().hydrateAppearance();
    return installKonami(() => addXp(10));
  }, []);

  // When the panel opens he points at it ("here it is"), now and then.
  const lastPointRef = useRef(0);
  useEffect(() => {
    if (!open || !showFigure || Date.now() - lastPointRef.current < POINT_AT_PANEL_MS) return;
    const id = requestAnimationFrame(() => {
      const panel = document.querySelector("[data-agent-sheet-root]")?.getBoundingClientRect();
      const fig = hitRef.current?.getBoundingClientRect();
      if (!panel || !fig) return;
      lastPointRef.current = Date.now();
      useMascotStore
        .getState()
        .queueReaction(
          pointToward(
            panel.left + panel.width / 2 - (fig.left + fig.width / 2),
            panel.top + panel.height / 2 - (fig.top + fig.height / 2)
          )
        );
    });
    return () => cancelAnimationFrame(id);
  }, [open, showFigure]);

  // "Let Amr feel your phone": only offered on touch devices with motion sensors.
  const [motionAvailable, setMotionAvailable] = useState(false);
  useEffect(() => setMotionAvailable(canFeelPhone() && !prefersReducedMotion()), []);
  const feelPhoneChoice = useMascotStore((s) => s.feelPhone);
  const feelsMotion = motionAvailable && feelsPhone(feelPhoneChoice);
  const toggleMotion = async () => {
    const mascot = useMascotStore.getState();
    if (feelsMotion) return mascot.setFeelPhone(false);
    const granted = motionNeedsPermission() ? await requestMotionPermission() : true;
    mascot.setFeelPhone(granted);
    if (granted) mascot.playNow("startle");
  };

  // Drive the mascot from the conversation: talk while streaming, think on send,
  // react to tool results, shift mood to the reply's sentiment.
  useMascotChatReactions();
  // React to finished tool actions, for visitors and the owner alike.
  useMascotToolReactions(sceneShipped);

  // Cmd/Ctrl+J toggles — the de-facto AI-chat shortcut (moved from agent-sheet).
  // Skip when typing in an editable element so it can't steal focus mid-edit.
  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      if (!(e.metaKey || e.ctrlKey) || e.shiftKey || e.altKey) return;
      if (e.key !== "j" && e.key !== "J") return;
      const t = e.target as HTMLElement | null;
      if (
        t &&
        (t.isContentEditable ||
          t.tagName === "INPUT" ||
          t.tagName === "TEXTAREA" ||
          t.tagName === "SELECT")
      ) {
        return;
      }
      if (e.repeat) return;
      e.preventDefault();
      toggleSheet();
    };
    window.addEventListener("keydown", handler);
    return () => window.removeEventListener("keydown", handler);
  }, [toggleSheet]);

  // Escape closes the panel — unless a confirm card is up (it owns Escape to
  // deny) or focus is in the rename field (it stops propagation to cancel edit).
  useEffect(() => {
    if (!open) return;
    const onEsc = (e: KeyboardEvent) => {
      if (e.key !== "Escape") return;
      if (useAgentStore.getState().pendingToolUse) return;
      // Renaming a thread: Escape cancels that edit, not the whole panel.
      const ae = document.activeElement;
      if (ae?.getAttribute("aria-label") === "Rename conversation") return;
      closeSheet();
    };
    document.addEventListener("keydown", onEsc);
    return () => document.removeEventListener("keydown", onEsc);
  }, [open, closeSheet]);

  return (
    <>
      {open && (
        <div
          data-agent-sheet-root
          role="dialog"
          aria-label="Amr assistant"
          aria-modal={false}
          style={panelPos(placed, showFigure, box.h, isPhone, nudge.lift)}
          className="fixed z-50 flex h-[min(68vh,560px)] w-[min(92vw,380px)] flex-col overflow-hidden panel bg-surface-deep shadow-xl"
        >
          <div className="flex items-center justify-between border-b border-border px-4 py-2.5">
            <div>
              <p className="text-sm font-semibold text-text">✦ Amr</p>
              <p className="text-xs text-sub">
                {isOwner ? "Drive every tool" : "Find the right tool"}
                {/* A keyboard shortcut means nothing on a touch screen. */}
                <span className="pointer-coarse:hidden"> · Cmd/Ctrl+J</span>
              </p>
            </div>
            <div className="flex items-center gap-0.5">
              {isOwner && (
                <>
                  <button
                    type="button"
                    onClick={() => {
                      useAgentStore.getState().reset();
                      setShowHistory(false);
                    }}
                    aria-label="New chat"
                    title="New chat"
                    className="min-touch-coarse inline-flex items-center justify-center rounded-md p-1 text-sub transition-colors hover:bg-accent/10 hover:text-text"
                  >
                    <Plus className="h-4 w-4" aria-hidden="true" />
                  </button>
                  <button
                    type="button"
                    onClick={() => setShowHistory((v) => !v)}
                    aria-label="Conversation history"
                    title="History"
                    aria-pressed={showHistory}
                    className={`min-touch-coarse inline-flex items-center justify-center rounded-md p-1 transition-colors hover:bg-accent/10 hover:text-text ${
                      showHistory ? "text-accent" : "text-sub"
                    }`}
                  >
                    <History className="h-4 w-4" aria-hidden="true" />
                  </button>
                </>
              )}
              {motionAvailable && (
                <button
                  type="button"
                  onClick={() => void toggleMotion()}
                  aria-label="Let Amr feel your phone"
                  title={
                    feelsMotion
                      ? "Amr feels your phone's tilt and shakes · tap to stop"
                      : "Let Amr feel your phone's tilt and shakes"
                  }
                  aria-pressed={feelsMotion}
                  className={`min-touch-coarse inline-flex items-center justify-center rounded-md p-1 transition-colors hover:bg-accent/10 hover:text-text ${
                    feelsMotion ? "text-accent" : "text-sub"
                  }`}
                >
                  <Smartphone className="h-4 w-4" aria-hidden="true" />
                </button>
              )}
              <button
                type="button"
                onClick={closeSheet}
                aria-label="Close assistant"
                className="min-touch-coarse inline-flex items-center justify-center rounded-md p-1 text-sub transition-colors hover:bg-accent/10 hover:text-text"
              >
                <X className="h-4 w-4" aria-hidden="true" />
              </button>
            </div>
          </div>
          {!isOwner ? (
            <div className="min-h-0 flex-1" aria-busy={!settled}>
              {settled && <VisitorGuide onNavigate={closeSheet} />}
            </div>
          ) : (
            <OwnerAgentPanel
              showHistory={showHistory}
              onCloseHistory={() => setShowHistory(false)}
            />
          )}
        </div>
      )}

      {/* The screen's side safe areas, for stepping aside to the other side (readSideInsets). */}
      <span
        ref={insetProbeRef}
        aria-hidden="true"
        data-amr-inset-probe
        className="pointer-events-none invisible fixed left-0 top-0 h-0 w-0"
        style={{
          paddingLeft: "env(safe-area-inset-left, 0px)",
          paddingRight: "env(safe-area-inset-right, 0px)",
        }}
      />

      {/* Floating mascot — click to toggle the chat. */}
      {!hideFigure && (
        <button
          ref={buttonRef}
          type="button"
          onClick={onMascotClick}
          onPointerDown={onPointerDown}
          onContextMenu={(e) => showFigure && e.preventDefault()}
          aria-label={open ? "Close assistant" : "Open assistant"}
          title="Ask Amr · drag to reposition"
          style={
            dragPos
              ? { position: "fixed", left: dragPos.left, top: dragPos.top }
              : buttonPos(placed, showFigure, box.h, isPhone, nudge.lift)
          }
          className={cn(
            "z-50 cursor-pointer rounded-full focus:outline-none focus-visible:ring-2 focus-visible:ring-accent",
            !dragPos && styles.float,
            // The figure's box is mostly transparent: let clicks there
            // reach the page, and take them only on the figure (below).
            showFigure && "pointer-events-none",
            !showFigure &&
              "flex h-12 w-12 items-center justify-center border border-border bg-card shadow-lg"
          )}
        >
          {!showFigure && <Sparkles className="h-5 w-5 text-accent" aria-hidden="true" />}
          {showFigure && (
            <span
              ref={hitRef}
              aria-hidden="true"
              data-mascot-hit
              className="pointer-events-auto absolute z-10 select-none rounded-full"
              style={{
                ...hitBox(box),
                // His figure is his own: a finger on him pets or carries him, never scrolls.
                touchAction: "none",
                WebkitTouchCallout: "none",
              }}
              onPointerMove={(e) => {
                if (e.buttons) return; // pressed: the drag handles it
                const p = touchPoint(e, e.currentTarget);
                if (p) touchRef.current?.move(p, false);
              }}
              onPointerLeave={() => touchRef.current?.leave()}
            />
          )}
          {mountFigure && (
            <div
              aria-hidden="true"
              className={
                showFigure ? undefined : "pointer-events-none absolute bottom-0 right-0 opacity-0"
              }
            >
              <MascotSprite
                width={box.w}
                height={box.h}
                moveRef={buttonRef}
                onLoadError={() => setFigureFailed(true)}
              />
            </div>
          )}
        </button>
      )}
    </>
  );
}
