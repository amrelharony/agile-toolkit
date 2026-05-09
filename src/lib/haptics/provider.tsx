"use client";

import { useEffect } from "react";
import { useHapticsStore } from "@/lib/stores/haptics-store";
import { registerSuppressionListeners } from "./gate";
import { detectSupport, fire } from "./engine";
import { toast } from "sonner";

/**
 * HapticsProvider — rehydrates the store, registers global suppression listeners,
 * and shows the one-time welcome toast.  Render inside SonificationProvider.
 */
export function HapticsProvider({ children }: { children: React.ReactNode }) {
  useEffect(() => {
    // Rehydrate then check whether to show the welcome toast.
    // We do this imperatively (not via a subscribe handler) because:
    //   • subscribe fires only on *changes*, missing the initial hydrated state.
    //   • the one-time toast only needs a single check after rehydration.
    let cancelled = false;
    let toastTimer: number | undefined;
    registerSuppressionListeners();

    void (async () => {
      await useHapticsStore.persist.rehydrate();
      if (cancelled) return;

      const state = useHapticsStore.getState();
      if (state.welcomeToastShown || !state.enabled) return;

      // Delay the welcome toast slightly so it doesn't race the first paint —
      // users notice it more when the UI has settled.
      toastTimer = window.setTimeout(() => {
        if (cancelled) return;
        const support = detectSupport();
        const msg =
          support === "vibrate"
            ? "Haptics on — tap anything to feel the feedback. Adjust in Settings."
            : "Haptic-style feedback on — your device shows subtle visual pulses instead of vibration.";
        toast.success(msg, { duration: 6000 });
        useHapticsStore.getState().markWelcomeShown();
        fire("success", { force: true });
      }, 1500);
    })();

    return () => {
      cancelled = true;
      if (toastTimer !== undefined) window.clearTimeout(toastTimer);
    };
  }, []);

  return <>{children}</>;
}
