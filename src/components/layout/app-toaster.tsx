"use client";

import { Toaster } from "@/components/ui/sonner";
import { useReaderPageStore } from "@/lib/stores/reader-page-store";

/**
 * The app-wide toast stack: bottom-right (full width along the bottom on
 * phones). A reader page (the private comic, see
 * lib/stores/reader-page-store) fills the viewport and keeps its page
 * controls (Prev/Next, the scrubber, fullscreen) at the bottom, where a
 * first visit's welcome and achievement toasts would cover them — and
 * sonner pauses its timers while hovered, so they can sit there and swallow
 * clicks. While one is mounted the stack moves to the top.
 */
export function AppToaster() {
  const onReaderPage = useReaderPageStore((s) => s.title !== null);
  return <Toaster position={onReaderPage ? "top-center" : "bottom-right"} />;
}
