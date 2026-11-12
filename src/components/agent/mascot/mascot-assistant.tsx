"use client";

/**
 * Floating Amr + chat panel — replaces the agent sheet (Phase 3).
 *
 * Amr is always present (bottom-right). Clicking him — or the header
 * button, or Cmd/Ctrl+J — toggles a chat panel that binds to the SAME
 * useAgentStore + sendUserMessage + ConfirmCard as before, so the agent's
 * tool-calling brain, confirm cards, and persistence are unchanged; only the
 * shell is new. Amr "talks" (the review pose) while the agent streams.
 *
 * Amr answers touch: a tap pokes or pats him (by where it lands), quick taps
 * tickle him, a long-press offers a high five, a mouse resting on him or
 * stroking his head gets a shy smile or a pat, and dragging picks him up by the
 * collar — he dangles and swings, and lands where he's dropped or thrown
 * (engine/interactions/clicks.ts, touch.ts). On phones the panel header has a
 * switch that lets him feel the phone's motion (engine/interactions/sensors.ts);
 * where the browser asks before it sends motion, he offers once himself, in a
 * bubble beside him, the first time his panel closes (motion-invite.ts).
 * On touch screens he steps aside (up, or to the other side) when his figure
 * would sit on one of the page's controls (mascot-nudge.ts). He is never
 * taken off the page: while a page field has a phone's keyboard, what he says
 * beside himself waits instead (usePageFieldFocus, MascotBubble `waiting`).
 *
 * The panel is laid out by the screen's height first (amr-geometry's
 * panelLayout, from its size without the keyboard): a short screen (500 px or
 * less: a landscape phone) gets it down one side beside him, a phone held
 * upright the full-height sheet, everything else the floating card. In the
 * sheet, the visible box between the header and the keyboard, Amr docks in
 * its bottom corner on his side (still draggable; a drop or Move Amr picks his
 * side now and his corner for when it closes), the views keep a gutter and a
 * footer clear of him, and the page behind is inert and holds still
 * (useSheetLock). With the keyboard up, or little room, the panel goes compact:
 * it starts at the top of what can be seen and folds its chrome. The visual
 * viewport is read in one animation frame and written as CSS variables
 * (usePanelViewport), so a rising keyboard never re-renders this shell.
 *
 * The owner's agent is owner-only. Visitors keep the mascot (clicks, Konami,
 * Cmd/Ctrl+J) but the panel shows <VisitorGuide/> — a tool finder — instead
 * of the chat, so their panel never touches /api/agent/stream or the agent
 * tables in Supabase. The chat (and the action registry it needs) is a
 * separate dynamic chunk, owner-agent-panel, so visitors never download it
 * either.
 *
 * With visitor AI on (visitorAiEnabled), a confirmed visitor gets
 * <VisitorPanel/> instead: the same guide first, then, after a consent card,
 * Amr's AI through /api/agent/visitor (its own chunks, loaded on demand). An
 * unverified owner session (owner check unanswered) keeps the plain guide, with
 * a narration note that Amr's chat comes back once owner access is confirmed.
 *
 * The panel is drawn as Amr's own balloon (DNA-SPEC §6 "Chat strip"): a comic
 * panel with a tail on the edge that faces him, pointing at his figure
 * (amr-geometry's panelTail), and a header with his lettered name plate, which
 * names the dialog (panel-header). The views below it fill the header's
 * subtitle, back and action slots (panel-chrome), so the owner chunk owns New
 * chat and History. It grows in from the tail's tip, sizes itself from
 * PANEL_SIZE, and Enlarge, on md and wider, gives it the larger size, which
 * this browser remembers. Where he is drawn goes to the mascot store
 * (setPlacement), for the things beside him to follow.
 *
 * He moves without dragging too (WCAG 2.5.7): Move Amr in the header's More
 * menu names his four corners, and the arrow keys move him while his button
 * has focus (its description says so), each move announced. A drop and a move
 * go the same way, and the panel glides after him to the new corner (it snaps
 * for readers who ask for less motion). While he's carried the panel stays put
 * and drops its tail.
 *
 * Every close goes through closePanel(reason): Amr's button, Ctrl/Cmd+J,
 * Escape, the Close button, a link followed and a scene picked alike, and a
 * second call does nothing. On the phone's sheet the phone's Back closes it
 * too, leaving History first (useBackCloses: a CloseWatcher, or a history
 * marker that the other closes take back out and a link's page replaces).
 * Focus has one owner (lib/agent/mascot/use-panel-focus): a keyboard open
 * goes to the name plate, then to a view's registered target (the composer,
 * on a fine pointer); a pointer open leaves focus where it is; a close brings
 * it back to the opener or to Amr's button, except after a link.
 *
 * Escape belongs to the panel only when it is meant for it: pressed inside it,
 * with nothing focused, or on Amr or the header's opener. It goes in one
 * order: a field's own Escape first (the tool finder's search clears, History's
 * rename cancels), then a waiting card is denied, then History goes back to
 * the chat, and only then does the panel close. Ctrl/Cmd+J closes it from
 * anywhere inside, its composer too, except History's rename field.
 *
 * Those visitor views (the guide, the visitor panel, the consent card and the
 * guide's data) are a chunk of their own too, not part of this one, which
 * every page loads: lazy-visitor-body imports them ahead of time, once the
 * page has loaded and the browser is idle and when a pointer, a finger or
 * focus first reaches Amr, so a tap almost never waits. Never for the owner,
 * and never ahead of time with Data Saver on (they load when the panel opens).
 * A panel opened before they arrive keeps its size and shows a plain
 * placeholder until they do.
 *
 * When a part of him isn't there (panel-parts):
 *  - Until his figure is in, and while it can't load, his button is the
 *    lettered "Ask Amr" launcher plate, never a likeness of him. It is still
 *    dragged, moved by Move Amr and the arrow keys, and tapped open.
 *  - A figure that fails (its sheet, its code, or a crash while drawn, which
 *    its own boundary catches) is tried again 2, 4 and 8 s later, at most
 *    three times, each while the page is online and showing (a try that falls
 *    due offline or in a hidden tab waits for it), and at once when the plate
 *    is tapped. The phone band and an open panel keep his figure's place
 *    while a try is to come, and go by the plate only once none is left.
 *  - The panel's body has a boundary of its own: a crash there leaves a
 *    narration caption in the panel (PanelFailed), not the app's error page.
 *  - The owner's chat is a lazy chunk, tried once more before it gives up,
 *    fetched ahead only for a settled owner and never with Data Saver on. A
 *    visitor's page never asks for it. While it, or the sign-in check, is on
 *    its way, a pen scribbles in the body's place (PanelLoading).
 * The app shell keeps a last resort around all of him (layout/amr-boundary).
 */

import {
  Suspense,
  lazy,
  useCallback,
  useEffect,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
  type CSSProperties,
  type ComponentProps,
  type ComponentType,
  type KeyboardEvent as ReactKeyboardEvent,
  type LazyExoticComponent,
  type MouseEvent as ReactMouseEvent,
  type PointerEvent as ReactPointerEvent,
  type RefObject,
} from "react";
import dynamic from "next/dynamic";
import { Clapperboard } from "lucide-react";
import { cn } from "@/lib/utils";
import { ErrorBoundary } from "@/components/layout/error-boundary";
import { useAnnounce } from "@/components/a11y/live-announcer";
import { useAgentStore, type PanelOpenVia } from "@/lib/agent/store";
import { useOwnerState } from "@/lib/auth/use-is-owner";
import { ChatVisibleContext } from "../chat-visibility";
import { visitorAiEnabled } from "@/lib/visitor-ai/contract";
import { did, feel, getMind, recentlyDid } from "@/lib/agent/mascot/mind";
import { useMascotStore, type MascotCorner } from "@/lib/agent/mascot/store";
import { useMascotToolReactions } from "@/lib/agent/mascot/use-tool-reactions";
import { useMascotCelebrationReactions } from "@/lib/agent/mascot/use-celebration-reactions";
import { useQuietCompanion } from "@/lib/agent/mascot/use-quiet-companion";
import { useMuteScene } from "@/lib/agent/mascot/use-mute-scene";
import { playEventScene } from "@/lib/agent/mascot/event-scenes";
import { usePanelFocus, type PanelCloseReason } from "@/lib/agent/mascot/use-panel-focus";
import { useBackCloses } from "@/lib/agent/mascot/use-back-closes";
import { createClickInteraction } from "./engine/interactions/clicks";
import { createTouchInteraction, zoneAt, type TouchPoint } from "./engine/interactions/touch";
import {
  canFeelPhone,
  feelsPhone,
  motionNeedsPermission,
  requestMotionPermission,
} from "./engine/interactions/sensors";
import { installKonami } from "./engine/customization/commands";
import { followUp, sceneOfShot } from "./engine/scene-taps";
import { EVENT_SCENES, sceneReaction } from "./engine/scenes";
import { MascotBubble } from "./mascot-bubble";
import { MascotChatReactions } from "./mascot-chat-reactions";
import { inviteMotion } from "./motion-invite";
import { playMascotSound } from "./engine/audio/mascot-audio";
import { pointToward, shippedScene } from "./engine/sprite-poses";
import { FIGURE_BOTTOM, FIGURE_TOP, SHEET } from "./engine/figure-metrics";
import {
  BUTTON_INSET,
  BUTTON_SIDE,
  FEET_TRIM,
  HEAD_TRIM,
  HIT_SIDE,
  LAUNCHER_PLATE,
  MASCOT_BOX,
  MASCOT_BOX_PHONE,
  PANEL_GAP,
  PANEL_MARGIN,
  PANEL_MIN_H,
  PANEL_SIDE,
  PANEL_SIZE,
  SIDE_PANEL_MAX_W,
  amrEdge,
  amrSide,
  cornerAfterKey,
  cornerName,
  dockInsets,
  dockedButtonPos,
  isCompact,
  otherSide,
  panelLayout,
  panelOrigin,
  panelTail,
  sheetPos,
  sidePos,
  visibleBox,
  type AmrLayout,
  type PanelSizeName,
} from "./amr-geometry";
import {
  SAFE_AREA_PROBE_STYLE,
  VISIBLE_GAP,
  readHeaderBottom,
  readSafeArea,
  readVisibleArea,
  type VisibleAreaReading,
} from "@/lib/layout/use-visible-area";
import { LazyVisitorBody, prefetchVisitorBody } from "./lazy-visitor-body";
import { AMR_PANEL_TITLE_ID, PanelHeader, shortcutLabel } from "./panel-header";
import { FigureFailed, LAUNCHER_LABEL, PanelFailed, PanelLoading } from "./panel-parts";
import { AMR_PANEL_ID } from "./panel-ids";
import { PANEL_SUBTITLE, PanelChrome, PanelIconButton } from "./panel-chrome";
import { AmrPanelContext, type AmrPanelContextValue } from "./panel-context";
import { Narration } from "@/components/agent/comic/comic-parts";
import { PHONE_MEDIA_QUERY } from "@/lib/layout/breakpoints";
import { AMR_SHEET_ATTR, AMR_SHEET_CLOSE_EVENT } from "@/lib/layout/amr-sheet";
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

