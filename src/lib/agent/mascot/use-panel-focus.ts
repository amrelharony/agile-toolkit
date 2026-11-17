/**
 * The one owner of focus in Amr's chat panel (design §1.3 item 10). Views
 * never call focus() when they mount: each offers its first target (the
 * composer) through AmrPanelContext.registerInitialFocus, or marks it with
 * `data-autofocus`, and this hook decides where focus goes.
 *
 * Opening:
 *   - A keyboard open (Enter or Space on Amr, the header's opener, Ctrl/Cmd+J)
 *     puts focus on the name plate (an h2 with tabIndex -1) at once, so while
 *     a lazy chunk loads it never sits on <body>. When the view's target
 *     arrives, focus moves on to it; a view with none (the tool finder,
 *     History) leaves it on the plate.
 *   - A pointer or touch open leaves focus where it is. Only a view's target
 *     takes it, and the chat offers its composer only on a fine pointer (see
 *     useInitialFocus), so a tap never raises a phone's keyboard.
 *   - A target is read when it registers and, for `data-autofocus`, whenever
 *     the panel's content changes, until one appears.
 *   - Focus that someone placed wins: a control inside the panel holding it
 *     (the History button, the consent card's text), a field on the page the
 *     visitor moved to, or the page itself after a click away from the panel.
 *     Only <body>, the plate (this hook's own resting place) and the opener,
 *     until the visitor acts, are free for a target to take.
 *   - The dialog and the log are never focused.
 *
 * Asked again: a key press on the header's opener while the panel is already
 * open (the store's focusRequest) brings focus in, to the view's target, or
 * the plate when there is none or it would raise a phone's keyboard. Focus
 * already inside stays. That opener becomes the one closing returns to. A
 * pointer press asks nothing: focus stays where the press put it.
 *
 * Closing (closePanel(reason) in mascot-assistant, which says why first):
 *   - "navigate": nothing comes back; the next page takes focus.
 *   - Any other reason: when focus was left inside the panel (and so falls to
 *     <body> as it goes) it returns to the opener, the element that held it
 *     when the panel opened, or to Amr's button when there was none or it has
 *     gone. Focus already elsewhere (Amr's own button after a toggle, a page
 *     field) stays. Never into a text field on a touch screen, where it would
 *     raise the keyboard: Amr's button instead.
 *
 * Safety net: while the panel is open, focus that falls from inside it to
 * <body> (a control that removed itself, say) goes to the plate, unless a
 * pointer put it there (a click on nothing, inside the panel or out). Chrome
 * reports the fall as a focusout; Firefox, Safari and jsdom report nothing,
 * so a removal is also caught from the panel's own DOM changes.
 *
 * React and the DOM only, so the mascot chunk carries it at no cost.
 */

import { useEffect, useLayoutEffect, useMemo, useRef, type RefObject } from "react";
import type { PanelOpenVia } from "@/lib/agent/store";

/** Why the panel closed, said to the focus owner before it does. */
export type PanelCloseReason =
  /** Escape, once nothing inside the panel took it. */
  | "escape"
  /** The panel's own Close button. */
  | "close-button"
  /** Amr's button pressed again. */
  | "toggle"
  /** Ctrl/Cmd+J. */
  | "shortcut"
  /** A link or a tool was followed: the next page takes focus, nothing is restored. */
  | "navigate"
  /** Something outside the panel closed it (another surface opening over it). */
  | "outside"
  /** The phone's Back, on the full-height sheet. */
  | "back"
  /** A scene picked in the Scenes tab: the panel steps aside so he's in view. */
  | "scene";

/** The attribute a view may put on its first target instead of registering it. */
export const AUTOFOCUS_ATTR = "data-autofocus";

export interface PanelFocusOptions {
  /** Whether the panel is open (the store's `open`). */
  open: boolean;
  /** How the latest open came (the store's `openedVia`); null when no opener said. */
  openedVia: PanelOpenVia | null;
  /** The store's `focusRequest`: each change while open brings focus into the panel. */
  focusRequest: number;
  /** The panel's dialog element. */
  rootRef: RefObject<HTMLElement | null>;
  /** The id of the name plate (the dialog's title, tabIndex -1). */
  plateId: string;
  /** Where focus returns without an opener: Amr's own button. */
  fallbackRef: RefObject<HTMLElement | null>;
}

export interface PanelFocus {
  /**
   * A view's first target (null when it goes). For AmrPanelContext; stable,
   * so the context and the views' effects never change because of it.
   */
  registerInitialFocus(el: HTMLElement | null): void;
  /** Says why the panel is about to close; call it just before the store closes. */
  willClose(reason: PanelCloseReason): void;
}

