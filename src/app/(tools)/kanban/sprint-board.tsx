"use client";

import Link from "@/components/motion/transition-link";
import { useMemo, type ReactNode } from "react";
import { CheckCircle2, ListTodo, MoveRight, OctagonAlert, Target } from "lucide-react";
import { Button } from "@/components/ui/button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { StatCard } from "@/components/shared/stat-card";
import { KpiGrid } from "@/components/shared/kpi-grid";
import { CalloutAlert } from "@/components/shared/callout-alert";
import { EmptyState } from "@/components/shared/empty-state";
import { SourceLink } from "@/components/handoff/source-link";
import { useAnnounce } from "@/components/a11y/live-announcer";
import { LoadExampleButton } from "@/components/tool-frame/example-data";
import { fmt } from "@/lib/charts/chart-text";
import { sprintDayLine } from "@/lib/sprints/hub-view";
import { completionPct } from "@/lib/sprints/metrics";
import { todayIso } from "@/lib/sprints/series";
import { storyProgress } from "@/lib/sprints/progress";
import { sprintHref } from "@/lib/sprints/use-selected-sprint";
import type { DodCriterion, KanbanColumnId, Sprint, Story } from "@/lib/stores/workspace-types";
import { checkedOf, openCriteria } from "@/lib/dod/model";
import { cn } from "@/lib/utils";
import { emit as sonify } from "@/lib/sonification/emit";
import { useHistoryLogger } from "@/lib/history/use-history-logger";
import { KANBAN_ACTIONS } from "@/lib/history/event-actions";
import { undoable } from "@/lib/utils/undoable";
import { useReturnFocus } from "@/hooks/use-return-focus";
import { AgeBadge, BlockedBadge, BlockedToggle, DodChecklist, PersonInPlace } from "./card-parts";
import { BoardDnd, DragPreview, DraggableCard, DropColumn } from "./board-dnd";
import { WipLimitInput, clampWipLimit } from "./wip-limit-input";
import { useNow } from "./use-now";
import type { SprintBoardWriter } from "./sprint-writer";
import {
  SPRINT_COLUMNS,
  SPRINT_COLUMN_LABEL,
  closedBoardNote,
  daysInColumn,
  dodNudge,
  doneMissingDod,
  isClosedSprint,
  isSprintColumnId,
  moveMessage,
  nudges,
  revertMove,
  sprintBoardVerdict,
  sprintBreaches,
  sprintColumn,
  sprintColumnOf,
  storiesByColumn,
  wipNudge,
  type SprintBreach,
  type SprintColumnId,
} from "./sprint-view";

/** A name short enough for a one-line toast. */
function shortName(name: string, max = 40): string {
  const t = name.trim() || "story";
  return t.length > max ? `${t.slice(0, max - 1).trimEnd()}…` : t;
}

const NO_CRITERIA: readonly DodCriterion[] = [];

const pointsLabel = (p: number | undefined) =>
  typeof p === "number" && Number.isFinite(p) ? `${fmt(p)} ${p === 1 ? "pt" : "pts"}` : null;

export interface SprintBoardProps {
  sprint: Sprint;
  /** Every story; the board shows the ones planned into `sprint`. */
  stories: readonly Story[];
  writer: SprintBoardWriter;
  /** The Flow board's limits (Ready stands in for To do). */
  wipLimits: Record<KanbanColumnId, number>;
  /** Change a limit; leave out for a read-only header (the example). */
  onWipChange?: (col: KanbanColumnId, n: number) => void;
  /** The sprint picker, above the header. */
  picker?: ReactNode;
  /** Open the in-memory example from the empty state. */
  onExample?: () => void;
  /** The example board: nothing is logged or sonified. */
  example?: boolean;
  /**
   * The team's Definition of Done: each card gets its checklist, and a move
   * to Done with required criteria open says so (it never blocks).
   */
  dod?: readonly DodCriterion[];
}

/**
 * The Sprint board: the selected sprint's stories by status. Every move
 * goes through `setStoryStatus` (via the writer), so started and done
 * times and the status history are stamped, and the cockpit, Burndown and
 * the standup read the board. A column over its WIP limit nudges; it never
 * blocks the move. A completed or cancelled sprint's board is read-only.
 */
