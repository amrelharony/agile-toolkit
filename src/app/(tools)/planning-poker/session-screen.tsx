"use client";

/**
 * The active session UI — rendered identically for the owner-side
 * client and the guest-side client. Both pass:
 *   * the current `session` (state-synced via realtime)
 *   * an `onUpdateSession` callback that broadcasts the new state
 *   * `localParticipant` — who the user is (used to vote, label cards)
 *   * `isHost` — gates host-only actions (reveal, advance, commit, and
 *     adding, editing and deleting stories)
 *   * `extraHeaderActions` — owner adds a SessionShareButton; guest
 *     leaves it empty
 */

import { useCallback, useEffect, useRef, useState, type ClipboardEvent } from "react";
import { motion, AnimatePresence } from "framer-motion";
import Link from "@/components/motion/transition-link";
import {
  ArrowRight,
  BookmarkPlus,
  ChevronLeft,
  ChevronRight,
  Eye,
  RotateCcw,
  Users,
  Check,
  Clock,
  ListPlus,
  X,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { SectionCard } from "@/components/shared/section-card";
import { EmptyState } from "@/components/shared/empty-state";
import { Badge } from "@/components/ui/badge";
import { IconButton } from "@/components/ui/icon-button";
import { ConfirmDialog } from "@/components/shared/confirm-dialog";
import { InkHighlight } from "@/components/ink/ink-highlight";
import { useAnnounce } from "@/components/a11y/live-announcer";
import { emit as sonify } from "@/lib/sonification/emit";
import { undoable } from "@/lib/utils/undoable";
import { toast } from "@/lib/utils/toast";
import { PASTE_LINE_CAP, leftOutMessage, splitPastedLines } from "@/lib/utils/paste-lines";
import type { ItemText } from "@/components/shared/inline-item-editor";
import { useHistoryLogger } from "@/lib/history/use-history-logger";
import { PLANNING_POKER_ACTIONS } from "@/lib/history/event-actions";
import { SCALE_LABELS, type Session, type Participant } from "./types";
import { REDACTED_VOTE } from "./merge";
import { castVotes, isNumeric, withRound } from "./rounds";
import {
  consensusLabel,
  consensusOf,
  consensusVerdictParts,
  type Consensus,
  type ConsensusLevel,
} from "@/lib/estimation/consensus";
import { AcceptEstimate } from "./accept-estimate";
import { AddStoryForm } from "./add-story-form";
import { CardReferencePanel } from "./card-reference";
import type { CardReferenceLookup } from "./use-card-references";
import { PlayingCard, VotingDeck } from "./voting-deck";
import {
  addPlayers,
  allVotesIn,
  nextVoter,
  removePlayer,
  restorePlayer,
  seatPlayers,
  voteFor,
} from "./players";
import { AddPlayers, PassScreen, PlayerDeck, VotedMark } from "./facilitator-controls";
import {
  MAX_STORIES,
  QUEUE_FULL,
  appendStories,
  editStory,
  newStory as makeStory,
  removeStory,
  restoreStory,
  type StoryDraft,
} from "./stories";
import { ICON_TOUCH_TARGET, StoryQueueItem } from "./story-queue-item";

interface Props {
  session: Session;
  onUpdateSession: (updater: (s: Session) => Session) => void;
  localParticipantId: string;
  isHost: boolean;
  onLeave: () => void;
  /** Extra buttons to render in the header — owner uses this for the
   *  squad-invite button; guest passes empty. */
  extraHeaderActions?: React.ReactNode;
  /** Connection indicator. The owner uses local React state in lobby
   *  → tagged "Local"; once a roomCode exists they're "Live". Guests
   *  are always "Live" if reachable. */
  connectionLabel?: string;
  connectionTone?: "live" | "warn";
  /** Show the room code (only meaningful when others can join). */
  showRoomCode?: boolean;
  /** Leaving discards the session from this browser (a local-only
   *  session) rather than just disconnecting from a live room. Only
   *  changes the wording of the leave confirmation. */
  leaveClearsSession?: boolean;
  /** Stories other tools queued for estimation, not in this session yet.
   *  Owner side only; the guest client passes nothing. */
  queuedCount?: number;
  /** Pull the queued stories into this session (host only). */
  onAddQueued?: () => void;
  /** The host accepted an estimate for a story that had none. The owner
   *  side writes it back to the story's source; guests pass nothing. */
  onEstimateAccepted?: (storyId: string, value: string, votes: string[]) => void;
  /** Facilitator mode: a LOCAL session where the host runs the vote for
   *  everyone on one screen — seating people with no device, recording
   *  their votes face down, passing the screen round. Never set for a
   *  live room, where every guest votes from their own device. */
  facilitator?: boolean;
  /** Host of a visitor live room: remove someone from the room (asks
   *  first). Shows a Remove control on every other participant's row.
   *  Owner and guest rooms pass nothing. */
  onRemoveParticipant?: (participant: Participant) => void;
  /** Log votes, reveals and estimates to this browser's history. Off in
   *  a visitor live room: nothing from the room is kept. */
  recordHistory?: boolean;
  /** The Estimation Guide's notes for a card, shown under the deck. Owner
   *  side only; guests and visitor rooms pass nothing. */
  references?: CardReferenceLookup;
  /** "Save to backlog" for the stories typed into this session. Owner side
   *  only, and never in a visitor room (nothing from it is kept). */
  backlog?: {
    /** Stories a save would add or give points to. */
    toSave: number;
    /** Stories of this session already in the backlog. */
    saved: number;
    onSave: () => void;
  };
}

const NO_LOG = () => {};

/** A name short enough for a one-line toast. */
function shortName(name: string, max = 40): string {
  const t = name.trim();
  return t.length > max ? `${t.slice(0, max - 1).trimEnd()}…` : t;
}

// ─── helpers (duplicated minimal subset; original copies remain in
// planning-poker-client.tsx for the lobby tour-of-features) ────────
// Letters and digits only, so "Priya (PM)" reads "PP", not "P(". Built
// with the constructor, like the canvas mention regexes: the Unicode flag
// needs a newer compile target than ours.
const NOT_LETTER_OR_DIGIT = new RegExp("[^\\p{L}\\p{N}]", "gu");

function getInitials(name: string): string {
  return name
    .split(" ")
    .map((w) => w.replace(NOT_LETTER_OR_DIGIT, ""))
    .filter(Boolean)
    .map((w) => w[0])
    .join("")
    .slice(0, 2)
    .toUpperCase();
}

// Theme tokens, so an avatar reads in the light and high-contrast themes
// too (the fixed hex set was tuned for the dark one only).
const AVATAR_TONES = [
  "border-accent/40 bg-accent/20 text-accent",
  "border-accent-3/40 bg-accent-3/20 text-accent-3",
  "border-success/40 bg-success/20 text-success",
  "border-warning/40 bg-warning/20 text-warning",
  "border-danger/40 bg-danger/20 text-danger",
  "border-info/40 bg-info/20 text-info",
  "border-accent-amber/40 bg-accent-amber/20 text-accent-amber",
  "border-accent-magenta/40 bg-accent-magenta/20 text-accent-magenta",
];
function avatarTone(name: string): string {
  let hash = 0;
  for (let i = 0; i < name.length; i++) hash = name.charCodeAt(i) + hash * 31;
  return AVATAR_TONES[Math.abs(hash) % AVATAR_TONES.length];
}

/** Average, median and mode of the numeric votes; how far apart they are
 *  is counted in cards (./consensus), which works for every deck. */
function calcStats(votes: string[]): {
  average: number | null;
  median: number | null;
  mode: string | null;
} {
  const nums = votes.filter(isNumeric).map(Number);
  if (nums.length === 0) return { average: null, median: null, mode: null };
  const sorted = [...nums].sort((a, b) => a - b);
  const average = nums.reduce((a, b) => a + b, 0) / nums.length;
  const mid = Math.floor(sorted.length / 2);
  const median = sorted.length % 2 === 0 ? (sorted[mid - 1] + sorted[mid]) / 2 : sorted[mid];
  const freq: Record<string, number> = {};
  for (const v of votes) freq[v] = (freq[v] ?? 0) + 1;
  let topCount = 0;
  let modeVal = votes[0];
  for (const val of Object.keys(freq)) {
    const count = freq[val];
    if (count > topCount) {
      topCount = count;
      modeVal = val;
      continue;
    }
    if (count === topCount && isNumeric(val) && isNumeric(modeVal)) {
      if (Number(val) < Number(modeVal)) modeVal = val;
    }
  }
  return { average, median, mode: modeVal };
}

const CONSENSUS_TONES: Record<ConsensusLevel, { box: string; dot: string; text: string }> = {
  agree: { box: "border-success/30 bg-success/10", dot: "bg-success", text: "text-success" },
  close: { box: "border-warning/30 bg-warning/10", dot: "bg-warning", text: "text-warning" },
  spread: { box: "border-danger/30 bg-danger/10", dot: "bg-danger", text: "text-danger" },
};

/**
 * The verdict under the consensus label. When the table agrees, the card
 * everyone played gets a hand-drawn circle: an ink moment, drawn once in
 * place; the sentence already says it, so the ink is decorative.
 */
function ConsensusVerdict({ consensus, agreed }: { consensus: Consensus; agreed: boolean }) {
  const { before, card, after } = consensusVerdictParts(consensus);
  return (
    <span className="text-sm text-text">
      {before}
      {card !== null && agreed ? (
        // The circle reaches 0.4em past the card on each side: room for it.
        <InkHighlight
          mark="circle"
          tone="success"
          delay={300}
          className="mx-1.5 font-data font-bold"
        >
          {card}
        </InkHighlight>
      ) : (
        card
      )}
      {after}
    </span>
  );
}

function Avatar({ name, size = 36 }: { name: string; size?: number }) {
  return (
    <div
      style={{ width: size, height: size }}
      className={`rounded-full border-2 flex items-center justify-center shrink-0 ${avatarTone(name)}`}
    >
      <span style={{ fontSize: size * 0.36 }} className="font-bold leading-none">
        {getInitials(name)}
      </span>
    </div>
  );
}

export function SessionScreen({
  session,
  onUpdateSession,
  localParticipantId,
  isHost,
  onLeave,
  extraHeaderActions,
  connectionLabel,
  connectionTone = "live",
  showRoomCode = true,
  leaveClearsSession = false,
  queuedCount = 0,
  onAddQueued,
  onEstimateAccepted,
  facilitator = false,
  onRemoveParticipant,
  recordHistory = true,
  references,
  backlog,
}: Props) {
  const [confirmLeaveOpen, setConfirmLeaveOpen] = useState(false);
  const [removeTarget, setRemoveTarget] = useState<Participant | null>(null);
  const { log: historyLog } = useHistoryLogger("planning-poker");
  const log = recordHistory ? historyLog : NO_LOG;
  const announce = useAnnounce();

  const currentStory = session.stories[session.currentStoryIdx] ?? null;
  const localParticipant: Participant | undefined = session.participants.find(
    (p) => p.id === localParticipantId
  );

  // ─── Facilitator mode (local sessions only) ───
  const facilitating = facilitator && isHost;
  // Whose deck is open for the facilitator to play into, if anyone's.
  const [deckForId, setDeckForId] = useState<string | null>(null);
  // Passing the screen round: who had it last, and whether they voted.
  const [passing, setPassing] = useState<{
    lastId: string | null;
    lastName: string;
    voted: boolean;
  } | null>(null);
  const voteForRefs = useRef(new Map<string, HTMLButtonElement>());
  const returnFocusTo = useRef<string | null>(null);
  const hasPlayers = facilitating && session.participants.some((p) => p.id !== session.hostId);
  const deckFor =
    facilitating && currentStory && !session.revealed && deckForId !== null
      ? (session.participants.find((p) => p.id === deckForId) ?? null)
      : null;
  const passingNow = facilitating && currentStory !== null && !session.revealed && passing !== null;
  const closeDecks = () => {
    setDeckForId(null);
    setPassing(null);
  };

  // A player's deck closes with their pick; focus goes back to their
  // "Vote for" button rather than dropping to the page.
  useEffect(() => {
    const id = returnFocusTo.current;
    if (id === null || deckFor !== null) return;
    returnFocusTo.current = null;
    voteForRefs.current.get(id)?.focus();
  });

  // Accepting an estimate takes the Accept block away with the round; focus
  // goes to the story the session moved on to rather than the page.
  const storyHeadingRef = useRef<HTMLHeadingElement>(null);
  const focusStoryNext = useRef(false);
  useEffect(() => {
    if (!focusStoryNext.current) return;
    focusStoryNext.current = false;
    storyHeadingRef.current?.focus();
  });

  const allIn = facilitating && allVotesIn(session);
  const wasAllIn = useRef(allIn);
  useEffect(() => {
    if (allIn && !wasAllIn.current) announce("All votes in");
    wasAllIn.current = allIn;
  }, [allIn, announce]);

  const addTeamPlayers = (names: string[]) => {
    if (!facilitating) return;
    const { added } = addPlayers(session, names);
    if (added.length === 0) return;
    onUpdateSession((s) => seatPlayers(s, added));
    announce(
      added.length === 1
        ? `${added[0].name} joined the table`
        : `${added.length} people joined the table`
    );
  };

  const removeTeamPlayer = (player: Participant) => {
    if (!facilitating || player.id === session.hostId) return;
    const index = session.participants.findIndex((p) => p.id === player.id);
    // Undo puts their face-down vote back only if it's still the same round.
    const round = {
      storyIdx: session.currentStoryIdx,
      revealed: session.revealed,
      rounds: currentStory?.rounds?.length ?? 0,
    };
    if (deckForId === player.id) setDeckForId(null);
    undoable({
      label: `Removed ${player.name}`,
      apply: () => onUpdateSession((s) => removePlayer(s, player.id)),
      revert: () =>
        onUpdateSession((s) => {
          const sameRound =
            s.currentStoryIdx === round.storyIdx &&
            s.revealed === round.revealed &&
            (s.stories[s.currentStoryIdx]?.rounds?.length ?? 0) === round.rounds;
          return restorePlayer(s, sameRound ? player : { ...player, vote: null }, index);
        }),
    });
  };

  const openDeckFor = (id: string) => {
    setPassing(null);
    setDeckForId(id);
  };

  // Not logged as the facilitator's own vote, and never with its value:
  // it's someone else's card, face down.
  const recordVoteFor = (player: Participant, value: string) => {
    sonify("planning-poker", "vote");
    onUpdateSession((s) => voteFor(s, player.id, value));
    setDeckForId(null);
    if (passing !== null) {
      setPassing({ lastId: player.id, lastName: player.name, voted: true });
    } else {
      returnFocusTo.current = player.id;
    }
    announce(`${player.name} voted`);
  };

  const startPassing = () => {
    const first = nextVoter(session.participants, passing?.lastId ?? null);
    if (!first) return;
    setPassing((prev) => prev ?? { lastId: null, lastName: "", voted: false });
    setDeckForId(first.id);
  };

  const skipVoter = (player: Participant) => {
    setDeckForId(null);
    setPassing({ lastId: player.id, lastName: player.name, voted: false });
  };

  // The form has checked the title and the queue's room (./add-story-form).
  const addStory = (draft: StoryDraft) => {
    if (!isHost) return;
    const story = makeStory(draft.title, draft.description);
    onUpdateSession((s) => appendStories(s, [story]));
  };

  // Several lines pasted into "Story title": one story per line, as many as
  // the queue still holds. What's already typed stays in the boxes.
  const pasteStories = (e: ClipboardEvent<HTMLInputElement>) => {
    if (!isHost) return;
    const room = Math.max(0, MAX_STORIES - session.stories.length);
    const cap = Math.min(PASTE_LINE_CAP, room);
    const pasted = splitPastedLines(e.clipboardData.getData("text"), cap);
    if (!pasted) return;
    e.preventDefault();
    if (pasted.lines.length === 0) {
      toast.error(QUEUE_FULL);
      return;
    }
    const added = pasted.lines.map((title) => makeStory(title));
    onUpdateSession((s) => appendStories(s, added));
    announce(`Added ${added.length} stories.`);
    if (pasted.dropped > 0) {
      // One toast: a second paste updates it in place.
      toast.info(`Added ${added.length} stories.`, {
        id: "poker-paste",
        description: `${leftOutMessage(pasted.dropped)} ${
          cap < PASTE_LINE_CAP ? QUEUE_FULL : `One paste adds up to ${PASTE_LINE_CAP}.`
        }`,
      });
    }
  };

  const editStoryText = (id: string, next: ItemText) => {
    if (!isHost) return;
    onUpdateSession((s) => editStory(s, id, next));
  };

  // Undo puts the story back in its place in the queue.
  const deleteStory = (id: string) => {
    if (!isHost) return;
    const index = session.stories.findIndex((st) => st.id === id);
    if (index === -1) return;
    const story = session.stories[index];
    const wasCurrent = index === session.currentStoryIdx;
    if (wasCurrent) closeDecks();
    undoable({
      label: `Deleted “${shortName(story.title)}”`,
      apply: () => onUpdateSession((s) => removeStory(s, id)),
      revert: () => onUpdateSession((s) => restoreStory(s, story, index, wasCurrent)),
    });
  };

  const goToStory = (idx: number) => {
    if (!isHost) return;
    closeDecks();
    onUpdateSession((s) => ({
      ...s,
      currentStoryIdx: idx,
      revealed: false,
      participants: s.participants.map((p) => ({ ...p, vote: null })),
    }));
    const story = session.stories[idx];
    if (story) {
      log(PLANNING_POKER_ACTIONS.STORY_CHANGED, {
        storyId: story.id,
        title: story.title,
        index: idx,
      });
    }
  };

  const prevStory = () => {
    if (session.currentStoryIdx > 0) goToStory(session.currentStoryIdx - 1);
  };
  const nextStory = () => {
    if (session.currentStoryIdx < session.stories.length - 1)
      goToStory(session.currentStoryIdx + 1);
  };

  const castVote = useCallback(
    (value: string) => {
      sonify("planning-poker", "vote");
      onUpdateSession((s) => ({
        ...s,
        participants: s.participants.map((p) =>
          p.id === localParticipantId ? { ...p, vote: p.vote === value ? null : value } : p
        ),
      }));
      log(PLANNING_POKER_ACTIONS.VOTE_CAST, { value });
    },
    [onUpdateSession, log, localParticipantId]
  );

  const revealVotes = () => {
    if (!isHost) return;
    sonify("planning-poker", "reveal");
    closeDecks();
    let logPayload: {
      storyId: string | null;
      title: string | null;
      voteCount: number;
      values: string[];
    } = { storyId: null, title: null, voteCount: 0, values: [] };
    onUpdateSession((s) => {
      const story = s.stories[s.currentStoryIdx];
      const cast = s.participants.map((p) => p.vote).filter((v): v is string => v !== null);
      logPayload = {
        storyId: story?.id ?? null,
        title: story?.title ?? null,
        voteCount: cast.length,
        values: cast,
      };
      return { ...s, revealed: true };
    });
    log(PLANNING_POKER_ACTIONS.VOTES_REVEALED, logPayload);
    announce("Votes revealed");
  };

  const resetVotes = () => {
    if (!isHost) return;
    closeDecks();
    onUpdateSession((s) => ({
      ...s,
      // A revealed round is kept on the story, so a re-vote shows how far
      // apart the first one was.
      stories: s.revealed
        ? s.stories.map((st, i) =>
            i === s.currentStoryIdx ? withRound(st, castVotes(s.participants), s.scale) : st
          )
        : s.stories,
      revealed: false,
      participants: s.participants.map((p) => ({ ...p, vote: null })),
    }));
    log(PLANNING_POKER_ACTIONS.ROUND_RESET, {
      storyId: session.stories[session.currentStoryIdx]?.id ?? null,
    });
  };

  const saveEstimate = (value: string) => {
    if (!isHost) return;
    const story = session.stories[session.currentStoryIdx];
    // Decided from this render's session (an updater may run later): a
    // story that already has an estimate isn't accepted twice.
    if (story && story.finalEstimate === null && onEstimateAccepted) {
      const cast = session.participants
        .map((p) => p.vote)
        .filter((v): v is string => v !== null && v !== REDACTED_VOTE);
      onEstimateAccepted(story.id, value, cast);
    }
    closeDecks();
    let skipped = false;
    onUpdateSession((s) => {
      if (s.stories[s.currentStoryIdx]?.finalEstimate !== null) {
        skipped = true;
        return s;
      }
      const stories = s.stories.map((st, i) =>
        i === s.currentStoryIdx
          ? { ...withRound(st, castVotes(s.participants), s.scale), finalEstimate: value }
          : st
      );
      const nextUnestimated = stories.findIndex(
        (st, i) => i > s.currentStoryIdx && st.finalEstimate === null
      );
      return {
        ...s,
        revealed: false,
        participants: s.participants.map((p) => ({ ...p, vote: null })),
        stories,
        currentStoryIdx: nextUnestimated !== -1 ? nextUnestimated : s.currentStoryIdx,
      };
    });
    focusStoryNext.current = true;
    if (!skipped && story) {
      log(PLANNING_POKER_ACTIONS.ESTIMATE_COMMITTED, {
        storyId: story.id,
        title: story.title,
        value,
      });
    }
  };

  // Nothing to lose before the first story exists — leave straight away.
  const requestLeave = () => {
    if (session.stories.length === 0) onLeave();
    else setConfirmLeaveOpen(true);
  };
  const storyCount = session.stories.length;
  const storyNoun = storyCount === 1 ? "story" : "stories";
  const leaveDescription = leaveClearsSession
    ? `This session's ${storyCount} ${storyNoun} and their estimates will be cleared from this browser.`
    : isHost
      ? `You'll leave the live room and everyone in it will see that the host has left. This session's ${storyCount} ${storyNoun} and their estimates will be cleared from this browser.`
      : "You'll leave the live room. The session carries on for everyone else.";

  const votes = session.revealed
    ? session.participants.map((p) => p.vote).filter((v): v is string => v !== null)
    : [];

  const stats = session.revealed ? calcStats(votes) : null;
  // Counted in cards on this session's deck, so T-shirt decks get a verdict too.
  const consensus = session.revealed && votes.length > 0 ? consensusOf(votes, session.scale) : null;
  // Neutral, not "Full consensus", for one estimate or a table of "?".
  const consensusTag = consensus ? consensusLabel(consensus) : null;
  const tone = consensusTag?.tone ?? null;
  const estimatedAt = currentStory?.finalEstimate ?? null;
  // A T-shirt (or other word) deck's sizes can't become story points, so
  // "Save to backlog" says they go in without them.
  const sizesArePoints = session.scale.some(isNumeric);
  // A new round (or a late vote changing the suggestion) starts the
  // accept picker over on the new suggestion.
  const acceptKey = `${currentStory?.id ?? ""}:${currentStory?.rounds?.length ?? 0}:${
    consensus?.suggested ?? ""
  }`;

  const myVote = localParticipant?.vote ?? null;
  const votedCount = session.participants.filter((p) => p.vote !== null).length;
  // Passing the screen round: who's up after the last person to have it.
  const passNext = passingNow ? nextVoter(session.participants, passing.lastId) : null;

  // Ghost participant cleanup is handled host-side via realtime
  // presence — see the prune effect in `usePokerSession`. No per-tab
  // unmount cleanup needed here; a guest who closes their tab simply
  // disappears from presence and the host strips them within one
  // member-sync tick.

  const toneClasses = connectionTone === "warn" ? "text-warning" : "text-accent-green";

  return (
    <div className="flex flex-col gap-6">
      {/* Header bar */}
      {/* Both groups wrap: at 375 px the owner's four header buttons don't fit one row. */}
      <div className="flex flex-wrap items-center justify-between gap-3 rounded-xl border border-border bg-surface px-3 py-3 sm:px-5">
        <div className="flex min-w-0 flex-wrap items-center gap-3">
          <div className="flex flex-col">
            <span className="text-sm font-semibold text-text">{session.sessionName}</span>
            {showRoomCode && (
              <span className="text-xs text-sub">
                Room:{" "}
                <span className="font-data text-accent tracking-widest">{session.roomCode}</span>
              </span>
            )}
          </div>
          <Badge className="bg-accent/10 text-accent border-accent/30 text-xs">
            {SCALE_LABELS[session.scaleType] ?? "Custom"}
          </Badge>
          {connectionLabel && (
            <div className={`flex items-center gap-1 text-xs ${toneClasses}`}>
              <span>{connectionLabel}</span>
            </div>
          )}
        </div>
        <div className="flex min-w-0 flex-wrap items-center gap-2">
          {extraHeaderActions}
          <Button
            variant="ghost"
            size="sm"
            onClick={requestLeave}
            className="text-sub hover:text-text text-xs h-8"
          >
            Leave Session
          </Button>
        </div>
      </div>

      <ConfirmDialog
        open={confirmLeaveOpen}
        onOpenChange={setConfirmLeaveOpen}
        title="Leave this session?"
        description={leaveDescription}
        confirmLabel="Leave session"
        tone={leaveClearsSession || isHost ? "danger" : "default"}
        onConfirm={onLeave}
      />

      {onRemoveParticipant && (
        <ConfirmDialog
          open={removeTarget !== null}
          onOpenChange={(open) => {
            if (!open) setRemoveTarget(null);
          }}
          title={removeTarget ? `Remove ${removeTarget.name} from the room?` : "Remove?"}
          description="They leave the room and their vote is dropped. Anyone with the link can still come back under another name; to keep someone out, end the room and share a new link."
          confirmLabel="Remove"
          onConfirm={() => {
            const target = removeTarget;
            setRemoveTarget(null);
            if (!target) return;
            onRemoveParticipant(target);
            announce(`${target.name} was removed from the room`);
          }}
        />
      )}

      {/* minmax(0,…) on the phone column too: an implicit auto track grows to
          the widest nowrap text (a long participant name), pushing every
          session card past the screen edge instead of letting it truncate. */}
      <div className="grid grid-cols-[minmax(0,1fr)] gap-6 lg:grid-cols-[minmax(0,1fr)_260px]">
        <div className="flex flex-col gap-5">
          {currentStory ? (
            <Card className="border-border bg-surface">
              <CardContent className="pt-5 pb-5">
                <div className="flex flex-col gap-2">
                  <div className="flex items-center justify-between gap-2">
                    <div className="flex items-center gap-2 min-w-0">
                      <Button
                        variant="ghost"
                        size="icon"
                        className="min-touch-coarse h-7 w-7 shrink-0 text-sub hover:text-text"
                        onClick={prevStory}
                        disabled={!isHost || session.currentStoryIdx === 0}
                        aria-label="Previous story"
                      >
                        <ChevronLeft className="h-4 w-4" />
                      </Button>
                      <span className="text-xs text-sub shrink-0 font-data">
                        {session.currentStoryIdx + 1}/{session.stories.length}
                      </span>
                      <Button
                        variant="ghost"
                        size="icon"
                        className="min-touch-coarse h-7 w-7 shrink-0 text-sub hover:text-text"
                        onClick={nextStory}
                        disabled={!isHost || session.currentStoryIdx >= session.stories.length - 1}
                        aria-label="Next story"
                      >
                        <ChevronRight className="h-4 w-4" />
                      </Button>
                    </div>
                    <div className="flex items-center gap-2">
                      {!session.revealed ? (
                        <Button
                          size="sm"
                          onClick={revealVotes}
                          disabled={!isHost || votedCount === 0}
                          className="font-semibold h-8 px-4 text-xs"
                        >
                          <Eye className="h-3.5 w-3.5 mr-1.5" />
                          Reveal ({votedCount}/{session.participants.length})
                        </Button>
                      ) : (
                        <Button
                          size="sm"
                          variant="outline"
                          onClick={resetVotes}
                          disabled={!isHost}
                          className="border-border text-sub hover:text-text h-8 px-4 text-xs"
                        >
                          <RotateCcw className="h-3.5 w-3.5 mr-1.5" />
                          Vote Again
                        </Button>
                      )}
                    </div>
                  </div>

                  <h2
                    ref={storyHeadingRef}
                    tabIndex={-1}
                    className="text-xl sm:text-2xl font-display font-bold text-text text-glow-cyan px-1 break-words outline-none"
                  >
                    {currentStory.title}
                  </h2>

                  {currentStory.description && (
                    <div className="text-sub text-sm mt-0.5 mb-1.5 px-1 whitespace-pre-wrap break-words">
                      {currentStory.description}
                    </div>
                  )}

                  {currentStory.finalEstimate && (
                    <div className="flex items-center gap-2 text-sm text-accent-green">
                      <Check className="h-4 w-4" />
                      Final estimate:{" "}
                      <span className="font-data font-bold">{currentStory.finalEstimate}</span>
                    </div>
                  )}

                  {currentStory.rounds && currentStory.rounds.length > 0 && (
                    <ol aria-label="Voting rounds" className="flex flex-col gap-0.5 px-1 text-xs">
                      {currentStory.rounds.map((round, i) => (
                        <li key={i} className="text-sub">
                          Round {i + 1}:{" "}
                          <span className="font-data text-text">{round.join(" · ")}</span>
                        </li>
                      ))}
                    </ol>
                  )}
                </div>
              </CardContent>
            </Card>
          ) : (
            <EmptyState icon={ListPlus} padding="md" className="border-border">
              {isHost
                ? "Add a story to begin estimating: type it in the queue, or paste a list."
                : "Waiting for the host to add a story."}
            </EmptyState>
          )}

          {session.stories.length > 0 && (
            <SectionCard
              title="Votes"
              icon={Users}
              iconClassName="text-sub"
              titleSize="sm"
              titleSuffix={
                session.revealed
                  ? undefined
                  : allIn
                    ? "— all votes in, face down until revealed"
                    : "— face down until revealed"
              }
              className="border-border bg-surface"
              contentClassName="pb-5"
            >
              <div className="flex flex-wrap gap-4">
                {session.participants.map((p) => (
                  <div key={p.id} className="flex flex-col items-center gap-2">
                    <PlayingCard
                      // A face-down card never carries its value.
                      value={session.revealed ? (p.vote ?? "") : ""}
                      faceDown={!session.revealed || p.vote === null}
                      small
                    />
                    <div className="flex items-center gap-1.5">
                      <Avatar name={p.name} size={20} />
                      <span className="text-xs text-sub max-w-[80px] truncate">{p.name}</span>
                      {p.vote !== null && !session.revealed && !facilitating && (
                        <Check className="h-3 w-3 text-accent-green" />
                      )}
                    </div>
                    {facilitating && !session.revealed && (
                      <>
                        {/* A fixed-height row, so the Vote buttons line up. */}
                        <div className="flex h-4 items-center">
                          {p.vote !== null && <VotedMark />}
                        </div>
                        {p.id !== session.hostId && (
                          <Button
                            ref={(el) => {
                              if (el) voteForRefs.current.set(p.id, el);
                              else voteForRefs.current.delete(p.id);
                            }}
                            type="button"
                            variant="outline"
                            size="sm"
                            onClick={() => openDeckFor(p.id)}
                            aria-label={`Vote for ${p.name}`}
                            className="h-7 px-2.5 text-xs"
                          >
                            Vote
                          </Button>
                        )}
                      </>
                    )}
                  </div>
                ))}
              </div>

              <AnimatePresence>
                {session.revealed && votes.length > 0 && stats && (
                  <motion.div
                    initial={{ opacity: 0, y: 8 }}
                    animate={{ opacity: 1, y: 0 }}
                    exit={{ opacity: 0 }}
                    className="mt-6 flex flex-col gap-4"
                  >
                    {consensus && (
                      <div
                        className={`flex items-start gap-3 rounded-lg border px-4 py-3 ${
                          tone ? CONSENSUS_TONES[tone].box : "border-border bg-surface-deep"
                        }`}
                      >
                        <span
                          aria-hidden="true"
                          className={`mt-1.5 h-3 w-3 rounded-full shrink-0 ${
                            tone ? CONSENSUS_TONES[tone].dot : "bg-sub"
                          }`}
                        />
                        <div className="flex min-w-0 flex-col gap-0.5">
                          {consensusTag && (
                            <span
                              className={`text-sm font-medium ${tone ? CONSENSUS_TONES[tone].text : "text-text"}`}
                            >
                              {consensusTag.label}
                            </span>
                          )}
                          <ConsensusVerdict consensus={consensus} agreed={tone === "agree"} />
                        </div>
                      </div>
                    )}

                    <div className="flex flex-wrap gap-4">
                      {stats.average !== null && (
                        <div className="flex flex-col items-center gap-1">
                          <span className="text-xs text-sub">Average</span>
                          <span className="font-data text-xl font-bold text-text">
                            {stats.average % 1 === 0 ? stats.average : stats.average.toFixed(1)}
                          </span>
                        </div>
                      )}
                      {stats.median !== null && (
                        <div className="flex flex-col items-center gap-1">
                          <span className="text-xs text-sub">Median</span>
                          <span className="font-data text-xl font-bold text-text">
                            {stats.median}
                          </span>
                        </div>
                      )}
                      {stats.mode !== null && (
                        <div className="flex flex-col items-center gap-1">
                          <span className="text-xs text-sub">Mode</span>
                          <span className="font-data text-xl font-bold text-text">
                            {stats.mode}
                          </span>
                        </div>
                      )}
                      {consensus?.apart !== null && consensus?.apart !== undefined && (
                        <div className="flex flex-col items-center gap-1">
                          <span className="text-xs text-sub">Cards apart</span>
                          <span className="font-data text-xl font-bold text-text">
                            {consensus.apart}
                          </span>
                        </div>
                      )}
                    </div>

                    {/* An estimated story keeps its estimate (saveEstimate
                        skips it), so it gets no Accept that would do nothing. */}
                    {isHost && estimatedAt !== null && (
                      <p className="text-sm text-sub">
                        Already estimated at{" "}
                        <span className="font-data font-bold text-text">{estimatedAt}</span>: this
                        round is for comparison only.
                      </p>
                    )}
                    {isHost && estimatedAt === null && (
                      <AcceptEstimate
                        key={acceptKey}
                        deck={session.scale}
                        suggested={consensus?.suggested ?? null}
                        onAccept={saveEstimate}
                      >
                        {(pick) =>
                          references && (
                            <CardReferencePanel
                              card={pick}
                              reference={pick === null ? null : references(pick)}
                              prompt="Pick a card to see what it means in your Estimation Guide."
                            />
                          )
                        }
                      </AcceptEstimate>
                    )}
                  </motion.div>
                )}
              </AnimatePresence>
            </SectionCard>
          )}

          {deckFor ? (
            <PlayerDeck
              key={deckFor.id}
              player={deckFor}
              scale={session.scale}
              passing={passingNow}
              onPick={(value) => recordVoteFor(deckFor, value)}
              onSkip={() => skipVoter(deckFor)}
              onClose={closeDecks}
            />
          ) : passingNow ? (
            <PassScreen
              last={
                passing.lastId === null ? null : { name: passing.lastName, voted: passing.voted }
              }
              next={passNext}
              onNext={startPassing}
              onDone={closeDecks}
            />
          ) : (
            currentStory &&
            !session.revealed &&
            localParticipant && (
              <SectionCard
                title="Your vote"
                titleSize="sm"
                actions={
                  hasPlayers && votedCount < session.participants.length ? (
                    <Button
                      type="button"
                      variant="toolkit"
                      size="sm"
                      onClick={startPassing}
                      title="Hand the screen round: each person who hasn't voted picks a card in turn"
                      className="h-8 text-xs"
                    >
                      Next voter
                    </Button>
                  ) : undefined
                }
                className="border-border bg-surface"
                contentClassName="pb-6"
              >
                <VotingDeck
                  label="Your vote"
                  scale={session.scale}
                  selected={myVote}
                  onPick={castVote}
                />
                {myVote !== null && (
                  <p className="text-center text-sm text-accent mt-2">
                    You voted <span className="font-data font-bold">{myVote}</span>
                  </p>
                )}
                {references && (
                  <CardReferencePanel
                    card={myVote}
                    reference={myVote === null ? null : references(myVote)}
                    prompt="Pick a card to compare it with your Estimation Guide's reference stories."
                  />
                )}
              </SectionCard>
            )
          )}
        </div>

        <div className="flex flex-col gap-5">
          <SectionCard
            title="Story Queue"
            icon={Clock}
            iconClassName="text-sub"
            titleSize="sm"
            className="border-border bg-surface"
            contentClassName="flex flex-col gap-3"
          >
            {isHost && (
              <AddStoryForm
                storyCount={session.stories.length}
                onAdd={addStory}
                onPaste={pasteStories}
                footer={
                  onAddQueued &&
                  queuedCount > 0 && (
                    <Button
                      type="button"
                      variant="toolkit"
                      size="sm"
                      onClick={onAddQueued}
                      className="gap-1.5 text-xs"
                    >
                      <ListPlus className="h-3.5 w-3.5" aria-hidden="true" />
                      Add queued stories ({queuedCount})
                    </Button>
                  )
                }
              />
            )}

            {session.stories.length === 0 ? (
              <p className="text-xs text-sub text-center py-2">
                {isHost ? "No stories yet. Add one above." : "Host hasn't added any stories yet."}
              </p>
            ) : (
              <div className="flex flex-col gap-1 max-h-60 overflow-y-auto pr-1">
                {session.stories.map((story, idx) => (
                  <StoryQueueItem
                    key={story.id}
                    story={story}
                    current={idx === session.currentStoryIdx}
                    isHost={isHost}
                    onSelect={() => goToStory(idx)}
                    onEdit={(next) => editStoryText(story.id, next)}
                    onDelete={() => deleteStory(story.id)}
                  />
                ))}
              </div>
            )}

            {/* Hidden while nothing here can go to the backlog: the example's
                stories, and the queue's (their estimate goes to their source). */}
            {isHost && backlog && (backlog.toSave > 0 || backlog.saved > 0) && (
              <div className="flex flex-col gap-2 border-t border-border pt-3">
                {/* aria-disabled, not disabled: the button keeps focus after
                    the save that empties it (onSave does nothing then). */}
                <Button
                  type="button"
                  variant="outline"
                  size="sm"
                  onClick={backlog.onSave}
                  aria-disabled={backlog.toSave === 0}
                  className="justify-start gap-1.5 aria-disabled:cursor-not-allowed aria-disabled:opacity-50"
                >
                  <BookmarkPlus className="h-3.5 w-3.5" aria-hidden="true" />
                  {backlog.toSave > 0
                    ? `Save to backlog (${backlog.toSave})`
                    : "All saved to the backlog"}
                </Button>
                {backlog.saved > 0 ? (
                  <Link
                    href="/sprint-planning"
                    className="inline-flex items-center gap-1 text-xs text-accent underline-offset-4 hover:underline"
                  >
                    {backlog.saved} in the backlog: plan the sprint
                    <ArrowRight className="h-3 w-3" aria-hidden="true" />
                  </Link>
                ) : (
                  <p className="text-xs text-sub">
                    {sizesArePoints
                      ? "Stories you typed here become backlog stories, with their points."
                      : "Stories you typed here become backlog stories. Sizes on this deck aren't story points, so they go in without points."}
                  </p>
                )}
              </div>
            )}
          </SectionCard>

          <SectionCard
            title="Participants"
            icon={Users}
            iconClassName="text-sub"
            titleSize="sm"
            actions={
              <span className="font-data text-xs text-sub">
                {votedCount}/{session.participants.length} voted
              </span>
            }
            className="border-border bg-surface"
            contentClassName="flex flex-col gap-2 pb-4"
          >
            {session.participants.map((p) => (
              <div key={p.id} className="flex items-center gap-3 rounded-lg px-2 py-1.5">
                <Avatar name={p.name} size={28} />
                <span className="flex-1 text-sm text-text truncate">
                  {p.name}
                  {p.id === session.hostId && (
                    <span className="ml-1.5 text-xs text-sub">(host)</span>
                  )}
                  {p.id === localParticipantId && p.id !== session.hostId && (
                    <span className="ml-1.5 text-xs text-sub">(you)</span>
                  )}
                </span>
                {p.vote !== null ? (
                  session.revealed ? (
                    <span className="font-data text-sm font-bold text-accent">{p.vote}</span>
                  ) : (
                    <Check className="h-4 w-4 text-accent-green shrink-0" />
                  )
                ) : (
                  <span className="h-4 w-4 rounded-full border-2 border-border shrink-0" />
                )}
                {facilitating && p.id !== session.hostId && (
                  <IconButton
                    label={`Remove ${p.name}`}
                    icon={<X aria-hidden="true" />}
                    tooltip={false}
                    variant="danger-ghost"
                    onClick={() => removeTeamPlayer(p)}
                    className={`-my-1 h-7 w-7 shrink-0 ${ICON_TOUCH_TARGET}`}
                  />
                )}
                {!facilitating &&
                  isHost &&
                  onRemoveParticipant &&
                  p.id !== session.hostId &&
                  p.id !== localParticipantId && (
                    <IconButton
                      label={`Remove ${p.name} from the room`}
                      icon={<X aria-hidden="true" />}
                      tooltip={false}
                      variant="danger-ghost"
                      onClick={() => setRemoveTarget(p)}
                      className={`-my-1 h-7 w-7 shrink-0 ${ICON_TOUCH_TARGET}`}
                    />
                  )}
              </div>
            ))}
            {facilitating && (
              <AddPlayers participants={session.participants} onAdd={addTeamPlayers} />
            )}
          </SectionCard>
        </div>
      </div>
    </div>
  );
}
