"use client";

import { useEffect } from "react";
import { useEmotionStore } from "@/lib/stores/emotion-store";
import { bootFromStore, installWindowBridge, reresolve } from "./engine";
import { useActivityMoodSensor } from "./use-mood";

/**
 * EmotionProvider — rehydrates the emotion store, installs the window bridge,
 * wires the activity sensor, and bridges reduced-motion/store changes into
 * live re-resolution of the active mood.
 */
export function EmotionProvider({ children }: { children: React.ReactNode }) {
  useEffect(() => {
    // Zustand persist.rehydrate may return void on sync stores or Promise<void>
    // on async hydration — Promise.resolve normalizes the call.
    void Promise.resolve(useEmotionStore.persist.rehydrate()).then(() => {
      installWindowBridge();
      bootFromStore();
    });

    // Re-resolve when the store changes (user toggles enabled, changes override, etc.)
    const unsub = useEmotionStore.subscribe(() => reresolve());

    // Re-resolve when reduced-motion preference changes at the OS level
    let mq: MediaQueryList | null = null;
    const onChange = () => reresolve();
    if (typeof window !== "undefined") {
      try {
        mq = window.matchMedia("(prefers-reduced-motion: reduce)");
        mq.addEventListener("change", onChange);
      } catch {
        mq = null;
      }
    }

    return () => {
      unsub();
      if (mq) mq.removeEventListener("change", onChange);
    };
  }, []);

  useActivityMoodSensor(true);

  return <>{children}</>;
}
