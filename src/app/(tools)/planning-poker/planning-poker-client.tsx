"use client";

import { useEffect, useMemo, useState } from "react";
import { motion, AnimatePresence } from "framer-motion";
import { customAlphabet } from "nanoid";
import { WifiOff } from "lucide-react";
import { ToolPageWrapper } from "@/components/layout/tool-page-wrapper";
import { AiPromptGenerator } from "@/components/shared/ai-prompt-generator";
import { generatePlanningPokerPrompts } from "@/lib/ai-prompts/planning-poker";
import { useShallow } from "zustand/react/shallow";
import { useWorkspaceStore } from "@/lib/stores/workspace-store";
import { isRealtimeAvailable } from "@/lib/realtime/supabase-client";
import type { Workspace } from "@/lib/stores/workspace-types";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { SectionCard } from "@/components/shared/section-card";
import { SessionShareButton } from "@/components/collab/session-share-button";
import { SessionScreen } from "./session-screen";
import { usePokerSession } from "./use-poker-session";
import { SCALES, SCALE_LABELS, type ScaleType, type Session } from "./types";

// 6-char codes from a 32-symbol unambiguous alphabet (no 0/O/1/I/L). Backed
// by a CSPRNG via nanoid — Math.random was predictable and could collide
// across concurrent rooms.
const roomCodeGenerator = customAlphabet("23456789ABCDEFGHJKMNPQRSTUVWXYZ", 6);

function generateRoomCode(): string {
  return roomCodeGenerator();
}

// ─── Lobby ───────────────────────────────────────────────────────────
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
      <SectionCard
        title="Start a Session"
        className="border-border/40 bg-surface"
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
            className="bg-surface-deep border-border/40 text-text"
          />
        </div>

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
      </SectionCard>

      <SectionCard
        title="Join a Session"
        className="border-border/40 bg-surface"
        headerClassName="pb-4"
        contentClassName="flex flex-col gap-2"
      >
        <p className="text-xs text-sub">
          Guest joiners use a squad invite (Settings → Squads). Once you start a session you can
          invite your squad from the header.
        </p>
      </SectionCard>
    </div>
  );
}

// ─── Root ─────────────────────────────────────────────────────────────
export function PlanningPokerClient() {
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

  const handleStart = ({
    sessionName,
    scale,
    scaleType,
    displayName,
  }: {
    sessionName: string;
    scale: string[];
    scaleType: ScaleType;
    displayName: string;
  }) => {
    const code = generateRoomCode();
    const initial: Session = {
      roomCode: code,
      sessionName,
      scale,
      scaleType,
      host: displayName,
      hostId: userId,
      participants: [{ id: userId, name: displayName, vote: null }],
      stories: [],
      currentStoryIdx: 0,
      revealed: false,
    };
    setPendingInitial(initial);
    setActiveRoomCode(code);
  };

  const handleLeave = () => {
    broadcastSessionEnded();
    setActiveRoomCode(null);
    setPendingInitial(null);
    setSession(() => null);
  };

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
            {!realtimeAvailable && (
              <div className="max-w-xl mx-auto mb-4 flex items-center gap-2 rounded-lg border border-amber-500/30 bg-amber-500/5 px-4 py-3 text-sm text-amber-200/80">
                <WifiOff className="h-4 w-4 shrink-0" />
                <span>
                  Realtime not configured — sessions you start won&apos;t sync to squad members. Set{" "}
                  <code className="font-mono">NEXT_PUBLIC_SUPABASE_URL</code> +{" "}
                  <code className="font-mono">NEXT_PUBLIC_SUPABASE_ANON_KEY</code> to enable.
                </span>
              </div>
            )}
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
              onUpdateSession={(updater) => setSession((prev) => (prev ? updater(prev) : prev))}
              localParticipantId={userId}
              isHost={isHost}
              onLeave={handleLeave}
              extraHeaderActions={
                <>
                  {promptConfig && <AiPromptGenerator config={promptConfig} />}
                  <SessionShareButton
                    toolId="planning-poker"
                    entityId={session.roomCode}
                    label="Invite squad"
                  />
                </>
              }
              connectionLabel={isLocalOnly ? "Local-only" : isConnected ? "Live" : "Connecting…"}
              connectionTone={isLocalOnly ? "warn" : "live"}
            />
          </motion.div>
        )}
      </AnimatePresence>
    </ToolPageWrapper>
  );
}
