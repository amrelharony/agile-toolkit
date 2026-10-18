"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { motion, AnimatePresence } from "framer-motion";
import { customAlphabet } from "nanoid";
import { ListChecks, WifiOff } from "lucide-react";
import { ToolPageWrapper } from "@/components/layout/tool-page-wrapper";
import { AiPromptGenerator } from "@/components/shared/ai-prompt-generator";
import { generatePlanningPokerPrompts } from "@/lib/ai-prompts/planning-poker";
import { useShallow } from "zustand/react/shallow";
import { useWorkspaceStore } from "@/lib/stores/workspace-store";
import { isRealtimeAvailable } from "@/lib/realtime/supabase-client";
import { useOwnerState } from "@/lib/auth/use-is-owner";
import type { Workspace } from "@/lib/stores/workspace-types";
import { undoable } from "@/lib/utils/undoable";
import { toast } from "@/lib/utils/toast";
import { POKER_LOG_ID } from "@/lib/handoffs/targets/poker-queue";
import {
  pendingQueueItems,
  takeQueuedStories,
  writeBackPokerEstimate,
} from "@/lib/handoffs/poker-writeback";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { SectionCard } from "@/components/shared/section-card";
import { ExportButton } from "@/components/shared/export-button";
import { SessionShareButton } from "@/components/collab/session-share-button";
import {
  ExampleNotice,
  LoadExampleButton,
  isExampleId,
} from "@/components/tool-frame/example-data";
import { SessionScreen } from "./session-screen";
import { usePokerSession } from "./use-poker-session";
import {
  adoptLocalSession,
  clearLocalSession,
  loadLocalSession,
  saveLocalSession,
} from "./local-session";
import { SCALES, SCALE_LABELS, type ScaleType, type Session } from "./types";
import {
  DEFAULT_DISPLAY_NAME,
  DEFAULT_SESSION_NAME,
  buildExample,
  isExampleSession,
} from "./example";
import { toMarkdown } from "./markdown";

/** A name short enough for a one-line toast. */
function shortName(name: string, max = 40): string {
  const t = name.trim();
  return t.length > max ? `${t.slice(0, max - 1).trimEnd()}…` : t;
}

// 6-char codes from a 32-symbol unambiguous alphabet (no 0/O/1/I/L). Backed
// by a CSPRNG via nanoid — Math.random was predictable and could collide
// across concurrent rooms.
const roomCodeGenerator = customAlphabet("23456789ABCDEFGHJKMNPQRSTUVWXYZ", 6);

function generateRoomCode(): string {
  return roomCodeGenerator();
}

// ─── Lobby ───────────────────────────────────────────────────────────
interface StartData {
  sessionName: string;
  scale: string[];
  scaleType: ScaleType;
  displayName: string;
  /** Open the session with the queued stories already in it. */
  fromQueue?: boolean;
}

