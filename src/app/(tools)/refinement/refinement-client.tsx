"use client";

import { useMemo, useRef, useState } from "react";
import Link from "next/link";
import { useShallow } from "zustand/react/shallow";
import { ArrowRight, CheckCircle2, ClipboardCheck, Dices, History, ListChecks } from "lucide-react";
import { ToolPageWrapper } from "@/components/layout/tool-page-wrapper";
import { AiPromptGenerator } from "@/components/shared/ai-prompt-generator";
import { EmptyState } from "@/components/shared/empty-state";
import { ExportButton } from "@/components/shared/export-button";
import { ResetButton } from "@/components/shared/reset-button";
import { SectionCard } from "@/components/shared/section-card";
import { Button } from "@/components/ui/button";
import {
  ExampleNotice,
  LoadExampleButton,
  isExampleId,
} from "@/components/tool-frame/example-data";
import { generateRefinementPrompts } from "@/lib/ai-prompts/refinement";
import { liveLink } from "@/lib/handoffs/registry";
import { sendHandoff } from "@/lib/handoffs/send";
import { POKER_LOG_ID } from "@/lib/handoffs/targets/poker-queue";
import { REFINEMENT_ACTIONS } from "@/lib/history/event-actions";
import { useHistoryLogger } from "@/lib/history/use-history-logger";
import { useWorkspaceStore } from "@/lib/stores/workspace-store";
import type { Story } from "@/lib/stores/workspace-types";
import { useWorkspaceHydrated } from "@/lib/team/use-team-roster";
import { cn } from "@/lib/utils";
import { removeWithUndo, undoable } from "@/lib/utils/undoable";
import { PassRateAdvanced } from "./advanced";
import { CriteriaList } from "./criteria-list";
import { EarlierChecks } from "./earlier-checks";
import { buildExample } from "./example";
import { toMarkdown } from "./markdown";
import { queueAllForPoker, queueForPoker, queuedStoryIds } from "./poker";
import {
  isReady,
  isRefinementCandidate,
  isUnsized,
  metCriteria,
  passRateRecords,
  readinessState,
  refinementSession,
  withReadiness,
} from "./session";
import { ReadyList, StoryCheckPanel, StoryQueue } from "./session-panel";
import {
  DEFAULT_CRITERIA,
  checkCounts,
  useRefinementStore,
  type CheckValues,
  type Criterion,
  type RefinementStore,
  type StorySave,
} from "./store";
import { refinementVerdict } from "./verdict";

type ResetSnapshot = Pick<
  RefinementStore,
  "criteria" | "history" | "storyName" | "storyDescription" | "currentChecks"
>;

/** A story as it is now: example stories live in this tool's store, the rest in the workspace. */
function findStory(id: string): Story | undefined {
  return isExampleId(id)
    ? useRefinementStore.getState().exampleStories.find((s) => s.id === id)
    : useWorkspaceStore.getState().stories.find((s) => s.id === id);
}

function putStory(story: Story): void {
  if (isExampleId(story.id)) useRefinementStore.getState().putExampleStory(story);
  else useWorkspaceStore.getState().upsertStory(story);
}

const STATUS_LABEL = {
  ready: "Ready",
  partial: "Partial",
  "not-ready": "Not ready",
  unchecked: "Not checked",
} as const;

