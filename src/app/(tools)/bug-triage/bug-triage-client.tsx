"use client";

/**
 * Bug Triage: log bugs in a line, triage the oldest first with five quick
 * checks, place each on a severity × priority grid, then fix now (an
 * interrupt in the running sprint), plan it (a backlog story tagged bug) or
 * close it with a reason. All bugs shows each one's age, its fix-by target
 * and where it went, and a bug whose work is done offers "Close as fixed".
 * Amr, or the rules without AI, suggests severities and duplicates to accept
 * one by one.
 *
 * Everything lives in workspace.bugReports, which the agent verbs and the
 * next step read too. Where a bug went is read from the stories and
 * interrupts it was sent to (lib/bug-triage/model `linkState`), never
 * stored twice. The example's bugs live in the workspace with example ids,
 * are never sent, and aren't counted while the team has its own.
 */

import { useCallback, useMemo, useRef, useState } from "react";
import { nanoid } from "nanoid";
import { BugPlay, Grid3x3, ListChecks, Table2 } from "lucide-react";
import { useAnnounce } from "@/components/a11y/live-announcer";
import { ToolPageWrapper } from "@/components/layout/tool-page-wrapper";
import { AiPromptGenerator } from "@/components/shared/ai-prompt-generator";
import { EmptyState } from "@/components/shared/empty-state";
import { ExportButton } from "@/components/shared/export-button";
import { KpiGrid } from "@/components/shared/kpi-grid";
import { OnSearchParams, dropSearchParam } from "@/components/shared/on-search-params";
import { SectionCard } from "@/components/shared/section-card";
import { StatCard } from "@/components/shared/stat-card";
import { Button } from "@/components/ui/button";
import {
  ExampleNotice,
  LoadExampleButton,
  hasExampleItems,
  isExampleId,
} from "@/components/tool-frame/example-data";
import { generateBugTriagePrompts } from "@/lib/ai-prompts/bug-triage";
import { cheer } from "@/lib/celebrate/cheer";
import { sendHandoff, type HandoffLinkStore } from "@/lib/handoffs/send";
import { activeSprintOf } from "@/lib/handoffs/targets/interrupt";
import { BUG_TRIAGE_ACTIONS } from "@/lib/history/event-actions";
import { useHistoryLogger } from "@/lib/history/use-history-logger";
import { todayIso } from "@/lib/sprints/series";
import { useWorkspaceStore } from "@/lib/stores/workspace-store";
import type { BugCloseReason, BugReport, InterruptItem } from "@/lib/stores/workspace-types";
import { useWorkspaceHydrated } from "@/lib/team/use-team-roster";
import { undoable } from "@/lib/utils/undoable";
import {
  CELL_ADVICE,
  CLOSE_REASON_LABEL,
  PRIORITY_LABEL,
  ROUTE_PLACE,
  SEVERITY_LABEL,
  bugSource,
  cellOf,
  closeBug,
  countedBugs,
  bugCounts,
  duplicateHints,
  gridCounts,
  mismatched,
  needsTriage,
  newBug,
  oldestFirst,
  readBugs,
  reopenBug,
  triageBug,
  triageQueue,
  workDone,
  type BugLinkSlices,
  type BugRoute,
  type BugValues,
} from "@/lib/bug-triage/model";
import { AllBugs } from "./all-bugs";
import { BugDetail, EXAMPLE_NOT_SENT, NO_SPRINT, SendButtons, type BugActions } from "./bug-detail";
import { BugGrid, type GridCell } from "./bug-grid";
import { buildExample } from "./example";
import { LogForm } from "./log-form";
import { bugsCsv, toMarkdown } from "./markdown";
import { currentBugs, findBug, patchBug, removeBug, saveBug } from "./store";
import { TriageQueue, type KeptSuggestion } from "./triage-queue";
import type { Placement } from "./triage-form";

export const TOOL_ID = "bug-triage";

const NO_INTERRUPTS: InterruptItem[] = [];
const nowIso = () => new Date().toISOString();

