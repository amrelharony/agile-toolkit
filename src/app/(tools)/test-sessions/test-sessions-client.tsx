"use client";

/**
 * Test Sessions: exploratory testing in timed sessions. Plan one from a
 * charter (what to look at, using what, to learn what), start it to claim
 * the docked timer, note what you find in one line each (a note, a bug, a
 * question or an idea, stamped with its minutes in), end it, then debrief:
 * how much was covered, where the time went and what's next. Bug notes go to
 * Bug Triage, one at a time or all together with one Undo; a question or an
 * idea becomes the next session's charter. Amr, or the ten lenses without
 * AI, suggests charters.
 *
 * Everything lives in workspace.testSessions, which the agent verbs and the
 * next step read too. One session runs at a time, because the dock holds one
 * clock; the running session is found from its status, never the URL. The
 * example's sessions live in the workspace with example ids, never claim
 * the dock and never send.
 */

import { useMemo, useRef, useState } from "react";
import { nanoid } from "nanoid";
import { CalendarClock, CheckCircle2, ScanEye, Timer } from "lucide-react";
import { useAnnounce } from "@/components/a11y/live-announcer";
import { ToolPageWrapper } from "@/components/layout/tool-page-wrapper";
import { AiPromptGenerator } from "@/components/shared/ai-prompt-generator";
import { EmptyState } from "@/components/shared/empty-state";
import { ExportButton } from "@/components/shared/export-button";
import { OnSearchParams, dropSearchParam } from "@/components/shared/on-search-params";
import { SectionCard } from "@/components/shared/section-card";
import { Button } from "@/components/ui/button";
import {
  ExampleNotice,
  LoadExampleButton,
  hasExampleItems,
  isExampleId,
} from "@/components/tool-frame/example-data";
import type { CharterSuggestion } from "@/lib/ai/tasks/test-sessions.lite";
import { generateTestSessionsPrompts } from "@/lib/ai-prompts/test-sessions";
import { cheer } from "@/lib/celebrate/cheer";
import { sendHandoffBatch, type HandoffLinkStore } from "@/lib/handoffs/send";
import { TEST_SESSIONS_ACTIONS } from "@/lib/history/event-actions";
import { useHistoryLogger } from "@/lib/history/use-history-logger";
import { todayIso } from "@/lib/sprints/series";
import { useSelectedSprint } from "@/lib/sprints/use-selected-sprint";
import { useWorkspaceStore } from "@/lib/stores/workspace-store";
import type {
  BugReport,
  Story,
  TestNoteKind,
  TestSession,
  TestSessionNote,
} from "@/lib/stores/workspace-types";
import { useWorkspaceHydrated } from "@/lib/team/use-team-roster";
import { undoable } from "@/lib/utils/undoable";
import {
  NOTE_KIND_LABEL,
  bugLinkOf,
  charterSentence,
  followUpFrom,
  minutesInText,
  minutesRan,
  nearestLength,
  newNote,
  newSession,
  noteToBug,
  pastAreas,
  readSessions,
  runningSession,
  type CharterDraft,
  type CharterValues,
} from "@/lib/test-sessions/model";
import { buildExample } from "./example";
import { sessionsCsv, toMarkdown } from "./markdown";
import { PlanForm } from "./plan-form";
import { SessionCard, type DebriefValues, type SessionActions } from "./session-card";
import {
  currentSessions,
  findSession,
  patchNote,
  patchSession,
  removeSession,
  saveSession,
} from "./store";
import {
  claimSessionTimer,
  dockBusyText,
  secondsLeft,
  startSessionTimer,
  stopSessionTimer,
} from "./timer";

export const TOOL_ID = "test-sessions";

const NO_BUGS: BugReport[] = [];
/** The stories a session can test: in progress, in review or done in the sprint. */
const TESTABLE: ReadonlySet<Story["status"]> = new Set<Story["status"]>([
  "in_progress",
  "review",
  "done",
]);

