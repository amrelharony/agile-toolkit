"use client";

/**
 * A participant's notice for a signed room (show or wall) that has closed,
 * or never opened: the words for each end state, and the panel that shows
 * them. The panel takes focus on its heading and announces it, as the vote
 * room's does.
 */

import { useEffect, useRef, type ReactNode } from "react";
import { Button } from "@/components/ui/button";
import { useAnnounce } from "@/components/a11y/live-announcer";
import { VISITOR_LIMITS } from "@/lib/realtime/visitor-rooms";
import type { SignedRoomEndReason, SignedRoomStatus } from "@/lib/realtime/use-signed-room";

/** What a participant is told when the room is over, by status. */
export function signedRoomClosedCopy(
  status: SignedRoomStatus,
  reason: SignedRoomEndReason | null,
  keep = "Nothing from the room was kept."
): { title: string; body: string } {
  switch (status) {
    case "expired":
      return { title: "The room has closed", body: `Live rooms close after 3 hours. ${keep}` };
    case "kicked":
      return { title: "The host removed you from the room", body: keep };
    case "full":
      return {
        title: `This room is full (${VISITOR_LIMITS.maxMembers} people)`,
        body: "Ask the host to start a new room if you need a seat.",
      };
    case "host-left":
      return {
        title: "The host left",
        body: `The room can't go on without them: it runs in their browser. ${keep}`,
      };
    case "no-host":
      return {
        title: "Nobody is hosting this room",
        body: "No host answered for a minute and a half, so the link may be from a room that has ended. Ask the host for a new link.",
      };
    case "bad-link":
      return {
        title: "This link is incomplete",
        body: "Ask the host to send it again with Copy link.",
      };
    case "unavailable":
      return {
        title: "This browser can't take part",
        body: "Live rooms need a secure (HTTPS) page and a current browser, and the realtime service to be reachable. Try another browser, or try again later.",
      };
    case "left":
      return { title: "You left the room", body: keep };
    default:
      return {
        title:
          reason === "idle"
            ? "The room ended after 30 minutes without activity"
            : "The host ended the room",
        body: keep,
      };
  }
}

export function RoomClosedPanel({
  title,
  body,
  onLeave,
  headingLevel = 2,
  children,
}: {
  title: string;
  body: string;
  onLeave?: () => void;
  /** 1 when the panel is the whole page. */
  headingLevel?: 1 | 2;
  children?: ReactNode;
}) {
  const headingRef = useRef<HTMLHeadingElement>(null);
  const announce = useAnnounce();
  const Heading = headingLevel === 1 ? "h1" : "h2";
  useEffect(() => {
    headingRef.current?.focus();
    announce(`${title}.`);
  }, [title, announce]);
  return (
    <section className="space-y-3 rounded-lg border border-border bg-card p-4">
      <Heading
        ref={headingRef}
        tabIndex={-1}
        className="text-base font-semibold text-text outline-none"
      >
        {title}
      </Heading>
      <p className="text-sm text-sub">{body}</p>
      <div className="flex flex-wrap gap-2">
        {children}
        {onLeave && (
          <Button type="button" variant="outline" onClick={onLeave}>
            Leave
          </Button>
        )}
      </div>
    </section>
  );
}