export function SprintBoard({
  sprint,
  stories,
  writer,
  wipLimits,
  onWipChange,
  picker,
  onExample,
  example = false,
  dod = NO_CRITERIA,
}: SprintBoardProps) {
  const announce = useAnnounce();
  const { log } = useHistoryLogger("kanban");
  const { refFor, returnTo } = useReturnFocus();
  const now = useNow();
  const closed = isClosedSprint(sprint);

  const byColumn = useMemo(() => storiesByColumn(stories, sprint.id), [stories, sprint.id]);
  const progress = useMemo(() => storyProgress(stories, sprint.id), [stories, sprint.id]);
  const breaches = sprintBreaches(byColumn, wipLimits);
  const dodMissing = useMemo(
    () => doneMissingDod(byColumn.done, { items: dod }).length,
    [byColumn, dod]
  );
  const verdict = sprintBoardVerdict(sprint, progress, breaches, dodMissing);
  const pct = completionPct(progress.done, progress.scope);

  const titleOf = (id: string) => writer.story(id)?.title ?? "story";

  /**
   * Move a story with Undo. The message says where it went and, when the
   * move took the column over its limit, nudges. The card re-renders in
   * another column, so after a move from its menu focus follows it to its
   * Move button (a drag leaves focus where the pointer user had it).
   */
  const move = (id: string, to: SprintColumnId, { refocus = true } = {}) => {
    const before = writer.story(id);
    if (!before || closed) return;
    const from = sprintColumnOf(before.status);
    if (from === to) return;
    const target = sprintColumn(to);
    const count = byColumn[to].filter((s) => s.id !== id).length + 1;
    const limit = nudges(to) ? (wipLimits[target.wipKey] ?? 0) : 0;
    const breach: SprintBreach | undefined =
      limit > 0 && count > limit ? { column: to, label: target.label, count, limit } : undefined;
    const title = shortName(before.title);
    const dodOpen = to === "done" ? openCriteria(before, { items: dod }).map((c) => c.label) : [];
    undoable({
      label: `Moved “${title}” to ${target.label}`,
      ...(dodOpen.length > 0 ? { description: dodNudge(dodOpen) } : {}),
      apply: () => writer.setStatus(id, target.status),
      // Only the move comes back: an owner set since stays, and a story
      // that has moved again since is left where it is.
      revert: () => {
        const current = writer.story(id);
        const back = current ? revertMove(current, before, target.status) : null;
        if (!back) return;
        writer.restore(back);
        announce(`Moved “${title}” back to ${SPRINT_COLUMN_LABEL[from]}.`);
      },
    });
    announce(moveMessage(title, to, breach, dodOpen));
    if (refocus) returnTo(`move:${id}`);
    if (example) return;
    sonify("kanban", to === "done" ? "card-done" : "card-move");
    log(KANBAN_ACTIONS.CARD_MOVED, {
      storyId: id,
      title: before.title,
      from: before.status,
      to: target.status,
      board: "sprint",
    });
  };

  const toggleBlocked = (story: Story) => {
    const blocked = !story.blocked;
    writer.setBlocked(story.id, blocked);
    const title = shortName(story.title);
    announce(blocked ? `Flagged “${title}” as blocked.` : `“${title}” is no longer blocked.`);
    if (!example) log(KANBAN_ACTIONS.CARD_UPDATED, { storyId: story.id, blocked, board: "sprint" });
  };

  const setDodCheck = (story: Story, criterion: DodCriterion, checked: boolean) => {
    writer.setDodCheck(story.id, criterion.id, checked);
    const title = shortName(story.title);
    announce(
      checked
        ? `Ticked “${criterion.label}” on “${title}”.`
        : `Unticked “${criterion.label}” on “${title}”.`
    );
    if (!example) {
      log(KANBAN_ACTIONS.CARD_UPDATED, {
        storyId: story.id,
        dodCheck: criterion.id,
        checked,
        board: "sprint",
      });
    }
  };

  const setOwner = (story: Story, name: string) => {
    writer.setOwner(story.id, name);
    if (!example) {
      log(KANBAN_ACTIONS.CARD_UPDATED, { storyId: story.id, owner: name || null, board: "sprint" });
    }
  };

  const header = (
    <div className="mb-4 space-y-3">
      {picker}
      {closed && <CalloutAlert tone="info">{closedBoardNote(sprint)}</CalloutAlert>}
      <p className="text-sm font-medium text-text">
        {verdict}
        <span className="ml-2 font-normal text-sub">{sprintDayLine(sprint, todayIso(now))}</span>
      </p>
      {sprint.goal?.trim() && (
        <p className="flex items-start gap-1.5 text-xs text-sub">
          <Target className="mt-0.5 h-3.5 w-3.5 shrink-0" aria-hidden="true" />
          <span>
            <span className="font-medium text-text">Sprint goal:</span> {sprint.goal}
          </span>
        </p>
      )}
    </div>
  );

  if (progress.count === 0) {
    return (
      <>
        {header}
        <EmptyState
          icon={ListTodo}
          action={
            <div className="flex flex-wrap justify-center gap-2">
              {!closed && (
                <Button asChild>
                  <Link href={sprintHref("/sprint-planning", sprint.id)}>
                    Plan stories into {sprint.name}
                  </Link>
                </Button>
              )}
              {onExample && <LoadExampleButton label="See an example board" onLoad={onExample} />}
            </div>
          }
        >
          {closed
            ? `No stories were planned into ${sprint.name}.`
            : `No stories in ${sprint.name} yet. Plan them in Sprint Planning and they show up here, one column per status.`}
        </EmptyState>
      </>
    );
  }

  return (
    <>
      {header}
      <KpiGrid cols={4} gap="lg">
        <StatCard
          variant="compact"
          icon={CheckCircle2}
          label="Done"
          value={
            progress.scope > 0
              ? `${fmt(progress.done)} / ${fmt(progress.scope)}`
              : progress.doneCount
          }
          hint={progress.scope > 0 ? `points · ${pct ?? 0}%` : `of ${progress.count} stories`}
          valueClassName="text-accent"
        />
        <StatCard
          variant="compact"
          label="Remaining"
          value={progress.scope > 0 ? fmt(progress.remaining) : progress.count - progress.doneCount}
          hint={progress.scope > 0 ? "points" : "stories"}
        />
        <StatCard
          variant="compact"
          label="Stories done"
          value={`${progress.doneCount} / ${progress.count}`}
          hint={
            progress.unestimated > 0 ? `${progress.unestimated} not estimated` : "all estimated"
          }
        />
        <StatCard
          variant="compact"
          icon={OctagonAlert}
          label="Blocked"
          value={progress.blocked}
          hint={progress.blocked === 1 ? "story" : "stories"}
          tone={progress.blocked > 0 ? "danger" : "default"}
        />
      </KpiGrid>

      {breaches.map((b) => (
        <CalloutAlert key={b.column} tone="warning" className="mb-4">
          {wipNudge(b)}
        </CalloutAlert>
      ))}

      <BoardDnd
        titleOf={titleOf}
        renderOverlay={(id) => <DragPreview title={titleOf(id)} />}
        onMove={(id, col) => {
          if (isSprintColumnId(col)) move(id, col, { refocus: false });
        }}
      >
        <div
          className={cn(
            "scroll-x-snap sm:grid sm:gap-3 sm:grid-cols-2 lg:grid-cols-4",
            "sm:overflow-visible sm:m-0 sm:p-0"
          )}
        >
          {SPRINT_COLUMNS.map((col) => {
            const list = byColumn[col.id];
            const limited = col.id !== "done";
            const limit = limited ? (wipLimits[col.wipKey] ?? 0) : 0;
            const over = limit > 0 && list.length > limit;
            // A long To do shows against its limit but isn't flagged (see `nudges`).
            const flagged = over && nudges(col.id);
            const points = list.reduce(
              (sum, s) =>
                sum + (typeof s.points === "number" && Number.isFinite(s.points) ? s.points : 0),
              0
            );
            return (
              <section
                key={col.id}
                aria-label={col.label}
                className="space-y-2 min-w-0 w-[80vw] xs:w-[70vw] sm:w-auto"
              >
                <div
                  className={cn(
                    "rounded-lg border p-2",
                    flagged ? "border-warning/40 bg-warning/5" : "border-border bg-surface"
                  )}
                >
                  <div className="mb-1 flex items-center justify-between gap-2">
                    <h3 className="text-xs uppercase tracking-wider text-text font-semibold">
                      {col.label}
                    </h3>
                    <div className="text-xs font-data text-sub">
                      {list.length}
                      {limit > 0 && ` / ${limit}`}
                      {points > 0 && ` · ${fmt(points)} pts`}
                      {over && <span className="sr-only"> (over the WIP limit)</span>}
                    </div>
                  </div>
                  {limited && onWipChange && !closed && (
                    <WipLimitInput
                      colLabel={col.label}
                      value={limit}
                      onCommit={(n) => onWipChange(col.wipKey, clampWipLimit(n))}
                    />
                  )}
                </div>
                <DropColumn
                  id={col.id}
                  className="space-y-2 min-h-[100px] sm:min-h-[140px] md:min-h-[200px]"
                >
                  {list.map((story) => (
                    <StoryCard
                      key={story.id}
                      story={story}
                      readOnly={closed}
                      example={example}
                      days={daysInColumn(story, now)}
                      moveRef={refFor(`move:${story.id}`)}
                      onMove={(to) => move(story.id, to)}
                      onToggleBlocked={() => toggleBlocked(story)}
                      onOwner={(name) => setOwner(story, name)}
                      dod={dod}
                      onDodCheck={(id, checked) => {
                        const criterion = dod.find((c) => c.id === id);
                        if (criterion) setDodCheck(story, criterion, checked);
                      }}
                    />
                  ))}
                </DropColumn>
              </section>
            );
          })}
        </div>
      </BoardDnd>
    </>
  );
}

