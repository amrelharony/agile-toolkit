"use client";

/**
 * Guest-mode planning-poker session.
 *
 * Mounts the same SessionScreen the owner sees, sourcing state from
 * the shared realtime room. The guest is NOT the host — host-only
 * UI (advance, reveal, commit) is gated by `isHost={false}`.
 *
 * Identity threading: (guest)/layout.tsx mounts
 * `<PresenceIdentityProvider>` with the guest profile, which `useRoom`
 * reads as its presence id. No localStorage clobbering.
 *
 * Join: every render checks `session.participants.some(p => p.id === userId)`.
 * If the local row is missing (initial join OR clobbered by a host-side
 * race), we re-broadcast our row. The host's merge accepts the
 * participant-row mutation. The check runs on every received session so
 * a transient ghost recovers within one heartbeat.
 */

import { useEffect, useState } from "react";
import Link from "next/link";
import { ArrowLeft, Loader2, AlertTriangle } from "lucide-react";
import { SessionScreen } from "@/app/(tools)/planning-poker/session-screen";
import { usePokerSession } from "@/app/(tools)/planning-poker/use-poker-session";
import { useAutoSeat } from "@/app/(tools)/planning-poker/use-auto-seat";

interface Props {
  roomCode: string;
  role: "editor" | "viewer" | "commenter";
  profile: { id: string; displayName: string; color: string };
}

export function GuestPokerClient({ roomCode, role, profile }: Props) {
  return <GuestPokerInner roomCode={roomCode} role={role} profile={profile} />;
}

function GuestPokerInner({ roomCode, role, profile }: Props) {
  const { session, setSession, isConnected, isLocalOnly, userId, isHost, subscribeToSessionEnded } =
    usePokerSession(roomCode, /* isHost */ false);

  const [hostEnded, setHostEnded] = useState(false);

  // Auto-rejoin: on every received session, if our row is missing and
  // we're not a viewer, broadcast our participant row.
  useAutoSeat({
    session,
    setSession,
    userId,
    name: profile.displayName,
    enabled: role !== "viewer",
  });

  useEffect(() => {
    const off = subscribeToSessionEnded(() => setHostEnded(true));
    return off;
  }, [subscribeToSessionEnded]);

  if (!session) {
    return (
      <main className="min-h-screen flex flex-col items-center justify-center gap-4">
        <div className="flex items-center gap-2 text-sub text-sm">
          <Loader2 className="w-4 h-4 animate-spin" aria-hidden="true" />
          Waiting for the host to start the session…
        </div>
        {isLocalOnly && (
          <div
            role="alert"
            className="flex items-center gap-2 border border-warning/40 bg-warning/10 rounded px-3 py-1.5 text-xs text-warning"
          >
            <AlertTriangle className="w-3.5 h-3.5" aria-hidden="true" />
            Realtime not configured. You won&apos;t receive session updates.
          </div>
        )}
        <Link
          href="/guest"
          className="min-touch-coarse inline-flex items-center justify-center -mx-1 px-2 rounded text-xs text-sub hover:text-text"
        >
          Back to home
        </Link>
      </main>
    );
  }

  return (
    <div className="min-h-screen px-4 py-4">
      <div className="mx-auto max-w-6xl space-y-3">
        <header className="flex flex-wrap items-center justify-between gap-3 text-xs">
          <Link
            href="/guest"
            className="min-touch-coarse inline-flex items-center gap-1 -mx-1 px-1 rounded text-sub hover:text-text"
          >
            <ArrowLeft className="w-3.5 h-3.5" aria-hidden="true" />
            Back
          </Link>
          <div className="flex items-center gap-1.5">
            <span
              className="w-2 h-2 rounded-full shrink-0"
              style={{ backgroundColor: profile.color }}
              aria-hidden="true"
            />
            <span className="text-text">{profile.displayName}</span>
            <span
              className={`text-xs uppercase font-bold ${
                role === "editor"
                  ? "text-warning"
                  : role === "commenter"
                    ? "text-success"
                    : "text-cyan-300"
              }`}
            >
              {role}
            </span>
          </div>
        </header>
        {hostEnded && (
          <div
            role="alert"
            className="flex items-center gap-2 border border-warning/40 bg-warning/10 rounded px-3 py-2 text-xs text-warning"
          >
            <AlertTriangle className="w-3.5 h-3.5 shrink-0" aria-hidden="true" />
            The host left the session. Live updates have stopped.
          </div>
        )}
        <SessionScreen
          session={session}
          onUpdateSession={(updater) => setSession((prev) => (prev ? updater(prev) : prev))}
          localParticipantId={userId}
          isHost={isHost}
          onLeave={() => {
            window.location.href = "/guest";
          }}
          connectionLabel={isLocalOnly ? "Local-only" : isConnected ? "Live" : "Connecting…"}
          connectionTone={isLocalOnly ? "warn" : "live"}
        />
      </div>
    </div>
  );
}
