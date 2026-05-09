"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import type { RealtimeChannel } from "@supabase/supabase-js";
import { getSupabaseClient, isRealtimeAvailable } from "./supabase-client";
import { nanoid } from "nanoid";
import { emitRtEvent } from "@/lib/sonification/emit";

export interface PresenceMember {
  id: string;
  name: string;
  color: string;
  joinedAt: string;
}

export interface UseRoomResult<T> {
  state: T;
  setState: (updater: T | ((prev: T) => T)) => void;
  members: PresenceMember[];
  isConnected: boolean;
  isLocalOnly: boolean;
  roomId: string | null;
  userId: string;
  broadcast: (event: string, payload: unknown) => void;
  subscribeToEvent: (event: string, handler: (payload: unknown) => void) => () => void;
}

const COLORS = ["#00f0ff", "#a855f7", "#f472b6", "#facc15", "#34d399", "#fb923c", "#60a5fa", "#f87171"];

function assignColor(userId: string): string {
  let hash = 0;
  for (let i = 0; i < userId.length; i++) hash = (hash * 31 + userId.charCodeAt(i)) >>> 0;
  return COLORS[hash % COLORS.length];
}

function getOrCreateUser(): { id: string; name: string } {
  if (typeof window === "undefined") return { id: "ssr", name: "Guest" };
  const key = "agile-toolkit:user";
  try {
    const existing = localStorage.getItem(key);
    if (existing) return JSON.parse(existing) as { id: string; name: string };
  } catch {
    /* fall through */
  }
  const fresh = { id: nanoid(10), name: `Player ${Math.floor(Math.random() * 900 + 100)}` };
  try {
    localStorage.setItem(key, JSON.stringify(fresh));
  } catch {
    /* localStorage full or unavailable */
  }
  return fresh;
}

export function useRoom<T>(toolId: string, roomId: string | null, initialState: T): UseRoomResult<T> {
  const [state, setStateInternal] = useState<T>(initialState);
  const [members, setMembers] = useState<PresenceMember[]>([]);
  const [isConnected, setIsConnected] = useState(false);
  const channelRef = useRef<RealtimeChannel | null>(null);
  const eventHandlersRef = useRef<Map<string, Set<(p: unknown) => void>>>(new Map());
  const userRef = useRef<{ id: string; name: string } | null>(null);
  // Lazy-init user on first access to avoid calling localStorage during SSR render
  // and to avoid repeated calls on every render.
  if (userRef.current === null) userRef.current = getOrCreateUser();
  const user = userRef.current;
  const isLocalOnly = !roomId || !isRealtimeAvailable();

  const setState = useCallback(
    (updater: T | ((prev: T) => T)) => {
      setStateInternal((prev) => {
        const next = typeof updater === "function" ? (updater as (p: T) => T)(prev) : updater;
        if (channelRef.current && userRef.current) {
          void channelRef.current.send({
            type: "broadcast",
            event: "state-sync",
            payload: { state: next, by: userRef.current.id, at: new Date().toISOString() },
          });
        }
        return next;
      });
    },
    []
  );

  const broadcast = useCallback((event: string, payload: unknown) => {
    if (!channelRef.current) return;
    void channelRef.current.send({ type: "broadcast", event, payload });
  }, []);

  const subscribeToEvent = useCallback((event: string, handler: (p: unknown) => void) => {
    const handlers = eventHandlersRef.current.get(event) ?? new Set();
    handlers.add(handler);
    eventHandlersRef.current.set(event, handlers);
    return () => {
      handlers.delete(handler);
    };
  }, []);

  useEffect(() => {
    if (isLocalOnly || !roomId) {
      setIsConnected(false);
      return;
    }

    const supabase = getSupabaseClient();
    if (!supabase) return;
    if (!userRef.current) userRef.current = getOrCreateUser();
    const me = userRef.current;

    const channelName = `tool:${toolId}:room:${roomId}`;
    const channel = supabase.channel(channelName, {
      config: { presence: { key: me.id } },
    });

    let memberCount = 0;

    // Register all listeners BEFORE calling subscribe so none are missed
    channel
      .on("broadcast", { event: "state-sync" }, (payload) => {
        const body = payload.payload as { state: T; by: string };
        if (body.by !== me.id) {
          setStateInternal(body.state);
          emitRtEvent("sync-remote");
        }
      })
      .on("presence", { event: "sync" }, () => {
        const presenceState = channel.presenceState<PresenceMember>();
        const allMembers: PresenceMember[] = [];
        const isPresenceMember = (v: unknown): v is PresenceMember =>
          !!v &&
          typeof v === "object" &&
          typeof (v as PresenceMember).id === "string" &&
          typeof (v as PresenceMember).name === "string" &&
          typeof (v as PresenceMember).color === "string";
        for (const key of Object.keys(presenceState)) {
          const metas = presenceState[key];
          const first = Array.isArray(metas) ? metas[0] : undefined;
          if (isPresenceMember(first)) allMembers.push(first);
        }
        if (memberCount > 0) {
          if (allMembers.length > memberCount) emitRtEvent("member-join");
          else if (allMembers.length < memberCount) emitRtEvent("member-leave");
        }
        memberCount = allMembers.length;
        setMembers(allMembers);
      });

    // Custom event fan-out: any broadcast event dispatches to registered handlers
    // We register per-event as users call subscribeToEvent, but also proxy-register
    // a catch-all here for events the hook doesn't know about. Supabase doesn't
    // support a true wildcard, so we just route via the handlers map from known events.
    // (No wildcard listener needed — handlers added via subscribeToEvent must match
    // an event registered before subscribe.)

    channelRef.current = channel;
    const handlers = eventHandlersRef.current;

    channel.subscribe((status) => {
      if (status === "SUBSCRIBED") {
        setIsConnected(true);
        emitRtEvent("room-connected");
        void channel.track({
          id: me.id,
          name: me.name,
          color: assignColor(me.id),
          joinedAt: new Date().toISOString(),
        });
      } else {
        setIsConnected(false);
      }
    });

    return () => {
      void channel.unsubscribe();
      channelRef.current = null;
      handlers.clear();
      setIsConnected(false);
      setMembers([]);
    };
  }, [toolId, roomId, isLocalOnly]);

  return {
    state,
    setState,
    members,
    isConnected,
    isLocalOnly,
    roomId,
    userId: user.id,
    broadcast,
    subscribeToEvent,
  };
}
