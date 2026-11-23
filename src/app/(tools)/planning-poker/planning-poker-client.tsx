"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import dynamic from "next/dynamic";
import { motion, AnimatePresence } from "framer-motion";
import { WifiOff } from "lucide-react";
import { ToolPageWrapper } from "@/components/layout/tool-page-wrapper";
import { AiPromptGenerator } from "@/components/shared/ai-prompt-generator";
import { generatePlanningPokerPrompts } from "@/lib/ai-prompts/planning-poker";
import { useShallow } from "zustand/react/shallow";
import { useWorkspaceStore } from "@/lib/stores/workspace-store";
import { isRealtimeAvailable } from "@/lib/realtime/supabase-client";
import { useOwnerState } from "@/lib/auth/use-is-owner";
import type { Story, Workspace } from "@/lib/stores/workspace-types";
import { undoable } from "@/lib/utils/undoable";
import { withRefinedPutBack } from "@/lib/sprints/story-status";
import { toast } from "@/lib/utils/toast";
import { POKER_LOG_ID } from "@/lib/handoffs/targets/poker-queue";
import {
  pendingQueueItems,
  takeQueuedStories,
  writeBackPokerEstimate,
} from "@/lib/handoffs/poker-writeback";
import { ExportButton } from "@/components/shared/export-button";
import { SessionShareButton } from "@/components/collab/session-share-button";
import { VisitorRoomConsent } from "@/components/collab/visitor-room-consent";
import { useAnnounce } from "@/components/a11y/live-announcer";
import {
  VISITOR_LIMITS,
  clearVisitorIdentity,
  isVisitorRoomCode,
  newVisitorRoomCode,
  saveVisitorIdentity,
  visitorRoomsEnabled,
  type VisitorIdentity,
} from "@/lib/realtime/visitor-rooms";
import { ExampleNotice, isExampleId } from "@/components/tool-frame/example-data";
import { SessionScreen } from "./session-screen";
import { usePokerSession } from "./use-poker-session";
import { useRoomExtras } from "@/lib/realtime/use-room-extras";
import { fitStoriesToVisitorRoom, withHostOnly } from "./visitor-session";
import {
  adoptLocalSession,
  clearLocalSession,
  loadLocalSession,
  loadQueuedStoryIds,
  saveLocalSession,
  saveQueuedStoryIds,
} from "./local-session";
import { SCALE_LABELS, type Session } from "./types";
import { DEFAULT_SESSION_NAME, buildExample, isExampleSession } from "./example";
import { LobbyScreen, type StartData } from "./lobby-screen";
import { loggedQueueStoryIds, planBacklogSave, planSize, savedCount } from "./backlog";
import { useCardReferences } from "./use-card-references";
import { toMarkdown } from "./markdown";
import { pokerCsv, sessionTicketKeys } from "./csv";
import { generateRoomCode } from "./room-code";
import { signalGamification } from "@/lib/gamification/signal";

// A visitor's live room only: the room's bar (its timer, big screen and
// chip) and the reactions load when a room opens, not with the page.
const PokerRoomBar = dynamic(() => import("./poker-room-bar").then((m) => m.PokerRoomBar), {
  ssr: false,
});
const RoomReactions = dynamic(
  () => import("@/components/collab/room-reactions").then((m) => m.RoomReactions),
  { ssr: false }
);

/** A name short enough for a one-line toast. */
function shortName(name: string, max = 40): string {
  const t = name.trim();
  return t.length > max ? `${t.slice(0, max - 1).trimEnd()}…` : t;
}

