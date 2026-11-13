"use client";

/**
 * The Retro board's two ways to run it, for visitors only: "One screen"
 * (the board as it is, shown as the way it runs now) and "Everyone on
 * their own device" (a live room; the button was "Go live"), with the live
 * room's limits beside it (components/collab/run-modes).
 *
 * Shown when `NEXT_PUBLIC_VISITOR_ROOMS=1` and the viewer is a confirmed
 * visitor: not the owner (strangers' cards would sync into the owner's
 * workspace) and not a squad guest. The flow is consent and name in one
 * dialog, then the room. No channel opens before the dialog is confirmed:
 * the room hook only mounts afterwards.
 *
 * The host's board stays its own workspace board. Participants' cards land
 * on it through the Board's own updater; ending the room keeps everything.
 * The live state itself is component state only, never persisted, so a
 * reload never reopens a room silently.
 *
 * "Hide cards while writing" sits in the host's strip, on by default: in
 * Write each person sees only their own cards, and `onHiddenChange` hands
 * the Board the room's `hidesCard`, which it asks while drawing so the
 * participants' cards stay hidden on this screen too, from the first render
 * a new one appears in. The setting lasts as long as the room.
 */

import { useEffect, useId, useRef, useState, type MutableRefObject } from "react";
import { Check, Monitor, Radio } from "lucide-react";
import { Button } from "@/components/ui/button";
import { ConfirmDialog } from "@/components/shared/confirm-dialog";
import { VisitorRoomConsent } from "@/components/collab/visitor-room-consent";
import { VisitorRoomChip } from "@/components/collab/visitor-room-chip";
import { RoomBigScreen, useBigScreen } from "@/components/collab/room-big-screen";
import { RoomReactions } from "@/components/collab/room-reactions";
import { LiveRoomLimits, RUN_MODES } from "@/components/collab/run-modes";
import { useRoomExtras } from "@/lib/realtime/use-room-extras";
import { useAnnounce } from "@/components/a11y/live-announcer";
import { useOwnerState } from "@/lib/auth/use-is-owner";
import { useGuestProfile } from "@/lib/auth/guest-profile-provider";
import {
  clearVisitorIdentity,
  newVisitorRoomCode,
  saveVisitorIdentity,
  visitorRoomsEnabled,
  type VisitorIdentity,
} from "@/lib/realtime/visitor-rooms";
import { toast } from "@/lib/utils/toast";
import { signalGamification } from "@/lib/gamification/signal";
import type { BoardState } from "../types";
import { useRetroRoom, type RetroRoomStatus, type EndReason } from "./use-retro-room";
import { HideCardsSetting, IdlePromptDialog, RoomMemberList } from "./room-controls";
import { RetroBigScreenRound, useBoardTimer } from "./big-screen";

/**
 * Told whether the host's screen hides cards: a check to ask, card by card,
 * while drawing in Write (the room's `hidesCard`), or null when it hides none.
 */
export type HiddenCardsListener = (hidesCard: ((cardId: string) => boolean) | null) => void;

/** Lets the Board end the room before "New Retro" clears it. */
export interface LiveRoomHandle {
  end: () => void;
}

interface LiveSession {
  code: string;
  identity: VisitorIdentity;
  startedAt: number;
}

/** Whether this viewer may start a visitor room: flag on, a confirmed visitor, not a guest. */
export function useCanGoLive(): boolean {
  const { visitor } = useOwnerState();
  const guest = useGuestProfile();
  return visitorRoomsEnabled() && visitor && guest === null;
}

export function RetroGoLive({
  board,
  onUpdate,
  handleRef,
  onHiddenChange,
}: {
  board: BoardState;
  onUpdate: (updater: (prev: BoardState) => BoardState) => void;
  handleRef?: MutableRefObject<LiveRoomHandle | null>;
  /** Told which participants' cards to hide on the host's screen. */
  onHiddenChange?: HiddenCardsListener;
}) {
  const allowed = useCanGoLive();
  const [consentOpen, setConsentOpen] = useState(false);
  const [live, setLive] = useState<LiveSession | null>(null);
  const goLiveRef = useRef<HTMLButtonElement>(null);
  const refocus = useRef(false);
  const labelId = useId();
  const limitsId = useId();

  // After the room closes, put focus back on "Everyone on their own device"
  // rather than losing it.
  useEffect(() => {
    if (live || !refocus.current) return;
    refocus.current = false;
    goLiveRef.current?.focus();
  }, [live]);

  if (live) {
    return (
      <HostLiveRoom
        key={live.code}
        session={live}
        board={board}
        onUpdate={onUpdate}
        allowed={allowed}
        handleRef={handleRef}
        onHiddenChange={onHiddenChange}
        onClosed={() => {
          clearVisitorIdentity(live.code);
          refocus.current = true;
          setLive(null);
        }}
      />
    );
  }
  if (!allowed) return null;

  return (
    <>
      <div role="group" aria-labelledby={labelId} className="flex flex-col items-start gap-1">
        <span id={labelId} className="sr-only">
          How you run this retro
        </span>
        <div className="flex flex-wrap items-center gap-1.5">
          {/* The way it runs now: this board, on this screen. */}
          <span className="inline-flex min-h-[36px] items-center gap-1.5 rounded-md border border-accent/40 bg-accent/10 px-3 text-xs font-medium text-accent pointer-coarse:min-h-11">
            <Monitor className="w-3.5 h-3.5" aria-hidden="true" />
            {RUN_MODES.oneScreen}
            <Check className="w-3.5 h-3.5" aria-hidden="true" />
            <span className="sr-only">, how it runs now</span>
          </span>
          <Button
            ref={goLiveRef}
            type="button"
            variant="outline"
            size="sm"
            className="gap-1.5"
            aria-describedby={limitsId}
            onClick={() => setConsentOpen(true)}
          >
            <Radio className="w-3.5 h-3.5" aria-hidden="true" />
            {RUN_MODES.ownDevice}
          </Button>
        </div>
        <LiveRoomLimits id={limitsId} />
      </div>
      <VisitorRoomConsent
        open={consentOpen}
        onOpenChange={setConsentOpen}
        mode="start"
        toolName="Retro"
        onConfirm={(name) => {
          const code = newVisitorRoomCode();
          const identity = saveVisitorIdentity(code, name);
          if (!identity) {
            toast.error("Couldn't start the room. Try again.");
            return;
          }
          setConsentOpen(false);
          setLive({ code, identity, startedAt: Date.now() });
          signalGamification("invite-created", { toolId: "retro" });
        }}
      />
    </>
  );
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

function HostLiveRoom({
  session,
  board,
  onUpdate,
  allowed,
  handleRef,
  onHiddenChange,
  onClosed,
}: {
  session: LiveSession;
  board: BoardState;
  onUpdate: (updater: (prev: BoardState) => BoardState) => void;
  allowed: boolean;
  handleRef?: MutableRefObject<LiveRoomHandle | null>;
  onHiddenChange?: HiddenCardsListener;
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
        <RetroBigScreenRound board={board} hidesCard={room.hidesCard} />
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
