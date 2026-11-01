"use client";

import { useId, useMemo, useState, type ReactNode } from "react";
import { BarChart3, CheckSquare, MessageSquare, Presentation } from "lucide-react";
import { ToolPageWrapper } from "@/components/layout/tool-page-wrapper";
import { AiPromptGenerator } from "@/components/shared/ai-prompt-generator";
import { BlurInput } from "@/components/shared/blur-fields";
import { CalloutAlert } from "@/components/shared/callout-alert";
import { EmptyState } from "@/components/shared/empty-state";
import { ExportButton } from "@/components/shared/export-button";
import { ResetButton } from "@/components/shared/reset-button";
import { SectionCard } from "@/components/shared/section-card";
import { LoadingSprints } from "@/components/sprints/start";
import {
  ExampleNotice,
  LoadExampleButton,
  isExampleId,
} from "@/components/tool-frame/example-data";
import { Label } from "@/components/ui/label";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { generateSprintReviewPrompts } from "@/lib/ai-prompts/sprint-review";
import { useHistoryStore } from "@/lib/history/history-store";
import { selectEvents } from "@/lib/history/selectors";
import { useSelectedSprint } from "@/lib/sprints/use-selected-sprint";
import { useWorkspaceStore } from "@/lib/stores/workspace-store";
import type { SprintReview } from "@/lib/stores/workspace-types";
import { useWorkspaceHydrated } from "@/lib/team/use-team-roster";
import { undoable } from "@/lib/utils/undoable";
import {
  demoMinutes,
  resetSummary,
  reviewDocId,
  reviewHasContent,
  startFromDraft,
  usableDraft,
  viewReview,
} from "./doc";
import { buildExample, type ReviewExample } from "./example";
import { toMarkdown } from "./markdown";
import { backlogProgress, reviewNumbers } from "./numbers";
import type { ReviewSource } from "./types";
import {
  createExampleReviewStore,
  useExampleReview,
  useLiveReview,
} from "./use-sprint-review-store";
import { reviewVerdict } from "./verdict";
import { DemoScriptTab } from "./components/demo-script-tab";
import { FeedbackTab } from "./components/feedback-tab";
import { GoalCard } from "./components/goal-card";
import { ReviewScope } from "./components/review-scope";
import { ShowcaseChecklistTab } from "./components/showcase-checklist-tab";
import { VelocitySummaryTab } from "./components/velocity-summary-tab";

const NO_REVIEWS: SprintReview[] = [];

const TAB_CLASS =
  "data-[state=active]:bg-card data-[state=active]:text-text data-[state=active]:ring-1 data-[state=active]:ring-accent/60 text-sub gap-1.5";

/** "sprint-12" for a file name. */
const slug = (s: string) =>
  s
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "") || "draft";

/**
 * Sprint Review Kit: one review per sprint, built from what the sprint
 * already knows — its goal and whether it was met (Sprint Goal), its done
 * stories as the demo candidates, and its points — plus the demo script,
 * the stakeholders' feedback (which can become backlog stories) and the
 * showcase checklist. With no sprint chosen the draft works as it always
 * has; the example runs in memory.
 */
export function SprintReviewClient() {
  const hydrated = useWorkspaceHydrated();
  const [example, setExample] = useState<ReviewExample | null>(null);
  const [tab, setTab] = useState("demo");

  return (
    <ToolPageWrapper
      toolId="sprint-review"
      title="Sprint Review Kit"
      description="Build each sprint's review from its goal and done stories, run the demo script, capture stakeholder feedback and check you're ready to show."
      category="Ceremonies"
    >
      {!hydrated ? (
        <LoadingSprints />
      ) : example ? (
        <ExampleReview
          example={example}
          tab={tab}
          onTabChange={setTab}
          onExit={() => setExample(null)}
        />
      ) : (
        <LiveReview
          tab={tab}
          onTabChange={setTab}
          onLoadExample={() => setExample(buildExample())}
        />
      )}
    </ToolPageWrapper>
  );
}

