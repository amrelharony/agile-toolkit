"use client";

import { useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { nanoid } from "nanoid";
import {
  AlertTriangle,
  ArrowRight,
  ListChecks,
  Plus,
  Rocket,
  Target,
  Users,
  Wand2,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { Field } from "@/components/ui/field";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { SectionCard } from "@/components/shared/section-card";
import { ExportButton } from "@/components/shared/export-button";
import { SprintPicker, nextSprintName } from "@/components/sprints/sprint-picker";
import { NewSprintDialog } from "@/components/sprints/new-sprint-dialog";
import { LoadingSprints } from "@/components/sprints/start";
import { useWorkspaceStore } from "@/lib/stores/workspace-store";
import type { BacklogItem, Sprint, Story } from "@/lib/stores/workspace-types";
import { useWorkspaceHydrated } from "@/lib/team/use-team-roster";
import { useHistoryLogger } from "@/lib/history/use-history-logger";
import { SPRINT_PLANNING_ACTIONS } from "@/lib/history/event-actions";
import { useSelectedSprint } from "@/lib/sprints/use-selected-sprint";
import { useCeremonyCadence } from "@/lib/sprints/use-ceremony-cadence";
import { updateSprint } from "@/lib/sprints/store";
import { averageVelocity, completedSprints, fmt } from "@/lib/sprints/hub-view";
import { selectStoriesForCapacity, storyPoints, totalStoryPoints } from "@/lib/sprints/plan";
import { CAPACITY_PLAN_ID, planCapacity } from "@/app/(tools)/capacity-planner/capacity";
import { currentPokerLog, pokerQueueRoute } from "@/lib/handoffs/targets/poker-queue";
import { undoable } from "@/lib/utils/undoable";
import { toast } from "@/lib/utils/toast";
import {
  backlogStories,
  importCandidates,
  planLine,
  planWarnings,
  sprintStories,
  storyFromBacklogItem,
} from "./view";
import { planToMarkdown } from "./markdown";

export const TOOL_ID = "sprint-planning";

const NO_STORIES: Story[] = [];
const NO_ITEMS: BacklogItem[] = [];

const STATUS_LABEL: Record<Story["status"], string> = {
  backlog: "Backlog",
  todo: "To do",
  in_progress: "In progress",
  review: "In review",
  done: "Done",
};

const slug = (s: string) =>
  s
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-|-$/g, "")
    .slice(0, 40) || "sprint";

/** A story's points, edited in a draft and saved on blur or Enter. */
function PointsCell({ story, onChange }: { story: Story; onChange: (points?: number) => void }) {
  const [draft, setDraft] = useState(storyPoints(story) > 0 ? String(story.points) : "");
  useEffect(() => setDraft(storyPoints(story) > 0 ? String(story.points) : ""), [story]);
  const commit = () => {
    const t = draft.trim();
    if (t === "") {
      if (storyPoints(story) > 0) onChange(undefined);
      return;
    }
    const n = Number(t);
    if (!Number.isFinite(n) || n < 0) {
      setDraft(storyPoints(story) > 0 ? String(story.points) : "");
      return;
    }
    if (n !== story.points) onChange(n);
  };
  return (
    <Input
      type="number"
      inputMode="decimal"
      min={0}
      step="any"
      aria-label={`Points for ${story.title}`}
      className="h-8 w-20 text-right"
      value={draft}
      placeholder="—"
      onChange={(e) => setDraft(e.target.value)}
      onBlur={commit}
      onKeyDown={(e) => {
        if (e.key === "Enter") {
          e.preventDefault();
          commit();
        }
      }}
    />
  );
}

/**
 * Sprint Planning: one page, top to bottom — the sprint, the team's
 * capacity and recent velocity, the goal, the stories (from the backlog or
 * typed), then the commitment. Everything it writes goes to the shared
 * sprint and stories, so the cockpit, Burndown and the agent see the same
 * plan.
 */
export function SprintPlanning() {
  const hydrated = useWorkspaceHydrated();
  const { sprints, selected, select } = useSelectedSprint();
  const stories = useWorkspaceStore((s) => s.stories) ?? NO_STORIES;
  const backlogItems = useWorkspaceStore((s) => s.backlogItems) ?? NO_ITEMS;
  const capacityPlan = useWorkspaceStore((s) =>
    (s.capacityPlans ?? []).find((p) => p.id === CAPACITY_PLAN_ID)
  );
  const upsertStory = useWorkspaceStore((s) => s.upsertStory);
  const removeStory = useWorkspaceStore((s) => s.removeStory);
  const [cadence] = useCeremonyCadence();
  const { log } = useHistoryLogger(TOOL_ID);
  const router = useRouter();
  const [creating, setCreating] = useState(false);
  const [target, setTarget] = useState("");
  const [newTitle, setNewTitle] = useState("");
  const [newPoints, setNewPoints] = useState("");

  const capacity = useMemo(
    () => (capacityPlan ? planCapacity(capacityPlan) : null),
    [capacityPlan]
  );
  const velocity = useMemo(
    () => averageVelocity(completedSprints(sprints), selected?.id),
    [sprints, selected?.id]
  );
  const inSprint = useMemo(
    () => (selected ? sprintStories(stories, selected.id) : []),
    [stories, selected]
  );
  const backlog = useMemo(() => backlogStories(stories), [stories]);
  const candidates = useMemo(
    () => importCandidates(backlogItems, stories),
    [backlogItems, stories]
  );
  const typedTarget = target.trim() === "" ? null : Number(target);
  const targetPoints =
    typedTarget !== null
      ? Number.isFinite(typedTarget) && typedTarget >= 0
        ? typedTarget
        : null
      : velocity.average;
  const otherActive = useMemo(
    () => sprints.filter((s) => s.status === "active" && s.id !== selected?.id),
    [sprints, selected?.id]
  );
  const warnings = useMemo(
    () =>
      selected
        ? planWarnings({ sprint: selected, stories: inSprint, targetPoints, otherActive })
        : [],
    [selected, inSprint, targetPoints, otherActive]
  );
  const unsized = useMemo(() => inSprint.filter((s) => storyPoints(s) <= 0), [inSprint]);
  const planned = totalStoryPoints(inSprint);

  const markdown = useMemo(
    () =>
      selected
        ? planToMarkdown({
            sprint: selected,
            stories: inSprint,
            capacityHours: capacity?.totalHours ?? null,
            targetPoints,
            averageVelocity: velocity.average,
          })
        : "",
    [selected, inSprint, capacity, targetPoints, velocity.average]
  );

  if (!hydrated) return <LoadingSprints />;

  const onCreated = (sprint: Sprint) => select(sprint.id);

  if (!selected) {
    return (
      <>
        <section className="flex flex-col items-start gap-3 rounded-lg border border-dashed border-border bg-card p-6">
          <h2 className="font-display text-lg font-semibold text-text">No sprint to plan yet</h2>
          <p className="max-w-prose text-sm text-sub">
            Create the sprint first: a name, its first day and its length. Then plan it here.
          </p>
          <Button type="button" onClick={() => setCreating(true)}>
            <Plus className="mr-1 h-4 w-4" aria-hidden="true" />
            Create the sprint
          </Button>
        </section>
        <NewSprintDialog
          open={creating}
          onOpenChange={setCreating}
          onCreated={onCreated}
          defaultName={nextSprintName(sprints)}
          defaultLengthDays={cadence.sprintLengthDays}
        />
      </>
    );
  }

  const sprint = selected;

  /* ── Stories ──────────────────────────────────────────────────────────── */

  const moveIn = (story: Story) =>
    upsertStory({
      ...story,
      sprintId: sprint.id,
      status: story.status === "backlog" ? "todo" : story.status,
    });
  const moveOut = (story: Story) => {
    const { sprintId: _dropped, ...rest } = story;
    void _dropped;
    upsertStory({ ...rest, status: "backlog" });
  };

  const addStory = () => {
    const title = newTitle.trim();
    if (!title) return;
    const n = newPoints.trim() === "" ? undefined : Number(newPoints);
    const story: Story = {
      id: `story_${nanoid(8)}`,
      title: title.slice(0, 200),
      status: "todo",
      sprintId: sprint.id,
      ...(n !== undefined && Number.isFinite(n) && n > 0 ? { points: n } : {}),
    };
    upsertStory(story);
    log(SPRINT_PLANNING_ACTIONS.STORY_ADDED, { sprintId: sprint.id, storyId: story.id, title });
    setNewTitle("");
    setNewPoints("");
  };

  const fillToCapacity = () => {
    if (targetPoints === null || targetPoints <= 0) {
      toast.error("Set the points to commit to first.");
      return;
    }
    const room = Math.round((targetPoints - planned) * 10) / 10;
    if (room <= 0) {
      toast.info("The sprint is already at capacity.");
      return;
    }
    const { selected: picked, totalPoints } = selectStoriesForCapacity(backlog, room);
    if (picked.length === 0) {
      toast.info("No sized backlog story fits in the points left.");
      return;
    }
    const before = picked.map((s) => ({ ...s }));
    undoable({
      label: `${picked.length} ${picked.length === 1 ? "story" : "stories"} added to ${sprint.name}`,
      description: `${fmt(totalPoints)} points, highest priority first`,
      apply: () => {
        for (const s of picked) moveIn(s);
      },
      revert: () => {
        for (const s of before) upsertStory(s);
      },
    });
    log(SPRINT_PLANNING_ACTIONS.FILLED_TO_CAPACITY, {
      sprintId: sprint.id,
      count: picked.length,
      points: totalPoints,
    });
  };

  const importFromBacklog = () => {
    if (candidates.length === 0) return;
    const created = candidates.map((item) => storyFromBacklogItem(item, `story_${nanoid(8)}`));
    undoable({
      label: `${created.length} ${created.length === 1 ? "story" : "stories"} imported from the backlog`,
      description: "Ordered by their WSJF score",
      apply: () => {
        for (const s of created) upsertStory(s);
      },
      revert: () => {
        for (const s of created) removeStory(s.id);
      },
    });
    log(SPRINT_PLANNING_ACTIONS.STORIES_IMPORTED, { sprintId: sprint.id, count: created.length });
  };

  const queueUnsized = () => {
    const queued = new Set(
      (currentPokerLog()?.queue ?? [])
        .filter((q) => q.sourceRef.tool === "story")
        .map((q) => q.sourceRef.id)
    );
    const toQueue = unsized.filter((s) => !queued.has(s.id));
    for (const s of toQueue) {
      pokerQueueRoute.send({ title: s.title, sourceRef: { tool: "story", id: s.id } });
    }
    toast.success(
      toQueue.length === 0
        ? "Those stories are already in the Planning Poker queue."
        : `${toQueue.length} ${toQueue.length === 1 ? "story" : "stories"} queued for Planning Poker`
    );
  };

  const saveGoal = (value: string) => {
    const goal = value.trim();
    if (goal !== (sprint.goal ?? "").trim()) updateSprint(sprint.id, { goal: goal || undefined });
  };

  const commit = () => {
    const prev = { pointsPlanned: sprint.pointsPlanned, status: sprint.status };
    const starting = sprint.status !== "active";
    undoable({
      label: starting ? `${sprint.name} started` : `${sprint.name} updated`,
      description: `${fmt(planned)} points committed`,
      apply: () => {
        updateSprint(sprint.id, {
          pointsPlanned: planned,
          ...(starting ? { status: "active" as const } : {}),
        });
      },
      revert: () => {
        updateSprint(sprint.id, prev);
      },
    });
    log(SPRINT_PLANNING_ACTIONS.SPRINT_COMMITTED, {
      sprintId: sprint.id,
      name: sprint.name,
      pointsPlanned: planned,
      stories: inSprint.length,
    });
    router.push("/sprint");
  };

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div className="flex min-w-0 flex-wrap items-end gap-2">
          <SprintPicker
            sprints={[...sprints]}
            selectedId={sprint.id}
            onSelect={select}
            allowCreate={false}
          />
          <Button type="button" variant="outline" size="sm" onClick={() => setCreating(true)}>
            <Plus className="mr-1 h-4 w-4" aria-hidden="true" />
            New sprint
          </Button>
        </div>
        <ExportButton
          filename={`sprint-plan-${slug(sprint.name)}`}
          markdown={markdown}
          clipboardText={markdown}
          jsonData={{ sprint, stories: inSprint }}
        />
      </div>

      {/* 1. Capacity */}
      <SectionCard title="1. Capacity and commitment" icon={Users}>
        <div className="grid gap-4 sm:grid-cols-3">
          <div className="rounded-lg border border-border bg-surface/40 p-3">
            <p className="text-xs font-medium uppercase tracking-wide text-sub">Team capacity</p>
            <p
              className="mt-1 font-data text-2xl font-semibold text-text"
              data-field="capacity-hours"
            >
              {capacity && capacity.perMember.length > 0 ? `${fmt(capacity.totalHours)} h` : "—"}
            </p>
            <p className="text-xs text-sub">
              {capacity && capacity.perMember.length > 0
                ? `${capacity.perMember.length} ${capacity.perMember.length === 1 ? "person" : "people"}, days off and ceremonies taken out`
                : "No capacity plan yet"}
              {" · "}
              <Link href="/capacity-planner" className="text-accent hover:underline">
                Capacity Planner
              </Link>
            </p>
          </div>
          <div className="rounded-lg border border-border bg-surface/40 p-3">
            <p className="text-xs font-medium uppercase tracking-wide text-sub">Recent velocity</p>
            <p className="mt-1 font-data text-2xl font-semibold text-text" data-field="velocity">
              {velocity.average === null ? "—" : `${fmt(velocity.average)} pts`}
            </p>
            <p className="text-xs text-sub">
              {velocity.average === null
                ? "No finished sprint yet"
                : `Average of the last ${velocity.count} ${velocity.count === 1 ? "sprint" : "sprints"}`}
              {" · "}
              <Link href="/velocity" className="text-accent hover:underline">
                Velocity
              </Link>
            </p>
          </div>
          <Field
            label="Commit to"
            hint={
              velocity.average === null
                ? "Points this sprint can take"
                : `Blank uses the velocity average, ${fmt(velocity.average)}`
            }
          >
            {(control) => (
              <div className="flex items-center gap-2">
                <Input
                  {...control}
                  type="number"
                  inputMode="decimal"
                  min={0}
                  step="any"
                  value={target}
                  placeholder={velocity.average === null ? "" : fmt(velocity.average)}
                  onChange={(e) => setTarget(e.target.value)}
                />
                <span className="text-sm text-sub">points</span>
              </div>
            )}
          </Field>
        </div>
      </SectionCard>

      {/* 2. Goal */}
      <SectionCard title="2. Sprint goal" icon={Target}>
        <GoalEditor key={sprint.id} goal={sprint.goal ?? ""} onSave={saveGoal} />
        <p className="mt-2 text-xs text-sub">
          Want help wording it? The{" "}
          <Link href="/sprint-goal" className="text-accent hover:underline">
            Sprint Goal Builder
          </Link>{" "}
          walks from the business objective to a testable goal and writes it here.
        </p>
      </SectionCard>

      {/* 3. Stories */}
      <SectionCard
        title="3. Stories"
        icon={ListChecks}
        actions={
          <div className="flex flex-wrap gap-2">
            <Button type="button" variant="outline" size="sm" onClick={fillToCapacity}>
              <Wand2 className="mr-1 h-4 w-4" aria-hidden="true" />
              Fill to capacity
            </Button>
            <Button
              type="button"
              variant="outline"
              size="sm"
              disabled={candidates.length === 0}
              onClick={importFromBacklog}
            >
              Import from the backlog{candidates.length > 0 ? ` (${candidates.length})` : ""}
            </Button>
            {unsized.length > 0 && (
              <Button type="button" variant="outline" size="sm" onClick={queueUnsized}>
                Estimate {unsized.length} in Planning Poker
              </Button>
            )}
          </div>
        }
      >
        <div className="space-y-5">
          <div>
            <h3 className="mb-2 text-sm font-semibold text-text">
              In {sprint.name} <span className="font-normal text-sub">· {planLine(inSprint)}</span>
            </h3>
            {inSprint.length === 0 ? (
              <p className="text-sm text-sub">
                Nothing yet. Tick backlog stories below, fill to capacity, or add a story.
              </p>
            ) : (
              <StoryTable
                stories={inSprint}
                checked
                onToggle={moveOut}
                onPoints={(s, points) => upsertStory({ ...s, points })}
                showStatus
              />
            )}
            <form
              className="mt-3 flex flex-wrap items-end gap-2"
              onSubmit={(e) => {
                e.preventDefault();
                addStory();
              }}
            >
              <Field label="New story" hideLabel className="min-w-[14rem] flex-1">
                {(control) => (
                  <Input
                    {...control}
                    value={newTitle}
                    placeholder="Add a story and press Enter"
                    maxLength={200}
                    onChange={(e) => setNewTitle(e.target.value)}
                  />
                )}
              </Field>
              <Field label="Points" hideLabel className="w-24">
                {(control) => (
                  <Input
                    {...control}
                    type="number"
                    inputMode="decimal"
                    min={0}
                    step="any"
                    value={newPoints}
                    placeholder="Points"
                    onChange={(e) => setNewPoints(e.target.value)}
                  />
                )}
              </Field>
              <Button type="submit" variant="outline" size="sm" disabled={!newTitle.trim()}>
                <Plus className="mr-1 h-4 w-4" aria-hidden="true" />
                Add
              </Button>
            </form>
          </div>

          <div>
            <h3 className="mb-2 text-sm font-semibold text-text">
              Backlog{" "}
              <span className="font-normal text-sub">
                · {backlog.length} {backlog.length === 1 ? "story" : "stories"}, highest priority
                first
              </span>
            </h3>
            {backlog.length === 0 ? (
              <p className="text-sm text-sub">
                The backlog is empty.{" "}
                {candidates.length > 0
                  ? "Import the Prioritizer's backlog above, or add stories."
                  : "Add stories above, or score ideas in the Backlog Prioritizer first."}
              </p>
            ) : (
              <StoryTable
                stories={backlog}
                checked={false}
                onToggle={moveIn}
                onPoints={(s, points) => upsertStory({ ...s, points })}
                showPriority
              />
            )}
          </div>
        </div>
      </SectionCard>

      {/* 4. Commit */}
      <SectionCard title="4. Commit" icon={Rocket}>
        <p className="text-sm text-text" data-field="commitment">
          <span className="font-semibold">{planLine(inSprint)}</span>
          {targetPoints !== null && targetPoints > 0 && (
            <span className="text-sub">
              {" "}
              against {fmt(targetPoints)} points of capacity
              {planned > 0 ? ` (${Math.round((planned / targetPoints) * 100)}%)` : ""}
            </span>
          )}
        </p>
        {warnings.length > 0 && (
          <ul className="mt-3 space-y-1.5" aria-label="Things to check">
            {warnings.map((w) => (
              <li key={w.id} className="flex items-start gap-2 text-sm text-text">
                <AlertTriangle
                  className="mt-0.5 h-4 w-4 shrink-0 text-warning"
                  aria-hidden="true"
                />
                {w.text}
              </li>
            ))}
          </ul>
        )}
        <div className="mt-4 flex flex-wrap items-center gap-3">
          <Button type="button" onClick={commit} disabled={inSprint.length === 0}>
            <Rocket className="mr-1 h-4 w-4" aria-hidden="true" />
            {sprint.status === "active" ? "Update the commitment" : "Start the sprint"}
          </Button>
          <Link
            href="/sprint"
            className="inline-flex items-center gap-1 text-sm font-medium text-sub hover:text-accent"
          >
            Sprint Cockpit
            <ArrowRight className="h-3.5 w-3.5" aria-hidden="true" />
          </Link>
        </div>
      </SectionCard>

      <NewSprintDialog
        open={creating}
        onOpenChange={setCreating}
        onCreated={onCreated}
        defaultName={nextSprintName(sprints)}
        defaultLengthDays={cadence.sprintLengthDays}
      />
    </div>
  );
}

