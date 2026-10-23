"use client";

import { useState, useRef, useMemo } from "react";
import { useWorkspaceStore } from "@/lib/stores/workspace-store";
import { useSelectedSprint } from "@/lib/sprints/use-selected-sprint";
import { updateSprint } from "@/lib/sprints/store";
import type { Okr, SprintGoal, Story } from "@/lib/stores/workspace-types";
import { motion, AnimatePresence } from "framer-motion";
import { ToolPageWrapper } from "@/components/layout/tool-page-wrapper";
import { ExportButton } from "@/components/shared/export-button";
import { AiPromptGenerator } from "@/components/shared/ai-prompt-generator";
import { ConfirmDialog } from "@/components/shared/confirm-dialog";
import { EmptyState } from "@/components/shared/empty-state";
import { generateSprintGoalPrompts } from "@/lib/ai-prompts/sprint-goal";
import { useHistoryLogger } from "@/lib/history/use-history-logger";
import { SPRINT_GOAL_ACTIONS } from "@/lib/history/event-actions";
import { undoable } from "@/lib/utils/undoable";
import { ExampleNotice, LoadExampleButton } from "@/components/tool-frame/example-data";
import { selectEvents } from "@/lib/history/selectors";
import { useHistoryStore } from "@/lib/history/history-store";
import { CalloutAlert } from "@/components/shared/callout-alert";
import { Tabs, TabsList, TabsTrigger, TabsContent } from "@/components/ui/tabs";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { BlurTextarea } from "@/components/shared/blur-fields";
import {
  ChevronRight,
  ChevronLeft,
  Target,
  CheckCircle2,
  Lightbulb,
  BarChart3,
} from "lucide-react";
import { listAnd } from "@/lib/charts/chart-text";
import { EXAMPLE_OKR_ID, buildExample, buildExampleOkr, withoutExample } from "./example";
import { toMarkdown } from "./markdown";
import { goalSmart, smartMissing, validateSmart } from "./smart";
import { GOAL_TIPS, SmartBadges } from "./smart-badges";
import {
  DRAFT_GOAL_ID,
  GOAL_MAX_CHARS,
  cleanGoal,
  draftForSprint,
  draftHome,
  goalConflict,
  goalDocId,
  hasContent,
  isExampleGoal,
  sprintGoalPatch,
  sprintHasOwnGoal,
  usableDraft,
  viewGoal,
} from "./doc";
import { focusSoon } from "./focus";
import { krProgressText, okrPercent, resolveLinkedOkrs, toggleOkrLink } from "./okr-links";
import { goalVerdict } from "./verdict";
import { CriteriaStep } from "./criteria-step";
import { OkrStep } from "./okr-step";
import { GoalConflictBanner, GoalNextStep, GoalScope } from "./goal-scope";

// ─── Constants ──────────────────────────────────────────────────────────────

const STEPS = ["objective", "goal", "criteria", "results"] as const;
type Step = (typeof STEPS)[number];

const STEP_LABELS: Record<Step, string> = {
  objective: "Business Objective",
  goal: "Sprint Goal",
  criteria: "Acceptance Criteria",
  results: "Key Results",
};

const STEP_ICONS: Record<Step, React.ReactNode> = {
  objective: <Target className="w-4 h-4" />,
  goal: <Lightbulb className="w-4 h-4" />,
  criteria: <CheckCircle2 className="w-4 h-4" />,
  results: <BarChart3 className="w-4 h-4" />,
};

const TIPS = [
  'Start with a verb: "Deliver...", "Enable...", "Validate..."',
  "Focus on the outcome, not the tasks",
  "Make it achievable within a single sprint",
  "Ensure the whole team can rally behind it",
  "Avoid listing multiple unrelated goals",
];

const NO_GOALS: SprintGoal[] = [];
const NO_OKRS: Okr[] = [];
const NO_STORIES: Story[] = [];

/** A name short enough for a one-line toast. */
function shortName(name: string, max = 40): string {
  const t = name.trim();
  return t.length > max ? `${t.slice(0, max - 1).trimEnd()}…` : t;
}

/**
 * What discarding a goal throws away, for the confirm: "The draft's goal
 * statement, objective and 2 acceptance criteria are deleted."
 */