/** The chosen sprint's review (or the draft), in the workspace. */
function LiveReview({
  tab,
  onTabChange,
  onLoadExample,
}: {
  tab: string;
  onTabChange: (tab: string) => void;
  onLoadExample: () => void;
}) {
  const { sprints, selected, select } = useSelectedSprint();
  const [inDraft, setInDraft] = useState(false);
  const sprint = inDraft ? undefined : selected;
  const source = useLiveReview(sprint);
  const docs = useWorkspaceStore((s) => s.sprintReviews) ?? NO_REVIEWS;
  const upsert = useWorkspaceStore((s) => s.upsertSprintReview);
  const removeReview = useWorkspaceStore((s) => s.removeSprintReview);
  const draft = useMemo(() => usableDraft(docs), [docs]);
  const sprintHasContent = useMemo(
    () => Boolean(selected && reviewHasContent(viewReview(docs, selected).doc)),
    [docs, selected]
  );

  const chooseSprint = (id: string) => {
    setInDraft(false);
    select(id);
  };

  /** Copy the draft into the chosen sprint's empty review, with Undo. */
  function startSprintFromDraft() {
    if (!selected || !draft) return;
    const target = selected;
    const stored = useWorkspaceStore.getState().sprintReviews ?? [];
    const before = stored.find((d) => d.id === reviewDocId(target.id));
    const next = startFromDraft(viewReview(stored, target).doc, draft, target);
    undoable({
      label: `Started ${target.name}'s review from the draft`,
      apply: () => {
        upsert(next);
        setInDraft(false);
      },
      revert: () => (before ? upsert(before) : removeReview(next.id)),
    });
  }

  // The row Reset removes, held by this render's pair of callbacks so the
  // Undo of one reset can't restore another sprint's review.
  let removed: SprintReview | undefined;
  const reset = (
    <ResetButton
      title={sprint ? `Reset ${sprint.name}'s review?` : "Reset the draft review?"}
      description={`${resetSummary(source.doc)}${
        sprint ? ` ${sprint.name}'s stories and goal stay as they are.` : ""
      } You can undo this right after.`}
      confirmLabel="Reset review"
      doneLabel={sprint ? `Reset ${sprint.name}'s review` : "Reset the draft review"}
      disabled={!source.stored}
      variant="danger-ghost"
      onReset={() => {
        const id = source.doc.id;
        removed = (useWorkspaceStore.getState().sprintReviews ?? []).find((d) => d.id === id);
        removeReview(id);
      }}
      onUndo={() => {
        if (removed) upsert(removed);
      }}
    />
  );

  return (
    <ReviewScreen
      // A half-typed form or an open editor never carries over to another review.
      key={source.doc.id}
      source={source}
      tab={tab}
      onTabChange={onTabChange}
      reset={reset}
      onLoadExample={onLoadExample}
      scope={
        <ReviewScope
          sprints={sprints}
          selected={selected}
          inDraft={inDraft}
          draft={draft}
          sprintHasContent={sprintHasContent}
          onSelect={chooseSprint}
          onOpenDraft={() => setInDraft(true)}
          onCloseDraft={() => setInDraft(false)}
          onStartFromDraft={startSprintFromDraft}
        />
      }
    />
  );
}

/** The example review, in memory: every tab works, nothing is saved or sent. */
function ExampleReview({
  example,
  tab,
  onTabChange,
  onExit,
}: {
  example: ReviewExample;
  tab: string;
  onTabChange: (tab: string) => void;
  onExit: () => void;
}) {
  const [store] = useState(() => createExampleReviewStore(example));
  const source = useExampleReview(example, store);
  return (
    <ReviewScreen
      source={source}
      tab={tab}
      onTabChange={onTabChange}
      scope={
        <div>
          <ExampleNotice onClear={onExit} />
          <p className="-mt-2 text-xs text-sub">
            Example: a checkout team&apos;s {example.sprint.name}. Nothing in it is saved, and none
            of its feedback can be sent to your backlog.
          </p>
        </div>
      }
    />
  );
}

