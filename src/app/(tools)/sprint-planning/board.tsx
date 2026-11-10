"use client";

import { useEffect, useId, useMemo, useRef, useState, type ReactNode } from "react";
import Link from "next/link";
import { nanoid } from "nanoid";
import {
  AlertTriangle,
  ArrowRight,
  ClipboardPaste,
  History,
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
import { ItemForm, useItemForm } from "@/components/shared/item-form";
import { SprintPicker } from "@/components/sprints/sprint-picker";
import type { BacklogItem, CapacityPlan, Sprint, Story } from "@/lib/stores/workspace-types";
import { useWorkspaceStore } from "@/lib/stores/workspace-store";
import { SPRINT_PLANNING_ACTIONS } from "@/lib/history/event-actions";
import { averageVelocity, completedSprints } from "@/lib/sprints/hub-view";
import { sprintHref } from "@/lib/sprints/use-selected-sprint";
import { backlogOrderText, storyPoints, totalStoryPoints } from "@/lib/sprints/plan";
import {
  currentPokerLog,
  pokerQueueRoute,
  storyQueueSource,
} from "@/lib/handoffs/targets/poker-queue";
import { withStoryDetails, type StoryDetails } from "@/lib/stories/fields";
import { keptForSprintNote, sprintKeepingStory, storyRemoval } from "@/lib/stories/removal";
import { leftOutMessage, splitPastedLines } from "@/lib/utils/paste-lines";
import { undoable } from "@/lib/utils/undoable";
import { toast } from "@/lib/utils/toast";
import {
  EMPTY_STORY_DRAFT,
  PASTE_STORIES_CAP,
  backlogStories,
  carryOverLabel,
  fmt,
  forecastText,
  importCandidates,
  isClosed,
  leftoverGroups,
  planFill,
  planLine,
  planWarnings,
  pointsCount,
  readCapacity,
  skippedText,
  sprintStories,
  storiesCount,
  storyFromBacklogItem,
  suggestedPoints,
  targetError,
  usesReadiness,
  validateStory,
  type LeftoverGroup,
  type PasteValues,
  type StoryDraft,
  type StoryField,
  type StoryValues,
} from "./view";
import { planToMarkdown } from "./markdown";
import { PasteStories } from "./paste-stories";
import { StoryList, focusAfterMove, type FocusTarget } from "./story-list";
import { placeStory, restoreStories, type PlanningWriter } from "./writer";

export interface PlanningData {
  /** Every sprint, newest first. */
  sprints: Sprint[];
  /** The sprint being planned. */
  sprint: Sprint;
  stories: Story[];
  backlogItems: BacklogItem[];
  capacityPlans: CapacityPlan[];
  /** The team's usual sprint in working days (from the cadence): "a normal sprint". */
  usualDays?: number;
}

const slug = (s: string) =>
  s
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-|-$/g, "")
    .slice(0, 40) || "sprint";

const round1 = (n: number) => Math.round(n * 10) / 10;

const shortTitle = (t: string, max = 40) => {
  const s = t.trim();
  return s.length > max ? `${s.slice(0, max - 1).trimEnd()}…` : s;
};

/**
 * The plan itself, top to bottom: the sprint, the team's capacity and
 * recent velocity with the points they suggest, the goal, the stories (in
 * the sprint, left over from a closed sprint, the backlog), then the
 * commitment. It reads `data` and writes through `writer`, so the same
 * board plans the shared sprint and the in-memory example.
 */
