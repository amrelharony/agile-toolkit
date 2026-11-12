"use client";

/**
 * The host's side of a live vote round, mounted by `VoteRoundPanel` only
 * after the consent step, so no channel or key exists before it.
 *
 * Before Reveal the host sees how many people have answered and nothing
 * else: no distribution, no per-question counts. Reveal waits for minN
 * answers; in an allocation round a hint by Reveal also says, until
 * `VOTE_LIMITS.minNSpread` have answered, that who backed what and the
 * spread show only from that many (Reveal closes the round, so revealing
 * sooner loses them). After it come the totals, "Save round" (the tool's
 * `onSave`, once per round, aggregates only; it stays available when the tool
 * refuses the round) and "New round". Ending the room keeps
 * revealed results on screen until they are saved or dismissed (Close asks
 * first when they aren't saved); nothing is stored unless the host saves.
 *
 * Whenever an action removes the control that had focus (Reveal, the
 * host's own answers, New round), focus moves to what replaced it and the
 * change is announced.
 *
 * Every kind of round runs here: `round` is the questionnaire or sheet for
 * `kind` (the tool's usual kind when unset; the only one for the six tools
 * from before), and the form, the results and the saved result follow the
 * kind of the round that is running (`round-views.tsx`). New round uses
 * the `round` and `kind` given now, so a tool that runs several kinds
 * (Quick Vote) can switch kind between rounds. `VoteRoundPanel` hands each
 * tool its own typed `onSave`.
 */

import { useEffect, useId, useRef, useState, type ReactNode } from "react";
import { Check, Eye, ListChecks, RefreshCw, ShieldAlert } from "lucide-react";
import { Button } from "@/components/ui/button";
import { ConfirmDialog } from "@/components/shared/confirm-dialog";
import { useAnnounce } from "@/components/a11y/live-announcer";
import { VisitorRoomChip } from "@/components/collab/visitor-room-chip";
import { IdlePromptDialog, RoomMemberList } from "@/components/collab/room-controls";
import type { VisitorIdentity } from "@/lib/realtime/visitor-rooms";
import type { VoteRoomTool, VoteRoundKind } from "@/lib/realtime/vote-room/protocol";
import {
  resultKind,
  roundKindOf,
  specOf,
  type RoundInput,
  type RoundResult,
} from "@/lib/realtime/vote-room/kinds";
import { readVoteLinkFragment, type VoteCrypto } from "@/lib/realtime/vote-room/crypto";
import {
  useVoteRoom,
  type VoteEndReason,
  type VoteRoomStatus,
} from "@/lib/realtime/vote-room/use-vote-room";
import { toast } from "@/lib/utils/toast";
import {
  LiveRoundResults,
  RoundAnswerForm,
  SavedRoundResults,
  resultKeepable,
  roomResult,
  roomSpreadNote,
} from "./round-views";
import { announceToolMoment } from "@/lib/agent/mascot/tool-moments";
import { useSaveRound, type SaveRound } from "./save-round";
import { VoteLiveCount } from "./vote-live-count";

export interface HostVoteSession {
  code: string;
  identity: VisitorIdentity;
  startedAt: number;
}

export interface HostVoteRoomProps {
  tool: VoteRoomTool;
  toolName: string;
  session: HostVoteSession;
  /**
   * What the round asks now, of `kind`: a `Questionnaire` (scale), a
   * `PairSheet`, an `AllocationSheet`, a `ChoiceSheet`, a `RankSheet` or a
   * `NumberSheet`. The first round's, and what New round uses.
   */
  round: RoundInput;
  /**
   * The kind of round `round` is, one the tool may run. Defaults to the
   * tool's usual kind (`roundKindOf`), the only one for the six tools from
   * before.
   */
  kind?: VoteRoundKind;
  minN?: number;
  /**
   * Save round: totals only, once per round. Return an undo to get Undo in
   * the kit's toast, or false when nothing was stored (Save round stays).
   */
  onSave: SaveRound<RoundResult>;
  /** Shown under revealed results, before Save round (e.g. what the tool will make of them). */
  renderResults?: (result: RoundResult) => ReactNode;
  /** The host dismissed the closed room. */
  onClosed: () => void;
  /** Tests inject a fake. */
  crypto?: VoteCrypto | null;
}

