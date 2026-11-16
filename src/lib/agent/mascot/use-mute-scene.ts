"use client";

/**
 * Make room for silence (X109, EVENT_SCENES.mute): when the visitor switches the
 * interface sounds off themselves (the header's speaker, the user menu, or
 * Settings › Notifications, which all set the sound store), he sleeves his
 * tuning fork and holds it still, once a page. The sound is already off by then:
 * the scene follows the mute, never stands in for it, and makes no sound itself.
 * With reduced motion the engine shows its last beat, still.
 *
 * Only a change the visitor makes counts: not the stored choice arriving while
 * the store rehydrates (on load, or when Settings reads it again).
 */

import { useEffect } from "react";
import { usePathname } from "next/navigation";
import { EVENT_SCENES } from "@/components/agent/mascot/engine/scenes";
import { useSonificationStore } from "@/lib/stores/sonification-store";
import { playEventScene } from "./event-scenes";

type SoundStore = typeof useSonificationStore;

/** Whether this change is the visitor switching sound off now. */
export function isMute(
  s: { enabled: boolean },
  prev: { enabled: boolean },
  hydrated: boolean
): boolean {
  return hydrated && prev.enabled && !s.enabled;
}

/** Answer the first mute on this page. Returns the unsubscribe. */
export function watchMute(
  store: SoundStore = useSonificationStore,
  play: () => boolean = () => playEventScene(EVENT_SCENES.mute)
): () => void {
  let played = false;
  return store.subscribe((s, prev) => {
    if (played || !isMute(s, prev, store.persist?.hasHydrated?.() ?? true)) return;
    played = play();
  });
}

export function useMuteScene(): void {
  const path = usePathname();
  // A new page, a fresh once.
  useEffect(() => watchMute(), [path]);
}
