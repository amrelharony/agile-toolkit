"use client";

/**
 * A tool's entry point for a wall room (Audience Wall): "Open a live wall"
 * asks for a name and consent, then opens the room; no key or channel
 * exists before that. The host puts a prompt up, chooses "Show posts as
 * they arrive" or "Hidden until I reveal them", and runs the wall: Reveal,
 * stop or start taking posts, Hide a post, Merge duplicates, lower a raised
 * hand, New round, End room.
 *
 * While a round is hidden until reveal, this page holds no post text: only
 * the count shows (`useWallRoom`'s view has no posts then). Nothing is kept
 * unless the host presses Save round, and then only the prompt and each
 * post's text and votes go to the tool's `onSave`: no ids, no names.
 *
 *   <WallRoomHost tool="audience-wall" toolName="Audience Wall" onSave={saveWall} />
 */

import { useEffect, useId, useRef, useState, type ReactNode } from "react";
import { Check, Eye, Hand, Lock, MessagesSquare, RefreshCw, Unlock } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Field } from "@/components/ui/field";
import { Input } from "@/components/ui/input";
import { ConfirmDialog } from "@/components/shared/confirm-dialog";
import { useAnnounce } from "@/components/a11y/live-announcer";
import { VisitorRoomChip } from "@/components/collab/visitor-room-chip";
import { VisitorRoomConsent } from "@/components/collab/visitor-room-consent";
import { IdlePromptDialog, RoomMemberList } from "@/components/collab/room-controls";
import { LiveRoomLimits } from "@/components/collab/run-modes";
import { liveOnlyReason } from "@/components/collab/live-room-reasons";
import { useSaveRound, type SaveRound } from "@/components/collab/vote-room/save-round";
import { signalGamification } from "@/lib/gamification/signal";
import {
  clearVisitorIdentity,
  newVisitorRoomCode,
  saveVisitorIdentity,
  type VisitorIdentity,
} from "@/lib/realtime/visitor-rooms";
import { readVoteLinkFragment, type VoteCrypto } from "@/lib/realtime/vote-room/crypto";
import { useVoteRoomsAvailable } from "@/lib/realtime/vote-room/use-vote-room";
import { isSignedRoomClosed } from "@/lib/realtime/use-signed-room";
import {
  WALL_LIMITS,
  type WallMode,
  type WallRoomTool,
  type WallRoundResult,
} from "@/lib/realtime/wall-room/protocol";
import { useWallRoom, type WallRoom } from "@/lib/realtime/wall-room/use-wall-room";
import { toast } from "@/lib/utils/toast";
import { cn } from "@/lib/utils";
import { WallPostList } from "./wall-post-list";

export interface WallRoomHostProps {
  tool: WallRoomTool;
  /** Shown in the consent title and the panel, e.g. "Audience Wall". */
  toolName: string;
  /**
   * Save round: the prompt and each post's text and votes, once per round.
   * Return an undo to get Undo in the kit's toast, or false when nothing was
   * stored (Save round stays).
   */
  onSave: SaveRound<WallRoundResult>;
  /** Shown under the posts, before Save round (the tool's own view of them). */
  renderResults?: (result: WallRoundResult) => ReactNode;
  /** The first round's prompt, prefilled. */
  defaultPrompt?: string;
  defaultMode?: WallMode;
  /** The start button's words. */
  startLabel?: string;
  /** One line under the start button. */
  description?: ReactNode;
  /** The tool's own host controls while the room is live. */
  children?: (room: WallRoom) => ReactNode;
  /** Tests inject a fake (undefined: WebCrypto). */
  crypto?: VoteCrypto | null;
}

interface Session {
  code: string;
  identity: VisitorIdentity;
  startedAt: number;
}

export function WallRoomHost({
  startLabel = "Open a live wall",
  description,
  crypto,
  ...rest
}: WallRoomHostProps) {
  const { tool, toolName } = rest;
  const availability = useVoteRoomsAvailable(crypto);
  const [consentOpen, setConsentOpen] = useState(false);
  const [session, setSession] = useState<Session | null>(null);
  const startRef = useRef<HTMLButtonElement>(null);
  const refocus = useRef(false);

  useEffect(() => {
    if (session || !refocus.current) return;
    refocus.current = false;
    startRef.current?.focus();
  }, [session]);

  if (session) {
    return (
      <HostWallRoom
        key={session.code}
        {...rest}
        crypto={crypto}
        session={session}
        onClosed={() => {
          clearVisitorIdentity(session.code);
          refocus.current = true;
          setSession(null);
        }}
      />
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
        <MessagesSquare className="h-4 w-4" aria-hidden="true" />
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
        variant="wall"
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

const MODES: { value: WallMode; label: string; hint: string }[] = [
  {
    value: "hidden",
    label: "Hidden until I reveal them",
    hint: "Everyone sees only how many have posted, until you press Reveal.",
  },
  {
    value: "live",
    label: "Show posts as they arrive",
    hint: "Good for questions people upvote as they go.",
  },
];

function HostWallRoom({
  tool,
  toolName,
  session,
  onSave,
  renderResults,
  defaultPrompt = "",
  defaultMode = "hidden",
  children,
  crypto,
  onClosed,
}: Omit<WallRoomHostProps, "startLabel" | "description"> & {
  session: Session;
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
    if (!room.openRound(prompt, mode)) {
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
          <WallPostList posts={result.posts.map((p, i) => ({ id: `p${i}`, ...p }))} />
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
          />
          <p className="text-xs text-sub">
            Share it with Copy link or Show QR code: both carry the key that shows the wall comes
            from you. Posts carry no names, and nothing is kept unless you save it.
          </p>
        </div>
      )}

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
              {round.open ? ", taking posts" : ", not taking posts"}
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
                  announce("Posts revealed to the room.");
                }}
              >
                <Eye className="h-4 w-4" aria-hidden="true" />
                Reveal posts
              </Button>
            )}
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
              onMerge={(from, into) => {
                room.merge(from, into);
                setNotice("Merged the post into the one you picked.");
              }}
              emptyText="No posts yet."
            />
          )}
          {result && !hiddenUntilReveal && renderResults?.(result)}
        </div>
      )}

      {children?.(room)}

      {room.hands.length > 0 && (
        <section aria-label="Raised hands" className="space-y-2">
          <h2 className="flex items-center gap-1.5 text-sm font-semibold text-text">
            <Hand className="h-4 w-4 text-accent" aria-hidden="true" />
            Raised hands
          </h2>
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
