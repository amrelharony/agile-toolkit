"use client";

/**
 * The participant's side of a wall room, at `/join/<tool>/<code>`: the
 * host's prompt, a box to post, the wall (once shown) with upvotes, their
 * own posts (which only this tab knows are theirs) with Take it back, and
 * Raise my hand. Mounted by the join page after consent, for a link that
 * carries the host's key (`#k=`); it checks the fragment again itself.
 *
 * While the host keeps posts hidden until reveal, this tab shows its own
 * posts (from memory) and how many there are in all; nobody else's text
 * reaches it until then. In a brainwriting round each post offers "Yes,
 * and…", which puts the post above the box; in a 25/10 round the box gives
 * way to five posts to score (announced, with focus on the card, and again
 * when the host shows the totals). A round that takes no posts and has none
 * (a raise-hand queue) puts Raise my hand first. It renders its own end
 * states, focused and announced.
 */

import { useEffect, useRef, useState, type JSX } from "react";
import { Hand } from "lucide-react";
import { Button } from "@/components/ui/button";
import { useAnnounce } from "@/components/a11y/live-announcer";
import { VisitorRoomChip } from "@/components/collab/visitor-room-chip";
import { RoomClosedPanel, signedRoomClosedCopy } from "@/components/collab/room-closed-panel";
import { RoomCountdownCard } from "@/components/collab/room-countdown";
import { RoomReactions } from "@/components/collab/room-reactions";
import { useRoomExtras } from "@/lib/realtime/use-room-extras";
import { visitorRoomsEnabled, type VisitorIdentity } from "@/lib/realtime/visitor-rooms";
import { readVoteLinkFragment, type VoteCrypto } from "@/lib/realtime/vote-room/crypto";
import { isSignedRoomClosed } from "@/lib/realtime/use-signed-room";
import type { WallPost, WallRefusal, WallRoomTool } from "@/lib/realtime/wall-room/protocol";
import { useWallRoom, type MyPost } from "@/lib/realtime/wall-room/use-wall-room";
import { WallPostForm } from "./wall-post-form";
import { WallPostList } from "./wall-post-list";
import { WallScoreCard } from "./wall-score-card";

export interface WallJoinRoomProps {
  tool: WallRoomTool;
  /** Shown in the heading, e.g. "Audience Wall". */
  toolName: string;
  code: string;
  identity: VisitorIdentity;
  onLeave: () => void;
  /** Tests inject a fake (undefined: WebCrypto). */
  crypto?: VoteCrypto | null;
}

/** What a refusal from the host means for the person. */
export function wallRefusalText(why: WallRefusal): string {
  switch (why) {
    case "closed":
      return "The host isn't taking that right now.";
    case "rate":
      return "One post every 5 seconds: wait a moment and send it again.";
    case "member-cap":
      return "You've posted or upvoted as much as one person can in this round.";
    case "round-full":
      return "The wall is full for this round.";
    case "bad-text":
      return "That post couldn't be used: it was empty or had hidden characters.";
    case "own-post":
      return "That's your own post: you can't upvote or score it.";
    case "already":
      return "That's already done.";
    case "gone":
      return "That post isn't on the wall any more.";
    case "not-yours":
      return "That can only be taken back from the tab it came from.";
    case "not-admitted":
      return "The host's browser doesn't take requests from this tab as you. Leave, then join again from the link.";
    default:
      return "The host's browser didn't take that.";
  }
}

function statusText(p: MyPost): string {
  switch (p.status) {
    case "sending":
      return "Sending…";
    case "withdrawing":
      return "Taking it back…";
    case "refused":
      return p.why ? wallRefusalText(p.why) : "Not posted.";
    case "unconfirmed":
      return "The host's browser didn't confirm it. It may not be on the wall.";
    default:
      return "On the wall.";
  }
}