/** One story on the Sprint board; a closed sprint's cards have no controls. */
function StoryCard({
  story,
  readOnly,
  example,
  days,
  moveRef,
  onMove,
  onToggleBlocked,
  onOwner,
  dod,
  onDodCheck,
}: {
  story: Story;
  readOnly: boolean;
  /** An example story: its owner's name is never offered for the team roster. */
  example: boolean;
  days: number | null;
  moveRef: (el: HTMLElement | null) => void;
  onMove: (to: SprintColumnId) => void;
  onToggleBlocked: () => void;
  onOwner: (name: string) => void;
  dod: readonly DodCriterion[];
  onDodCheck: (criterionId: string, checked: boolean) => void;
}) {
  const column = sprintColumnOf(story.status);
  const blocked = Boolean(story.blocked) && column !== "done";
  const pts = pointsLabel(story.points);
  return (
    <DraggableCard
      id={story.id}
      disabled={readOnly}
      className={cn(
        "rounded-md border border-border bg-bg p-2 text-xs",
        blocked && "border-l-[3px] border-l-danger"
      )}
    >
      {(grip) => (
        <>
          <div className="mb-1.5 flex items-start gap-1">
            {grip}
            <p className="min-w-0 flex-1 break-words font-medium text-text">{story.title}</p>
            <span
              className={cn(
                "shrink-0 rounded border px-1.5 py-0.5 font-data",
                pts ? "border-border text-text" : "border-dashed border-border text-sub"
              )}
            >
              {pts ?? "No estimate"}
            </span>
          </div>
          <div className="mb-1.5 flex flex-wrap items-center gap-x-2 gap-y-1">
            {blocked && <BlockedBadge />}
            <AgeBadge days={days} column={SPRINT_COLUMN_LABEL[column]} />
            <SourceLink sourceRef={story.sourceRef} />
          </div>
          <div className="mb-1.5">
            <PersonInPlace
              value={story.owner}
              itemTitle={story.title}
              role="Owner"
              emptyText="No owner"
              readOnly={readOnly}
              offerAddToRoster={!example}
              onSave={onOwner}
            />
          </div>
          {dod.length > 0 && (
            <div className="mb-1.5">
              <DodChecklist
                criteria={dod}
                checked={checkedOf(story)}
                itemTitle={story.title}
                readOnly={readOnly}
                onCheck={onDodCheck}
              />
            </div>
          )}
          {!readOnly && (
            <div className="flex flex-wrap items-center gap-1">
              <MoveMenu story={story} column={column} triggerRef={moveRef} onMove={onMove} />
              {column !== "done" && (
                <BlockedToggle
                  blocked={blocked}
                  itemTitle={story.title}
                  onToggle={onToggleBlocked}
                />
              )}
            </div>
          )}
        </>
      )}
    </DraggableCard>
  );
}

