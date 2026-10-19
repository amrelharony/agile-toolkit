"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import type { RealtimeChannel } from "@supabase/supabase-js";
import { getSupabaseClient, isRealtimeAvailable } from "./supabase-client";
import { nanoid } from "nanoid";
import { emitRtEvent } from "@/lib/sonification/emit";
import { usePresenceIdentityOverride } from "./presence-identity";
import { useRealtimeAllowed } from "./use-realtime-allowed";
import { createInboundLimiter } from "./rate-limit";
import { isWithinJsonSize } from "./sanitize";
import {
  VISITOR_LIMITS,
  createAdmissionLedger,
  isRoomFull,
  isVisitorIdentity,
  readVisitorPresence,
  visitorChannelName,
  visitorRoomsEnabled,
} from "./visitor-rooms";

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
  /**
   * Visitor rooms only: this client's first presence sync already showed
   * `VISITOR_LIMITS.maxMembers` other people, so it left the channel.
   * Stays true (even after the caller drops the room id) until the hook
   * opens another visitor channel. Always false for owner and guest rooms.
   */
  roomFull: boolean;
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

// Permissive color validator for caller-supplied identity.color. Accepts the
// usual #rgb/#rrggbb(aa), rgb()/rgba(), hsl()/hsla() and short named tokens —
// mirrors `use-presence.ts`'s widened palette so a guest's stored profile
// color survives the round-trip even when it isn't in the 8-entry COLORS
// allowlist used for peer-broadcast normalisation.
const CALLER_COLOR_RE =
  /^(#[0-9a-fA-F]{3,8}|rgb\(\s*\d+\s*,\s*\d+\s*,\s*\d+\s*\)|rgba\(\s*\d+\s*,\s*\d+\s*,\s*\d+\s*,\s*(0|1|0?\.\d+)\s*\)|hsl\(\s*\d+\s*,\s*\d+%\s*,\s*\d+%\s*\)|hsla\(\s*\d+\s*,\s*\d+%\s*,\s*\d+%\s*,\s*(0|1|0?\.\d+)\s*\)|[a-zA-Z]{3,20})$/;

function isCallerColor(value: unknown): value is string {
  return typeof value === "string" && value.length <= 32 && CALLER_COLOR_RE.test(value);
}

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

/**
 * Visitor rooms: the filter every inbound broadcast passes before any
 * handler sees it. Charges the sender's and the event's token buckets
 * (`by` is self-declared, hence the shared per-event budget), then drops
 * anything over `VISITOR_LIMITS.maxPayloadChars`. One per channel.
 */
function createVisitorInboundGuard(): (event: string, raw: unknown) => boolean {
  const limiter = createInboundLimiter(VISITOR_LIMITS.inbound);
  return (event, raw) => {
    const by = raw && typeof raw === "object" ? (raw as { by?: unknown }).by : undefined;
    const sender = typeof by === "string" && by.length <= 64 ? by : "";
    return limiter.allow(sender, event) && isWithinJsonSize(raw, VISITOR_LIMITS.maxPayloadChars);
  };
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
  identity?: { id: string; name: string; color?: string };
  /**
   * Join a visitor live room instead of an owner/guest room. The channel is
   * `visitor:<toolId>:<roomId>` and opens only when ALL of these hold:
   * `NEXT_PUBLIC_VISITOR_ROOMS=1`; `toolId` is in `VISITOR_TOOLS`; `roomId`
   * is a 12-character visitor code; and `identity` is a visitor identity
   * (from `saveVisitorIdentity`, which the consent dialog's confirm step
   * produces). Otherwise the hook stays local-only and opens nothing.
   *
   * In a visitor room the hook also:
   * - drops presence entries whose key and id differ, whose id isn't a
   *   visitor id, or whose name has control or bidi characters;
   * - lists at most `VISITOR_LIMITS.maxMembers` members, seated in the order
   *   this client first saw them;
   * - leaves and sets `roomFull` when its first sync already shows that
   *   many other people;
   * - drops inbound broadcasts over the per-sender / per-event rate limit
   *   or `VISITOR_LIMITS.maxPayloadChars`.
   *
   * Owner and guest rooms (`visitor` unset) behave exactly as before.
   */
  visitor?: boolean;
}

export function useRoom<T>(
  toolId: string,
  requestedRoomId: string | null,
  initialState: T,
  options: UseRoomOptions<T> = {}
): UseRoomResult<T> {
  // Public visitors stay local-only: a room only they can reach would just
  // spend the owner's Realtime quota. A null room id routes every caller
  // (planning-poker, canvas, kudos, collab sessions) onto its existing solo
  // path, and the owner's room connects once auth verifies them.
  // A visitor room additionally needs the flag, an allowlisted tool, a
  // 12-character code and a consented identity (see `options.visitor`).
  const visitor = options.visitor === true;
  const realtimeAllowed = useRealtimeAllowed({ visitorRoom: visitor });
  const visitorReady =
    !visitor ||
    (visitorRoomsEnabled() &&
      requestedRoomId !== null &&
      visitorChannelName(toolId, requestedRoomId) !== null &&
      isVisitorIdentity(options.identity));
  const roomId = realtimeAllowed && visitorReady ? requestedRoomId : null;
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
  const [roomFull, setRoomFull] = useState(false);
  const channelRef = useRef<RealtimeChannel | null>(null);
  // Visitor rooms only: the per-channel inbound filter (rate limit + size).
  // Null for owner and guest rooms, whose dispatch is unchanged.
  const inboundGuardRef = useRef<((event: string, raw: unknown) => boolean) | null>(null);
  const eventHandlersRef = useRef<Map<string, Set<(p: unknown) => void>>>(new Map());
  // Per-channel record of which event names already have a `channel.on()`
  // listener wired. Tracked separately from `eventHandlersRef` because
  // multiple consumers can call `subscribeToEvent(event, ...)` for the
  // same event — we only want ONE channel binding per event, fanned out
  // to every handler in the Set. Cleared on channel teardown so the
  // next channel re-binds fresh.
  const boundEventsRef = useRef<Set<string>>(new Set());
  const userRef = useRef<{ id: string; name: string; color?: string } | null>(null);
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
      const guard = inboundGuardRef.current;
      if (guard && !guard(event, raw)) return;
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
        if (handlers.size === 0) {
          // Drop the empty Set so dispatch's `set.size === 0` early-return
          // in bindEventToChannel makes it a no-op. Do NOT clear
          // `boundEventsRef`: supabase-js exposes no per-listener disposer,
          // so the underlying `channel.on(...)` binding stays attached to
          // the live channel. Clearing the bound flag made a later
          // subscribeToEvent for the same name add a SECOND binding →
          // duplicate dispatch (each handler fired 2×, 3×, …) and leaked
          // bindings. The binding is idempotent and reused on resubscribe;
          // it's cleared only on channel teardown (boundEvents.clear()).
          eventHandlersRef.current.delete(event);
        }
      };
    },
    [bindEventToChannel]
  );

  useEffect(() => {
    if (isLocalOnly || !roomId) {
      setIsConnected(false);
      setMembers([]);
      return;
    }

    const supabase = getSupabaseClient();
    if (!supabase) return;
    if (!userRef.current) userRef.current = getOrCreateUser();
    const me = userRef.current;

    // `roomId` is only non-null for a visitor once the gate above passed,
    // so the null branch is belt and braces: no valid name, no channel.
    const channelName = visitor
      ? visitorChannelName(toolId, roomId)
      : `tool:${toolId}:room:${roomId}`;
    if (!channelName) return;
    const channel = supabase.channel(channelName, {
      config: { presence: { key: me.id } },
    });

    let memberCount = 0;
    // Capture into a local that the cleanup closure can use safely —
    // satisfies react-hooks/exhaustive-deps' ref-mutation check.
    const boundEvents = boundEventsRef.current;

    // Visitor rooms only (all null/unused for owner and guest rooms).
    const ledger = visitor ? createAdmissionLedger(VISITOR_LIMITS.maxMembers) : null;
    const admitInbound = visitor ? createVisitorInboundGuard() : null;
    inboundGuardRef.current = admitInbound;
    let firstSync = true;
    let left = false;
    if (visitor) setRoomFull(false);

    const publishMembers = (allMembers: PresenceMember[]) => {
      if (memberCount > 0) {
        if (allMembers.length > memberCount) emitRtEvent("member-join");
        else if (allMembers.length < memberCount) emitRtEvent("member-leave");
      }
      memberCount = allMembers.length;
      setMembers(allMembers);
    };

    // R9-style teardown (matches use-presence.ts and use-canvas-presence.ts):
    // chain untrack → unsubscribe → removeChannel so the LEAVE event lands
    // before the channel is torn down (otherwise peers see a ghost presence
    // for ~60 s until the server's TTL expires) AND so the channel is freed
    // from the Supabase client's internal `channels[]` map. Without
    // removeChannel, every toolId/roomId change leaked a RealtimeChannel
    // plus all its bound handler closures. Runs once: on unmount or a deps
    // change, or earlier when a visitor room turns out to be full.
    const leave = () => {
      if (left) return;
      left = true;
      void Promise.resolve(channel.untrack())
        .then(() => channel.unsubscribe())
        .catch(() => {});
      try {
        void getSupabaseClient()?.removeChannel(channel);
      } catch {
        /* client torn down */
      }
      if (channelRef.current === channel) channelRef.current = null;
      if (inboundGuardRef.current === admitInbound) inboundGuardRef.current = null;
      // Forget which events we'd bound to the now-dead channel; the
      // next channel will re-bind from `eventHandlersRef.current.keys()`.
      // Intentionally DO NOT clear `eventHandlersRef` — consumer handlers
      // are still registered and need to be re-attached to the new channel.
      boundEvents.clear();
      setIsConnected(false);
      setMembers([]);
    };

    // Register all listeners BEFORE calling subscribe so none are missed
    channel
      .on("broadcast", { event: "state-sync" }, (payload) => {
        if (admitInbound && !admitInbound("state-sync", payload?.payload)) return;
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
        if (ledger) {
          if (left) return;
          // Visitor room: strict entries only, at most maxMembers of them.
          const present = readVisitorPresence(channel.presenceState());
          if (firstSync) {
            firstSync = false;
            const others = present.filter((m) => m.id !== me.id).length;
            if (isRoomFull(others)) {
              setRoomFull(true);
              leave();
              return;
            }
          }
          const byId = new Map(present.map((m) => [m.id, m]));
          const { admitted } = ledger.update(
            present.map((m) => m.id),
            me.id
          );
          const allMembers: PresenceMember[] = [];
          for (const id of admitted) {
            const m = byId.get(id);
            if (m) allMembers.push({ ...m, color: safeColor(m.color) });
          }
          publishMembers(allMembers);
          return;
        }
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
        publishMembers(allMembers);
      });

    // Custom event fan-out. Supabase has no wildcard for `broadcast`, so
    // we bind one `channel.on("broadcast", { event }, …)` per event name
    // that any consumer has already registered (via subscribeToEvent
    // before the channel mounted). Subsequent calls to subscribeToEvent
    // after the channel is live also bind on the fly — see the
    // `if (channelRef.current)` branch in subscribeToEvent.
    channelRef.current = channel;
    const handlers = eventHandlersRef.current;
    handlers.forEach((_set, event) => {
      bindEventToChannel(channel, event);
    });

    const trackedColor = isCallerColor(me.color) ? me.color : assignColor(me.id);
    channel.subscribe((status) => {
      // A visitor that already left (room full) must not take a seat.
      if (visitor && left) return;
      if (status === "SUBSCRIBED") {
        setIsConnected(true);
        emitRtEvent("room-connected");
        void channel.track({
          id: me.id,
          name: me.name,
          color: trackedColor,
          joinedAt: new Date().toISOString(),
        });
      } else {
        setIsConnected(false);
      }
    });

    return leave;
    // `validateState` is intentionally excluded — callers typically pass an
    // inline arrow function whose identity churns every render, which would
    // tear down and re-create the realtime channel each commit. We capture
    // it once at mount and accept the trade-off that swapping the validator
    // mid-session requires re-rendering with a new roomId.
    // Including `user?.id` in the deps so a switch-profile flow (or the
    // owner-tree case where identity arrives after the AuthProvider
    // resolves) remounts the channel with the new presence key.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [toolId, roomId, isLocalOnly, user?.id, visitor]);

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
    roomFull,
  };
}