/** A layout effect in the browser, a plain one on the server (no SSR warning). */
const useIsomorphicLayoutEffect = typeof window === "undefined" ? useEffect : useLayoutEffect;

function onTouchScreen(): boolean {
  return window.matchMedia?.("(pointer: coarse)").matches === true;
}

/** Input types that raise no keyboard when they take focus. */
const KEYLESS_INPUTS = /^(?:button|checkbox|color|file|image|radio|range|reset|submit)$/;

/** A field that raises a phone's keyboard when it takes focus. */
function typesText(el: HTMLElement): boolean {
  if (el.isContentEditable || el.tagName === "TEXTAREA") return true;
  return el.tagName === "INPUT" && !KEYLESS_INPUTS.test((el as HTMLInputElement).type);
}

/** Focus fell to the page: nothing (or <body>) holds it. */
function onPage(el: Element | null): boolean {
  return !el || el === document.body;
}

interface FocusState {
  /** Open and watched: the listeners are on. */
  live: boolean;
  via: PanelOpenVia | null;
  /** What held focus when the panel opened (never inside it, never <body>). */
  opener: HTMLElement | null;
  /** The view's registered target. */
  target: HTMLElement | null;
  /** Why the panel is closing, said by closePanel just before. */
  reason: PanelCloseReason | null;
  /** No target has taken focus yet since the panel opened. */
  awaiting: boolean;
  /** The visitor has acted since the panel opened: a pointer down, or focus moved by them. */
  touched: boolean;
  /** The last pointer down landed outside the panel, and focus hasn't come back inside since. */
  pointerOutside: boolean;
  /** A pointer went down in this task: a focus loss now is the visitor's click. */
  pointerNow: boolean;
  /** Focus is inside the panel, as far as the events said. */
  inside: boolean;
  /** What this hook just focused: its focusin is not the visitor's move. */
  expected: Element | null;
}

