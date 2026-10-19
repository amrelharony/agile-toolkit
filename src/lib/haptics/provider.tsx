"use client";

import { useEffect } from "react";
import { useHapticsStore } from "@/lib/stores/haptics-store";
import { registerSuppressionListeners, unregisterSuppressionListeners } from "./gate";

/**
 * HapticsProvider — rehydrates the store and registers global suppression
 * listeners. Render inside SonificationProvider.
 */
export function HapticsProvider({ children }: { children: React.ReactNode }) {
  useEffect(() => {
    // No welcome toast: a "Haptics on" pop-up 1.5 s into a first visit was
    // the first thing new visitors saw, before they had done anything.
    registerSuppressionListeners();
    void useHapticsStore.persist.rehydrate();

    return () => {
      // Detach the global capture-phase scroll/input listeners registered
      // above. The whole provider tree unmounts on bare routes (sign-out,
      // /guest), so without this the listeners outlived the provider (and
      // the `listenersRegistered` flag stayed stuck true). engine.fire()
      // re-registers lazily on the next haptic, so this is safe.
      unregisterSuppressionListeners();
    };
  }, []);

  return <>{children}</>;
}
