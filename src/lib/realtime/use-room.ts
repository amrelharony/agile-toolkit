"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import type { RealtimeChannel } from "@supabase/supabase-js";
import { getSupabaseClient, isRealtimeAvailable } from "./supabase-client";
import { nanoid } from "nanoid";
import { emitRtEvent } from "@/lib/sonification/emit";
import { usePresenceIdentityOverride } from "./presence-identity";

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

const COLORS = [
  "#00f0ff",
  "#a855f7",
  "#f472b6",
  "#facc15",
  "#34d399",
  "#fb923c",
  "#60a5fa",
  "#f87171",
];
const COLOR_SET = new Set(COLORS);
const FALLBACK_COLOR = COLORS[0];

function assignColor(userId: string): string {
  let hash = 0;
  for (let i = 0; i < userId.length; i++) hash = (hash * 31 + userId.charCodeAt(i)) >>> 0;
  return COLORS[hash % COLORS.length];
}

/**
 * Constrain an incoming presence color to the allowlist. A malicious or
 * patched peer could broadcast any string here — including CSS that
 * exfiltrates data if it ever lands in a `style="…"` attribute via string
 * concat. React's style-object API rejects most of it, but defending in
 * depth at the trust boundary is cheaper than auditing every consumer.
 */
function safeColor(value: unknown): string {
  if (typeof value === "string" && COLOR_SET.has(value)) return value;
  return FALLBACK_COLOR;
}

