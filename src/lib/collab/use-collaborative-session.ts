"use client";

/**
 * Collaborative-session hook — the framework primitive any tool adopts.
 *
 * Composes the existing realtime, presence, and history primitives so a
 * tool gets:
 *
 *   * realtime room (broadcast + presence) keyed on (toolId, entityId)
 *   * a logger that stamps events with the right `userId` (owner) and
 *     `squadProfileId` (when a guest authored)
 *   * a uniform participants list and `attribute()` helper
 *
 * Modes:
 *   * owner — when an authenticated owner is rendering the tool. Events
 *     write to the local history store + sync to Supabase via the normal
 *     pipeline. Presence reports the owner's profile.
 *   * guest — when a guest cookie is set (rendered inside the (guest)
 *     route group). Events POST to /api/guest/log; presence reports the
 *     guest profile.
 *   * solo  — neither owner nor guest. Logger is a no-op; presence falls
 *     back to a localStorage identity (matches today's solo-only tools).
 *
 * The hook is intentionally tolerant — it returns *something* in every
 * mode so a tool that hasn't been adapted to the framework can call it
 * without crashing.
 */

import { useCallback, useMemo, useRef } from "react";
import { nanoid } from "nanoid";
import { useAuthOptional } from "@/lib/auth/auth-provider";
import { useGuestProfile, type GuestProfile } from "@/lib/auth/guest-profile-provider";
import { useHistoryLogger } from "@/lib/history/use-history-logger";
import { useRoom } from "@/lib/realtime/use-room";
import { sanitizePayload } from "@/lib/history/sanitize";
import type { ToolId } from "@/lib/history/types";

export type CollabRole = "editor" | "viewer" | "commenter";
export type CollabMode = "owner" | "guest" | "solo";

export interface CollabAuthor {
  kind: "owner" | "guest";
  /** Stable id — auth user id (owner) or squad_profiles.id (guest). */
  id: string;
  displayName: string;
  /** Hex string in the SQUAD_COLORS palette. */
  color: string;
}

export interface CollabSession {
  mode: CollabMode;
  /** What the local participant is allowed to do. Owners are always editors. */
  role: CollabRole;
}

export interface CollabLogOptions {
  milestone?: boolean;
  beforeState?: unknown;
  afterState?: unknown;
  occurredAt?: Date;
}

export interface CollabSessionHookResult {
  session: CollabSession;
  author: CollabAuthor | null;
  /** Convenience: same as author but throws-on-null in owner/guest mode for callers that want a non-null. */
  attribute: () => CollabAuthor | null;
  /** Stamp + persist a meaningful action. In guest mode posts to /api/guest/log. */
  log: (action: string, payload?: Record<string, unknown>, opts?: CollabLogOptions) => void;
  /** Realtime presence members visible to this participant. */
  members: ReturnType<typeof useRoom>["members"];
  /** Send a broadcast event to all peers in the room. */
  broadcast: (event: string, payload: unknown) => void;
  subscribeToEvent: (event: string, handler: (payload: unknown) => void) => () => void;
  /** True when the realtime channel is connected. */
  isConnected: boolean;
  /** True when realtime is not configured (Supabase env missing). */
  isLocalOnly: boolean;
}

const OWNER_COLOR = "#00f0ff";
const OWNER_FALLBACK_NAME = "Owner";