/** The goal, edited in a draft and saved when the field loses focus. */
function GoalEditor({ goal, onSave }: { goal: string; onSave: (value: string) => void }) {
  const [draft, setDraft] = useState(goal);
  useEffect(() => setDraft(goal), [goal]);
  return (
    <Field label="Sprint goal" hint="One sentence the team can say yes or no to at the review.">
      {(control) => (
        <Textarea
          {...control}
          value={draft}
          maxLength={200}
          rows={2}
          placeholder="e.g. Customers can pay with a saved card"
          onChange={(e) => setDraft(e.target.value)}
          onBlur={() => onSave(draft)}
        />
      )}
    </Field>
  );
}

function StoryTable({
  stories,
  checked,
  onToggle,
  onPoints,
  showStatus,
  showPriority,
}: {
  stories: readonly Story[];
  checked: boolean;
  onToggle: (story: Story) => void;
  onPoints: (story: Story, points: number | undefined) => void;
  showStatus?: boolean;
  showPriority?: boolean;
}) {
  return (
    <ul className="divide-y divide-border rounded-lg border border-border">
      {stories.map((story) => (
        <li key={story.id} className="flex items-center gap-3 px-3 py-2">
          <input
            type="checkbox"
            className="h-4 w-4 shrink-0 accent-[var(--accent)]"
            checked={checked}
            aria-label={`${checked ? "Remove from sprint" : "Add to sprint"}: ${story.title}`}
            onChange={() => onToggle(story)}
          />
          <span className="min-w-0 flex-1">
            <span className="block break-words text-sm text-text">{story.title}</span>
            <span className="block text-xs text-sub">
              {showStatus && STATUS_LABEL[story.status]}
              {showStatus && story.owner ? ` · ${story.owner}` : (story.owner ?? "")}
              {showPriority &&
                (typeof story.priorityScore === "number"
                  ? `Priority ${story.priorityScore}`
                  : "Not scored")}
            </span>
          </span>
          <PointsCell story={story} onChange={(points) => onPoints(story, points)} />
        </li>
      ))}
    </ul>
  );
}