function getOrCreateUser(): { id: string; name: string } {
  if (typeof window === "undefined") return { id: "ssr", name: "Guest" };
  const key = "agile-toolkit:user";
  try {
    const existing = localStorage.getItem(key);
    // Bound the read so a corrupted/oversized slot can't freeze JSON.parse.
    if (existing && existing.length < 4096) {
      const parsed = JSON.parse(existing) as Partial<{ id: string; name: string }>;
      // Validate shape — if either field is missing or wrong-type, fall
      // through to creating a fresh identity rather than handing back a
      // half-broken object that confuses presence/broadcast downstream.
      if (
        parsed &&
        typeof parsed.id === "string" &&
        typeof parsed.name === "string" &&
        parsed.id.length > 0 &&
        parsed.name.length > 0
      ) {
        return { id: parsed.id, name: parsed.name };
      }
    }
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

interface UseRoomOptions<T> {
  /**
   * Optional type-guard for incoming `state-sync` broadcasts. Defaults to
   * `() => true` (accept everything) for backward compatibility. The
   * canvas tool passes `() => false` to drop the default state-sync channel
   * entirely — it routes its own validated events through dedicated
   * `whiteboard:*` broadcasts and doesn't want hostile peers to be able
   * to spam `setStateInternal` re-renders via the default channel.
   */
  validateState?: (raw: unknown) => raw is T;
  /**
   * Explicit identity for this participant. When provided, useRoom skips
   * the localStorage-backed `getOrCreateUser()` path and uses the supplied
   * id + name directly. Used by guest pages to pin presence to a squad
   * profile without overwriting the shared `agile-toolkit:user` slot —
   * doing so would contaminate any other tab on the same browser (e.g.
   * the owner signed in elsewhere) for the duration of the session.
   */
  identity?: { id: string; name: string };
}

export function useRoom<T>(
  toolId: string,
  roomId: string | null,
  initialState: T,
  options: UseRoomOptions<T> = {}
): UseRoomResult<T> {
  // Default validator REJECTS every incoming peer state. The previous
  // default (`true`) was a type-guard lie: it claimed `_raw is T` without
  // checking, so any hostile peer could broadcast arbitrary JSON shapes
  // and crash render via `setStateInternal(body.state as T)`. Tools that
  // want cross-peer state sync (vs presence-only) must opt in with an
  // explicit validator. Tools that only need presence/broadcast keep
  // working — state-sync messages from peers are dropped, presence and
  // explicit `broadcast(event, payload)` still flow.
  const validateState = options.validateState ?? ((_raw: unknown): _raw is T => false);
  const [state, setStateInternal] = useState<T>(initialState);
  const [members, setMembers] = useState<PresenceMember[]>([]);
  const [isConnected, setIsConnected] = useState(false);
  const channelRef = useRef<RealtimeChannel | null>(null);
  const eventHandlersRef = useRef<Map<string, Set<(p: unknown) => void>>>(new Map());
  // Per-channel record of which event names already have a `channel.on()`
  // listener wired. Tracked separately from `eventHandlersRef` because
  // multiple consumers can call `subscribeToEvent(event, ...)` for the
  // same event — we only want ONE channel binding per event, fanned out
  // to every handler in the Set. Cleared on channel teardown so the
  // next channel re-binds fresh.
  const boundEventsRef = useRef<Set<string>>(new Set());
  const userRef = useRef<{ id: string; name: string } | null>(null);
  // Identity precedence: explicit option > tree-scoped context > localStorage.
  // Guest pages mount <PresenceIdentityProvider> so they don't have to
  // overwrite the shared `agile-toolkit:user` slot (which would
  // contaminate any other tab on the same browser).
  const contextIdentity = usePresenceIdentityOverride();
  if (options.identity) {
    userRef.current = options.identity;
  } else if (contextIdentity) {
    userRef.current = contextIdentity;
  } else if (userRef.current === null) {
    userRef.current = getOrCreateUser();
  }
  const user = userRef.current;
  const isLocalOnly = !roomId || !isRealtimeAvailable();

  const setState = useCallback((updater: T | ((prev: T) => T)) => {
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
  }, []);

  const broadcast = useCallback((event: string, payload: unknown) => {
    if (!channelRef.current) return;
    void channelRef.current.send({ type: "broadcast", event, payload });
  }, []);

  // Bind one Supabase broadcast listener per event name and dispatch to
  // every consumer in the handler Set. Idempotent — calling twice for
  // the same event is a no-op (boundEventsRef tracks what's bound).
  const bindEventToChannel = useCallback((channel: RealtimeChannel, event: string) => {
    if (boundEventsRef.current.has(event)) return;
    boundEventsRef.current.add(event);
    channel.on("broadcast", { event }, (payload) => {
      const set = eventHandlersRef.current.get(event);
      if (!set || set.size === 0) return;
      const raw = (payload as { payload?: unknown } | undefined)?.payload;
      // Snapshot the Set BEFORE iteration — a handler that calls its
      // own off() during dispatch would otherwise mutate the live Set.
      for (const h of Array.from(set)) {
        try {
          h(raw);
        } catch (err) {
          // eslint-disable-next-line no-console
          console.warn(`[use-room] handler for ${event} threw`, err);
        }
      }
    });
  }, []);

  const subscribeToEvent = useCallback(
    (event: string, handler: (p: unknown) => void) => {
      const handlers = eventHandlersRef.current.get(event) ?? new Set();
      handlers.add(handler);
      eventHandlersRef.current.set(event, handlers);
      // Bind to the live channel if one exists. If subscribeToEvent is
      // called BEFORE the channel mounts, the effect below catches it
      // by iterating `eventHandlersRef.current.keys()` at setup time.
      if (channelRef.current) {
        bindEventToChannel(channelRef.current, event);
      }
      return () => {
        handlers.delete(handler);
      };
    },
    [bindEventToChannel]
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
        // Null-check the payload shape before destructuring. A peer
        // (or proxy mid-flight) sending `payload.payload = null` would
        // throw on `body.by` and silently kill this listener for the
        // rest of the session. Hostile-peer or sloppy-tool surface.
        const raw = payload?.payload;
        if (!raw || typeof raw !== "object") return;
        const body = raw as { state?: unknown; by?: unknown };
        if (typeof body.by !== "string") return;
        if (body.by === me.id) return;
        // Run the optional validator. Default (since the hardening
        // change) rejects every peer state — tools that want cross-
        // peer state sync MUST pass an explicit `validateState`. This
        // hook still supports presence/broadcast for tools that only
        // need those channels.
        if (!validateState(body.state)) return;
        setStateInternal(body.state);
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
          if (isPresenceMember(first)) {
            // Normalise color to the allowlist BEFORE the value enters
            // any render path — see safeColor() docs.
            allMembers.push({ ...first, color: safeColor(first.color) });
          }
        }
        if (memberCount > 0) {
          if (allMembers.length > memberCount) emitRtEvent("member-join");
          else if (allMembers.length < memberCount) emitRtEvent("member-leave");
        }
        memberCount = allMembers.length;
        setMembers(allMembers);
      });

    // Custom event fan-out. Supabase has no wildcard for `broadcast`, so
    // we bind one `channel.on("broadcast", { event }, …)` per event name
    // that any consumer has already registered (via subscribeToEvent
    // before the channel mounted). Subsequent calls to subscribeToEvent
    // after the channel is live also bind on the fly — see the
    // `if (channelRef.current)` branch in subscribeToEvent.
    channelRef.current = channel;
    const handlers = eventHandlersRef.current;
    // Capture into a local that the cleanup closure can use safely —
    // satisfies react-hooks/exhaustive-deps' ref-mutation check.
    const boundEvents = boundEventsRef.current;
    handlers.forEach((_set, event) => {
      bindEventToChannel(channel, event);
    });

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
      // R9-style cleanup (matches use-presence.ts and use-canvas-presence.ts):
      // chain untrack → unsubscribe → removeChannel so the LEAVE event lands
      // before the channel is torn down (otherwise peers see a ghost presence
      // for ~60 s until the server's TTL expires) AND so the channel is freed
      // from the Supabase client's internal `channels[]` map. Without
      // removeChannel, every toolId/roomId change leaked a RealtimeChannel
      // plus all its bound handler closures.
      void Promise.resolve(channel.untrack())
        .then(() => channel.unsubscribe())
        .catch(() => {});
      try {
        void getSupabaseClient()?.removeChannel(channel);
      } catch {
        /* client torn down */
      }
      channelRef.current = null;
      // Forget which events we'd bound to the now-dead channel; the
      // next channel will re-bind from `eventHandlersRef.current.keys()`.
      // Intentionally DO NOT clear `eventHandlersRef` — consumer handlers
      // are still registered and need to be re-attached to the new channel.
      boundEvents.clear();
      setIsConnected(false);
      setMembers([]);
    };
    // `validateState` is intentionally excluded — callers typically pass an
    // inline arrow function whose identity churns every render, which would
    // tear down and re-create the realtime channel each commit. We capture
    // it once at mount and accept the trade-off that swapping the validator
    // mid-session requires re-rendering with a new roomId.
    // eslint-disable-next-line react-hooks/exhaustive-deps
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
