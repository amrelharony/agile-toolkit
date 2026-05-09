"use client";

import { useEffect, useMemo, useRef, useState, type RefObject } from "react";
import type { Mood, MoodProfile, MoodResolution } from "./types";
import { getCurrentMood, onMoodChange, pushMoodSignal } from "./engine";
import { moodScrollReveal } from "./gsap";
import type { MoodScrollRevealOptions } from "./gsap";

/**
 * Subscribe to the active mood.  Returns the full resolution so callers can
 * see which source won and read the profile directly.
 */
export function useMood(): MoodResolution {
  const [state, setState] = useState<MoodResolution>(() => getCurrentMood());
  useEffect(() => {
    return onMoodChange((res) => setState(res));
  }, []);
  return state;
}

/** Convenience — just the profile, memo-stable for Framer-motion consumers. */
export function useMoodProfile(): MoodProfile {
  const { profile } = useMood();
  return useMemo(() => profile, [profile]);
}

/** Just the active mood name — useful for className variants. */
export function useActiveMood(): Mood {
  return useMood().active;
}

/**
 * Scroll-reveal hook: attach a ref to any element and it'll fade/slide in
 * when it enters the viewport using the current mood's easing curve at the
 * moment of mount.  Options are snapshot once — pass a stable config.
 */
export function useMoodScrollReveal<T extends HTMLElement = HTMLDivElement>(
  options: MoodScrollRevealOptions = {},
): RefObject<T | null> {
  const ref = useRef<T | null>(null);
  // Snapshot options on first render; changing them at runtime does not
  // re-run the reveal (GSAP tweens are one-shot scroll triggers).
  const snapshotRef = useRef(options);

  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    let killed = false;
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    let tween: any = null;

    void moodScrollReveal(el, snapshotRef.current).then((t) => {
      if (killed) {
        t?.scrollTrigger?.kill?.();
        t?.kill?.();
        return;
      }
      tween = t;
    });

    return () => {
      killed = true;
      tween?.scrollTrigger?.kill?.();
      tween?.kill?.();
    };
  }, []);

  return ref;
}

/**
 * Activity-sensor hook — infers mood from the cadence of pointer/key events.
 * A burst of rapid interactions → Energetic; long idle → Calm.  Signals are
 * pushed with low confidence so they stay beneath weather/webcam.
 */
export function useActivityMoodSensor(enabled = true) {
  useEffect(() => {
    if (!enabled) return;
    if (typeof window === "undefined") return;

    let events = 0;
    let lastBurst = 0;
    let idleTimer: ReturnType<typeof setTimeout> | null = null;

    const kickIdle = () => {
      if (idleTimer) clearTimeout(idleTimer);
      idleTimer = setTimeout(() => {
        pushMoodSignal("activity", "Calm", {
          confidence: 0.3,
          ttlMs: 90_000,
        });
      }, 60_000);
    };

    const onActivity = () => {
      // Every interaction resets the idle timer — previously only
      // pointermove did this, which meant a user actively clicking but not
      // moving the mouse would be wrongly classified as Calm.
      kickIdle();

      events += 1;
      const now = performance.now();
      if (now - lastBurst > 5_000) {
        lastBurst = now;
        events = 1;
        return;
      }
      if (events > 25) {
        pushMoodSignal("activity", "Energetic", {
          confidence: 0.35,
          ttlMs: 20_000,
        });
        events = 0;
      }
    };

    window.addEventListener("pointerdown", onActivity, { passive: true });
    window.addEventListener("keydown", onActivity, { passive: true });
    window.addEventListener("pointermove", kickIdle, { passive: true });
    window.addEventListener("wheel", kickIdle, { passive: true });
    kickIdle();

    return () => {
      window.removeEventListener("pointerdown", onActivity);
      window.removeEventListener("keydown", onActivity);
      window.removeEventListener("pointermove", kickIdle);
      window.removeEventListener("wheel", kickIdle);
      if (idleTimer) clearTimeout(idleTimer);
    };
  }, [enabled]);
}