function LobbyScreen({
  onStart,
  onLoadExample,
  isOwner,
  queuedCount = 0,
}: {
  onStart: (data: StartData) => void;
  /** Omitted until auth settles, so the example can't beat a stored
   *  session to the restore. */
  onLoadExample?: () => void;
  isOwner: boolean;
  /** Stories other tools queued for estimation (Story Mapper). */
  queuedCount?: number;
}) {
  const [sessionName, setSessionName] = useState(DEFAULT_SESSION_NAME);
  const [scaleType, setScaleType] = useState<ScaleType>("fibonacci");
  const [customInput, setCustomInput] = useState("1, 2, 4, 8, 16, 32");
  const [displayName, setDisplayName] = useState(DEFAULT_DISPLAY_NAME);

  const resolvedScale =
    scaleType === "custom"
      ? customInput
          .split(",")
          .map((s) => s.trim())
          .filter(Boolean)
      : SCALES[scaleType];

  const canStart = Boolean(sessionName.trim() && displayName.trim() && resolvedScale.length >= 2);
  const handleStart = (fromQueue = false) => {
    if (!canStart) return;
    onStart({
      sessionName: sessionName.trim(),
      scale: resolvedScale,
      scaleType,
      displayName: displayName.trim(),
      fromQueue,
    });
  };

  return (
    <div className="max-w-xl mx-auto flex flex-col gap-6">
      <SectionCard
        title="Start a Session"
        className="border-border bg-surface"
        headerClassName="pb-4"
        contentClassName="flex flex-col gap-5"
      >
        <div className="flex flex-col gap-2">
          <Label htmlFor="session-name" className="text-sub text-sm">
            Session name
          </Label>
          <Input
            id="session-name"
            value={sessionName}
            onChange={(e) => setSessionName(e.target.value)}
            placeholder="e.g. Sprint 42 Planning"
            className="bg-surface-deep border-border text-text"
          />
        </div>

        <div className="flex flex-col gap-2">
          <span id="estimation-scale-label" className="text-sm font-medium leading-none text-sub">
            Estimation scale
          </span>
          <div role="group" aria-labelledby="estimation-scale-label" className="flex gap-2">
            {(["fibonacci", "tshirt", "custom"] as ScaleType[]).map((s) => (
              <button
                key={s}
                type="button"
                onClick={() => setScaleType(s)}
                aria-pressed={scaleType === s}
                className={[
                  "flex-1 rounded-lg border py-2 px-3 text-sm font-medium transition-colors",
                  scaleType === s
                    ? "border-accent/60 bg-accent/10 text-accent"
                    : "border-border bg-surface-deep text-sub hover:border-border hover:text-text",
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
              aria-label="Custom scale values"
              className="bg-surface-deep border-border text-text text-sm"
            />
          )}
          <div className="flex flex-wrap gap-1.5 pt-1">
            {resolvedScale.map((v) => (
              <span
                key={v}
                className="rounded-md border border-border bg-surface-deep px-2 py-0.5 text-xs text-sub"
              >
                {v}
              </span>
            ))}
          </div>
        </div>

        <div className="flex flex-col gap-2">
          <Label htmlFor="display-name" className="text-sub text-sm">
            Your display name
          </Label>
          <Input
            id="display-name"
            value={displayName}
            onChange={(e) => setDisplayName(e.target.value)}
            placeholder="e.g. Alice"
            className="bg-surface-deep border-border text-text"
          />
        </div>

        <Button
          onClick={() => handleStart()}
          disabled={!canStart}
          className="bg-accent text-[#0a0e1a] hover:bg-accent/80 font-semibold h-11"
        >
          Start Session
        </Button>
        {queuedCount > 0 && (
          <div className="flex flex-col gap-2 rounded-lg border border-accent/30 bg-accent/10 px-3 py-2.5 sm:flex-row sm:items-center sm:justify-between">
            <p className="flex items-center gap-2 text-sm text-text">
              <ListChecks className="h-4 w-4 shrink-0 text-accent" aria-hidden="true" />
              {queuedCount} {queuedCount === 1 ? "story" : "stories"} queued for estimation
            </p>
            <Button
              type="button"
              variant="toolkit"
              size="sm"
              onClick={() => handleStart(true)}
              disabled={!canStart}
            >
              Start with the queue
            </Button>
          </div>
        )}
        {onLoadExample && <LoadExampleButton onLoad={onLoadExample} className="self-center" />}
      </SectionCard>

      <SectionCard
        title={isOwner ? "Invite your squad" : "Running it with your team"}
        className="border-border bg-surface"
        headerClassName="pb-4"
        contentClassName="flex flex-col gap-2"
      >
        <p className="text-sm text-sub">
          {isOwner
            ? "Guest joiners use a squad invite (Settings → Squads). Once you start a session you can invite your squad from the header."
            : "This session runs on your screen. Share it in your meeting, read each story aloud, let everyone pick a card, then reveal together and agree the estimate."}
        </p>
      </SectionCard>
    </div>
  );
}

// ─── Root ─────────────────────────────────────────────────────────────
export function PlanningPokerClient() {
  // Visitors get a solo session: useRoom keeps them off Realtime and the
  // squad invite button hides itself, so the copy says so instead.
  const { isOwner, visitor } = useOwnerState();
  const [activeRoomCode, setActiveRoomCode] = useState<string | null>(null);
  // isLocalOnly from usePokerSession is true whenever roomCode is null
  // (lobby) — so it can't distinguish "lobby, env is fine" from "lobby,
  // env missing". Check env availability directly for the lobby banner.
  const [realtimeAvailable, setRealtimeAvailable] = useState(true);
  useEffect(() => {
    setRealtimeAvailable(isRealtimeAvailable());
  }, []);
  // Holds the just-built session until the room subscription connects;
  // a useEffect then commits it via setSession so the host's first
  // broadcast carries the full initial state to any guest already in
  // the room (rare but possible — squad invite was issued in advance).
  const [pendingInitial, setPendingInitial] = useState<Session | null>(null);

  const pokerHook = usePokerSession(activeRoomCode, /* isHost */ true);
  const { session, setSession, isConnected, isLocalOnly, userId, isHost, broadcastSessionEnded } =
    pokerHook;

  useEffect(() => {
    if (!pendingInitial) return;
    if (!isConnected && !isLocalOnly) return;
    setSession(pendingInitial);
    setPendingInitial(null);
  }, [pendingInitial, isConnected, isLocalOnly, setSession]);

  // Local-only sessions (visitors, or the owner without Realtime env)
  // survive a refresh or a trip to another tool: restore the stored one
  // once auth says which kind of viewer this is. Checked once per mount
  // so leaving a session doesn't bring it straight back. A live room is
  // never restored — the owner with Realtime keeps today's behavior.
  const restoreCheckedRef = useRef(false);
  useEffect(() => {
    if (restoreCheckedRef.current) return;
    // Still loading, or an owner re-check is pending: wait for a verdict.
    if (!visitor && !isOwner) return;
    restoreCheckedRef.current = true;
    if (isOwner && isRealtimeAvailable()) return;
    if (session || pendingInitial) return;
    const stored = loadLocalSession();
    if (!stored) return;
    setPendingInitial(adoptLocalSession(stored, userId));
    // The example never gets a room, even if this browser signs in later.
    setActiveRoomCode(isExampleId(stored.roomCode) ? null : stored.roomCode);
  }, [visitor, isOwner, session, pendingInitial, userId]);

  // Mirror every change of a local-only session into storage. A session
  // that turns out to be live (an owner who started before auth
  // verified them) drops its stale local copy instead.
  useEffect(() => {
    if (!session) return;
    if (isLocalOnly) saveLocalSession(session);
    else clearLocalSession();
  }, [session, isLocalOnly]);

  // ─── Queue: stories other tools sent (Story Mapper) ───
  // It lives on the estimate log in this browser's workspace, never in the
  // session payload. Only this owner-side client reads it; guests don't.
  const queue = useWorkspaceStore(
    useShallow((s) => (s.pokerEstimationLogs ?? []).find((d) => d.id === POKER_LOG_ID)?.queue)
  );
  const sessionStoryIds = useMemo(() => session?.stories.map((st) => st.id) ?? [], [session]);
  const queuedCount = useMemo(
    () => pendingQueueItems(queue, sessionStoryIds).length,
    [queue, sessionStoryIds]
  );

  const addQueued = () => {
    if (!session) return;
    const stories = takeQueuedStories(session.stories.map((st) => st.id));
    if (stories.length === 0) return;
    setSession((prev) => (prev ? { ...prev, stories: [...prev.stories, ...stories] } : prev));
  };

  // The host accepted an estimate. A story pulled from this browser's queue
  // gets it written back to its source card; any other story is ignored.
  const handleEstimateAccepted = (storyId: string, value: string, votes: string[]) => {
    if (!session) return;
    const { item, written } = writeBackPokerEstimate({
      sessionStoryId: storyId,
      value,
      scaleType: session.scaleType,
      votes,
    });
    if (item && written) {
      toast.success(`Saved ${value} on the story map`, {
        description: `“${shortName(item.title)}”`,
      });
    }
  };

  const handleStart = ({ sessionName, scale, scaleType, displayName, fromQueue }: StartData) => {
    const code = generateRoomCode();
    const initial: Session = {
      roomCode: code,
      sessionName,
      scale,
      scaleType,
      host: displayName,
      hostId: userId,
      participants: [{ id: userId, name: displayName, vote: null }],
      stories: fromQueue ? takeQueuedStories() : [],
      currentStoryIdx: 0,
      revealed: false,
    };
    setPendingInitial(initial);
    setActiveRoomCode(code);
  };

  const handleLeave = () => {
    const leave = () => {
      clearLocalSession();
      broadcastSessionEnded();
      setActiveRoomCode(null);
      setPendingInitial(null);
      setSession(() => null);
    };
    // Leaving a local-only session discards its stories, so offer Undo. A
    // live room can't be taken back: the squad has already seen the host go.
    const left = session;
    const leftRoom = activeRoomCode;
    if (!isLocalOnly || !left || left.stories.length === 0) return leave();
    const n = left.stories.length;
    undoable({
      label: `Left “${shortName(left.sessionName)}”`,
      description: `${n} ${n === 1 ? "story" : "stories"} and their estimates were cleared.`,
      apply: leave,
      // Re-open it the way a stored session is restored, unless another
      // session has been started since. It goes back to the room it had:
      // none for the example, which must never open a channel.
      revert: () => {
        if (loadLocalSession()) return;
        setPendingInitial(left);
        setActiveRoomCode(leftRoom);
      },
    });
  };

  // ─── Example session ───
  // Committed straight through setSession with no room code, so useRoom
  // never opens a channel for it; it's stored like any local session.
  // Loading it isn't the user's work, so nothing is logged.
  const exampleShown = isExampleSession(session);
  const loadExample = () => {
    if (session || pendingInitial) return;
    setSession(buildExample(userId));
  };
  // Drops the example's stories and teammates. Stories the user added
  // stay on as their own session; with none, it's back to the lobby.
  const clearExample = () => {
    if (!session?.stories.some((s) => !isExampleId(s.id))) {
      clearLocalSession();
      setActiveRoomCode(null);
      setPendingInitial(null);
      setSession(() => null);
      return;
    }
    setSession((prev) =>
      prev
        ? {
            ...prev,
            roomCode: generateRoomCode(),
            sessionName: DEFAULT_SESSION_NAME,
            participants: prev.participants
              .filter((p) => !isExampleId(p.id))
              .map((p) => ({ ...p, vote: null })),
            stories: prev.stories.filter((s) => !isExampleId(s.id)),
            currentStoryIdx: 0,
            revealed: false,
          }
        : prev
    );
  };

  const markdown = useMemo(() => toMarkdown(session), [session]);

  // ─── AI prompt config (owner only, derived from current session) ───
  const workspace = useWorkspaceStore(
    useShallow(
      (s): Workspace => ({
        teamMembers: s.teamMembers,
        sprints: s.sprints,
        stories: s.stories,
        impediments: s.impediments,
        risks: s.risks,
        okrs: s.okrs,
        decisions: s.decisions,
        techDebt: s.techDebt,
        maturityLevel: s.maturityLevel,
        teamName: s.teamName,
      })
    )
  );
  const promptConfig = useMemo(() => {
    if (!session) return null;
    const scaleName = SCALE_LABELS[session.scaleType] ?? "Custom";
    return {
      toolName: "Planning Poker",
      prompts: generatePlanningPokerPrompts(
        {
          stories: session.stories.map((s, idx) => ({
            title: s.title,
            description: s.description,
            votes:
              idx === session.currentStoryIdx && session.revealed
                ? session.participants.map((p) => p.vote).filter((v): v is string => v !== null)
                : [],
            finalEstimate: s.finalEstimate,
          })),
          scaleName,
        },
        workspace
      ),
    };
  }, [session, workspace]);

  return (
    <ToolPageWrapper
      toolId="planning-poker"
      title="Planning Poker"
      description="Estimate user stories as a team using Fibonacci, T-shirt, or custom scales."
      category="Sprint Planning & Estimation"
    >
      <AnimatePresence mode="wait">
        {!session ? (
          <motion.div
            key="lobby"
            initial={{ opacity: 0, y: 16 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0, y: -16 }}
            transition={{ duration: 0.2 }}
          >
            {isOwner && !realtimeAvailable && (
              <div className="max-w-xl mx-auto mb-4 flex items-center gap-2 rounded-lg border border-warning/30 bg-warning/5 px-4 py-3 text-sm text-warning/80">
                <WifiOff className="h-4 w-4 shrink-0" />
                <span>
                  Realtime not configured — sessions you start won&apos;t sync to squad members. Set{" "}
                  <code className="font-mono">NEXT_PUBLIC_SUPABASE_URL</code> +{" "}
                  <code className="font-mono">NEXT_PUBLIC_SUPABASE_ANON_KEY</code> to enable.
                </span>
              </div>
            )}
            <LobbyScreen
              onStart={handleStart}
              onLoadExample={visitor || isOwner ? loadExample : undefined}
              isOwner={isOwner}
              queuedCount={queuedCount}
            />
          </motion.div>
        ) : (
          <motion.div
            key="session"
            initial={{ opacity: 0, y: 16 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0, y: -16 }}
            transition={{ duration: 0.2 }}
          >
            {exampleShown && <ExampleNotice onClear={clearExample} />}
            <SessionScreen
              session={session}
              onUpdateSession={(updater) => setSession((prev) => (prev ? updater(prev) : prev))}
              localParticipantId={userId}
              isHost={isHost}
              onLeave={handleLeave}
              extraHeaderActions={
                <>
                  <ExportButton filename="planning-poker" markdown={markdown} />
                  {promptConfig && <AiPromptGenerator config={promptConfig} />}
                  {/* The example (and what's kept of it) has no room to invite to. */}
                  {activeRoomCode !== null && (
                    <SessionShareButton
                      toolId="planning-poker"
                      entityId={session.roomCode}
                      label="Invite squad"
                    />
                  )}
                </>
              }
              connectionLabel={
                !isOwner
                  ? "Browser-only"
                  : isLocalOnly
                    ? "Local-only"
                    : isConnected
                      ? "Live"
                      : "Connecting…"
              }
              connectionTone={isLocalOnly ? "warn" : "live"}
              // Nobody can join a local-only room, so don't show its code.
              showRoomCode={!isLocalOnly}
              leaveClearsSession={isLocalOnly}
              queuedCount={queuedCount}
              onAddQueued={addQueued}
              onEstimateAccepted={handleEstimateAccepted}
            />
          </motion.div>
        )}
      </AnimatePresence>
    </ToolPageWrapper>
  );
}
