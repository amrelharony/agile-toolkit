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

/** Optional runtime validator for incoming `state-sync` payloads.
 * Without one, a hostile peer can flip every consumer's state to any
 * shape (including `null`, the wrong type, or a giant string). Tools
 * that rely on `state` having a specific shape should pass a guard. */
export interface UseRoomOptions<T> {
  validateState?: (raw: unknown) => raw is T;
}

export function useRoom<T>(
  toolId: string,
  roomId: string | null,
  initialState: T,
  options: UseRoomOptions<T> = {},
): UseRoomResult<T> {
  // Stash the validator in a ref so the connect effect doesn't
  // re-mount whenever the caller passes a fresh inline function.
  const validateStateRef = useRef(options.validateState);
  validateStateRef.current = options.validateState;
  const [state, setStateInternal] = useState<T>(initialState);
  const [members, setMembers] = useState<PresenceMember[]>([]);
  const [isConnected, setIsConnected] = useState(false);
  const channelRef = useRef<RealtimeChannel | null>(null);
  const eventHandlersRef = useRef<Map<string, Set<(p: unknown) => void>>>(new Map());
  // Tracks which custom broadcast events we've actually bound to the
  // active Supabase channel. Cleared on disconnect. Without this set,
  // subscribeToEvent would happily stash handlers in the in-memory map
  // but no channel.on(...) ever fired — every cross-peer broadcast
  // (whiteboard:patch / heartbeat / focus / etc.) would silently drop.
  const boundEventsRef = useRef<Set<string>>(new Set());
  const userRef = useRef<{ id: string; name: string } | null>(null);
  // Lazy-init user on first access to avoid calling localStorage during SSR render
  // and to avoid repeated calls on every render.
  if (userRef.current === null) userRef.current = getOrCreateUser();
  const user = userRef.current;
  const isLocalOnly = !roomId || !isRealtimeAvailable();

  // Cache the latest committed state in a ref so we can compute `next`
  // synchronously OUTSIDE the React state-updater. React 18 Strict Mode
  // invokes the updater function TWICE in development; if we side-effect
  // (broadcast) inside the updater, every Strict-Mode-rendered tool emits
  // duplicate state-sync packets to peers. By computing `next` once here
  // and broadcasting once, the network side stays correct regardless of
  // how many times React re-runs the updater.
  const latestStateRef = useRef<T>(initialState);
  latestStateRef.current = state;
  const setState = useCallback(
    (updater: T | ((prev: T) => T)) => {
      const prev = latestStateRef.current;
      const next = typeof updater === "function" ? (updater as (p: T) => T)(prev) : updater;
      // Update the ref immediately so back-to-back setState calls in the
      // same tick see the post-update value (mirrors React's
      // queue-merging behavior even before React commits).
      latestStateRef.current = next;
      if (channelRef.current && userRef.current) {
        void channelRef.current.send({
          type: "broadcast",
          event: "state-sync",
          payload: { state: next, by: userRef.current.id, at: new Date().toISOString() },
        });
      }
      setStateInternal(next);
    },
    []
  );

  const broadcast = useCallback((event: string, payload: unknown) => {
    if (!channelRef.current) return;
    void channelRef.current.send({ type: "broadcast", event, payload });
  }, []);

  // Bind a custom broadcast event to the live channel. Idempotent —
  // tracked via `boundEventsRef` so we don't double-register listeners.
  // Supabase Realtime v2 supports adding listeners after .subscribe();
  // they're queued and applied when the channel opens.
  const bindChannelEvent = useCallback((event: string) => {
    const channel = channelRef.current;
    if (!channel) return;
    if (boundEventsRef.current.has(event)) return;
    boundEventsRef.current.add(event);
    channel.on("broadcast", { event }, (msg: { payload?: unknown }) => {
      const set = eventHandlersRef.current.get(event);
      if (!set || set.size === 0) return;
      // Snapshot the handler set so an unsubscribe during iteration
      // doesn't skip remaining handlers.
      for (const h of Array.from(set)) {
        try {
          h(msg.payload);
        } catch (err) {
          if (process.env.NODE_ENV !== "production") {
            // eslint-disable-next-line no-console
            console.warn(`[useRoom] handler for "${event}" threw:`, err);
          }
        }
      }
    });
  }, []);

  const subscribeToEvent = useCallback(
    (event: string, handler: (p: unknown) => void) => {
      let handlers = eventHandlersRef.current.get(event);
      if (!handlers) {
        handlers = new Set();
        eventHandlersRef.current.set(event, handlers);
      }
      handlers.add(handler);
      // Bind the event to the active channel (if any). Calls before the
      // channel exists are queued via the connect effect below, which
      // re-binds every entry of eventHandlersRef when the channel opens.
      bindChannelEvent(event);
      return () => {
        const set = eventHandlersRef.current.get(event);
        if (!set) return;
        set.delete(handler);
        if (set.size === 0) {
          // Drop the empty handler bucket. Note: Supabase's
          // RealtimeChannel doesn't expose a per-binding `.off()`, so
          // the channel-side listener stays attached until the channel
          // itself tears down. We deliberately DO NOT delete from
          // `boundEventsRef` here — leaving the binding marked as
          // "bound" prevents a future `subscribeToEvent` for the same
          // event from calling `channel.on` again on top of the
          // already-attached listener (which would cause every
          // broadcast to fan out twice). The in-channel listener
          // short-circuits when the bucket is empty (`set.size === 0`)
          // so the orphan binding is a cheap no-op until reconnect.
          eventHandlersRef.current.delete(event);
        }
      };
    },
    [bindChannelEvent],
  );

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
        // Defensive: peer can send any shape. Validate `by` is a
        // string and not our own id, then run the optional
        // caller-supplied state validator before assigning. Without
        // the validator, hostile peers can flip state to `null` /
        // wrong type / megabyte string and crash every consumer.
        const raw = payload?.payload as unknown;
        if (!raw || typeof raw !== "object") return;
        const body = raw as { state?: unknown; by?: unknown };
        if (typeof body.by !== "string" || body.by === me.id) return;
        const validator = validateStateRef.current;
        if (validator && !validator(body.state)) {
          if (process.env.NODE_ENV !== "production") {
            // eslint-disable-next-line no-console
            console.warn("[useRoom] rejected state-sync — failed validator");
          }
          return;
        }
        // Keep latestStateRef in sync with peer-driven updates so a
        // subsequent local setState computes the delta against the
        // most-recent value, not the stale initialState.
        latestStateRef.current = body.state as T;
        setStateInternal(body.state as T);
        emitRtEvent("sync-remote");
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

    // Bind every custom broadcast event that was registered via
    // subscribeToEvent BEFORE the channel was created. Children mount
    // before the parent's connect effect runs, so a typical usage —
    // child component calls subscribeToEvent in its own effect — lands
    // entries in eventHandlersRef before this code path executes. We
    // re-bind them all here.
    channelRef.current = channel;
    boundEventsRef.current = new Set();
    for (const event of Array.from(eventHandlersRef.current.keys())) {
      bindChannelEvent(event);
    }

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
      // `channel.unsubscribe()` returns a Promise; we don't await it
      // because the cleanup callback is synchronous. Rapid roomId churn
      // can therefore overlap teardown with the new channel's setup
      // window — Supabase's client de-dupes by channel topic so duplicate
      // listeners are still avoided, but if a peer's broadcast lands
      // during the gap it may target the old channel. Wrapping the
      // promise in `Promise.resolve(...).catch` here is purely belt-
      // and-braces against unhandled rejections that would crash the
      // host in some bundlers.
      void Promise.resolve(channel.unsubscribe()).catch(() => {});
      channelRef.current = null;
      // Clear bound-events tracking so the next channel start re-binds.
      // Don't clear eventHandlersRef itself — subscribers persist across
      // reconnects, and the new channel's bind loop re-attaches them.
      boundEventsRef.current = new Set();
      setIsConnected(false);
      setMembers([]);
    };
  }, [toolId, roomId, isLocalOnly, bindChannelEvent]);

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
