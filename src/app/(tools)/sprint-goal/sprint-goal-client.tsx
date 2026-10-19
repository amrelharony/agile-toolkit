"use client";

import { useState, useRef, useMemo } from "react";
import { useShallow } from "zustand/react/shallow";
import { useWorkspaceStore } from "@/lib/stores/workspace-store";
import type { SprintGoal } from "@/lib/stores/workspace-types";
import { motion, AnimatePresence } from "framer-motion";
import { ToolPageWrapper } from "@/components/layout/tool-page-wrapper";
import { ExportButton } from "@/components/shared/export-button";
import { AiPromptGenerator } from "@/components/shared/ai-prompt-generator";
import { generateSprintGoalPrompts } from "@/lib/ai-prompts/sprint-goal";
import { useHistoryLogger } from "@/lib/history/use-history-logger";
import { SPRINT_GOAL_ACTIONS } from "@/lib/history/event-actions";
import { selectEvents } from "@/lib/history/selectors";
import { useHistoryStore } from "@/lib/history/history-store";
import { CalloutAlert } from "@/components/shared/callout-alert";
import { Tabs, TabsList, TabsTrigger, TabsContent } from "@/components/ui/tabs";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { BlurInput, BlurTextarea } from "@/components/shared/blur-fields";
import { Badge } from "@/components/ui/badge";
import {
  Plus,
  Trash2,
  ChevronRight,
  ChevronLeft,
  Target,
  CheckCircle2,
  Lightbulb,
  BarChart3,
} from "lucide-react";

// ─── Types ──────────────────────────────────────────────────────────────────

interface AcceptanceCriterion {
  id: string;
  text: string;
  relevantChecked: boolean;
}

interface SmartResult {
  specific: boolean;
  measurable: boolean;
  achievable: boolean;
  relevant: boolean;
  timeBound: boolean;
}

// ─── SMART validation helpers ───────────────────────────────────────────────

const VAGUE_WORDS = [
  "improve",
  "better",
  "good",
  "nice",
  "fine",
  "some",
  "various",
  "stuff",
  "things",
  "enhance",
  "optimize",
  "miscellaneous",
];

const QUANTIFIABLE_PATTERNS =
  /\d+|percent|%|percentage|count|total|average|ratio|rate|score|increase by|decrease by|reduce by|at least|no more than|minimum|maximum/i;

const TIME_PATTERNS =
  /by end of sprint|by sprint end|deadline|before|after|within \d|by \w+day|by \d{1,2}\/|by \d{4}|end of day|EOD|end of week|EOW|by close|due date|sprint \d|week \d|day \d|hours?|days?|date/i;

function validateSmart(criterion: AcceptanceCriterion): SmartResult {
  const text = criterion.text.trim();
  const words = text.toLowerCase().split(/\s+/);

  // Match by stem so "improving" / "optimization" / "enhanced" still trip
  // the vague-word detector. Strip simple verb/noun suffixes before testing.
  const stem = (w: string) => w.replace(/(?:ing|ed|es|s|ation|ment|ly)$/, "");
  // BUG-T8-sprint-goal-1: the prior `s === vague || s.startsWith(vague)`
  // never matched plural VAGUE_WORDS entries like "things" or "various"
  // because the word's plural-s gets stripped to "thing"/"variou", which
  // neither equals "things" nor starts with it. Compare with the
  // ALSO-stemmed vague word too, so plural list entries fire.
  const hasVague = words.some((w) => {
    const s = stem(w);
    return VAGUE_WORDS.some((vague) => {
      const v = stem(vague);
      return s === vague || s === v || s.startsWith(v);
    });
  });
  const hasConcreteNoun = text.length > 10 && !hasVague;

  const specific = hasConcreteNoun;
  const measurable = QUANTIFIABLE_PATTERNS.test(text);
  const achievable = text.length >= 20 && text.length <= 300;
  const relevant = criterion.relevantChecked;
  const timeBound = TIME_PATTERNS.test(text);

  return { specific, measurable, achievable, relevant, timeBound };
}

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

const GOAL_MAX_CHARS = 300;

