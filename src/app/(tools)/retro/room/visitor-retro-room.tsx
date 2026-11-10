"use client";

/**
 * Participant view of a host-authoritative Retro visitor room.
 *
 * The join page mounts this after the consent-and-name step, so the channel
 * opens only then. The board here is the host's, from its last snapshot, in
 * memory only: nothing is written to this browser's workspace (not even its
 * own `retro:current`) unless the person asks for a copy: "Save a copy" goes
 * through the snapshot importer into Past retros, "Download Markdown" saves a
 * file. Nothing is logged to history.
 *
 * It renders its own end states (host ended, removed, expired, full,
 * unavailable). Each notice takes focus on its heading and is announced
 * politely. The 3-hour limit is enforced here, per client, by the hook.
 *
 * Participants add cards in Write and vote in Vote. While the host hides
 * cards (the default), each person sees only their own cards in Write and a
 * count of everyone else's per column; all the text arrives when the host
 * moves to Vote. A participant can delete its own card in Write, with Undo,
 * and take its own vote back in Vote. It doesn't edit or group cards. A
 * pasted list adds one card per line.
 *
 * If the host leaves for good, the member every peer elects carries on
 * hosting from the last snapshot (still in memory) and gets the phase, timer,
 * hide-cards, member and End room controls here, and can fix a card's text.
 * If cards were hidden, the old host took them with it: the room stays in
 * Write and everyone is told to add theirs again, with their own cards
 * listed under the notice and an "Add again" button for each.
 */

import { useEffect, useMemo, useRef, useState, type JSX } from "react";
import { Check, Download } from "lucide-react";
import { Button } from "@/components/ui/button";
import { ConfirmDialog } from "@/components/shared/confirm-dialog";
import { VisitorRoomChip } from "@/components/collab/visitor-room-chip";
import { useAnnounce } from "@/components/a11y/live-announcer";
import { SNAPSHOT_IMPORTERS } from "@/lib/share/snapshot-import";
import {
  VISITOR_LIMITS,
  visitorRoomsEnabled,
  type VisitorIdentity,
} from "@/lib/realtime/visitor-rooms";
import { exportToMarkdown } from "@/lib/utils/export";
import { todayLocalISO } from "@/lib/utils/formatters";
import { toast } from "@/lib/utils/toast";
import { undoable } from "@/lib/utils/undoable";
import { useFlash } from "@/hooks/use-flash";
import { PHASES, type BoardState } from "../types";
import { shortText } from "../helpers";
import { toMarkdown } from "../markdown";
import { PhaseIndicator } from "../components/phase-indicator";
import { TimerWidget } from "../components/timer-widget";
import { hiddenTotal } from "./hidden";
import { MEMBER_CARD_CAP } from "./protocol";
import { ParticipantBoard } from "./participant-board";
import {
  HideCardsSetting,
  IdlePromptDialog,
  RoomMemberList,
  RoomPhaseSteps,
  RoomTimerReadout,
  useRoomCountdown,
} from "./room-controls";
import {
  useRetroRoom,
  type AddCardResult,
  type EndReason,
  type RetroRoomStatus,
} from "./use-retro-room";

export interface VisitorRetroRoomProps {
  code: string;
  identity: VisitorIdentity;
  onLeave: () => void;
}

export function VisitorRetroRoom(props: {
  code: string;
  identity: VisitorIdentity;
  onLeave: () => void;
}): JSX.Element {
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
  return <ParticipantRoom {...props} />;
}

/** What a participant reads when the host left while cards were hidden. */
export const HOST_LEFT_CARDS_LOST =
  "The host left. Cards written so far were not shared; add yours again.";
/** The same moment, for the member who now hosts (its own cards came with it). */
export const HOST_LEFT_CARDS_LOST_HOSTING =
  "The host left. Cards the others wrote were not shared, so they need to add them again. Yours are still here.";

function addCardError(result: AddCardResult): string | null {
  switch (result) {
    case "added":
    case "sent":
      return null;
    case "bad-text":
      return "That card is empty or contains hidden formatting characters.";
    case "member-cap":
      return `You've added ${MEMBER_CARD_CAP} cards, the most one person can add.`;
    case "board-full":
      return "The board is full.";
    case "wrong-phase":
      return "Cards can only be added in the Write phase.";
    case "not-admitted":
      return "You can add cards once the host has given you a seat.";
    default:
      return "The room is closed.";
  }
}

