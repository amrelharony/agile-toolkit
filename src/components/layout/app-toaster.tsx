"use client";

import { usePathname } from "next/navigation";
import { Toaster } from "@/components/ui/sonner";
import { isComicRoute } from "@/lib/comic/agile-at-work";

/**
 * The app-wide toast stack: bottom-right (full width along the bottom on
 * phones). The comic reader fills the viewport and keeps its page controls
 * (Prev/Next, the scrubber, fullscreen, Download) at the bottom, where a
 * first visit's welcome and achievement toasts would cover them — and
 * sonner pauses its timers while hovered, so they can sit there and swallow
 * clicks. On that route the stack moves to the top.
 */
export function AppToaster() {
  const pathname = usePathname();
  return <Toaster position={isComicRoute(pathname) ? "top-center" : "bottom-right"} />;
}
