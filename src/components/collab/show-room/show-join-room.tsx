"use client";

/**
 * The participant's side of a show room, at `/join/<tool>/<code>`: the
 * host's latest frame, large, and an "I'm here" button. That button is all
 * a participant sends. Mounted by the join page after consent, for a link
 * that carries the host's key (`#k=`); it checks the fragment again itself.
 *
 * It renders its own end states (host ended, removed, expired, full, host
 * left, nobody hosting, unavailable), each focused and announced.
 */

import { useEffect, useState, type JSX } from "react";
import { Check, Hand } from "lucide-react";
import { Button } from "@/components/ui/button";
import { VisitorRoomChip } from "@/components/collab/visitor-room-chip";
import { RoomClosedPanel, signedRoomClosedCopy } from "@/components/collab/room-closed-panel";
import { visitorRoomsEnabled, type VisitorIdentity } from "@/lib/realtime/visitor-rooms";
import { readVoteLinkFragment, type VoteCrypto } from "@/lib/realtime/vote-room/crypto";
import type { ShowRoomTool } from "@/lib/realtime/show-room/protocol";
import { useShowRoom } from "@/lib/realtime/show-room/use-show-room";
import { isSignedRoomClosed } from "@/lib/realtime/use-signed-room";
import { ShowFrameView } from "./show-frame-view";

export interface ShowJoinRoomProps {
  tool: ShowRoomTool;
  /** Shown in the heading, e.g. "Picker". */
  toolName: string;
  code: string;
  identity: VisitorIdentity;
  onLeave: () => void;
  /** Tests inject a fake (undefined: WebCrypto). */
  crypto?: VoteCrypto | null;
}

export function ShowJoinRoom(props: ShowJoinRoomProps): JSX.Element {
  // The fragment exists only in the browser: read it after mount.
  const [fingerprint, setFingerprint] = useState<string | null | undefined>(undefined);
  useEffect(() => {
    setFingerprint(readVoteLinkFragment(window.location.hash));
  }, []);

  if (!visitorRoomsEnabled()) {
    return (
      <main className="mx-auto min-h-screen-dvh w-full max-w-3xl px-4 py-6">
        <RoomClosedPanel
          title="Live rooms are off"
          body="This site isn't running live rooms right now."
          onLeave={props.onLeave}
          headingLevel={1}
        />
      </main>
    );
  }
  if (fingerprint === undefined) {
    return (
      <main className="mx-auto min-h-screen-dvh w-full max-w-3xl px-4 py-6">
        <p role="status" className="text-sm text-sub">
          Opening the room…
        </p>
      </main>
    );
  }
  if (fingerprint === null) {
    const copy = signedRoomClosedCopy("bad-link", null);
    return (
      <main className="mx-auto min-h-screen-dvh w-full max-w-3xl px-4 py-6">
        <RoomClosedPanel {...copy} onLeave={props.onLeave} headingLevel={1} />
      </main>
    );
  }
  return <ParticipantShowRoom {...props} hostFingerprint={fingerprint} />;
}

function ParticipantShowRoom({
  tool,
  toolName,
  code,
  identity,
  onLeave,
  crypto,
  hostFingerprint,
}: ShowJoinRoomProps & { hostFingerprint: string }) {
  const room = useShowRoom({
    role: "participant",
    tool,
    code,
    identity,
    hostFingerprint,
    crypto,
  });
  const { status, hostName } = room;
  const closed = isSignedRoomClosed(status);

  const handleLeave = () => {
    room.leave();
    onLeave();
  };

  return (
    <main className="mx-auto min-h-screen-dvh w-full max-w-3xl space-y-5 px-4 py-6">
      <header className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
        <div className="space-y-1">
          <h1 className="text-xl font-bold text-text">Live {toolName}</h1>
          <p className="text-sm text-sub">
            {hostName
              ? `Hosted by ${hostName}. You are ${identity.name}.`
              : `You are ${identity.name}.`}{" "}
            The host shows; you watch. Nothing you do here is saved.
          </p>
        </div>
        {!closed && (
          <VisitorRoomChip
            tool={tool}
            code={code}
            memberCount={room.members.length}
            isHost={false}
            onLeave={handleLeave}
            linkFragment={`#k=${hostFingerprint}`}
          />
        )}
      </header>

      {closed ? (
        <RoomClosedPanel {...signedRoomClosedCopy(status, room.endReason)} onLeave={onLeave} />
      ) : status !== "live" ? (
        <div className="space-y-3">
          <p role="status" className="text-sm text-sub">
            {status === "waiting" ? "Waiting for the host…" : "Connecting to the room…"}
          </p>
          <Button type="button" variant="outline" onClick={handleLeave}>
            Leave
          </Button>
        </div>
      ) : (
        <section aria-label={`What the host is showing in ${toolName}`} className="space-y-4">
          <ShowFrameView tool={tool} frame={room.frame} surface="phone" />
          <div className="flex flex-wrap items-center gap-3">
            <Button
              type="button"
              variant={room.iAmHere ? "outline" : "toolkit"}
              size="lg"
              className="gap-2"
              aria-pressed={room.iAmHere}
              onClick={() => room.sayHere(!room.iAmHere)}
            >
              {room.iAmHere ? (
                <Check className="h-5 w-5" aria-hidden="true" />
              ) : (
                <Hand className="h-5 w-5" aria-hidden="true" />
              )}
              I&apos;m here
            </Button>
            <p className="text-sm text-sub" aria-live="polite">
              {room.hereCount} {room.hereCount === 1 ? "person is" : "people are"} here.
            </p>
          </div>
        </section>
      )}
    </main>
  );
}