const nowIso = () => new Date().toISOString();
const short = (t: string, max = 40) => (t.length > max ? `${t.slice(0, max - 1).trimEnd()}…` : t);

export function TestSessionsClient() {
  const hydrated = useWorkspaceHydrated();
  const raw = useWorkspaceStore((s) => s.testSessions);
  const bugs = useWorkspaceStore((s) => s.bugReports) ?? NO_BUGS;
  const allStories = useWorkspaceStore((s) => s.stories);
  const { selected: sprint } = useSelectedSprint();
  const { log } = useHistoryLogger(TOOL_ID);
  const announce = useAnnounce();
  const [today] = useState(() => todayIso());
  const [problem, setProblem] = useState<{ id: string; text: string } | null>(null);
  const [focusId, setFocusId] = useState<string | null>(null);
  const planRef = useRef<HTMLInputElement>(null);
  const headings = useRef(new Map<string, HTMLHeadingElement>());

  const sessions = useMemo(() => readSessions(raw), [raw]);
  const running = sessions.filter((s) => s.status === "running");
  const planned = sessions.filter((s) => s.status === "planned");
  const done = sessions.filter((s) => s.status === "done");
  const own = useMemo(() => sessions.filter((s) => !isExampleId(s.id)), [sessions]);
  const counted = own.length > 0 ? own : sessions;
  const hasExample = hasExampleItems(sessions);
  const exampleOnly = sessions.length > 0 && own.length === 0;
  /** A ?session= link (or a bug's "From test sessions") names a session that is gone. */
  const focusMissing = Boolean(focusId) && !sessions.some((s) => s.id === focusId);
  const stories = useMemo(
    () =>
      sprint ? allStories.filter((s) => s.sprintId === sprint.id && TESTABLE.has(s.status)) : [],
    [allStories, sprint]
  );
  const storyTitles = useMemo(() => new Map(allStories.map((s) => [s.id, s.title])), [allStories]);
  const areas = useMemo(() => pastAreas(sessions), [sessions]);
  const past = useMemo(() => own.slice(0, 20).map((s) => charterSentence(s.charter)), [own]);

  const markdown = useMemo(
    () => toMarkdown({ sessions: counted, stories: allStories, bugs, today }),
    [counted, allStories, bugs, today]
  );
  const csv = useMemo(() => sessionsCsv(counted), [counted]);
  const promptConfig = useMemo(
    () => ({ toolName: "Test Sessions", prompts: generateTestSessionsPrompts(counted) }),
    [counted]
  );

  /* ── Changes ──────────────────────────────────────────────────────── */

  // The example's sessions aren't the team's history.
  const record = (s: Pick<TestSession, "id">, action: string, payload: Record<string, unknown>) => {
    if (!isExampleId(s.id)) log(action, payload);
  };

  const focusSession = (id: string) => {
    setFocusId(id);
    requestAnimationFrame(() => headings.current.get(id)?.focus());
  };

  const plan = (values: CharterValues) => {
    const s = saveSession(newSession(values, `tsess_${nanoid(8)}`, nowIso()));
    record(s, TEST_SESSIONS_ACTIONS.SESSION_PLANNED, {
      sessionId: s.id,
      minutes: s.minutes,
      ...(s.storyId ? { storyId: s.storyId } : {}),
    });
    announce(`Planned “${short(s.charter.target)}”.`);
    planRef.current?.focus();
  };

  /** An accepted charter: a planned session with what the form holds, with Undo. */
  const acceptCharter = (c: CharterSuggestion, draft: CharterDraft) => {
    const line = (v: string) => v.replace(/\s+/g, " ").trim();
    const s = newSession(
      {
        charter: { target: line(c.target), using: line(c.using), toLearn: c.toLearn.trim() },
        minutes: nearestLength(c.minutes),
        ...(line(draft.tester) ? { tester: line(draft.tester) } : {}),
        ...(draft.storyId ? { storyId: draft.storyId } : {}),
        ...(line(draft.area) ? { area: line(draft.area) } : {}),
      },
      `tsess_${nanoid(8)}`,
      nowIso()
    );
    undoable({
      label: `Planned “${short(s.charter.target)}”`,
      kind: "success",
      apply: () => saveSession(s),
      revert: () => removeSession(s.id),
    });
    record(s, TEST_SESSIONS_ACTIONS.SESSION_PLANNED, {
      sessionId: s.id,
      minutes: s.minutes,
      source: "suggestion",
    });
  };

  const start = (session: TestSession) => {
    if (isExampleId(session.id)) return;
    const other = runningSession(readSessions(currentSessions()).filter((s) => !isExampleId(s.id)));
    if (other && other.id !== session.id) {
      setProblem({
        id: session.id,
        text: `End “${short(other.charter.target)}” first: one session runs at a time.`,
      });
      return;
    }
    const claimed = startSessionTimer(session);
    if (!claimed.ok) {
      setProblem({ id: session.id, text: dockBusyText(claimed.holder) });
      return;
    }
    setProblem(null);
    patchSession(session.id, (s) => ({ ...s, status: "running", startedAt: nowIso() }));
    record(session, TEST_SESSIONS_ACTIONS.SESSION_STARTED, { sessionId: session.id });
    announce(
      `Started “${short(session.charter.target)}”: ${session.minutes} minutes on the timer.`
    );
    focusSession(session.id);
  };

  const restart = (session: TestSession) => {
    const claimed = claimSessionTimer(session, secondsLeft(session));
    if (!claimed.ok) {
      setProblem({ id: session.id, text: dockBusyText(claimed.holder) });
      return;
    }
    setProblem(null);
    announce("The timer is back on.");
  };

  const end = (session: TestSession) => {
    const endedAt = nowIso();
    if (!patchSession(session.id, (s) => ({ ...s, status: "done", endedAt }))) return;
    if (!isExampleId(session.id)) stopSessionTimer();
    setProblem(null);
    const s = findSession(session.id);
    record(session, TEST_SESSIONS_ACTIONS.SESSION_ENDED, {
      sessionId: session.id,
      minutes: s ? minutesRan(s) : null,
      notes: s?.notes.length ?? 0,
    });
    announce(`Ended “${short(session.charter.target)}”. Debrief it below.`);
    focusSession(session.id);
  };

  const addNote = (session: TestSession, kind: TestNoteKind, text: string) => {
    const note = newNote(kind, text, `tnote_${nanoid(8)}`, nowIso());
    if (!patchSession(session.id, (s) => ({ ...s, notes: [...s.notes, note] }))) return;
    record(session, TEST_SESSIONS_ACTIONS.NOTE_ADDED, { sessionId: session.id, kind });
    const when = minutesInText(note, session);
    announce(`${NOTE_KIND_LABEL[kind]} noted${when ? `, ${when}` : ""}.`);
  };

  const debrief = (session: TestSession, v: DebriefValues) => {
    const first = !findSession(session.id)?.coverage;
    patchSession(session.id, (s) => {
      const { split: _split, debrief: _debrief, ...rest } = s;
      void _split;
      void _debrief;
      return {
        ...rest,
        coverage: v.coverage,
        ...(v.split ? { split: v.split } : {}),
        ...(v.debrief ? { debrief: v.debrief } : {}),
      };
    });
    if (first && !isExampleId(session.id)) {
      log(TEST_SESSIONS_ACTIONS.SESSION_DEBRIEFED, {
        sessionId: session.id,
        coverage: v.coverage,
        split: v.split,
      });
      cheer(TOOL_ID, "done");
    }
    announce("Debrief saved.");
    // The form, and its Save button with it, gives way to the debrief.
    headings.current.get(session.id)?.focus();
  };

  const remove = (session: TestSession) => {
    let snapshot: TestSession | null = null;
    const label = `Deleted “${short(session.charter.target)}”`;
    if (session.status === "running" && !isExampleId(session.id)) stopSessionTimer();
    undoable({
      label,
      apply: () => {
        snapshot = removeSession(session.id);
      },
      revert: () => {
        if (snapshot) saveSession(snapshot);
      },
    });
    record(session, TEST_SESSIONS_ACTIONS.SESSION_REMOVED, { sessionId: session.id });
    // A session deleted here isn't a link to one that's gone.
    setFocusId((id) => (id === session.id ? null : id));
    announce(label);
    planRef.current?.focus();
  };

  const followUp = (session: TestSession, note: TestSessionNote) => {
    // A follow-up of an example stays in the example.
    const prefix = isExampleId(session.id) ? "example-" : "";
    const s = newSession(
      {
        charter: followUpFrom(note, session),
        minutes: session.minutes,
        ...(session.tester ? { tester: session.tester } : {}),
        ...(session.storyId ? { storyId: session.storyId } : {}),
        ...(session.area ? { area: session.area } : {}),
      },
      `${prefix}tsess_${nanoid(8)}`,
      nowIso()
    );
    undoable({
      label: `Planned a follow-up: “${short(s.charter.target)}”`,
      kind: "success",
      apply: () => saveSession(s),
      revert: () => removeSession(s.id),
    });
    record(s, TEST_SESSIONS_ACTIONS.SESSION_PLANNED, {
      sessionId: s.id,
      minutes: s.minutes,
      source: "follow-up",
    });
  };

  const freshLinks = (session: TestSession, note: TestSessionNote) =>
    findSession(session.id)?.notes.find((n) => n.id === note.id)?.sentTo;

  const linkStore = (sessionId: string, noteId: string): HandoffLinkStore => ({
    getLinks: () => findSession(sessionId)?.notes.find((n) => n.id === noteId)?.sentTo,
    setLinks: (update) => {
      patchNote(sessionId, noteId, (n) => ({ ...n, sentTo: update(n.sentTo) }));
    },
  });

  /** "Send to…" on one bug note: the send logs bugs_sent once, its Undo nothing. */
  const noteLinks: SessionActions["noteLinks"] = (session, note, update) => {
    const before = bugLinkOf({ sentTo: freshLinks(session, note) });
    patchNote(session.id, note.id, (n) => ({ ...n, sentTo: update(n.sentTo) }));
    const after = bugLinkOf({ sentTo: freshLinks(session, note) });
    if (after && after.targetId !== before?.targetId) {
      record(session, TEST_SESSIONS_ACTIONS.BUGS_SENT, { sessionId: session.id, count: 1 });
    }
  };

  const sendAll = (session: TestSession, notes: TestSessionNote[]) => {
    if (isExampleId(session.id)) return;
    const sent = sendHandoffBatch(
      "bug",
      notes.map((n) => ({ src: noteToBug(n, session), links: linkStore(session.id, n.id) })),
      notes.length === 1
        ? "Logged the bug in Bug Triage"
        : `Logged ${notes.length} bugs in Bug Triage`
    );
    if (sent.length === 0) return;
    record(session, TEST_SESSIONS_ACTIONS.BUGS_SENT, { sessionId: session.id, count: sent.length });
    announce(
      sent.length === 1
        ? "Logged 1 bug in Bug Triage."
        : `Logged ${sent.length} bugs in Bug Triage.`
    );
    // With every bug sent, the button that sent them goes.
    headings.current.get(session.id)?.focus();
  };

  const actions: SessionActions = {
    start,
    restart,
    end,
    addNote,
    debrief,
    remove,
    followUp,
    sendAll,
    noteLinks,
    freshLinks,
  };

  // Loading is offered on an empty page only, and neither it nor its
  // clearing is logged: the example isn't the team's work.
  const loadExample = () => buildExample(new Date()).forEach(saveSession);
  const clearExample = () => {
    let removed: TestSession[] = [];
    undoable({
      label: "Cleared the example",
      apply: () => {
        removed = currentSessions()
          .filter((s) => isExampleId(s.id))
          .map((s) => removeSession(s.id))
          .filter((s): s is TestSession => s !== null);
      },
      revert: () => removed.forEach(saveSession),
    });
    setFocusId((id) => (id && isExampleId(id) ? null : id));
    planRef.current?.focus();
  };

  const card = (s: TestSession) => (
    <SessionCard
      key={s.id}
      session={s}
      storyTitle={s.storyId ? storyTitles.get(s.storyId) : undefined}
      bugs={bugs}
      actions={actions}
      startProblem={problem?.id === s.id ? problem.text : null}
      highlighted={focusId === s.id}
      headingRef={(el) => {
        if (el) headings.current.set(s.id, el);
        else headings.current.delete(s.id);
      }}
    />
  );

  return (
    <ToolPageWrapper
      toolId="test-sessions"
      title="Test Sessions"
      description="Explore in timed sessions from a charter, note what you find, then debrief."
    >
      <OnSearchParams
        onChange={(q) => {
          const id = q.get("session");
          if (!id) return;
          focusSession(id);
          dropSearchParam("session");
        }}
      />
      {!hydrated ? (
        <p
          role="status"
          className="rounded-lg border border-border bg-card px-4 py-10 text-center text-sm text-sub"
        >
          Loading the sessions…
        </p>
      ) : (
        <div className="space-y-4">
          {focusMissing && (
            <p role="status" className="rounded-lg border border-border px-4 py-3 text-sm text-sub">
              That session isn&apos;t here any more.{" "}
              <Button
                type="button"
                size="sm"
                variant="ghost"
                onClick={() => {
                  setFocusId(null);
                  planRef.current?.focus();
                }}
              >
                Dismiss
              </Button>
            </p>
          )}

          {hasExample && (
            <div>
              <ExampleNotice onClear={clearExample} />
              <p className="-mt-2 text-xs text-sub">
                Example: three sessions on saved addresses at checkout. They never start the timer
                or send bugs{exampleOnly ? "" : ", and they aren't counted while you have your own"}
                .
              </p>
            </div>
          )}

          {sessions.length > 0 && (
            <div className="flex flex-wrap items-center justify-end gap-2">
              <AiPromptGenerator config={promptConfig} />
              <ExportButton
                filename={`test-sessions-${today}`}
                markdown={markdown}
                clipboardText={markdown}
                csvData={csv}
                jsonData={counted}
              />
            </div>
          )}

          {running.length > 0 && (
            <SectionCard title="Running now" icon={Timer}>
              <div className="space-y-3">{running.map(card)}</div>
            </SectionCard>
          )}

          <SectionCard title="Plan a session" icon={ScanEye}>
            <PlanForm
              ref={planRef}
              stories={stories}
              areas={areas}
              past={past}
              onSave={plan}
              onAccept={acceptCharter}
              offerAddToRoster={!exampleOnly}
            />
          </SectionCard>

          {sessions.length === 0 ? (
            <EmptyState icon={ScanEye} action={<LoadExampleButton onLoad={loadExample} />}>
              No sessions yet. Plan one above from a charter: what to look at, using what, and what
              you want to learn. Then start it and note what you find.
            </EmptyState>
          ) : (
            <>
              {planned.length > 0 && (
                <SectionCard title={`Planned (${planned.length})`} icon={CalendarClock}>
                  <div className="space-y-3">{planned.map(card)}</div>
                </SectionCard>
              )}
              {done.length > 0 && (
                <SectionCard title={`Done (${done.length})`} icon={CheckCircle2}>
                  <div className="space-y-3">{done.map(card)}</div>
                </SectionCard>
              )}
            </>
          )}
        </div>
      )}
    </ToolPageWrapper>
  );
}
