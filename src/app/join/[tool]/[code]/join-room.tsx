"use client";

/**
 * The client half of `/join/<tool>/<code>`: name and consent first, then
 * the room. No channel exists until the consent dialog confirms: the room
 * component (which opens it) only mounts with the identity that step
 * produces.
 *
 * Which room mounts comes from `VISITOR_ROOM_KIND`, so a tool can never
 * fall into another tool's room: Poker and Retro their own rooms, vote
 * tools the vote kit's `VoteJoinRoom`, show tools `ShowJoinRoom` (which
 * draws frames through the renderers in `lib/realtime/show-room/renderers`,
 * never tool page code) and wall tools `WallJoinRoom`. A signed room's link
 * (vote, show, wall) must also carry the host's key fingerprint (`#k=`, a
 * fragment the server never sees): without it the page says the link is
 * incomplete and offers no consent at all. Each kind shows its own consent
 * text first.
 *
 * `/join` is a bare route (no app shell), so this mounts the live-region
 * announcer and reduced-motion config the shell would otherwise provide.
 *
 * The rooms (and the Realtime client they bring) load only after consent,
 * and only the one this link is for: the page itself stays small. There's no
 * Amr here either, so the ink carries the page: a pen scribbling while a room
 * loads, and a picture over each "outside the room" card.
 */

import { useEffect, useRef, useState } from "react";
import dynamic from "next/dynamic";
import Link from "next/link";
import { MotionConfig } from "framer-motion";
import { Radio } from "lucide-react";
import { Button } from "@/components/ui/button";
import { InkArt } from "@/components/ink/ink-art";
import { InkScribble } from "@/components/ink/ink-scribble";
import { brokenLinkArt } from "@/lib/ink/drawings/pages/broken-link";
import { doorArt } from "@/lib/ink/drawings/pages/door";
import type { InkDrawing } from "@/lib/ink/types";
import { LiveAnnouncerProvider } from "@/components/a11y/live-announcer";
import {
  VisitorRoomConsent,
  type VisitorRoomConsentVariant,
} from "@/components/collab/visitor-room-consent";
import {
  VISITOR_ROOM_KIND,
  readVisitorIdentity,
  roomNeedsHostKey,
  saveVisitorIdentity,
  type VisitorIdentity,
  type VisitorRoomKind,
  type VisitorTool,
} from "@/lib/realtime/visitor-rooms";
import { isVoteRoomTool } from "@/lib/realtime/vote-room/protocol";
import { readVoteLinkFragment } from "@/lib/realtime/vote-room/crypto";
// Types only: the show and wall protocols load with their rooms, after consent.
import type { ShowRoomTool } from "@/lib/realtime/show-room/protocol";
import type { WallRoomTool } from "@/lib/realtime/wall-room/protocol";

/** A show tool, by the registry (`SHOW_ROOM_TOOLS` lists the same ones). */
const isShowTool = (t: VisitorTool): t is ShowRoomTool => VISITOR_ROOM_KIND[t] === "show";
/** A wall tool, by the registry (`WALL_ROOM_TOOLS` lists the same ones). */
const isWallTool = (t: VisitorTool): t is WallRoomTool => VISITOR_ROOM_KIND[t] === "wall";

const VisitorPokerRoom = dynamic(
  () => import("@/app/(tools)/planning-poker/visitor-poker-room").then((m) => m.VisitorPokerRoom),
  { ssr: false, loading: RoomLoading }
);
const VisitorRetroRoom = dynamic(
  () => import("@/app/(tools)/retro/room/visitor-retro-room").then((m) => m.VisitorRetroRoom),
  { ssr: false, loading: RoomLoading }
);
const VoteJoinRoom = dynamic(
  () => import("@/components/collab/vote-room/vote-join-room").then((m) => m.VoteJoinRoom),
  { ssr: false, loading: RoomLoading }
);
const ShowJoinRoom = dynamic(
  () => import("@/components/collab/show-room/show-join-room").then((m) => m.ShowJoinRoom),
  { ssr: false, loading: RoomLoading }
);
const WallJoinRoom = dynamic(
  () => import("@/components/collab/wall-room/wall-join-room").then((m) => m.WallJoinRoom),
  { ssr: false, loading: RoomLoading }
);

function RoomLoading() {
  return (
    <main className="min-h-screen-dvh flex items-center justify-center px-4">
      <p role="status" className="flex flex-col items-center gap-2 text-sm text-sub">
        <InkScribble />
        <span>Opening the room…</span>
      </p>
    </main>
  );
}

/**
 * What the Retro join step says about the cards, and nothing about other
 * products. True of this room: a card has no author field, no message names
 * who wrote or voted for it (the host's browser keeps that in memory only,
 * for Delete my card and Take my vote back), and nothing is stored.
 */
export const RETRO_JOIN_NOTE =
  "Cards carry no author, and nothing is stored: who wrote a card or voted for it is never shown or saved.";