const LIVE: ReadonlySet<VoteRoomStatus> = new Set<VoteRoomStatus>([
  "preparing",
  "connecting",
  "waiting",
  "live",
]);

function closedTitle(status: VoteRoomStatus, reason: VoteEndReason | null): string {
  switch (status) {
    case "expired":
      return "The live round reached its 3-hour limit and closed";
    case "full":
      return "That room was full";
    case "unavailable":
      return "Live rounds aren't available right now";
    default:
      return reason === "idle"
        ? "The live round ended after 30 minutes without activity"
        : "You ended the live round";
  }
}

function people(n: number): string {
  return `${n} ${n === 1 ? "person" : "people"}`;
}

export function HostVoteRoom({
  tool,
  toolName,
  session,
  round,
  kind: kindProp,
  minN,
  onSave,
  renderResults,
  onClosed,
  crypto,
}: HostVoteRoomProps) {
  // The round goes in named by its kind; the hook checks the tool runs it.
  const kindAsked = kindProp ?? roundKindOf(tool);
  const room = useVoteRoom({
    role: "host",
    tool,
    code: session.code,
    identity: session.identity,
    round: kindAsked ? specOf(kindAsked, round) : undefined,
    minN,
    startedAt: session.startedAt,
    crypto,
  });
  // The running round's kind (New round may have changed it).
  const kind = room.kind;
  const announce = useAnnounce();
  const [confirmEnd, setConfirmEnd] = useState(false);
  const [confirmNew, setConfirmNew] = useState(false);
  const [answering, setAnswering] = useState(false);
  const [focusCounted, setFocusCounted] = useState(false);
  const { save, isSaved } = useSaveRound(onSave);
  const revealHintId = useId();
  const spreadHintId = useId();
  const openRef = useRef<HTMLDivElement>(null);
  const countedRef = useRef<HTMLParagraphElement>(null);
  const { status, endReason, roundId, phase } = room;
  const result = roomResult(room);
  const live = LIVE.has(status);
  const saved = isSaved(result?.roundId);

  const lastStatus = useRef<VoteRoomStatus | null>(null);
  useEffect(() => {
    const prev = lastStatus.current;
    lastStatus.current = status;
    if (prev === status) return;
    if (status === "live") {
      announce("Live round started. Share it with your team: Copy link or Show QR code.");
      return;
    }
    if (LIVE.has(status)) return;
    const title = closedTitle(status, endReason);
    if (status === "unavailable") toast.error(`${title}.`);
    else toast.success(`${title}.`);
  }, [status, endReason, announce]);

  // A new round starts with the form closed. Once it really started (the
  // round id changed: a refused or failed New round changes nothing), say
  // so and put focus on the new round's count.
  const lastRound = useRef(roundId);
  useEffect(() => {
    const prev = lastRound.current;
    lastRound.current = roundId;
    setAnswering(false);
    if (prev === null || roundId === null || prev === roundId) return;
    announce("New round started. Answers from the last round are gone.");
    openRef.current?.focus();
  }, [roundId, announce]);

  // Reveal removed the button that had focus: the results heading takes it.
  const lastPhase = useRef(phase);
  useEffect(() => {
    const prev = lastPhase.current;
    lastPhase.current = phase;
    if (prev === "open" && phase === "revealed") {
      announce(`Results revealed: ${people(room.ballots)} answered.`);
      announceToolMoment(tool, "round_revealed");
    }
  }, [phase, room.ballots, announce, tool]);

  // The host's own answers are in: the form and its button are gone.
  useEffect(() => {
    if (!focusCounted || !room.answered) return;
    setFocusCounted(false);
    countedRef.current?.focus();
    announce("Your own answers are counted.");
  }, [focusCounted, room.answered, announce]);

  // The round and kind the tool gives now: a tool with several kinds may switch.
  const startNewRound = () => room.newRound(kindAsked ? specOf(kindAsked, round) : round);

  if (!live) {
    return (
      <ClosedHostRoom
        title={closedTitle(status, endReason)}
        result={result}
        saved={saved}
        onSave={() => save(result)}
        onClosed={onClosed}
        renderResults={renderResults}
      />
    );
  }

  const hash = room.joinPath ? room.joinPath.slice(room.joinPath.indexOf("#")) : "";
  const fingerprint = readVoteLinkFragment(hash);
  const others = room.members.filter((m) => m.id !== room.selfId);
  // Allocation, dot and number rounds have a second threshold; say it by
  // Reveal until it is met.
  const spreadText = roomSpreadNote(room);
  const spreadHint = spreadText !== null;
  const revealDescribedBy =
    [room.revealBlockedReason ? revealHintId : null, spreadHint ? spreadHintId : null]
      .filter(Boolean)
      .join(" ") || undefined;

  return (
    <section
      aria-label={`Live ${toolName} round`}
      className="space-y-4 rounded-lg border border-accent/30 bg-card p-3 sm:p-4"
    >
      {status === "preparing" || status === "connecting" || !room.joinPath ? (
        <p role="status" className="text-sm text-sub">
          {status === "preparing" ? "Preparing the round…" : "Connecting to the room…"}
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
            Share it with Copy link or Show QR code: both carry the key that shows the questions
            come from you. Only the totals are kept, and only if you save them.
          </p>
        </div>
      )}

      {room.stuffingSuspected && (
        <Warning>
          More answers than different names in the room: someone may have answered twice from
          another tab. If the totals look wrong, start a new round.
        </Warning>
      )}
      {room.duplicateBallots > 0 && (
        <Warning>
          {room.duplicateBallots === 1
            ? "An answer came under a name that had already answered."
            : `${room.duplicateBallots} answers came under names that had already answered.`}{" "}
          Someone may be answering for other people, which can single out one person&apos;s answers.
          To be safe, end the room and share a new link.
        </Warning>
      )}

      {phase === "open" && (
        <div className="space-y-3">
          <div ref={openRef} tabIndex={-1} className="outline-none">
            <VoteLiveCount
              ballots={room.ballots}
              present={room.members.length}
              minN={room.minN}
              phase={phase}
            />
          </div>
          <div className="flex flex-wrap items-center gap-2">
            <Button
              type="button"
              variant="toolkit"
              className="gap-1.5"
              onClick={room.reveal}
              disabled={!room.canReveal}
              aria-describedby={revealDescribedBy}
            >
              <Eye className="h-4 w-4" aria-hidden="true" />
              Reveal results
            </Button>
            {!room.answered && (
              <Button
                type="button"
                variant="outline"
                className="gap-1.5"
                aria-expanded={answering}
                onClick={() => setAnswering((a) => !a)}
              >
                <ListChecks className="h-4 w-4" aria-hidden="true" />
                {answering ? "Hide my answers" : "Answer too"}
              </Button>
            )}
          </div>
          {room.revealBlockedReason && (
            <p id={revealHintId} className="text-xs text-sub">
              {room.revealBlockedReason}
            </p>
          )}
          {spreadHint && (
            <p id={spreadHintId} className="text-xs text-sub">
              {spreadText}
            </p>
          )}
          {room.answered && (
            <p ref={countedRef} tabIndex={-1} className="text-xs text-sub outline-none">
              Your own answers are counted.
            </p>
          )}
          {answering && !room.answered && (
            <RoundAnswerForm
              key={roundId ?? "none"}
              room={room}
              submitLabel={
                kind === "allocation"
                  ? "Count my split"
                  : kind === "scale" || kind === "pair"
                    ? "Count my answers"
                    : kind === "rank"
                      ? "Count my order"
                      : "Count my answer"
              }
              onSubmit={async (draft) => {
                const res = await room.submit(draft);
                if (res === "sent") {
                  setAnswering(false);
                  setFocusCounted(true);
                }
                return res;
              }}
            />
          )}
        </div>
      )}

      {phase === "revealed" && result && (
        <div className="space-y-3">
          <LiveRoundResults room={room} focusHeading />
          {renderResults?.(result)}
          <div className="flex flex-wrap gap-2">
            <Button
              type="button"
              variant="toolkit"
              className="gap-1.5"
              onClick={() => save(result)}
              disabled={!result || saved}
            >
              <Check className="h-4 w-4" aria-hidden="true" />
              {saved ? "Round saved" : "Save round"}
            </Button>
            <Button
              type="button"
              variant="outline"
              className="gap-1.5"
              onClick={() => (saved ? startNewRound() : setConfirmNew(true))}
            >
              <RefreshCw className="h-4 w-4" aria-hidden="true" />
              New round
            </Button>
          </div>
        </div>
      )}

      {phase === "open" && room.ballots > 0 ? (
        <Button
          type="button"
          variant="ghost"
          size="sm"
          className="gap-1.5"
          onClick={() => setConfirmNew(true)}
        >
          <RefreshCw className="h-3.5 w-3.5" aria-hidden="true" />
          Start over with a new round
        </Button>
      ) : null}

      {others.length > 0 && (
        <RoomMemberList
          members={room.members}
          selfId={room.selfId}
          hostId={room.selfId}
          removedIds={room.removedIds}
          onRemove={(id, name) => {
            room.kick(id);
            toast.success(`Removed ${name}. If they come back, end the room and share a new link.`);
          }}
        />
      )}

      <ConfirmDialog
        open={confirmNew}
        onOpenChange={setConfirmNew}
        title="Start a new round?"
        description={
          phase === "revealed"
            ? "These results aren't saved yet. A new round clears them."
            : room.ballots === 1
              ? "The 1 answer so far is discarded."
              : `The ${room.ballots} answers so far are discarded.`
        }
        confirmLabel="New round"
        onConfirm={startNewRound}
      />
      <ConfirmDialog
        open={confirmEnd}
        onOpenChange={setConfirmEnd}
        title="End the live room?"
        description="Everyone in the room is disconnected. Revealed results stay here until you save or close them; answers not yet revealed are lost."
        confirmLabel="End room"
        onConfirm={() => room.end()}
      />
      <IdlePromptDialog
        open={room.idlePrompt}
        onKeepOpen={room.keepOpen}
        onEnd={() => room.end()}
        note="Answers not yet revealed are lost when it ends."
      />
    </section>
  );
}

