"use client";

/**
 * A visitor room on the big screen: Present mode (`presentation-mode.tsx`)
 * with the room's join code large and grouped, its QR code, how many are in
 * the room, the host's countdown, the reactions, and whatever the tool puts
 * in (the current round or its results). It's for the people in the room to
 * look at, so nothing in it is a control: the host leaves it with Exit
 * presentation (or Escape) and runs the room from the page as before.
 *
 *   const big = useBigScreen();
 *   <VisitorRoomChip … onBigScreen={big.show} />
 *   <RoomBigScreen {...big.props} tool={tool} toolName="Quick Vote" code={code}
 *     linkFragment={`#k=${fp}`} memberCount={room.members.length}
 *     timer={extras.timer} reactions={extras.reactions}>
 *     <VoteLiveCount … />
 *   </RoomBigScreen>
 *
 * The view itself (`room-big-screen-view.tsx`, with the QR encoder) loads
 * only when the host opens it, so a participant's room and a host who never
 * presents don't carry it. It sits in a portal over the page, so the room
 * underneath keeps running (and keeps ringing its own timer: the countdown
 * on the big screen has no alarm).
 */

import { useCallback, useEffect, useRef, useState, type ReactNode } from "react";
import dynamic from "next/dynamic";
import { startPresenting, usePresentation } from "@/components/presentation/presentation-mode";
import type { VisitorTool } from "@/lib/realtime/visitor-rooms";
import type { RoomTimer } from "@/lib/realtime/room-timer";
import type { FloatingReaction } from "@/lib/realtime/room-reactions";

const RoomBigScreenView = dynamic(
  () => import("./room-big-screen-view").then((m) => m.RoomBigScreenView),
  { ssr: false }
);

/**
 * Open and close the big screen. `show` enters Present mode in the same
 * tick as the click, so the browser lets it go fullscreen.
 */
export function useBigScreen(): {
  open: boolean;
  show: () => void;
  props: { open: boolean; onClose: () => void };
} {
  const [open, setOpen] = useState(false);
  const show = useCallback(() => {
    startPresenting();
    setOpen(true);
  }, []);
  const onClose = useCallback(() => setOpen(false), []);
  return { open, show, props: { open, onClose } };
}

export interface RoomBigScreenProps {
  open: boolean;
  /** Present mode ended (Exit, Escape, leaving fullscreen), or the room closed. */
  onClose: () => void;
  tool: VisitorTool;
  /** e.g. "Planning Poker". */
  toolName: string;
  code: string;
  /** The join link's fragment, e.g. `#k=<host key>`, for the QR code. */
  linkFragment?: string;
  /** People in the room, the host included. */
  memberCount: number;
  timer?: RoomTimer | null;
  reactions?: readonly FloatingReaction[];
  /** The current round or its results, drawn large. Nothing in it should need a click. */
  children?: ReactNode;
}

export function RoomBigScreen(props: RoomBigScreenProps) {
  const { open, onClose } = props;
  const presenting = usePresentation((s) => s.presenting);
  const closeRef = useRef(onClose);
  closeRef.current = onClose;

  // Present mode ended some other way (Exit, Escape, leaving fullscreen),
  // even before the view finished loading: the big screen goes with it.
  const sawPresentingRef = useRef(false);
  useEffect(() => {
    if (!open) {
      sawPresentingRef.current = false;
      return;
    }
    if (presenting) sawPresentingRef.current = true;
    else if (sawPresentingRef.current) closeRef.current();
  }, [open, presenting]);

  // Escape closes it even where the shell's controller isn't listening.
  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") closeRef.current();
    };
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, [open]);

  if (!open) return null;
  return <RoomBigScreenView {...props} />;
}
