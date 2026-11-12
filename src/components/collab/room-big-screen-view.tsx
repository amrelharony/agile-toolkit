"use client";

/**
 * The big screen itself, loaded by `RoomBigScreen` (room-big-screen.tsx)
 * only once the host opens it: the code in groups, the QR code, who's in,
 * the countdown (no alarm: the room's own page rings), the reactions and
 * the tool's round, in a portal over the page. While open it keeps Present
 * mode on, and closes when Present mode ends (Exit, Escape, leaving
 * fullscreen) or the room goes.
 */

import { useEffect, useRef } from "react";
import { createPortal } from "react-dom";
import { Radio, Users } from "lucide-react";
import { QrCode } from "@/components/collab/qr-code";
import { RoomCountdown } from "@/components/collab/room-countdown";
import { ReactionLayer } from "@/components/collab/room-reactions";
import {
  startPresenting,
  stopPresenting,
  usePresentation,
} from "@/components/presentation/presentation-mode";
import {
  VISITOR_LIMITS,
  VISITOR_ROOM_KIND,
  joinUrl,
  roomNeedsHostKey,
} from "@/lib/realtime/visitor-rooms";
import { groupRoomCode } from "@/lib/realtime/visitor-code";
import { cn } from "@/lib/utils";
import type { RoomBigScreenProps } from "./room-big-screen";

const LINK_FRAGMENT_RE = /^#[A-Za-z0-9=_-]{1,64}$/;

export function RoomBigScreenView({
  open,
  tool,
  toolName,
  code,
  linkFragment,
  memberCount,
  timer = null,
  reactions = [],
  children,
}: RoomBigScreenProps) {
  const headingRef = useRef<HTMLHeadingElement>(null);

  // Open: present (if `show` didn't already). Closed or gone: stop presenting.
  // (`RoomBigScreen` closes it when Present mode ends some other way.)
  useEffect(() => {
    if (!open) return;
    if (!usePresentation.getState().presenting) startPresenting();
    return () => stopPresenting();
  }, [open]);

  useEffect(() => {
    if (open) headingRef.current?.focus();
  }, [open]);

  if (!open || typeof document === "undefined") return null;

  const path = joinUrl(tool, code);
  const fragment = linkFragment && LINK_FRAGMENT_RE.test(linkFragment) ? linkFragment : "";
  const origin = typeof window === "undefined" ? "" : window.location.origin;
  const link = path ? `${origin}${path}${fragment}` : "";
  const host = origin.replace(/^https?:\/\//, "");
  // A typed code opens only the rooms that don't need the host's key in the link.
  const typeable = !roomNeedsHostKey(VISITOR_ROOM_KIND[tool]);
  const max = VISITOR_LIMITS.maxMembers;

  return createPortal(
    <div
      data-big-screen
      className="fixed inset-0 z-[90] overflow-y-auto overflow-x-hidden bg-bg text-text"
    >
      <div className="relative mx-auto flex min-h-full max-w-7xl flex-col gap-6 px-4 py-6 sm:gap-8 sm:px-10 sm:py-10">
        {/* Clear of the Exit presentation button, top right. */}
        <header className="flex flex-wrap items-center justify-between gap-x-6 gap-y-2 pr-14 sm:pr-48">
          <h1
            ref={headingRef}
            tabIndex={-1}
            className="flex items-center gap-3 text-2xl font-bold outline-none sm:text-4xl"
          >
            <Radio className="h-7 w-7 shrink-0 text-accent sm:h-9 sm:w-9" aria-hidden="true" />
            Live {toolName}
          </h1>
          <p className="flex items-center gap-2 text-xl text-sub sm:text-2xl" aria-live="polite">
            <Users className="h-6 w-6 shrink-0" aria-hidden="true" />
            {memberCount} of {max} in the room
          </p>
        </header>

        <div className="grid flex-1 gap-8 lg:grid-cols-[minmax(0,24rem)_minmax(0,1fr)] lg:gap-12">
          <section aria-label="How to join" className="flex min-w-0 flex-col gap-4">
            {link && (
              <QrCode
                text={link}
                label="QR code for the join link"
                className="w-full max-w-[24rem] rounded-sm border border-border"
                fallback={<p className="text-lg text-sub">Use Copy link to share this room.</p>}
              />
            )}
            <p className="text-lg text-sub sm:text-xl">
              {typeable
                ? `Scan to join, or open ${host}/join and type the code:`
                : "Scan the code with a phone camera to join."}
            </p>
            <p className="break-words font-data text-4xl font-bold tracking-wider sm:text-6xl">
              <span className="sr-only">Room code </span>
              {groupRoomCode(code)}
            </p>
          </section>

          <section aria-label="In the room now" className="min-w-0 space-y-6">
            {timer && <RoomCountdown timer={timer} size="xl" />}
            {/* Larger on a wall or projector; the page's own scale on a phone. */}
            <div className={cn("min-w-0 text-lg", "lg:[zoom:1.35]")}>{children}</div>
          </section>
        </div>

        <ReactionLayer reactions={reactions} size="lg" className="inset-x-0 bottom-0" />
      </div>
    </div>,
    document.body
  );
}
