"use client";

/**
 * Extended presence hook for the canvas tool.
 *
 * Wraps the underlying Supabase channel like {@link usePresence}, but the
 * "self" payload is a `SimplePresence` with optional cursor/viewport/
 * selection/tool fields. The publishing client throttles cursor updates
 * to ~60ms (~16 fps cursor) to stay under Supabase's 10-events/sec budget
 * while still feeling smooth.
 *
 * Returns the live member list AND a `publish()` function the canvas
 * calls on every pointermove / camera change.
 */

import { useEffect, useRef, useState } from "react";
import { getSupabaseClient, isRealtimeAvailable } from "@/lib/realtime/supabase-client";
import type { SimplePresence } from "@/lib/realtime/use-presence";
import { throttle, type Throttled } from "@/lib/utils/throttle";

const AVATAR_COLORS = ["#00f0ff", "#a78bfa", "#34d399", "#f59e0b", "#f87171", "#60a5fa", "#fb923c", "#e879f9"];

function colorFor(seed: string): string {
  let hash = 0;
  for (let i = 0; i < seed.length; i++) hash = (seed.charCodeAt(i) + hash * 31) | 0;
  return AVATAR_COLORS[Math.abs(hash) % AVATAR_COLORS.length];
}

export interface CanvasPresenceHook {
  members: SimplePresence[];
  publish: (patch: Partial<Omit<SimplePresence, "id">>) => void;
  /** Self identity used in publish — exposed for cursor color rendering. */
  self: { id: string; name: string; color: string };
}

const CURSOR_THROTTLE_MS = 60;

export function useCanvasPresence(channelName: string | null, hint?: Partial<SimplePresence>): CanvasPresenceHook {
  const [members, setMembers] = useState<SimplePresence[]>([]);

  // Self identity — stable across renders. crypto.randomUUID falls back to
  // a Math.random shim if the global isn't present (older SSR contexts).
  const selfRef = useRef<{ id: string; name: string; color: string } | null>(null);
  if (!selfRef.current) {
    const id = hint?.id ?? (typeof crypto !== "undefined" && crypto.randomUUID ? crypto.randomUUID() : Math.random().toString(36).slice(2));
    const name = hint?.name ?? "Anonymous";
    const color = hint?.color ?? colorFor(name);
    selfRef.current = { id, name, color };
  }
  const self = selfRef.current;

  const stateRef = useRef<SimplePresence>({ ...self });
  const trackRef = useRef<((p: SimplePresence) => Promise<unknown>) | null>(null);
  const throttledTrackRef = useRef<Throttled<[SimplePresence]> | null>(null);

  useEffect(() => {
    if (!channelName || !isRealtimeAvailable()) return;
    const supabase = getSupabaseClient();
    if (!supabase) return;

    const channel = supabase.channel(channelName, {
      config: { presence: { key: self.id } },
    });

    channel
      .on("presence", { event: "sync" }, () => {
        const state = channel.presenceState<SimplePresence>();
        const list: SimplePresence[] = [];
        for (const key of Object.keys(state)) {
          const metas = state[key];
          const first = Array.isArray(metas) ? metas[0] : undefined;
          if (first && typeof first === "object" && typeof first.id === "string") {
            list.push(first as SimplePresence);
          }
        }
        setMembers(list);
      })
      .subscribe(async (status) => {
        if (status === "SUBSCRIBED") {
          trackRef.current = (p) => channel.track(p);
          await channel.track(stateRef.current);
        }
      });

    // Throttle outbound track() calls so a 60fps cursor only sends ~16/sec.
    throttledTrackRef.current = throttle((p: SimplePresence) => {
      void trackRef.current?.(p);
    }, CURSOR_THROTTLE_MS);

    return () => {
      throttledTrackRef.current?.cancel();
      throttledTrackRef.current = null;
      trackRef.current = null;
      void channel.untrack();
      void channel.unsubscribe();
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [channelName]);

  const publish = (patch: Partial<Omit<SimplePresence, "id">>) => {
    stateRef.current = { ...stateRef.current, ...patch };
    // Bypass throttle ONLY when the patch carries no cursor — selection/
    // tool/viewport changes are infrequent and the user expects them to
    // feel instant. When a cursor IS present (with or without other
    // fields), we throttle so a 60fps move doesn't blow the 10-event/sec
    // Supabase budget. If trackRef hasn't been initialised yet (pre-
    // SUBSCRIBED), drop the publish silently; the next call after
    // subscription completes lands fine.
    if (!trackRef.current) return;
    if (patch.cursor !== undefined) {
      throttledTrackRef.current?.(stateRef.current);
    } else {
      void trackRef.current(stateRef.current);
    }
  };

  return { members, publish, self };
}
