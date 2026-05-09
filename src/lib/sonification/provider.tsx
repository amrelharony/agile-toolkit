"use client";

import { createContext, useCallback, useContext, useEffect, useMemo, useState } from "react";
import { destroyEngine, getEngine } from "./engine";
import { useMousePan } from "./use-mouse-pan";
import { useScrollFilter } from "./use-scroll-filter";
import { SonificationEventRouter } from "./event-router";
import { useSonificationStore } from "@/lib/stores/sonification-store";
import type { SonificationPrefs } from "./types";

interface SonificationContextValue {
  ready: boolean;
  reducedMotion: boolean;
  prefs: SonificationPrefs;
  /** Force an AudioContext resume/init. Must be called from a user gesture. */
  kick: () => void;
}

const SonificationContext = createContext<SonificationContextValue | null>(null);

function prefersReducedMotion(): boolean {
  if (typeof window === "undefined") return false;
  try {
    return window.matchMedia("(prefers-reduced-motion: reduce)").matches;
  } catch {
    return false;
  }
}

export function SonificationProvider({ children }: { children: React.ReactNode }) {
  const [mounted, setMounted] = useState(false);
  const [reducedMotion, setReducedMotion] = useState(false);
  const prefs = useSonificationStore();

  useEffect(() => {
    useSonificationStore.persist.rehydrate();
    setMounted(true);
    setReducedMotion(prefersReducedMotion());
    if (typeof window === "undefined") return;
    try {
      const mq = window.matchMedia("(prefers-reduced-motion: reduce)");
      const handler = (e: MediaQueryListEvent) => setReducedMotion(e.matches);
      mq.addEventListener("change", handler);
      return () => mq.removeEventListener("change", handler);
    } catch {
      return;
    }
  }, []);

  const gated =
    prefs.enabled && !(prefs.respectReducedMotion && reducedMotion);

  // Ambient listeners only need to run when audio is gated on.
  useMousePan(gated);
  useScrollFilter(gated);

  // Keep engine master volume in sync with prefs.
  useEffect(() => {
    if (!gated) return;
    getEngine().setMasterVolume(prefs.masterVolume);
  }, [gated, prefs.masterVolume]);

  // First-gesture unlocker: ensure the AudioContext exists the moment the user
  // interacts anywhere on the page — required by browsers' autoplay policies.
  // Use { once: true } so the listeners detach after the first gesture; a
  // persistent listener would run ensureContext()/resume() on every click for
  // the life of the session.  If the context later suspends (tab backgrounded),
  // the visibilitychange handler below handles the re-resume.
  useEffect(() => {
    if (!mounted) return;
    if (typeof window === "undefined") return;
    const unlock = () => {
      const engine = getEngine();
      const ctx = engine.ensureContext();
      if (ctx && ctx.state === "suspended") void engine.resume();
    };
    window.addEventListener("pointerdown", unlock, { passive: true, once: true });
    window.addEventListener("keydown", unlock, { passive: true, once: true });
    return () => {
      window.removeEventListener("pointerdown", unlock);
      window.removeEventListener("keydown", unlock);
    };
  }, [mounted]);

  // Resume context when tab becomes visible again.
  useEffect(() => {
    if (!gated) return;
    if (typeof document === "undefined") return;
    const onVis = () => {
      if (document.visibilityState === "visible") {
        void getEngine().resume();
      }
    };
    document.addEventListener("visibilitychange", onVis);
    return () => document.removeEventListener("visibilitychange", onVis);
  }, [gated]);

  // Tear down on unmount (e.g., HMR) so old contexts don't accumulate.
  useEffect(() => {
    return () => {
      destroyEngine();
    };
  }, []);

  const kick = useCallback(() => {
    const engine = getEngine();
    engine.ensureContext();
    void engine.resume();
  }, []);

  const value = useMemo<SonificationContextValue>(
    () => ({ ready: mounted, reducedMotion, prefs, kick }),
    [mounted, reducedMotion, prefs, kick]
  );

  return (
    <SonificationContext.Provider value={value}>
      <SonificationEventRouter enabled={gated} />
      {children}
    </SonificationContext.Provider>
  );
}

export function useSonificationContext(): SonificationContextValue {
  const ctx = useContext(SonificationContext);
  if (!ctx) {
    // Called outside the provider — return a safe stub so tools don't crash.
    return {
      ready: false,
      reducedMotion: false,
      prefs: useSonificationStore.getState(),
      kick: () => undefined,
    };
  }
  return ctx;
}
