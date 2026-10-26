"use client";

/**
 * The host's side of a live vote round, mounted by `VoteRoundPanel` only
 * after the consent step, so no channel or key exists before it.
 *
 * Before Reveal the host sees how many people have answered and nothing
 * else: no distribution, no per-question counts. Reveal waits for minN
 * answers. After it come the totals, "Save round" (the tool's `onSave`,
 * once per round, aggregates only) and "New round". Ending the room keeps
 * revealed results on screen until they are saved or dismissed; nothing
 * is stored unless the host saves.
 */

import { useEffect, useId, useRef, useState } from "react";
import { Check, Eye, ListChecks, RefreshCw, ShieldAlert } from "lucide-react";
import { Button } from "@/components/ui/button";
import { ConfirmDialog } from "@/components/shared/confirm-dialog";
import { useAnnounce } from "@/components/a11y/live-announcer";
import { VisitorRoomChip } from "@/components/collab/visitor-room-chip";
import { IdlePromptDialog, RoomMemberList } from "@/components/collab/room-controls";
import type { VisitorIdentity } from "@/lib/realtime/visitor-rooms";
import type { Questionnaire, VoteRoomTool } from "@/lib/realtime/vote-room/protocol";
import type { VoteRoundResult } from "@/lib/realtime/vote-room/aggregate";
import { readVoteLinkFragment, type VoteCrypto } from "@/lib/realtime/vote-room/crypto";
import {
  useVoteRoom,
  type VoteEndReason,
  type VoteRoomStatus,
} from "@/lib/realtime/vote-room/use-vote-room";
import { toast } from "@/lib/utils/toast";
import { VoteAnswerForm } from "./vote-answer-form";
import { VoteLiveCount } from "./vote-live-count";
import { VoteResults } from "./vote-results";

export interface HostVoteSession {
  code: string;
  identity: VisitorIdentity;
  startedAt: number;
}

