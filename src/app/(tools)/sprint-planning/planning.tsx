"use client";

import { useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import { useStore } from "zustand";
import { CalendarRange, Plus } from "lucide-react";
import { Button } from "@/components/ui/button";
import { EmptyState } from "@/components/shared/empty-state";
import { ExampleNotice, LoadExampleButton } from "@/components/tool-frame/example-data";
import { nextSprintName } from "@/components/sprints/sprint-picker";
import { NewSprintDialog } from "@/components/sprints/new-sprint-dialog";
import { LoadingSprints } from "@/components/sprints/start";
import { useWorkspaceStore } from "@/lib/stores/workspace-store";
import type { BacklogItem, CapacityPlan, Sprint, Story } from "@/lib/stores/workspace-types";
import { useWorkspaceHydrated } from "@/lib/team/use-team-roster";
import { useHistoryLogger } from "@/lib/history/use-history-logger";
import { useSelectedSprint } from "@/lib/sprints/use-selected-sprint";
import { useCeremonyCadence } from "@/lib/sprints/use-ceremony-cadence";
import { sprintsNewestFirst } from "@/lib/sprints/series";
import { usualSprintDays } from "@/app/(tools)/capacity-planner/model";
import { PlanningBoard } from "./board";
import { buildExample, type PlanningExample } from "./example";
import { createExampleStore, exampleWriter, liveWriter } from "./writer";

export const TOOL_ID = "sprint-planning";

const NO_STORIES: Story[] = [];
const NO_ITEMS: BacklogItem[] = [];
const NO_PLANS: CapacityPlan[] = [];
const noLog = () => {};

/**
 * What the page does, in one sentence, shown while the saved sprints load. The
 * server can't read them, so without it the first HTML of /sprint-planning,
 * all a search engine or an assistant reads, said only "Loading sprints…".
 */
export const PLANNING_ABOUT =
  "This page plans a sprint from top to bottom: the team's capacity and recent velocity, the sprint goal, the stories to pull in and size, then the commitment, all saved in this browser.";

/**
 * Sprint Planning: one page, top to bottom — the sprint, the team's
 * capacity and recent velocity, the goal, the stories (from the backlog,
 * left over from the last sprint, or typed), then the commitment.
 * Everything it writes goes to the shared sprint and stories, so the
 * cockpit, Burndown and the agent see the same plan. With no sprint yet it
 * offers to create one, or to look around an example plan held in memory.
 */
export function SprintPlanning() {
  const hydrated = useWorkspaceHydrated();
  const { sprints, selected, select } = useSelectedSprint();
  const stories = useWorkspaceStore((s) => s.stories) ?? NO_STORIES;
  const backlogItems = useWorkspaceStore((s) => s.backlogItems) ?? NO_ITEMS;
  const capacityPlans = useWorkspaceStore((s) => s.capacityPlans) ?? NO_PLANS;
  const [cadence] = useCeremonyCadence();
  // "A normal sprint" for the capacity forecast: the team's usual length.
  const usualDays = useMemo(() => usualSprintDays(cadence), [cadence]);
  const { log } = useHistoryLogger(TOOL_ID);
  const router = useRouter();
  const [creating, setCreating] = useState(false);
  const [example, setExample] = useState<PlanningExample | null>(null);

  if (!hydrated) return <LoadingSprints about={PLANNING_ABOUT} />;

  const dialog = (
    <NewSprintDialog
      open={creating}
      onOpenChange={setCreating}
      onCreated={(sprint: Sprint) => {
        setExample(null);
        select(sprint.id);
      }}
      defaultName={nextSprintName(sprints)}
      defaultLengthDays={cadence.sprintLengthDays}
    />
  );

  if (example) {
    return (
      <>
        <ExamplePlan
          example={example}
          usualDays={usualDays}
          onExit={() => setExample(null)}
          onStart={() => setCreating(true)}
        />
        {dialog}
      </>
    );
  }

  if (!selected) {
    return (
      <>
        <EmptyState
          icon={CalendarRange}
          action={
            <div className="flex flex-wrap justify-center gap-2">
              <Button type="button" onClick={() => setCreating(true)}>
                <Plus className="mr-1 h-4 w-4" aria-hidden="true" />
                Create the sprint
              </Button>
              <LoadExampleButton
                label="See an example plan"
                onLoad={() => setExample(buildExample())}
              />
            </div>
          }
        >
          <h2 className="font-display text-lg font-semibold text-text">No sprint to plan yet</h2>
          <p className="mx-auto mt-1 max-w-prose text-sm">
            Create the sprint first: a name, its first day and its length. Then plan it here, or
            look around an example plan first.
          </p>
        </EmptyState>
        {dialog}
      </>
    );
  }

  return (
    <>
      <PlanningBoard
        // A typed target belongs to one sprint: switching starts afresh.
        key={selected.id}
        data={{ sprints, sprint: selected, stories, backlogItems, capacityPlans, usualDays }}
        writer={liveWriter}
        onSelect={select}
        onNewSprint={() => setCreating(true)}
        onCommitted={() => router.push("/sprint")}
        log={log}
      />
      {dialog}
    </>
  );
}

/**
 * The example plan, in memory only: ticking, filling to capacity and
 * carrying over all work, and nothing reaches the workspace. "Clear
 * example" closes it; "Start your own" creates a real sprint.
 */
function ExamplePlan({
  example,
  usualDays,
  onExit,
  onStart,
}: {
  example: PlanningExample;
  usualDays: number;
  onExit: () => void;
  onStart: () => void;
}) {
  const [store] = useState(() => createExampleStore(example));
  const writer = useMemo(() => exampleWriter(store), [store]);
  const rawSprints = useStore(store, (s) => s.sprints);
  const stories = useStore(store, (s) => s.stories);
  const sprints = useMemo(() => sprintsNewestFirst(rawSprints), [rawSprints]);
  const [selectedId, setSelectedId] = useState(example.planning.id);
  const sprint = sprints.find((s) => s.id === selectedId) ?? sprints[0];

  return (
    <div>
      <ExampleNotice onClear={onExit} />
      <p className="-mt-2 mb-4 text-xs text-sub">
        Nothing in the example is saved: your sprints, stories and backlog stay as they are.
      </p>
      <PlanningBoard
        key={sprint.id}
        data={{
          sprints,
          sprint,
          stories,
          backlogItems: NO_ITEMS,
          capacityPlans: example.capacityPlans,
          usualDays,
        }}
        writer={writer}
        example
        onSelect={setSelectedId}
        onNewSprint={onStart}
        log={noLog}
      />
    </div>
  );
}
