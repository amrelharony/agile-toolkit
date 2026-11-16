"use client";

/**
 * A wall room once it is open, on the host's screen: the prompt and mode,
 * Reveal, stop or start taking posts, Hide, Merge, Answered, raised hands,
 * New round, Save round, the timer, the reactions, the big screen, who is
 * in, End room and the idle prompt. `WallRoomHost` mounts it after the
 * consent dialog, loading this module only then (next/dynamic): no key or
 * channel exists before, and a tool page that never opens a wall doesn't
 * download any of it.
 */

import { useEffect, useId, useRef, useState } from "react";
import { Check, Eye, Hand, Lock, MessagesSquare, RefreshCw, Unlock } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Field } from "@/components/ui/field";
import { Input } from "@/components/ui/input";
import { ConfirmDialog } from "@/components/shared/confirm-dialog";
import { useAnnounce } from "@/components/a11y/live-announcer";
import { VisitorRoomChip } from "@/components/collab/visitor-room-chip";
import { IdlePromptDialog, RoomMemberList } from "@/components/collab/room-controls";
import { RoomBigScreen, useBigScreen } from "@/components/collab/room-big-screen";
import { RoomTimerControls } from "@/components/collab/room-countdown";
import { RoomReactions } from "@/components/collab/room-reactions";
import { useRoomExtras } from "@/lib/realtime/use-room-extras";
import { useSaveRound } from "@/components/collab/vote-room/save-round";
import type { VisitorIdentity } from "@/lib/realtime/visitor-rooms";
import { readVoteLinkFragment } from "@/lib/realtime/vote-room/crypto";
import { isSignedRoomClosed } from "@/lib/realtime/use-signed-room";
import {
  WALL_LIMITS,
  type WallMode,
  type WallRoundResult,
} from "@/lib/realtime/wall-room/protocol";
import { useWallRoom, type WallRoundScreen } from "@/lib/realtime/wall-room/use-wall-room";
import { cn } from "@/lib/utils";
import { WallPostList } from "./wall-post-list";
import type { WallRoomHostProps } from "./wall-room-host";

export interface WallSession {
  code: string;
  identity: VisitorIdentity;
  startedAt: number;
}

const MODES: { value: WallMode; label: string; hint: string }[] = [
  {
    value: "hidden",
    label: "Hidden until I reveal them",
    hint: "Everyone sees only how many have posted, until you press Reveal. Reveal shows them all at once and stops new posts and upvotes.",
  },
  {
    value: "live",
    label: "Show posts as they arrive",
    hint: "Good for questions people upvote as they go. Others could tell who sent a post or an upvote from when it shows, so pick hidden for anything sensitive.",
  },
];