/** Which corner the mascot is parked in (drag-to-reposition). */
export type Corner = MascotCorner;

/** Which toolkit scenes exist yet (their sheets shipped). Stable, for the hook. */
const sceneShipped = (scene: string) => shippedScene(scene) !== undefined;

// His sizes and the gaps that place him and his panel live in amr-geometry.ts.
/** Taps closer together than this are play (a tickle), not a request for the panel. */
const TAP_TOGGLE_GAP_MS = 600;
/** Let go faster than this (px/s), he's thrown rather than dropped. */
const THROW_SPEED = 1100;
/** He points at the panel when it opens, at most this often. */
const POINT_AT_PANEL_MS = 60_000;

/** History's rename field (conversation-list): it keeps Ctrl/Cmd+J, so an edit isn't lost. */
const RENAME_FIELD = "[data-agent-rename]";
/**
 * The chat's message box (agent-conversation, visitor-agent-panel). While it
 * has focus on the phone's sheet, the docked Amr rides the keyboard beside it.
 */
const COMPOSER = "[data-amr-composer]";
/** History's own button (owner-agent-panel), where focus goes when Escape leaves History. */
const HISTORY_BUTTON = "[data-panel-history]";
/**
 * What opens the panel, outside it: Amr himself and, while the panel is open,
 * the header's opener (both name it in aria-controls). An Escape there is
 * meant for the panel.
 */
const PANEL_OPENERS = `[data-amr-button], [aria-controls="${AMR_PANEL_ID}"]`;

/** An input method is composing: its key presses end or change the composition, nothing else. */
function composing(e: KeyboardEvent): boolean {
  return e.isComposing || e.keyCode === 229;
}

/** A field that types: a key press there is the field's. */
function typesInto(el: Element): boolean {
  return (
    (el as HTMLElement).isContentEditable ||
    el.tagName === "INPUT" ||
    el.tagName === "TEXTAREA" ||
    el.tagName === "SELECT"
  );
}

/** A field inside his panel that types has focus: a phone's keyboard is up for it. */
function panelFieldHasFocus(panel: HTMLElement | null): boolean {
  const el = document.activeElement;
  return !!panel && !!el && panel.contains(el) && typesInto(el);
}

/** A layout effect in the browser, a plain one on the server (no SSR warning). */
const useIsomorphicLayoutEffect = typeof window === "undefined" ? useEffect : useLayoutEffect;

function prefersReducedMotion(): boolean {
  return window.matchMedia?.("(prefers-reduced-motion: reduce)").matches === true;
}

/**
 * How the panel (and, after a move, Amr) glides to a new corner: DNA-SPEC §8's
 * travel duration and calm easing (lib/motion/tokens.ts DUR.travel, EASE.calm;
 * --dur-travel, --ease-calm), written out so this chunk doesn't load the
 * tokens' spring maths. test/agent/mascot-move.test.tsx holds them equal.
 */
export const GLIDE: Readonly<{ duration: number; easing: string }> = {
  duration: 360,
  easing: "cubic-bezier(0.16, 1, 0.3, 1)",
};

/**
 * FLIP: `el` has just been placed somewhere else, and `from` is where it was
 * (its box before the move). It slides from there on the translate property,
 * which nothing else sets on the panel and which composes with the entrance's
 * scale. Never under reduced motion: it snaps, and animate() is never called.
 */
function glideFrom(el: HTMLElement | null, from: DOMRect | null): void {
  if (!el || !from || prefersReducedMotion() || typeof el.animate !== "function") return;
  const to = el.getBoundingClientRect();
  const dx = from.left - to.left;
  const dy = from.top - to.top;
  if (Math.hypot(dx, dy) < 2) return;
  el.animate(
    [{ translate: `${dx.toFixed(1)}px ${dy.toFixed(1)}px` }, { translate: "0px 0px" }],
    GLIDE
  );
}

/**
 * What Amr's button says about moving him, as its description (its title
 * says it to a mouse): the keys that move him without dragging.
 */
export const MOVE_HINT = "Arrow keys move him";
const MOVE_HINT_ID = "amr-move-hint";

/**
 * What a move by Move Amr or an arrow key announces: narration, never an Amr
 * line. Docked in the phone's sheet he stands at its bottom whatever corner is
 * picked, so a top corner is where he goes once the chat closes.
 */
