"use client";

/**
 * A tool's entry point for a show room (Picker, Team Mixer, Card Decks):
 * "Show on everyone's phones" asks for a name and consent, then opens the
 * room; no key or channel exists before that. While it is open, the tool's
 * own controls (the render prop) call `room.show(kind, payload)` to put a
 * frame on everyone's screen, and the panel shows the same frame as a
 * preview, the room's code, link and QR code, who is in, how many said
 * "I'm here", Clear screen and End room.
 *
 *   <ShowRoomHost tool="picker" toolName="Picker">
 *     {(room) => <Button onClick={() => room.show("text", { title: "Sam" })}>Show</Button>}
 *   </ShowRoomHost>
 *
 * Nothing is saved: participants send nothing but "I'm here".
 */

import { useEffect, useRef, useState, type ReactNode } from "react";
import { Eraser, MonitorUp } from "lucide-react";
import { Button } from "@/components/ui/button";
import { ConfirmDialog } from "@/components/shared/confirm-dialog";
import { useAnnounce } from "@/components/a11y/live-announcer";
import { VisitorRoomChip } from "@/components/collab/visitor-room-chip";
import { VisitorRoomConsent } from "@/components/collab/visitor-room-consent";
import { IdlePromptDialog, RoomMemberList } from "@/components/collab/room-controls";
import { RoomBigScreen, useBigScreen } from "@/components/collab/room-big-screen";
import { RoomTimerControls } from "@/components/collab/room-countdown";
import { RoomReactions } from "@/components/collab/room-reactions";
import { LiveRoomLimits } from "@/components/collab/run-modes";
import { useRoomExtras } from "@/lib/realtime/use-room-extras";
import { signalGamification } from "@/lib/gamification/signal";
import {
  clearVisitorIdentity,
  newVisitorRoomCode,
  saveVisitorIdentity,
  type VisitorIdentity,
} from "@/lib/realtime/visitor-rooms";
import { readVoteLinkFragment, type VoteCrypto } from "@/lib/realtime/vote-room/crypto";
import { useVoteRoomsAvailable } from "@/lib/realtime/vote-room/use-vote-room";
import type { ShowRoomTool } from "@/lib/realtime/show-room/protocol";
import { useShowRoom, type ShowRoom } from "@/lib/realtime/show-room/use-show-room";
import { isSignedRoomClosed } from "@/lib/realtime/use-signed-room";
import { toast } from "@/lib/utils/toast";
import { liveOnlyReason } from "@/components/collab/live-room-reasons";
import { ShowFrameView } from "./show-frame-view";

export interface ShowRoomHostProps {
  tool: ShowRoomTool;
  /** Shown in the consent title and the panel, e.g. "Picker". */
  toolName: string;
  /** The tool's own controls while the room is live. */
  children?: (room: ShowRoom) => ReactNode;
  /** The start button's words. */
  startLabel?: string;
  /** One line under the start button: what everyone will see. */
  description?: ReactNode;
  /** Tests inject a fake (undefined: WebCrypto). */
  crypto?: VoteCrypto | null;
}

interface Session {
  code: string;
  identity: VisitorIdentity;
  startedAt: number;
}

export function ShowRoomHost({
  tool,
  toolName,
  children,
  startLabel = "Show on everyone's phones",
  description,
  crypto,
}: ShowRoomHostProps) {
  const availability = useVoteRoomsAvailable(crypto);
  const [consentOpen, setConsentOpen] = useState(false);
  const [session, setSession] = useState<Session | null>(null);
  const startRef = useRef<HTMLButtonElement>(null);
  const refocus = useRef(false);

  useEffect(() => {
    if (session || !refocus.current) return;
    refocus.current = false;
    startRef.current?.focus();
  }, [session]);

  if (session) {
    return (
      <HostShowRoom
        key={session.code}
        tool={tool}
        toolName={toolName}
        session={session}
        crypto={crypto}
        onClosed={() => {
          clearVisitorIdentity(session.code);
          refocus.current = true;
          setSession(null);
        }}
      >
        {children}
      </HostShowRoom>
    );
  }

  const pending = availability.reason === "auth-pending";
  const reason = liveOnlyReason(availability.reason);
  if (!availability.available && !pending) {
    return reason ? <p className="text-sm text-sub">{reason}</p> : null;
  }

  return (
    <div className="space-y-2">
      {description && <div className="text-sm text-sub">{description}</div>}
      <LiveRoomLimits />
      <Button
        ref={startRef}
        type="button"
        variant="toolkit"
        className="gap-1.5"
        disabled={pending}
        onClick={() => setConsentOpen(true)}
      >
        <MonitorUp className="h-4 w-4" aria-hidden="true" />
        {startLabel}
      </Button>
      {pending && (
        <p role="status" className="text-xs text-sub">
          Checking whether live rooms work here…
        </p>
      )}
      <VisitorRoomConsent
        open={consentOpen}
        onOpenChange={setConsentOpen}
        mode="start"
        variant="show"
        toolName={toolName}
        onConfirm={(name) => {
          const code = newVisitorRoomCode();
          const identity = saveVisitorIdentity(code, name);
          if (!identity) {
            toast.error("Couldn't start the room. Try again.");
            return;
          }
          setConsentOpen(false);
          setSession({ code, identity, startedAt: Date.now() });
          signalGamification("invite-created", { toolId: tool });
        }}
      />
    </div>
  );
}

