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
 *
 * The open room is its own module (./host-show-room), loaded once the host
 * has agreed to open one: its frame view, renderers, timer, reactions and
 * QR code stay out of the tool page's first load.
 */

import { useEffect, useRef, useState, type ReactNode } from "react";
import dynamic from "next/dynamic";
import { MonitorUp } from "lucide-react";
import { Button } from "@/components/ui/button";
import { VisitorRoomConsent } from "@/components/collab/visitor-room-consent";
import { LiveRoomLimits } from "@/components/collab/run-modes";
import { signalGamification } from "@/lib/gamification/signal";
import {
  clearVisitorIdentity,
  newVisitorRoomCode,
  saveVisitorIdentity,
} from "@/lib/realtime/visitor-rooms";
import type { VoteCrypto } from "@/lib/realtime/vote-room/crypto";
import { useVoteRoomsAvailable } from "@/lib/realtime/vote-room/use-vote-room";
import type { ShowRoomTool } from "@/lib/realtime/show-room/protocol";
import type { ShowRoom } from "@/lib/realtime/show-room/use-show-room";
import { toast } from "@/lib/utils/toast";
import { liveOnlyReason } from "@/components/collab/live-room-reasons";
import type { ShowSession } from "./host-show-room";

/** The open room (./host-show-room): it loads once the host has agreed to open one. */
const HostShowRoom = dynamic(() => import("./host-show-room").then((m) => m.HostShowRoom), {
  ssr: false,
  loading: () => <p className="text-sm text-sub">Preparing the room…</p>,
});

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
  const [session, setSession] = useState<ShowSession | null>(null);
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
