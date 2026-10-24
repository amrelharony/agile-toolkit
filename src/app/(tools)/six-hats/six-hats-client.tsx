"use client";

import { useMemo, useRef, useState } from "react";
import { useShallow } from "zustand/react/shallow";
import { Brain, Pencil, Plus, Sparkles, Trash2 } from "lucide-react";
import { ToolPageWrapper } from "@/components/layout/tool-page-wrapper";
import { useAnnounce } from "@/components/a11y/live-announcer";
import { SectionCard } from "@/components/shared/section-card";
import { AiPromptGenerator } from "@/components/shared/ai-prompt-generator";
import { EmptyState } from "@/components/shared/empty-state";
import { ExportButton } from "@/components/shared/export-button";
import { Button } from "@/components/ui/button";
import { Field } from "@/components/ui/field";
import { IconButton } from "@/components/ui/icon-button";
import {
  ExampleNotice,
  LoadExampleButton,
  hasExampleItems,
  isExampleId,
} from "@/components/tool-frame/example-data";
import { useWorkspaceStore } from "@/lib/stores/workspace-store";
import type {
  HandoffLink,
  SixHatsHat,
  SixHatsSession,
  SixHatsThought,
  Workspace,
} from "@/lib/stores/workspace-types";
import { generateSixHatsPrompts } from "@/lib/ai-prompts/six-hats";
import { liveLink } from "@/lib/handoffs/registry";
import { useHistoryLogger } from "@/lib/history/use-history-logger";
import { SIX_HATS_ACTIONS } from "@/lib/history/event-actions";
import { plural } from "@/lib/charts/chart-text";
import { claimDock, useDockTimer } from "@/lib/timer/dock-timer";
import { formatDate } from "@/lib/utils/formatters";
import { undoable } from "@/lib/utils/undoable";
import { buildExample } from "./example";
import { hatInfo, hatName } from "./hats";
import { toMarkdown } from "./markdown";
import { RoundsCard, useRoundClock } from "./rounds-card";
import {
  DEFAULT_ORDER,
  byHat,
  closed,
  currentHat,
  currentIndex,
  earlierThoughts,
  editedSession,
  hasSummary,
  isLastRound,
  isRoundClock,
  newSession,
  nextRound,
  pickSession,
  prevRound,
  reopened,
  roundDock,
  roundLabel,
  sameSessionValues,
  sessionStatus,
  sessionThoughts,
  sortSessions,
  type SessionValues,
} from "./session";
import { SessionForm } from "./session-form";
import { SummaryCard, type SummaryCardHandle } from "./summary-card";
import { ThoughtColumns, shortText } from "./thought-columns";
import { ThoughtForm, type ThoughtValues } from "./thought-form";
import { EarlierThoughts } from "./earlier-thoughts";
import { sixHatsVerdict } from "./verdict";

const NO_SESSIONS: SixHatsSession[] = [];
const NO_THOUGHTS: SixHatsThought[] = [];

/**
 * The minutes per round for earlier thoughts given a topic: the default the
 * agents' start_session uses. Those rounds are long over, so it only shows.
 */
const ADOPTED_ROUND_MINUTES = 5;

const ws = () => useWorkspaceStore.getState();
const freshSession = (id: string) => (ws().sixHatsSessions ?? []).find((x) => x.id === id);
const freshThought = (id: string) => (ws().sixHatsThoughts ?? []).find((t) => t.id === id);

/** Focus a control that appears after this render (the old one went with the change). */
function focusSoon(selector: string) {
  window.setTimeout(() => document.querySelector<HTMLElement>(selector)?.focus(), 0);
}

const STATUS_TEXT = {
  "not-started": "not started",
  "in-round": "in progress",
  closed: "closed",
} as const;

