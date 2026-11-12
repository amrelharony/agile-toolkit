/**
 * What a view inside Amr's chat panel may ask of the panel around it.
 *
 *   layout                how the panel sits: a card beside Amr ("float"), the
 *                         phone's full-height sheet ("sheet") or the short
 *                         landscape panel down one side ("side")
 *   onNavigate            a link in the view was followed: close the panel the
 *                         way a page change closes it (no focus restore)
 *   replaceOnNavigate     the panel's own Back marker is the newest history
 *                         entry, so a link should replace it, not stack on it
 *   registerInitialFocus  the element focus goes to when the panel opens (the
 *                         composer, a search); a view registers it instead of
 *                         calling focus() in its own mount effect, and the
 *                         panel's focus owner (lib/agent/mascot/use-panel-focus)
 *                         decides whether it takes focus. useInitialFocus
 *                         below does this for a text field.
 *
 * Runtime-free on purpose: React only, no store or agent code, so every view
 * and the mascot chunk can read it at no cost. Without a provider a view gets
 * the safe default below: a floating panel whose onNavigate does nothing, and
 * whose registered target takes focus at once, since there is no focus owner
 * around it to place it. The shell (mascot-assistant) gives the real panel's:
 * its layout, its close for a link, and replaceOnNavigate from the phone
 * sheet's Back (lib/agent/mascot/use-back-closes).
 */

import { createContext, useContext, useEffect, type RefObject } from "react";

export type AmrPanelLayout = "float" | "sheet" | "side";

export interface AmrPanelContextValue {
  layout: AmrPanelLayout;
  onNavigate(): void;
  replaceOnNavigate: boolean;
  registerInitialFocus(el: HTMLElement | null): void;
}

const nothing = () => {};

/**
 * No panel around the view: a floating card, onNavigate does nothing, and a
 * registered target takes focus at once (no focus owner would place it).
 */
export const NO_AMR_PANEL: AmrPanelContextValue = Object.freeze({
  layout: "float",
  onNavigate: nothing,
  replaceOnNavigate: false,
  registerInitialFocus: (el: HTMLElement | null) => el?.focus(),
});

export const AmrPanelContext = createContext<AmrPanelContextValue>(NO_AMR_PANEL);
AmrPanelContext.displayName = "AmrPanelContext";

/** The panel around this view, or the safe default when there is none. */
export function useAmrPanel(): AmrPanelContextValue {
  return useContext(AmrPanelContext);
}

/** A touch screen: a field taking focus there raises the keyboard. */
function onTouchScreen(): boolean {
  return window.matchMedia?.("(pointer: coarse)").matches === true;
}

/**
 * Offers a text field (the composer) as this view's first target, when it
 * mounts, to the panel's focus owner, and withdraws it when it goes. Only on
 * a fine pointer (or none): on a touch screen the field would raise the
 * keyboard over the panel before anyone chose to type, so the view offers
 * nothing there and focus stays where the open left it.
 *
 * `offered` is false while the view is mounted but hidden (under Amr's
 * scenes): it is withdrawn then, and offered again as the view shows, so the
 * focus owner places it as on an open, where focus is free to take.
 */
export function useInitialFocus(ref: RefObject<HTMLElement | null>, offered = true): void {
  const { registerInitialFocus } = useAmrPanel();
  useEffect(() => {
    if (!offered || onTouchScreen()) return;
    registerInitialFocus(ref.current);
    return () => registerInitialFocus(null);
  }, [ref, registerInitialFocus, offered]);
}
