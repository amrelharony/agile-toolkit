"use client";

import { useEffect } from "react";
import type { Session } from "./types";

export interface AutoSeatOptions {
  session: Session | null;
  setSession: (updater: (prev: Session | null) => Session | null) => void;
  /** This client's participant id. */
  userId: string;
  /** The name to sit down under. */
  name: string;
  /**
   * Seat this client at all. False for a read-only viewer, and for a
   * visitor the host removed: they must stop re-adding themselves.
   */
  enabled: boolean;
  /** Don't take a seat in a session that already has this many people. */
  maxParticipants?: number;
}

/**
 * A joining (non-host) client sits itself down in the session it received.
 *
 * On every received session, if this client's row is missing, add it and
 * broadcast (the host's merge accepts a peer's own row). No "has joined"
 * latch: that latch caused a permanent ghost when the host's heartbeat
 * raced the initial join broadcast, so the check runs on every session and
 * a dropped row recovers within one host broadcast.
 */
export function useAutoSeat({
  session,
  setSession,
  userId,
  name,
  enabled,
  maxParticipants,
}: AutoSeatOptions): void {
  useEffect(() => {
    if (!enabled || !session) return;
    if (session.participants.some((p) => p.id === userId)) return;
    if (maxParticipants !== undefined && session.participants.length >= maxParticipants) return;
    setSession((prev) => {
      if (!prev) return prev;
      if (prev.participants.some((p) => p.id === userId)) return prev;
      return {
        ...prev,
        participants: [...prev.participants, { id: userId, name, vote: null }],
      };
    });
  }, [enabled, session, userId, name, maxParticipants, setSession]);
}
