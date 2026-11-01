"use client";

import { usePathname } from "next/navigation";
import { Toaster } from "@/components/ui/sonner";
import { isComicRoute } from "@/lib/comics/entry";

/**
 * The app-wide toast stack: bottom-right (full width along the bottom on
 * phones). Someone reading a comic has panels and story controls where a
 * first visit's welcome and achievement toasts would cover them — and
 * sonner pauses its timers while hovered, so they can sit there and swallow
 * taps. Under /comics the stack moves to the top.
 */
export function AppToaster() {
  const pathname = usePathname();
  return <Toaster position={isComicRoute(pathname) ? "top-center" : "bottom-right"} />;
}