const short = (t: string, max = 40) => (t.length > max ? `${t.slice(0, max - 1).trimEnd()}…` : t);

const placeText = (p: Placement) => `${SEVERITY_LABEL[p.severity]} × ${PRIORITY_LABEL[p.priority]}`;

export function BugTriageClient() {
  const hydrated = useWorkspaceHydrated();
  const raw = useWorkspaceStore((s) => s.bugReports);
  const stories = useWorkspaceStore((s) => s.stories);
  const interrupts = useWorkspaceStore((s) => s.interruptItems) ?? NO_INTERRUPTS;
  const sprints = useWorkspaceStore((s) => s.sprints);
  const { log } = useHistoryLogger(TOOL_ID);
  const announce = useAnnounce();
  const [today] = useState(() => todayIso());
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [cell, setCell] = useState<GridCell | null>(null);
  const logRef = useRef<HTMLInputElement>(null);
  const detailHeading = useRef<HTMLHeadingElement | null>(null);
  /** Bugs placed since the queue last emptied: the triage_done payload. */
  const placedInSitting = useRef(0);

  const bugs = useMemo(() => oldestFirst(readBugs(raw)), [raw]);
  const slices: BugLinkSlices = useMemo(() => ({ stories, interrupts }), [stories, interrupts]);
  const sprintRunning = Boolean(activeSprintOf(sprints));
  const queue = useMemo(() => triageQueue(bugs), [bugs]);
  const hints = useMemo(() => duplicateHints(bugs), [bugs]);
  const counted = useMemo(() => countedBugs(bugs), [bugs]);
  const counts = bugCounts(counted, today);
  const grid = useMemo(() => gridCounts(bugs), [bugs]);
  const hasExample = hasExampleItems(bugs);
  const exampleOnly = bugs.length > 0 && bugs.every((b) => isExampleId(b.id));
  const selected = selectedId ? bugs.find((b) => b.id === selectedId) : undefined;
  const cellBugs = cell
    ? bugs.filter((b) => {
        const c = cellOf(b);
        return c?.severity === cell.severity && c.priority === cell.priority;
      })
    : [];

  const markdown = useMemo(
    () => toMarkdown({ bugs: counted, slices, today }),
    [counted, slices, today]
  );
  const csv = useMemo(() => bugsCsv(counted, slices, today), [counted, slices, today]);
  const promptConfig = useMemo(
    () => ({ toolName: "Bug Triage", prompts: generateBugTriagePrompts(counted, today) }),
    [counted, today]
  );

  /* ── Changes ──────────────────────────────────────────────────────── */

  // The example's bugs aren't the team's history.
  const record = (bug: Pick<BugReport, "id">, action: string, payload: Record<string, unknown>) => {
    if (!isExampleId(bug.id)) log(action, payload);
  };

  const openBug = useCallback((id: string) => {
    setSelectedId(id);
    requestAnimationFrame(() => detailHeading.current?.focus());
  }, []);

  /** Amr's cheer and the milestone when the team's last waiting bug is placed, in one tick. */
  const afterPlace = (bug: Pick<BugReport, "id">) => {
    if (isExampleId(bug.id)) return;
    placedInSitting.current += 1;
    const left = triageQueue(readBugs(currentBugs())).filter((b) => !isExampleId(b.id));
    if (left.length === 0) {
      log(BUG_TRIAGE_ACTIONS.TRIAGE_DONE, { count: placedInSitting.current });
      cheer(TOOL_ID, "done");
      placedInSitting.current = 0;
      announce("Nothing left to triage.");
    }
  };

  const logBug = (values: BugValues) => {
    const bug = saveBug(newBug(values, `bug_${nanoid(8)}`, nowIso()));
    record(bug, BUG_TRIAGE_ACTIONS.BUG_LOGGED, { bugId: bug.id });
    announce(`Logged “${short(bug.title)}”. It waits in the triage queue.`);
    logRef.current?.focus();
  };

  const place = (bug: BugReport, placed: Placement) => {
    const prev = findBug(bug.id);
    if (!prev) return;
    // From the queue it is triaged; a bug already on the grid only moves.
    const waiting = needsTriage(prev);
    saveBug(triageBug(prev, placed, nowIso()));
    record(bug, waiting ? BUG_TRIAGE_ACTIONS.BUG_TRIAGED : BUG_TRIAGE_ACTIONS.BUG_UPDATED, {
      bugId: bug.id,
      severity: placed.severity,
      priority: placed.priority,
    });
    announce(
      `${waiting ? "Placed" : "Moved"} “${short(bug.title)}” ${waiting ? "at" : "to"} ${placeText(placed)}. ${CELL_ADVICE[placed.severity][placed.priority]}.`
    );
    if (waiting) afterPlace(bug);
  };

  /** An accepted suggestion: placed as Amr (or the rules) said, with Undo. */
  const acceptSuggestion = (s: KeptSuggestion) => {
    const prev = findBug(s.id);
    // Only a bug still waiting takes a suggestion (it may have been placed since).
    if (!prev || !needsTriage(prev)) return;
    const placed = { severity: s.severity, priority: s.priority };
    undoable({
      label: `Placed “${short(prev.title)}” at ${placeText(placed)}`,
      kind: "success",
      apply: () => saveBug(triageBug(prev, { ...placed, checks: prev.checks }, nowIso())),
      revert: () => saveBug(prev),
    });
    record(prev, BUG_TRIAGE_ACTIONS.BUG_TRIAGED, {
      bugId: prev.id,
      ...placed,
      source: "suggestion",
    });
    afterPlace(prev);
  };

  const linkStore = (id: string): HandoffLinkStore => ({
    getLinks: () => findBug(id)?.sentTo,
    setLinks: (update) => {
      patchBug(id, (b) => ({ ...b, sentTo: update(b.sentTo), updatedAt: nowIso() }));
    },
  });

  const send = (bug: BugReport, route: BugRoute) => {
    if (isExampleId(bug.id)) {
      announce(EXAMPLE_NOT_SENT);
      return;
    }
    const current = findBug(bug.id);
    if (!current) return;
    const link = sendHandoff(route, bugSource(current), linkStore(bug.id));
    if (!link) {
      announce(
        route === "interrupt" && !activeSprintOf(useWorkspaceStore.getState().sprints)
          ? NO_SPRINT
          : `“${short(bug.title)}” is already on ${ROUTE_PLACE[route]}.`
      );
      return;
    }
    record(bug, BUG_TRIAGE_ACTIONS.BUG_SENT, { bugId: bug.id, route });
    announce(`Sent “${short(bug.title)}” to ${ROUTE_PLACE[route]}.`);
  };

  const close = (bug: BugReport, reason: BugCloseReason, duplicateOf?: string) => {
    const prev = findBug(bug.id);
    if (!prev) return;
    const label = `Closed “${short(prev.title)}” as ${CLOSE_REASON_LABEL[reason].toLowerCase()}`;
    undoable({
      label,
      apply: () => saveBug(closeBug(prev, reason, nowIso(), duplicateOf)),
      revert: () => saveBug(prev),
    });
    record(bug, BUG_TRIAGE_ACTIONS.BUG_CLOSED, { bugId: bug.id, reason });
    announce(label);
  };

  const reopen = (bug: BugReport) => {
    const prev = findBug(bug.id);
    if (!prev) return;
    const next = saveBug(reopenBug(prev, nowIso()));
    record(bug, BUG_TRIAGE_ACTIONS.BUG_REOPENED, { bugId: bug.id });
    announce(
      next.status === "triaged"
        ? `Reopened “${short(bug.title)}”: back on the grid.`
        : `Reopened “${short(bug.title)}”: back in the triage queue.`
    );
  };

  const edit = (bug: BugReport, values: BugValues) => {
    const changed = patchBug(bug.id, (b) => {
      const {
        steps: _s,
        expected: _e,
        actual: _a,
        environment: _v,
        area: _r,
        reportedBy: _p,
        ...rest
      } = b;
      void [_s, _e, _a, _v, _r, _p];
      return { ...rest, ...values, updatedAt: nowIso() };
    });
    if (!changed) return;
    record(bug, BUG_TRIAGE_ACTIONS.BUG_UPDATED, { bugId: bug.id });
    announce(`Saved “${short(values.title)}”.`);
  };

  const remove = (bug: BugReport) => {
    let snapshot: BugReport | null = null;
    const label = `Deleted “${short(bug.title)}”`;
    undoable({
      label,
      apply: () => {
        snapshot = removeBug(bug.id);
      },
      revert: () => {
        if (snapshot) saveBug(snapshot);
      },
    });
    record(bug, BUG_TRIAGE_ACTIONS.BUG_REMOVED, { bugId: bug.id });
    if (selectedId === bug.id) setSelectedId(null);
    announce(label);
    logRef.current?.focus();
  };

  const actions: BugActions = { send, close, reopen, remove, place, edit, open: openBug };

  // Loading is offered on an empty page only, and neither it nor its clearing
  // is logged: the example isn't the team's work.
  const loadExample = () => buildExample(new Date()).forEach(saveBug);
  const clearExample = () => {
    let removed: BugReport[] = [];
    undoable({
      label: "Cleared the example",
      apply: () => {
        removed = currentBugs()
          .filter((b) => isExampleId(b.id))
          .map((b) => removeBug(b.id))
          .filter((b): b is BugReport => b !== null);
      },
      revert: () => removed.forEach(saveBug),
    });
    if (selectedId && isExampleId(selectedId)) setSelectedId(null);
    setCell(null);
    logRef.current?.focus();
  };

  /* ── The page ─────────────────────────────────────────────────────── */

  return (
    <ToolPageWrapper
      toolId="bug-triage"
      title="Bug Triage"
      description="Sort new bugs by how bad and how soon, then decide each one."
    >
      <OnSearchParams
        onChange={(q) => {
          const id = q.get("bug");
          if (!id) return;
          openBug(id);
          dropSearchParam("bug");
        }}
      />
      {!hydrated ? (
        <p
          role="status"
          className="rounded-lg border border-border bg-card px-4 py-10 text-center text-sm text-sub"
        >
          Loading the bugs…
        </p>
      ) : (
        <div className="space-y-4">
          {hasExample && (
            <div>
              <ExampleNotice onClear={clearExample} />
              <p className="-mt-2 text-xs text-sub">
                Example: bugs from a shop&apos;s checkout. They are never sent to other tools
                {exampleOnly ? "" : ", and they aren't counted while you have your own"}.
              </p>
            </div>
          )}

          {bugs.length > 0 && (
            <div className="flex flex-wrap items-center justify-end gap-2">
              <AiPromptGenerator config={promptConfig} />
              <ExportButton
                filename={`bug-triage-${today}`}
                markdown={markdown}
                clipboardText={markdown}
                csvData={csv}
                jsonData={counted}
              />
            </div>
          )}

          <SectionCard title="Log a bug" icon={BugPlay}>
            <LogForm ref={logRef} onSave={logBug} offerAddToRoster={!exampleOnly} />
          </SectionCard>

          {selectedId && !selected && hydrated && (
            <p role="status" className="rounded-lg border border-border px-4 py-3 text-sm text-sub">
              That bug isn&apos;t here any more.{" "}
              <Button type="button" size="sm" variant="ghost" onClick={() => setSelectedId(null)}>
                Dismiss
              </Button>
            </p>
          )}

          {bugs.length === 0 ? (
            <EmptyState icon={BugPlay} action={<LoadExampleButton onLoad={loadExample} />}>
              No bugs yet. Log one above in a line: it waits here to be triaged, then goes to the
              sprint, the backlog or gets closed.
            </EmptyState>
          ) : (
            <>
              <KpiGrid cols={4} marginBottom="none">
                <StatCard
                  variant="compact"
                  label="To triage"
                  value={counts.toTriage}
                  hint="Waiting"
                />
                <StatCard
                  variant="compact"
                  label="On the grid"
                  value={counts.onGrid}
                  hint="Open and placed"
                />
                <StatCard
                  variant="compact"
                  label="Over target"
                  value={counts.overTarget}
                  hint="Past their fix-by day"
                />
                <StatCard
                  variant="compact"
                  label="Closed"
                  value={counts.closed}
                  hint="With a reason"
                />
              </KpiGrid>

              {selected && (
                <BugDetail
                  key={selected.id}
                  bug={selected}
                  bugs={bugs}
                  slices={slices}
                  today={today}
                  sprintRunning={sprintRunning}
                  actions={actions}
                  onDismiss={() => {
                    setSelectedId(null);
                    logRef.current?.focus();
                  }}
                  headingRef={(el) => {
                    detailHeading.current = el;
                  }}
                />
              )}

              <SectionCard title={`To triage (${queue.length})`} icon={ListChecks}>
                <TriageQueue
                  queue={queue}
                  bugs={bugs}
                  today={today}
                  hints={hints}
                  onPlace={place}
                  onAccept={acceptSuggestion}
                  onDuplicate={(bug, of) => close(bug, "duplicate", of)}
                  onOpen={openBug}
                />
              </SectionCard>

              <SectionCard title="The grid" icon={Grid3x3}>
                <div className="space-y-3">
                  <p className="text-xs text-sub">
                    Rows are how bad (severity), columns how soon (priority). Tap a cell for its
                    bugs.
                  </p>
                  <BugGrid counts={grid} selected={cell} onSelect={setCell} />
                  {cell && (
                    <div className="space-y-2" data-testid="cell-bugs">
                      <p className="text-sm text-text">
                        <span className="font-semibold">
                          {SEVERITY_LABEL[cell.severity]} × {PRIORITY_LABEL[cell.priority]}
                          {mismatched(cell.severity, cell.priority) && (
                            <span className="text-warning"> · Check</span>
                          )}
                          :
                        </span>{" "}
                        {CELL_ADVICE[cell.severity][cell.priority]}.
                      </p>
                      {cellBugs.length === 0 ? (
                        <p className="text-sm text-sub">No open bugs here.</p>
                      ) : (
                        <ul className="divide-y divide-border rounded-lg border border-border">
                          {cellBugs.map((b) => (
                            <li key={b.id} className="space-y-2 px-3 py-2" data-cell-bug={b.id}>
                              <button
                                type="button"
                                className="break-words text-left text-sm font-medium text-text hover:text-accent hover:underline"
                                onClick={() => openBug(b.id)}
                              >
                                {b.title}
                              </button>
                              {workDone(b, slices) ? (
                                <div className="flex flex-wrap items-center gap-2">
                                  <span className="text-sm text-sub">Fixed? Its work is done.</span>
                                  <Button
                                    type="button"
                                    size="sm"
                                    variant="outline"
                                    onClick={() => close(b, "fixed")}
                                  >
                                    Close as fixed
                                  </Button>
                                </div>
                              ) : cell.priority === "someday" ? (
                                <Button
                                  type="button"
                                  size="sm"
                                  variant="outline"
                                  onClick={() => openBug(b.id)}
                                >
                                  Close with a reason
                                </Button>
                              ) : (
                                <SendButtons
                                  bug={b}
                                  slices={slices}
                                  sprintRunning={sprintRunning}
                                  onSend={(route) => send(b, route)}
                                />
                              )}
                            </li>
                          ))}
                        </ul>
                      )}
                    </div>
                  )}
                </div>
              </SectionCard>

              <SectionCard title="All bugs" icon={Table2}>
                <AllBugs bugs={bugs} slices={slices} today={today} onOpen={openBug} />
              </SectionCard>
            </>
          )}
        </div>
      )}
    </ToolPageWrapper>
  );
}
