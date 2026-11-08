"use client";

import { useSyncExternalStore } from "react";
import { usePathname } from "next/navigation";
import { Toaster } from "@/components/ui/sonner";
import { isComicRoute } from "@/lib/comics/entry";
import { PHONE_MEDIA_QUERY } from "@/lib/layout/breakpoints";

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

/** /comics: at the top, below the header, the notch and Amr's top band. */
export const COMICS_OFFSET: Offset = {
  top: "calc(8px + var(--header-h, 56px) + var(--amr-band-top, 0px) + env(safe-area-inset-top, 0px))",
  ...SIDES,
};

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

/** The props for the app's toast stack on this route and screen. */
export function toasterLayout(pathname: string | null, phone: boolean): Partial<ToasterProps> {
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
 * bottom-centre 24 px up on larger screens, at the top under /comics.
 * Toasts can be swiped away; the policy (lib/notify/policy.ts) decides which
 * get a close button. Its z-index (the `toast` token, below modals) and the
 * rule that lifts it over an open dialog live in globals.css.
 */
export function AppToaster() {
  const pathname = usePathname();
  const phone = useIsPhone();
  return <Toaster {...toasterLayout(pathname, phone)} />;
}
