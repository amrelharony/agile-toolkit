"use client";

import { useEffect, useRef } from "react";
import dynamic from "next/dynamic";
import { MonitorPlay, X } from "lucide-react";
import { create } from "zustand";
import { Button } from "@/components/ui/button";

// Facilitator Timers' soundboard dock: loaded the first time someone
// presents, and shown only when it was turned on there.
const SoundboardDock = dynamic(() => import("./soundboard-dock").then((m) => m.SoundboardDock), {
  ssr: false,
});

/**
 * Presentation mode, for running a ceremony on a shared screen.
 *
 * "Present" (on every tool page) goes fullscreen where the browser allows
 * it and sets `data-presenting` on <html>: type grows (globals.css), and
 * everything marked `data-chrome` — the app header, the sidebar, insights,
 * related tools — is hidden so the tool fills the screen. XP celebrations
 * stay quiet (gamification provider). The docked timer and the mascot stay.
 * Escape, leaving fullscreen, or the "Exit" button ends it.
 *
 * Below `sm` the Exit button is a 44 px icon (its name stays for screen
 * readers). Below `sm` and on any touch screen, where the button is 44 px
 * tall, a strip above the page keeps it off the tool's title.
 */
export const usePresentation = create<{ presenting: boolean; set: (on: boolean) => void }>(
  (set) => ({ presenting: false, set: (on) => set({ presenting: on }) })
);

export function startPresenting(): void {
  usePresentation.getState().set(true);
  const el = document.documentElement;
  if (el.requestFullscreen && !document.fullscreenElement) {
    void el.requestFullscreen().catch(() => {
      /* not allowed here — presenting still works without fullscreen */
    });
  }
}

export function stopPresenting(): void {
  usePresentation.getState().set(false);
  if (document.fullscreenElement && document.exitFullscreen) {
    void document.exitFullscreen().catch(() => {});
  }
}

/** The "Present" button in a tool's header. */
export function PresentButton() {
  return (
    <Button type="button" variant="outline" size="sm" onClick={startPresenting}>
      <MonitorPlay aria-hidden="true" />
      Present
    </Button>
  );
}

/** Mounted once in the shell: applies the mode and offers the way out. */
export function PresentationController() {
  const presenting = usePresentation((s) => s.presenting);
  const exitRef = useRef<HTMLButtonElement>(null);

  useEffect(() => {
    const root = document.documentElement;
    if (presenting) root.dataset.presenting = "true";
    else delete root.dataset.presenting;
    return () => {
      delete root.dataset.presenting;
    };
  }, [presenting]);

  useEffect(() => {
    if (!presenting) return;
    // Leaving fullscreen (Esc in most browsers) ends presenting too.
    let wasFullscreen = Boolean(document.fullscreenElement);
    const onFullscreen = () => {
      if (wasFullscreen && !document.fullscreenElement) usePresentation.getState().set(false);
      wasFullscreen = Boolean(document.fullscreenElement);
    };
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape" && !document.fullscreenElement) usePresentation.getState().set(false);
    };
    document.addEventListener("fullscreenchange", onFullscreen);
    document.addEventListener("keydown", onKey);
    return () => {
      document.removeEventListener("fullscreenchange", onFullscreen);
      document.removeEventListener("keydown", onKey);
    };
  }, [presenting]);

  if (!presenting) return null;
  return (
    <>
      {/* A strip for the fixed button wherever it can be 44 px tall (top-3 +
          2.75rem = h-14), so it never sits over the tool's title: below sm,
          and on touch screens of any width (landscape phones, tablets), where
          Button sm is sized for touch. Mouse screens from sm up don't get it,
          so desktop is unchanged. */}
      <div
        aria-hidden="true"
        data-exit-strip
        className="hidden h-14 shrink-0 max-sm:block pointer-coarse:block"
      />
      <Button
        ref={exitRef}
        type="button"
        size="sm"
        variant="outline"
        onClick={stopPresenting}
        className="fixed right-3 top-3 z-[95] bg-card/90 backdrop-blur max-sm:size-11 max-sm:px-0"
      >
        <X aria-hidden="true" />
        {/* Icon-only on phones; screen readers still hear the whole name. */}
        <span className="max-sm:sr-only">Exit presentation</span>{" "}
        <span className="sr-only">(Escape)</span>
      </Button>
      <SoundboardDock />
    </>
  );
}
