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
 * Join: the first time we receive a session-sync that doesn't contain
 * us, we add ourselves to participants and broadcast. The host's next
 * mutation overwrites it, but as long as the host doesn't strip
 * participants on every change (they don't), the entry persists.
 */

import { useEffect, useState } from "react";
import Link from "next/link";
import { ArrowLeft, Loader2, AlertTriangle } from "lucide-react";
import { SessionScreen } from "@/app/(tools)/planning-poker/session-screen";
import { usePokerSession } from "@/app/(tools)/planning-poker/use-poker-session";

interface Props {
  roomCode: string;
  role: "editor" | "viewer" | "commenter";
  profile: { id: string; displayName: string; color: string };
}

export function GuestPokerClient({ roomCode, role, profile }: Props) {
  return <GuestPokerInner roomCode={roomCode} role={role} profile={profile} />;
}

function GuestPokerInner({ roomCode, role, profile }: Props) {
  // Guest is NOT the host — no heartbeat, no host-only mutations.
  const { session, setSession, isConnected, isLocalOnly, userId } = usePokerSession(
    roomCode,
    /* isHost */ false
  );

  // Auto-join: when we receive the first session and we're not in
  // participants, add ourselves and broadcast. This races safely with
  // the host's heartbeat — last-write-wins on the full session means
  // the host's next snapshot will preserve us (their snapshot is built
  // from the most recent state they received, which includes us).
  const [hasJoined, setHasJoined] = useState(false);
  useEffect(() => {
    if (hasJoined) return;
    if (!session) return;
    if (session.participants.some((p) => p.id === userId)) {
      setHasJoined(true);
      return;
    }
    if (role === "viewer") {
      // Viewers don't appear as voting participants — they observe only.
      setHasJoined(true);
      return;
    }
    setSession((prev) => {
      if (!prev) return prev;
      if (prev.participants.some((p) => p.id === userId)) return prev;
      return {
        ...prev,
        participants: [...prev.participants, { id: userId, name: profile.displayName, vote: null }],
      };
    });
    setHasJoined(true);
  }, [session, userId, profile.displayName, role, hasJoined, setSession]);

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
            className="flex items-center gap-2 border border-amber-500/40 bg-amber-500/10 rounded px-3 py-1.5 text-xs text-amber-200"
          >
            <AlertTriangle className="w-3.5 h-3.5" aria-hidden="true" />
            Realtime not configured. You won&apos;t receive session updates.
          </div>
        )}
        <Link href="/guest" className="text-xs text-sub hover:text-text">
          Back to home
        </Link>
      </main>
    );
  }

  return (
    <div className="min-h-screen px-4 py-4">
      <div className="mx-auto max-w-6xl space-y-3">
        <header className="flex items-center justify-between gap-3 text-xs">
          <Link href="/guest" className="inline-flex items-center gap-1 text-sub hover:text-text">
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
              className={`text-[10px] uppercase font-bold ${
                role === "editor"
                  ? "text-amber-300"
                  : role === "commenter"
                    ? "text-emerald-300"
                    : "text-cyan-300"
              }`}
            >
              {role}
            </span>
          </div>
        </header>
        <SessionScreen
          session={session}
          onUpdateSession={(updater) => setSession((prev) => (prev ? updater(prev) : prev))}
          localParticipantId={userId}
          isHost={false}
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