export function PlanningBoard({
  data,
  writer,
  example = false,
  onSelect,
  onNewSprint,
  onCommitted,
  log,
}: {
  data: PlanningData;
  writer: PlanningWriter;
  /** The example: nothing is queued for Poker, and the sprint can't be started. */
  example?: boolean;
  onSelect: (id: string) => void;
  onNewSprint: () => void;
  /** After "Start the sprint" (the page opens the cockpit). */
  onCommitted?: () => void;
  log: (action: string, payload: Record<string, unknown>) => void;
}) {
  const { sprints, sprint, stories, backlogItems, capacityPlans, usualDays } = data;
  const [target, setTarget] = useState("");
  // The number field's own verdict on the last keystroke ("3e" reads as blank).
  const [targetBad, setTargetBad] = useState(false);
  const rootRef = useRef<HTMLDivElement>(null);
  const sprintHeadingId = useId();
  const backlogHeadingId = useId();
  // Where focus goes after the next move (see focusAfterMove), and what the
  // live region says about it.
  const refocus = useRef<FocusTarget | null>(null);
  const [announcement, setAnnouncement] = useState("");

  const velocity = useMemo(
    () => averageVelocity(completedSprints(sprints), sprint.id),
    [sprints, sprint.id]
  );
  const capacity = useMemo(
    () => readCapacity(capacityPlans, sprint.id, velocity.average, usualDays),
    [capacityPlans, sprint.id, velocity.average, usualDays]
  );
  const suggestion = suggestedPoints(capacity, velocity.average);
  const inSprint = useMemo(() => sprintStories(stories, sprint.id), [stories, sprint.id]);
  // In the backlog's decided order as it is now (a story reads its item's live rank).
  const backlog = useMemo(() => backlogStories(stories, backlogItems), [stories, backlogItems]);
  const leftovers = useMemo(
    () => leftoverGroups(sprints, stories, sprint.id),
    [sprints, stories, sprint.id]
  );
  const candidates = useMemo(
    () => importCandidates(backlogItems, stories),
    [backlogItems, stories]
  );
  const typedTarget = target.trim() === "" ? null : Number(target);
  const targetProblem = targetError(target, targetBad);
  const targetPoints =
    targetProblem !== undefined ? null : typedTarget !== null ? typedTarget : suggestion;
  const otherActive = useMemo(
    () => sprints.filter((s) => s.status === "active" && s.id !== sprint.id),
    [sprints, sprint.id]
  );
  const checkReadiness = useMemo(() => usesReadiness(stories), [stories]);
  const warnings = useMemo(
    () => planWarnings({ sprint, stories: inSprint, targetPoints, otherActive, checkReadiness }),
    [sprint, inSprint, targetPoints, otherActive, checkReadiness]
  );
  const unsized = useMemo(() => inSprint.filter((s) => storyPoints(s) <= 0), [inSprint]);
  const planned = totalStoryPoints(inSprint);
  const closed = isClosed(sprint);

  const markdown = useMemo(
    () =>
      planToMarkdown({
        sprint,
        stories: inSprint,
        capacityHours: capacity.hours,
        targetPoints,
        averageVelocity: velocity.average,
        capacityRatio: capacity.ratio,
        suggestedPoints: suggestion,
        leftovers,
      }),
    [sprint, inSprint, capacity, targetPoints, velocity.average, suggestion, leftovers]
  );

  /* ── Stories ──────────────────────────────────────────────────────────── */

  /** The story as stored now, for an Undo snapshot. */
  const fresh = (story: Story) => writer.stories().find((s) => s.id === story.id) ?? story;

  // A carried-over story keeps its status (work in progress stays in
  // progress); one from the backlog becomes "to do". Nothing goes into a
  // closed sprint: its boxes are locked, this is the guard.
  const moveIn = (story: Story) => {
    if (closed) return;
    placeStory(writer, story.id, sprint.id, story.status === "backlog" ? "todo" : story.status);
  };

  /** Moves the story out; true when an undoable toast says so. */
  const moveOut = (story: Story): boolean => {
    // Done stays done, in its sprint: the box is locked, this is the guard.
    if (story.status === "done") return false;
    const before = fresh(story);
    const apply = () => placeStory(writer, story.id, undefined, "backlog");
    if (story.status === "in_progress" || story.status === "review") {
      // Work had started: going back to the backlog clears its start time.
      undoable({
        label: `Moved “${shortTitle(story.title)}” back to the backlog`,
        description: "Work on it had started; Undo puts it back as it was.",
        apply,
        revert: () => restoreStories(writer, [before]),
      });
      return true;
    }
    apply();
    return false;
  };

  // After a move, focus goes to the story now in the moved one's place (or
  // the section's heading), and the live region says where the story went.
  useEffect(() => {
    const next = refocus.current;
    if (!next) return;
    refocus.current = null;
    focusAfterMove(rootRef.current, next);
  });

  /** A tick in `listKey` (the backlog, or a closed sprint's left-overs): into the sprint. */
  const tickIn = (listKey: string) => (story: Story, index: number) => {
    if (closed) return;
    refocus.current = { listKey, index, fallbackId: sprintHeadingId };
    moveIn(story);
    setAnnouncement(`Added “${shortTitle(story.title)}” to ${sprint.name}.`);
  };

  const tickOut = (story: Story, index: number) => {
    refocus.current = { listKey: "sprint", index, fallbackId: sprintHeadingId };
    const toasted = moveOut(story);
    // The undoable toast announces itself; say it once.
    setAnnouncement(toasted ? "" : `Moved “${shortTitle(story.title)}” back to the backlog.`);
  };

  const setPoints = (story: Story, points: number | undefined) => {
    const next: Story = { ...fresh(story) };
    if (points === undefined) delete next.points;
    else next.points = points;
    writer.upsertStory(next);
  };

  const rename = (story: Story, title: string) =>
    writer.upsertStory({ ...fresh(story), title: title.slice(0, 200) });

  /** The story's acceptance criteria, notes, ticket key and link, as its Details form saved them. */
  const saveDetails = (story: Story, details: StoryDetails) =>
    writer.upsertStory(withStoryDetails(fresh(story), details));

  /** What a row's remove control may do: delete, leave a running sprint, or nothing. */
  const removalOf = (story: Story) => storyRemoval(story, sprints);

  /**
   * Why a story that has left a running or closed sprint has no bin: that
   * sprint's charts still count it. Undefined for every other story.
   */
  const keptNoteOf = (story: Story) => {
    const kept = sprintKeepingStory(story, sprints);
    return kept ? keptForSprintNote(kept.name) : undefined;
  };

  /**
   * The bin on a row of `listKey`: the story is deleted, with Undo back to
   * its place. Only where `storyRemoval` allows it (the backlog, or a sprint
   * that hasn't started, for a story no started sprint still counts): the
   * row shows no bin otherwise, this is the guard.
   */
  const deleteStory = (listKey: string, fallbackId: string) => (story: Story, index: number) => {
    if (removalOf(fresh(story)) !== "delete") return;
    refocus.current = { listKey, index, fallbackId };
    let restore: (() => void) | null = null;
    undoable({
      label: `Deleted “${shortTitle(story.title)}”`,
      apply: () => {
        restore = writer.deleteStory(story.id);
      },
      revert: () => restore?.(),
    });
    // The undoable toast announces itself; say it once.
    setAnnouncement("");
    log(SPRINT_PLANNING_ACTIONS.STORY_DELETED, { storyId: story.id, title: story.title });
  };

  /* ── Paste stories ────────────────────────────────────────────────────── */

  // The list being pasted (null: the panel is closed), and whether it came
  // from the sprint's own add field, which ticks "into the sprint" for it.
  const [pasting, setPasting] = useState<{ text: string; intoSprint: boolean } | null>(null);
  const pasteButton = useRef<HTMLButtonElement>(null);
  const closePaste = () => {
    setPasting(null);
    pasteButton.current?.focus();
  };

  /** Every pasted title becomes a story, in the pasted order, with one Undo for the lot. */
  const addPasted = ({ titles, dropped, cut, intoSprint }: PasteValues) => {
    const inSprintNow = intoSprint && !closed;
    const created = titles.map(
      (title): Story => ({
        id: `story_${nanoid(8)}`,
        title,
        ...(inSprintNow
          ? { status: "todo" as const, sprintId: sprint.id }
          : { status: "backlog" as const }),
      })
    );
    const notes = [
      dropped > 0 ? leftOutMessage(dropped) : "",
      cut > 0 ? `${cut} ${cut === 1 ? "title was" : "titles were"} cut to 200 characters.` : "",
    ].filter(Boolean);
    undoable({
      label: `Added ${storiesCount(created.length)} to ${inSprintNow ? sprint.name : "the backlog"}`,
      description: notes.length > 0 ? notes.join(" ") : undefined,
      apply: () => {
        for (const s of created) writer.upsertStory(s);
      },
      revert: () => {
        for (const s of created) writer.removeStory(s.id);
      },
    });
    log(SPRINT_PLANNING_ACTIONS.STORIES_PASTED, {
      sprintId: sprint.id,
      count: created.length,
      intoSprint: inSprintNow,
    });
  };

  const form = useItemForm<StoryDraft, StoryValues, StoryField>({
    initial: EMPTY_STORY_DRAFT,
    validate: validateStory,
    onSave: ({ title, points }) => {
      const story: Story = {
        id: `story_${nanoid(8)}`,
        title,
        status: "todo",
        sprintId: sprint.id,
        ...(points !== undefined ? { points } : {}),
      };
      writer.upsertStory(story);
      log(SPRINT_PLANNING_ACTIONS.STORY_ADDED, { sprintId: sprint.id, storyId: story.id, title });
    },
  });

  // The group's section goes once it is settled: focus moves to where its
  // stories went.
  const carryGroup = (group: LeftoverGroup) => {
    if (closed) return;
    const before = group.stories.map(fresh);
    refocus.current = { fallbackId: sprintHeadingId };
    undoable({
      label: `Carried ${storiesCount(before.length)} over to ${sprint.name}`,
      description: `${pointsCount(group.points)} left over from ${group.sprint.name}`,
      apply: () => {
        for (const s of before) moveIn(s);
      },
      revert: () => restoreStories(writer, before),
    });
    log(SPRINT_PLANNING_ACTIONS.STORIES_CARRIED_OVER, {
      sprintId: sprint.id,
      fromSprintId: group.sprint.id,
      count: before.length,
    });
  };

  const sendGroupBack = (group: LeftoverGroup) => {
    const before = group.stories.map(fresh);
    refocus.current = { fallbackId: backlogHeadingId };
    undoable({
      label: `Moved ${storiesCount(before.length)} from ${group.sprint.name} back to the backlog`,
      description: `${pointsCount(group.points)}, ready to plan again`,
      apply: () => {
        for (const s of before) placeStory(writer, s.id, undefined, "backlog");
      },
      revert: () => restoreStories(writer, before),
    });
    log(SPRINT_PLANNING_ACTIONS.STORIES_RETURNED, {
      fromSprintId: group.sprint.id,
      count: before.length,
    });
  };

  const fillToCapacity = () => {
    if (closed) return;
    if (targetPoints === null || targetPoints <= 0) {
      toast.error("Set the points to commit to first.");
      return;
    }
    const room = round1(targetPoints - planned);
    if (room <= 0) {
      toast.info("The sprint is already at capacity.");
      return;
    }
    const fill = planFill(backlog, room);
    const skipped = skippedText(fill);
    if (fill.selected.length === 0) {
      toast.info("No sized backlog story fits in the points left.", { description: skipped });
      return;
    }
    const before = fill.selected.map(fresh);
    undoable({
      label: `${storiesCount(before.length)} added to ${sprint.name}`,
      description: [`${fmt(fill.totalPoints)} points, ${backlogOrderText(fill.selected)}.`, skipped]
        .filter(Boolean)
        .join(" "),
      apply: () => {
        for (const s of before) moveIn(s);
      },
      revert: () => restoreStories(writer, before),
    });
    log(SPRINT_PLANNING_ACTIONS.FILLED_TO_CAPACITY, {
      sprintId: sprint.id,
      count: before.length,
      points: fill.totalPoints,
      skipped: fill.tooBig.length + fill.unestimated.length,
    });
  };

  const importFromBacklog = () => {
    if (candidates.length === 0) return;
    // With the method rows, so an item whose WSJF only a row linked before
    // Phase 7 holds imports with that score, as the hub shows it.
    const rows = useWorkspaceStore.getState().prioritizations ?? [];
    const created = candidates.map((item) =>
      storyFromBacklogItem(item, `story_${nanoid(8)}`, rows)
    );
    undoable({
      label: `${storiesCount(created.length)} imported from the backlog`,
      // The backlog lists them in the shared order (compareBacklogOrder): say which.
      description: `Ordered ${backlogOrderText(created)}.`,
      apply: () => {
        for (const s of created) writer.upsertStory(s);
      },
      revert: () => {
        for (const s of created) writer.removeStory(s.id);
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
      // With its notes and acceptance criteria, as the description Poker shows.
      pokerQueueRoute.send(storyQueueSource(s));
    }
    toast.success(
      toQueue.length === 0
        ? "Those stories are already in the Planning Poker queue."
        : `${storiesCount(toQueue.length)} queued for Planning Poker`
    );
  };

  const saveGoal = (value: string) => {
    const goal = value.trim();
    if (goal !== (sprint.goal ?? "").trim()) {
      writer.updateSprint(sprint.id, { goal: goal || undefined });
    }
  };

  const commit = () => {
    // Starting a closed sprint again would take it out of velocity (only
    // completed sprints count); the button isn't offered, this is the guard.
    if (closed) return;
    const prev = { pointsPlanned: sprint.pointsPlanned, status: sprint.status };
    const starting = sprint.status !== "active";
    undoable({
      label: starting ? `${sprint.name} started` : `${sprint.name} updated`,
      description: `${fmt(planned)} points committed`,
      apply: () => {
        writer.updateSprint(sprint.id, {
          pointsPlanned: planned,
          ...(starting ? { status: "active" as const } : {}),
        });
      },
      revert: () => {
        writer.updateSprint(sprint.id, prev);
      },
    });
    log(SPRINT_PLANNING_ACTIONS.SPRINT_COMMITTED, {
      sprintId: sprint.id,
      name: sprint.name,
      pointsPlanned: planned,
      stories: inSprint.length,
    });
    onCommitted?.();
  };

  const capacityNote = !capacity.plan
    ? "No capacity plan yet"
    : capacity.people === 0
      ? "Nobody in the capacity plan yet"
      : `${capacity.people} ${capacity.people === 1 ? "person" : "people"}, from ${
          capacity.perSprint ? `${sprint.name}'s plan` : "your general plan"
        }${capacity.example ? " (example members)" : ""}`;

  const closedNote = closed
    ? `${sprint.name} is ${sprint.status === "cancelled" ? "cancelled" : "completed"}, so nothing more can be planned into it. Pick a sprint that is still open, or start a new one.`
    : undefined;
  const cantAdd = closed ? `${sprint.name} is closed` : undefined;

  return (
    <div ref={rootRef} className="space-y-6">
      <p role="status" aria-live="polite" className="sr-only">
        {announcement}
      </p>
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div className="flex min-w-0 flex-wrap items-end gap-2">
          <SprintPicker
            sprints={[...sprints]}
            selectedId={sprint.id}
            onSelect={onSelect}
            allowCreate={false}
          />
          <Button type="button" variant="outline" size="sm" onClick={onNewSprint}>
            <Plus className="mr-1 h-4 w-4" aria-hidden="true" />
            {example ? "Start your own" : "New sprint"}
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
              {capacity.hours !== null ? `${fmt(capacity.hours)} h` : "—"}
            </p>
            <p className="text-xs text-sub">
              {capacityNote}
              {" · "}
              <Link
                href={sprintHref("/capacity-planner", sprint.id)}
                className="text-accent hover:underline"
              >
                {capacity.perSprint || !capacity.plan
                  ? "Capacity Planner"
                  : `Plan ${sprint.name}'s capacity`}
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
              suggestion === null
                ? "Points this sprint can take"
                : `Blank uses the suggestion, ${fmt(suggestion)}`
            }
            error={targetProblem}
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
                  placeholder={suggestion === null ? "" : fmt(suggestion)}
                  onChange={(e) => {
                    setTarget(e.target.value);
                    setTargetBad(e.currentTarget.validity?.badInput === true);
                  }}
                />
                <span className="text-sm text-sub">points</span>
              </div>
            )}
          </Field>
        </div>
        <p className="mt-4 text-sm text-text" data-field="forecast">
          {forecastText(capacity, velocity.average)}
        </p>
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
      <SectionCard title="3. Stories" icon={ListChecks}>
        <div className="space-y-5">
          {closedNote && (
            <p className="flex items-start gap-2 text-sm text-text" data-field="closed">
              <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0 text-warning" aria-hidden="true" />
              {closedNote}
            </p>
          )}
          {/* In the body, not the card's header: three buttons in a row don't fit a phone. */}
          <div className="flex flex-wrap gap-2">
            <Button
              type="button"
              variant="outline"
              size="sm"
              disabled={closed}
              onClick={fillToCapacity}
            >
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
            {!example && unsized.length > 0 && (
              <Button type="button" variant="outline" size="sm" onClick={queueUnsized}>
                Estimate {unsized.length} in Planning Poker
              </Button>
            )}
            <Button
              ref={pasteButton}
              type="button"
              variant="outline"
              size="sm"
              aria-expanded={pasting !== null}
              onClick={() => (pasting ? closePaste() : setPasting({ text: "", intoSprint: false }))}
            >
              <ClipboardPaste className="mr-1 h-4 w-4" aria-hidden="true" />
              Paste stories
            </Button>
          </div>
          {pasting && (
            <PasteStories
              initialText={pasting.text}
              intoSprintFirst={pasting.intoSprint}
              sprintName={closed ? undefined : sprint.name}
              onAdd={addPasted}
              onClose={closePaste}
            />
          )}
          <div>
            <h3
              id={sprintHeadingId}
              tabIndex={-1}
              className="mb-2 text-sm font-semibold text-text outline-none"
            >
              In {sprint.name} <span className="font-normal text-sub">· {planLine(inSprint)}</span>
            </h3>
            {inSprint.length === 0 ? (
              <p className="text-sm text-sub">
                {closed
                  ? "Nothing was planned into it."
                  : "Nothing yet. Tick backlog stories below, fill to capacity, or add a story."}
              </p>
            ) : (
              <StoryList
                label={`Stories in ${sprint.name}`}
                listKey="sprint"
                stories={inSprint}
                checked
                onToggle={tickOut}
                onPoints={setPoints}
                onRename={rename}
                onDetails={saveDetails}
                onDelete={deleteStory("sprint", sprintHeadingId)}
                removalOf={removalOf}
                keptNoteOf={keptNoteOf}
                showStatus
              />
            )}
            {!closed && (
              <ItemForm
                form={form}
                submitLabel="Add"
                submitIcon={<Plus className="h-4 w-4" aria-hidden="true" />}
                className="mt-3 flex flex-wrap items-start gap-2 space-y-0"
              >
                <Field
                  label="New story"
                  hideLabel
                  className="min-w-[12rem] flex-1"
                  error={form.errors.title}
                >
                  {(control) => (
                    <Input
                      {...control}
                      value={form.draft.title}
                      placeholder="Add a story and press Enter"
                      maxLength={200}
                      onChange={(e) => form.update({ title: e.target.value })}
                      // A list pasted here would run together into one title:
                      // it opens in "Paste stories" instead, one story a line.
                      onPaste={(e) => {
                        const text = e.clipboardData.getData("text");
                        if (!splitPastedLines(text, PASTE_STORIES_CAP)) return;
                        e.preventDefault();
                        setPasting({ text, intoSprint: true });
                      }}
                    />
                  )}
                </Field>
                <Field label="Points" hideLabel className="w-24" error={form.errors.points}>
                  {(control) => (
                    <Input
                      {...control}
                      type="number"
                      inputMode="decimal"
                      min={0}
                      step="any"
                      value={form.draft.points}
                      placeholder="Points"
                      onChange={(e) => form.update({ points: e.target.value })}
                    />
                  )}
                </Field>
              </ItemForm>
            )}
          </div>

          {leftovers.map((group) => (
            <LeftoverSection
              key={group.sprint.id}
              group={group}
              canCarry={!closed}
              planning={sprint}
              onCarry={() => carryGroup(group)}
              onSendBack={() => sendGroupBack(group)}
            >
              <StoryList
                label={`Left over from ${group.sprint.name}`}
                listKey={`leftover-${group.sprint.id}`}
                stories={group.stories}
                checked={false}
                onToggle={tickIn(`leftover-${group.sprint.id}`)}
                onPoints={setPoints}
                onRename={rename}
                onDetails={saveDetails}
                // A closed sprint's stories are locked: no bin, here or once
                // they are carried over or sent back (the sprint still counts them).
                removalOf={removalOf}
                showStatus
                cantAdd={cantAdd}
              />
            </LeftoverSection>
          ))}

          <div>
            <h3
              id={backlogHeadingId}
              tabIndex={-1}
              className="mb-2 text-sm font-semibold text-text outline-none"
            >
              Backlog{" "}
              <span className="font-normal text-sub">
                · {storiesCount(backlog.length)}, {backlogOrderText(backlog)}
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
              <StoryList
                label="Backlog"
                listKey="backlog"
                stories={backlog}
                checked={false}
                onToggle={tickIn("backlog")}
                onPoints={setPoints}
                onRename={rename}
                onDetails={saveDetails}
                onDelete={deleteStory("backlog", backlogHeadingId)}
                removalOf={removalOf}
                keptNoteOf={keptNoteOf}
                showPriority
                cantAdd={cantAdd}
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
                <span>
                  {w.text}
                  {w.id === "not-ready" && (
                    <>
                      {" "}
                      <Link href="/refinement" className="text-accent hover:underline">
                        Refinement
                      </Link>
                    </>
                  )}
                </span>
              </li>
            ))}
          </ul>
        )}
        <div className="mt-4 flex flex-wrap items-center gap-3">
          {example ? (
            <p className="text-sm text-sub">
              In your own sprint, this is where you start it and open the Sprint Cockpit.
            </p>
          ) : closed ? (
            <p className="text-sm text-sub" data-field="closed-commit">
              {`${sprint.name} is closed, so it can't be started again: its commitment stays at ${pointsCount(sprint.pointsPlanned)}.`}
            </p>
          ) : (
            <Button type="button" onClick={commit} disabled={inSprint.length === 0}>
              <Rocket className="mr-1 h-4 w-4" aria-hidden="true" />
              {sprint.status === "active" ? "Update the commitment" : "Start the sprint"}
            </Button>
          )}
          <Link
            href="/sprint"
            className="inline-flex items-center gap-1 text-sm font-medium text-sub hover:text-accent"
          >
            Sprint Cockpit
            <ArrowRight className="h-3.5 w-3.5" aria-hidden="true" />
          </Link>
        </div>
      </SectionCard>
    </div>
  );
}

