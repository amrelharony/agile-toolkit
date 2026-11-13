"use client";

/**
 * The participant's side of a live vote round, at `/join/<tool>/<code>`.
 *
 * The join page mounts this after the consent-and-name step, and only for
 * a link that carries the host's key (`#k=`); this component checks the
 * fragment again itself. Answers are sealed to the host's key in this
 * browser; nothing of them is kept here (sessionStorage holds only which
 * round this tab answered). After Reveal the totals show, with a Markdown
 * download, and nothing is saved anywhere unless the person downloads it.
 *
 * It renders its own end states (host ended, removed, expired, full, host
 * left, nobody hosting, unavailable). Each notice takes focus on its
 * heading and is announced politely, and so does "Your answers were sent"
 * when it replaces the form.
 *
 * The form, the results and the Markdown follow the tool's kind of round
 * (scale, pair or allocation: `round-views.tsx`); the rest is one flow.
 */

import { useEffect, useRef, useState, type JSX, type ReactNode } from "react";
import { Check, CheckCircle2, Download, ShieldAlert } from "lucide-react";
import { Button } from "@/components/ui/button";
import { useAnnounce } from "@/components/a11y/live-announcer";
import { VisitorRoomChip } from "@/components/collab/visitor-room-chip";
import { RoomCountdownCard } from "@/components/collab/room-countdown";
import { RoomReactions } from "@/components/collab/room-reactions";
import { useRoomExtras } from "@/lib/realtime/use-room-extras";
import {
  VISITOR_LIMITS,
  visitorRoomsEnabled,
  type VisitorIdentity,
} from "@/lib/realtime/visitor-rooms";
import type { VoteRoomTool } from "@/lib/realtime/vote-room/protocol";
import { readVoteLinkFragment, type VoteCrypto } from "@/lib/realtime/vote-room/crypto";
import {
  useVoteRoom,
  type VoteEndReason,
  type VoteRoomStatus,
} from "@/lib/realtime/vote-room/use-vote-room";
import { exportToMarkdown } from "@/lib/utils/export";
import { todayLocalISO } from "@/lib/utils/formatters";
import { useFlash } from "@/hooks/use-flash";
import {
  LiveRoundResults,
  RoundAnswerForm,
  roomHasRound,
  roomResult,
  roomTitle,
  roundMarkdown,
} from "./round-views";
import { VoteLiveCount } from "./vote-live-count";

export interface VoteJoinRoomProps {
  tool: VoteRoomTool;
  code: string;
  identity: VisitorIdentity;
  onLeave: () => void;
  /** Tests inject a fake (undefined: WebCrypto). */
  crypto?: VoteCrypto | null;
}

/** "This link is incomplete": the link lost its `#k=` part. Exported for the join page. */
export function IncompleteLinkPanel({ onLeave }: { onLeave?: () => void }) {
  return (
    <ClosedPanel
      title="This link is incomplete"
      body="The link is missing the part that proves the questions come from the host, so it can't connect. Ask the host to send it again with Copy link."
      onLeave={onLeave}
      headingLevel={1}
    />
  );
}

