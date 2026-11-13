"use client";

/**
 * The Retro host's live room, once it is open: the room hook, the chip with
 * its code, link and QR, "Hide cards while writing", the reactions, the big
 * screen, who is in, End room and the idle prompt. `RetroGoLive`
 * (./host-live-room) mounts it after the consent dialog, loading this module
 * only then (next/dynamic): no channel opens before, and a board that never
 * goes live doesn't download it.
 */

import { useEffect, useRef, useState, type MutableRefObject } from "react";
import { ConfirmDialog } from "@/components/shared/confirm-dialog";
import { VisitorRoomChip } from "@/components/collab/visitor-room-chip";
import { RoomBigScreen, useBigScreen } from "@/components/collab/room-big-screen";
import { RoomReactions } from "@/components/collab/room-reactions";
import { useRoomExtras } from "@/lib/realtime/use-room-extras";
import { useAnnounce } from "@/components/a11y/live-announcer";
import type { VisitorIdentity } from "@/lib/realtime/visitor-rooms";
import { toast } from "@/lib/utils/toast";
import type { BoardState } from "../types";
import { useRetroRoom, type RetroRoomStatus, type EndReason } from "./use-retro-room";
import { HideCardsSetting, IdlePromptDialog, RoomMemberList } from "./room-controls";
import { RetroBigScreenRound, useBoardTimer } from "./big-screen";
import type { HiddenCardsListener, LiveRoomHandle, ThumbsListener } from "./host-live-room";

export interface LiveSession {
  code: string;
  identity: VisitorIdentity;
  startedAt: number;
}

function closedMessage(status: RetroRoomStatus, reason: EndReason | null): string {
  if (status === "expired") {
    return "The live room reached its 3-hour limit and closed. Your board is still here.";
  }
  if (status === "unavailable") return "Live rooms aren't available right now.";
  if (status === "full") return "That room was full.";
  if (reason === "idle") {
    return "The live room ended after 30 minutes without activity. Your board is still here.";
  }
  return "Live room ended. Your board is still here.";
}

export function HostLiveRoom({
  session,
  board,
  onUpdate,
  allowed,
  handleRef,
  onHiddenChange,
  onThumbsChange,
  onClosed,
}: {
  session: LiveSession;
  board: BoardState;
  onUpdate: (updater: (prev: BoardState) => BoardState) => void;
  allowed: boolean;
  handleRef?: MutableRefObject<LiveRoomHandle | null>;
  onHiddenChange?: HiddenCardsListener;
  onThumbsChange?: ThumbsListener;
  onClosed: () => void;
}) {
  const room = useRetroRoom({
    code: session.code,
    identity: session.identity,
    role: "host",
    hostBoard: board,
    onHostUpdate: onUpdate,
    startedAt: session.startedAt,
  });
  // Reactions only: the countdown travels in the snapshot.
  const extras = useRoomExtras(room.extras, { timer: false });
  const big = useBigScreen();
  const bigTimer = useBoardTimer(board);
  const announce = useAnnounce();
  const [confirmEnd, setConfirmEnd] = useState(false);
  const { end, status, endReason } = room;
  const onClosedRef = useRef(onClosed);
  onClosedRef.current = onClosed;

  useEffect(() => {
    if (!handleRef) return;
    handleRef.current = { end: () => end() };
    return () => {
      handleRef.current = null;
    };
  }, [handleRef, end]);

  // The Board hides the participants' cards on this screen while the room does.
  // It gets the check itself, not a list: a list passed on after this render
  // would let a card that just arrived show for one render first.
  const { hidesCard } = room;
  const onHiddenRef = useRef(onHiddenChange);
  onHiddenRef.current = onHiddenChange;
  useEffect(() => {
    onHiddenRef.current?.(hidesCard);
  }, [hidesCard]);
  useEffect(() => () => onHiddenRef.current?.(null), []);

  // The Lean Coffee runner asks the room "keep going or move on?" through these.
  const { thumbs } = room;
  const onThumbsRef = useRef(onThumbsChange);
  onThumbsRef.current = onThumbsChange;
  useEffect(() => {
    onThumbsRef.current?.(status === "live" ? thumbs : null);
  }, [thumbs, status]);
  useEffect(() => () => onThumbsRef.current?.(null), []);

  // Owners don't run visitor rooms: if this browser turns out to be the
  // owner's mid-room, close it before any stranger's card can sync.
  useEffect(() => {
    if (!allowed) end();
  }, [allowed, end]);

  useEffect(() => {
    if (status === "live") {
      announce("Live room started. Share it with your team: Copy link or Show QR code.");
      return;
    }
    if (status === "connecting") return;
    const message = closedMessage(status, endReason);
    announce(message);
    if (status === "unavailable") toast.error(message);
    else toast.success(message);
    onClosedRef.current();
  }, [status, endReason, announce]);

  const others = room.members.filter((m) => m.id !== room.selfId);

  return (
    <div className="flex flex-col items-start gap-2">
      <VisitorRoomChip
        tool="retro"
        code={session.code}
        memberCount={room.members.length}
        isHost
        onEnd={() => setConfirmEnd(true)}
        onBigScreen={big.show}
      />
      <HideCardsSetting checked={room.hideWhileWriting} onChange={room.setHideWhileWriting} />
      {status === "live" && <RoomReactions extras={extras} />}
      <RoomBigScreen
        {...big.props}
        tool="retro"
        toolName="Retro"
        code={session.code}
        memberCount={room.members.length}
        timer={bigTimer}
        reactions={extras.reactions}
      >
        <RetroBigScreenRound board={board} hidesCard={room.hidesCard} poll={room.poll} />
      </RoomBigScreen>
      {others.length > 0 && (
        <RoomMemberList
          members={room.members}
          selfId={room.selfId}
          hostId={room.selfId}
          removedIds={room.removedIds}
          onRemove={(id, name) => {
            room.kick(id);
            toast.success(`Removed ${name}. If they come back, end the room and share a new link.`);
          }}
        />
      )}
      <ConfirmDialog
        open={confirmEnd}
        onOpenChange={setConfirmEnd}
        title="End the live room?"
        description="Everyone in the room is disconnected. Your board stays here."
        confirmLabel="End room"
        onConfirm={() => end()}
      />
      <IdlePromptDialog open={room.idlePrompt} onKeepOpen={room.keepOpen} onEnd={() => end()} />
    </div>
  );
}
