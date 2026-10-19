"use client";

/**
 * The active session UI — rendered identically for the owner-side
 * client and the guest-side client. Both pass:
 *   * the current `session` (state-synced via realtime)
 *   * an `onUpdateSession` callback that broadcasts the new state
 *   * `localParticipant` — who the user is (used to vote, label cards)
 *   * `isHost` — gates host-only actions (reveal, advance, commit)
 *   * `extraHeaderActions` — owner adds a SessionShareButton; guest
 *     leaves it empty
 */

import { useCallback, useRef, useState } from "react";
import { motion, AnimatePresence } from "framer-motion";
import {
  Plus,
  ChevronLeft,
  ChevronRight,
  Eye,
  RotateCcw,
  Users,
  Check,
  Clock,
  ListPlus,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { SectionCard } from "@/components/shared/section-card";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Badge } from "@/components/ui/badge";
import { ConfirmDialog } from "@/components/shared/confirm-dialog";
import { emit as sonify } from "@/lib/sonification/emit";
import { useHistoryLogger } from "@/lib/history/use-history-logger";
import { PLANNING_POKER_ACTIONS } from "@/lib/history/event-actions";
import { SCALE_LABELS, type Session, type Participant } from "./types";
import { REDACTED_VOTE } from "./merge";
import { castVotes, isNumeric, sortVotes, withRound } from "./rounds";

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

const AVATAR_COLORS = [
  "#00f0ff",
  "#a78bfa",
  "#34d399",
  "#f59e0b",
  "#f87171",
  "#60a5fa",
  "#fb923c",
  "#e879f9",
];
function avatarColor(name: string): string {
  let hash = 0;
  for (let i = 0; i < name.length; i++) hash = name.charCodeAt(i) + hash * 31;
  return AVATAR_COLORS[Math.abs(hash) % AVATAR_COLORS.length];
}

/**
 * The values the host can commit as a story's estimate: every distinct
 * vote except the "no estimate" cards ("?" / "∞") and the pre-reveal
 * redaction sentinel. Numbers sort ascending; anything else (T-shirt
 * sizes, custom labels) follows in scale order, so XS…XXL reads naturally.
 */
function acceptableEstimates(votes: string[], scale: string[]): string[] {
  return sortVotes(
    Array.from(new Set(votes)).filter(
      (v) => v.trim() !== "" && v !== "?" && v !== "∞" && v !== REDACTED_VOTE
    ),
    scale
  );
}

function calcStats(votes: string[]): {
  average: number | null;
  median: number | null;
  mode: string | null;
  spread: number | null;
} {
  const nums = votes.filter(isNumeric).map(Number);
  if (nums.length === 0) return { average: null, median: null, mode: null, spread: null };
  const sorted = [...nums].sort((a, b) => a - b);
  const average = nums.reduce((a, b) => a + b, 0) / nums.length;
  const mid = Math.floor(sorted.length / 2);
  const median = sorted.length % 2 === 0 ? (sorted[mid - 1] + sorted[mid]) / 2 : sorted[mid];
  const spread = sorted[sorted.length - 1] - sorted[0];
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
  return { average, median, mode: modeVal, spread };
}

type Consensus = "agree" | "close" | "spread";
function consensusLevel(votes: string[]): Consensus | null {
  const nums = votes.filter(isNumeric).map(Number);
  // No numeric votes at all (everyone played "?" / "∞"): there is no
  // basis for a consensus verdict. Returning null suppresses the banner
  // — the old `< 2 → "agree"` path proclaimed "Full consensus" over a
  // round where nobody could estimate, the opposite of what it means.
  if (nums.length === 0) return null;
  if (nums.length < 2) return "agree";
  const spread = Math.max(...nums) - Math.min(...nums);
  if (spread === 0) return "agree";
  if (spread <= 2) return "close";
  return "spread";
}