export function RefinementClient() {
  const hydrated = useWorkspaceHydrated();
  const stories = useWorkspaceStore((s) => s.stories);
  const sprints = useWorkspaceStore((s) => s.sprints);
  const pokerLogs = useWorkspaceStore((s) => s.pokerEstimationLogs);
  const { criteria, history, exampleStories } = useRefinementStore(
    useShallow((s) => ({
      criteria: s.criteria,
      history: s.history,
      exampleStories: s.exampleStories,
    }))
  );
  const { log } = useHistoryLogger("refinement");
  const exportRef = useRef<HTMLDivElement>(null);

  const all = useMemo(() => [...stories, ...exampleStories], [stories, exampleStories]);
  const session = useMemo(() => refinementSession(all), [all]);
  const queued = useMemo(
    () => queuedStoryIds((pokerLogs ?? []).find((d) => d.id === POKER_LOG_ID)),
    [pokerLogs]
  );
  const sprintNames = useMemo(() => new Map(sprints.map((s) => [s.id, s.name])), [sprints]);
  const records = useMemo(() => passRateRecords(all, history, criteria), [all, history, criteria]);

  /* ── The walk ─────────────────────────────────────────────────────── */

  const [unsizedFilter, setUnsizedFilter] = useState(false);
  // Once the last unsized story has points the filter (and its toggle) goes.
  const onlyUnsized = unsizedFilter && session.unsized > 0;
  const walk = useMemo(
    () => (onlyUnsized ? session.toRefine.filter(isUnsized) : session.toRefine),
    [onlyUnsized, session.toRefine]
  );
  const [focusId, setFocusId] = useState<string | null>(null);
  // After the first move the panel takes focus when it changes story, so a
  // keyboard user lands on the next story's name, not back at the top.
  const [walking, setWalking] = useState(false);
  const picked = focusId ? all.find((s) => s.id === focusId) : undefined;
  const focused =
    picked &&
    isRefinementCandidate(picked) &&
    (walk.some((s) => s.id === picked.id) || isReady(picked))
      ? picked
      : (walk[0] ?? null);
  const index = focused ? walk.findIndex((s) => s.id === focused.id) : -1;

  const go = (id: string | null) => {
    setWalking(true);
    setFocusId(id);
  };

  /** Write a story's readiness, with Undo back to what it had before. */
  function saveReadiness(story: Story, checked: string[], ready: boolean) {
    const current = findStory(story.id);
    if (!current) return;
    const before = current.readiness;
    const { metCount, totalCriteria } = checkCounts(checked, criteria);
    undoable({
      label: ready ? `Marked “${current.title}” ready` : `Saved the checks on “${current.title}”`,
      description: `${metCount} of ${totalCriteria} criteria met`,
      apply: () => putStory(withReadiness(current, checked, ready)),
      // Only the readiness goes back: points estimated meanwhile stay.
      revert: () => {
        const now = findStory(current.id);
        if (!now) return;
        const restored: Story = { ...now };
        if (before) restored.readiness = before;
        else delete restored.readiness;
        putStory(restored);
      },
    });
    if (!isExampleId(current.id)) {
      log(REFINEMENT_ACTIONS.STORY_UPDATED, {
        storyId: current.id,
        ready,
        metCount,
        totalCriteria,
      });
    }
  }

  function markReady(story: Story, checked: string[]) {
    const i = walk.findIndex((s) => s.id === story.id);
    // It leaves the list: go on to the one after it (or before, at the end).
    const next = i >= 0 ? (walk[i + 1] ?? walk[i - 1] ?? null) : null;
    saveReadiness(story, checked, true);
    go(next?.id ?? null);
  }

  function saveChecks(story: Story, checked: string[]) {
    const i = walk.findIndex((s) => s.id === story.id);
    saveReadiness(story, checked, false);
    const next = i >= 0 ? walk[i + 1] : undefined;
    if (next) go(next.id);
  }

  function queue(story: Story) {
    if (isExampleId(story.id)) return;
    if (queueForPoker(story))
      log(REFINEMENT_ACTIONS.STORY_UPDATED, { storyId: story.id, queued: true });
  }

  const unsizedToQueue = session.toRefine.filter(
    (s) => isUnsized(s) && !isExampleId(s.id) && !queued.has(s.id)
  );
  const queuedHere = session.toRefine.filter((s) => queued.has(s.id)).length;
  const readyOwn = session.ready.filter((s) => !isExampleId(s.id)).length;

  /* ── Criteria ─────────────────────────────────────────────────────── */

  const addCriterion = (label: string, description?: string) =>
    useRefinementStore.getState().addCriterion(label, description);

  const editCriterion = (id: string, label: string, description: string) => {
    const s = useRefinementStore.getState();
    s.setCriterion(id, label);
    s.setCriterionDescription(id, description);
  };

  const removeCriterion = (c: Criterion) =>
    removeWithUndo<Criterion>({
      label: `Deleted “${c.label}”`,
      description: "Stories checked against it keep their ticks.",
      update: useRefinementStore.getState().updateCriteria,
      match: (x) => x.id === c.id,
    });

  /* ── Checks by name ───────────────────────────────────────────────── */

  const addCheck = (values: CheckValues) => {
    const save = useRefinementStore.getState().addCheck(values);
    log(REFINEMENT_ACTIONS.STORY_ADDED, { storyName: save.storyName });
  };

  const editCheck = (id: string, values: Pick<StorySave, "storyName" | "description" | "date">) => {
    useRefinementStore.getState().editCheck(id, values);
    log(REFINEMENT_ACTIONS.STORY_UPDATED, { checkId: id });
  };

  const removeCheck = (h: StorySave) => {
    removeWithUndo<StorySave>({
      label: `Deleted the check on “${h.storyName}”`,
      update: useRefinementStore.getState().updateHistory,
      match: (x) => x.id === h.id,
    });
    log(REFINEMENT_ACTIONS.STORY_REMOVED, { checkId: h.id });
  };

  // Undo puts the cleared checks back below any saved since.
  const clearChecks = () => {
    const cleared = useRefinementStore.getState().history;
    if (cleared.length === 0) return;
    undoable({
      label: `Cleared ${cleared.length} earlier ${cleared.length === 1 ? "check" : "checks"}`,
      apply: useRefinementStore.getState().clearHistory,
      revert: () =>
        useRefinementStore.setState((s) => {
          const kept = new Set(s.history.map((h) => h.id));
          return { history: [...s.history, ...cleared.filter((h) => !kept.has(h.id))] };
        }),
    });
  };

  const addToBacklog = (h: StorySave) =>
    sendHandoff(
      "backlog-story",
      {
        title: h.storyName,
        description: h.description,
        sourceRef: { tool: "refinement", id: h.id },
      },
      {
        getLinks: () => useRefinementStore.getState().history.find((x) => x.id === h.id)?.sentTo,
        setLinks: (update) => useRefinementStore.getState().setCheckLinks(h.id, update),
      }
    );

  const backlogStoryOf = (h: StorySave) => liveLink(h.sentTo, "backlog-story")?.targetId ?? null;

  /* ── Reset and example ────────────────────────────────────────────── */

  const snapshot = useRef<ResetSnapshot | null>(null);
  const pristine =
    history.length === 0 && JSON.stringify(criteria) === JSON.stringify(DEFAULT_CRITERIA);

  const loadExample = () => {
    useRefinementStore.getState().setExampleStories(buildExample(criteria));
    setFocusId(null);
  };
  const clearExample = () => {
    useRefinementStore.getState().setExampleStories([]);
    setFocusId(null);
  };

  /* ── Exports ──────────────────────────────────────────────────────── */

  const markdown = useMemo(
    () => toMarkdown(session, criteria, history),
    [session, criteria, history]
  );

  const csvData = useMemo(() => {
    const storyRows = [...session.toRefine, ...session.ready].map((s) => {
      const met = s.readiness ? metCriteria(s.readiness.checked, criteria).length : 0;
      const pct =
        criteria.length > 0 && s.readiness ? Math.round((met / criteria.length) * 100) : "";
      return [
        s.title,
        "Backlog",
        isUnsized(s) ? "" : (s.points ?? ""),
        s.readiness ? met : "",
        criteria.length,
        pct,
        STATUS_LABEL[readinessState(s, criteria)],
        s.readiness?.updatedAt.slice(0, 10) ?? "",
      ];
    });
    const checkRows = history.map((h) => [
      h.storyName,
      "Checked by name",
      "",
      h.metCount,
      h.totalCriteria,
      h.passRate,
      h.passRate === 100 ? "Ready" : h.passRate > 0 ? "Partial" : "Not ready",
      h.date,
    ]);
    return {
      headers: [
        "Story",
        "Source",
        "Points",
        "Criteria met",
        "Total criteria",
        "% ready",
        "Status",
        "Checked on",
      ],
      rows: [...storyRows, ...checkRows],
    };
  }, [session, criteria, history]);

  const promptConfig = useMemo(() => {
    const byName = history.map((h) => ({
      storyName: h.storyName,
      passRate: h.passRate,
      checks: Object.fromEntries((h.checks ?? []).map((c) => [c.criterionId, c.checked])),
    }));
    const byStory = all
      .filter((s) => s.readiness)
      .map((s) => {
        const checked = s.readiness?.checked ?? [];
        const ticked = new Set(checked);
        return {
          storyName: s.title,
          passRate: checkCounts(checked, criteria).passRate,
          checks: Object.fromEntries(criteria.map((c) => [c.id, ticked.has(c.id)])),
        };
      });
    return {
      toolName: "Refinement Checklist",
      prompts: generateRefinementPrompts({ criteria, history: [...byStory, ...byName] }),
    };
  }, [all, criteria, history]);

  /* ── Page ─────────────────────────────────────────────────────────── */

  return (
    <ToolPageWrapper
      toolId="refinement"
      title="Refinement Checklist"
      description="Walk the backlog stories that aren't ready yet: tick the Definition of Ready, queue unsized ones for Planning Poker, and mark them ready for Sprint Planning."
      category="Ceremonies"
    >
      <div ref={exportRef} className="space-y-6">
        {exampleStories.length > 0 && <ExampleNotice onClear={clearExample} />}

        <SectionCard
          title="Backlog readiness"
          icon={ClipboardCheck}
          actions={
            <>
              <AiPromptGenerator config={promptConfig} />
              <ExportButton
                filename="refinement-session"
                csvData={csvData}
                markdown={markdown}
                targetRef={exportRef}
              />
              <ResetButton
                label="Reset checklist"
                title="Reset the refinement checklist?"
                description={`The ${criteria.length} criteria go back to the ${DEFAULT_CRITERIA.length} defaults and ${history.length} earlier ${history.length === 1 ? "check is" : "checks are"} removed. Readiness saved on backlog stories stays.`}
                confirmLabel="Reset checklist"
                doneLabel="Reset the refinement checklist"
                disabled={pristine}
                onReset={() => {
                  const s = useRefinementStore.getState();
                  snapshot.current = {
                    criteria: s.criteria,
                    history: s.history,
                    storyName: s.storyName,
                    storyDescription: s.storyDescription,
                    currentChecks: s.currentChecks,
                  };
                  s.reset();
                  log(REFINEMENT_ACTIONS.REFINEMENT_RESET, {});
                }}
                onUndo={() => {
                  if (snapshot.current) useRefinementStore.setState(snapshot.current);
                }}
              />
            </>
          }
        >
          {hydrated || session.total > 0 ? (
            <p className="text-sm font-medium text-text">{refinementVerdict(session)}</p>
          ) : (
            <p className="text-sm text-sub">Loading the backlog…</p>
          )}
          {(unsizedToQueue.length > 0 || queuedHere > 0 || readyOwn > 0) && (
            <div className="mt-3 flex flex-wrap items-center gap-x-4 gap-y-2">
              {unsizedToQueue.length > 0 && (
                <Button
                  type="button"
                  variant="outline"
                  size="sm"
                  className="gap-1.5"
                  onClick={() => queueAllForPoker(unsizedToQueue)}
                >
                  <Dices aria-hidden="true" />
                  Queue {unsizedToQueue.length} unsized for Planning Poker
                </Button>
              )}
              {queuedHere > 0 && (
                <Link href="/planning-poker" className={LINK}>
                  Open Planning Poker ({queuedHere} queued)
                  <ArrowRight className="h-4 w-4" aria-hidden="true" />
                </Link>
              )}
              {readyOwn > 0 && (
                <Link href="/sprint-planning" className={LINK}>
                  Plan the sprint with the ready stories
                  <ArrowRight className="h-4 w-4" aria-hidden="true" />
                </Link>
              )}
            </div>
          )}
        </SectionCard>

        <div className="grid grid-cols-1 gap-6 lg:grid-cols-[minmax(0,1fr)_380px]">
          <div className="min-w-0 space-y-6">
            {session.total === 0 ? (
              hydrated && (
                <EmptyState icon={ListChecks} action={<LoadExampleButton onLoad={loadExample} />}>
                  The session lists the backlog stories that aren&rsquo;t ready. Add stories in
                  Sprint Planning or send them to the backlog from another tool, or load an example
                  to see one.
                </EmptyState>
              )
            ) : (
              <SectionCard
                title="Refinement session"
                icon={ListChecks}
                titleSuffix={`(${session.toRefine.length} to refine)`}
                contentClassName="space-y-4"
              >
                {session.unsized > 0 && (
                  <div role="group" aria-label="Which stories" className="flex flex-wrap gap-2">
                    <Button
                      type="button"
                      size="sm"
                      variant={onlyUnsized ? "outline" : "toolkit"}
                      aria-pressed={!onlyUnsized}
                      onClick={() => {
                        setUnsizedFilter(false);
                        setFocusId(null);
                      }}
                    >
                      All to refine ({session.toRefine.length})
                    </Button>
                    <Button
                      type="button"
                      size="sm"
                      variant={onlyUnsized ? "toolkit" : "outline"}
                      aria-pressed={onlyUnsized}
                      onClick={() => {
                        setUnsizedFilter(true);
                        setFocusId(null);
                      }}
                    >
                      Needs points ({session.unsized})
                    </Button>
                  </div>
                )}

                {focused ? (
                  <StoryCheckPanel
                    key={focused.id}
                    story={focused}
                    criteria={criteria}
                    position={index >= 0 ? { index, count: walk.length } : null}
                    sprintName={focused.sprintId ? sprintNames.get(focused.sprintId) : undefined}
                    queued={queued.has(focused.id)}
                    example={isExampleId(focused.id)}
                    autoFocus={walking}
                    onSaveChecks={(checked) => saveChecks(focused, checked)}
                    onMarkReady={(checked) => markReady(focused, checked)}
                    onQueue={() => queue(focused)}
                    onPrevious={() => index > 0 && go(walk[index - 1].id)}
                    onNext={() => index < walk.length - 1 && go(walk[index + 1].id)}
                  />
                ) : (
                  <p className="text-sm text-sub">
                    Every backlog story is ready. Re-check one below, or plan the sprint with them.
                  </p>
                )}

                {walk.length > 0 && (
                  <div>
                    <h3 className="mb-2 text-sm font-medium text-text">
                      {onlyUnsized ? "Stories that need points" : "Stories to refine"}
                    </h3>
                    <StoryQueue
                      stories={walk}
                      criteria={criteria}
                      focusId={focused?.id ?? null}
                      queued={queued}
                      sprintNames={sprintNames}
                      onSelect={go}
                    />
                  </div>
                )}
              </SectionCard>
            )}

            {session.ready.length > 0 && (
              <SectionCard
                title="Ready"
                icon={CheckCircle2}
                iconClassName="text-accent-green"
                titleSuffix={`(${session.ready.length})`}
              >
                <ReadyList stories={session.ready} criteria={criteria} onRecheck={go} />
              </SectionCard>
            )}
          </div>

          <div className="min-w-0 space-y-6">
            <SectionCard title="Definition of Ready" icon={ListChecks}>
              <CriteriaList
                criteria={criteria}
                onAdd={addCriterion}
                onEdit={editCriterion}
                onRemove={removeCriterion}
              />
            </SectionCard>
            <SectionCard
              title="Earlier checks"
              icon={History}
              titleSuffix={history.length > 0 ? `(${history.length})` : undefined}
            >
              <EarlierChecks
                history={history}
                criteria={criteria}
                onAdd={addCheck}
                onEdit={editCheck}
                onRemove={removeCheck}
                onClear={clearChecks}
                onAddToBacklog={addToBacklog}
                backlogStoryOf={backlogStoryOf}
              />
            </SectionCard>
          </div>
        </div>

        <PassRateAdvanced records={records} />
      </div>
    </ToolPageWrapper>
  );
}

const LINK = cn(
  "inline-flex min-h-9 items-center gap-1.5 text-sm font-medium text-accent",
  "underline-offset-2 hover:underline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent"
);
