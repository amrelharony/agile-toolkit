"use client";

/**
 * A participant in a Planning Poker visitor live room (`/join/planning-poker/<code>`).
 *
 * Mounted only after the consent dialog produced `identity`, so the
 * channel never opens before consent. Votes from this device; the host
 * runs the stories. Nothing from the room is written anywhere: no
 * workspace store, no history, no cloud. "Save a copy" downloads the
 * session as Markdown when the person asks for it.
 *
 * If the host's tab closes without ending the room, the earliest-joined
 * participant takes over as host after 10 s (the hook's host migration),
 * and gets the host controls here: stories, reveal, remove, End room.
 */

import { useEffect, useMemo, useRef, useState } from "react";
import Link from "next/link";
import { AlertTriangle, Check, Download, Loader2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { useAnnounce } from "@/components/a11y/live-announcer";
import { exportToMarkdown } from "@/lib/utils/export";
import { useFlash } from "@/hooks/use-flash";
import { VISITOR_LIMITS, type VisitorIdentity } from "@/lib/realtime/visitor-rooms";
import { useRoomExtras } from "@/lib/realtime/use-room-extras";
import { RoomReactions } from "@/components/collab/room-reactions";
import { SessionScreen } from "./session-screen";
import { usePokerSession, type VisitorLeaveReason } from "./use-poker-session";
import { useAutoSeat } from "./use-auto-seat";
import { PokerRoomBar } from "./poker-room-bar";
import { toMarkdown } from "./markdown";
import type { Session } from "./types";

/** After this long without a session, say what might be wrong. */
const WAITING_HINT_MS = 20_000;

export interface VisitorPokerRoomProps {
  code: string;
  identity: VisitorIdentity;
  /** The person left the room (or dismissed the end screen). */
  onLeave: () => void;
}

export function VisitorPokerRoom({ code, identity, onLeave }: VisitorPokerRoomProps) {
  const {
    session,
    setSession,
    isConnected,
    isLocalOnly,
    userId,
    isHost,
    memberCount,
    roomFull,
    leftReason,
    kick,
    endRoom,
    idleWarning,
    keepRoomOpen,
    extras: extrasPort,
  } = usePokerSession(code, /* isHost */ false, { visitor: true, identity });
  const extras = useRoomExtras(extrasPort);

  // Sit down in the host's session; never again once removed or out.
  useAutoSeat({
    session,
    setSession,
    userId,
    name: identity.name,
    enabled: leftReason === null && !roomFull,
    maxParticipants: VISITOR_LIMITS.maxMembers,
  });

  const [waitingLong, setWaitingLong] = useState(false);
  useEffect(() => {
    if (session || roomFull || leftReason !== null || isLocalOnly) return;
    const t = window.setTimeout(() => setWaitingLong(true), WAITING_HINT_MS);
    return () => window.clearTimeout(t);
  }, [session, roomFull, leftReason, isLocalOnly]);

  if (roomFull) {
    return (
      <RoomNotice
        title={`This room is full (${VISITOR_LIMITS.maxMembers} people)`}
        announcement={`This room is full. It already has ${VISITOR_LIMITS.maxMembers} people.`}
        onLeave={onLeave}
      >
        Ask the host to make space, or to start another room for part of the team.
      </RoomNotice>
    );
  }

  if (leftReason !== null) {
    return <RoomOver reason={leftReason} session={session} code={code} />;
  }

  if (isLocalOnly) {
    return (
      <RoomNotice
        title="Live rooms aren't available right now"
        announcement="Live rooms aren't available right now."
        onLeave={onLeave}
      >
        This site can&apos;t reach its realtime service, so the room can&apos;t connect.
      </RoomNotice>
    );
  }

  if (!session) {
    return (
      <main className="min-h-screen-dvh flex flex-col items-center justify-center gap-4 px-4 text-center">
        <div className="flex items-center gap-2 text-sub text-sm" role="status">
          <Loader2 className="w-4 h-4 animate-spin" aria-hidden="true" />
          {isConnected ? "Waiting for the host to share the session…" : "Connecting to the room…"}
        </div>
        {waitingLong && (
          <p className="max-w-sm text-sm text-sub">
            Still waiting? The room may have ended, or the host&apos;s screen may be asleep. Ask the
            host for the link again.
          </p>
        )}
        <Button type="button" variant="ghost" size="sm" onClick={onLeave}>
          Leave
        </Button>
      </main>
    );
  }

  return (
    <div className="min-h-screen-dvh px-4 py-4">
      <div className="mx-auto max-w-6xl space-y-3">
        <PokerRoomBar
          code={code}
          memberCount={memberCount}
          isHost={isHost}
          onEnd={isHost ? endRoom : undefined}
          idleWarning={idleWarning}
          onKeepOpen={keepRoomOpen}
          extras={extras}
        />
        <SessionScreen
          session={session}
          onUpdateSession={(updater) => setSession((prev) => (prev ? updater(prev) : prev))}
          localParticipantId={userId}
          isHost={isHost}
          onLeave={onLeave}
          extraHeaderActions={<SaveCopyButton session={session} code={code} />}
          connectionLabel={isConnected ? "Live room" : "Reconnecting…"}
          connectionTone={isConnected ? "live" : "warn"}
          // The code is in the room chip above.
          showRoomCode={false}
          recordHistory={false}
          onRemoveParticipant={isHost ? (p) => kick(p.id) : undefined}
          revealAtZero={isHost ? extras.timer : null}
        />
        <RoomReactions extras={extras} className="pt-2" />
      </div>
    </div>
  );
}

/** Download what this person saw of the session, as Markdown. */
function SaveCopyButton({ session, code }: { session: Session | null; code: string }) {
  const markdown = useMemo(() => toMarkdown(session), [session]);
  const { flash, isFlashing } = useFlash();
  if (!session) return null;
  const done = isFlashing();
  return (
    <Button
      type="button"
      variant="outline"
      size="sm"
      className="gap-1.5 text-xs h-8"
      onClick={() => {
        exportToMarkdown(markdown, `planning-poker-${code}`);
        flash("Saved a copy as Markdown");
      }}
    >
      {done ? (
        <Check className="w-3.5 h-3.5" aria-hidden="true" />
      ) : (
        <Download className="w-3.5 h-3.5" aria-hidden="true" />
      )}
      {done ? "Saved" : "Save a copy"}
    </Button>
  );
}

const OVER_TITLES: Record<VisitorLeaveReason, string> = {
  "host-ended": "The host ended the room",
  ended: "You ended the room",
  kicked: "The host removed you from the room",
  expired: `The room closed after ${Math.round(VISITOR_LIMITS.hardTtlMs / 3_600_000)} hours`,
  idle: "The room closed after a long time without activity",
};

function RoomOver({
  reason,
  session,
  code,
}: {
  reason: VisitorLeaveReason;
  session: Session | null;
  code: string;
}) {
  const estimated = session?.stories.filter((s) => s.finalEstimate !== null).length ?? 0;
  const total = session?.stories.length ?? 0;
  return (
    <RoomNotice
      title={OVER_TITLES[reason]}
      announcement={
        reason === "kicked" ? OVER_TITLES.kicked : `Room ended. ${OVER_TITLES[reason]}.`
      }
      actions={
        reason !== "kicked" && session && total > 0 ? (
          <SaveCopyButton session={session} code={code} />
        ) : null
      }
    >
      {reason === "kicked"
        ? "You're no longer in the room."
        : total > 0
          ? `Nothing from the room was stored. ${estimated} of ${total} ${total === 1 ? "story" : "stories"} had an estimate; save a copy to keep them.`
          : "Nothing from the room was stored."}
    </RoomNotice>
  );
}

/**
 * A full-page notice that takes focus (its heading) when it appears, and
 * announces itself politely.
 */
function RoomNotice({
  title,
  announcement,
  children,
  actions,
  onLeave,
  leaveLabel = "Back",
}: {
  title: string;
  announcement: string;
  children: React.ReactNode;
  actions?: React.ReactNode;
  /** Shows a "Back" button; omitted once the room is over. */
  onLeave?: () => void;
  leaveLabel?: string;
}) {
  const headingRef = useRef<HTMLHeadingElement>(null);
  const announce = useAnnounce();
  useEffect(() => {
    headingRef.current?.focus();
    announce(announcement);
  }, [announcement, announce]);
  return (
    <main className="min-h-screen-dvh flex items-center justify-center px-4">
      <section className="w-full max-w-md rounded-xl border border-border bg-surface p-6 flex flex-col gap-4">
        <h1
          ref={headingRef}
          tabIndex={-1}
          className="flex items-start gap-2 text-lg font-semibold text-text outline-none"
        >
          <AlertTriangle className="mt-1 h-4 w-4 shrink-0 text-warning" aria-hidden="true" />
          {title}
        </h1>
        <p className="text-sm text-sub">{children}</p>
        <div className="flex flex-wrap items-center gap-2">
          {actions}
          {onLeave && (
            <Button type="button" variant="ghost" size="sm" onClick={onLeave}>
              {leaveLabel}
            </Button>
          )}
          <Link
            href="/"
            className="min-touch-coarse inline-flex items-center px-2 rounded text-sm text-sub hover:text-text"
          >
            Go to the Agile Toolkit
          </Link>
        </div>
      </section>
    </main>
  );
}