function closedCopy(
  status: RetroRoomStatus,
  reason: EndReason | null,
  wasHost: boolean
): { title: string; body: string } {
  switch (status) {
    case "expired":
      return {
        title: "The room has closed",
        body: "Live rooms close after 3 hours. Save a copy if you want to keep the board.",
      };
    case "kicked":
      return {
        title: "The host removed you from the room",
        body: "You can't add cards or vote here any more. Save a copy if you want to keep what you saw.",
      };
    case "full":
      return {
        title: `This room is full (${VISITOR_LIMITS.maxMembers} people)`,
        body: "Ask the host to start a new room if you need a seat.",
      };
    case "unavailable":
      return {
        title: "Live rooms aren't available right now",
        body: "We couldn't connect to the room. Try again later.",
      };
    default:
      if (wasHost) {
        return {
          title:
            reason === "idle"
              ? "The room ended after 30 minutes without activity"
              : "You ended the room",
          body: "The board isn't stored anywhere. Save a copy if you want to keep it.",
        };
      }
      return {
        title: "The host ended the room",
        body: "The board below is the last version you saw. Save a copy if you want to keep it.",
      };
  }
}

function ParticipantRoom({ code, identity, onLeave }: VisitorRetroRoomProps) {
  const room = useRetroRoom({ code, identity, role: "participant" });
  const announce = useAnnounce();
  const [saved, setSaved] = useState(false);
  const [confirmEnd, setConfirmEnd] = useState(false);
  const countdown = useRoomCountdown(room.timer);

  const { status, isHost, promoted, hostId, hostName, endReason } = room;
  // What this screen shows: while cards are hidden, only this person's own.
  const shownCards = room.shownCards;
  const board: BoardState | null = useMemo(
    () => (room.board && shownCards ? { ...room.board, cards: shownCards } : room.board),
    [room.board, shownCards]
  );
  const active = status === "connecting" || status === "live";
  const closed = !active;
  const phase = board?.phase ?? null;

  // ── Announcements ────────────────────────────────────────────────
  const lastPhase = useRef<string | null>(null);
  useEffect(() => {
    if (phase === null) return;
    const prev = lastPhase.current;
    lastPhase.current = phase;
    if (prev === null || prev === phase) return;
    const p = PHASES.find((x) => x.key === phase);
    if (p) announce(`${p.label} phase. ${p.description}.`);
  }, [phase, announce]);

  const lastStatus = useRef<RetroRoomStatus>(status);
  useEffect(() => {
    const prev = lastStatus.current;
    lastStatus.current = status;
    if (prev === status) return;
    // Closed states announce themselves (ClosedPanel).
    if (status === "live") {
      announce(
        hostName ? `You joined the live retro hosted by ${hostName}.` : "You joined the live retro."
      );
    }
  }, [status, hostName, announce]);

  const lastHost = useRef<string | null>(hostId);
  useEffect(() => {
    const prev = lastHost.current;
    lastHost.current = hostId;
    if (prev === null || hostId === null || prev === hostId) return;
    if (hostId === room.selfId) {
      announce("The host left. You are hosting the room now.");
    } else {
      announce(hostName ? `The host left. ${hostName} is hosting now.` : "The host changed.");
    }
  }, [hostId, hostName, room.selfId, announce]);

  // ── Actions ──────────────────────────────────────────────────────
  // One toast id: a pasted list that fails line after line shows one message.
  const handleAdd = (columnKey: string, text: string) => {
    const error = addCardError(room.addCard(columnKey, text));
    if (error) toast.error(error, { id: "retro-room-add" });
  };

  const handleEdit = (cardId: string, text: string) => {
    if (!room.editCard(cardId, text)) {
      toast.error("Couldn't save the card. It may contain hidden formatting characters.");
    }
  };

  // "Delete my card", with Undo: Undo adds the card again (as a new card).
  const handleDeleteOwn = (cardId: string) => {
    const card = board?.cards.find((c) => c.id === cardId);
    if (!card || board?.phase !== "write" || !room.ownIds.has(cardId)) return;
    undoable({
      label: `Deleted “${shortText(card.text)}”`,
      apply: () => {
        room.deleteCard(cardId);
      },
      revert: () => handleAdd(card.columnKey, card.text),
    });
  };

  const handleVote = (cardId: string) => {
    const before = room.votesLeft;
    if (room.vote(cardId) && before === 1) {
      announce(`You have used all ${room.votesPerPerson} votes.`);
    }
  };

  const handleUnvote = (cardId: string) => {
    const after = room.votesLeft + 1;
    if (room.unvote(cardId)) {
      announce(`Took your vote back. ${after} ${after === 1 ? "vote" : "votes"} left.`);
    }
  };

  const handleAddAgain = (id: string) => {
    const error = addCardError(room.addAgain(id));
    if (error) toast.error(error, { id: "retro-room-add" });
  };

  const handleLeave = () => {
    room.leave();
    onLeave();
  };

  const saveCopy = () => {
    if (!board || board.cards.length === 0) return;
    const undo = SNAPSHOT_IMPORTERS.retro.importState({ format: board.format, cards: board.cards });
    if (!undo) {
      toast.error("Couldn't save a copy of this board.");
      return;
    }
    setSaved(true);
    toast.success("Saved a copy to Past retros on the Retro page.", {
      action: {
        label: "Undo",
        onClick: () => {
          undo();
          setSaved(false);
        },
      },
    });
  };

  const downloadMarkdown = () => {
    if (!board || board.cards.length === 0) return;
    exportToMarkdown(toMarkdown(board), `retro-${board.format.id}-${todayLocalISO()}`);
  };

  const hosting = isHost && active;
  const canSave = board !== null && board.cards.length > 0;
  const showBoard = board !== null;
  const copy = closed ? closedCopy(status, endReason, isHost) : null;
  const hiddenCount = hiddenTotal(room.hiddenCounts);
  const cardCount =
    (board ? board.cards.filter((c) => c.groupedWith === null).length : 0) + hiddenCount;
  const phaseInfo = PHASES.find((p) => p.key === phase);
  const phaseIndex = PHASES.findIndex((p) => p.key === phase);
  const cardsHiddenNow = room.hiddenCounts !== null;
  const columnLabel = (key: string) =>
    board?.format.columns.find((c) => c.key === key)?.label ?? key;

  return (
    <main className="mx-auto min-h-screen-dvh w-full max-w-6xl space-y-5 px-4 py-6">
      <header className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
        <div className="space-y-1">
          <h1 className="text-xl font-bold text-text">
            Live retro{board ? ` — ${board.format.name}` : ""}
          </h1>
          <p className="text-sm text-sub">
            {hosting
              ? promoted
                ? "The host left, so you are hosting this room now."
                : "You are hosting this room."
              : hostName
                ? `Hosted by ${hostName}. You are ${identity.name}.`
                : `You are ${identity.name}.`}
          </p>
        </div>
        {active && (
          <VisitorRoomChip
            tool="retro"
            code={code}
            memberCount={room.members.length}
            isHost={isHost}
            onEnd={() => setConfirmEnd(true)}
            onLeave={handleLeave}
          />
        )}
      </header>

      {copy && (
        <ClosedPanel
          title={copy.title}
          body={copy.body}
          onLeave={onLeave}
          onSave={canSave ? saveCopy : undefined}
          onDownload={canSave ? downloadMarkdown : undefined}
          saved={saved}
        />
      )}

      {!board && active && (
        <div className="space-y-3">
          <p role="status" className="text-sm text-sub">
            {room.otherVersion
              ? "This room runs on a different version of the Agile Toolkit, so its board can't open here. Ask the host to reload their page, then reload this one."
              : "Connecting to the room…"}
          </p>
          <Button type="button" variant="outline" onClick={handleLeave}>
            Leave
          </Button>
        </div>
      )}

      {showBoard && board && (
        <>
          <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
            <div className="space-y-2">
              {hosting ? (
                <PhaseIndicator
                  current={board.phase}
                  onAdvance={() => {
                    const next = PHASES[phaseIndex + 1];
                    if (next) room.setPhase(next.key);
                  }}
                  onBack={() => {
                    const back = PHASES[phaseIndex - 1];
                    if (back) room.setPhase(back.key);
                  }}
                />
              ) : (
                <RoomPhaseSteps current={board.phase} />
              )}
              <div className="flex items-center gap-3 text-xs text-sub">
                <span>{cardCount} cards</span>
                {board.phase === "vote" && room.admitted && active && (
                  <span className="text-accent font-semibold">
                    {room.votesLeft} {room.votesLeft === 1 ? "vote" : "votes"} left
                  </span>
                )}
              </div>
            </div>
            {hosting && countdown !== null && room.timer ? (
              <TimerWidget
                seconds={countdown}
                running={room.timer.running && countdown > 0}
                onToggle={room.toggleTimer}
                onReset={() => room.setTimerSeconds(300)}
                onChange={room.setTimerSeconds}
              />
            ) : (
              <RoomTimerReadout timer={room.timer} />
            )}
          </div>

          {phaseInfo && (
            <p className="text-xs text-sub px-1">
              {phaseInfo.description}
              {cardsHiddenNow &&
                (hosting
                  ? ". Everyone's cards stay hidden until you move to Vote, on this screen too."
                  : ". Everyone's cards stay hidden until the host moves to Vote. You see only yours.")}
            </p>
          )}

          {active && room.cardsLost && board.phase === "write" && (
            <section
              aria-label="The host left"
              className="space-y-2 rounded-md border border-warning/60 bg-warning/10 px-3 py-2"
            >
              <p role="status" className="text-sm text-text">
                {hosting ? HOST_LEFT_CARDS_LOST_HOSTING : HOST_LEFT_CARDS_LOST}
              </p>
              {!hosting && room.unsharedCards.length > 0 && (
                <ul aria-label="Your cards from before" className="space-y-1.5">
                  {room.unsharedCards.map((c) => (
                    <li key={c.id} className="flex flex-wrap items-center gap-2 text-sm">
                      <span className="min-w-0 flex-1 break-words text-text">{c.text}</span>
                      <span className="text-xs text-sub">{columnLabel(c.columnKey)}</span>
                      <Button
                        type="button"
                        size="sm"
                        variant="outline"
                        onClick={() => handleAddAgain(c.id)}
                        aria-label={`Add “${shortText(c.text)}” again`}
                      >
                        Add again
                      </Button>
                    </li>
                  ))}
                </ul>
              )}
            </section>
          )}

          {hosting && (
            <HideCardsSetting checked={room.hideWhileWriting} onChange={room.setHideWhileWriting} />
          )}

          {active && !room.admitted && (
            <p className="rounded-md border border-border bg-card px-3 py-2 text-sm text-sub">
              The room is full for now, so you can watch but not add cards or vote.
            </p>
          )}

          {active && room.members.length > 0 && (
            <RoomMemberList
              members={room.members}
              selfId={room.selfId}
              hostId={hostId}
              removedIds={hosting ? room.removedIds : undefined}
              onRemove={
                hosting
                  ? (id, name) => {
                      room.kick(id);
                      toast.success(`Removed ${name}.`);
                    }
                  : undefined
              }
            />
          )}

          <ParticipantBoard
            board={board}
            votesPerPerson={room.votesPerPerson}
            votesLeft={room.votesLeft}
            canAct={active && room.admitted}
            hiddenCounts={room.hiddenCounts}
            ownIds={room.ownIds}
            myVotes={room.myVotes}
            onAdd={handleAdd}
            onVote={handleVote}
            onDeleteOwn={handleDeleteOwn}
            onUnvote={handleUnvote}
            onEdit={hosting ? handleEdit : undefined}
          />

          {active && (
            <footer className="flex flex-wrap items-center gap-3 border-t border-border pt-2">
              <Button
                type="button"
                variant="outline"
                onClick={saveCopy}
                disabled={!canSave || saved}
              >
                {saved ? "Saved to Past retros" : "Save a copy"}
              </Button>
              <DownloadButton onDownload={canSave ? downloadMarkdown : undefined} />
              <span className="text-xs text-sub">
                Nothing from this room is kept on your device unless you save a copy.
              </span>
            </footer>
          )}
        </>
      )}

      {hosting && (
        <>
          <ConfirmDialog
            open={confirmEnd}
            onOpenChange={setConfirmEnd}
            title="End the live room?"
            description="Everyone in the room is disconnected. Save a copy first if you want to keep the board."
            confirmLabel="End room"
            onConfirm={() => room.end()}
          />
          <IdlePromptDialog
            open={room.idlePrompt}
            onKeepOpen={room.keepOpen}
            onEnd={() => room.end()}
          />
        </>
      )}
    </main>
  );
}

/** "Download Markdown": the board as this person last saw it, as a file. */
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
              flash("Downloaded a copy as Markdown.");
            }
          : undefined
      }
      disabled={!onDownload}
    >
      {done ? (
        <Check className="w-4 h-4" aria-hidden="true" />
      ) : (
        <Download className="w-4 h-4" aria-hidden="true" />
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
  onSave,
  onDownload,
  saved = false,
  headingLevel = 2,
}: {
  title: string;
  body: string;
  onLeave: () => void;
  /** Into Past retros, through the snapshot importer. */
  onSave?: () => void;
  /** As a Markdown file. */
  onDownload?: () => void;
  saved?: boolean;
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
        {onSave && (
          <Button type="button" variant="toolkit" onClick={onSave} disabled={saved}>
            {saved ? "Saved to Past retros" : "Save a copy"}
          </Button>
        )}
        {onDownload && <DownloadButton onDownload={onDownload} />}
        <Button type="button" variant="outline" onClick={onLeave}>
          Leave
        </Button>
      </div>
    </section>
  );
}