/** One review: the verdict, the goal, then the four tabs. */
function ReviewScreen({
  source,
  scope,
  reset,
  tab,
  onTabChange,
  onLoadExample,
}: {
  source: ReviewSource;
  scope: ReactNode;
  reset?: ReactNode;
  tab: string;
  onTabChange: (tab: string) => void;
  onLoadExample?: () => void;
}) {
  const { doc, sprint, facts, example, writer } = source;
  const uid = useId();
  const numbers = useMemo(() => reviewNumbers(doc, facts, sprint), [doc, facts, sprint]);
  // The product's progress across its real stories (other tools' examples
  // never count).
  const backlog = useMemo(
    () =>
      numbers.source === "stories"
        ? backlogProgress(
            example ? source.stories : source.stories.filter((s) => !isExampleId(s.id))
          )
        : null,
    [numbers.source, example, source.stories]
  );
  const verdict = reviewVerdict({ doc, sprint, facts, numbers });
  const storyTitle = (id: string) => source.stories.find((s) => s.id === id)?.title;
  const markdown = toMarkdown(doc, { sprint, facts, numbers, backlog, storyTitle });
  const name = sprint?.name ?? doc.sprintName.trim();

  // Nothing to show yet: no demo items, feedback or checklist, and no sprint
  // facts to build them from.
  const empty =
    !reviewHasContent(doc) &&
    (!facts || (facts.done.length === 0 && facts.notDone.length === 0 && !facts.goal));

  const promptConfig = useMemo(
    () => ({
      toolName: "Sprint Review",
      prompts: generateSprintReviewPrompts({
        sprintName: name,
        sprintNumber: Number(doc.sprintNumber) || 0,
        features: doc.features.map((f) => ({
          name: f.name,
          description: f.description,
          timeMinutes: f.timeMinutes,
        })),
        feedbackItems: doc.feedbackItems.map((f) => ({
          stakeholder: f.stakeholder,
          feedback: f.feedback,
          category: f.category,
        })),
        checklistItems: doc.checklistItems.map((c) => ({ label: c.label, checked: c.checked })),
        committed: numbers.committed,
        completed: numbers.completed ?? 0,
      }),
    }),
    [name, doc, numbers]
  );

  return (
    <div className="space-y-6">
      {!example && <RecentActivity />}
      {scope}

      <div className="flex flex-wrap items-start justify-between gap-3">
        <p className="min-w-0 flex-1 basis-64 text-sm font-medium text-text">{verdict}</p>
        <div className="flex flex-wrap items-center gap-2">
          <AiPromptGenerator config={promptConfig} />
          <ExportButton
            filename={`sprint-review-${slug(name)}`}
            markdown={markdown}
            jsonData={{
              sprint: sprint ? { id: sprint.id, name: sprint.name } : null,
              numbers,
              review: doc,
            }}
            csvData={{
              // One sheet for demo items and feedback, with a Type column so
              // a spreadsheet can filter them.
              headers: [
                "Type",
                "Name / Stakeholder",
                "Description",
                "Acceptance Criteria",
                "Feedback",
                "Category",
                "Time (min)",
              ],
              rows: [
                ...doc.features.map((f): (string | number)[] => [
                  "Feature",
                  f.name,
                  f.description,
                  f.acceptanceCriteria,
                  "",
                  "",
                  // Blank, as on the page ("Not timed"), never a 0-minute slot.
                  demoMinutes(f) ?? "",
                ]),
                ...doc.feedbackItems.map((f): (string | number)[] => [
                  "Feedback",
                  f.stakeholder,
                  "",
                  "",
                  f.feedback,
                  f.category,
                  "",
                ]),
              ],
            }}
          />
          {reset}
        </div>
      </div>

      {empty && onLoadExample && (
        <EmptyState
          icon={Presentation}
          padding="md"
          action={<LoadExampleButton label="See an example review" onLoad={onLoadExample} />}
        >
          {sprint
            ? `${sprint.name} has no goal or stories yet, and nothing is in its review.`
            : "No review yet."}{" "}
          Add what you&apos;ll demo and capture the stakeholders&apos; feedback below, or look
          around an example review first.
        </EmptyState>
      )}

      {sprint && facts && <GoalCard sprint={sprint} facts={facts} example={example} />}

      {!sprint && (
        <SectionCard
          title="Sprint info"
          icon={Presentation}
          contentClassName="grid grid-cols-1 gap-4 sm:grid-cols-2"
        >
          <div className="space-y-1.5">
            <Label htmlFor={`${uid}-sprint-name`} className="text-xs text-sub">
              Sprint name
            </Label>
            <BlurInput
              id={`${uid}-sprint-name`}
              value={doc.sprintName}
              onCommit={(v) => writer.update((d) => ({ ...d, sprintName: v }))}
              placeholder="e.g. Sprint 12"
              className="input-toolkit"
            />
          </div>
          <div className="space-y-1.5">
            <Label htmlFor={`${uid}-sprint-number`} className="text-xs text-sub">
              Sprint number
            </Label>
            <BlurInput
              id={`${uid}-sprint-number`}
              value={doc.sprintNumber}
              onCommit={(v) => writer.update((d) => ({ ...d, sprintNumber: v }))}
              placeholder="e.g. 12"
              className="input-toolkit"
            />
          </div>
        </SectionCard>
      )}

      <Tabs value={tab} onValueChange={onTabChange}>
        <TabsList className="h-auto flex-wrap gap-1 border border-border bg-surface-deep p-1">
          <TabsTrigger value="demo" className={TAB_CLASS}>
            <Presentation className="h-3.5 w-3.5" aria-hidden="true" />
            Demo Script
          </TabsTrigger>
          <TabsTrigger value="feedback" className={TAB_CLASS}>
            <MessageSquare className="h-3.5 w-3.5" aria-hidden="true" />
            Stakeholder Feedback
          </TabsTrigger>
          <TabsTrigger value="checklist" className={TAB_CLASS}>
            <CheckSquare className="h-3.5 w-3.5" aria-hidden="true" />
            Showcase Checklist
          </TabsTrigger>
          <TabsTrigger value="velocity" className={TAB_CLASS}>
            <BarChart3 className="h-3.5 w-3.5" aria-hidden="true" />
            Velocity Summary
          </TabsTrigger>
        </TabsList>

        <div className="mt-6">
          <TabsContent value="demo">
            <DemoScriptTab source={source} />
          </TabsContent>
          <TabsContent value="feedback">
            <FeedbackTab source={source} />
          </TabsContent>
          <TabsContent value="checklist">
            <ShowcaseChecklistTab source={source} />
          </TabsContent>
          <TabsContent value="velocity">
            <VelocitySummaryTab source={source} numbers={numbers} backlog={backlog} />
          </TabsContent>
        </div>
      </Tabs>
    </div>
  );
}

/**
 * Review activity in the last 30 days: demo items added and feedback
 * captured, so the cadence shows without leaving the page.
 */
function RecentActivity() {
  // `events` is the trigger: selectEvents reads the history store itself.
  const events = useHistoryStore((s) => s.events);
  const [demos, feedback] = useMemo(
    () =>
      (["item_added", "feedback_added"] as const).map(
        (action) =>
          selectEvents({ toolId: "sprint-review", action, sinceDays: 30, limit: 200 }).length
      ),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [events]
  );
  if (demos === 0 && feedback === 0) return null;
  return (
    <CalloutAlert tone="info" className="mb-0">
      Last 30 days: <strong>{demos}</strong> demo item{demos === 1 ? "" : "s"} added
      {feedback > 0 && (
        <>
          {" · "}
          <strong>{feedback}</strong> feedback item{feedback === 1 ? "" : "s"} captured
        </>
      )}
      .
    </CalloutAlert>
  );
}