/** Where one of this tab's posts went when it isn't on the wall as itself. */
function mineElsewhere(p: MyPost, posts: readonly WallPost[]): string {
  if (p.status !== "posted") return statusText(p);
  return posts.some((x) => x.merged.includes(p.text))
    ? "merged with a similar post."
    : "not on the wall right now (the host took it off).";
}

export function WallJoinRoom(props: WallJoinRoomProps): JSX.Element {
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
    return (
      <main className="mx-auto min-h-screen-dvh w-full max-w-3xl px-4 py-6">
        <RoomClosedPanel
          {...signedRoomClosedCopy("bad-link", null)}
          onLeave={props.onLeave}
          headingLevel={1}
        />
      </main>
    );
  }
  return <ParticipantWallRoom {...props} hostFingerprint={fingerprint} />;
}

function ParticipantWallRoom({
  tool,
  toolName,
  code,
  identity,
  onLeave,
  crypto,
  hostFingerprint,
}: WallJoinRoomProps & { hostFingerprint: string }) {
  const room = useWallRoom({
    role: "participant",
    tool,
    code,
    identity,
    hostFingerprint,
    crypto,
  });
  const extras = useRoomExtras(room.extras);
  const { status, hostName, round } = room;
  const closed = isSignedRoomClosed(status);
  const mine = new Set(room.mine.map((p) => p.id));
  const queuePlace = room.hands.findIndex((h) => h.id === room.selfId);
  // Brainwriting: the post this person is saying "Yes, and…" to.
  const [replyPick, setReplyPick] = useState<{ id: string; round: string } | null>(null);
  const canBuild = Boolean(round?.build && round.open && round.posts);
  const replyTo =
    canBuild && replyPick && replyPick.round === round?.id
      ? (round?.posts?.find((p) => p.id === replyPick.id) ?? null)
      : null;
  // A raise-hand queue: no posts taken and none on the wall, so the hand comes first.
  const handsFirst = Boolean(round && !round.open && !round.scoring && round.count === 0);

  // 25/10: the post box (or the score card) goes away when the host starts
  // the scoring or shows the totals. Say so, and put focus on what replaced
  // it when focus was lost with the old one.
  const announce = useAnnounce();
  const scoreHeadingRef = useRef<HTMLHeadingElement>(null);
  const totalsRef = useRef<HTMLParagraphElement>(null);
  const scoringRef = useRef<string | null>(null);
  const scoringKey = round?.scoring ? `${round.id}:${round.scoring}` : null;
  useEffect(() => {
    const prev = scoringRef.current;
    scoringRef.current = scoringKey;
    if (!scoringKey || scoringKey === prev || !round?.scoring) return;
    const focusLost = !document.activeElement || document.activeElement === document.body;
    if (round.scoring === "open") {
      announce(
        room.toScore.length > 0
          ? `Scoring started: score ${room.toScore.length === 1 ? "one post" : `${room.toScore.length} posts`} from 1 to 5.`
          : "Scoring started. There are no posts for you to score."
      );
      if (focusLost) scoreHeadingRef.current?.focus();
    } else {
      announce("The host is showing the totals.");
      if (focusLost) totalsRef.current?.focus();
    }
    // Once per change of the scoring.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [scoringKey]);

  const handleLeave = () => {
    room.leave();
    onLeave();
  };

  const handRow = (
    <div className="flex flex-wrap items-center gap-3">
      <Button
        type="button"
        variant={room.handUp ? "toolkit" : "outline"}
        className="gap-1.5"
        aria-pressed={room.handUp}
        onClick={() => void room.raiseHand(!room.handUp)}
      >
        <Hand className="h-4 w-4" aria-hidden="true" />
        Raise my hand
      </Button>
      {room.handUp && queuePlace >= 0 ? (
        <p className="text-sm text-sub" aria-live="polite">
          You&apos;re number {queuePlace + 1} in the queue. Everyone sees your name there.
        </p>
      ) : handsFirst ? (
        <p className="text-sm text-sub">Raise your hand to join the queue to speak.</p>
      ) : null}
    </div>
  );

  return (
    <main className="mx-auto min-h-screen-dvh w-full max-w-3xl space-y-5 px-4 py-6">
      <header className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
        <div className="space-y-1">
          <h1 className="break-words text-xl font-bold text-text">
            {round?.prompt ?? `Live ${toolName}`}
          </h1>
          <p className="text-sm text-sub">
            {hostName
              ? `Hosted by ${hostName}. You are ${identity.name}.`
              : `You are ${identity.name}.`}{" "}
            Posts show without your name.
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
        <div className="space-y-5">
          <RoomCountdownCard timer={extras.timer} />
          {!round ? (
            <p role="status" className="text-sm text-sub">
              Waiting for the host to put up a prompt…
            </p>
          ) : (
            <>
              {round.scoring === "open" && round.posts ? (
                <WallScoreCard
                  posts={round.posts}
                  toScore={room.toScore}
                  myScores={room.myScores}
                  onScore={(id, v) => void room.score(id, v)}
                  headingRef={scoreHeadingRef}
                />
              ) : round.scoring === "shown" ? (
                <p ref={totalsRef} tabIndex={-1} className="text-sm text-sub outline-none">
                  The host is showing the totals: the best-scored posts come first.
                </p>
              ) : handsFirst ? (
                handRow
              ) : round.open ? (
                <WallPostForm
                  onPost={(text) => room.post(text, replyTo?.id)}
                  replyTo={replyTo}
                  onCancelReply={() => setReplyPick(null)}
                />
              ) : (
                <p className="text-sm text-sub">The host isn&apos;t taking posts right now.</p>
              )}
              {room.lastRefusal && (
                <p role="alert" className="text-sm text-danger">
                  {wallRefusalText(room.lastRefusal)}
                </p>
              )}

              {handsFirst ? null : round.posts === null ? (
                <section className="space-y-2" aria-label="Your posts">
                  <p className="rounded-lg border border-dashed border-border px-3 py-2.5 text-sm text-sub">
                    {round.count} {round.count === 1 ? "post" : "posts"} so far. The host shows them
                    all at once.
                  </p>
                  {room.mine.length > 0 && (
                    <ol className="space-y-2">
                      {room.mine.map((p) => (
                        <li
                          key={p.id}
                          className="space-y-1 rounded-lg border border-accent bg-card p-3"
                        >
                          <p className="break-words text-sm text-text">{p.text}</p>
                          <div className="flex flex-wrap items-center gap-2">
                            <span className="text-xs text-sub">{statusText(p)}</span>
                            {p.status === "posted" && (
                              <Button
                                type="button"
                                variant="ghost"
                                size="sm"
                                onClick={() => void room.withdraw(p.id)}
                              >
                                Take it back
                              </Button>
                            )}
                          </div>
                        </li>
                      ))}
                    </ol>
                  )}
                </section>
              ) : (
                <section className="space-y-2" aria-label="The wall">
                  <WallPostList
                    posts={round.posts}
                    mine={mine}
                    myVotes={room.myVotes}
                    canVote={round.open}
                    onVote={(id) => void room.vote(id)}
                    onUnvote={(id) => void room.unvote(id)}
                    onWithdraw={(id) => void room.withdraw(id)}
                    onBuild={
                      canBuild && round.id
                        ? (p) => setReplyPick({ id: p.id, round: round.id })
                        : undefined
                    }
                    emptyText="Nothing on the wall yet."
                  />
                  {room.mine
                    .filter((p) => !round.posts?.some((x) => x.id === p.id))
                    .map((p) => (
                      <p key={p.id} className="break-words text-xs text-sub">
                        Your post &ldquo;{p.text}&rdquo;: {mineElsewhere(p, round.posts ?? [])}
                      </p>
                    ))}
                </section>
              )}
            </>
          )}

          {!handsFirst && handRow}
          <RoomReactions extras={extras} />
        </div>
      )}
    </main>
  );
}
