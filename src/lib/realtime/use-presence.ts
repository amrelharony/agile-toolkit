"use client";

import { useEffect, useState } from "react";
import { getSupabaseClient, isRealtimeAvailable } from "./supabase-client";

export interface SimplePresence {
  id: string;
  name: string;
  color: string;
}

const AVATAR_COLORS = ["#00f0ff", "#a78bfa", "#34d399", "#f59e0b", "#f87171", "#60a5fa", "#fb923c", "#e879f9"];

function randomColor(seed: string): string {
  let hash = 0;
  for (let i = 0; i < seed.length; i++) hash = (seed.charCodeAt(i) + hash * 31) | 0;
  return AVATAR_COLORS[Math.abs(hash) % AVATAR_COLORS.length];
}

export function usePresence(channelName: string | null, self?: Partial<SimplePresence>): SimplePresence[] {
  const [members, setMembers] = useState<SimplePresence[]>([]);

  useEffect(() => {
    if (!channelName || !isRealtimeAvailable()) return;
    const supabase = getSupabaseClient();
    if (!supabase) return;

    const channel = supabase.channel(channelName, {
      config: { presence: { key: self?.id ?? crypto.randomUUID() } },
    });
    const isPresence = (v: unknown): v is SimplePresence =>
      !!v &&
      typeof v === "object" &&
      typeof (v as SimplePresence).id === "string" &&
      typeof (v as SimplePresence).name === "string" &&
      typeof (v as SimplePresence).color === "string";
    channel
      .on("presence", { event: "sync" }, () => {
        const state = channel.presenceState<SimplePresence>();
        const list: SimplePresence[] = [];
        for (const key of Object.keys(state)) {
          const metas = state[key];
          const first = Array.isArray(metas) ? metas[0] : undefined;
          if (isPresence(first)) list.push(first);
        }
        setMembers(list);
      })
      .subscribe(async (status) => {
        // Until SUBSCRIBED, track() is a no-op. Without this call we listen
        // to other clients' presence but never publish our own — meaning
        // every "real-time multiplayer" tool in the suite would silently
        // show this user as missing to peers.
        if (status === "SUBSCRIBED") {
          const me: SimplePresence = {
            id: self?.id ?? crypto.randomUUID(),
            name: self?.name ?? "Anonymous",
            color: self?.color ?? randomColor(self?.name ?? "anon"),
          };
          await channel.track(me);
        }
      });

    return () => {
      void channel.untrack();
      void channel.unsubscribe();
    };
    // self is intentionally excluded from deps — callers usually pass an
    // inline object that re-creates each render. Re-subscribing on every
    // identity change would thrash. Channel name acts as the room key.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [channelName]);

  return members;
}