/** One closed sprint's unfinished stories, with the two ways to settle them. */
function LeftoverSection({
  group,
  planning,
  canCarry,
  onCarry,
  onSendBack,
  children,
}: {
  group: LeftoverGroup;
  planning: Sprint;
  /** False when the sprint being planned is itself closed. */
  canCarry: boolean;
  onCarry: () => void;
  onSendBack: () => void;
  children: ReactNode;
}) {
  return (
    <section
      aria-label={`Left over from ${group.sprint.name}`}
      className="rounded-lg border border-warning/40 bg-warning/5 p-3"
    >
      <h3 className="flex items-center gap-1.5 text-sm font-semibold text-text">
        <History className="h-4 w-4 shrink-0 text-warning" aria-hidden="true" />
        Left over from {group.sprint.name}
        <span className="font-normal text-sub">
          · {storiesCount(group.stories.length)}, {pointsCount(group.points)}
        </span>
      </h3>
      <p className="mt-1 text-xs text-sub">
        Not done when {group.sprint.name} closed, so they are in neither {planning.name} nor the
        backlog until you move them.
      </p>
      <div className="mt-2 flex flex-wrap gap-2">
        {canCarry && (
          <Button type="button" size="sm" onClick={onCarry}>
            {carryOverLabel(group)}
          </Button>
        )}
        <Button type="button" size="sm" variant="outline" onClick={onSendBack}>
          Back to the backlog
        </Button>
      </div>
      <div className="mt-3">{children}</div>
    </section>
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
