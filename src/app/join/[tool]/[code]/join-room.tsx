"use client";

/**
 * The client half of `/join/<tool>/<code>`: name and consent first, then
 * the room. No channel exists until the consent dialog confirms: the room
 * component (which opens it) only mounts with the identity that step
 * produces.
 *
 * `/join` is a bare route (no app shell), so this mounts the live-region
 * announcer and reduced-motion config the shell would otherwise provide.
 *
 * The rooms (and the Realtime client they bring) load only after consent,
 * and only the one this link is for: the page itself stays small.
 */

import { useEffect, useRef, useState } from "react";
import dynamic from "next/dynamic";
import Link from "next/link";
import { MotionConfig } from "framer-motion";
import { Radio } from "lucide-react";
import { Button } from "@/components/ui/button";
import { LiveAnnouncerProvider } from "@/components/a11y/live-announcer";
import { VisitorRoomConsent } from "@/components/collab/visitor-room-consent";
import {
  readVisitorIdentity,
  saveVisitorIdentity,
  type VisitorIdentity,
  type VisitorTool,
} from "@/lib/realtime/visitor-rooms";

const VisitorPokerRoom = dynamic(
  () => import("@/app/(tools)/planning-poker/visitor-poker-room").then((m) => m.VisitorPokerRoom),
  { ssr: false, loading: RoomLoading }
);
const VisitorRetroRoom = dynamic(
  () => import("@/app/(tools)/retro/room/visitor-retro-room").then((m) => m.VisitorRetroRoom),
  { ssr: false, loading: RoomLoading }
);

function RoomLoading() {
  return (
    <main className="min-h-screen flex items-center justify-center px-4">
      <p role="status" className="text-sm text-sub">
        Opening the room…
      </p>
    </main>
  );
}

const TOOL_NAMES: Record<VisitorTool, string> = {
  "planning-poker": "Planning Poker",
  retro: "Retro",
};

type Stage =
  | { kind: "consent" }
  | { kind: "declined" }
  | { kind: "joined"; identity: VisitorIdentity }
  | { kind: "left" };

export interface JoinRoomProps {
  tool: VisitorTool;
  code: string;
}

export function JoinRoom(props: JoinRoomProps) {
  return (
    <MotionConfig reducedMotion="user">
      <LiveAnnouncerProvider>
        <JoinRoomFlow {...props} />
      </LiveAnnouncerProvider>
    </MotionConfig>
  );
}

function JoinRoomFlow({ tool, code }: JoinRoomProps) {
  const toolName = TOOL_NAMES[tool];
  const [stage, setStage] = useState<Stage>({ kind: "consent" });
  // A refresh in this tab offers the name it used here before (and keeps
  // its member id). Read after mount: sessionStorage doesn't exist on the
  // server.
  const [defaultName, setDefaultName] = useState("");
  useEffect(() => {
    setDefaultName(readVisitorIdentity(code)?.name ?? "");
  }, [code]);

  const confirm = (name: string) => {
    const identity = saveVisitorIdentity(code, name);
    setStage(identity ? { kind: "joined", identity } : { kind: "declined" });
  };

  if (stage.kind === "joined") {
    const onLeave = () => setStage({ kind: "left" });
    return tool === "planning-poker" ? (
      <VisitorPokerRoom code={code} identity={stage.identity} onLeave={onLeave} />
    ) : (
      <VisitorRetroRoom code={code} identity={stage.identity} onLeave={onLeave} />
    );
  }

  if (stage.kind === "consent") {
    return (
      <main className="min-h-screen flex items-center justify-center px-4">
        <p className="flex items-center gap-2 text-sm text-sub">
          <Radio className="h-4 w-4 text-accent" aria-hidden="true" />
          Joining a live {toolName} room
        </p>
        <VisitorRoomConsent
          open
          onOpenChange={(open) => {
            if (!open) setStage({ kind: "declined" });
          }}
          mode="join"
          toolName={toolName}
          defaultName={defaultName}
          onConfirm={confirm}
        />
      </main>
    );
  }

  return (
    <OutsideRoom
      title={stage.kind === "left" ? "You left the room" : "You haven't joined the room"}
      body={
        stage.kind === "left"
          ? "Nothing from the room was stored on this device unless you saved a copy."
          : "Nothing has connected. Join when you're ready; you'll be asked for your name first."
      }
      actionLabel={stage.kind === "left" ? "Join again" : "Join the room"}
      onAction={() => setStage({ kind: "consent" })}
    />
  );
}

/** Outside the room: a heading that takes focus, one way back in, one way home. */
function OutsideRoom({
  title,
  body,
  actionLabel,
  onAction,
}: {
  title: string;
  body: string;
  actionLabel: string;
  onAction: () => void;
}) {
  const headingRef = useRef<HTMLHeadingElement>(null);
  useEffect(() => {
    headingRef.current?.focus();
  }, [title]);
  return (
    <main className="min-h-screen flex items-center justify-center px-4">
      <section className="w-full max-w-md rounded-xl border border-border bg-surface p-6 flex flex-col gap-4">
        <h1 ref={headingRef} tabIndex={-1} className="text-lg font-semibold text-text outline-none">
          {title}
        </h1>
        <p className="text-sm text-sub">{body}</p>
        <div className="flex flex-wrap items-center gap-2">
          <Button type="button" variant="toolkit" size="sm" onClick={onAction}>
            {actionLabel}
          </Button>
          <Link
            href="/"
            className="min-touch-coarse inline-flex items-center px-2 rounded text-sm text-sub hover:text-text"
          >
            Go to the Agile Toolkit
          </Link>
        </div>
      </section>
    </main>
  );
}
