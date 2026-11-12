"use client";

import { useSyncExternalStore } from "react";
import { usePathname } from "next/navigation";
import { Toaster } from "@/components/ui/sonner";
import { isComicRoute } from "@/lib/comics/entry";
import { PHONE_MEDIA_QUERY } from "@/lib/layout/breakpoints";
import { AMR_TOAST_ROOM_VAR, AMR_TOAST_TOP_VAR } from "@/lib/layout/amr-sheet";
import {
  useMascotStore,
  type MascotPanelLayout,
  type MascotPlacement,
} from "@/lib/agent/mascot/store";

type ToasterProps = React.ComponentProps<typeof Toaster>;
type Offset = NonNullable<ToasterProps["offset"]>;

/** Side gutters: 8 px, or the notch / rounded corner when that is wider. */
const SIDES = {
  left: "max(8px, env(safe-area-inset-left, 0px))",
  right: "max(8px, env(safe-area-inset-right, 0px))",
};

/**
 * Phones: just above Amr's band. `--amr-band-bottom` already includes the
 * home-indicator inset; before Amr publishes it, the inset alone.
 */
export const PHONE_OFFSET: Offset = {
  bottom: "calc(8px + var(--amr-band-bottom, env(safe-area-inset-bottom, 0px)))",
  ...SIDES,
};

/** Larger screens: bottom-centre, clear of every corner Amr can be dragged to. */
export const DESKTOP_OFFSET: Offset = { bottom: "24px", ...SIDES };

/**
 * /comics: at the top, below the header and Amr's top band. `--header-h`
 * already counts the notch (the header's row plus the top safe area), so the
 * inset is not added again.
 */
export const COMICS_OFFSET: Offset = {
  top: "calc(8px + var(--header-h, 56px) + var(--amr-band-top, 0px))",
  ...SIDES,
};

/**
 * Amr's chat open as the phone's full-height sheet, which fills the screen
 * from just under the header: the stack goes over the site header, from the
 * notch down (8 px without one). A toast there is one row no taller than the
 * header's 56 px row (globals.css "AMR SHEET" trims its padding around a
 * 44 px Undo), so it ends above the sheet's own header. Compact (a keyboard
 * up, or little room), the sheet itself starts over the site header, so the
 * stack goes just under the sheet's one header row instead, where the panel
 * publishes it (--amr-toast-top, counted from the sheet's own top, so an iOS
 * pan down to the field moves it too).
 */
export const SHEET_OFFSET: Offset = {
  top: `var(${AMR_TOAST_TOP_VAR}, max(8px, env(safe-area-inset-top, 0px)))`,
  ...SIDES,
};

/** Sonner's own toast width, px: the most a toast takes beside the side panel. */
const TOAST_W = 356;

/**
 * Beside the side panel: no wider than the room the panel leaves on the other
 * side (--amr-toast-room, published only when a toast fits there; with less,
 * the policy holds what can wait, and what can't keeps sonner's width).
 */
export const SIDE_TOAST_STYLE = {
  "--width": `min(${TOAST_W}px, var(${AMR_TOAST_ROOM_VAR}, ${TOAST_W}px))`,
} as React.CSSProperties;

/** Where Amr's chat panel is open: its layout, and the side and edge he is drawn on. */
export interface AmrPanelSpot extends MascotPlacement {
  layout: MascotPanelLayout;
}

function subscribePhone(onChange: () => void): () => void {
  if (typeof window === "undefined" || !window.matchMedia) return () => undefined;
  const mq = window.matchMedia(PHONE_MEDIA_QUERY);
  mq.addEventListener?.("change", onChange);
  return () => mq.removeEventListener?.("change", onChange);
}

function readPhone(): boolean {
  if (typeof window === "undefined" || !window.matchMedia) return false;
  return window.matchMedia(PHONE_MEDIA_QUERY).matches;
}

/** Phone-width viewport (≤639 px), kept in sync with resizes. */
function useIsPhone(): boolean {
  return useSyncExternalStore(subscribePhone, readPhone, () => false);
}

/**
 * The props for the app's toast stack on this route and screen, with Amr's
 * chat panel open (`amr`) or not (null).
 */
export function toasterLayout(
  pathname: string | null,
  phone: boolean,
  amr: AmrPanelSpot | null = null
): Partial<ToasterProps> {
  if (amr?.layout === "sheet") {
    // The sheet covers both ends of the screen below the header: one toast
    // at a time, over the header. (The policy holds what can wait meanwhile.)
    return {
      position: "top-center",
      offset: SHEET_OFFSET,
      mobileOffset: SHEET_OFFSET,
      swipeDirections: ["top", "left", "right"],
      visibleToasts: 1,
    };
  }
  if (amr) {
    // The floating card or the side panel stands by him: the corner across
    // from his, at the other edge and on the other side.
    const y = amr.edge === "top" ? "bottom" : "top";
    const x = amr.side === "left" ? "right" : "left";
    const offset = y === "top" ? COMICS_OFFSET : phone ? PHONE_OFFSET : DESKTOP_OFFSET;
    return {
      position: `${y}-${x}`,
      offset,
      mobileOffset: offset,
      swipeDirections: [y, x],
      visibleToasts: phone ? 2 : 3,
      // Down the side of a short screen the panel spans it top to bottom: the
      // stack keeps to the strip beside it.
      ...(amr.layout === "side" && { style: SIDE_TOAST_STYLE }),
    };
  }
  if (isComicRoute(pathname)) {
    // Someone reading a comic has panels and story controls at the bottom,
    // and sonner pauses its timers while hovered, so a toast could sit there
    // and swallow taps. Under /comics the stack moves to the top.
    return {
      position: "top-center",
      offset: COMICS_OFFSET,
      mobileOffset: COMICS_OFFSET,
      swipeDirections: ["top", "left", "right"],
      visibleToasts: phone ? 2 : 3,
    };
  }
  // The same object goes to `offset` and `mobileOffset`: sonner switches to
  // `mobileOffset` below its own 600 px cut-off, which isn't our breakpoint.
  const offset = phone ? PHONE_OFFSET : DESKTOP_OFFSET;
  return {
    position: "bottom-center",
    offset,
    mobileOffset: offset,
    swipeDirections: ["left", "right", "bottom"],
    visibleToasts: phone ? 2 : 3,
  };
}

/**
 * The app-wide toast stack. Bottom-centre and above Amr's band on phones,
 * bottom-centre 24 px up on larger screens, at the top under /comics. While
 * Amr's chat panel is open it keeps off the panel: over the site header in the
 * phone's sheet (under its header row while compact), in the corner across
 * from him otherwise, in the strip beside the side panel (the mascot store's
 * `panel` and `placed`, and what the panel publishes on <html>). Toasts can be
 * swiped away; the policy (lib/notify/policy.ts) decides which get a close
 * button, and holds what can wait while the panel leaves no room. Its z-index
 * (the `toast` token, below modals) and the rule that lifts it over an open
 * dialog live in globals.css.
 */
export function AppToaster() {
  const pathname = usePathname();
  const phone = useIsPhone();
  const layout = useMascotStore((s) => s.panel);
  const placed = useMascotStore((s) => s.placed);
  return <Toaster {...toasterLayout(pathname, phone, layout && { layout, ...placed })} />;
}
