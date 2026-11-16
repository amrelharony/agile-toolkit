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
 * the room hook only mounts afterwards, in the open room's own module
 * (./host-live-session), which loads only then.
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
import dynamic from "next/dynamic";
import { Check, Monitor, Radio } from "lucide-react";
import { Button } from "@/components/ui/button";
import { VisitorRoomConsent } from "@/components/collab/visitor-room-consent";
import { LiveRoomLimits, RUN_MODES } from "@/components/collab/run-modes";
import { useOwnerState } from "@/lib/auth/use-is-owner";
import { useGuestProfile } from "@/lib/auth/guest-profile-provider";
import {
  clearVisitorIdentity,
  newVisitorRoomCode,
  saveVisitorIdentity,
  visitorRoomsEnabled,
} from "@/lib/realtime/visitor-rooms";
import { toast } from "@/lib/utils/toast";
import { signalGamification } from "@/lib/gamification/signal";
import type { BoardState } from "../types";
import type { RetroThumbsHost } from "./use-retro-room";
import type { LiveSession } from "./host-live-session";

/** The open room (./host-live-session): it loads once the host has agreed to open one. */
const HostLiveRoom = dynamic(() => import("./host-live-session").then((m) => m.HostLiveRoom), {
  ssr: false,
});

/**
 * Told whether the host's screen hides cards: a check to ask, card by card,
 * while drawing in Write (the room's `hidesCard`), or null when it hides none.
 */
export type HiddenCardsListener = (hidesCard: ((cardId: string) => boolean) | null) => void;

/**
 * Told the room's thumbs vote controls while the room is live (the Lean
 * Coffee runner asks "keep going or move on?" through them), or null.
 */
export type ThumbsListener = (thumbs: RetroThumbsHost | null) => void;

/** Lets the Board end the room before "New Retro" clears it. */
export interface LiveRoomHandle {
  end: () => void;
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
  onThumbsChange,
}: {
  board: BoardState;
  onUpdate: (updater: (prev: BoardState) => BoardState) => void;
  handleRef?: MutableRefObject<LiveRoomHandle | null>;
  /** Told which participants' cards to hide on the host's screen. */
  onHiddenChange?: HiddenCardsListener;
  /** Told the room's thumbs vote controls while it's live. */
  onThumbsChange?: ThumbsListener;
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
        onThumbsChange={onThumbsChange}
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
