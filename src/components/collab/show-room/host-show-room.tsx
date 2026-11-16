"use client";

/**
 * A show room once it is open, on the host's screen: the room hook, the
 * chip with its code, link and QR, the frame on everyone's screen and its
 * preview, the tool's own controls (`children`), the timer, the reactions,
 * who is in, End room and the idle prompt. `ShowRoomHost` mounts it after
 * the consent dialog, loading this module only then (next/dynamic): no key
 * or channel exists before, and a tool page that never opens a room doesn't
 * download any of it.
 */

import { useEffect, useRef, useState, type ReactNode } from "react";
import { Eraser } from "lucide-react";
import { Button } from "@/components/ui/button";
import { ConfirmDialog } from "@/components/shared/confirm-dialog";
import { useAnnounce } from "@/components/a11y/live-announcer";
import { VisitorRoomChip } from "@/components/collab/visitor-room-chip";
import { IdlePromptDialog, RoomMemberList } from "@/components/collab/room-controls";
import { RoomBigScreen, useBigScreen } from "@/components/collab/room-big-screen";
import { RoomTimerControls } from "@/components/collab/room-countdown";
import { RoomReactions } from "@/components/collab/room-reactions";
import { useRoomExtras } from "@/lib/realtime/use-room-extras";
import type { VisitorIdentity } from "@/lib/realtime/visitor-rooms";
import { readVoteLinkFragment, type VoteCrypto } from "@/lib/realtime/vote-room/crypto";
import type { ShowRoomTool } from "@/lib/realtime/show-room/protocol";
import { useShowRoom, type ShowRoom } from "@/lib/realtime/show-room/use-show-room";
import { isSignedRoomClosed } from "@/lib/realtime/use-signed-room";
import { ShowFrameView } from "./show-frame-view";

export interface ShowSession {
  code: string;
  identity: VisitorIdentity;
  startedAt: number;
}

export function HostShowRoom({
  tool,
  toolName,
  session,
  crypto,
  onClosed,
  children,
}: {
  tool: ShowRoomTool;
  toolName: string;
  session: ShowSession;
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
        <ShowBigScreenFrame tool={tool} frame={room.frame} />
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

/**
 * The frame on the host's Big screen: a phone's large layout, but nothing
 * to press or type (the Big screen holds no controls), and no "something
 * new" announcement (the host's page says its own).
 */
export function ShowBigScreenFrame({
  tool,
  frame,
}: {
  tool: ShowRoomTool;
  frame: ShowRoom["frame"];
}) {
  return (
    <ShowFrameView
      tool={tool}
      frame={frame}
      surface="phone"
      announceNew={false}
      interactive={false}
    />
  );
}