export function moveNote(next: Corner, moves: boolean, docked: boolean): string {
  const where = cornerName(next).toLowerCase();
  if (!moves) return `Amr is already in the ${where}`;
  if (docked && amrEdge(next) === "top")
    return `Amr will stand in the ${where} once the chat closes`;
  return `Amr moved to the ${where}`;
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
  if (!figure) return LAUNCHER_PLATE.h + 2 * BUTTON_INSET;
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
    ...sideOffset(c, BUTTON_SIDE),
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

/**
 * Chat-panel style for a corner — hugs Amr's silhouette, not his box. `boxH` is
 * the rendered box height (the figure's rows scale with it); for the launcher
 * plate (`figure` false), the panel clears the plate instead. `lift` is how far he has
 * stepped off his edge for a control, and the panel goes with him. `size` is
 * which PANEL_SIZE the panel has (the panel's style sets it from the same
 * entry), so the room it needs follows Enlarge.
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
  lift = 0,
  size: PanelSizeName = "normal"
): CSSProperties {
  const panelHeight = PANEL_SIZE[size].height;
  const scale = boxH / SHEET.cellH;
  const top = figure ? FIGURE_TOP * scale : 0;
  const bottom = figure ? FIGURE_BOTTOM * scale : LAUNCHER_PLATE.h;
  const height = figure ? boxH : LAUNCHER_PLATE.h;
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
  const anchor = `min(${offset}, calc(${room} - min(${panelHeight}, ${PANEL_MIN_H}px)))`;
  return {
    ...(atTop ? { top: anchor } : { bottom: anchor }),
    ...sideOffset(c, PANEL_SIDE),
    maxHeight: `max(${PANEL_MIN_H}px, calc(${room} - ${offset}))`,
  };
}

/** An inline style that sets CSS variables too (the panel's, read by its classes and CSS). */
type StyleWithVars = CSSProperties & { [name: `--${string}`]: string };

/** The top edge of the sheet and the side panel, until usePanelViewport's first reading: under the header. */
const PLACE_TOP = `var(--amr-vv-top, calc(var(--header-h, 56px) + ${VISIBLE_GAP}px))`;
/** Their bottom edge likewise: clear of the home indicator. */
const PLACE_BOTTOM = `var(--amr-vv-bottom, calc(${VISIBLE_GAP}px + env(safe-area-inset-bottom, 0px)))`;

/**
 * The phone's sheet: the visible box (amr-geometry's sheetPos), from the
 * variables usePanelViewport writes. Its own width and height go (auto): the
 * four edges size it.
 */
function sheetPlace(): CSSProperties {
  return {
    top: PLACE_TOP,
    bottom: PLACE_BOTTOM,
    left: `var(--amr-vv-left, calc(${BUTTON_SIDE}px + env(safe-area-inset-left, 0px)))`,
    right: `var(--amr-vv-right, calc(${BUTTON_SIDE}px + env(safe-area-inset-right, 0px)))`,
  };
}

/**
 * The side layout's panel (amr-geometry's sidePos): top to bottom beside him,
 * from the variables usePanelViewport writes; until its first reading, clear
 * of his figure (or the launcher plate) and up to SIDE_PANEL_MAX_W wide.
 */
function sidePlace(c: Corner, phone: boolean, figure: boolean): StyleWithVars {
  const side = amrSide(c);
  const w = (phone ? MASCOT_BOX_PHONE : MASCOT_BOX).w;
  const inline = BUTTON_SIDE + (figure ? w * (1 - HIT_SIDE) : LAUNCHER_PLATE.w) + PANEL_GAP;
  return {
    top: PLACE_TOP,
    bottom: PLACE_BOTTOM,
    [side]: `var(--amr-vv-inline, calc(${inline}px + env(safe-area-inset-${side}, 0px)))`,
    "--amr-panel-width": `var(--amr-vv-width, min(${SIDE_PANEL_MAX_W}px, calc(100vw - ${inline + BUTTON_SIDE}px)))`,
    "--amr-panel-height": "auto",
  };
}

/**
 * The side layout's tail, on the panel's edge facing him: its near side, so
 * its tip is level with the middle of his figure. Counted from the panel's
 * end at his edge (its bottom for a bottom corner), where his button and the
 * panel are both measured from, so the safe area falls out.
 */
function sideTailAt(c: Corner, boxH: number, lift: number, phone: boolean): string {
  const scale = boxH / SHEET.cellH;
  const middle = ((FIGURE_TOP + FIGURE_BOTTOM) / 2) * scale;
  const atTop = c.startsWith("top");
  const raw = edgeOffset(c, edgeInset(c, true, boxH) + lift, phone);
  const button = typeof raw === "number" ? `${raw}px` : raw;
  const panel = atTop ? "var(--amr-vv-top, 0px)" : "var(--amr-vv-bottom, 0px)";
  const fromEdge = atTop ? middle : boxH - middle;
  return `calc(${button} + ${fromEdge.toFixed(2)}px - ${panel} - 0.4rem - var(--panel-w))`;
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

/** True at phone width (`PHONE_MAX_PX`, below Tailwind's `sm`). */
function useIsPhone(): boolean {
  return useMediaQuery(PHONE_MEDIA_QUERY);
}

/** Tailwind's md: Enlarge is offered, and the larger size applies, only this wide. */
const ENLARGE_MEDIA_QUERY = "(min-width: 768px)";

/**
 * Where this browser remembers that the panel was left enlarged. Under the
 * app's prefix, so "Clear data on this browser" forgets it; a display
 * preference, so a backup may carry it.
 */
export const PANEL_SIZE_KEY = "agile-toolkit:amr-panel-size";

/** The size the panel was left at: large, or the usual one (also when storage can't be read). */
function readPanelSize(): PanelSizeName {
  try {
    return localStorage.getItem(PANEL_SIZE_KEY) === "large" ? "large" : "normal";
  } catch {
    return "normal";
  }
}

function savePanelSize(size: PanelSizeName): void {
  try {
    if (size === "large") localStorage.setItem(PANEL_SIZE_KEY, size);
    else localStorage.removeItem(PANEL_SIZE_KEY);
  } catch {
    /* storage unavailable: the size lasts until the page closes */
  }
}

/**
 * Amr's panel's chosen size (Enlarge), remembered by this browser, and the size
 * it has on this screen: the larger one only at md and wider, so a narrower
 * window keeps the usual card while remembering the choice.
 */
function usePanelSize(): { enlarged: boolean; size: PanelSizeName; toggle: () => void } {
  const [chosen, setChosen] = useState<PanelSizeName>("normal");
  useEffect(() => setChosen(readPanelSize()), []);
  const wide = useMediaQuery(ENLARGE_MEDIA_QUERY);
  const enlarged = chosen === "large";
  return {
    enlarged,
    size: enlarged && wide ? "large" : "normal",
    toggle: () => {
      const next = enlarged ? "normal" : "large";
      setChosen(next);
      savePanelSize(next);
    },
  };
}

/**
 * The CSS variables that keep space for Amr on phones, for a band on `side` of
 * `height` px. `--amr-band-top` / `--amr-band-bottom` are the band's own height
 * (the bottom one includes the home-indicator inset; the top one is measured
 * from the header's bottom edge, since a top-docked Amr stands below the
 * header). `--amr-band-top-edge` is where the top band ends, measured from the
 * top of the viewport, for things positioned against the viewport (the phone
 * trophy sheet) rather than against the header.
 */
export function phoneBandVars(side: "top" | "bottom", height: number): Record<string, string> {
  return side === "top"
    ? {
        "--amr-band-top": `${height}px`,
        "--amr-band-top-edge": `calc(var(--header-h, 56px) + ${height}px)`,
      }
    : { "--amr-band-bottom": `calc(${height}px + env(safe-area-inset-bottom, 0px))` };
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
    const vars = phoneBandVars(side, height);
    for (const [name, value] of Object.entries(vars)) root.style.setProperty(name, value);
    return () => {
      for (const name of Object.keys(vars)) root.style.removeProperty(name);
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

/** The idle callback, where the browser has one (Safari has none). */
type IdleWindow = Window & {
  requestIdleCallback?: (cb: () => void, opts?: { timeout: number }) => number;
  cancelIdleCallback?: (id: number) => void;
};

/** The panel's body is fetched by this long after load, idle or not. */
const BODY_IDLE_TIMEOUT_MS = 4000;
/** Without an idle callback, the panel's body is fetched this long after load. */
const BODY_PREFETCH_DELAY_MS = 1500;

/**
 * Fetch the open panel's body ahead (the visitor body, or the owner's chat)
 * once the page has loaded and the browser is idle, so opening the panel
 * almost never waits for it. Not when the visitor asked to save data: the body
 * then loads when the panel opens. `prefetch` must be stable.
 */
function usePrefetchWhenIdle(enabled: boolean, prefetch: () => void) {
  useEffect(() => {
    if (!enabled || savesData()) return;
    const w = window as IdleWindow;
    let idleId: number | undefined;
    let timer: number | undefined;
    const schedule = () => {
      if (w.requestIdleCallback)
        idleId = w.requestIdleCallback(prefetch, { timeout: BODY_IDLE_TIMEOUT_MS });
      else timer = window.setTimeout(prefetch, BODY_PREFETCH_DELAY_MS);
    };
    if (document.readyState === "complete") schedule();
    else window.addEventListener("load", schedule, { once: true });
    return () => {
      window.removeEventListener("load", schedule);
      window.clearTimeout(timer);
      if (idleId !== undefined) w.cancelIdleCallback?.(idleId);
    };
  }, [enabled, prefetch]);
}

/**
 * Defer the figure (its chunk and the sprite sheet) until the visitor first
 * interacts (pointer, key, scroll) or a moment after the page has loaded,
 * whichever comes first, then wait for an idle moment, so it never competes with
 * the page's own content. The launcher plate shows until then. When the visitor asked
 * to save data, only an interaction starts him: the sheet is fetched for someone
 * using the page, and he still shows for everyone.
 */
function useDeferredFigure(): boolean {
  const [ready, setReady] = useState(false);
  useEffect(() => {
    const interactionOnly = savesData();
    const w = window as IdleWindow;
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

/**
 * After his figure fails, how long each try of its own waits: 2 s, then 4 s,
 * then 8 s. Its length is how many such tries there are (a tap on the plate
 * is never counted).
 */
export const FIGURE_RETRY_MS: readonly number[] = [2000, 4000, 8000];

/** A fetch could work now: the browser thinks it's online, and the tab is showing. */
function canFetchNow(): boolean {
  return navigator.onLine !== false && document.visibilityState !== "hidden";
}

interface FigureRecovery {
  /** His figure failed and isn't mounted: the launcher plate stands in his spot. */
  down: boolean;
  /** It failed with no try of its own left: only a tap on the plate tries it again. */
  gaveUp: boolean;
  /** It has failed at least once in the page's life (a try may have brought it back since). */
  failedOnce: boolean;
  /** His figure couldn't load (its sheet or its code) or crashed. Once per try. */
  fail: () => void;
  /** Try it again now: the plate was tapped. */
  retry: () => void;
}

/**
 * Gets his figure back after it fails. Each try of its own waits its
 * FIGURE_RETRY_MS, and then for the page to be online and showing: a try that
 * falls due offline or in a hidden tab goes when the browser is back online
 * or the tab shows again, so none is spent where it can't work. A tap on the
 * plate tries at once, whenever it is down. At most FIGURE_RETRY_MS.length
 * tries of its own in the page's life, so a figure that keeps failing doesn't
 * keep fetching.
 */
function useFigureRecovery(): FigureRecovery {
  const [state, setState] = useState({
    down: false,
    tries: 0,
    due: false,
    gaveUp: false,
    failedOnce: false,
  });
  const fail = useCallback(
    () =>
      setState((s) =>
        s.down
          ? s
          : {
              ...s,
              down: true,
              due: false,
              gaveUp: s.tries >= FIGURE_RETRY_MS.length,
              failedOnce: true,
            }
      ),
    []
  );
  const retry = useCallback(
    () => setState((s) => (s.down ? { ...s, down: false, due: false } : s)),
    []
  );
  const { down, tries, due, gaveUp, failedOnce } = state;
  // A try of its own is to come.
  const waiting = down && !gaveUp;
  // Its wait.
  useEffect(() => {
    if (!waiting || due) return;
    const id = window.setTimeout(
      () => setState((s) => (s.down ? { ...s, due: true } : s)),
      FIGURE_RETRY_MS[tries]
    );
    return () => window.clearTimeout(id);
  }, [waiting, due, tries]);
  // Then the try: now, or once the page is online and showing.
  useEffect(() => {
    if (!waiting || !due) return;
    const go = () => {
      if (!canFetchNow()) return;
      setState((s) =>
        s.down && s.due ? { ...s, down: false, due: false, tries: s.tries + 1 } : s
      );
    };
    go();
    window.addEventListener("online", go);
    document.addEventListener("visibilitychange", go);
    return () => {
      window.removeEventListener("online", go);
      document.removeEventListener("visibilitychange", go);
    };
  }, [waiting, due]);
  return { down, gaveUp, failedOnce, fail, retry };
}

/**
 * On phones, a field on the page (outside his panel) has focus, so the
 * keyboard is up over the page. He stays where he is, never taken off the
 * page (DNA-SPEC §6: he stays visible on every page); what he says beside
 * himself waits instead (MascotBubble `waiting`), so it never sits over what
 * is being typed, and shows once the field lets go.
 */
function usePageFieldFocus(isPhone: boolean): boolean {
  const [focused, setFocused] = useState(false);
  useEffect(() => {
    if (!isPhone) {
      setFocused(false);
      return;
    }
    const isField = (t: EventTarget | null) => t instanceof Element && typesInto(t);
    const onIn = (e: FocusEvent) => {
      // A field in his own panel is his chat's, not the page's.
      const inPanel = (e.target as HTMLElement | null)?.closest?.("[data-agent-sheet-root]");
      if (isField(e.target) && !inPanel) setFocused(true);
    };
    const onOut = (e: FocusEvent) => {
      if (isField(e.target)) setFocused(false);
    };
    document.addEventListener("focusin", onIn);
    document.addEventListener("focusout", onOut);
    return () => {
      document.removeEventListener("focusin", onIn);
      document.removeEventListener("focusout", onOut);
    };
  }, [isPhone]);
  return focused;
}

/**
 * The screen's size without the keyboard: the layout viewport's height, which
 * a keyboard never shrinks in Safari or Chrome (Firefox's does, so the layout
 * is held while a field in the panel has focus: usePanelViewport), and its
 * width as the media queries read it (with any scrollbar), or, while
 * pinch-zoomed, the layout viewport's own width, which the zoom leaves be.
 */
function layoutViewport(): { width: number; height: number } {
  const root = document.documentElement;
  const vv = window.visualViewport;
  const zoomed = !!vv && Math.abs(vv.scale - 1) > 0.01;
  return {
    width: (zoomed && root.clientWidth) || window.innerWidth,
    height: root.clientHeight || window.innerHeight,
  };
}

/** How the panel is laid out on this screen now (amr-geometry's panelLayout, height first). */
function readLayout(): AmrLayout {
  return typeof window === "undefined" ? "float" : panelLayout(layoutViewport());
}

/** The visible area and the box the sheet fits in, read off the page as it is now. */
function measureBox(probe: Element | null): {
  area: VisibleAreaReading;
  box: ReturnType<typeof visibleBox>;
  width: number;
  height: number;
} {
  const safe = readSafeArea(probe);
  const root = document.documentElement;
  const width = root.clientWidth || window.innerWidth;
  const height = root.clientHeight || window.innerHeight;
  const area = readVisibleArea({
    clientHeight: height,
    viewport: window.visualViewport,
    headerBottom: readHeaderBottom(),
    safeTop: safe.top,
    safeBottom: safe.bottom,
  });
  return { area, box: visibleBox({ width, height }, area, safe), width, height };
}

/**
 * What usePanelViewport writes, as CSS variables, so a keyboard rising (a
 * reading every frame) never re-renders the shell. On the panel:
 *   --amr-vv-top, --amr-vv-bottom   its top and bottom edges, px from the
 *                                   screen's (the sheet and the side layout)
 *   --amr-vv-left, --amr-vv-right   the sheet's side edges
 *   --amr-vv-inline, --amr-vv-width the side layout's offset from his side and its width
 *   --amr-kb, --amr-visible-h       the keyboard's height and the visible box's
 * and on his button, docked in the sheet (DOCK_VARS):
 *   --amr-dock-bottom, --amr-dock-inline
 * The panel's go with it when it closes; his are taken off.
 */
const DOCK_VARS = ["--amr-dock-bottom", "--amr-dock-inline"] as const;

function setPx(el: HTMLElement, name: string, px: number): void {
  el.style.setProperty(name, `${Math.round(px * 100) / 100}px`);
}

/** Why a reading is taken: nothing about the layout, a resize, or a turn of the phone. */
type LayoutCheck = "none" | "resize" | "rotate";

/**
 * The panel's layout (float, phone sheet, side) and whether a keyboard is up,
 * kept while the panel is open: the only two things React holds. Everything
 * else a reading gives (where the sheet or the side panel sits, where the
 * docked Amr stands, compact mode) is written straight onto the panel and his
 * button (the variables above, data-amr-compact), from one animation frame
 * however many viewport events come in it.
 *
 * - The layout comes from the screen's size without the keyboard, read afresh
 *   as the panel opens (in that render, so nothing acts on last time's). It
 *   is held while a field in the panel has focus (Firefox shrinks the layout
 *   viewport for the keyboard, which would read as a short screen), and
 *   checked again on a resize with no such field focused, and on every turn of
 *   the phone: an orientationchange, or any reading whose width has changed
 *   since the last check, which a keyboard never does (Android Chrome and
 *   older iOS send orientationchange before the resize with the new size).
 *   Not as a field lets go: Firefox's keyboard is still closing then, and its
 *   own resize comes once it has.
 * - Compact (keyboard up, or a visible box under 360 px; sheet and side only):
 *   the panel starts just under the top of what can be seen, over the site
 *   header, and its views fold their chrome (data-amr-compact, on his button
 *   too: both are lifted to the header's layer then).
 * - Docked in the sheet, Amr stands in its bottom corner on his side, and
 *   rides up with the keyboard only while the composer has focus.
 * Nothing listens while the panel is shut.
 */
function usePanelViewport({
  open,
  panelRef,
  buttonRef,
  probeRef,
  placed,
  phone,
  figure,
  shown,
}: {
  open: boolean;
  panelRef: RefObject<HTMLDivElement | null>;
  buttonRef: RefObject<HTMLButtonElement | null>;
  probeRef: RefObject<HTMLSpanElement | null>;
  /** The corner he's drawn in: the side panel's side, and the side he docks on. */
  placed: Corner;
  /** The side panel clears a phone's figure (MASCOT_BOX_PHONE) or the desktop one. */
  phone: boolean;
  /**
   * His figure, or the launcher plate standing in for it, for the side panel:
   * the figure's place is kept while one is coming.
   */
  figure: boolean;
  /** Whether his figure is drawn now (not the plate): where he docks in the sheet. */
  shown: boolean;
}): { layout: AmrLayout; keyboardUp: boolean } {
  const [layout, setLayout] = useState<AmrLayout>(readLayout);
  const [keyboardUp, setKeyboardUp] = useState(false);
  // The panel opening: its layout read now, in this render, so Back's hook
  // and the sheet's lock below never act on the layout it had last time.
  const [wasOpen, setWasOpen] = useState(open);
  if (open !== wasOpen) {
    setWasOpen(open);
    const fresh = open ? readLayout() : layout;
    if (fresh !== layout) setLayout(fresh);
  }
  const latest = useRef({ placed, phone, figure, shown, layout, keyboardUp });
  latest.current = { placed, phone, figure, shown, layout, keyboardUp };
  // The layout viewport's width at the last layout check: a new one is a turn.
  const decidedWidth = useRef<number | null>(null);

  // Reads the page and writes the variables. Stable: it reads everything off refs.
  const write = useCallback(
    (check: LayoutCheck) => {
      const panel = panelRef.current;
      if (!panel) return;
      const now = latest.current;
      let current = now.layout;
      if (check !== "none") {
        const vp = layoutViewport();
        // A keyboard never changes the width (Firefox's shrink is height only),
        // so a new width is a turn of the phone, even when its orientationchange
        // came frames before the size did. Kept only on layout checks, so a
        // visualViewport scroll can't take it in before the resize arrives.
        const turned =
          check === "rotate" ||
          (decidedWidth.current !== null && vp.width !== decidedWidth.current);
        decidedWidth.current = vp.width;
        const next = panelLayout(vp);
        if (next !== current && (turned || !panelFieldHasFocus(panel))) {
          current = next;
          now.layout = next;
          setLayout(next);
        }
      }
      const { area, box } = measureBox(probeRef.current);
      setPx(panel, "--amr-kb", area.kb);
      setPx(panel, "--amr-visible-h", box.height);
      const compact = current !== "float" && isCompact(area.keyboardUp, box);
      const top = { compact, viewTop: area.viewTop };
      if (current === "sheet") {
        const pos = sheetPos(box, top);
        setPx(panel, "--amr-vv-top", pos.top);
        setPx(panel, "--amr-vv-bottom", pos.bottom);
        setPx(panel, "--amr-vv-left", pos.left);
        setPx(panel, "--amr-vv-right", pos.right);
      } else if (current === "side") {
        const pos = sidePos(now.placed, box, { phone: now.phone, figure: now.figure }, top);
        setPx(panel, "--amr-vv-top", pos.top);
        setPx(panel, "--amr-vv-bottom", pos.bottom);
        setPx(panel, "--amr-vv-inline", pos.left ?? pos.right ?? 0);
        setPx(panel, "--amr-vv-width", pos.width);
      }
      panel.toggleAttribute("data-amr-compact", compact);
      const button = buttonRef.current;
      // His button too: compact, the panel is lifted over the site header, and
      // he is lifted with it, so it never covers him (their classes).
      button?.toggleAttribute("data-amr-compact", compact);
      if (button && current === "sheet") {
        // Beside the composer while it has the keyboard; otherwise where the
        // sheet's bottom rests, so a search field's keyboard leaves him be.
        const held = document.activeElement;
        const rides = !!held && panel.contains(held) && !!held.closest(COMPOSER);
        const dock = dockedButtonPos(
          now.placed,
          rides ? box : { ...box, bottom: area.restBottom },
          now.shown
        );
        setPx(button, "--amr-dock-bottom", dock.bottom);
        setPx(button, "--amr-dock-inline", dock.left ?? dock.right ?? 0);
      } else if (button) {
        for (const name of DOCK_VARS) button.style.removeProperty(name);
      }
      // Only a change: a keyboard rising frame by frame never asks React to render.
      if (area.keyboardUp !== now.keyboardUp) {
        now.keyboardUp = area.keyboardUp;
        setKeyboardUp(area.keyboardUp);
      }
    },
    [panelRef, buttonRef, probeRef]
  );

  useIsomorphicLayoutEffect(() => {
    if (!open) return;
    // A fresh reading as it opens, before it paints: never last time's keyboard.
    decidedWidth.current = layoutViewport().width;
    write("none");
    let frame = 0;
    let pending: LayoutCheck = "none";
    const schedule = (check: LayoutCheck) => {
      if (check === "rotate" || (check === "resize" && pending === "none")) pending = check;
      if (frame) return;
      frame = window.requestAnimationFrame(() => {
        frame = 0;
        const why = pending;
        pending = "none";
        write(why);
      });
    };
    const onResize = () => schedule("resize");
    const onScroll = () => schedule("none");
    const onRotate = () => schedule("rotate");
    // A panel field taking focus starts the composer's ride; one letting go ends it.
    const onFocus = (e: FocusEvent) => {
      const t = e.target;
      if (t instanceof Element && typesInto(t) && panelRef.current?.contains(t)) schedule("none");
    };
    const vv = window.visualViewport;
    vv?.addEventListener("resize", onResize);
    vv?.addEventListener("scroll", onScroll);
    window.addEventListener("resize", onResize);
    window.addEventListener("orientationchange", onRotate);
    document.addEventListener("focusin", onFocus);
    document.addEventListener("focusout", onFocus);
    const button = buttonRef.current;
    return () => {
      window.cancelAnimationFrame(frame);
      vv?.removeEventListener("resize", onResize);
      vv?.removeEventListener("scroll", onScroll);
      window.removeEventListener("resize", onResize);
      window.removeEventListener("orientationchange", onRotate);
      document.removeEventListener("focusin", onFocus);
      document.removeEventListener("focusout", onFocus);
      for (const name of DOCK_VARS) button?.style.removeProperty(name);
      button?.removeAttribute("data-amr-compact");
      latest.current.keyboardUp = false;
      setKeyboardUp(false);
    };
  }, [open, write, panelRef, buttonRef]);

  // Where he stands, or the layout, changed while open: read again before paint.
  useIsomorphicLayoutEffect(() => {
    if (open) write("none");
  }, [open, layout, placed, phone, figure, shown, write]);

  return { layout, keyboardUp };
}

/**
 * The phone's sheet covers the page, so while it is open (and only in that
 * layout) the page behind is out of reach: main is inert, the document
 * doesn't scroll and the sheet's chrome takes no swipe (html[data-amr-sheet],
 * globals.css "AMR SHEET"). A layout effect, so a close removes it before
 * focus goes back to an opener in main.
 *
 * Another full-screen surface opening over it (the sidebar, search, Activity:
 * lib/layout/amr-sheet's closeAmrSheet) closes it first through `onOutside`,
 * so two never stack.
 */
function useSheetLock(on: boolean, onOutside: () => void): void {
  const outside = useRef(onOutside);
  outside.current = onOutside;
  useIsomorphicLayoutEffect(() => {
    if (!on) return;
    const html = document.documentElement;
    html.setAttribute(AMR_SHEET_ATTR, "");
    const main = document.getElementById("main-content") ?? document.querySelector("main");
    // Only what this made inert is let go (something else may hold it too).
    const madeInert = main && !main.hasAttribute("inert") ? main : null;
    madeInert?.setAttribute("inert", "");
    const close = () => outside.current();
    document.addEventListener(AMR_SHEET_CLOSE_EVENT, close);
    return () => {
      document.removeEventListener(AMR_SHEET_CLOSE_EVENT, close);
      html.removeAttribute(AMR_SHEET_ATTR);
      madeInert?.removeAttribute("inert");
    };
  }, [on]);
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
 * His own things, which never count as a page control under him and whose
 * changes never make him look again: his panel, his bubble and the moment chip
 * beside him. Otherwise his bubble's own buttons would push him away from it.
 */
const BESIDE_HIM = "[data-agent-sheet-root], [data-amr-bubble-region], [data-moment-region]";

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
      (node instanceof Element && !!node.closest(BESIDE_HIM));
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

type SpriteModule = typeof import("./mascot-sprite");
type OwnerModule = typeof import("./owner-agent-panel");
/** Imports his figure (the sprite engine): its own chunk. */
export type LoadSprite = () => Promise<SpriteModule>;
/** Imports the owner's chat (the agent runtime): its own chunk, only ever for the owner. */
export type LoadOwnerPanel = () => Promise<OwnerModule>;

const importSprite: LoadSprite = () => import("./mascot-sprite");
const importOwnerPanel: LoadOwnerPanel = () => import("./owner-agent-panel");

/**
 * One lazy component per loader, shared by every mount, so once its code is in
 * it draws at once (this chunk never renders on the server: app-shell loads it
 * with ssr: false). React.lazy keeps a rejection for good, so one whose import
 * failed is never drawn again: the next call makes a new one, which imports
 * the chunk again (webpack forgets a chunk that failed to load). The failure
 * is noted on the import itself, so a figure or panel gone by the time it
 * fails still leaves the next try a fresh one. `importWith` calls the loader.
 */
function retryableLazy<L extends object, P>(
  importWith: (load: L) => Promise<{ default: ComponentType<P> }>
): (load: L) => LazyExoticComponent<ComponentType<P>> {
  type Lazy = LazyExoticComponent<ComponentType<P>>;
  const known = new WeakMap<L, Lazy>();
  const failed = new WeakSet<Lazy>();
  return (load) => {
    const was = known.get(load);
    if (was && !failed.has(was)) return was;
    const next: Lazy = lazy(async () => {
      try {
        return await importWith(load);
      } catch (err) {
        failed.add(next);
        throw err;
      }
    });
    known.set(load, next);
    return next;
  };
}

const spriteFor = retryableLazy((load: LoadSprite) => load());

// Amr's scenes: its titles and thumbnail atlas load only when the view first opens.
const ScenesTab = dynamic(() => import("./scenes-tab"), {
  ssr: false,
  loading: () => <div className="min-h-0 flex-1" aria-busy="true" />,
});

/** After the owner's chat fails to import, it is tried once more, this long after. */
export const OWNER_RETRY_MS = 1000;

/** Each loader's import of the owner's chat, under way or done. A failed one is forgotten. */
const ownerImports = new WeakMap<LoadOwnerPanel, Promise<OwnerModule>>();

/**
 * Imports the owner's chat, once per loader: the prefetch and the panel share
 * it. A failed import is tried once more after OWNER_RETRY_MS (a blip in the
 * connection); when that fails too, the panel's boundary says so, and the
 * import is forgotten, so the next open, prefetch or Start a new chat imports
 * again.
 */
function loadOwner(load: LoadOwnerPanel): Promise<OwnerModule> {
  const known = ownerImports.get(load);
  if (known) return known;
  const next = load()
    .catch(() => new Promise<void>((done) => window.setTimeout(done, OWNER_RETRY_MS)).then(load))
    .catch((err: unknown) => {
      ownerImports.delete(load);
      throw err;
    });
  ownerImports.set(load, next);
  return next;
}

const ownerPanelFor = retryableLazy(loadOwner);

/** Fetches the owner's chat ahead of the panel. A failure waits for the panel to try again. */
function prefetchOwnerPanel(load: LoadOwnerPanel): void {
  loadOwner(load).catch(() => {});
}

type OwnerPanelProps = ComponentProps<OwnerModule["default"]>;

/**
 * The owner's chat in the panel's body: a pen scribbles in its place until its
 * chunk is in (the panel keeps its size). Asked for on each render, so after a
 * failed import the next one (Start a new chat, the panel opening again) is a
 * fresh try.
 */
function OwnerBody({ load, ...props }: OwnerPanelProps & { load: LoadOwnerPanel }) {
  const OwnerPanel = ownerPanelFor(load);
  return (
    <Suspense fallback={<PanelLoading />}>
      <OwnerPanel {...props} />
    </Suspense>
  );
}

/**
 * Over the tool finder while a signed-in session waits on the owner check
 * (offline, 5xx, timeout; AuthProvider retries). Narration, not an Amr line,
 * in the account menu's words ("Signed in, checking owner access").
 */
export const UNVERIFIED_OWNER_NOTE =
  "Signed in, checking owner access. Amr's chat comes back once it's confirmed.";

function UnverifiedOwnerNote() {
  return <Narration>{UNVERIFIED_OWNER_NOTE}</Narration>;
}

export function MascotAssistant({
  loadSprite = importSprite,
  loadOwnerPanel = importOwnerPanel,
}: {
  /** Imports his figure. Tests pass their own. */
  loadSprite?: LoadSprite;
  /** Imports the owner's chat, for the owner only. Tests pass their own. */
  loadOwnerPanel?: LoadOwnerPanel;
} = {}) {
  const open = useAgentStore((s) => s.open);
  const openedVia = useAgentStore((s) => s.openedVia);
  // Bumped by a key press on the header's opener while the panel is open.
  const focusRequest = useAgentStore((s) => s.focusRequest);
  const [showHistory, setShowHistory] = useState(false);
  const [showScenes, setShowScenes] = useState(false);
  // A write waiting for a yes: its card has to be seen (scenesOpen, below).
  const confirmPending = useAgentStore((s) => s.pendingToolUse !== null);
  // `settled` keeps the owner from seeing the visitor notice flash while
  // auth is still loading; no chat component mounts until it's settled.
  const { isOwner, settled, unverified, visitor } = useOwnerState();
  // Amr's AI for visitors: a confirmed visitor only, and only in a build that has it on.
  const visitorAi = visitor && visitorAiEnabled();
  // Everyone but the owner opens the panel on the visitor body, and the owner
  // on the chat: each fetches its own ahead, and only once auth has settled
  // (isOwner reads false until then), so a visitor never asks for the owner's.
  usePrefetchWhenIdle(settled && !isOwner, prefetchVisitorBody);
  const prefetchOwner = useCallback(() => prefetchOwnerPanel(loadOwnerPanel), [loadOwnerPanel]);
  usePrefetchWhenIdle(settled && isOwner, prefetchOwner);
  // Reaching for Amr (a pointer over him, a finger on him, focus on him): fetch
  // it now if it isn't here yet (Data Saver waits for the panel to open). Like
  // the idle fetch, it waits for auth to settle. Once fetched, this does nothing.
  const reachForAmr = () => {
    if (!settled || savesData()) return;
    if (isOwner) prefetchOwner();
    else prefetchVisitorBody();
  };
  const isPhone = useIsPhone();
  // Touch screens of any width (a landscape phone, a tablet): his figure there is
  // where a finger lands, so he steps aside for the page's controls.
  const coarsePointer = useMediaQuery("(pointer: coarse)");
  // A page field has a phone's keyboard: he stays, and his bubble waits.
  const pageFieldFocus = usePageFieldFocus(isPhone);
  // Under 360 px wide the header has no room for New chat beside History:
  // it moves into the More menu (the owner's icon hides at the same width).
  const narrow = useMediaQuery("(max-width: 359px)");
  const box = isPhone ? MASCOT_BOX_PHONE : MASCOT_BOX;
  const panelSize = usePanelSize();

  // The figure loads after the page is idle; until it's ready (or while it
  // can't load) the "Ask Amr" plate keeps him one click away without an
  // invisible hit box over the page, and his failed figure is tried again.
  const loadFigure = useDeferredFigure();
  const figureReady = useMascotStore((s) => s.ready);
  const figure = useFigureRecovery();
  const mountFigure = loadFigure && !figure.down;
  const showFigure = mountFigure && figureReady;
  // His figure can't load and no try of its own is to come: the plate stays,
  // and the phone band and the panel go by it. While a try is to come they
  // keep his figure's place, so nothing jumps each time it is tried.
  const figureFailed = figure.gaveUp && !showFigure;
  // No figure to act a scene out: it has failed and isn't back yet, whether or
  // not a try of its own is still to come. Not while it first loads (the
  // scenes wait for him then), and not between tries either, so the Scenes
  // button doesn't come and go each time his figure is tried again.
  const noFigure = figure.failedOnce && !showFigure;
  const Sprite = spriteFor(loadSprite);

  // Amr's scenes cover the chat or the guide, which stays mounted under them so a
  // turn in flight goes on. They give way to a confirmation card the moment one
  // arrives (hidden, the card would still take Escape as a deny, and the turn would
  // wait on a card nobody sees), and with no figure there is no one to act them out.
  const scenesOpen = showScenes && !confirmPending && !noFigure;
  // The panel opens on the chat or the guide again, not on the scenes it closed on,
  // and the scenes don't come back once the confirmation that pushed them aside is answered.
  useEffect(() => {
    if (!open || confirmPending || noFigure) setShowScenes(false);
  }, [open, confirmPending, noFigure]);
  // A tapped scene plays with the panel closed, so he's in view. While a turn is
  // still running or a card waits, the answer is what to watch (closing the panel
  // wouldn't stop it, but would hide it): back to the chat instead, with him beside
  // the panel. The close is the panel's one way (closePanel, below), so focus
  // comes back to the opener or to him.
  const onScenePlayed = () => {
    const { streaming, pendingToolUse } = useAgentStore.getState();
    if (streaming || pendingToolUse) setShowScenes(false);
    else closePanel("scene");
  };

  // Owner signed out mid-session: drop the conversation from memory (reset
  // stops any in-flight turn; the chat panel unmounting stops nothing).
  // The other way round, a visitor's chat (memory only) never carries over
  // into the owner's: it goes, with the visitor's allowance, when they turn
  // out to be the owner (reset stops its turn here too).
  const wasOwnerRef = useRef(false);
  useEffect(() => {
    if (isOwner) {
      wasOwnerRef.current = true;
      const agent = useAgentStore.getState();
      if (agent.chatProfile === "visitor") {
        agent.reset();
        agent.setChatProfile("owner");
        agent.setVisitorQuota(null);
      }
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
      hold: (h, on) => useMascotStore.getState().setHold(h, on),
      sound: () => playMascotSound("click"),
      temperament: () => getMind().brain.temperament(),
      feel,
    });
  }
  const touchRef = useRef<ReturnType<typeof createTouchInteraction> | null>(null);
  if (!touchRef.current) {
    touchRef.current = createTouchInteraction({
      playNow: (r) => {
        if (r === "highFive") feel("highFive");
        else if (r === "patLeft" || r === "patRight") feel("pat");
        useMascotStore.getState().playNow(r);
      },
      hold: (h, on) => useMascotStore.getState().setHold(h, on),
      sound: () => playMascotSound("click"),
    });
  }
  const buttonRef = useRef<HTMLButtonElement>(null);
  const hitRef = useRef<HTMLSpanElement>(null);
  const insetProbeRef = useRef<HTMLSpanElement>(null);
  const panelRef = useRef<HTMLDivElement>(null);
  const lastTapRef = useRef(0);

  // Focus has one owner: where it goes as the panel opens (the plate for a
  // keyboard open, a view's target), the safety net while it is open, and
  // the way back to the opener (or Amr's button) when it closes.
  const panelFocus = usePanelFocus({
    open,
    openedVia,
    focusRequest,
    rootRef: panelRef,
    plateId: AMR_PANEL_TITLE_ID,
    fallbackRef: buttonRef,
  });
  // Back's own say in a close (useBackCloses, further down, once the layout
  // is known): a link followed or Back itself takes no history.back().
  const backWillClose = useRef<(reason: PanelCloseReason) => void>(() => {});
  // The one way the panel closes, whatever closes it: it tells the focus
  // owner and Back why (a link followed gets no focus back), then closes the
  // store (closeSheet clears Approve all and denies a waiting card). Safe to
  // call twice: once the panel is closed it does nothing.
  const closePanel = useCallback(
    (reason: PanelCloseReason) => {
      const agent = useAgentStore.getState();
      if (!agent.open) return;
      panelFocus.willClose(reason);
      backWillClose.current(reason);
      agent.closeSheet();
    },
    [panelFocus]
  );
  // Amr's button and Ctrl/Cmd+J: open, saying how, or close through closePanel.
  const togglePanel = useCallback(
    (via: PanelOpenVia, reason: PanelCloseReason) => {
      const agent = useAgentStore.getState();
      if (agent.open) closePanel(reason);
      else agent.openSheet({ via });
    },
    [closePanel]
  );
  // A link or a tool followed from inside the panel: no focus comes back.
  const navigateAway = useCallback(() => closePanel("navigate"), [closePanel]);
  const draggedRef = useRef(false);
  const onMascotClick = (e: ReactMouseEvent<HTMLButtonElement>) => {
    if (draggedRef.current) return; // a drag-release or a high five, not a click
    // The plate tapped while his figure is down: try it again now (the tap
    // still opens or closes the panel below).
    if (figure.down) figure.retry();
    // Where it landed: his head gets a pat, his tummy a poke. (A keyboard press is a poke.)
    const p = e.detail > 0 ? touchPoint(e, hitRef.current) : null;
    const side = p && p.x < p.box.left + p.box.width / 2 ? "left" : "right";
    // Tapped in the middle of one of his own scenes, he carries on with another of
    // its family (the ball bounced, then kicked) instead of the usual giggle.
    const shot = buttonRef.current?.querySelector<HTMLElement>("[data-amr-shot]")?.dataset.amrShot;
    const playing = sceneOfShot(shot);
    const next = playing ? followUp(playing, sceneShipped, recentlyDid()) : null;
    if (next) {
      playMascotSound("click");
      feel("played");
      did(next);
      useMascotStore.getState().playNow(sceneReaction(next));
    } else {
      clickRef.current?.onClick(p ? zoneAt(p) : "body", side);
    }
    // The first tap of a burst opens or closes the panel; the rest are play.
    // Enter or Space clicks with detail 0: a keyboard open, which the panel's
    // focus owner treats apart from a pointer's.
    const now = Date.now();
    const gap = now - lastTapRef.current;
    lastTapRef.current = now;
    if (gap > TAP_TOGGLE_GAP_MS) togglePanel(e.detail === 0 ? "keyboard" : "pointer", "toggle");
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
  // The moment chip stands beside him, wherever he's parked.
  useEffect(() => {
    useMascotStore.getState().setCorner(corner);
  }, [corner]);
  // Always the figure's height unless it can't load (no try of its own is to
  // come), so the strip doesn't jump when the plate gives way to him a moment
  // after the page settles, or while his figure is tried again. That includes
  // Data Saver: he arrives there too, on the first interaction. It stays while
  // a page field has the keyboard (he does too), so nothing shifts as one types.
  const bandSide = corner.startsWith("top") ? ("top" as const) : ("bottom" as const);
  const band = isPhone
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
    active: (isPhone || coarsePointer) && (showFigure || figureFailed || dataSaver),
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

  // How the panel sits on this screen (float, the phone's sheet, or down one
  // side of a short one) and whether a keyboard is up; the rest of what the
  // visual viewport says is written as CSS variables, not React state.
  const { layout, keyboardUp } = usePanelViewport({
    open,
    panelRef,
    buttonRef,
    probeRef: insetProbeRef,
    placed,
    phone: isPhone,
    figure: !figureFailed,
    shown: showFigure,
  });
  // In the sheet he docks in its bottom corner on his side, a phone's figure
  // and never smaller, still draggable; his chosen corner returns on close.
  const docked = open && layout === "sheet";
  const figureBox = docked ? MASCOT_BOX_PHONE : box;
  useSheetLock(docked, () => closePanel("outside"));
  // The layout his panel is open in, for the toaster: over the site header in
  // the sheet, across from him in the others (layout/app-toaster).
  const openLayout = open ? layout : null;
  useIsomorphicLayoutEffect(() => {
    if (!openLayout) return;
    const { setPanel } = useMascotStore.getState();
    setPanel(openLayout);
    return () => setPanel(null);
  }, [openLayout]);

  // Where he is drawn and how far he has stepped up, worked out with his panel's
  // place: his bubble and the moment chip follow these, not his chosen corner,
  // and so does the panel's data-amr-edge, from which the balloons in it count
  // their tails toward him. Docked, that's the sheet's bottom corner on his side.
  const drawnEdge = docked ? "bottom" : amrEdge(placed);
  const drawnLift = docked ? 0 : nudge.lift;
  useEffect(() => {
    useMascotStore.getState().setPlacement({ side: amrSide(placed), edge: drawnEdge }, drawnLift);
  }, [placed, drawnEdge, drawnLift]);

  // Moving him, by a drop, Move Amr or an arrow key: all one way. The corner
  // becomes his chosen one (not where he'd stepped aside to), and he keeps to
  // that side from now on. Where the panel (and, after a move, he) stood is
  // kept for the glide below; a drop has its own flight for him.
  const announce = useAnnounce();
  const glideRef = useRef<{ panel: DOMRect | null; amr: DOMRect | null } | null>(null);
  const moveAmr = (next: Corner, how: "drop" | "menu" | "key") => {
    const moves = next !== placed || nudge.lift !== 0;
    if (moves) {
      glideRef.current = {
        panel: panelRef.current?.getBoundingClientRect() ?? null,
        amr: how === "drop" ? null : (buttonRef.current?.getBoundingClientRect() ?? null),
      };
    }
    setCorner(next);
    // A real change, and the one X108 draws: from the bottom right where he
    // stood (where a step aside had put him counts) to the bottom left. A drop
    // waits for his landing (with reduced motion there's none to wait for);
    // Move Amr and a key have no landing, so it plays at once.
    if (placed === "bottomRight" && next === "bottomLeft") {
      if (how === "drop" && flightRef.current) cornerScene.current.pending = true;
      else playCornerScene();
    }
    resetNudge();
    setSideChosen(true);
    // Narration, not an Amr line (decision 6). A drop is seen where it lands.
    if (how !== "drop") announce(moveNote(next, moves, docked));
  };
  // The arrow keys on his focused button: up or down picks the edge, left or
  // right the side. Only bare arrows; held down, one move.
  const onMascotKeyDown = (e: ReactKeyboardEvent<HTMLButtonElement>) => {
    if (e.altKey || e.ctrlKey || e.metaKey || e.shiftKey) return;
    const next = cornerAfterKey(placed, e.key);
    if (!next) return;
    // An arrow on a button would only scroll the page under him.
    e.preventDefault();
    if (e.repeat) return;
    moveAmr(next, "key");
  };
  // The glide (FLIP): once the panel and he are drawn at the new corner, each
  // slides there from where it stood. It snaps under reduced motion (glideFrom
  // never calls animate() then).
  useIsomorphicLayoutEffect(() => {
    const from = glideRef.current;
    glideRef.current = null;
    if (!from) return;
    glideFrom(panelRef.current, from.panel);
    glideFrom(buttonRef.current, from.amr);
  }, [placed, nudge.lift]);
  // Removes the active drag's document listeners (called on pointerup, on a new
  // drag, or on unmount) so they never leak past an in-progress drag.
  const dragCleanupRef = useRef<(() => void) | null>(null);
  useEffect(() => () => dragCleanupRef.current?.(), []);
  // Moved from the bottom right to the bottom left: once he has landed, he shows
  // the corner chosen and holds it (X108), once a page. The sheet draws that one
  // move (its marker leaves the lower-right cup for the lower-left), so any other
  // drop would hold a corner the visitor didn't pick. Nothing keeps the corner
  // past this visit, so nothing in the scene says it was saved.
  const cornerScene = useRef<{ pending: boolean; playedOn: string | null }>({
    pending: false,
    playedOn: null,
  });
  const playCornerScene = () => {
    const page = window.location.pathname;
    if (cornerScene.current.playedOn === page) return;
    if (playEventScene(EVENT_SCENES.corner)) cornerScene.current.playedOn = page;
  };
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
      // After the landing, never over it.
      if (cornerScene.current.pending) {
        cornerScene.current.pending = false;
        playCornerScene();
      }
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
    // A finger on him while the composer (or another field in his panel) has
    // the keyboard: the field keeps focus, so the keyboard stays up and the
    // sheet doesn't jump. The tap still toggles and the drag still carries.
    if (panelFieldHasFocus(panelRef.current)) e.preventDefault();
    dragCleanupRef.current?.(); // tidy any prior unfinished drag
    const el = e.currentTarget;
    const start = { x: e.clientX, y: e.clientY };
    const rect = el.getBoundingClientRect();
    const offset = { x: rect.left - e.clientX, y: rect.top - e.clientY };
    const w = el.offsetWidth;
    const h = el.offsetHeight;
    // The part of the screen that can be seen, read once as the drag starts: he
    // is carried within it (never under the keyboard), and dropped into the
    // corner of the visible box nearest to where he is let go.
    const seen = measureBox(insetProbeRef.current);
    const minTop = seen.area.viewTop;
    const maxTop = seen.height - seen.area.kb - h;
    const midX = (seen.box.left + seen.width - seen.box.right) / 2;
    const midY = (seen.box.top + seen.height - seen.box.bottom) / 2;
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
        feel("carried");
      }
      if (!moved) {
        const q = touchPoint(ev, hitRef.current);
        if (q) touch?.move(q, true);
        return;
      }
      last = {
        left: Math.max(0, Math.min(seen.width - w, ev.clientX + offset.x)),
        top: Math.max(minTop, Math.min(maxTop, ev.clientY + offset.y)),
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
          if (thrown) feel("thrown");
          flightRef.current = { left: last.left, top: last.top, thrown };
          useMascotStore.getState().setHold(thrown ? "flying" : "falling", true);
        }
        // Snap from the last DRAGGED position (React batches setDragPos, so the
        // DOM rect may still read the start position here).
        const cx = last.left + w / 2;
        const cy = last.top + h / 2;
        const next = `${cy < midY ? "top" : "bottom"}${cx < midX ? "Left" : "Right"}` as Corner;
        // Dropped where the visitor wants him: the same path as Move Amr.
        // Docked in the sheet, the drop picks his side now and the edge for
        // when it closes.
        moveAmr(next, "drop");
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

  // Konami easter egg (spin + rainbow) + restore the persisted aura. Its XP
  // is the `secret:konami` outcome, paid once ever (lib/gamification/secrets).
  useEffect(() => {
    useMascotStore.getState().hydrateAppearance();
    return installKonami();
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

  // Where the browser asks before it sends motion, he offers to feel the phone:
  // once, the first time his panel closes (the visitor has met him by then).
  const wasOpenRef = useRef(false);
  useEffect(() => {
    const was = wasOpenRef.current;
    wasOpenRef.current = open;
    if (!was || open) return;
    const id = setTimeout(inviteMotion, 700);
    return () => clearTimeout(id);
  }, [open]);

  // The conversation drives the mascot through <MascotChatReactions /> (rendered
  // below), so the chat's updates re-render that null child, not this shell.
  // React to finished tool actions, for visitors and the owner alike.
  useMascotToolReactions(sceneShipped);
  // Cheer once when a rare moment plays (lib/notify/moment-scheduler.ts).
  useMascotCelebrationReactions();
  // Turned down to Quiet by the visitor: he covers his bell and settles while it lasts.
  useQuietCompanion();
  // The visitor switches the sounds off: he sleeves his tuning fork (X109), once a page.
  useMuteScene();

  // Cmd/Ctrl+J toggles, the de-facto AI-chat shortcut. In a field on the page
  // it does nothing (the key is the field's, and it can't take focus from an
  // edit), but anywhere inside the panel, its composer included, it closes it
  // (Chrome, Edge and Firefox would open Downloads instead). Only History's
  // rename field keeps it, so a name being typed isn't lost. While an input
  // method composes, the key is its own.
  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      if (!(e.metaKey || e.ctrlKey) || e.shiftKey || e.altKey) return;
      if (e.key !== "j" && e.key !== "J") return;
      if (composing(e)) return;
      const t = e.target instanceof Element ? e.target : null;
      if (t && (panelRef.current?.contains(t) ? t.closest(RENAME_FIELD) : typesInto(t))) return;
      e.preventDefault();
      // Held down: one toggle, not a flicker.
      if (e.repeat) return;
      togglePanel("keyboard", "shortcut");
    };
    window.addEventListener("keydown", handler);
    return () => window.removeEventListener("keydown", handler);
  }, [togglePanel]);

  // Escape leaves History for the chat. Focus goes to History's own button,
  // which stays as the list goes (it turns back into "Conversation history"),
  // unless it is on something outside the panel (Amr himself), which keeps it.
  const leaveHistory = useCallback(() => {
    const panel = panelRef.current;
    const held = document.activeElement;
    if (panel && (!held || held === document.body || panel.contains(held))) {
      panel.querySelector<HTMLElement>(HISTORY_BUTTON)?.focus({ preventScroll: true });
    }
    setShowHistory(false);
  }, []);
  // Escape, in one order (design §1.3 item 10), wherever the panel takes it:
  //   0. an input method composing: its own (it ends the composition);
  //   1. one a field inside the panel has used (the tool finder's search
  //      clearing itself, History's rename field cancelling): the field's;
  //   2. a card waiting for the OK: denied (the card has no Escape of its own);
  //   3. History: back to the chat;
  //   4. otherwise the panel closes.
  // Every step it takes calls preventDefault, so nothing else acts on it too.
  const panelEscape = useCallback(
    (e: KeyboardEvent) => {
      if (e.key !== "Escape" || composing(e) || e.defaultPrevented) return;
      const agent = useAgentStore.getState();
      if (!agent.open) return;
      e.preventDefault();
      if (agent.pendingToolUse) agent.pendingToolUse.resolve(false);
      else if (showHistory) leaveHistory();
      else closePanel("escape");
    },
    [showHistory, leaveHistory, closePanel]
  );
  // The panel takes Escape from inside it through its own onKeyDown (below),
  // after the fields in it have had theirs. Outside it, only an Escape meant
  // for it: with nothing focused, or on Amr or the header's opener. A page
  // field's or overlay's stays theirs: the panel floats over the tool page,
  // not as a modal.
  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => {
      const t = e.target;
      if (t instanceof Node && panelRef.current?.contains(t)) return; // its onKeyDown's
      if (t instanceof Element && t !== document.body && !t.closest(PANEL_OPENERS)) return;
      panelEscape(e);
    };
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, [open, panelEscape]);

  // The phone's Back closes the sheet (lib/agent/mascot/use-back-closes), and
  // leaves History first: a CloseWatcher where the browser has one, else a
  // history marker that a close by any other way takes back out.
  const back = useBackCloses({
    open,
    sheet: layout === "sheet",
    inHistory: showHistory,
    onBack: () => closePanel("back"),
    onLeaveHistory: leaveHistory,
  });
  backWillClose.current = back.willClose;

  // What the views inside the panel may ask of it. A link followed closes it,
  // as a page change does, with no focus brought back, and while Back's
  // marker is the newest history entry its page takes the marker's place
  // (replaceOnNavigate); a view's first focus target goes to the focus
  // owner; the layout tells the views how the panel sits (the phone's sheet,
  // a short screen's side panel).
  const panelContext = useMemo<AmrPanelContextValue>(
    () => ({
      layout,
      onNavigate: navigateAway,
      replaceOnNavigate: back.replaceOnNavigate,
      registerInitialFocus: panelFocus.registerInitialFocus,
    }),
    [layout, navigateAway, back.replaceOnNavigate, panelFocus]
  );

  // The panel's tail points at his figure: none while the launcher stands in for
  // him, while he's carried (the panel stays at his corner until the drop,
  // then glides), while a keyboard is up (the panel has moved above it, away
  // from him), or in the phone's sheet (he is docked inside it). Down the side
  // of a short screen it is on the edge facing him, level with his middle.
  // Its growth point stays on showFigure, so the card doesn't move while he
  // steps aside and still matches where he comes back.
  const cornerTail =
    layout === "sheet" || keyboardUp
      ? null
      : panelTail(placed, { phone: isPhone, figure: showFigure, dragging: dragPos !== null });
  const tail =
    cornerTail && layout === "side"
      ? {
          tail: amrSide(placed),
          from: amrEdge(placed),
          at: sideTailAt(placed, figureBox.h, nudge.lift, isPhone),
        }
      : cornerTail && {
          tail: cornerTail.tail,
          from: cornerTail.from,
          // Its near side, so its tip lands on his centre line: half the tail's
          // width short of it, counted inside the panel's line.
          at: `calc(${cornerTail.at}px - 0.4rem - var(--panel-w))`,
        };
  // Docked in the sheet: the views keep a gutter and a footer clear of him,
  // or of the launcher plate while it stands in for him.
  const dock = docked ? dockInsets(placed, showFigure) : null;
  const size = PANEL_SIZE[panelSize.size];
  const panelStyle: StyleWithVars = {
    ...(layout === "sheet"
      ? {
          ...sheetPlace(),
          "--amr-panel-width": "auto",
          "--amr-panel-height": "auto",
        }
      : layout === "side"
        ? sidePlace(placed, isPhone, !figureFailed)
        : {
            // Its place is the figure's whenever one is coming, as the phone
            // band's is, so an open panel doesn't jump when the plate gives way
            // to him, or as his figure is tried again (until then it stands
            // where he will). Only a figure that can't load, with no try left,
            // puts it back by the plate.
            ...panelPos(placed, !figureFailed, box.h, isPhone, nudge.lift, panelSize.size),
            // Its size, read by its w-/h- classes: as variables, a layout rule
            // in CSS can still replace them, which an inline width or height
            // would beat.
            "--amr-panel-width": size.width,
            "--amr-panel-height": size.height,
          }),
    // The entrance grows from where the tail meets the panel (the sheet slides
    // up from its edge instead).
    "--panel-origin":
      layout === "side"
        ? `${amrSide(placed) === "right" ? "100%" : "0%"} ${amrEdge(placed) === "top" ? "0%" : "100%"}`
        : panelOrigin(placed, { phone: isPhone, figure: showFigure }),
    ...(tail && { "--tail-at": tail.at }),
    // The gutter and footer from the inner frame (its line and padding off).
    ...(dock && {
      "--amr-dock-gutter": `calc(${dock.gutter}px - var(--panel-w) - 0.375rem)`,
      "--amr-dock-footer": `calc(${dock.footer}px - var(--panel-w) - 0.375rem)`,
    }),
  };
  // His button, docked: where usePanelViewport says, or, until its first
  // reading, the sheet's bottom corner at rest.
  const dockAt = dockedButtonPos(
    placed,
    { left: BUTTON_SIDE, right: BUTTON_SIDE, bottom: VISIBLE_GAP },
    showFigure
  );
  const dockSide = amrSide(placed);
  const dockStyle: CSSProperties = {
    position: "fixed",
    bottom: `var(--amr-dock-bottom, calc(${dockAt.bottom}px + env(safe-area-inset-bottom, 0px)))`,
    [dockSide]: `var(--amr-dock-inline, calc(${dockAt[dockSide] ?? 0}px + env(safe-area-inset-${dockSide}, 0px)))`,
  };

  return (
    <>
      <MascotChatReactions />
      {open && (
        // The dialog takes Escape from inside it (panelEscape) in a React
        // handler, so the fields in it, React handlers too, have had theirs
        // first; a native listener on it would run before them.
        // eslint-disable-next-line jsx-a11y/no-noninteractive-element-interactions
        <div
          ref={panelRef}
          id={AMR_PANEL_ID}
          data-agent-sheet-root
          data-vt-hold="amr-panel"
          role="dialog"
          aria-labelledby={AMR_PANEL_TITLE_ID}
          aria-modal={false}
          onKeyDown={(e) => panelEscape(e.nativeEvent)}
          data-tail={tail?.tail ?? "none"}
          data-tail-from={tail?.from}
          data-amr-side={amrSide(placed)}
          // Where he is drawn: the sheet's bottom while docked (drawnEdge).
          data-amr-edge={drawnEdge}
          data-amr-layout={layout}
          // Docked in the sheet: the side his gutter is on (the views read it).
          // data-amr-compact is written by usePanelViewport, not here.
          data-amr-dock={dock?.side}
          style={panelStyle}
          className={cn(
            "group/amr panel comic-tailed fixed z-50 flex h-[var(--amr-panel-height)] w-[var(--amr-panel-width)] flex-col bg-card shadow-xl",
            // Compact, it starts over the sticky site header (z-header), so it
            // takes the header's own layer: MascotAssistant comes after the
            // Header in app-shell's tree, so at the same z-index it paints over
            // it, and the nav drawer (101, 102), toasts and menus stay above.
            "data-[amr-compact]:z-header",
            styles.panelEnter
          )}
        >
          {/* The frame clips its contents here, not on the dialog, so the tail
              can stand outside it; the padding keeps every focus ring clear of
              the clip. */}
          <div className="flex min-h-0 flex-1 flex-col overflow-hidden rounded-[inherit] p-1.5">
            <PanelChrome>
              <AmrPanelContext.Provider value={panelContext}>
                <PanelHeader
                  plateId={AMR_PANEL_TITLE_ID}
                  // The step the shell knows; a view fills its own as it moves on.
                  subtitle={
                    settled ? (isOwner ? PANEL_SUBTITLE.owner : PANEL_SUBTITLE.guide) : undefined
                  }
                  shortcut={shortcutLabel("J")}
                  controls={
                    // No figure, no one to act a scene out; a confirmation waiting comes first.
                    !noFigure && (
                      <PanelIconButton
                        label="Amr's scenes"
                        title={
                          confirmPending
                            ? "Scenes, once the action is confirmed or denied"
                            : "Scenes"
                        }
                        aria-pressed={scenesOpen}
                        disabled={confirmPending}
                        onClick={() => {
                          setShowScenes(!scenesOpen);
                          setShowHistory(false);
                        }}
                      >
                        <Clapperboard aria-hidden="true" />
                      </PanelIconButton>
                    )
                  }
                  // Move Amr, first in the More menu: the corner he's drawn in is checked.
                  move={{ corner: placed, onMove: (c) => moveAmr(c, "menu") }}
                  // The tilt switch, labelled, in the header's More menu.
                  tilt={
                    motionAvailable
                      ? { on: feelsMotion, onToggle: () => void toggleMotion() }
                      : undefined
                  }
                  enlarged={panelSize.enlarged}
                  // Only the floating card has two sizes: the sheet and the
                  // side panel fill the room they are given.
                  onToggleEnlarge={layout === "float" ? panelSize.toggle : undefined}
                  // Under 360 px, New chat moves from the owner's icons into More.
                  onNewChat={
                    narrow && settled && isOwner
                      ? () => {
                          // Stops an answer under way too (the store's reset aborts the turn).
                          useAgentStore.getState().reset();
                          setShowHistory(false);
                        }
                      : undefined
                  }
                  onClose={() => closePanel("close-button")}
                />
                {/* The strip's ground: the page's paper, so card balloons stand
                    out. In compact mode it is the one scroller, so with the
                    keyboard up nothing is clipped: the log keeps a floor and
                    the footer its height, and this scrolls past them. */}
                <div
                  data-amr-scroll=""
                  className="flex min-h-0 flex-1 flex-col bg-bg group-data-[amr-compact]/amr:overflow-y-auto group-data-[amr-compact]/amr:overscroll-contain"
                >
                  {/* A crash in the body (or its code not loading) stops here,
                      not at the app shell's boundary, which would replace the
                      page: a narration caption takes the body's place, under
                      the header, so Close and Move Amr still work. A new
                      person (auth settling, signing in or out) starts afresh.
                      Amr's scenes are in the body too, so a crash there stops
                      here as well. */}
                  <ErrorBoundary
                    key={!settled ? "settling" : isOwner ? "owner" : "visitor"}
                    name="Amr's panel"
                    fallback={(_error, tryAgain) => (
                      <PanelFailed
                        onNewChat={
                          isOwner
                            ? () => {
                                // A saved reply that crashes when drawn goes with the old chat.
                                // The new chat shows, out from under History and the scenes.
                                useAgentStore.getState().reset();
                                setShowHistory(false);
                                setShowScenes(false);
                                tryAgain();
                              }
                            : undefined
                        }
                      />
                    )}
                  >
                    {scenesOpen && <ScenesTab onPlay={onScenePlayed} />}
                    {/* Under the scenes the chat or guide stays mounted (a turn in flight goes on),
                        hidden, and knows it; otherwise `contents` keeps its layout exactly as before. */}
                    <ChatVisibleContext.Provider value={!scenesOpen}>
                      <div hidden={scenesOpen} className={scenesOpen ? "hidden" : "contents"}>
                        {!settled ? (
                          <PanelLoading />
                        ) : isOwner ? (
                          <OwnerBody
                            load={loadOwnerPanel}
                            showHistory={showHistory}
                            // History and the scenes take turns.
                            onToggleHistory={() => {
                              setShowHistory((v) => !v);
                              setShowScenes(false);
                            }}
                            // New chat (or a thread picked in History) shows the chat,
                            // out from under the scenes too.
                            onCloseHistory={() => {
                              setShowHistory(false);
                              setShowScenes(false);
                            }}
                          />
                        ) : (
                          <div className="min-h-0 flex-1">
                            <LazyVisitorBody
                              ai={visitorAi}
                              onNavigate={navigateAway}
                              note={unverified ? <UnverifiedOwnerNote /> : undefined}
                            />
                          </div>
                        )}
                      </div>
                    </ChatVisibleContext.Provider>
                  </ErrorBoundary>
                </div>
              </AmrPanelContext.Provider>
            </PanelChrome>
          </div>
        </div>
      )}

      {/* What he says beside himself, outside the chat. It waits while a page
          field has a phone's keyboard; he stays. */}
      <MascotBubble waiting={pageFieldFocus} />

      {/* The screen's safe areas: the sides for stepping aside to the other
          side (readSideInsets), all four for the visible box (measureBox). */}
      <span
        ref={insetProbeRef}
        aria-hidden="true"
        data-amr-inset-probe
        className="pointer-events-none invisible fixed left-0 top-0 h-0 w-0"
        style={SAFE_AREA_PROBE_STYLE}
      />

      {/* How to move him without dragging, as his button's description.
          hidden, not sr-only: a description is still read from a hidden
          element, and browse mode doesn't read it a second time as loose text. */}
      <span id={MOVE_HINT_ID} hidden>
        {MOVE_HINT}
      </span>

      {/* Floating mascot — click to toggle the chat. Never unmounted: on a
          phone he stays on the page while its fields have the keyboard. */}
      <button
        ref={buttonRef}
        data-vt-hold="amr"
        data-amr-button
        type="button"
        onClick={onMascotClick}
        onKeyDown={onMascotKeyDown}
        onPointerDown={onPointerDown}
        onPointerEnter={reachForAmr}
        onTouchStart={reachForAmr}
        onFocus={reachForAmr}
        onContextMenu={(e) => showFigure && e.preventDefault()}
        // One name in every state (the panel has its own Close button);
        // aria-expanded carries the state, and aria-controls names the panel
        // only while it is in the page.
        aria-label={LAUNCHER_LABEL}
        aria-expanded={open}
        aria-controls={open ? AMR_PANEL_ID : undefined}
        aria-keyshortcuts="Control+J Meta+J"
        aria-describedby={MOVE_HINT_ID}
        title="Ask Amr · drag him, or use the arrow keys, to move him"
        // Until his figure is in, and while it can't load: the launcher plate.
        data-launcher={showFigure ? undefined : ""}
        // Docked in the phone's sheet (usePanelViewport places him).
        data-amr-docked={docked ? "" : undefined}
        style={{
          ...(dragPos
            ? { position: "fixed", left: dragPos.left, top: dragPos.top }
            : docked
              ? dockStyle
              : buttonPos(placed, showFigure, figureBox.h, isPhone, nudge.lift)),
          // The plate's box, as amr-geometry has it (larger text grows it).
          ...(!showFigure && { minWidth: LAUNCHER_PLATE.w, minHeight: LAUNCHER_PLATE.h }),
        }}
        className={cn(
          // Lifted with his compact panel (usePanelViewport marks both); he
          // comes after it in the page, so he still stands over the sheet.
          "z-50 cursor-pointer data-[amr-compact]:z-header",
          !dragPos && styles.bob,
          // The figure's box is mostly transparent: let clicks there
          // reach the page, and take them only on the figure (below). Focus
          // is drawn on the figure too (styles.figure), not around the box.
          showFigure && [styles.figure, "pointer-events-none"],
          // His name, lettered on a plate in the comic's ink (globals.css):
          // never a likeness of him, and never round. A finger on it carries
          // it, as one on his figure does, rather than scrolling the page.
          !showFigure && "comic-name-plate touch-none select-none"
        )}
      >
        {!showFigure && LAUNCHER_LABEL}
        {showFigure && (
          <span
            ref={hitRef}
            aria-hidden="true"
            data-mascot-hit
            className="pointer-events-auto absolute z-10 select-none"
            style={{
              ...hitBox(figureBox),
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
            {/* A figure that crashes, or whose code can't load, stops here:
                the plate takes his place (FigureFailed), and he is tried
                again from there. The page and his panel carry on. */}
            <ErrorBoundary
              name="Amr's figure"
              fallback={() => <FigureFailed onFailed={figure.fail} />}
            >
              <Suspense fallback={null}>
                <Sprite
                  width={figureBox.w}
                  height={figureBox.h}
                  moveRef={buttonRef}
                  onLoadError={figure.fail}
                />
              </Suspense>
            </ErrorBoundary>
          </div>
        )}
      </button>
    </>
  );
}