export function useCollaborativeSession(
  toolId: ToolId,
  entityId: string,
  options: {
    /** Optional override of the role for owner mode (defaults to "editor"). */
    ownerRole?: CollabRole;
  } = {}
): CollabSessionHookResult {
  const auth = useAuthOptional();
  const guest = useGuestProfile();

  const mode: CollabMode = guest
    ? "guest"
    : auth?.status === "authenticated" && auth.user
      ? "owner"
      : "solo";
  const role: CollabRole = mode === "owner" ? (options.ownerRole ?? "editor") : "editor"; // guest role filled in by Phase 3+

  const author = useMemo<CollabAuthor | null>(() => {
    if (mode === "guest" && guest) {
      return {
        kind: "guest",
        id: guest.id,
        displayName: guest.displayName,
        color: guest.color,
      };
    }
    if (mode === "owner" && auth?.user) {
      const profile = auth.profile;
      const name =
        profile?.display_name ||
        (typeof auth.user.email === "string" ? auth.user.email : null) ||
        OWNER_FALLBACK_NAME;
      return {
        kind: "owner",
        id: auth.user.id,
        displayName: name,
        color: OWNER_COLOR,
      };
    }
    return null;
  }, [mode, guest, auth?.user, auth?.profile]);

  // Owner mode uses the existing useHistoryLogger; we delegate but
  // intercept to inject squadProfileId=null (already the default).
  const ownerLogger = useHistoryLogger(toolId);

  // Guest mode needs its own emitter. Initialise the refs SYNCHRONOUSLY
  // (not in a useEffect) so the first log() call already sees populated
  // values — a useEffect-based init would let early events fall through
  // to fresh-nanoid fallbacks and lose per-tab correlation.
  const guestClientIdRef = useRef<string>("");
  const guestRunIdRef = useRef<string>("");
  if (mode === "guest" && !guestClientIdRef.current) {
    if (typeof window !== "undefined") {
      const key = "agile-toolkit:guest-client-id";
      let stored: string | null = null;
      try {
        stored = window.localStorage.getItem(key);
      } catch {
        stored = null;
      }
      if (!stored || !/^[A-Za-z0-9_-]{1,32}$/.test(stored)) {
        stored = nanoid(16);
        try {
          window.localStorage.setItem(key, stored);
        } catch {
          /* private mode — fine, per-tab id stays in-memory only */
        }
      }
      guestClientIdRef.current = stored;
    } else {
      guestClientIdRef.current = nanoid(16);
    }
  }
  if (mode === "guest" && !guestRunIdRef.current) {
    guestRunIdRef.current = nanoid(16);
  }

  const log = useCallback(
    (action: string, payload: Record<string, unknown> = {}, opts: CollabLogOptions = {}) => {
      const occurredAt =
        opts.occurredAt instanceof Date && Number.isFinite(opts.occurredAt.getTime())
          ? opts.occurredAt
          : new Date();
      const sanitized = sanitizePayload(payload);

      if (mode === "owner") {
        ownerLogger.log(action, sanitized, {
          milestone: opts.milestone,
          beforeState: opts.beforeState,
          afterState: opts.afterState,
          occurredAt,
        });
        return;
      }
      if (mode === "guest" && guest) {
        const clientEventId = nanoid(16);
        // Fire-and-forget — guest writes are best-effort. A failed write
        // is logged client-side but doesn't block the user's action.
        void fetch("/api/guest/log", {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({
            toolId,
            entityId,
            action,
            payload: sanitized,
            clientEventId,
            clientId: guestClientIdRef.current || nanoid(16),
            toolRunId: guestRunIdRef.current || nanoid(16),
            occurredAt: occurredAt.toISOString(),
            isMilestone: opts.milestone === true,
          }),
        }).catch((err) => {
          // eslint-disable-next-line no-console
          console.warn("[collab] guest log POST failed", err);
        });
        return;
      }
      // solo mode: drop. Today solo tools log to their own local store
      // via useHistoryLogger; we keep behaviour identical for un-adopted
      // tools — they keep calling useHistoryLogger directly and ignore
      // this hook's log entirely.
    },
    [mode, guest, toolId, entityId, ownerLogger]
  );

  // Realtime room. Channel name omits squad id deliberately for now —
  // squad isolation is enforced by session_invites (only invited guests
  // get a profile in this room). A future hardening pass can add a
  // server-issued channel JWT (see plan, "hard problems #5").
  const roomId = entityId || null;
  const room = useRoom<unknown>(toolId, roomId, null);

  const attribute = useCallback(() => author, [author]);

  return {
    session: { mode, role },
    author,
    attribute,
    log,
    members: room.members,
    broadcast: room.broadcast,
    subscribeToEvent: room.subscribeToEvent,
    isConnected: room.isConnected,
    isLocalOnly: room.isLocalOnly,
  };
}

export type { GuestProfile };