/** "Move to…": the other columns, from the keyboard as well as the mouse. */
function MoveMenu({
  story,
  column,
  triggerRef,
  onMove,
}: {
  story: Story;
  column: SprintColumnId;
  /** Focus lands here after a move: the card re-renders in its new column. */
  triggerRef: (el: HTMLElement | null) => void;
  onMove: (to: SprintColumnId) => void;
}) {
  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <Button
          ref={triggerRef}
          type="button"
          variant="outline"
          size="sm"
          className="min-touch-coarse h-7 gap-1 px-2 text-xs"
        >
          <MoveRight aria-hidden="true" />
          Move to…
          <span className="sr-only">: {story.title}</span>
        </Button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="start">
        <DropdownMenuLabel className="text-xs font-medium text-sub">Move to</DropdownMenuLabel>
        {SPRINT_COLUMNS.map((c) => {
          const here = c.id === column;
          return (
            <DropdownMenuItem
              key={c.id}
              disabled={here}
              aria-label={here ? `${c.label} (here now)` : c.label}
              onSelect={() => onMove(c.id)}
            >
              {c.label}
              {here && <span className="ml-auto text-xs text-sub">here</span>}
            </DropdownMenuItem>
          );
        })}
      </DropdownMenuContent>
    </DropdownMenu>
  );
}