const TOOL_NAMES: Record<VisitorTool, string> = {
  "planning-poker": "Planning Poker",
  retro: "Retro",
  "health-check": "Health Check",
  "psych-safety": "Psych Safety",
  "mood-tracker": "Mood Tracker",
  "kano-model": "Kano survey",
  "buy-a-feature": "Buy-a-Feature",
  "hundred-dollar-test": "$100 Test",
  "quick-vote": "Quick Vote",
  "audience-wall": "Audience Wall",
  picker: "Picker",
  "team-mixer": "Team Mixer",
  "card-decks": "Card Decks",
};

/** The room each kind of link opens (`VISITOR_ROOM_KIND`). */
const ROOM: Readonly<Record<VisitorTool, VisitorRoomKind>> = VISITOR_ROOM_KIND;

/** The consent each kind of room shows first. */
const CONSENT_VARIANT: Readonly<Record<VisitorRoomKind, VisitorRoomConsentVariant>> = {
  poker: "board",
  retro: "board",
  vote: "vote",
  show: "show",
  wall: "wall",
};

/** What the host's key proves, per signed room, for "This link is incomplete". */
const KEY_PROVES: Readonly<Partial<Record<VisitorRoomKind, string>>> = {
  vote: "the questions come from the host",
  show: "what you see comes from the host",
  wall: "the wall comes from the host",
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
  const kind = ROOM[tool];
  const [stage, setStage] = useState<Stage>({ kind: "consent" });
  // A refresh in this tab offers the name it used here before (and keeps
  // its member id). Read after mount: sessionStorage doesn't exist on the
  // server.
  const [defaultName, setDefaultName] = useState("");
  useEffect(() => {
    setDefaultName(readVisitorIdentity(code)?.name ?? "");
  }, [code]);
  // Signed rooms (vote, show, wall): the host key from `#k=`, read after
  // mount (undefined until then).
  const signed = roomNeedsHostKey(kind);
  const [linkKey, setLinkKey] = useState<string | null | undefined>(signed ? undefined : null);
  useEffect(() => {
    if (signed) setLinkKey(readVoteLinkFragment(window.location.hash));
  }, [signed]);

  const confirm = (name: string) => {
    const identity = saveVisitorIdentity(code, name);
    setStage(identity ? { kind: "joined", identity } : { kind: "declined" });
  };

  if (signed) {
    if (linkKey === undefined) return <RoomLoading />;
    if (linkKey === null) {
      return (
        <OutsideRoom
          art={brokenLinkArt}
          title="This link is incomplete"
          body={`The link is missing the part that proves ${KEY_PROVES[kind] ?? "the room comes from the host"}, so nothing has connected. Ask the host to send it again with Copy link.`}
        />
      );
    }
  }

  if (stage.kind === "joined") {
    const onLeave = () => setStage({ kind: "left" });
    if (kind === "poker") {
      return <VisitorPokerRoom code={code} identity={stage.identity} onLeave={onLeave} />;
    }
    if (kind === "retro") {
      return <VisitorRetroRoom code={code} identity={stage.identity} onLeave={onLeave} />;
    }
    if (kind === "vote" && isVoteRoomTool(tool)) {
      return <VoteJoinRoom tool={tool} code={code} identity={stage.identity} onLeave={onLeave} />;
    }
    if (isShowTool(tool)) {
      return (
        <ShowJoinRoom
          tool={tool}
          toolName={toolName}
          code={code}
          identity={stage.identity}
          onLeave={onLeave}
        />
      );
    }
    if (isWallTool(tool)) {
      return (
        <WallJoinRoom
          tool={tool}
          toolName={toolName}
          code={code}
          identity={stage.identity}
          onLeave={onLeave}
        />
      );
    }
    return <RoomLoading />;
  }

  if (stage.kind === "consent") {
    return (
      <main className="min-h-screen-dvh flex items-center justify-center px-4">
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
          variant={CONSENT_VARIANT[kind]}
          note={kind === "retro" ? RETRO_JOIN_NOTE : undefined}
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

/**
 * Outside the room: a heading that takes focus, maybe one way back in, one way
 * home. Its picture is a door unless the link itself is the problem.
 */
function OutsideRoom({
  art = doorArt,
  title,
  body,
  actionLabel,
  onAction,
}: {
  art?: InkDrawing;
  title: string;
  body: string;
  actionLabel?: string;
  onAction?: () => void;
}) {
  const headingRef = useRef<HTMLHeadingElement>(null);
  useEffect(() => {
    headingRef.current?.focus();
  }, [title]);
  return (
    <main className="min-h-screen-dvh flex items-center justify-center px-4">
      <section className="ink-host w-full max-w-md rounded-xl border border-border bg-surface p-6 flex flex-col gap-4">
        <InkArt drawing={art} boil className="h-16 w-16" />
        <h1 ref={headingRef} tabIndex={-1} className="text-lg font-semibold text-text outline-none">
          {title}
        </h1>
        <p className="text-sm text-sub">{body}</p>
        <div className="flex flex-wrap items-center gap-2">
          {actionLabel && onAction && (
            <Button type="button" variant="toolkit" size="sm" onClick={onAction}>
              {actionLabel}
            </Button>
          )}
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