function discardSummary(doc: SprintGoal): string {
  const criteria = doc.criteria.filter((c) => c.text.trim()).length;
  const okrs = doc.okrIds?.length ?? 0;
  const notes = doc.keyResults.filter((kr) => kr.trim()).length;
  const count = (n: number, one: string, many: string) =>
    n > 0 ? `${n} ${n === 1 ? one : many}` : "";
  const parts = [
    doc.goal.trim() ? "goal statement" : "",
    doc.businessObjective.trim() ? "objective" : "",
    count(criteria, "acceptance criterion", "acceptance criteria"),
    count(okrs, "linked OKR", "linked OKRs"),
    count(notes, "key-result note", "key-result notes"),
  ].filter(Boolean);
  if (parts.length === 0) return "The draft is deleted.";
  const plural = parts.length > 1 || [criteria, okrs, notes].some((n) => n > 1);
  return `The draft's ${listAnd(parts)} ${plural ? "are" : "is"} deleted.`;
}

// ─── Component ──────────────────────────────────────────────────────────────

export function SprintGoalClient() {
  // `activeStep` and the draft toggle are transient UI; the goal itself is a
  // synced workspace document per sprint (./doc.ts), so agent writes and
  // other tabs round-trip into the wizard.
  const [activeStep, setActiveStep] = useState<Step>("objective");
  const [inDraft, setInDraft] = useState(false);
  const [confirmReplace, setConfirmReplace] = useState(false);
  const [confirmDiscard, setConfirmDiscard] = useState(false);
  // Where focus goes after a banner action removes the button pressed: the
  // verdict, which says what the goal looks like now.
  const verdictRef = useRef<HTMLParagraphElement>(null);
  const focusVerdict = () => focusSoon(() => verdictRef.current);

  const docs = useWorkspaceStore((s) => s.sprintGoals) ?? NO_GOALS;
  const workspaceOkrs = useWorkspaceStore((s) => s.okrs) ?? NO_OKRS;
  const stories = useWorkspaceStore((s) => s.stories) ?? NO_STORIES;
  const upsertSprintGoal = useWorkspaceStore((s) => s.upsertSprintGoal);
  const removeSprintGoal = useWorkspaceStore((s) => s.removeSprintGoal);
  const { log } = useHistoryLogger("sprint-goal");

  // The shared sprint choice (Sprint Planning, the cockpit and the charts
  // open on the same one). The goal on screen is that sprint's, unless the
  // user opened the draft.
  const { sprints, selected, select } = useSelectedSprint();
  const sprint = inDraft ? undefined : selected;
  const view = useMemo(() => viewGoal(docs, sprint), [docs, sprint]);
  const cur = view.doc;
  const draft = useMemo(() => usableDraft(docs), [docs]);
  // Where "Use it for" moves the draft: the sprint whose goal already says
  // the draft's (the old tool copied it there), else the chosen one. When
  // that sprint has a goal of its own, on its document or only on the
  // sprint, the move asks first.
  const draftTarget = (draft ? draftHome(draft, sprints) : undefined) ?? selected;
  const targetHasGoal = Boolean(draftTarget && sprintHasOwnGoal(docs, draftTarget, draft));
  const conflict = goalConflict(view, sprint);

  const { businessObjective, criteria, keyResults } = cur;
  const sprintGoal = cur.goal;
  const showsExample = isExampleGoal(cur);
  const isEmpty = !hasContent(cur);

  // The example's OKR is shown, read-only, while any of the example is
  // loaded (unticking it mustn't make the row vanish); it is never written
  // into the workspace's OKRs.
  const okrs = useMemo(
    () =>
      showsExample || (cur.okrIds ?? []).includes(EXAMPLE_OKR_ID)
        ? [buildExampleOkr(), ...workspaceOkrs]
        : workspaceOkrs,
    [showsExample, cur.okrIds, workspaceOkrs]
  );
  const linkedOkrs = useMemo(() => resolveLinkedOkrs(cur.okrIds, okrs).linked, [cur.okrIds, okrs]);

  // ── Writes ──────────────────────────────────────────────────────────────

  /**
   * The goal as it stands in the store right now (or as it would start, for
   * a sprint without a document), so two quick edits never overwrite each
   * other with a stale render's copy.
   */
  function freshDoc(): SprintGoal {
    const ws = useWorkspaceStore.getState();
    const s = sprint ? (ws.sprints.find((x) => x.id === sprint.id) ?? sprint) : undefined;
    return viewGoal(ws.sprintGoals ?? [], s).doc;
  }

  function updateDoc(change: (doc: SprintGoal) => SprintGoal): SprintGoal {
    const next = change(freshDoc());
    upsertSprintGoal(next);
    return next;
  }

  /**
   * Write the goal statement onto the sprint, so Sprint Planning, the
   * cockpit and the charts show it. Never for the draft or the example.
   */
  function mirrorToSprint(doc: SprintGoal) {
    if (!sprint || isExampleGoal(doc)) return;
    const current = useWorkspaceStore.getState().sprints.find((s) => s.id === sprint.id);
    const patch = current && sprintGoalPatch(current, doc.goal);
    if (patch) updateSprint(sprint.id, patch);
  }

  const setBusinessObjective = (v: string) => updateDoc((d) => ({ ...d, businessObjective: v }));
  const setGoalStatement = (v: string) =>
    mirrorToSprint(updateDoc((d) => ({ ...d, goal: v.slice(0, GOAL_MAX_CHARS) })));

  // ── Sprint vs draft ─────────────────────────────────────────────────────

  const chooseSprint = (id: string) => {
    setInDraft(false);
    select(id);
  };

  /**
   * Move the draft onto its sprint. The sprint's goal is filled in when it
   * was empty or in step with this tool; one written elsewhere stays until
   * the user picks (the conflict banner shows both).
   */
  function moveDraftToSprint() {
    if (!draftTarget || !draft) return;
    const target = draftTarget;
    const ws = useWorkspaceStore.getState();
    const prevDoc = (ws.sprintGoals ?? []).find((d) => d.id === goalDocId(target.id));
    const prevSprintGoal = ws.sprints.find((s) => s.id === target.id)?.goal;
    // Undo restores the draft exactly as it was stored, not the tidied copy.
    const storedDraft = (ws.sprintGoals ?? []).find((d) => d.id === DRAFT_GOAL_ID) ?? draft;
    const inStep =
      !cleanGoal(prevSprintGoal) ||
      (prevDoc !== undefined && cleanGoal(prevDoc.goal) === cleanGoal(prevSprintGoal));
    const moved = draftForSprint(draft, target.id);
    // Only the user's own goal statement reaches the sprint: a draft that
    // still holds the example keeps it on the document, behind its notice,
    // and a blank one never clears the sprint's.
    const ownGoal = withoutExample(moved).goal;
    const patch =
      inStep && cleanGoal(ownGoal) ? sprintGoalPatch({ goal: prevSprintGoal }, ownGoal) : null;
    const elsewhere = target.id !== selected?.id;
    undoable({
      label: `Moved the draft to ${target.name}`,
      apply: () => {
        upsertSprintGoal(moved);
        removeSprintGoal(DRAFT_GOAL_ID);
        if (patch) updateSprint(target.id, patch);
        setInDraft(false);
        // Show where it went when that isn't the sprint on screen.
        if (elsewhere) select(target.id);
      },
      revert: () => {
        upsertSprintGoal(storedDraft);
        if (prevDoc) upsertSprintGoal(prevDoc);
        else removeSprintGoal(moved.id);
        if (patch) updateSprint(target.id, { goal: prevSprintGoal });
      },
    });
    focusVerdict();
  }

  const adoptDraft = () => {
    // Replacing a sprint's own goal asks first; filling an empty one doesn't.
    if (targetHasGoal) setConfirmReplace(true);
    else moveDraftToSprint();
  };

  function discardDraft() {
    const stored = docs.find((d) => d.id === DRAFT_GOAL_ID);
    if (!stored) return;
    undoable({
      label: "Discarded the draft",
      apply: () => {
        removeSprintGoal(DRAFT_GOAL_ID);
        setInDraft(false);
      },
      revert: () => upsertSprintGoal(stored),
    });
    focusVerdict();
  }

  // ── Conflict with Sprint.goal ───────────────────────────────────────────

  function takeSprintGoal() {
    if (!sprint) return;
    const target = sprint;
    const before = freshDoc().goal;
    const full = cleanGoal(target.goal);
    const onSprint = full.slice(0, GOAL_MAX_CHARS).trimEnd();
    // A goal over the limit (agents can write any length) is cut on the
    // sprint too, or the two would still disagree afterwards.
    const cut = onSprint !== full;
    undoable({
      label: cut
        ? `Using ${target.name}'s goal, cut to ${GOAL_MAX_CHARS} characters`
        : `Using ${target.name}'s goal`,
      apply: () => {
        updateDoc((d) => ({ ...d, goal: onSprint }));
        if (cut) updateSprint(target.id, { goal: onSprint });
      },
      revert: () => {
        updateDoc((d) => ({ ...d, goal: before }));
        if (cut) updateSprint(target.id, { goal: target.goal });
      },
    });
    focusVerdict();
  }

  function setGoalOnSprint() {
    if (!sprint) return;
    const target = sprint;
    const before = target.goal;
    const goal = cur.goal.trim();
    undoable({
      label: `Goal set on ${target.name}`,
      apply: () => updateSprint(target.id, { goal: goal || undefined }),
      revert: () => updateSprint(target.id, { goal: before }),
    });
    focusVerdict();
  }

  // ── Example ─────────────────────────────────────────────────────────────

  // Written like any edit but never logged, and never mirrored onto the
  // sprint: loading an example isn't the user's own goal.
  const loadExample = () => updateDoc((d) => ({ ...d, ...buildExample() }));
  const clearExample = () => updateDoc(withoutExample);

  // ── Navigation ──────────────────────────────────────────────────────────

  // Track whether we've already logged a GOAL_SAVED milestone for this
  // session of edits. Reset whenever the user mutates the goal/objective so
  // saving a *changed* goal logs a fresh milestone, but ping-ponging back
  // and forth across the final step doesn't.
  const goalSavedSnapshotRef = useRef<string | null>(null);
  const previewRef = useRef<HTMLDivElement>(null);
  const currentIndex = STEPS.indexOf(activeStep);

  const goNext = () => {
    if (currentIndex >= STEPS.length - 1) return;
    const next = STEPS[currentIndex + 1];
    setActiveStep(next);
    if (next !== STEPS[STEPS.length - 1]) return;
    // Compute a content hash so re-entering the final step without changes
    // doesn't refire the milestone.
    const contentKey = JSON.stringify({
      id: cur.id,
      businessObjective,
      sprintGoal,
      criteria: criteria.map((c) => c.text),
      keyResults,
      okrIds: cur.okrIds,
    });
    if (goalSavedSnapshotRef.current === contentKey || showsExample) return;
    goalSavedSnapshotRef.current = contentKey;
    log(SPRINT_GOAL_ACTIONS.GOAL_SAVED, {
      objective: businessObjective,
      goal: sprintGoal,
      criteriaCount: criteria.length,
      sprintId: sprint?.id,
    });
  };

  const goPrev = () => {
    if (currentIndex > 0) setActiveStep(STEPS[currentIndex - 1]);
  };

  // ── Criteria ────────────────────────────────────────────────────────────

  const addCriterion = (text: string) => {
    updateDoc((d) => ({
      ...d,
      criteria: [...d.criteria, { id: crypto.randomUUID(), text, relevantChecked: false }],
    }));
    log(SPRINT_GOAL_ACTIONS.CRITERION_ADDED, {});
  };

  const removeCriterion = (id: string) => {
    const index = criteria.findIndex((c) => c.id === id);
    if (index === -1) return;
    const criterion = criteria[index];
    undoable({
      label: criterion.text.trim()
        ? `Deleted “${shortName(criterion.text)}”`
        : `Deleted acceptance criterion ${index + 1}`,
      apply: () => {
        updateDoc((d) => ({ ...d, criteria: d.criteria.filter((c) => c.id !== id) }));
        log(SPRINT_GOAL_ACTIONS.CRITERION_REMOVED, { criterionId: id });
      },
      revert: () =>
        updateDoc((d) => {
          if (d.criteria.some((c) => c.id === id)) return d;
          const next = [...d.criteria];
          next.splice(Math.min(index, next.length), 0, criterion);
          return { ...d, criteria: next };
        }),
    });
  };

  const updateCriterionText = (id: string, text: string) =>
    updateDoc((d) => ({
      ...d,
      criteria: d.criteria.map((c) => (c.id === id ? { ...c, text } : c)),
    }));

  const toggleRelevant = (id: string) =>
    updateDoc((d) => ({
      ...d,
      criteria: d.criteria.map((c) =>
        c.id === id ? { ...c, relevantChecked: !c.relevantChecked } : c
      ),
    }));

  // ── Key results: linked OKRs and legacy notes ───────────────────────────

  const toggleOkr = (okrId: string) =>
    updateDoc((d) => ({ ...d, okrIds: toggleOkrLink(d.okrIds, okrId) }));

  const unlinkOkrs = (ids: string[]) =>
    updateDoc((d) => ({ ...d, okrIds: (d.okrIds ?? []).filter((id) => !ids.includes(id)) }));

  const updateNote = (index: number, value: string) =>
    updateDoc((d) => ({
      ...d,
      keyResults: d.keyResults.map((kr, i) => (i === index ? value : kr)),
    }));

  // Notes are plain strings with no id, so Undo puts the text back at the
  // index it was removed from.
  const removeNote = (index: number) => {
    if (index >= keyResults.length) return;
    const kr = keyResults[index];
    undoable({
      label: kr.trim() ? `Deleted “${shortName(kr)}”` : `Deleted key-result note ${index + 1}`,
      apply: () =>
        updateDoc((d) => ({ ...d, keyResults: d.keyResults.filter((_, i) => i !== index) })),
      revert: () =>
        updateDoc((d) => {
          const next = [...d.keyResults];
          next.splice(Math.min(index, next.length), 0, kr);
          return { ...d, keyResults: next };
        }),
    });
  };

  // ── Export data ─────────────────────────────────────────────────────────

  const notes = useMemo(() => keyResults.filter((kr) => kr.trim()), [keyResults]);
  // What the clipboard and the AI prompts list as key results: the linked
  // OKRs' key results as they stand, then any notes.
  const krLines = useMemo(
    () => [
      ...linkedOkrs.flatMap((o) => o.keyResults.map((kr) => `${kr.title} (${krProgressText(kr)})`)),
      ...notes,
    ],
    [linkedOkrs, notes]
  );

  const clipboardText = useMemo(
    () =>
      [
        ...(sprint ? [`SPRINT: ${sprint.name}`] : []),
        `BUSINESS OBJECTIVE: ${businessObjective}`,
        `SPRINT GOAL: ${sprintGoal}`,
        `ACCEPTANCE CRITERIA:`,
        ...criteria.map((c, i) => `${i + 1}. ${c.text}`),
        `KEY RESULTS:`,
        ...krLines.map((kr) => `- ${kr}`),
      ].join("\n"),
    [sprint, businessObjective, sprintGoal, criteria, krLines]
  );

  const markdown = useMemo(
    () => toMarkdown(cur, new Date(), { sprint, okrs }),
    [cur, sprint, okrs]
  );

  const jsonData = useMemo(
    () => ({
      sprint: sprint ? { id: sprint.id, name: sprint.name } : null,
      businessObjective,
      sprintGoal,
      goalSmart: goalSmart(cur, sprint),
      acceptanceCriteria: criteria.map((c) => ({ text: c.text, smart: validateSmart(c) })),
      linkedOkrs: linkedOkrs.map((o) => ({
        id: o.id,
        objective: o.objective,
        quarter: o.quarter,
        progressPct: okrPercent(o),
      })),
      keyResultNotes: notes,
    }),
    [cur, sprint, businessObjective, sprintGoal, criteria, linkedOkrs, notes]
  );

  const promptConfig = useMemo(
    () => ({
      toolName: "Sprint Goal Builder",
      prompts: generateSprintGoalPrompts({
        businessObjective,
        sprintGoal,
        criteria: criteria.map((c) => ({ text: c.text, smartRelevant: c.relevantChecked })),
        keyResults: krLines,
      }),
    }),
    [businessObjective, sprintGoal, criteria, krLines]
  );

  // ── Cross-tool signal: recent sprint additions in velocity tool ─────────
  // Surface a tiny callout when at least one sprint was added in the last
  // 14 days — prompts the user to revisit the latest sprint's goal.
  const events = useHistoryStore((s) => s.events);
  const recentSprintAdds = useMemo(
    () =>
      selectEvents({
        toolId: "velocity",
        action: "sprint_added",
        sinceDays: 14,
        limit: 5,
      }),
    // `events` is the trigger: selectEvents reads the history store itself.
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [events]
  );

  const goalCheck = goalSmart(cur, sprint);
  const goalMissing = smartMissing(goalCheck);
  const plannedStories = sprint ? stories.filter((s) => s.sprintId === sprint.id).length : 0;

  // ── Transition wrapper ──────────────────────────────────────────────────

  const tabMotion = {
    initial: { opacity: 0, x: 20 },
    animate: { opacity: 1, x: 0 },
    exit: { opacity: 0, x: -20 },
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    transition: { duration: 0.2, ease: "easeOut" } as any,
  };

  // ── Render ──────────────────────────────────────────────────────────────

  return (
    <ToolPageWrapper
      toolId="sprint-goal"
      title="Sprint Goal Builder"
      description="Craft focused, SMART sprint goals with acceptance criteria and measurable key results."
      category="Sprint Planning & Estimation"
    >
      {showsExample && <ExampleNotice onClear={clearExample} />}
      {recentSprintAdds.length >= 1 && (
        <CalloutAlert tone="info" className="mb-3">
          {recentSprintAdds.length} sprint{recentSprintAdds.length === 1 ? " was" : "s were"} logged
          in the last 14 days — review the latest sprint&apos;s goal performance.
        </CalloutAlert>
      )}
      <GoalScope
        sprints={sprints}
        selected={selected}
        inDraft={inDraft}
        draftTarget={draftTarget}
        targetHasGoal={targetHasGoal}
        draft={draft}
        onSelect={chooseSprint}
        onOpenDraft={() => {
          setInDraft(true);
          focusVerdict();
        }}
        onCloseDraft={() => {
          setInDraft(false);
          focusVerdict();
        }}
        onUseDraft={adoptDraft}
        onDiscardDraft={() => setConfirmDiscard(true)}
      />
      {sprint && conflict && (
        <GoalConflictBanner
          sprint={sprint}
          conflict={conflict}
          onUseSprintGoal={takeSprintGoal}
          onSetOnSprint={setGoalOnSprint}
        />
      )}
      {draftTarget && (
        <ConfirmDialog
          open={confirmReplace}
          onOpenChange={setConfirmReplace}
          title={`Replace ${draftTarget.name}'s goal with the draft?`}
          description="Its objective, criteria and linked OKRs are replaced by the draft's. You can undo this right after."
          confirmLabel="Replace goal"
          onConfirm={moveDraftToSprint}
        />
      )}
      {draft && (
        <ConfirmDialog
          open={confirmDiscard}
          onOpenChange={setConfirmDiscard}
          title="Discard the draft goal?"
          description={`${discardSummary(draft)} You can undo this right after.`}
          confirmLabel="Discard draft"
          onConfirm={discardDraft}
        />
      )}
      <p
        ref={verdictRef}
        tabIndex={-1}
        className="mb-4 text-sm font-medium text-text focus:outline-none"
      >
        {goalVerdict(cur, sprint)}
      </p>
      <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
        {/* ── Wizard Panel ─────────────────────────────────────────── */}
        <div className="lg:col-span-2 min-w-0">
          <Card className="bg-card border-border p-4 sm:p-6">
            <Tabs value={activeStep} onValueChange={(v) => setActiveStep(v as Step)}>
              <TabsList className="w-full bg-card border border-border mb-6">
                {STEPS.map((step) => (
                  <TabsTrigger
                    key={step}
                    value={step}
                    aria-label={STEP_LABELS[step]}
                    className="flex-1 gap-2 data-[state=active]:bg-accent-cyan/15 data-[state=active]:text-accent data-[state=active]:shadow-none text-sub"
                  >
                    {STEP_ICONS[step]}
                    <span className="hidden sm:inline">{STEP_LABELS[step]}</span>
                  </TabsTrigger>
                ))}
              </TabsList>

              {/* Step 1 - Business Objective */}
              <TabsContent value="objective">
                <AnimatePresence mode="wait">
                  <motion.div key="objective" {...tabMotion}>
                    <h2 className="text-lg font-semibold text-text mb-2">Business Objective</h2>
                    <p className="text-sm text-sub mb-4">
                      What high-level business objective does this sprint serve? This provides
                      context for why the sprint work matters.
                    </p>
                    <BlurTextarea
                      aria-label="Business objective"
                      placeholder="e.g., Increase user retention by streamlining the onboarding experience..."
                      value={businessObjective}
                      onCommit={setBusinessObjective}
                      className="min-h-[120px] bg-card border-border text-text placeholder:text-sub/50 focus:border-accent-cyan/50 focus:ring-accent-cyan/20"
                    />
                  </motion.div>
                </AnimatePresence>
              </TabsContent>

              {/* Step 2 - Sprint Goal */}
              <TabsContent value="goal">
                <AnimatePresence mode="wait">
                  <motion.div key="goal" {...tabMotion}>
                    <h2 className="text-lg font-semibold text-text mb-2">Sprint Goal</h2>
                    <p className="text-sm text-sub mb-4">
                      Define the specific goal for this sprint. A good sprint goal is concise,
                      outcome-focused, and achievable.
                      {sprint && ` Saved here, it is also ${sprint.name}'s goal.`}
                    </p>
                    <div className="relative">
                      <BlurTextarea
                        aria-label="Sprint goal"
                        placeholder="e.g., Deliver a self-service onboarding flow that allows new users to complete setup within 3 minutes..."
                        value={sprintGoal}
                        onCommit={setGoalStatement}
                        maxLength={GOAL_MAX_CHARS}
                        className="min-h-[120px] bg-card border-border text-text placeholder:text-sub/50 focus:border-accent-cyan/50 focus:ring-accent-cyan/20"
                      />
                      <span
                        className={`absolute bottom-2 right-3 text-xs ${
                          sprintGoal.length > GOAL_MAX_CHARS * 0.9 ? "text-danger" : "text-sub/60"
                        }`}
                      >
                        {sprintGoal.length}/{GOAL_MAX_CHARS}
                      </span>
                    </div>
                    {sprintGoal.trim() && (
                      <div className="mt-3">
                        <SmartBadges result={goalCheck} tips={GOAL_TIPS} />
                      </div>
                    )}

                    {/* Tips */}
                    <div className="mt-4 p-4 rounded-lg bg-accent-cyan/5 border border-accent-cyan/15">
                      <h3 className="text-sm font-medium text-accent mb-2 flex items-center gap-2">
                        <Lightbulb className="w-4 h-4" />
                        Tips for a Great Sprint Goal
                      </h3>
                      <ul className="space-y-1">
                        {TIPS.map((tip, i) => (
                          <li key={i} className="text-sm text-sub flex items-start gap-2">
                            <span className="text-accent mt-0.5">-</span>
                            {tip}
                          </li>
                        ))}
                      </ul>
                    </div>
                  </motion.div>
                </AnimatePresence>
              </TabsContent>

              {/* Step 3 - Acceptance Criteria */}
              <TabsContent value="criteria">
                <AnimatePresence mode="wait">
                  <motion.div key="criteria" {...tabMotion}>
                    <CriteriaStep
                      criteria={criteria}
                      onAdd={addCriterion}
                      onEdit={updateCriterionText}
                      onToggleRelevant={toggleRelevant}
                      onRemove={removeCriterion}
                    />
                  </motion.div>
                </AnimatePresence>
              </TabsContent>

              {/* Step 4 - Key Results */}
              <TabsContent value="results">
                <AnimatePresence mode="wait">
                  <motion.div key="results" {...tabMotion}>
                    <OkrStep
                      okrs={okrs}
                      okrIds={cur.okrIds}
                      notes={keyResults}
                      onToggle={toggleOkr}
                      onUnlink={unlinkOkrs}
                      onEditNote={updateNote}
                      onRemoveNote={removeNote}
                    />
                  </motion.div>
                </AnimatePresence>
              </TabsContent>
            </Tabs>

            {/* Navigation buttons */}
            <div className="flex justify-between mt-6 pt-4 border-t border-border">
              <Button
                variant="outline"
                size="sm"
                onClick={goPrev}
                disabled={currentIndex === 0}
                className="gap-2 border-border bg-card text-sub hover:text-text disabled:opacity-30"
              >
                <ChevronLeft className="w-4 h-4" />
                Previous
              </Button>
              <Button
                variant="outline"
                size="sm"
                onClick={goNext}
                disabled={currentIndex === STEPS.length - 1}
                className="gap-2 border-border bg-accent-cyan/10 text-accent hover:bg-accent-cyan/20 hover:border-accent-cyan/30 disabled:opacity-30"
              >
                Next
                <ChevronRight className="w-4 h-4" />
              </Button>
            </div>
          </Card>
        </div>

        {/* ── Preview Panel ────────────────────────────────────────── */}
        <div className="lg:col-span-1 min-w-0">
          <Card className="bg-card border-border p-4 sm:p-6 lg:sticky lg:top-6">
            <div className="flex items-center justify-between mb-4">
              <h2 className="text-lg font-semibold text-text">Preview</h2>
              <div className="flex items-center gap-2">
                <AiPromptGenerator config={promptConfig} />
                <ExportButton
                  filename="sprint-goal"
                  clipboardText={clipboardText}
                  jsonData={jsonData}
                  markdown={markdown}
                  // The preview isn't rendered while the goal is empty, so
                  // there is no picture to export yet.
                  targetRef={isEmpty ? undefined : previewRef}
                />
              </div>
            </div>

            {isEmpty ? (
              <EmptyState
                icon={Target}
                padding="md"
                action={<LoadExampleButton onLoad={loadExample} />}
              >
                {sprint ? `No goal for ${sprint.name} yet.` : "No goal yet."} Work through the four
                steps, or load an example to see a finished one.
              </EmptyState>
            ) : (
              <div
                ref={previewRef}
                className="p-4 rounded-lg bg-card border border-border space-y-4 text-sm break-words"
              >
                {sprint && (
                  <div>
                    <span className="text-xs font-semibold uppercase tracking-wider text-accent">
                      Sprint
                    </span>
                    <p className="text-text mt-1">{sprint.name}</p>
                  </div>
                )}

                <div>
                  <span className="text-xs font-semibold uppercase tracking-wider text-accent">
                    Business Objective
                  </span>
                  <p className="text-text mt-1">
                    {businessObjective || (
                      <span className="text-sub/40 italic">Not yet defined</span>
                    )}
                  </p>
                </div>

                <div>
                  <span className="text-xs font-semibold uppercase tracking-wider text-accent">
                    Sprint Goal
                  </span>
                  <p className="text-text mt-1">
                    {sprintGoal || <span className="text-sub/40 italic">Not yet defined</span>}
                  </p>
                  {sprintGoal.trim() && (
                    <p className="mt-1 text-xs text-sub">
                      SMART {5 - goalMissing.length}/5
                      {goalMissing.length > 0 && `, missing ${goalMissing.join(", ")}`}
                    </p>
                  )}
                </div>

                <div>
                  <span className="text-xs font-semibold uppercase tracking-wider text-accent">
                    Acceptance Criteria
                  </span>
                  {criteria.some((c) => c.text.trim()) ? (
                    <ol className="list-decimal list-inside mt-1 space-y-1">
                      {criteria
                        .filter((c) => c.text.trim())
                        .map((c) => (
                          <li key={c.id} className="text-text">
                            {c.text}
                          </li>
                        ))}
                    </ol>
                  ) : (
                    <p className="text-sub/40 italic mt-1">No criteria added</p>
                  )}
                </div>

                <div>
                  <span className="text-xs font-semibold uppercase tracking-wider text-accent">
                    Key Results
                  </span>
                  {linkedOkrs.length === 0 && notes.length === 0 && (
                    <p className="text-sub/40 italic mt-1">No OKRs linked</p>
                  )}
                  {linkedOkrs.length > 0 && (
                    <ul className="mt-1 space-y-1">
                      {linkedOkrs.map((o) => (
                        <li key={o.id} className="text-text">
                          {o.objective}{" "}
                          <span className="text-xs text-sub">({okrPercent(o)}% of the way)</span>
                        </li>
                      ))}
                    </ul>
                  )}
                  {notes.length > 0 && (
                    <ul className="list-disc list-inside mt-1 space-y-1">
                      {notes.map((kr, i) => (
                        <li key={i} className="text-sub">
                          {kr}
                        </li>
                      ))}
                    </ul>
                  )}
                </div>
              </div>
            )}
          </Card>
          {sprint && cleanGoal(sprint.goal) && !conflict && !showsExample && (
            <GoalNextStep sprint={sprint} plannedStories={plannedStories} />
          )}
        </div>
      </div>
    </ToolPageWrapper>
  );
}
