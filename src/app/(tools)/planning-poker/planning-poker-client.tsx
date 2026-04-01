"use client";

import { useState, useRef, useCallback, useMemo } from "react";
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
  Wifi,
  WifiOff,
} from "lucide-react";
import { ToolPageWrapper } from "@/components/layout/tool-page-wrapper";
import { AiPromptGenerator } from "@/components/shared/ai-prompt-generator";
import { generatePlanningPokerPrompts } from "@/lib/ai-prompts/planning-poker";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Badge } from "@/components/ui/badge";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

type ScaleType = "fibonacci" | "tshirt" | "custom";

const SCALES: Record<ScaleType, string[]> = {
  fibonacci: ["1", "2", "3", "5", "8", "13", "21", "?", "∞"],
  tshirt: ["XS", "S", "M", "L", "XL", "XXL", "?"],
  custom: [],
};

const SCALE_LABELS: Record<ScaleType, string> = {
  fibonacci: "Fibonacci",
  tshirt: "T-Shirt",
  custom: "Custom",
};

interface Participant {
  id: string;
  name: string;
  vote: string | null;
}

interface Story {
  id: string;
  title: string;
  finalEstimate: string | null;
}

interface Session {
  roomCode: string;
  sessionName: string;
  scale: string[];
  host: string;
  participants: Participant[];
  stories: Story[];
  currentStoryIdx: number;
  revealed: boolean;
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function generateRoomCode(): string {
  return Math.random().toString(36).substring(2, 8).toUpperCase();
}

function getInitials(name: string): string {
  return name
    .split(" ")
    .map((w) => w[0])
    .join("")
    .toUpperCase()
    .slice(0, 2);
}

// Deterministic color from name string
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

function isNumeric(v: string): boolean {
  return !isNaN(Number(v)) && v !== "?" && v !== "∞" && v !== "";
}

function calcStats(votes: string[]): {
  average: number | null;
  median: number | null;
  mode: string | null;
  spread: number | null;
} {
  const nums = votes.filter(isNumeric).map(Number);
  if (nums.length === 0)
    return { average: null, median: null, mode: null, spread: null };
  const sorted = [...nums].sort((a, b) => a - b);
  const average = nums.reduce((a, b) => a + b, 0) / nums.length;
  const mid = Math.floor(sorted.length / 2);
  const median =
    sorted.length % 2 === 0
      ? (sorted[mid - 1] + sorted[mid]) / 2
      : sorted[mid];
  const spread = sorted[sorted.length - 1] - sorted[0];

  // mode
  const freq: Record<string, number> = {};
  for (const v of votes) freq[v] = (freq[v] || 0) + 1;
  let topCount = 0;
  let modeVal = votes[0];
  for (const [val, count] of Object.entries(freq)) {
    if (count > topCount) {
      topCount = count;
      modeVal = val;
    }
  }

  return { average, median, mode: modeVal, spread };
}

type Consensus = "agree" | "close" | "spread";

function consensusLevel(votes: string[]): Consensus {
  const nums = votes.filter(isNumeric).map(Number);
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

// ---------------------------------------------------------------------------
// Sub-components
// ---------------------------------------------------------------------------

/** A playing card — can show front (value) or back (face-down pattern) */
function PlayingCard({
  value,
  faceDown = false,
  selected = false,
  onClick,
  small = false,
  rotation = 0,
}: {
  value: string;
  faceDown?: boolean;
  selected?: boolean;
  onClick?: () => void;
  small?: boolean;
  rotation?: number;
}) {
  const w = small ? 48 : 64;
  const h = small ? 68 : 90;

  return (
    <motion.div
      onClick={onClick}
      whileHover={onClick ? { y: -8, scale: 1.05 } : undefined}
      whileTap={onClick ? { scale: 0.97 } : undefined}
      animate={{ rotate: rotation, scale: selected ? 1.12 : 1 }}
      transition={{ type: "spring", stiffness: 300, damping: 20 }}
      style={{ width: w, height: h, rotate: rotation }}
      className={[
        "relative rounded-xl border-2 flex items-center justify-center shrink-0 select-none",
        onClick ? "cursor-pointer" : "cursor-default",
        faceDown
          ? "bg-surface border-border"
          : selected
            ? "bg-surface-deep border-accent shadow-[0_0_18px_#00f0ffaa,0_0_36px_#00f0ff44]"
            : "bg-surface-hover border-border hover:border-[#00f0ff66]",
      ].join(" ")}
    >
      {faceDown ? (
        // Back pattern: diagonal lines via repeating-linear-gradient
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
      )}
    </motion.div>
  );
}

/** Circular avatar with initials */
function Avatar({ name, size = 36 }: { name: string; size?: number }) {
  const color = avatarColor(name);
  return (
    <div
      style={{ width: size, height: size, backgroundColor: color + "33", borderColor: color + "66" }}
      className="rounded-full border-2 flex items-center justify-center shrink-0"
    >
      <span
        style={{ color, fontSize: size * 0.36 }}
        className="font-bold leading-none"
      >
        {getInitials(name)}
      </span>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Lobby screen
// ---------------------------------------------------------------------------

function LobbyScreen({
  onStart,
}: {
  onStart: (data: {
    sessionName: string;
    scale: string[];
    scaleType: ScaleType;
    displayName: string;
  }) => void;
}) {
  const [sessionName, setSessionName] = useState("Sprint Planning");
  const [scaleType, setScaleType] = useState<ScaleType>("fibonacci");
  const [customInput, setCustomInput] = useState("1, 2, 4, 8, 16, 32");
  const [displayName, setDisplayName] = useState("Scrum Master");
  const [joinCode, setJoinCode] = useState("");

  const resolvedScale =
    scaleType === "custom"
      ? customInput
          .split(",")
          .map((s) => s.trim())
          .filter(Boolean)
      : SCALES[scaleType];

  const handleStart = () => {
    if (!sessionName.trim() || !displayName.trim()) return;
    if (resolvedScale.length < 2) return;
    onStart({
      sessionName: sessionName.trim(),
      scale: resolvedScale,
      scaleType,
      displayName: displayName.trim(),
    });
  };

  return (
    <div className="max-w-xl mx-auto flex flex-col gap-6">
      {/* Demo notice */}
      <div className="flex items-center gap-2 rounded-lg border border-accent/20 bg-accent/5 px-4 py-3 text-sm text-accent/80">
        <WifiOff className="h-4 w-4 shrink-0" />
        <span>
          <strong>Local demo mode</strong> — all state in memory. Multiplayer
          coming soon — share the link when available.
        </span>
      </div>

      {/* Session setup */}
      <Card className="border-border/40 bg-surface">
        <CardHeader className="pb-4">
          <CardTitle className="text-base font-semibold text-text">
            Start a Session
          </CardTitle>
        </CardHeader>
        <CardContent className="flex flex-col gap-5">
          {/* Session name */}
          <div className="flex flex-col gap-2">
            <Label htmlFor="session-name" className="text-sub text-sm">
              Session name
            </Label>
            <Input
              id="session-name"
              value={sessionName}
              onChange={(e) => setSessionName(e.target.value)}
              placeholder="e.g. Sprint 42 Planning"
              className="bg-surface-deep border-border/40 text-text"
            />
          </div>

          {/* Scale selector */}
          <div className="flex flex-col gap-2">
            <Label className="text-sub text-sm">Estimation scale</Label>
            <div className="flex gap-2">
              {(["fibonacci", "tshirt", "custom"] as ScaleType[]).map((s) => (
                <button
                  key={s}
                  onClick={() => setScaleType(s)}
                  className={[
                    "flex-1 rounded-lg border py-2 px-3 text-sm font-medium transition-colors",
                    scaleType === s
                      ? "border-accent/60 bg-accent/10 text-accent"
                      : "border-border/40 bg-surface-deep text-sub hover:border-border hover:text-text",
                  ].join(" ")}
                >
                  {SCALE_LABELS[s]}
                </button>
              ))}
            </div>

            {scaleType === "custom" && (
              <Input
                value={customInput}
                onChange={(e) => setCustomInput(e.target.value)}
                placeholder="Comma-separated values, e.g. 1, 2, 4, 8"
                className="bg-surface-deep border-border/40 text-text text-sm"
              />
            )}

            {/* Scale preview */}
            <div className="flex flex-wrap gap-1.5 pt-1">
              {resolvedScale.map((v) => (
                <span
                  key={v}
                  className="rounded-md border border-border/40 bg-surface-deep px-2 py-0.5 text-xs text-sub"
                >
                  {v}
                </span>
              ))}
            </div>
          </div>

          {/* Display name */}
          <div className="flex flex-col gap-2">
            <Label htmlFor="display-name" className="text-sub text-sm">
              Your display name
            </Label>
            <Input
              id="display-name"
              value={displayName}
              onChange={(e) => setDisplayName(e.target.value)}
              placeholder="e.g. Alice"
              className="bg-surface-deep border-border/40 text-text"
            />
          </div>

          <Button
            onClick={handleStart}
            disabled={!sessionName.trim() || !displayName.trim() || resolvedScale.length < 2}
            className="bg-accent text-[#0a0e1a] hover:bg-accent/80 font-semibold h-11"
          >
            Start Session
          </Button>
        </CardContent>
      </Card>

      {/* Join section */}
      <Card className="border-border/40 bg-surface">
        <CardHeader className="pb-4">
          <CardTitle className="text-base font-semibold text-sub">
            Join a Session
          </CardTitle>
        </CardHeader>
        <CardContent className="flex gap-2">
          <Input
            value={joinCode}
            onChange={(e) => setJoinCode(e.target.value.toUpperCase())}
            placeholder="Room code (e.g. ABC123)"
            maxLength={6}
            className="bg-surface-deep border-border/40 text-text font-data tracking-widest"
          />
          <Button
            variant="outline"
            disabled
            className="border-border/40 text-sub whitespace-nowrap"
            title="Multiplayer not yet available"
          >
            Join
          </Button>
        </CardContent>
      </Card>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Session screen
// ---------------------------------------------------------------------------

function SessionScreen({
  session,
  onUpdateSession,
  onLeave,
}: {
  session: Session;
  onUpdateSession: (updater: (s: Session) => Session) => void;
  onLeave: () => void;
}) {
  const [newStory, setNewStory] = useState("");
  const newStoryRef = useRef<HTMLInputElement>(null);

  const currentStory = session.stories[session.currentStoryIdx] ?? null;
  const hostParticipant = session.participants.find((p) => p.name === session.host);

  // ---------------------------------------------------------------------------
  // Story management
  // ---------------------------------------------------------------------------

  const addStory = () => {
    const title = newStory.trim();
    if (!title) return;
    onUpdateSession((s) => ({
      ...s,
      stories: [
        ...s.stories,
        { id: crypto.randomUUID(), title, finalEstimate: null },
      ],
    }));
    setNewStory("");
    newStoryRef.current?.focus();
  };

  const goToStory = (idx: number) => {
    onUpdateSession((s) => ({
      ...s,
      currentStoryIdx: idx,
      revealed: false,
      participants: s.participants.map((p) => ({ ...p, vote: null })),
    }));
  };

  const prevStory = () => {
    if (session.currentStoryIdx > 0) goToStory(session.currentStoryIdx - 1);
  };

  const nextStory = () => {
    if (session.currentStoryIdx < session.stories.length - 1)
      goToStory(session.currentStoryIdx + 1);
  };

  // ---------------------------------------------------------------------------
  // Voting
  // ---------------------------------------------------------------------------

  const castVote = useCallback(
    (value: string) => {
      onUpdateSession((s) => ({
        ...s,
        participants: s.participants.map((p) =>
          p.name === s.host
            ? { ...p, vote: p.vote === value ? null : value }
            : p
        ),
      }));
    },
    [onUpdateSession]
  );

  const revealVotes = () => {
    onUpdateSession((s) => ({ ...s, revealed: true }));
  };

  const resetVotes = () => {
    onUpdateSession((s) => ({
      ...s,
      revealed: false,
      participants: s.participants.map((p) => ({ ...p, vote: null })),
    }));
  };

  const saveEstimate = (value: string) => {
    onUpdateSession((s) => ({
      ...s,
      revealed: false,
      participants: s.participants.map((p) => ({ ...p, vote: null })),
      stories: s.stories.map((st, i) =>
        i === s.currentStoryIdx ? { ...st, finalEstimate: value } : st
      ),
    }));
    // Auto-advance to next unestimated story
    const nextUnestimated = session.stories.findIndex(
      (st, i) => i > session.currentStoryIdx && st.finalEstimate === null
    );
    if (nextUnestimated !== -1) {
      onUpdateSession((s) => ({
        ...s,
        currentStoryIdx: nextUnestimated,
      }));
    }
  };

  // ---------------------------------------------------------------------------
  // Derived
  // ---------------------------------------------------------------------------

  const votes = session.revealed
    ? session.participants.map((p) => p.vote).filter((v): v is string => v !== null)
    : [];

  const stats = session.revealed ? calcStats(votes) : null;
  const consensus = session.revealed && votes.length > 0 ? consensusLevel(votes) : null;

  const hostVote = hostParticipant?.vote ?? null;
  const votedCount = session.participants.filter((p) => p.vote !== null).length;
  // const allVoted = votedCount === session.participants.length;

  // AI prompts
  const promptConfig = useMemo(() => {
    const scaleName = (SCALE_LABELS as Record<string, string>)[
      (Object.entries(SCALES).find(([, s]) => s.join() === session.scale.join())?.[0]) ?? "custom"
    ] ?? "Custom";
    return {
      toolName: "Planning Poker",
      prompts: generatePlanningPokerPrompts({
        stories: session.stories.map((s) => ({
          title: s.title,
          votes: session.participants.map((p) => p.vote).filter((v): v is string => v !== null),
          finalEstimate: s.finalEstimate,
        })),
        scaleName,
      }),
    };
  }, [session.stories, session.participants, session.scale]);

  // Card rotation for fan effect
  const cardCount = session.scale.length;
  const maxRotation = Math.min(20, cardCount * 1.5);

  // ---------------------------------------------------------------------------
  // Render
  // ---------------------------------------------------------------------------

  return (
    <div className="flex flex-col gap-6">
      {/* Header bar */}
      <div className="flex flex-wrap items-center justify-between gap-3 rounded-xl border border-border/40 bg-surface px-5 py-3">
        <div className="flex items-center gap-3">
          <div className="flex flex-col">
            <span className="text-sm font-semibold text-text">
              {session.sessionName}
            </span>
            <span className="text-xs text-sub">
              Room:{" "}
              <span className="font-data text-accent tracking-widest">
                {session.roomCode}
              </span>
            </span>
          </div>
          <Badge className="bg-accent/10 text-accent border-accent/30 text-xs">
            {(SCALE_LABELS as Record<string, string>)[
              (Object.entries(SCALES).find(
                ([, s]) => s.join() === session.scale.join()
              )?.[0]) ?? "custom"
            ] ?? "Custom"}
          </Badge>
          <div className="flex items-center gap-1 text-xs text-amber-400/80">
            <WifiOff className="h-3 w-3" />
            <span>Local demo</span>
          </div>
        </div>
        <div className="flex items-center gap-2">
          <AiPromptGenerator config={promptConfig} />
          <Button
            variant="ghost"
            size="sm"
            onClick={onLeave}
            className="text-sub hover:text-text text-xs h-8"
          >
            Leave Session
          </Button>
        </div>
      </div>

      <div className="grid gap-6 lg:grid-cols-[1fr_260px]">
        {/* ----------------------------------------------------------------- */}
        {/* Main column */}
        {/* ----------------------------------------------------------------- */}
        <div className="flex flex-col gap-5">
          {/* Current story */}
          <Card className="border-border/40 bg-surface">
            <CardContent className="pt-5 pb-5">
              {currentStory ? (
                <div className="flex flex-col gap-2">
                  <div className="flex items-center justify-between gap-2">
                    <div className="flex items-center gap-2 min-w-0">
                      <Button
                        variant="ghost"
                        size="icon"
                        className="h-7 w-7 shrink-0 text-sub hover:text-text"
                        onClick={prevStory}
                        disabled={session.currentStoryIdx === 0}
                      >
                        <ChevronLeft className="h-4 w-4" />
                      </Button>
                      <span className="text-xs text-sub shrink-0 font-data">
                        {session.currentStoryIdx + 1}/{session.stories.length}
                      </span>
                      <Button
                        variant="ghost"
                        size="icon"
                        className="h-7 w-7 shrink-0 text-sub hover:text-text"
                        onClick={nextStory}
                        disabled={session.currentStoryIdx >= session.stories.length - 1}
                      >
                        <ChevronRight className="h-4 w-4" />
                      </Button>
                    </div>
                    <div className="flex items-center gap-2">
                      {!session.revealed ? (
                        <Button
                          size="sm"
                          onClick={revealVotes}
                          disabled={votedCount === 0}
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
                          className="border-border/40 text-sub hover:text-text h-8 px-4 text-xs"
                        >
                          <RotateCcw className="h-3.5 w-3.5 mr-1.5" />
                          Vote Again
                        </Button>
                      )}
                    </div>
                  </div>

                  {/* Story title */}
                  <h2 className="text-2xl font-display font-bold text-text text-glow-cyan px-1">
                    {currentStory.title}
                  </h2>

                  {currentStory.finalEstimate && (
                    <div className="flex items-center gap-2 text-sm text-accent-green">
                      <Check className="h-4 w-4" />
                      Final estimate:{" "}
                      <span className="font-data font-bold">
                        {currentStory.finalEstimate}
                      </span>
                    </div>
                  )}
                </div>
              ) : (
                <p className="text-sub text-sm text-center py-4">
                  Add a story to begin estimating.
                </p>
              )}
            </CardContent>
          </Card>

          {/* Participant votes display */}
          {session.stories.length > 0 && (
            <Card className="border-border/40 bg-surface">
              <CardHeader className="pb-3">
                <CardTitle className="text-sm font-medium text-sub flex items-center gap-2">
                  <Users className="h-4 w-4" />
                  Votes
                  {!session.revealed && (
                    <span className="text-xs text-sub/60">
                      — face down until revealed
                    </span>
                  )}
                </CardTitle>
              </CardHeader>
              <CardContent className="pb-5">
                <div className="flex flex-wrap gap-4">
                  {session.participants.map((p) => (
                    <div
                      key={p.id}
                      className="flex flex-col items-center gap-2"
                    >
                      <PlayingCard
                        value={p.vote ?? ""}
                        faceDown={!session.revealed || p.vote === null}
                        small
                      />
                      <div className="flex items-center gap-1.5">
                        <Avatar name={p.name} size={20} />
                        <span className="text-xs text-sub max-w-[80px] truncate">
                          {p.name}
                        </span>
                        {p.vote !== null && !session.revealed && (
                          <Check className="h-3 w-3 text-accent-green" />
                        )}
                      </div>
                    </div>
                  ))}
                </div>

                {/* Results after reveal */}
                <AnimatePresence>
                  {session.revealed && votes.length > 0 && stats && (
                    <motion.div
                      initial={{ opacity: 0, y: 8 }}
                      animate={{ opacity: 1, y: 0 }}
                      exit={{ opacity: 0 }}
                      className="mt-6 flex flex-col gap-4"
                    >
                      {/* Consensus traffic light */}
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

                      {/* Stats row */}
                      <div className="flex flex-wrap gap-4">
                        {stats.average !== null && (
                          <div className="flex flex-col items-center gap-1">
                            <span className="text-xs text-sub">Average</span>
                            <span className="font-data text-xl font-bold text-text">
                              {stats.average % 1 === 0
                                ? stats.average
                                : stats.average.toFixed(1)}
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

                      {/* Accept estimate buttons */}
                      <div className="flex flex-wrap gap-2">
                        <span className="text-xs text-sub self-center">
                          Accept estimate:
                        </span>
                        {Array.from(new Set(votes)).map((v) => (
                          <Button
                            key={v}
                            size="sm"
                            variant="outline"
                            onClick={() => saveEstimate(v)}
                            className="h-8 px-3 text-xs border-border/40 text-sub hover:border-accent/60 hover:text-accent"
                          >
                            {v}
                          </Button>
                        ))}
                      </div>
                    </motion.div>
                  )}
                </AnimatePresence>
              </CardContent>
            </Card>
          )}

          {/* Voting cards fan */}
          {currentStory && !session.revealed && (
            <Card className="border-border/40 bg-surface">
              <CardHeader className="pb-3">
                <CardTitle className="text-sm font-medium text-sub">
                  Your vote
                </CardTitle>
              </CardHeader>
              <CardContent className="pb-6">
                <div className="flex flex-wrap justify-center gap-3 pt-2 pb-2">
                  {session.scale.map((value, i) => {
                    const mid = (cardCount - 1) / 2;
                    const rotation = cardCount > 1 ? ((i - mid) / mid) * maxRotation : 0;
                    return (
                      <PlayingCard
                        key={value}
                        value={value}
                        selected={hostVote === value}
                        onClick={() => castVote(value)}
                        rotation={rotation}
                      />
                    );
                  })}
                </div>
                {hostVote !== null && (
                  <p className="text-center text-sm text-accent mt-2">
                    You voted{" "}
                    <span className="font-data font-bold">{hostVote}</span>
                  </p>
                )}
              </CardContent>
            </Card>
          )}
        </div>

        {/* ----------------------------------------------------------------- */}
        {/* Right sidebar */}
        {/* ----------------------------------------------------------------- */}
        <div className="flex flex-col gap-5">
          {/* Story queue */}
          <Card className="border-border/40 bg-surface">
            <CardHeader className="pb-3">
              <CardTitle className="text-sm font-medium text-sub flex items-center gap-2">
                <Clock className="h-4 w-4" />
                Story Queue
              </CardTitle>
            </CardHeader>
            <CardContent className="flex flex-col gap-3">
              {/* Add story input */}
              <div className="flex gap-2">
                <Input
                  ref={newStoryRef}
                  value={newStory}
                  onChange={(e) => setNewStory(e.target.value)}
                  onKeyDown={(e) => e.key === "Enter" && addStory()}
                  placeholder="Story title…"
                  className="h-9 text-sm bg-surface-deep border-border/40 text-text"
                />
                <Button
                  size="icon"
                  onClick={addStory}
                  disabled={!newStory.trim()}
                  className="h-9 w-9 shrink-0 bg-accent text-[#0a0e1a] hover:bg-accent/80"
                >
                  <Plus className="h-4 w-4" />
                </Button>
              </div>

              {/* Story list */}
              {session.stories.length === 0 ? (
                <p className="text-xs text-sub/60 text-center py-2">
                  No stories yet. Add one above.
                </p>
              ) : (
                <div className="flex flex-col gap-1 max-h-60 overflow-y-auto pr-1">
                  {session.stories.map((story, idx) => (
                    <button
                      key={story.id}
                      onClick={() => goToStory(idx)}
                      className={[
                        "flex items-center justify-between gap-2 rounded-lg px-3 py-2 text-left text-xs transition-colors",
                        idx === session.currentStoryIdx
                          ? "bg-accent/10 border border-accent/30 text-accent"
                          : "text-sub hover:bg-surface-hover hover:text-text",
                      ].join(" ")}
                    >
                      <span className="truncate flex-1">{story.title}</span>
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
            </CardContent>
          </Card>

          {/* Participants sidebar */}
          <Card className="border-border/40 bg-surface">
            <CardHeader className="pb-3">
              <CardTitle className="text-sm font-medium text-sub flex items-center gap-2">
                <Users className="h-4 w-4" />
                Participants
                <span className="ml-auto font-data text-xs text-sub/60">
                  {votedCount}/{session.participants.length} voted
                </span>
              </CardTitle>
            </CardHeader>
            <CardContent className="flex flex-col gap-2 pb-4">
              {session.participants.map((p) => (
                <div
                  key={p.id}
                  className="flex items-center gap-3 rounded-lg px-2 py-1.5"
                >
                  <Avatar name={p.name} size={28} />
                  <span className="flex-1 text-sm text-text truncate">
                    {p.name}
                    {p.name === session.host && (
                      <span className="ml-1.5 text-xs text-sub/50">
                        (host)
                      </span>
                    )}
                  </span>
                  {p.vote !== null ? (
                    session.revealed ? (
                      <span className="font-data text-sm font-bold text-accent">
                        {p.vote}
                      </span>
                    ) : (
                      <Check className="h-4 w-4 text-accent-green shrink-0" />
                    )
                  ) : (
                    <span className="h-4 w-4 rounded-full border-2 border-border/40 shrink-0" />
                  )}
                </div>
              ))}

              {/* Multiplayer placeholder */}
              <div className="mt-2 rounded-lg border border-dashed border-border/30 px-3 py-2.5 text-center">
                <div className="flex items-center justify-center gap-1.5 text-xs text-sub/50">
                  <Wifi className="h-3 w-3" />
                  <span>Invite others when multiplayer is live</span>
                </div>
              </div>
            </CardContent>
          </Card>
        </div>
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Root client component
// ---------------------------------------------------------------------------

export function PlanningPokerClient() {
  const [session, setSession] = useState<Session | null>(null);

  const handleStart = ({
    sessionName,
    scale,
    displayName,
  }: {
    sessionName: string;
    scale: string[];
    scaleType: ScaleType; // reserved for Supabase integration
    displayName: string;
  }) => {
    const newSession: Session = {
      roomCode: generateRoomCode(),
      sessionName,
      scale,
      host: displayName,
      participants: [
        { id: crypto.randomUUID(), name: displayName, vote: null },
      ],
      stories: [],
      currentStoryIdx: 0,
      revealed: false,
    };
    setSession(newSession);
  };

  const handleLeave = () => setSession(null);

  return (
    <ToolPageWrapper
      title="Planning Poker"
      description="Estimate user stories as a team using Fibonacci, T-shirt, or custom scales."
      category="Sprint Planning & Estimation"
    >
      <AnimatePresence mode="wait">
        {session === null ? (
          <motion.div
            key="lobby"
            initial={{ opacity: 0, y: 16 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0, y: -16 }}
            transition={{ duration: 0.2 }}
          >
            <LobbyScreen onStart={handleStart} />
          </motion.div>
        ) : (
          <motion.div
            key="session"
            initial={{ opacity: 0, y: 16 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0, y: -16 }}
            transition={{ duration: 0.2 }}
          >
            <SessionScreen
              session={session}
              onUpdateSession={(updater) =>
                setSession((s) => (s ? updater(s) : s))
              }
              onLeave={handleLeave}
            />
          </motion.div>
        )}
      </AnimatePresence>
    </ToolPageWrapper>
  );
}
