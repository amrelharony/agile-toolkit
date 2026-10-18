"use client";

import { useEffect, useRef } from "react";
import { MonitorPlay, X } from "lucide-react";
import { create } from "zustand";
import { Button } from "@/components/ui/button";

/**
 * Presentation mode, for running a ceremony on a shared screen.
 *
 * "Present" (on every tool page) goes fullscreen where the browser allows
 * it and sets `data-presenting` on <html>: type grows (globals.css), and
 * everything marked `data-chrome` — the app header, the sidebar, insights,
 * related tools — is hidden so the tool fills the screen. XP celebrations
 * stay quiet (gamification provider). The docked timer and the mascot stay.
 * Escape, leaving fullscreen, or the "Exit" button ends it.
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
    <Button
      ref={exitRef}
      type="button"
      size="sm"
      variant="outline"
      onClick={stopPresenting}
      className="fixed right-3 top-3 z-[95] bg-card/90 backdrop-blur"
    >
      <X aria-hidden="true" />
      Exit presentation
      <span className="sr-only"> (Escape)</span>
    </Button>
  );
}