const TIPS = [
  'Start with a verb: "Deliver...", "Enable...", "Validate..."',
  "Focus on the outcome, not the tasks",
  "Make it achievable within a single sprint",
  "Ensure the whole team can rally behind it",
  "Avoid listing multiple unrelated goals",
];

function genId() {
  return crypto.randomUUID();
}

// ─── Component ──────────────────────────────────────────────────────────────

// Singleton id for the one current sprint goal. MUST match SG_ID in
// src/lib/actions/tools/sprint-goal.ts so agent writes hit the same row.
const SG_ID = "sprint-goal:current";
const DEFAULT_SPRINT_GOAL: SprintGoal = {
  id: SG_ID,
  businessObjective: "",
  goal: "",
  criteria: [{ id: "criterion-1", text: "", relevantChecked: false }],
  keyResults: [""],
};

export function SprintGoalClient() {
  // PERSIST the wizard state. Previously these were plain useState so
  // navigating away or refreshing wiped everything — a clear data-loss
  // bug given every sibling tool persists. `activeStep` stays in-memory
  // (transient UI), but the four content fields go through usePersisted
  // so the user can pick up where they left off. usePersisted internally
  // wraps localStorage with quota + SSR guards.
  const [activeStep, setActiveStep] = useState<Step>("objective");
  // Sprint-goal state is now a singleton synced workspace document (was four
  // isolated localStorage keys), so MCP-written goals round-trip into the UI.
  const goalDoc = useWorkspaceStore(
    useShallow((s) => (s.sprintGoals ?? []).find((g) => g.id === SG_ID))
  );
  const upsertSprintGoal = useWorkspaceStore((s) => s.upsertSprintGoal);
  const cur = goalDoc ?? DEFAULT_SPRINT_GOAL;
  const businessObjective = cur.businessObjective;
  const sprintGoal = cur.goal;
  const criteria = cur.criteria;
  const keyResults = cur.keyResults;
  // Setters mirror the old usePersisted [value, setter] API (value or updater)
  // so the handlers + JSX below are unchanged. Read freshest via getState().
  function patchGoal<K extends keyof SprintGoal>(
    key: K,
    val: SprintGoal[K] | ((prev: SprintGoal[K]) => SprintGoal[K])
  ) {
    const d =
      (useWorkspaceStore.getState().sprintGoals ?? []).find((g) => g.id === SG_ID) ??
      DEFAULT_SPRINT_GOAL;
    const next =
      typeof val === "function" ? (val as (p: SprintGoal[K]) => SprintGoal[K])(d[key]) : val;
    upsertSprintGoal({ ...d, [key]: next } as SprintGoal);
  }
  const setBusinessObjective = (v: string | ((p: string) => string)) =>
    patchGoal("businessObjective", v);
  const setSprintGoal = (v: string | ((p: string) => string)) => patchGoal("goal", v);
  const setCriteria = (
    v: AcceptanceCriterion[] | ((p: AcceptanceCriterion[]) => AcceptanceCriterion[])
  ) => patchGoal("criteria", v);
  const setKeyResults = (v: string[] | ((p: string[]) => string[])) => patchGoal("keyResults", v);
  const { log } = useHistoryLogger("sprint-goal");
  // Track whether we've already logged a GOAL_SAVED milestone for this
  // session of edits. Reset whenever the user mutates the goal/objective so
  // saving a *changed* goal logs a fresh milestone, but ping-ponging back
  // and forth across the final step doesn't.
  const goalSavedSnapshotRef = useRef<string | null>(null);

  const previewRef = useRef<HTMLDivElement>(null);

  // ── Navigation ──────────────────────────────────────────────────────────

  const currentIndex = STEPS.indexOf(activeStep);

  const goNext = () => {
    if (currentIndex >= STEPS.length - 1) return;
    const next = STEPS[currentIndex + 1];
    setActiveStep(next);
    if (next !== STEPS[STEPS.length - 1]) return;
    // Compute a content hash so re-entering the final step without changes
    // doesn't refire the milestone.
    const contentKey = JSON.stringify({
      businessObjective,
      sprintGoal,
      criteria: criteria.map((c) => c.text),
      keyResults,
    });
    if (goalSavedSnapshotRef.current === contentKey) return;
    goalSavedSnapshotRef.current = contentKey;
    log(SPRINT_GOAL_ACTIONS.GOAL_SAVED, {
      objective: businessObjective,
      goal: sprintGoal,
      criteriaCount: criteria.length,
    });
  };

  const goPrev = () => {
    if (currentIndex > 0) {
      setActiveStep(STEPS[currentIndex - 1]);
    }
  };

  // ── Criteria helpers ────────────────────────────────────────────────────

  const addCriterion = () => {
    setCriteria((prev) => [...prev, { id: genId(), text: "", relevantChecked: false }]);
    log(SPRINT_GOAL_ACTIONS.CRITERION_ADDED, {});
  };

  const removeCriterion = (id: string) => {
    setCriteria((prev) => (prev.length > 1 ? prev.filter((c) => c.id !== id) : prev));
    log(SPRINT_GOAL_ACTIONS.CRITERION_REMOVED, { criterionId: id });
  };

  const updateCriterionText = (id: string, text: string) =>
    setCriteria((prev) => prev.map((c) => (c.id === id ? { ...c, text } : c)));

  const toggleRelevant = (id: string) =>
    setCriteria((prev) =>
      prev.map((c) => (c.id === id ? { ...c, relevantChecked: !c.relevantChecked } : c))
    );

  // ── Key results helpers ─────────────────────────────────────────────────

  const addKeyResult = () => setKeyResults((prev) => [...prev, ""]);

  const removeKeyResult = (index: number) =>
    setKeyResults((prev) => (prev.length > 1 ? prev.filter((_, i) => i !== index) : prev));

  const updateKeyResult = (index: number, value: string) =>
    setKeyResults((prev) => prev.map((kr, i) => (i === index ? value : kr)));

  // ── Export data ─────────────────────────────────────────────────────────

  const clipboardText = useMemo(
    () =>
      [
        `BUSINESS OBJECTIVE: ${businessObjective}`,
        `SPRINT GOAL: ${sprintGoal}`,
        `ACCEPTANCE CRITERIA:`,
        ...criteria.map((c, i) => `${i + 1}. ${c.text}`),
        `KEY RESULTS:`,
        ...keyResults.map((kr) => `- ${kr}`),
      ].join("\n"),
    [businessObjective, sprintGoal, criteria, keyResults]
  );

  const jsonData = useMemo(
    () => ({
      businessObjective,
      sprintGoal,
      acceptanceCriteria: criteria.map((c) => ({
        text: c.text,
        smart: validateSmart(c),
      })),
      keyResults,
    }),
    [businessObjective, sprintGoal, criteria, keyResults]
  );

  // AI prompt config
  const promptConfig = useMemo(
    () => ({
      toolName: "Sprint Goal Builder",
      prompts: generateSprintGoalPrompts({
        businessObjective,
        sprintGoal,
        criteria: criteria.map((c) => ({ text: c.text, smartRelevant: c.relevantChecked })),
        keyResults,
      }),
    }),
    [businessObjective, sprintGoal, criteria, keyResults]
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
    [events]
  );

  // ── SMART badge renderer ────────────────────────────────────────────────

  const SmartBadge = ({
    label,
    passes,
    tooltip,
  }: {
    label: string;
    passes: boolean;
    tooltip: string;
  }) => (
    <Badge
      title={tooltip}
      className={
        passes
          ? "bg-accent-green/15 text-accent-green border-accent-green/30 hover:bg-accent-green/25"
          : "bg-danger/15 text-danger border-danger/30 hover:bg-danger/25"
      }
    >
      {label}
      <span className="sr-only">{passes ? " (met)" : " (not met)"}</span>
    </Badge>
  );

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
      {recentSprintAdds.length >= 1 && (
        <CalloutAlert tone="info" className="mb-3">
          {recentSprintAdds.length} sprint{recentSprintAdds.length === 1 ? " was" : "s were"} logged
          in the last 14 days — review the latest sprint&apos;s goal performance.
        </CalloutAlert>
      )}
      <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
        {/* ── Wizard Panel ─────────────────────────────────────────── */}
        <div className="lg:col-span-2">
          <Card className="bg-card border-border p-6">
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
                    </p>
                    <div className="relative">
                      <BlurTextarea
                        aria-label="Sprint goal"
                        placeholder="e.g., Deliver a self-service onboarding flow that allows new users to complete setup within 3 minutes..."
                        value={sprintGoal}
                        onCommit={(v) => setSprintGoal(v.slice(0, GOAL_MAX_CHARS))}
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
                    <h2 className="text-lg font-semibold text-text mb-2">Acceptance Criteria</h2>
                    <p className="text-sm text-sub mb-4">
                      Define measurable criteria that determine when the sprint goal is met. Each
                      criterion is validated against SMART principles.
                    </p>

                    <div className="space-y-4">
                      {criteria.map((criterion, criterionIdx) => {
                        const smart = validateSmart(criterion);
                        return (
                          <div
                            key={criterion.id}
                            className="p-4 rounded-lg bg-card border border-border"
                          >
                            <div className="flex gap-2 mb-3">
                              <BlurTextarea
                                aria-label={`Acceptance criterion ${criterionIdx + 1}`}
                                placeholder="e.g., 90% of new users complete onboarding within 3 minutes by end of sprint"
                                value={criterion.text}
                                onCommit={(v) => updateCriterionText(criterion.id, v)}
                                className="flex-1 min-h-[60px] bg-card border-border text-text placeholder:text-sub/50 focus:border-accent-cyan/50 focus:ring-accent-cyan/20"
                              />
                              <Button
                                variant="ghost"
                                size="icon"
                                onClick={() => removeCriterion(criterion.id)}
                                aria-label={`Remove acceptance criterion ${criterionIdx + 1}`}
                                className="min-touch-coarse text-sub hover:text-danger hover:bg-danger/10 shrink-0"
                                disabled={criteria.length === 1}
                              >
                                <Trash2 className="w-4 h-4" />
                              </Button>
                            </div>

                            {/* SMART badges */}
                            {criterion.text.trim().length > 0 && (
                              <div className="flex flex-wrap items-center gap-2">
                                <span className="text-xs text-sub mr-1">SMART:</span>
                                <SmartBadge
                                  label="Specific"
                                  passes={smart.specific}
                                  tooltip={
                                    smart.specific
                                      ? "Contains concrete actions or nouns"
                                      : "Avoid vague words like improve, better, good"
                                  }
                                />
                                <SmartBadge
                                  label="Measurable"
                                  passes={smart.measurable}
                                  tooltip={
                                    smart.measurable
                                      ? "Contains quantifiable terms"
                                      : "Add numbers, percentages, or measurable metrics"
                                  }
                                />
                                <SmartBadge
                                  label="Achievable"
                                  passes={smart.achievable}
                                  tooltip={
                                    smart.achievable
                                      ? "Good length - not too vague or complex"
                                      : "Aim for 20-300 characters for clarity"
                                  }
                                />
                                <div className="flex items-center gap-1.5">
                                  <SmartBadge
                                    label="Relevant"
                                    passes={smart.relevant}
                                    tooltip={
                                      smart.relevant
                                        ? "Confirmed relevant by you"
                                        : "Check the box to confirm relevance"
                                    }
                                  />
                                  <input
                                    type="checkbox"
                                    checked={criterion.relevantChecked}
                                    onChange={() => toggleRelevant(criterion.id)}
                                    className="w-3.5 h-3.5 rounded border-border bg-card accent-[#00ff88] cursor-pointer"
                                    title="Confirm this criterion is relevant to the sprint goal"
                                  />
                                </div>
                                <SmartBadge
                                  label="Time-bound"
                                  passes={smart.timeBound}
                                  tooltip={
                                    smart.timeBound
                                      ? "Contains time reference"
                                      : 'Add a deadline like "by end of sprint" or a date'
                                  }
                                />
                              </div>
                            )}
                          </div>
                        );
                      })}
                    </div>

                    <Button
                      variant="outline"
                      size="sm"
                      onClick={addCriterion}
                      className="mt-4 gap-2 border-border bg-card hover:bg-accent-cyan/10 hover:border-accent-cyan/30 text-sub hover:text-accent"
                    >
                      <Plus className="w-4 h-4" />
                      Add Criterion
                    </Button>
                  </motion.div>
                </AnimatePresence>
              </TabsContent>

              {/* Step 4 - Key Results */}
              <TabsContent value="results">
                <AnimatePresence mode="wait">
                  <motion.div key="results" {...tabMotion}>
                    <h2 className="text-lg font-semibold text-text mb-2">Key Results</h2>
                    <p className="text-sm text-sub mb-4">
                      Define the measurable outcomes that indicate success. These should be
                      observable and verifiable.
                    </p>

                    <div className="space-y-3">
                      {keyResults.map((kr, index) => (
                        <div key={index} className="flex gap-2">
                          <BlurInput
                            aria-label={`Key result ${index + 1}`}
                            placeholder={`e.g., Onboarding completion rate reaches 90%`}
                            value={kr}
                            onCommit={(v) => updateKeyResult(index, v)}
                            className="flex-1 bg-card border-border text-text placeholder:text-sub/50 focus:border-accent-cyan/50 focus:ring-accent-cyan/20"
                          />
                          <Button
                            variant="ghost"
                            size="icon"
                            onClick={() => removeKeyResult(index)}
                            aria-label={`Remove key result ${index + 1}`}
                            className="min-touch-coarse text-sub hover:text-danger hover:bg-danger/10 shrink-0"
                            disabled={keyResults.length === 1}
                          >
                            <Trash2 className="w-4 h-4" />
                          </Button>
                        </div>
                      ))}
                    </div>

                    <Button
                      variant="outline"
                      size="sm"
                      onClick={addKeyResult}
                      className="mt-4 gap-2 border-border bg-card hover:bg-accent-cyan/10 hover:border-accent-cyan/30 text-sub hover:text-accent"
                    >
                      <Plus className="w-4 h-4" />
                      Add Key Result
                    </Button>
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
        <div className="lg:col-span-1">
          <Card className="bg-card border-border p-6 sticky top-6">
            <div className="flex items-center justify-between mb-4">
              <h2 className="text-lg font-semibold text-text">Preview</h2>
              <div className="flex items-center gap-2">
                <AiPromptGenerator config={promptConfig} />
                <ExportButton
                  filename="sprint-goal"
                  clipboardText={clipboardText}
                  jsonData={jsonData}
                  targetRef={previewRef}
                />
              </div>
            </div>

            <div
              ref={previewRef}
              className="p-4 rounded-lg bg-card border border-border space-y-4 text-sm"
            >
              {/* Business Objective */}
              <div>
                <span className="text-xs font-semibold uppercase tracking-wider text-accent">
                  Business Objective
                </span>
                <p className="text-text mt-1">
                  {businessObjective || <span className="text-sub/40 italic">Not yet defined</span>}
                </p>
              </div>

              {/* Sprint Goal */}
              <div>
                <span className="text-xs font-semibold uppercase tracking-wider text-accent">
                  Sprint Goal
                </span>
                <p className="text-text mt-1">
                  {sprintGoal || <span className="text-sub/40 italic">Not yet defined</span>}
                </p>
              </div>

              {/* Acceptance Criteria */}
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

              {/* Key Results */}
              <div>
                <span className="text-xs font-semibold uppercase tracking-wider text-accent">
                  Key Results
                </span>
                {keyResults.some((kr) => kr.trim()) ? (
                  <ul className="list-disc list-inside mt-1 space-y-1">
                    {keyResults
                      .filter((kr) => kr.trim())
                      .map((kr, i) => (
                        <li key={i} className="text-text">
                          {kr}
                        </li>
                      ))}
                  </ul>
                ) : (
                  <p className="text-sub/40 italic mt-1">No key results added</p>
                )}
              </div>
            </div>
          </Card>
        </div>
      </div>
    </ToolPageWrapper>
  );
}
