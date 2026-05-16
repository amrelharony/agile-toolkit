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
const RTL_OVERRIDE_RE = /[‪-‮⁦-⁩]/;

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
      const out: SimplePresence = { id: r.id, name: r.name, color: r.color };
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