export function VoteJoinRoom(props: VoteJoinRoomProps): JSX.Element {
  // The fragment exists only in the browser: read it after mount.
  const [fingerprint, setFingerprint] = useState<string | null | undefined>(undefined);
  useEffect(() => {
    setFingerprint(readVoteLinkFragment(window.location.hash));
  }, []);

  if (!visitorRoomsEnabled()) {
    return (
      <main className="mx-auto min-h-screen-dvh w-full max-w-3xl px-4 py-6">
        <ClosedPanel
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
    return (
      <main className="mx-auto min-h-screen-dvh w-full max-w-3xl px-4 py-6">
        <IncompleteLinkPanel onLeave={props.onLeave} />
      </main>
    );
  }
  return <ParticipantVoteRoom {...props} hostFingerprint={fingerprint} />;
}

function closedCopy(
  status: VoteRoomStatus,
  reason: VoteEndReason | null,
  revealed: boolean
): { title: string; body: string } {
  const keep = revealed
    ? "Download the results if you want to keep them."
    : "Nothing from the round was kept.";
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
        body: `The round can't go on without them: only their browser could count the answers. ${keep}`,
      };
    case "no-host":
      return {
        title: "Nobody is hosting this round",
        body: "No host answered for a minute and a half, so the link may be from a round that has ended. Ask the host for a new link.",
      };
    case "bad-link":
      return {
        title: "This link is incomplete",
        body: "Ask the host to send it again with Copy link.",
      };
    case "unavailable":
      return {
        title: "This browser can't take part",
        body: "Live rounds need a secure (HTTPS) page and a current browser, and the realtime service to be reachable. Try another browser, or try again later.",
      };
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

function ParticipantVoteRoom({
  tool,
  code,
  identity,
  onLeave,
  crypto,
  hostFingerprint,
}: VoteJoinRoomProps & { hostFingerprint: string }) {
  const room = useVoteRoom({
    role: "participant",
    tool,
    code,
    identity,
    hostFingerprint,
    crypto,
  });
  const extras = useRoomExtras(room.extras);
  const announce = useAnnounce();
  const { status, phase, hostName } = room;
  const result = roomResult(room);
  const title = roomTitle(room);
  const hasRound = roomHasRound(room);
  const active = status === "connecting" || status === "waiting" || status === "live";

  const lastStatus = useRef<VoteRoomStatus>(status);
  useEffect(() => {
    const prev = lastStatus.current;
    lastStatus.current = status;
    if (prev === status || status !== "live") return;
    announce(
      hostName ? `You joined the live round hosted by ${hostName}.` : "You joined the live round."
    );
  }, [status, hostName, announce]);

  const lastPhase = useRef(phase);
  useEffect(() => {
    const prev = lastPhase.current;
    lastPhase.current = phase;
    if (prev === phase || phase === null) return;
    if (phase === "revealed") announce("The host revealed the results.");
    else if (prev === "revealed") announce("A new round has started.");
  }, [phase, announce]);

  const handleLeave = () => {
    room.leave();
    onLeave();
  };

  const download = () => {
    if (!result) return;
    exportToMarkdown(roundMarkdown(result), `${tool}-round-${todayLocalISO()}`);
  };

  const copy = active ? null : closedCopy(status, room.endReason, result !== null);

  return (
    <main className="mx-auto min-h-screen-dvh w-full max-w-3xl space-y-5 px-4 py-6">
      <header className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
        <div className="space-y-1">
          <h1 className="text-xl font-bold text-text">{title ?? "Live round"}</h1>
          <p className="text-sm text-sub">
            {hostName
              ? `Hosted by ${hostName}. You are ${identity.name}.`
              : `You are ${identity.name}.`}{" "}
            Others see that you answered, not what. Only the totals are shown, once the host reveals
            them.
          </p>
        </div>
        {active && (
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

      {copy && (
        <ClosedPanel
          title={copy.title}
          body={copy.body}
          onLeave={onLeave}
          onDownload={result ? download : undefined}
        />
      )}

      {active && status !== "live" && (
        <div className="space-y-3">
          <p role="status" className="text-sm text-sub">
            {status === "waiting" ? "Waiting for the host's questions…" : "Connecting to the room…"}
          </p>
          <Button type="button" variant="outline" onClick={handleLeave}>
            Leave
          </Button>
        </div>
      )}

      {active && room.impersonated && (
        <p
          role="alert"
          className="flex items-start gap-2 rounded-md border border-warning/40 bg-warning/10 px-3 py-2 text-sm text-text"
        >
          <ShieldAlert className="mt-0.5 h-4 w-4 shrink-0 text-warning" aria-hidden="true" />
          <span>
            Someone else sent answers under your name in this round. Tell the host: they may want to
            end the room and share a new link.
          </span>
        </p>
      )}

      {status === "live" && <RoomCountdownCard timer={extras.timer} />}

      {status === "live" && phase === "open" && hasRound && (
        <>
          {room.answered || room.awaitingAck ? (
            <SentPanel counted={room.answered}>
              <VoteLiveCount
                ballots={room.ballots}
                present={room.members.length}
                minN={room.minN}
                phase={phase}
              />
            </SentPanel>
          ) : (
            <section className="space-y-3">
              <VoteLiveCount
                ballots={room.ballots}
                present={room.members.length}
                minN={room.minN}
                phase={phase}
              />
              {room.unconfirmed && (
                <p role="alert" className="text-sm text-danger">
                  The host&apos;s browser didn&apos;t confirm your answers, so they may not have
                  been counted. Pick them again and send them.
                </p>
              )}
              <RoundAnswerForm key={room.roundId ?? "none"} room={room} onSubmit={room.submit} />
            </section>
          )}
        </>
      )}

      {phase === "revealed" && hasRound && (
        <div className="space-y-3">
          <LiveRoundResults room={room} />
          {active && <DownloadButton onDownload={result ? download : undefined} />}
        </div>
      )}

      {status === "live" && <RoomReactions extras={extras} className="pt-2" />}
    </main>
  );
}

/**
 * "Your answers were sent", then "…counted" once the host acknowledges
 * them. It replaces the form (and the focused Send button), so it takes
 * focus on its heading and says each step.
 */
function SentPanel({ counted, children }: { counted: boolean; children: ReactNode }) {
  const headingRef = useRef<HTMLHeadingElement>(null);
  const announce = useAnnounce();
  const title = counted ? "Your answers were counted" : "Your answers were sent";
  useEffect(() => {
    headingRef.current?.focus();
  }, []);
  useEffect(() => {
    announce(`${title}.`);
  }, [title, announce]);
  return (
    <section className="space-y-2 rounded-lg border border-border bg-card p-4">
      <h2
        ref={headingRef}
        tabIndex={-1}
        className="flex items-center gap-2 text-base font-semibold text-text outline-none"
      >
        <CheckCircle2 className="h-5 w-5 text-accent-green" aria-hidden="true" />
        {title}
      </h2>
      {children}
      <p className="text-xs text-sub">
        {counted
          ? "The results show here when the host reveals them."
          : "Waiting for the host's browser to confirm them. The results show here when the host reveals them."}{" "}
        Nothing you answered is kept in this browser.
      </p>
    </section>
  );
}

/** "Download Markdown": the revealed totals, as a file. */
function DownloadButton({ onDownload }: { onDownload?: () => void }) {
  // Confirmed in place, not with a toast: the file is the confirmation.
  const { flash, isFlashing } = useFlash();
  const done = isFlashing();
  return (
    <Button
      type="button"
      variant="outline"
      className="gap-1.5"
      onClick={
        onDownload
          ? () => {
              onDownload();
              flash("Downloaded the results as Markdown.");
            }
          : undefined
      }
      disabled={!onDownload}
    >
      {done ? (
        <Check className="h-4 w-4" aria-hidden="true" />
      ) : (
        <Download className="h-4 w-4" aria-hidden="true" />
      )}
      {done ? "Downloaded" : "Download Markdown"}
    </Button>
  );
}

/** A notice for a room that has closed (or never opened). Focuses its heading and announces it. */
function ClosedPanel({
  title,
  body,
  onLeave,
  onDownload,
  headingLevel = 2,
}: {
  title: string;
  body: string;
  onLeave?: () => void;
  onDownload?: () => void;
  /** 1 when the panel is the whole page. */
  headingLevel?: 1 | 2;
}) {
  const headingRef = useRef<HTMLHeadingElement>(null);
  const announce = useAnnounce();
  const Heading = headingLevel === 1 ? "h1" : "h2";
  // The room just closed under the person: move focus to the explanation and say it.
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
        {onDownload && <DownloadButton onDownload={onDownload} />}
        {onLeave && (
          <Button type="button" variant="outline" onClick={onLeave}>
            Leave
          </Button>
        )}
      </div>
    </section>
  );
}