function HostShowRoom({
  tool,
  toolName,
  session,
  crypto,
  onClosed,
  children,
}: {
  tool: ShowRoomTool;
  toolName: string;
  session: Session;
  crypto?: VoteCrypto | null;
  onClosed: () => void;
  children?: (room: ShowRoom) => ReactNode;
}) {
  const room = useShowRoom({
    role: "host",
    tool,
    code: session.code,
    identity: session.identity,
    startedAt: session.startedAt,
    crypto,
  });
  const extras = useRoomExtras(room.extras);
  const big = useBigScreen();
  const announce = useAnnounce();
  const [confirmEnd, setConfirmEnd] = useState(false);
  const [notice, setNotice] = useState<string | null>(null);
  const closedRef = useRef<HTMLHeadingElement>(null);
  const { status } = room;
  const closed = isSignedRoomClosed(status);

  const lastStatus = useRef(status);
  useEffect(() => {
    const prev = lastStatus.current;
    lastStatus.current = status;
    if (prev === status) return;
    if (status === "live") announce("Live room started. Share it with Copy link or Show QR code.");
    if (closed) closedRef.current?.focus();
  }, [status, closed, announce]);

  if (closed) {
    return (
      <section className="space-y-3 rounded-lg border border-border bg-card p-3 sm:p-4">
        <h2
          ref={closedRef}
          tabIndex={-1}
          className="text-base font-semibold text-text outline-none"
        >
          {status === "expired"
            ? "The room reached its 3-hour limit and closed"
            : status === "unavailable"
              ? "Live rooms aren't available right now"
              : room.endReason === "idle"
                ? "The room ended after 30 minutes without activity"
                : "You ended the live room"}
        </h2>
        <p className="text-sm text-sub">Nothing from the room was kept.</p>
        <Button type="button" variant="outline" onClick={onClosed}>
          Close
        </Button>
      </section>
    );
  }

  const hash = room.joinPath ? room.joinPath.slice(room.joinPath.indexOf("#")) : "";
  const fingerprint = readVoteLinkFragment(hash);
  const others = room.members.filter((m) => m.id !== room.selfId);

  return (
    <section
      aria-label={`Live ${toolName} room`}
      className="space-y-4 rounded-lg border border-accent/30 bg-card p-3 sm:p-4"
    >
      {status !== "live" || !room.joinPath ? (
        <p role="status" className="text-sm text-sub">
          {status === "preparing" ? "Preparing the room…" : "Connecting to the room…"}
        </p>
      ) : (
        <div className="space-y-1">
          <VisitorRoomChip
            tool={tool}
            code={session.code}
            memberCount={room.members.length}
            isHost
            onEnd={() => setConfirmEnd(true)}
            linkFragment={fingerprint ? `#k=${fingerprint}` : undefined}
            onBigScreen={big.show}
          />
          <p className="text-xs text-sub">
            Share it with Copy link or Show QR code: both carry the key that shows the screen comes
            from you. Everyone sees what you show here; nothing is kept.
          </p>
        </div>
      )}
      <RoomBigScreen
        {...big.props}
        tool={tool}
        toolName={toolName}
        code={session.code}
        linkFragment={fingerprint ? `#k=${fingerprint}` : undefined}
        memberCount={room.members.length}
        timer={extras.timer}
        reactions={extras.reactions}
      >
        <ShowFrameView tool={tool} frame={room.frame} surface="phone" announceNew={false} />
      </RoomBigScreen>

      <div className="space-y-2">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <h2 className="text-sm font-semibold text-text">On everyone&apos;s screen</h2>
          <p className="text-xs text-sub" aria-live="polite">
            {room.hereCount} of {others.length} {others.length === 1 ? "person" : "people"} said
            they&apos;re here.
          </p>
        </div>
        <ShowFrameView
          tool={tool}
          frame={room.frame}
          surface="host"
          emptyText="Nothing yet. What you show appears here and on everyone's phone."
        />
        {room.frame && (
          <Button type="button" variant="ghost" size="sm" className="gap-1.5" onClick={room.clear}>
            <Eraser className="h-3.5 w-3.5" aria-hidden="true" />
            Clear the screen
          </Button>
        )}
      </div>

      {children?.(room)}

      <RoomTimerControls
        timer={extras.timer}
        onChange={extras.setTimer}
        disabled={!extras.canSetTimer || status !== "live"}
      />
      <RoomReactions extras={extras} />

      {others.length > 0 && (
        <RoomMemberList
          members={room.members}
          selfId={room.selfId}
          hostId={room.selfId}
          removedIds={room.removedIds}
          onRemove={(id, name) => {
            room.kick(id);
            setNotice(`Removed ${name}. If they come back, end the room and share a new link.`);
          }}
        />
      )}
      {notice && (
        <p role="status" className="text-xs text-sub">
          {notice}
        </p>
      )}

      <ConfirmDialog
        open={confirmEnd}
        onOpenChange={setConfirmEnd}
        title="End the live room?"
        description="Everyone in the room is disconnected. Nothing from the room is kept."
        confirmLabel="End room"
        onConfirm={() => room.end()}
      />
      <IdlePromptDialog
        open={room.idlePrompt}
        onKeepOpen={room.keepOpen}
        onEnd={() => room.end()}
      />
    </section>
  );
}