export function usePanelFocus(options: PanelFocusOptions): PanelFocus {
  const latest = useRef(options);
  latest.current = options;
  const state = useRef<FocusState>({
    live: false,
    via: null,
    opener: null,
    target: null,
    reason: null,
    awaiting: false,
    touched: false,
    pointerOutside: false,
    pointerNow: false,
    inside: false,
    expected: null,
  });

  // What the effect and the views both call, made once: everything reads refs.
  const api = useMemo(() => {
    const s = state.current;

    const root = () => latest.current.rootRef.current;
    const plate = (): HTMLElement | null => {
      const panel = root();
      const el = document.getElementById(latest.current.plateId);
      return panel && el && panel.contains(el) ? el : null;
    };

    const focusOn = (el: HTMLElement, preventScroll: boolean) => {
      s.expected = el;
      el.focus({ preventScroll });
    };

    /** Whether a target may take focus from `el`, the element that holds it now. */
    const free = (el: Element | null): boolean => {
      // Fallen to the page: free, unless the visitor clicked away from the panel.
      if (onPage(el)) return !s.pointerOutside;
      if (el === plate()) return true;
      return el === s.opener && !s.touched;
    };

    /** The view's target: the registered one, or a `data-autofocus` element. */
    const candidate = (): HTMLElement | null => {
      const panel = root();
      if (!panel) return null;
      const t = s.target;
      if (t && t.isConnected && panel.contains(t)) return t;
      return panel.querySelector<HTMLElement>(`[${AUTOFOCUS_ATTR}]`);
    };

    /** Focus the target if there is one and focus is free; a keyboard open waits on the plate. */
    const place = () => {
      if (!s.live) return;
      const now = document.activeElement;
      if (!free(now)) return;
      const el = candidate();
      if (el) {
        s.awaiting = false;
        if (now !== el) focusOn(el, false);
        return;
      }
      const p = plate();
      if (s.via === "keyboard" && p && now !== p) focusOn(p, true);
    };

    /** A key press on an opener while the panel is open: bring focus in. */
    const summon = () => {
      const panel = root();
      const now = document.activeElement;
      if (!s.live || !panel || (now && panel.contains(now))) return;
      // Closing comes back to the control that asked.
      if (now instanceof HTMLElement && !onPage(now)) s.opener = now;
      s.via = "keyboard";
      const el = candidate();
      if (el && !(onTouchScreen() && typesText(el))) {
        s.awaiting = false;
        focusOn(el, false);
        return;
      }
      const p = plate();
      if (p) focusOn(p, true);
    };

    /** The safety net: focus fell from inside the panel to the page. */
    const rescue = () => {
      if (!s.live || !s.inside || !onPage(document.activeElement)) return;
      const p = plate();
      if (p) focusOn(p, true);
    };

    /** On close: back to the opener, or Amr's button, unless focus is already somewhere. */
    const restore = (reason: PanelCloseReason | null) => {
      if (reason === "navigate" || !onPage(document.activeElement)) return;
      const touch = onTouchScreen();
      for (const el of [s.opener, latest.current.fallbackRef.current]) {
        if (!el || !el.isConnected || (touch && typesText(el))) continue;
        el.focus({ preventScroll: true });
        if (document.activeElement === el) return;
      }
    };

    return {
      place,
      summon,
      rescue,
      restore,
      registerInitialFocus(el: HTMLElement | null) {
        s.target = el;
        if (el) place();
      },
      willClose(reason: PanelCloseReason) {
        s.reason = reason;
      },
    };
  }, []);

  const { open } = options;
  const wasOpen = useRef(false);
  useIsomorphicLayoutEffect(() => {
    const s = state.current;
    if (!open) {
      // Runs after the panel has left the page, so focus that was inside it
      // has already fallen to <body>.
      if (!wasOpen.current) return;
      wasOpen.current = false;
      const reason = s.reason;
      s.reason = null;
      api.restore(reason);
      return;
    }
    wasOpen.current = true;
    const root = latest.current.rootRef.current;
    if (!root) return;

    const held = document.activeElement;
    s.live = true;
    s.via = latest.current.openedVia;
    s.opener = held instanceof HTMLElement && !onPage(held) && !root.contains(held) ? held : null;
    s.reason = null;
    s.awaiting = true;
    s.touched = false;
    s.pointerOutside = false;
    s.pointerNow = false;
    s.inside = false;
    s.expected = null;

    let rescueTimer: number | undefined;
    let pointerTimer: number | undefined;
    const rescueSoon = () => {
      // After React's own effects, which may place focus themselves (a step
      // that focuses its note); rescue() checks again before it moves anything.
      if (rescueTimer === undefined)
        rescueTimer = window.setTimeout(() => {
          rescueTimer = undefined;
          api.rescue();
        }, 0);
    };

    const onPointer = (e: Event) => {
      s.touched = true;
      s.pointerOutside = !(e.target instanceof Node && root.contains(e.target));
      // A click moves focus during its own pointerdown or mousedown (a touch's
      // comes after the finger lifts, with its mousedown), so the flag lasts
      // to the end of this task only.
      s.pointerNow = true;
      window.clearTimeout(pointerTimer);
      pointerTimer = window.setTimeout(() => {
        s.pointerNow = false;
      }, 0);
    };
    const onFocusIn = (e: FocusEvent) => {
      s.inside = e.target instanceof Node && root.contains(e.target);
      // Back inside the panel: an earlier click away no longer means the page holds focus.
      if (s.inside) s.pointerOutside = false;
      if (e.target !== s.expected) s.touched = true;
      s.expected = null;
    };
    const onFocusOut = (e: FocusEvent) => {
      if (e.relatedTarget) return; // to another element: its focusin says where
      if (s.pointerNow && e.target instanceof Node && e.target.isConnected) {
        // A click on nothing, inside the panel or out: the visitor put focus
        // on the page, and it stays there.
        s.inside = false;
        return;
      }
      // The focused control went (Chrome says so), code blurred it, or the
      // window lost focus (then it is still on its element, and rescue() leaves it).
      rescueSoon();
    };
    const observer =
      typeof MutationObserver === "function"
        ? new MutationObserver(() => {
            if (!s.live) return;
            if (s.inside && onPage(document.activeElement)) rescueSoon();
            else if (s.awaiting && !s.touched) api.place();
          })
        : null;

    document.addEventListener("pointerdown", onPointer, true);
    document.addEventListener("mousedown", onPointer, true);
    document.addEventListener("focusin", onFocusIn, true);
    root.addEventListener("focusout", onFocusOut);
    observer?.observe(root, { childList: true, subtree: true });

    api.place();

    return () => {
      s.live = false;
      document.removeEventListener("pointerdown", onPointer, true);
      document.removeEventListener("mousedown", onPointer, true);
      document.removeEventListener("focusin", onFocusIn, true);
      root.removeEventListener("focusout", onFocusOut);
      observer?.disconnect();
      window.clearTimeout(rescueTimer);
      window.clearTimeout(pointerTimer);
    };
  }, [open, api]);

  // Asked again while open (after the effect above, so the panel is live).
  const { focusRequest } = options;
  const lastRequest = useRef(focusRequest);
  useIsomorphicLayoutEffect(() => {
    if (focusRequest === lastRequest.current) return;
    lastRequest.current = focusRequest;
    api.summon();
  }, [focusRequest, api]);

  return useMemo(
    () => ({ registerInitialFocus: api.registerInitialFocus, willClose: api.willClose }),
    [api]
  );
}