const ROOM_TTL_HOURS = Math.round(VISITOR_LIMITS.hardTtlMs / 3_600_000);
const ROOM_IDLE_MINUTES = Math.round(VISITOR_LIMITS.idleMs / 60_000);

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
  // Session stories pulled in from the queue. Once one is estimated the
  // queue forgets it, so this is how "Save to backlog" knows to skip it.
  const [fromQueue, setFromQueue] = useState<ReadonlySet<string>>(() => new Set());
  const addFromQueue = useCallback((ids: readonly string[]) => {
    if (ids.length === 0) return;
    setFromQueue((prev) => new Set([...Array.from(prev), ...ids]));
  }, []);

  // ─── Visitor live room ───
  // Only a confirmed visitor (never the owner) with the flag on and
  // Realtime configured is offered one. Which room this is lives ONLY in
  // this state: it's never persisted, so restoring a stored session can
  // never reopen a room ("restore pitfall").
  const [visitorRoom, setVisitorRoom] = useState<{
    code: string;
    identity: VisitorIdentity;
  } | null>(null);
  // The lobby settings waiting on the consent dialog.
  const [consentFor, setConsentFor] = useState<StartData | null>(null);
  const liveRoomsOffered = visitor && !isOwner && realtimeAvailable && visitorRoomsEnabled();
  const announce = useAnnounce();

  const pokerHook = usePokerSession(activeRoomCode, /* isHost */ true, {
    visitor: visitorRoom !== null,
    identity: visitorRoom?.identity,
  });
  const {
    session,
    setSession,
    isConnected,
    isLocalOnly,
    userId,
    isHost,
    broadcastSessionEnded,
    memberCount,
    leftReason,
    kick,
    endRoom,
    idleWarning,
    keepRoomOpen,
  } = pokerHook;
  // A visitor room's countdown and reactions (no port, so nothing, otherwise).
  const roomExtras = useRoomExtras(pokerHook.extras);

  useEffect(() => {
    if (!pendingInitial) return;
    if (!isConnected && !isLocalOnly) return;
    setSession(pendingInitial);
    setPendingInitial(null);
  }, [pendingInitial, isConnected, isLocalOnly, setSession]);

  // The live room is over: ended here, closed by its 3-hour limit or for
  // inactivity. Forget it and carry on locally with only the host's seat
  // (the hook has already left the channel, so nothing is broadcast).
  useEffect(() => {
    if (!visitorRoom || leftReason === null) return;
    clearVisitorIdentity(visitorRoom.code);
    setVisitorRoom(null);
    setActiveRoomCode(null);
    setPendingInitial(null);
    setSession((prev) => (prev ? withHostOnly(prev) : prev));
    const why =
      leftReason === "expired"
        ? `The live room closed after ${ROOM_TTL_HOURS} hours.`
        : leftReason === "idle"
          ? `The live room closed after ${ROOM_IDLE_MINUTES} minutes without activity.`
          : "Room ended.";
    announce(`${why} Your session continues on this device.`);
    if (leftReason === "expired" || leftReason === "idle") {
      toast.info(why, { description: "Your session continues on this device." });
    }
  }, [visitorRoom, leftReason, setSession, announce]);

  // Owners don't run visitor rooms (strangers' content must never reach
  // the owner's synced data). If this browser turns out to be the owner's
  // while one is open, end it.
  useEffect(() => {
    if (isOwner && visitorRoom) endRoom();
  }, [isOwner, visitorRoom, endRoom]);

  const startLiveRoom = (name: string) => {
    const data = consentFor;
    setConsentFor(null);
    if (!data || !liveRoomsOffered) return;
    const code = newVisitorRoomCode();
    const identity = saveVisitorIdentity(code, name);
    if (!identity) return;
    const initial: Session = {
      roomCode: code,
      sessionName: data.sessionName,
      scale: data.scale,
      scaleType: data.scaleType,
      host: identity.name,
      hostId: identity.id,
      participants: [{ id: identity.id, name: identity.name, vote: null }],
      stories: [],
      currentStoryIdx: 0,
      revealed: false,
    };
    setVisitorRoom({ code, identity });
    setPendingInitial(initial);
    setActiveRoomCode(code);
    signalGamification("invite-created", { toolId: "planning-poker" });
  };

  // The room never connected (or the visitor changed their mind): back to
  // the lobby, with nothing opened.
  const cancelLiveRoom = () => {
    if (visitorRoom) clearVisitorIdentity(visitorRoom.code);
    setVisitorRoom(null);
    setPendingInitial(null);
    setActiveRoomCode(null);
  };

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
    addFromQueue(loadQueuedStoryIds());
    // The example never gets a room, even if this browser signs in later.
    // Nor does a session that was a visitor live room: it comes back as a
    // plain local session, never reconnected.
    setActiveRoomCode(
      isExampleId(stored.roomCode) || isVisitorRoomCode(stored.roomCode) ? null : stored.roomCode
    );
  }, [visitor, isOwner, session, pendingInitial, userId, addFromQueue]);

  // Mirror every change of a local-only session into storage. A session
  // that turns out to be live (an owner who started before auth
  // verified them) drops its stale local copy instead. A visitor live
  // room keeps a copy with only the host's seat (no one else's name is
  // stored), so a refresh brings the stories back as a local session.
  useEffect(() => {
    if (!session) return;
    if (visitorRoom) saveLocalSession(withHostOnly(session));
    else if (isLocalOnly) saveLocalSession(session);
    else clearLocalSession();
  }, [session, isLocalOnly, visitorRoom]);

  // The note of which stories came from the queue goes with a stored
  // session (clearLocalSession above drops it for a live one).
  useEffect(() => {
    if (!session || !(isLocalOnly || visitorRoom)) return;
    saveQueuedStoryIds(session.stories.map((st) => st.id).filter((id) => fromQueue.has(id)));
  }, [session, isLocalOnly, visitorRoom, fromQueue]);

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
    const taken = takeQueuedStories(session.stories.map((st) => st.id));
    if (taken.length === 0) return;
    // A live room can't send a session over its size limit, and a queue of
    // stories with notes and acceptance criteria would pass it: their
    // descriptions are shortened to fit. The stories keep theirs in full.
    const stories = visitorRoom ? fitStoriesToVisitorRoom(session, taken) : taken;
    addFromQueue(stories.map((st) => st.id));
    setSession((prev) => (prev ? { ...prev, stories: [...prev.stories, ...stories] } : prev));
  };

  // ─── Save to backlog: the stories typed into this session ───
  // Queue stories are left out (their estimate goes back to their source):
  // the ones this browser pulled in, any the queue still lists, and, for a
  // session stored before the note of queue stories, the ones whose
  // estimate the write-back logged.
  const backlogStories = useWorkspaceStore((s) => s.stories);
  const loggedEstimates = useWorkspaceStore(
    (s) => (s.pokerEstimationLogs ?? []).find((d) => d.id === POKER_LOG_ID)?.estimates
  );
  const skipForBacklog = useMemo(() => {
    const ids = new Set(fromQueue);
    for (const q of queue ?? []) if (q.sessionStoryId) ids.add(q.sessionStoryId);
    for (const id of loggedQueueStoryIds(session?.stories ?? [], loggedEstimates)) ids.add(id);
    return ids;
  }, [fromQueue, queue, session?.stories, loggedEstimates]);
  const backlogPlan = useMemo(
    () => (session ? planBacklogSave(session.stories, backlogStories, skipForBacklog) : null),
    [session, backlogStories, skipForBacklog]
  );
  const saveToBacklog = () => {
    if (!session) return;
    // Planned again from the store as it is now, so a double click can't
    // create the same stories twice.
    const plan = planBacklogSave(
      session.stories,
      useWorkspaceStore.getState().stories,
      skipForBacklog
    );
    const n = planSize(plan);
    if (n === 0) return;
    const { upsertStory, removeStory } = useWorkspaceStore.getState();
    // A T-shirt size isn't story points: say so, rather than let a sized
    // story read as one nobody estimated.
    const unestimated = plan.unsized - plan.notPoints;
    const notes = [
      unestimated > 0 ? `${unestimated} without points yet` : "",
      plan.notPoints > 0
        ? `${plan.notPoints} without points, since ${
            plan.notPoints === 1 ? "its size isn't" : "their sizes aren't"
          } story points`
        : "",
      plan.update.length > 0
        ? `${plan.update.length} given ${plan.update.length === 1 ? "its" : "their"} points`
        : "",
    ].filter(Boolean);
    const stamps = new Map<string, string | undefined>();
    undoable({
      label: `Saved ${n} ${n === 1 ? "story" : "stories"} to the backlog`,
      description: notes.length > 0 ? `${notes.join(", ")}.` : undefined,
      apply: () => {
        for (const st of plan.create) upsertStory(st);
        for (const { after } of plan.update) upsertStory(after);
        // The refinedAt each points write left, for the Undo to take back.
        const saved = useWorkspaceStore.getState().stories;
        for (const { before } of plan.update) {
          stamps.set(before.id, saved.find((x) => x.id === before.id)?.refinedAt);
        }
      },
      revert: () => {
        const now = useWorkspaceStore.getState().stories;
        for (const st of plan.create) if (now.some((x) => x.id === st.id)) removeStory(st.id);
        // Only the points go back, with the refinedAt from before them unless
        // the story was refined since: anything else edited since stays.
        for (const { before } of plan.update) {
          const cur = now.find((x) => x.id === before.id);
          if (!cur) continue;
          const restored: Story = { ...cur, points: before.points };
          if (before.points === undefined) delete restored.points;
          upsertStory(withRefinedPutBack(restored, stamps.get(before.id), before.refinedAt));
        }
      },
    });
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

  const handleStart = ({
    sessionName,
    scale,
    scaleType,
    displayName,
    fromQueue: withQueue,
  }: StartData) => {
    // A live room still opening gives way to the plain session.
    if (visitorRoom) clearVisitorIdentity(visitorRoom.code);
    setVisitorRoom(null);
    const code = generateRoomCode();
    const stories = withQueue ? takeQueuedStories() : [];
    addFromQueue(stories.map((st) => st.id));
    const initial: Session = {
      roomCode: code,
      sessionName,
      scale,
      scaleType,
      host: displayName,
      hostId: userId,
      participants: [{ id: userId, name: displayName, vote: null }],
      stories,
      currentStoryIdx: 0,
      revealed: false,
    };
    setPendingInitial(initial);
    setActiveRoomCode(code);
    signalGamification("invite-created", { toolId: "planning-poker" });
  };

  const handleLeave = () => {
    const leave = () => {
      clearLocalSession();
      broadcastSessionEnded();
      if (visitorRoom) clearVisitorIdentity(visitorRoom.code);
      setVisitorRoom(null);
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
  // The Export menu's CSV: each story's ticket key (its title when it has
  // none), the summary and the agreed estimate, ready for a tracker.
  const csvData = useMemo(
    () =>
      pokerCsv(
        session,
        sessionTicketKeys(session?.stories ?? [], {
          queue,
          estimates: loggedEstimates,
          stories: backlogStories,
          fromQueue,
        })
      ),
    [session, queue, loggedEstimates, backlogStories, fromQueue]
  );
  const references = useCardReferences(session?.scaleType, session?.scale);

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
              <div className="max-w-xl mx-auto mb-4 flex items-center gap-2 rounded-lg border border-warning/30 bg-warning/5 px-4 py-3 text-sm text-warning">
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
              onStartLive={liveRoomsOffered ? setConsentFor : undefined}
              liveRoomPending={visitorRoom !== null && pendingInitial !== null}
              onCancelLive={cancelLiveRoom}
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
            {visitorRoom && (
              <PokerRoomBar
                code={visitorRoom.code}
                memberCount={memberCount}
                isHost
                onEnd={endRoom}
                idleWarning={idleWarning}
                onKeepOpen={keepRoomOpen}
                keepsSession
                extras={roomExtras}
                session={session}
                bigScreen
              />
            )}
            <SessionScreen
              session={session}
              onUpdateSession={(updater) => setSession((prev) => (prev ? updater(prev) : prev))}
              localParticipantId={userId}
              isHost={isHost}
              onLeave={handleLeave}
              extraHeaderActions={
                <>
                  <ExportButton filename="planning-poker" markdown={markdown} csvData={csvData} />
                  {promptConfig && <AiPromptGenerator config={promptConfig} />}
                  {/* The example (and what's kept of it) has no room to invite to. */}
                  {activeRoomCode !== null && !visitorRoom && (
                    <SessionShareButton
                      toolId="planning-poker"
                      entityId={session.roomCode}
                      label="Invite squad"
                    />
                  )}
                </>
              }
              connectionLabel={
                visitorRoom
                  ? isConnected
                    ? "Live room"
                    : "Connecting…"
                  : !isOwner
                    ? "Browser-only"
                    : isLocalOnly
                      ? "Local-only"
                      : isConnected
                        ? "Live"
                        : "Connecting…"
              }
              connectionTone={isLocalOnly ? "warn" : "live"}
              // Nobody can join a local-only room, so don't show its code.
              // A visitor room shows its code in the chip above.
              showRoomCode={!isLocalOnly && !visitorRoom}
              leaveClearsSession={isLocalOnly}
              // One screen for the whole team: only where nobody else can
              // join. A live room keeps one device per voter.
              facilitator={isLocalOnly}
              queuedCount={queuedCount}
              onAddQueued={addQueued}
              // Nothing from a visitor room is written back to the
              // workspace or logged to history.
              onEstimateAccepted={visitorRoom ? undefined : handleEstimateAccepted}
              references={visitorRoom ? undefined : references}
              backlog={
                visitorRoom || !backlogPlan
                  ? undefined
                  : {
                      toSave: planSize(backlogPlan),
                      saved: savedCount(session.stories, backlogStories),
                      onSave: saveToBacklog,
                    }
              }
              recordHistory={!visitorRoom}
              onRemoveParticipant={visitorRoom ? (p) => kick(p.id) : undefined}
              revealAtZero={visitorRoom ? roomExtras.timer : null}
            />
            {visitorRoom && <RoomReactions extras={roomExtras} className="pt-2" />}
          </motion.div>
        )}
      </AnimatePresence>
      {liveRoomsOffered && (
        <VisitorRoomConsent
          open={consentFor !== null}
          onOpenChange={(open) => {
            if (!open) setConsentFor(null);
          }}
          mode="start"
          toolName="Planning Poker"
          defaultName={consentFor?.displayName ?? ""}
          onConfirm={startLiveRoom}
        />
      )}
    </ToolPageWrapper>
  );
}