export interface HostVoteRoomProps {
  tool: VoteRoomTool;
  toolName: string;
  session: HostVoteSession;
  /** The questions now: the first round's, and what New round uses. */
  questionnaire: Questionnaire;
  minN?: number;
  onSave: (result: VoteRoundResult) => void;
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

export function HostVoteRoom({
  tool,
  toolName,
  session,
  questionnaire,
  minN,
  onSave,
  onClosed,
  crypto,
}: HostVoteRoomProps) {
  const room = useVoteRoom({
    role: "host",
    tool,
    code: session.code,
    identity: session.identity,
    questionnaire,
    minN,
    startedAt: session.startedAt,
    crypto,
  });
  const announce = useAnnounce();
  const [confirmEnd, setConfirmEnd] = useState(false);
  const [confirmNew, setConfirmNew] = useState(false);
  const [savedRound, setSavedRound] = useState<string | null>(null);
  const [answering, setAnswering] = useState(false);
  const revealHintId = useId();
  const { status, endReason, result, roundId } = room;
  const live = LIVE.has(status);
  const saved = roundId !== null && savedRound === roundId;

  const lastStatus = useRef<VoteRoomStatus | null>(null);
  useEffect(() => {
    const prev = lastStatus.current;
    lastStatus.current = status;
    if (prev === status) return;
    if (status === "live") {
      announce("Live round started. Copy the link and share it with your team.");
      return;
    }
    if (LIVE.has(status)) return;
    const title = closedTitle(status, endReason);
    if (status === "unavailable") toast.error(`${title}.`);
    else toast.success(`${title}.`);
  }, [status, endReason, announce]);

  // A new round starts with the form closed.
  useEffect(() => setAnswering(false), [roundId]);

  const save = () => {
    if (!result || saved || roundId === null) return;
    setSavedRound(roundId);
    onSave(result);
  };

  const startNewRound = () => {
    room.newRound(questionnaire);
    announce("New round started. Answers from the last round are gone.");
  };

  if (!live) {
    return (
      <ClosedHostRoom
        title={closedTitle(status, endReason)}
        result={result}
        saved={saved}
        onSave={save}
        onClosed={onClosed}
      />
    );
  }

  const others = room.members.filter((m) => m.id !== room.selfId);
  const hash = room.joinPath ? room.joinPath.slice(room.joinPath.indexOf("#")) : "";
  const fingerprint = readVoteLinkFragment(hash);

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
            Share it with Copy link: the link carries the key that shows the questions come from
            you. Only the totals are kept, and only if you save them.
          </p>
        </div>
      )}

      {room.stuffingSuspected && (
        <p
          role="alert"
          className="flex items-start gap-2 rounded-md border border-warning/40 bg-warning/10 px-3 py-2 text-sm text-text"
        >
          <ShieldAlert className="mt-0.5 h-4 w-4 shrink-0 text-warning" aria-hidden="true" />
          More answers than different names in the room: someone may have answered twice from
          another tab. If the totals look wrong, start a new round.
        </p>
      )}

      {room.phase === "open" && (
        <div className="space-y-3">
          <VoteLiveCount
            ballots={room.ballots}
            present={room.members.length}
            minN={room.minN}
            phase={room.phase}
          />
          <div className="flex flex-wrap items-center gap-2">
            <Button
              type="button"
              variant="toolkit"
              className="gap-1.5"
              onClick={room.reveal}
              disabled={!room.canReveal}
              aria-describedby={room.revealBlockedReason ? revealHintId : undefined}
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
          {room.answered && <p className="text-xs text-sub">Your own answers are counted.</p>}
          {answering && !room.answered && room.questionnaire && (
            <VoteAnswerForm
              questionnaire={room.questionnaire}
              submitLabel="Count my answers"
              onSubmit={async (draft) => {
                const res = await room.submit(draft);
                if (res === "sent") setAnswering(false);
                return res;
              }}
            />
          )}
        </div>
      )}

      {room.phase === "revealed" && room.revealed && room.questionnaire && (
        <div className="space-y-3">
          <VoteResults
            questionnaire={room.questionnaire}
            revealed={room.revealed}
            minN={room.minN}
            ballots={room.ballots}
          />
          <div className="flex flex-wrap gap-2">
            <Button
              type="button"
              variant="toolkit"
              className="gap-1.5"
              onClick={save}
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

      {room.phase === "open" && room.ballots > 0 ? (
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
          room.phase === "revealed"
            ? "These results aren't saved yet. A new round clears them."
            : `The ${room.ballots} ${room.ballots === 1 ? "answer" : "answers"} so far are discarded.`
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

/** The room has closed: say so, and keep unsaved results until the host saves or closes them. */
function ClosedHostRoom({
  title,
  result,
  saved,
  onSave,
  onClosed,
}: {
  title: string;
  result: VoteRoundResult | null;
  saved: boolean;
  onSave: () => void;
  onClosed: () => void;
}) {
  const headingRef = useRef<HTMLHeadingElement>(null);
  useEffect(() => {
    headingRef.current?.focus();
  }, [title]);
  return (
    <section className="space-y-3 rounded-lg border border-border bg-card p-3 sm:p-4">
      <h2 ref={headingRef} tabIndex={-1} className="text-base font-semibold text-text outline-none">
        {title}
      </h2>
      <p className="text-sm text-sub">
        {result
          ? saved
            ? "This round's totals are saved."
            : "Save the totals below if you want to keep them. Nothing else from the round was kept."
          : "Nothing from the round was kept."}
      </p>
      {result && (
        <VoteResults
          questionnaire={{
            id: result.questionnaireId,
            title: result.title,
            scale: result.scale,
            questions: result.questions.map((q) => ({ id: q.id, text: q.text })),
          }}
          revealed={result.questions.map((q) => ({
            responses: q.responses,
            distribution: q.distribution,
          }))}
          minN={result.minN}
          ballots={result.ballots}
        />
      )}
      <div className="flex flex-wrap gap-2">
        {result && (
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
        <Button type="button" variant="outline" onClick={onClosed}>
          Close
        </Button>
      </div>
    </section>
  );
}