export function SixHatsClient() {
  const sessions = useWorkspaceStore((s) => s.sixHatsSessions ?? NO_SESSIONS);
  const thoughts = useWorkspaceStore((s) => s.sixHatsThoughts ?? NO_THOUGHTS);
  const upsertSession = useWorkspaceStore((s) => s.upsertSixHatsSession);
  const removeSession = useWorkspaceStore((s) => s.removeSixHatsSession);
  const upsertThought = useWorkspaceStore((s) => s.upsertSixHatsThought);
  const removeThought = useWorkspaceStore((s) => s.removeSixHatsThought);
  const { log } = useHistoryLogger("six-hats");
  const announce = useAnnounce();
  const exportRef = useRef<HTMLDivElement>(null);
  const summaryRef = useRef<SummaryCardHandle>(null);

  const [pickedId, setPickedId] = useState<string | null>(null);
  const [mode, setMode] = useState<"view" | "new" | "edit">("view");

  const session = pickSession(sessions, pickedId);
  const sessionId = session?.id ?? null;
  const sorted = useMemo(() => sortSessions(sessions), [sessions]);
  const own = useMemo(
    () => (sessionId ? sessionThoughts(thoughts, sessionId) : NO_THOUGHTS),
    [thoughts, sessionId]
  );
  const earlier = useMemo(() => earlierThoughts(thoughts, sessions), [thoughts, sessions]);
  const hat = session ? currentHat(session) : undefined;
  const decision = session ? liveLink(session.sentTo, "decision") : undefined;
  const firstRun = sessions.length === 0;

  /* ── Sessions ── */

  function start(values: SessionValues) {
    const s = newSession(values, crypto.randomUUID(), new Date().toISOString());
    upsertSession(s);
    setPickedId(s.id);
    setMode("view");
    log(SIX_HATS_ACTIONS.SESSION_STARTED, { id: s.id, rounds: s.order.length });
    announce(`Session started: ${s.topic}. Start round 1 when the team is ready.`);
    focusSoon('[data-focus="start-round"]');
  }

  function saveEdit(values: SessionValues) {
    setMode("view");
    const cur = sessionId ? freshSession(sessionId) : undefined;
    if (!cur || sameSessionValues(cur, values)) return;
    upsertSession(editedSession(cur, values));
    announce("Session saved.");
  }

  function remove(s: SixHatsSession) {
    const cur = freshSession(s.id) ?? s;
    const mine = (ws().sixHatsThoughts ?? []).filter((t) => t.sessionId === cur.id);
    undoable({
      label: `Deleted “${shortText(cur.topic)}”`,
      description: mine.length > 0 ? `and its ${plural(mine.length, "thought")}` : undefined,
      apply: () => {
        stopClockOf(cur);
        // The store keeps a removed session's thoughts; these go with it.
        mine.forEach((t) => removeThought(t.id));
        removeSession(cur.id);
        log(SIX_HATS_ACTIONS.SESSION_REMOVED, { id: cur.id, thoughts: mine.length });
      },
      revert: () => {
        upsertSession(cur);
        mine.forEach(upsertThought);
      },
    });
    setPickedId(null);
    setMode("view");
    focusSoon('[data-focus="new-session"]');
  }

  /* ── Rounds ── */

  /** Put the round's clock on the dock, unless another page's timer is there (it says so). */
  function timeRound(s: SixHatsSession) {
    const dock = roundDock(s);
    if (!dock) return;
    const claimed = claimDock(dock);
    if (!claimed.ok) {
      announce(`The docked timer is running “${claimed.holder.label}”, so this round isn't timed.`);
    }
  }

  function stopClockOf(s: SixHatsSession) {
    const dock = useDockTimer.getState();
    if (isRoundClock(dock.timer, s)) dock.stop();
  }

  /** Move to `next` (a later or earlier round), time it, and say where the session is. */
  function goTo(next: SixHatsSession, said: string) {
    upsertSession(next);
    timeRound(next);
    const i = currentIndex(next);
    if (i === null) return;
    const minutes = plural(next.roundMinutes, "minute");
    announce(`${said}${roundLabel(next, i)}. ${minutes}.`);
    // The Next and Skip buttons give way to "Write the summary" on the last round.
    if (isLastRound(next)) focusSoon('[data-focus="to-summary"]');
  }

  function startRounds() {
    const cur = sessionId ? freshSession(sessionId) : undefined;
    if (!cur || sessionStatus(cur) !== "not-started") return;
    const next = nextRound(cur);
    goTo(next, "");
    log(SIX_HATS_ACTIONS.ROUND_ADVANCED, { id: cur.id, round: 1, hat: next.order[0] });
    focusSoon('[data-focus="next-hat"], [data-focus="to-summary"]');
  }

  function advance(skipped: boolean) {
    const cur = sessionId ? freshSession(sessionId) : undefined;
    const i = cur ? currentIndex(cur) : null;
    if (!cur || i === null || isLastRound(cur)) return;
    const next = nextRound(cur);
    goTo(next, skipped ? `Skipped the ${hatName(cur.order[i])}. ` : "");
    log(SIX_HATS_ACTIONS.ROUND_ADVANCED, {
      id: cur.id,
      round: i + 2,
      hat: next.order[i + 1],
      skipped,
    });
  }

  function back() {
    const cur = sessionId ? freshSession(sessionId) : undefined;
    if (!cur) return;
    const next = prevRound(cur);
    if (next !== cur) goTo(next, "Back to ");
  }

  function timeCurrent() {
    const cur = sessionId ? freshSession(sessionId) : undefined;
    if (cur) timeRound(cur);
  }

  /** The user chose to stop the other page's timer: never done without asking. */
  function replaceDock() {
    const cur = sessionId ? freshSession(sessionId) : undefined;
    const dock = cur ? roundDock(cur) : null;
    if (!cur || !dock) return;
    useDockTimer.getState().publish(dock);
    announce(`Timing ${roundLabel(cur, currentIndex(cur) ?? 0)}.`);
  }

  function close() {
    const cur = sessionId ? freshSession(sessionId) : undefined;
    if (!cur || cur.closedAt || !hasSummary(cur)) return;
    stopClockOf(cur);
    upsertSession(closed(cur, new Date().toISOString()));
    log(SIX_HATS_ACTIONS.SESSION_CLOSED, {
      id: cur.id,
      thoughts: sessionThoughts(ws().sixHatsThoughts ?? [], cur.id).length,
    });
    announce(`Session closed: ${cur.topic}.`);
    focusSoon('[data-focus="reopen"]');
  }

  function reopen() {
    const cur = sessionId ? freshSession(sessionId) : undefined;
    if (!cur?.closedAt) return;
    upsertSession(reopened(cur));
    announce("Session reopened, back in the last round.");
  }

  function saveSummary(summary: string) {
    const cur = sessionId ? freshSession(sessionId) : undefined;
    if (!cur) return;
    upsertSession({ ...cur, summary });
    log(SIX_HATS_ACTIONS.SUMMARY_SAVED, { id: cur.id });
    announce("Summary saved.");
  }

  function setLinks(update: (links: readonly HandoffLink[] | undefined) => HandoffLink[]) {
    const cur = sessionId ? freshSession(sessionId) : undefined;
    if (cur) upsertSession({ ...cur, sentTo: update(cur.sentTo) });
  }

  /* ── Thoughts ── */

  function addThought(v: ThoughtValues) {
    if (!sessionId) return;
    upsertThought({
      id: crypto.randomUUID(),
      hat: v.hat,
      text: v.text,
      loggedAt: new Date().toISOString(),
      sessionId,
    });
    // The signal bridge emits sixHats.thoughtLogged for every new thought.
    log(SIX_HATS_ACTIONS.THOUGHT_ADDED, { hat: v.hat });
    announce(`Logged under the ${hatName(v.hat)}.`);
  }

  function editThought(t: SixHatsThought, text: string) {
    const cur = freshThought(t.id) ?? t;
    if (cur.text !== text) upsertThought({ ...cur, text });
  }

  function moveThought(t: SixHatsThought, to: SixHatsHat) {
    const cur = freshThought(t.id) ?? t;
    if (cur.hat === to) return;
    upsertThought({ ...cur, hat: to });
    log(SIX_HATS_ACTIONS.HAT_CHANGED, { id: cur.id, from: cur.hat, to });
    announce(`Moved “${shortText(cur.text)}” to the ${hatName(to)}.`);
  }

  function deleteThought(t: SixHatsThought) {
    const cur = freshThought(t.id) ?? t;
    // Undo brings the thought back; a canvas card linked to it stays
    // unlinked (the store strips those links on remove).
    undoable({
      label: `Deleted “${shortText(cur.text)}”`,
      apply: () => {
        removeThought(cur.id);
        log(SIX_HATS_ACTIONS.THOUGHT_REMOVED, { id: cur.id });
      },
      revert: () => upsertThought(cur),
    });
  }

  /** Earlier thoughts become a session of their own; Undo takes them back out. */
  function adopt(topic: string) {
    const list = earlierThoughts(ws().sixHatsThoughts ?? [], ws().sixHatsSessions ?? []);
    if (list.length === 0) return;
    const s: SixHatsSession = {
      id: crypto.randomUUID(),
      topic,
      order: [...DEFAULT_ORDER],
      roundMinutes: ADOPTED_ROUND_MINUTES,
      // Dated when the discussion happened, so it sorts with its own time.
      startedAt: list[0].loggedAt,
    };
    undoable({
      label: `Made “${shortText(topic)}” a session`,
      description: plural(list.length, "earlier thought"),
      apply: () => {
        upsertSession(s);
        list.forEach((t) => upsertThought({ ...t, sessionId: s.id }));
        log(SIX_HATS_ACTIONS.SESSION_STARTED, { id: s.id, earlierThoughts: list.length });
      },
      revert: () => {
        removeSession(s.id);
        list.forEach(upsertThought);
      },
    });
    setPickedId(s.id);
  }

  /* ── Example ── */

  const loadExample = () => {
    const ex = buildExample();
    upsertSession(ex.session);
    ex.thoughts.forEach(upsertThought);
    setPickedId(ex.session.id);
    setMode("view");
  };

  const clearExample = () => {
    const exSessions = (ws().sixHatsSessions ?? []).filter((x) => isExampleId(x.id));
    const exThoughts = (ws().sixHatsThoughts ?? []).filter((t) => isExampleId(t.id));
    undoable({
      label: "Cleared the example",
      apply: () => {
        exThoughts.forEach((t) => removeThought(t.id));
        exSessions.forEach((x) => {
          stopClockOf(x);
          removeSession(x.id);
        });
      },
      revert: () => {
        exSessions.forEach(upsertSession);
        exThoughts.forEach(upsertThought);
      },
    });
  };

  /* ── Exports ── */

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
        sixHatsThoughts: s.sixHatsThoughts,
      })
    )
  );

  const promptConfig = useMemo(
    () => ({
      toolName: "Six Thinking Hats",
      prompts: generateSixHatsPrompts({ grouped: byHat(session ? own : earlier) }, workspace),
    }),
    [session, own, earlier, workspace]
  );

  const csvData = {
    headers: ["Topic", "Hat", "Thought", "Logged"],
    rows: own.map((t) => [session?.topic ?? "", hatInfo(t.hat).name, t.text, t.loggedAt]),
  };

  return (
    <ToolPageWrapper
      toolId="six-hats"
      title="Six Thinking Hats"
      description="De Bono's parallel thinking: the whole group looks at one topic through one hat at a time (facts, feelings, risks, benefits, new ideas, process) in timed rounds, then the Blue hat sums up."
    >
      <div ref={exportRef} className="space-y-4">
        {(hasExampleItems(sessions) || hasExampleItems(thoughts)) && (
          <ExampleNotice onClear={clearExample} />
        )}

        {(firstRun || mode === "new") && (
          <SectionCard title="Start a session" icon={Plus}>
            <SessionForm
              autoFocus={!firstRun}
              onSave={start}
              onCancel={firstRun ? undefined : () => setMode("view")}
            />
          </SectionCard>
        )}

        {session && (
          <>
            <SectionCard
              title="Session"
              icon={Brain}
              actions={
                mode !== "new" && (
                  <Button
                    type="button"
                    size="sm"
                    variant="outline"
                    className="gap-1"
                    data-focus="new-session"
                    onClick={() => setMode("new")}
                  >
                    <Plus className="h-4 w-4" aria-hidden="true" />
                    New session
                  </Button>
                )
              }
            >
              {sorted.length > 1 && (
                <Field label="Open a session" className="mb-3 max-w-md">
                  {(props) => (
                    <select
                      {...props}
                      className="flex h-11 w-full rounded-md border border-input bg-background px-3 py-1 text-base text-text shadow-sm focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring md:h-9 md:text-sm"
                      value={session.id}
                      onChange={(e) => {
                        setPickedId(e.target.value);
                        setMode((m) => (m === "edit" ? "view" : m));
                      }}
                    >
                      {sorted.map((x) => (
                        <option key={x.id} value={x.id}>
                          {`${shortText(x.topic, 60)} · ${formatDate(x.startedAt)} · ${STATUS_TEXT[sessionStatus(x)]}`}
                        </option>
                      ))}
                    </select>
                  )}
                </Field>
              )}
              {mode === "edit" ? (
                <SessionForm
                  key={session.id}
                  session={session}
                  autoFocus
                  onSave={saveEdit}
                  onCancel={() => setMode("view")}
                />
              ) : (
                <>
                  <div className="flex items-start gap-1">
                    <h2 className="min-w-0 flex-1 break-words text-lg font-medium text-text">
                      {session.topic}
                    </h2>
                    <IconButton
                      label={`Edit session “${shortText(session.topic)}”`}
                      icon={<Pencil className="h-4 w-4" />}
                      className="text-sub hover:text-text"
                      onClick={() => setMode("edit")}
                    />
                    <IconButton
                      label={`Delete session “${shortText(session.topic)}”`}
                      icon={<Trash2 className="h-4 w-4" />}
                      className="text-sub hover:text-danger"
                      onClick={() => remove(session)}
                    />
                  </div>
                  <p className="text-xs text-sub">
                    Started {formatDate(session.startedAt)} · {plural(own.length, "thought")} ·{" "}
                    {STATUS_TEXT[sessionStatus(session)]}
                  </p>
                  <SessionVerdict session={session} thoughts={own} sent={Boolean(decision)} />
                </>
              )}
            </SectionCard>

            <RoundsCard
              session={session}
              onStart={startRounds}
              onNext={advance}
              onBack={back}
              onTime={timeCurrent}
              onReplaceDock={replaceDock}
              onReopen={reopen}
              onToSummary={() => summaryRef.current?.focus()}
            />

            {!session.closedAt && (
              <SectionCard title="Add a thought" icon={Plus}>
                <ThoughtForm key={session.id} currentHat={hat} onAdd={addThought} />
              </SectionCard>
            )}

            <SectionCard
              title={`Thoughts (${own.length})`}
              icon={Sparkles}
              actions={
                <>
                  <AiPromptGenerator config={promptConfig} />
                  <ExportButton
                    filename="six-hats"
                    csvData={csvData}
                    jsonData={{ session, thoughts: own }}
                    markdown={toMarkdown(session, own, { decision })}
                    targetRef={exportRef}
                  />
                </>
              }
            >
              <ThoughtColumns
                order={session.order}
                thoughts={own}
                currentHat={hat}
                onEdit={editThought}
                onMove={moveThought}
                onRemove={deleteThought}
              />
            </SectionCard>

            <SummaryCard
              key={session.id}
              ref={summaryRef}
              session={session}
              example={isExampleId(session.id)}
              onSave={saveSummary}
              onClose={close}
              onLinksChange={setLinks}
              getLinks={() => freshSession(session.id)?.sentTo}
            />
          </>
        )}

        {earlier.length > 0 && (
          <EarlierThoughts
            thoughts={earlier}
            exportRef={exportRef}
            onAdopt={adopt}
            onEdit={editThought}
            onMove={moveThought}
            onRemove={deleteThought}
          />
        )}

        {firstRun && earlier.length === 0 && (
          <EmptyState
            icon={Brain}
            action={<LoadExampleButton onLoad={loadExample} className="mt-4" />}
          >
            No sessions yet. Start one above on a question the team keeps talking past each other
            on, or load an example to see a finished session.
          </EmptyState>
        )}
      </div>
    </ToolPageWrapper>
  );
}

/** The one-sentence answer, with the round's time left while a round is timed. */
function SessionVerdict({
  session,
  thoughts,
  sent,
}: {
  session: SixHatsSession;
  thoughts: readonly SixHatsThought[];
  sent: boolean;
}) {
  const clock = useRoundClock(session);
  return (
    <p className="mt-2 text-sm font-medium text-text">
      {sixHatsVerdict(session, thoughts, { remainingSeconds: clock.remaining, sent })}
    </p>
  );
}