export function HostWallRoom({
  tool,
  toolName,
  session,
  onSave,
  renderResults,
  defaultPrompt = "",
  defaultMode = "hidden",
  roundOptions,
  answerable = false,
  promptSuggestions = [],
  children,
  crypto,
  onClosed,
}: Omit<WallRoomHostProps, "startLabel" | "description"> & {
  session: WallSession;
  onClosed: () => void;
}) {
  const room = useWallRoom({
    role: "host",
    tool,
    code: session.code,
    identity: session.identity,
    startedAt: session.startedAt,
    crypto,
  });
  const extras = useRoomExtras(room.extras);
  const big = useBigScreen();
  const announce = useAnnounce();
  const { save, isSaved } = useSaveRound<WallRoundResult>(onSave);
  const [prompt, setPrompt] = useState(defaultPrompt);
  const [mode, setMode] = useState<WallMode>(defaultMode);
  const [promptError, setPromptError] = useState<string | null>(null);
  const [setup, setSetup] = useState(true);
  const [confirmNew, setConfirmNew] = useState(false);
  const [confirmEnd, setConfirmEnd] = useState(false);
  const [confirmClose, setConfirmClose] = useState(false);
  const [notice, setNotice] = useState<string | null>(null);
  const modeName = useId();
  const closedRef = useRef<HTMLHeadingElement>(null);
  const roundRef = useRef<HTMLHeadingElement>(null);
  const { status, round } = room;
  const closed = isSignedRoomClosed(status);
  const result = round ? room.result() : null;
  const saved = isSaved(round?.id);
  const unsaved = Boolean(result) && !saved;

  const lastStatus = useRef(status);
  useEffect(() => {
    const prev = lastStatus.current;
    lastStatus.current = status;
    if (prev === status) return;
    if (status === "live") announce("Live wall started. Share it with Copy link or Show QR code.");
    if (closed) closedRef.current?.focus();
  }, [status, closed, announce]);

  const start = () => {
    if (!room.openRound(prompt, mode, roundOptions)) {
      setPromptError(
        status === "live" ? "Write a prompt for the wall." : "Wait until the room is connected."
      );
      return;
    }
    setPromptError(null);
    setSetup(false);
    announce(
      mode === "hidden"
        ? "The wall is open. Posts stay hidden until you reveal them."
        : "The wall is open."
    );
    window.setTimeout(() => roundRef.current?.focus(), 0);
  };

  if (closed) {
    return (
      <section className="space-y-3 rounded-lg border border-border bg-card p-3 sm:p-4">
        <h2
          ref={closedRef}
          tabIndex={-1}
          className="text-base font-semibold text-text outline-none"
        >
          {status === "expired"
            ? "The wall reached its 3-hour limit and closed"
            : status === "unavailable"
              ? "Live rooms aren't available right now"
              : room.endReason === "idle"
                ? "The wall ended after 30 minutes without activity"
                : "You ended the live wall"}
        </h2>
        <p className="text-sm text-sub">
          {unsaved
            ? "Save the posts below if you want to keep them. Nothing else from the room was kept."
            : saved
              ? "This round's posts are saved."
              : "Nothing from the room was kept."}
        </p>
        {result && unsaved && (
          <WallPostList
            posts={result.posts.map(({ re, ...p }, i) => ({
              ...p,
              id: `p${i}`,
              ...(re !== undefined ? { re: `p${re}` } : {}),
            }))}
          />
        )}
        {result && unsaved && renderResults?.(result)}
        <div className="flex flex-wrap gap-2">
          {unsaved && (
            <Button
              type="button"
              variant="toolkit"
              className="gap-1.5"
              onClick={() => save(result)}
            >
              <Check className="h-4 w-4" aria-hidden="true" />
              Save round
            </Button>
          )}
          <Button
            type="button"
            variant="outline"
            onClick={() => (unsaved ? setConfirmClose(true) : onClosed())}
          >
            Close
          </Button>
        </div>
        <ConfirmDialog
          open={confirmClose}
          onOpenChange={setConfirmClose}
          title="Close without saving?"
          description="These posts aren't saved, and the room has ended, so they can't be recovered."
          confirmLabel="Close without saving"
          onConfirm={onClosed}
        />
      </section>
    );
  }

  const hash = room.joinPath ? room.joinPath.slice(room.joinPath.indexOf("#")) : "";
  const fingerprint = readVoteLinkFragment(hash);
  const others = room.members.filter((m) => m.id !== room.selfId);
  const hiddenUntilReveal = round !== null && round.posts === null;

  return (
    <section
      aria-label={`Live ${toolName} wall`}
      className="space-y-4 rounded-lg border border-accent/30 bg-card p-3 sm:p-4"
    >
      {status !== "live" || !room.joinPath ? (
        <p role="status" className="text-sm text-sub">
          {status === "preparing" ? "Preparing the wall…" : "Connecting to the room…"}
        </p>
      ) : (
        <div className="space-y-1">
          <VisitorRoomChip
            tool={tool}
            code={session.code}
            memberCount={room.members.length}
            isHost
            onEnd={() => setConfirmEnd(true)}
            linkFragment={fingerprint ? `#k=${fingerprint}` : undefined}
            onBigScreen={big.show}
          />
          <p className="text-xs text-sub">
            Share it with Copy link or Show QR code: both carry the key that shows the wall comes
            from you. Posts carry no names, and nothing is kept unless you save it.
          </p>
        </div>
      )}
      <RoomBigScreen
        {...big.props}
        tool={tool}
        toolName={toolName}
        code={session.code}
        linkFragment={fingerprint ? `#k=${fingerprint}` : undefined}
        memberCount={room.members.length}
        timer={extras.timer}
        reactions={extras.reactions}
      >
        <WallBigScreenRound round={round} />
      </RoomBigScreen>

      {setup || !round ? (
        <form
          className="space-y-3"
          noValidate
          onSubmit={(e) => {
            e.preventDefault();
            start();
          }}
        >
          <Field
            label="Prompt"
            hint="What you ask the room, e.g. What should we stop doing?"
            error={promptError}
            required
          >
            {(props) => (
              <Input
                {...props}
                value={prompt}
                maxLength={WALL_LIMITS.maxPromptChars}
                onChange={(e) => {
                  setPrompt(e.target.value);
                  if (promptError) setPromptError(null);
                }}
              />
            )}
          </Field>
          {promptSuggestions.length > 0 && (
            <div role="group" aria-label="Suggested prompts" className="flex flex-wrap gap-1.5">
              {promptSuggestions.map((s) => (
                <Button
                  key={s}
                  type="button"
                  variant="outline"
                  size="sm"
                  className="h-auto max-w-full whitespace-normal py-1 text-left"
                  aria-pressed={prompt === s}
                  onClick={() => {
                    setPrompt(s);
                    if (promptError) setPromptError(null);
                  }}
                >
                  {s}
                </Button>
              ))}
            </div>
          )}
          <fieldset className="min-w-0 space-y-2">
            <legend className="text-sm font-medium text-text">Posts</legend>
            {MODES.map((m) => (
              <label
                key={m.value}
                className={cn(
                  "flex min-h-11 cursor-pointer items-start gap-3 rounded-lg border border-border bg-surface-deep px-3 py-2",
                  mode === m.value && "border-accent"
                )}
              >
                <input
                  type="radio"
                  name={modeName}
                  className="mt-1 h-4 w-4 shrink-0"
                  checked={mode === m.value}
                  onChange={() => setMode(m.value)}
                />
                <span className="min-w-0">
                  <span className="block text-sm text-text">{m.label}</span>
                  <span className="block text-xs text-sub">{m.hint}</span>
                </span>
              </label>
            ))}
          </fieldset>
          <div className="flex flex-wrap gap-2">
            <Button
              type="submit"
              variant="toolkit"
              className="gap-1.5"
              disabled={status !== "live"}
            >
              <MessagesSquare className="h-4 w-4" aria-hidden="true" />
              Open the wall
            </Button>
            {round && (
              <Button type="button" variant="outline" onClick={() => setSetup(false)}>
                Back to the wall
              </Button>
            )}
          </div>
        </form>
      ) : (
        <div className="space-y-3">
          <div className="space-y-1">
            <h2
              ref={roundRef}
              tabIndex={-1}
              className="break-words text-base font-semibold text-text outline-none"
            >
              {round.prompt}
            </h2>
            <p className="text-sm text-sub" aria-live="polite">
              {round.count} {round.count === 1 ? "post" : "posts"}
              {round.scoring === "open"
                ? `, being scored (${round.scored ?? 0} ${round.scored === 1 ? "score" : "scores"} so far)`
                : round.scoring === "shown"
                  ? ", scores shown"
                  : round.open
                    ? ", taking posts"
                    : ", not taking posts"}
              {round.build && !round.scoring ? ", Yes, and… on" : ""}
              {hiddenUntilReveal ? ", hidden until you reveal them" : ""}.
            </p>
          </div>
          <div className="flex flex-wrap gap-2">
            {hiddenUntilReveal && (
              <Button
                type="button"
                variant="toolkit"
                className="gap-1.5"
                onClick={() => {
                  room.reveal();
                  announce(
                    "Posts revealed to the room. The wall stopped taking posts and upvotes."
                  );
                }}
              >
                <Eye className="h-4 w-4" aria-hidden="true" />
                Reveal posts
              </Button>
            )}
            {!round.scoring && (
              <Button
                type="button"
                variant="outline"
                className="gap-1.5"
                onClick={() => room.setOpen(!round.open)}
              >
                {round.open ? (
                  <Lock className="h-4 w-4" aria-hidden="true" />
                ) : (
                  <Unlock className="h-4 w-4" aria-hidden="true" />
                )}
                {round.open ? "Stop taking posts" : "Take posts again"}
              </Button>
            )}
            {!hiddenUntilReveal && (
              <Button
                type="button"
                variant="toolkit"
                className="gap-1.5"
                disabled={!result || saved}
                onClick={() => save(result)}
              >
                <Check className="h-4 w-4" aria-hidden="true" />
                {saved ? "Round saved" : "Save round"}
              </Button>
            )}
            <Button
              type="button"
              variant="outline"
              className="gap-1.5"
              onClick={() => (unsaved || hiddenUntilReveal ? setConfirmNew(true) : setSetup(true))}
            >
              <RefreshCw className="h-4 w-4" aria-hidden="true" />
              New round
            </Button>
          </div>
          {round.mode === "hidden" && round.revealed && !round.open && !round.scoring && (
            <p className="text-xs text-sub">
              Reveal stopped new posts and upvotes. If you take posts again, upvotes open again too,
              and each post or upvote shows as it arrives, as in a live round, so others could tell
              who sent it.
            </p>
          )}

          {hiddenUntilReveal ? (
            // No post text in this page until Reveal: only the count.
            <p className="rounded-lg border border-dashed border-border px-3 py-2.5 text-sm text-sub">
              {round.count === 0
                ? "No posts yet. They stay hidden, here too, until you reveal them."
                : `${round.count} ${round.count === 1 ? "post" : "posts"} so far. They stay hidden, here too, until you reveal them.`}
            </p>
          ) : (
            <WallPostList
              posts={round.posts ?? []}
              onHide={room.hide}
              onMerge={
                // Scores don't merge: a scored round's posts stay as they are.
                round.scoring
                  ? undefined
                  : (from, into) => {
                      room.merge(from, into);
                      setNotice("Merged the post into the one you picked.");
                    }
              }
              onAnswer={answerable ? room.answer : undefined}
              emptyText="No posts yet."
            />
          )}
          {result && !hiddenUntilReveal && renderResults?.(result)}
        </div>
      )}

      {children?.(room, { unsaved: unsaved || (hiddenUntilReveal && (round?.count ?? 0) > 0) })}

      {room.hands.length > 0 && (
        <section aria-label="Raised hands" className="space-y-2">
          <div className="flex flex-wrap items-center justify-between gap-2">
            <h2 className="flex items-center gap-1.5 text-sm font-semibold text-text">
              <Hand className="h-4 w-4 text-accent" aria-hidden="true" />
              Raised hands
            </h2>
            {room.hands.length > 1 && (
              <Button
                type="button"
                variant="ghost"
                size="sm"
                onClick={() => {
                  room.lowerAllHands();
                  announce("Lowered every hand.");
                }}
              >
                Lower all
              </Button>
            )}
          </div>
          <ol className="space-y-1">
            {room.hands.map((h, i) => (
              <li key={h.id} className="flex items-center justify-between gap-2 text-sm">
                <span className="min-w-0 truncate text-text">
                  {i + 1}. {h.name}
                </span>
                <Button
                  type="button"
                  variant="ghost"
                  size="sm"
                  onClick={() => room.lowerHand(h.id)}
                >
                  Lower<span className="sr-only"> {h.name}&apos;s hand</span>
                </Button>
              </li>
            ))}
          </ol>
        </section>
      )}

      <RoomTimerControls
        timer={extras.timer}
        onChange={extras.setTimer}
        disabled={!extras.canSetTimer || status !== "live"}
      />
      <RoomReactions extras={extras} />

      {others.length > 0 && (
        <RoomMemberList
          members={room.members}
          selfId={room.selfId}
          hostId={room.selfId}
          removedIds={room.removedIds}
          onRemove={(id, name) => {
            room.kick(id);
            setNotice(`Removed ${name}. If they come back, end the room and share a new link.`);
          }}
        />
      )}
      {notice && (
        <p role="status" className="text-xs text-sub">
          {notice}
        </p>
      )}

      <ConfirmDialog
        open={confirmNew}
        onOpenChange={setConfirmNew}
        title="Start a new round?"
        description={
          hiddenUntilReveal
            ? "The posts so far haven't been revealed. A new round clears them."
            : "These posts aren't saved yet. A new round clears them."
        }
        confirmLabel="New round"
        onConfirm={() => setSetup(true)}
      />
      <ConfirmDialog
        open={confirmEnd}
        onOpenChange={setConfirmEnd}
        title="End the live wall?"
        description="Everyone in the room is disconnected. Revealed posts stay here until you save or close them; hidden ones are lost."
        confirmLabel="End room"
        onConfirm={() => room.end()}
      />
      <IdlePromptDialog
        open={room.idlePrompt}
        onKeepOpen={room.keepOpen}
        onEnd={() => room.end()}
        note="Posts not yet saved are lost when it ends."
      />
    </section>
  );
}

/**
 * A wall round on the big screen: the prompt, then the posts the host has
 * not hidden, without names. While the round is hidden until reveal only
 * the count shows: this screen holds no post text then.
 */
export function WallBigScreenRound({ round }: { round: WallRoundScreen | null }) {
  if (!round) return <p className="text-lg text-sub">The wall opens in a moment.</p>;
  return (
    <div className="space-y-3">
      <h2 className="break-words text-2xl font-semibold">{round.prompt}</h2>
      {round.posts === null ? (
        <p className="text-lg text-sub">
          {round.count} {round.count === 1 ? "post" : "posts"} so far, hidden until the host reveals
          them.
        </p>
      ) : (
        <WallPostList posts={round.posts.filter((p) => !p.hidden)} emptyText="No posts yet." />
      )}
    </div>
  );
}