const CONSENSUS_COLORS: Record<Consensus, string> = {
  agree: "#34d399",
  close: "#f59e0b",
  spread: "#f87171",
};
const CONSENSUS_LABELS: Record<Consensus, string> = {
  agree: "Full consensus",
  close: "Near consensus",
  spread: "Discussion needed",
};

function CardFace({
  value,
  faceDown,
  selected,
  small,
}: {
  value: string;
  faceDown: boolean;
  selected: boolean;
  small: boolean;
}) {
  return faceDown ? (
    <div
      className="absolute inset-1 rounded-lg overflow-hidden"
      style={{
        background:
          "repeating-linear-gradient(45deg, #1e2540 0px, #1e2540 4px, #151a30 4px, #151a30 8px)",
      }}
    />
  ) : (
    <span
      className={[
        "font-display font-bold tabular-nums leading-none z-10",
        small ? "text-sm" : "text-2xl",
        selected ? "text-accent" : "text-text",
      ].join(" ")}
    >
      {value}
    </span>
  );
}

/**
 * A card in the voting deck when `onSelect` is given — a real button with
 * radio semantics inside the "Your vote" radiogroup, so it's reachable
 * and operable from the keyboard. Without `onSelect` it's a read-only
 * card (other participants' face-down or revealed votes).
 */
function PlayingCard({
  value,
  faceDown = false,
  selected = false,
  onSelect,
  small = false,
  rotation = 0,
  tabIndex,
  buttonRef,
}: {
  value: string;
  faceDown?: boolean;
  selected?: boolean;
  onSelect?: () => void;
  small?: boolean;
  rotation?: number;
  tabIndex?: number;
  buttonRef?: (el: HTMLButtonElement | null) => void;
}) {
  const w = small ? 48 : 64;
  const h = small ? 68 : 90;
  const className = [
    "relative rounded-xl border-2 flex items-center justify-center shrink-0 select-none",
    onSelect
      ? "cursor-pointer focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent focus-visible:ring-offset-2 focus-visible:ring-offset-bg"
      : "cursor-default",
    faceDown
      ? "bg-surface border-border"
      : selected
        ? "bg-surface-deep border-accent shadow-[0_0_18px_#00f0ffaa,0_0_36px_#00f0ff44]"
        : "bg-surface-hover border-border hover:border-[#00f0ff66]",
  ].join(" ");
  const face = <CardFace value={value} faceDown={faceDown} selected={selected} small={small} />;

  if (!onSelect) {
    return (
      <motion.div
        animate={{ rotate: rotation, scale: selected ? 1.12 : 1 }}
        transition={{ type: "spring", stiffness: 300, damping: 20 }}
        style={{ width: w, height: h, rotate: rotation }}
        className={className}
      >
        {face}
      </motion.div>
    );
  }

  return (
    <motion.button
      ref={buttonRef}
      type="button"
      role="radio"
      aria-checked={selected}
      tabIndex={tabIndex}
      onClick={onSelect}
      whileHover={{ y: -8, scale: 1.05 }}
      whileTap={{ scale: 0.97 }}
      animate={{ rotate: rotation, scale: selected ? 1.12 : 1 }}
      transition={{ type: "spring", stiffness: 300, damping: 20 }}
      style={{ width: w, height: h, rotate: rotation }}
      className={className}
    >
      {face}
    </motion.button>
  );
}