/** A warning the host should act on, announced when it appears. */
function Warning({ children }: { children: ReactNode }) {
  return (
    <p
      role="alert"
      className="flex items-start gap-2 rounded-md border border-warning/40 bg-warning/10 px-3 py-2 text-sm text-text"
    >
      <ShieldAlert className="mt-0.5 h-4 w-4 shrink-0 text-warning" aria-hidden="true" />
      <span>{children}</span>
    </p>
  );
}

/** The room has closed: say so, and keep unsaved results until the host saves or closes them. */
function ClosedHostRoom({
  title,
  result,
  saved,
  onSave,
  onClosed,
  renderResults,
}: {
  title: string;
  result: RoundResult | null;
  saved: boolean;
  onSave: () => void;
  onClosed: () => void;
  renderResults?: (result: RoundResult) => ReactNode;
}) {
  const headingRef = useRef<HTMLHeadingElement>(null);
  const [confirmClose, setConfirmClose] = useState(false);
  useEffect(() => {
    headingRef.current?.focus();
  }, [title]);
  // With every question (or item) withheld there are no totals a tool could
  // keep (each one refuses such a round), so don't offer Save or warn about
  // losing them. An allocation round always shows its totals.
  const keepable = resultKeepable(result);
  const nothing = result && resultKind(result) === "pair" ? "No item" : "No question";
  return (
    <section className="space-y-3 rounded-lg border border-border bg-card p-3 sm:p-4">
      <h2 ref={headingRef} tabIndex={-1} className="text-base font-semibold text-text outline-none">
        {title}
      </h2>
      <p className="text-sm text-sub">
        {result
          ? saved
            ? "This round's totals are saved."
            : keepable
              ? "Save the totals below if you want to keep them. Nothing else from the round was kept."
              : `${nothing} had enough answers to show, so there is nothing to save. Nothing from the round was kept.`
          : "Nothing from the round was kept."}
      </p>
      {result && <SavedRoundResults result={result} />}
      {result && keepable && renderResults?.(result)}
      <div className="flex flex-wrap gap-2">
        {(keepable || saved) && (
          <Button
            type="button"
            variant="toolkit"
            className="gap-1.5"
            onClick={onSave}
            disabled={saved}
          >
            <Check className="h-4 w-4" aria-hidden="true" />
            {saved ? "Round saved" : "Save round"}
          </Button>
        )}
        <Button
          type="button"
          variant="outline"
          onClick={() => (keepable && !saved ? setConfirmClose(true) : onClosed())}
        >
          Close
        </Button>
      </div>
      <ConfirmDialog
        open={confirmClose}
        onOpenChange={setConfirmClose}
        title="Close without saving?"
        description="These totals aren't saved, and the room has ended, so they can't be recovered."
        confirmLabel="Close without saving"
        onConfirm={onClosed}
      />
    </section>
  );
}
