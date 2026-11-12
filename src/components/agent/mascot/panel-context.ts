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
 *
 * It also holds the class names a view uses to follow the panel's compact
 * mode and the docked Amr (below), read off the panel's own attributes.
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

/*
 * What the views read off the panel's root (a `group/amr`), as class names, so
 * a keyboard rising never re-renders a view:
 *   data-amr-compact  compact mode (a phone's keyboard is up, or little room),
 *                     written by the shell's viewport reading
 *   data-amr-dock     the side Amr is docked on in the phone's sheet; the
 *                     root's --amr-dock-gutter and --amr-dock-footer say how
 *                     much room he needs, from the inner frame's edge
 * And what the views mark for the shell's sheet CSS (globals.css "AMR SHEET"):
 *   data-amr-scroll   a scroller: in the sheet it pans up and down and keeps
 *                     its scrolling to itself
 *   data-amr-composer the chat's message box: docked Amr rides the keyboard
 *                     beside it while it has focus
 */

/** Chrome that waits while the panel is compact: status lines, usage, follow-ups. */
export const COMPACT_HIDDEN = "group-data-[amr-compact]/amr:hidden";

/** A log's floor in compact mode, where the panel's ground scrolls instead. */
export const COMPACT_LOG = "group-data-[amr-compact]/amr:min-h-[3rem]";

/**
 * A footer (the composer's row) flush with the panel's inner frame: its own
 * padding on Amr's side gives way to his gutter while he is docked, and it is
 * at least as tall as he is, so he stands beside it, never over the log.
 */
export const DOCK_FOOTER =
  "group-data-[amr-dock=right]/amr:pr-[var(--amr-dock-gutter)] group-data-[amr-dock=left]/amr:pl-[var(--amr-dock-gutter)] group-data-[amr-dock]/amr:min-h-[var(--amr-dock-footer)]";

/** DOCK_FOOTER for a footer inside a view's px-3: that padding already counts toward the gutter. */
export const DOCK_FOOTER_IN_PX3 =
  "group-data-[amr-dock=right]/amr:pr-[calc(var(--amr-dock-gutter)-0.75rem)] group-data-[amr-dock=left]/amr:pl-[calc(var(--amr-dock-gutter)-0.75rem)] group-data-[amr-dock]/amr:min-h-[var(--amr-dock-footer)]";

/** A scroller that runs to the panel's bottom (no footer): room at its end, so its last row scrolls clear of docked Amr. */
export const DOCK_END = "group-data-[amr-dock]/amr:pb-[var(--amr-dock-footer)]";

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