function Avatar({ name, size = 36 }: { name: string; size?: number }) {
  const color = avatarColor(name);
  return (
    <div
      style={{
        width: size,
        height: size,
        backgroundColor: color + "33",
        borderColor: color + "66",
      }}
      className="rounded-full border-2 flex items-center justify-center shrink-0"
    >
      <span style={{ color, fontSize: size * 0.36 }} className="font-bold leading-none">
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
}: Props) {
  const [newStory, setNewStory] = useState("");
  const [newDescription, setNewDescription] = useState("");
  const [confirmLeaveOpen, setConfirmLeaveOpen] = useState(false);
  const newStoryRef = useRef<HTMLInputElement>(null);
  const voteCardRefs = useRef<(HTMLButtonElement | null)[]>([]);
  const { log } = useHistoryLogger("planning-poker");

  const currentStory = session.stories[session.currentStoryIdx] ?? null;
  const localParticipant: Participant | undefined = session.participants.find(
    (p) => p.id === localParticipantId
  );

  const addStory = () => {
    if (!isHost) return;
    const title = newStory.trim();
    if (!title) return;
    const description = newDescription.trim() || undefined;
    onUpdateSession((s) => ({
      ...s,
      stories: [...s.stories, { id: crypto.randomUUID(), title, description, finalEstimate: null }],
    }));
    setNewStory("");
    setNewDescription("");
    newStoryRef.current?.focus();
  };

  const goToStory = (idx: number) => {
    if (!isHost) return;
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
  };

  const resetVotes = () => {
    if (!isHost) return;
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
      ? `You'll leave the live room and your squad will see that the host has left. This session's ${storyCount} ${storyNoun} and their estimates will be cleared from this browser.`
      : "You'll leave the live room. The session carries on for everyone else.";

  // Roving focus for the voting deck: arrows move between cards (wrapping),
  // Home/End jump to the ends. Space/Enter casts the vote — moving focus
  // alone never does, since every vote is broadcast to the room.
  const handleDeckKeyDown = (e: React.KeyboardEvent<HTMLDivElement>) => {
    const count = session.scale.length;
    const current = voteCardRefs.current.indexOf(e.target as HTMLButtonElement);
    if (current === -1 || count === 0) return;
    let next: number;
    switch (e.key) {
      case "ArrowRight":
      case "ArrowDown":
        next = (current + 1) % count;
        break;
      case "ArrowLeft":
      case "ArrowUp":
        next = (current - 1 + count) % count;
        break;
      case "Home":
        next = 0;
        break;
      case "End":
        next = count - 1;
        break;
      default:
        return;
    }
    e.preventDefault();
    voteCardRefs.current[next]?.focus();
  };

  const votes = session.revealed
    ? session.participants.map((p) => p.vote).filter((v): v is string => v !== null)
    : [];

  const stats = session.revealed ? calcStats(votes) : null;
  const consensus = session.revealed && votes.length > 0 ? consensusLevel(votes) : null;

  const myVote = localParticipant?.vote ?? null;
  // The checked card takes the deck's single tab stop; with no vote yet
  // it falls to the first card.
  const tabStopIdx = Math.max(0, myVote === null ? 0 : session.scale.indexOf(myVote));
  const votedCount = session.participants.filter((p) => p.vote !== null).length;
  const cardCount = session.scale.length;
  const maxRotation = Math.min(20, cardCount * 1.5);

  // Ghost participant cleanup is handled host-side via realtime
  // presence — see the prune effect in `usePokerSession`. No per-tab
  // unmount cleanup needed here; a guest who closes their tab simply
  // disappears from presence and the host strips them within one
  // member-sync tick.

  const toneClasses = connectionTone === "warn" ? "text-warning/80" : "text-accent-green/80";

  return (
    <div className="flex flex-col gap-6">
      {/* Header bar */}
      <div className="flex flex-wrap items-center justify-between gap-3 rounded-xl border border-border bg-surface px-5 py-3">
        <div className="flex items-center gap-3">
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
        <div className="flex items-center gap-2">
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

      <div className="grid gap-6 lg:grid-cols-[1fr_260px]">
        <div className="flex flex-col gap-5">
          <Card className="border-border bg-surface">
            <CardContent className="pt-5 pb-5">
              {currentStory ? (
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
                          className="bg-accent text-[#0a0e1a] hover:bg-accent/80 font-semibold h-8 px-4 text-xs"
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

                  <h2 className="text-xl sm:text-2xl font-display font-bold text-text text-glow-cyan px-1 break-words">
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
              ) : (
                <p className="text-sub text-sm text-center py-4">
                  {isHost
                    ? "Add a story to begin estimating."
                    : "Waiting for the host to add a story."}
                </p>
              )}
            </CardContent>
          </Card>

          {session.stories.length > 0 && (
            <SectionCard
              title="Votes"
              icon={Users}
              iconClassName="text-sub"
              titleSize="sm"
              titleSuffix={!session.revealed ? "— face down until revealed" : undefined}
              className="border-border bg-surface"
              contentClassName="pb-5"
            >
              <div className="flex flex-wrap gap-4">
                {session.participants.map((p) => (
                  <div key={p.id} className="flex flex-col items-center gap-2">
                    <PlayingCard
                      value={p.vote ?? ""}
                      faceDown={!session.revealed || p.vote === null}
                      small
                    />
                    <div className="flex items-center gap-1.5">
                      <Avatar name={p.name} size={20} />
                      <span className="text-xs text-sub max-w-[80px] truncate">{p.name}</span>
                      {p.vote !== null && !session.revealed && (
                        <Check className="h-3 w-3 text-accent-green" />
                      )}
                    </div>
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
                        className="flex items-center gap-3 rounded-lg border px-4 py-3"
                        style={{
                          borderColor: CONSENSUS_COLORS[consensus] + "44",
                          backgroundColor: CONSENSUS_COLORS[consensus] + "11",
                        }}
                      >
                        <div
                          className="h-3 w-3 rounded-full shrink-0"
                          style={{
                            backgroundColor: CONSENSUS_COLORS[consensus],
                            boxShadow: `0 0 8px ${CONSENSUS_COLORS[consensus]}`,
                          }}
                        />
                        <span
                          className="text-sm font-medium"
                          style={{ color: CONSENSUS_COLORS[consensus] }}
                        >
                          {CONSENSUS_LABELS[consensus]}
                        </span>
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
                      {stats.spread !== null && (
                        <div className="flex flex-col items-center gap-1">
                          <span className="text-xs text-sub">Spread</span>
                          <span className="font-data text-xl font-bold text-text">
                            {stats.spread}
                          </span>
                        </div>
                      )}
                    </div>

                    {isHost && (
                      <div className="flex flex-wrap gap-2">
                        <span className="text-xs text-sub self-center">Accept estimate:</span>
                        {acceptableEstimates(votes, session.scale).map((v) => (
                          <Button
                            key={v}
                            size="sm"
                            variant="outline"
                            onClick={() => saveEstimate(v)}
                            className="h-8 px-3 text-xs border-border text-sub hover:border-accent/60 hover:text-accent"
                          >
                            {v}
                          </Button>
                        ))}
                      </div>
                    )}
                  </motion.div>
                )}
              </AnimatePresence>
            </SectionCard>
          )}

          {currentStory && !session.revealed && localParticipant && (
            <SectionCard
              title="Your vote"
              titleSize="sm"
              className="border-border bg-surface"
              contentClassName="pb-6"
            >
              {/* Arrow keys are handled here for the whole deck; focus itself
                  lives on the cards (roving tabindex), not on the group. */}
              {/* eslint-disable-next-line jsx-a11y/interactive-supports-focus */}
              <div
                role="radiogroup"
                aria-label="Your vote"
                onKeyDown={handleDeckKeyDown}
                className="flex flex-wrap justify-center gap-3 pt-2 pb-2"
              >
                {session.scale.map((value, i) => {
                  const mid = (cardCount - 1) / 2;
                  const rotation = cardCount > 1 ? ((i - mid) / mid) * maxRotation : 0;
                  return (
                    <PlayingCard
                      key={value}
                      value={value}
                      selected={myVote === value}
                      onSelect={() => castVote(value)}
                      rotation={rotation}
                      tabIndex={i === tabStopIdx ? 0 : -1}
                      buttonRef={(el) => {
                        voteCardRefs.current[i] = el;
                      }}
                    />
                  );
                })}
              </div>
              {myVote !== null && (
                <p className="text-center text-sm text-accent mt-2">
                  You voted <span className="font-data font-bold">{myVote}</span>
                </p>
              )}
            </SectionCard>
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
              <div className="flex flex-col gap-2">
                <div className="flex gap-2">
                  <Input
                    ref={newStoryRef}
                    value={newStory}
                    onChange={(e) => setNewStory(e.target.value)}
                    onKeyDown={(e) => e.key === "Enter" && addStory()}
                    placeholder="Story title…"
                    aria-label="New story title"
                    className="h-9 text-sm bg-surface-deep border-border text-text"
                  />
                  <Button
                    size="icon"
                    onClick={addStory}
                    disabled={!newStory.trim()}
                    aria-label="Add story"
                    className="h-9 w-9 shrink-0 bg-accent text-[#0a0e1a] hover:bg-accent/80"
                  >
                    <Plus className="h-4 w-4" />
                  </Button>
                </div>
                <Textarea
                  value={newDescription}
                  onChange={(e) => setNewDescription(e.target.value)}
                  onKeyDown={(e) => {
                    if (e.key === "Enter" && (e.metaKey || e.ctrlKey)) addStory();
                  }}
                  placeholder="Description (optional)..."
                  rows={2}
                  className="bg-surface-deep border-border resize-none text-xs text-text"
                  aria-label="New story description"
                />
                {onAddQueued && queuedCount > 0 && (
                  <Button
                    type="button"
                    variant="toolkit"
                    size="sm"
                    onClick={onAddQueued}
                    className="h-8 justify-start gap-1.5 text-xs"
                  >
                    <ListPlus className="h-3.5 w-3.5" aria-hidden="true" />
                    Add queued stories ({queuedCount})
                  </Button>
                )}
              </div>
            )}

            {session.stories.length === 0 ? (
              <p className="text-xs text-sub/60 text-center py-2">
                {isHost ? "No stories yet. Add one above." : "Host hasn't added any stories yet."}
              </p>
            ) : (
              <div className="flex flex-col gap-1 max-h-60 overflow-y-auto pr-1">
                {session.stories.map((story, idx) => (
                  <button
                    key={story.id}
                    onClick={() => goToStory(idx)}
                    disabled={!isHost}
                    aria-current={idx === session.currentStoryIdx ? "true" : undefined}
                    className={[
                      "flex items-start justify-between gap-2 rounded-lg px-3 py-2 text-left text-xs transition-colors",
                      idx === session.currentStoryIdx
                        ? "bg-accent/10 border border-accent/30 text-accent"
                        : "text-sub hover:bg-surface-hover hover:text-text",
                      !isHost && "cursor-default",
                    ]
                      .filter(Boolean)
                      .join(" ")}
                  >
                    <div className="flex-1 min-w-0">
                      <div className="truncate">{story.title}</div>
                      {story.description && (
                        <div className="text-sub text-xs mt-0.5 whitespace-pre-wrap break-words font-normal opacity-80">
                          {story.description}
                        </div>
                      )}
                    </div>
                    {story.finalEstimate !== null ? (
                      <span className="font-data shrink-0 text-accent-green">
                        {story.finalEstimate}
                      </span>
                    ) : idx === session.currentStoryIdx ? (
                      <span className="shrink-0 opacity-60">now</span>
                    ) : null}
                  </button>
                ))}
              </div>
            )}
          </SectionCard>

          <SectionCard
            title="Participants"
            icon={Users}
            iconClassName="text-sub"
            titleSize="sm"
            actions={
              <span className="font-data text-xs text-sub/60">
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
                    <span className="ml-1.5 text-xs text-sub/50">(host)</span>
                  )}
                  {p.id === localParticipantId && p.id !== session.hostId && (
                    <span className="ml-1.5 text-xs text-sub/50">(you)</span>
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
              </div>
            ))}
          </SectionCard>
        </div>
      </div>
    </div>
  );
}
