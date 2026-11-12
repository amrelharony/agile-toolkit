"use client";

import { useCallback, useMemo, useRef, useState } from "react";
import Link from "next/link";
import { ArrowRight, Plus } from "lucide-react";
import { Button } from "@/components/ui/button";
import { ExportButton } from "@/components/shared/export-button";
import { ExampleNotice } from "@/components/tool-frame/example-data";
import { SprintPicker, nextSprintName } from "@/components/sprints/sprint-picker";
import { NewSprintDialog } from "@/components/sprints/new-sprint-dialog";
import { SprintHeader } from "@/components/sprints/sprint-header";
import { SprintTiles } from "@/components/sprints/sprint-tiles";
import { CloseSprintDialog, type CarryOverPlan } from "@/components/sprints/close-sprint-dialog";
import { AddToCalendar } from "@/components/sprints/add-to-calendar";
import { LoadingSprints } from "@/components/sprints/start";
import { useWorkspaceStore } from "@/lib/stores/workspace-store";
import type {
  AsyncUpdate,
  Impediment,
  InterruptItem,
  RetroBoard,
  Sprint,
  SprintGoal,
  SprintReview,
  SprintSeries,
  StandupEntry,
  Story,
  TeamMember,
} from "@/lib/stores/workspace-types";
import { useWorkspaceHydrated } from "@/lib/team/use-team-roster";
import { useHistoryLogger } from "@/lib/history/use-history-logger";
import { SPRINT_COCKPIT_ACTIONS } from "@/lib/history/event-actions";
import { sprintHref, useSelectedSprint } from "@/lib/sprints/use-selected-sprint";
import { dayForDate, seriesFor, sprintLengthDays, todayIso } from "@/lib/sprints/series";
import { withBurndownDay } from "@/lib/sprints/day-writes";
import { averageScore, sprintScores } from "@/lib/sprints/compare";
import { points, sprintDayLine, type TileId } from "@/lib/sprints/hub-view";
import { updateSeries, updateSprint } from "@/lib/sprints/store";
import { cadenceCalendar, nextCeremonies, type CeremonyCadence } from "@/lib/sprints/cadence";
import { useCeremonyCadence } from "@/lib/sprints/use-ceremony-cadence";
import { getHandoffRoute } from "@/lib/handoffs/registry";
import { toast } from "@/lib/utils/toast";
import { undoable } from "@/lib/utils/undoable";
import {
  cockpitNotes,
  cockpitTiles,
  daysLeftLine,
  flowCards,
  gatherCockpitData,
  type CockpitData,
} from "./view";
import { cockpitVerdict } from "./verdict";
import { cockpitMarkdown } from "./markdown";
import { buildExample, type CockpitExample } from "./example";
import { carryOverLine, closeSprint, type ClosedSprint } from "./close";
import type { OutcomeValues } from "@/app/(tools)/sprint-goal/outcome";
import { FlowStrip } from "./components/flow-strip";
import { NextCeremony } from "./components/next-ceremony";
import { Blockers } from "./components/blockers";
import { MiniBurndown } from "./components/mini-burndown";
import { CockpitNotes } from "./components/notes";
import { StartFlow } from "./components/start-flow";
import { CockpitRisk } from "./components/risk";
import { CockpitWallContent, CockpitWallView, WallModeButton } from "./components/wall";

export const TOOL_ID = "sprint";

const NO_SERIES: SprintSeries[] = [];
const NO_STORIES: Story[] = [];
const NO_IMPEDIMENTS: Impediment[] = [];
const NO_ENTRIES: StandupEntry[] = [];
const NO_UPDATES: AsyncUpdate[] = [];
const NO_MEMBERS: TeamMember[] = [];
const NO_BOARDS: RetroBoard[] = [];
const NO_REVIEWS: SprintReview[] = [];
const NO_GOALS: SprintGoal[] = [];
const NO_INTERRUPTS: InterruptItem[] = [];

/** The tiles the home card keeps; the full page shows them all. */
const COMPACT_TILES: readonly TileId[] = ["committed", "done", "remaining", "gap", "blockers"];

/**
 * What the page does, in one sentence, shown while the saved sprints load. The
 * server can't read them, so without it the first HTML of /sprint, all a
 * search engine or an assistant reads, said only "Loading sprints…".
 */
export const COCKPIT_ABOUT =
  "This page shows the sprint your team is running: where it stands today, the next ceremony, the burndown and what is blocking it.";

const slug = (s: string) =>
  s
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-|-$/g, "")
    .slice(0, 40) || "sprint";

export interface SprintCockpitProps {
  /** The home-page card: no chart, no editing, fewer tiles, a link to the page. */
  compact?: boolean;
}

/**
 * The Sprint Cockpit: the current sprint on one page. With no sprint it runs
 * the start flow (team, sprint, ceremony times) or shows an example; with one
 * it shows the verdict, its notes (a closed sprint's goal still unanswered,
 * how much improvement work the sprint holds), the next ceremony, the
 * ceremony strip, the numbers (from the sprint board when its stories have
 * points, else the daily log), the burndown, and what is blocking the
 * sprint. Everything comes from the other tools' data; nothing is typed
 * twice.
 */
export function SprintCockpit({ compact = false }: SprintCockpitProps) {
  const hydrated = useWorkspaceHydrated();
  const { sprints, selected, select } = useSelectedSprint();
  const allSeries = useWorkspaceStore((s) => s.sprintSeries) ?? NO_SERIES;
  const stories = useWorkspaceStore((s) => s.stories) ?? NO_STORIES;
  const impediments = useWorkspaceStore((s) => s.impediments) ?? NO_IMPEDIMENTS;
  const standupEntries = useWorkspaceStore((s) => s.standupEntries) ?? NO_ENTRIES;
  const asyncUpdates = useWorkspaceStore((s) => s.asyncUpdates) ?? NO_UPDATES;
  const teamMembers = useWorkspaceStore((s) => s.teamMembers) ?? NO_MEMBERS;
  const retroBoards = useWorkspaceStore((s) => s.retroBoards) ?? NO_BOARDS;
  const reviews = useWorkspaceStore((s) => s.sprintReviews) ?? NO_REVIEWS;
  // For "Did we meet the sprint goal?" on a closed sprint.
  const sprintGoals = useWorkspaceStore((s) => s.sprintGoals) ?? NO_GOALS;
  // The interrupt buffer's tile and the goal check read the logged interrupts.
  const interruptItems = useWorkspaceStore((s) => s.interruptItems) ?? NO_INTERRUPTS;
  const [cadence, updateCadence] = useCeremonyCadence();
  const { log } = useHistoryLogger(TOOL_ID);
  const [today, setToday] = useState(() => todayIso());
  const [now, setNow] = useState(() => new Date());
  // Wall mode moves the day and the clock on (as it opens and on every
  // refresh), so the next ceremony, the day line and the goal check never
  // freeze at the time the page was loaded. The day only changes at midnight,
  // so the data is gathered again then, not every minute.
  const moveClock = useCallback(() => {
    setNow(new Date());
    setToday(todayIso());
  }, []);
  const [creating, setCreating] = useState(false);
  const [example, setExample] = useState<CockpitExample | null>(null);
  const calendar = useMemo(() => cadenceCalendar(cadence), [cadence]);
  // The close just made, so the dialog's finished step can add the goal
  // answer to it (and to its Undo).
  const lastClose = useRef<ClosedSprint | null>(null);

  const selectedId = selected?.id;
  const data = useMemo(
    () =>
      selected
        ? gatherCockpitData({
            sprint: selected,
            series: seriesFor(allSeries, selected.id),
            stories,
            impediments,
            standupEntries,
            asyncUpdates,
            teamMembers,
            retroBoards,
            reviews,
            sprints,
            today,
            goals: sprintGoals,
            // Done when the impediment, Kanban card or story an action was sent to is finished.
            targetDone: (link) => getHandoffRoute(link.route).isDone?.(link.targetId) ?? false,
            // The burndown's ideal line and projection count the team's working days.
            calendar,
            interruptItems,
          })
        : null,
    [
      selected,
      allSeries,
      stories,
      impediments,
      standupEntries,
      asyncUpdates,
      teamMembers,
      retroBoards,
      reviews,
      sprints,
      today,
      sprintGoals,
      calendar,
      interruptItems,
    ]
  );

  const commands = useMemo<CockpitCommands | undefined>(() => {
    if (!selectedId) return undefined;
    // Keep this sprint chosen while changing it (closing the active sprint
    // must not make the default choice jump to another one).
    const write = (patch: Partial<Omit<Sprint, "id">>) => {
      select(selectedId);
      return updateSprint(selectedId, patch);
    };
    return {
      edit: (patch) => {
        write(patch);
      },
      close: (pointsCompleted, carry) => {
        const current = useWorkspaceStore.getState().sprints.find((s) => s.id === selectedId);
        if (!current) return;
        select(selectedId);
        // One Undo for the close and every story it moved.
        const closed: { result: ClosedSprint | null } = { result: null };
        undoable({
          label: `Closed ${current.name} with ${points(pointsCompleted)} done`,
          description: carryOverLine(carry),
          apply: () => {
            closed.result = closeSprint(selectedId, pointsCompleted, carry);
          },
          revert: () => {
            closed.result?.revert();
            select(selectedId);
          },
        });
        const done = closed.result;
        lastClose.current = done;
        if (done) {
          log(SPRINT_COCKPIT_ACTIONS.SPRINT_CLOSED, {
            sprintId: done.sprint.id,
            name: done.sprint.name,
            pointsPlanned: done.sprint.pointsPlanned,
            pointsCompleted,
            ...(carry
              ? {
                  carryOver: carry.target,
                  unfinished: carry.stories.length,
                  moved: done.moved,
                  ...(done.movedTo ? { movedTo: done.movedTo.id } : {}),
                }
              : {}),
          });
        }
      },
      answerGoal: (values) => {
        // Only for the sprint that close closed: never another one's answer.
        if (lastClose.current?.sprint.id === selectedId) lastClose.current.answerGoal(values);
      },
      reopen: (status) => {
        write({ status });
      },
      logDay: (day, remaining) => {
        // Burndown's own day writer, so a day that rose keeps Burnup's scope in step.
        updateSeries(selectedId, (s) => {
          const sprint = useWorkspaceStore.getState().sprints.find((x) => x.id === selectedId);
          return sprint ? withBurndownDay(sprint, s, day, { remaining }) : s;
        });
        log(SPRINT_COCKPIT_ACTIONS.DAY_LOGGED, { sprintId: selectedId, day, remaining });
        toast.success(`Day ${day} logged: ${points(remaining)} left`);
      },
      select,
    };
  }, [selectedId, select, log]);

  const onCreated = (sprint: Sprint) => {
    setExample(null);
    select(sprint.id);
    log(SPRINT_COCKPIT_ACTIONS.SPRINT_CREATED, {
      sprintId: sprint.id,
      name: sprint.name,
      pointsPlanned: sprint.pointsPlanned,
      status: sprint.status,
    });
  };

  let body: React.ReactNode;
  if (!hydrated) {
    // The home card sits under home's own words; only the page needs the sentence.
    body = <LoadingSprints tall about={compact ? undefined : COCKPIT_ABOUT} />;
  } else if (example) {
    body = (
      <ExampleCockpit
        example={example}
        today={today}
        now={now}
        cadence={cadence}
        compact={compact}
        onClock={moveClock}
        onStart={() => setCreating(true)}
        onExit={() => setExample(null)}
      />
    );
  } else if (selected && data) {
    body = (
      <CockpitBody
        sprints={sprints}
        series={seriesFor(allSeries, selected.id)}
        stories={stories}
        data={data}
        today={today}
        now={now}
        cadence={cadence}
        onCadence={updateCadence}
        compact={compact}
        commands={commands}
        onClock={moveClock}
        onNewSprint={() => setCreating(true)}
      />
    );
  } else {
    body = (
      <StartFlow
        onCreate={() => setCreating(true)}
        onExample={() => setExample(buildExample(today))}
        cadence={cadence}
        onCadence={updateCadence}
      />
    );
  }

  return (
    <>
      {body}
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

/* ── The cockpit for one sprint ────────────────────────────────────────── */

export interface CockpitCommands {
  edit: (patch: Partial<Omit<Sprint, "id">>) => void;
  close: (pointsCompleted: number, carryOver?: CarryOverPlan) => void;
  /** Record the goal answer as part of the close just made (its Undo covers it). */
  answerGoal: (values: OutcomeValues) => void;
  reopen: (status: Exclude<Sprint["status"], "completed">) => void;
  logDay: (day: number, remaining: number) => void;
  select: (id: string) => void;
}

function CockpitBody({
  sprints,
  series,
  stories,
  data,
  today,
  now,
  cadence,
  onCadence,
  compact,
  commands,
  onClock,
  onNewSprint,
}: {
  sprints: readonly Sprint[];
  series: SprintSeries | undefined;
  /** Every story, for the close dialog's carry-over. */
  stories: readonly Story[];
  data: CockpitData;
  today: string;
  now: Date;
  cadence: CeremonyCadence;
  /** Absent in the read-only example. */
  onCadence?: (patch: Partial<CeremonyCadence>) => void;
  compact: boolean;
  /** Absent in the read-only example. */
  commands?: CockpitCommands;
  /** Move `today` and `now` on: wall mode calls it as it opens and on every refresh. */
  onClock?: () => void;
  onNewSprint?: () => void;
}) {
  const { sprint } = data;
  const readOnly = !commands;
  const [detailsOpen, setDetailsOpen] = useState(false);
  const [closing, setClosing] = useState(false);
  const [wall, setWall] = useState(false);

  const cards = useMemo(() => flowCards(data), [data]);
  // The rating is Sprint Comparison's computed average, so the two agree.
  const allSeries = useWorkspaceStore((s) => s.sprintSeries);
  const allStories = useWorkspaceStore((s) => s.stories);
  const goals = useWorkspaceStore((s) => s.sprintGoals);
  const moodEntries = useWorkspaceStore((s) => s.moodEntries);
  const moodPulses = useWorkspaceStore((s) => s.moodPulses);
  const healthChecks = useWorkspaceStore((s) => s.healthChecks);
  const rating = useMemo(
    () =>
      readOnly
        ? undefined
        : averageScore(
            sprintScores({
              sprint,
              sprints,
              stories: allStories ?? [],
              series: allSeries,
              goals,
              moodEntries,
              moodPulses,
              healthChecks,
            })
          ),
    [readOnly, sprint, sprints, allStories, allSeries, goals, moodEntries, moodPulses, healthChecks]
  );
  const allTiles = useMemo(
    () => cockpitTiles(data, sprints, today, { rating }),
    [data, sprints, today, rating]
  );
  const tiles = useMemo(
    () => (compact ? allTiles.filter((t) => COMPACT_TILES.includes(t.id)) : allTiles),
    [allTiles, compact]
  );
  const verdict = useMemo(() => cockpitVerdict(data, today), [data, today]);
  const notes = useMemo(() => cockpitNotes(data), [data]);
  const upcoming = useMemo(() => nextCeremonies(sprint, cadence, now), [sprint, cadence, now]);
  const day = dayForDate(sprint, today);
  const ended = day !== null && day > sprintLengthDays(sprint);
  const boardHref = readOnly ? "/kanban" : sprintHref("/kanban", sprint.id);

  // The report's rating row is the tile's.
  const report = useMemo(
    () => cockpitMarkdown({ data, series, sprints, today, rating }),
    [data, series, sprints, today, rating]
  );

  return (
    <div className="space-y-4 sm:space-y-6" data-cockpit={compact ? "compact" : "full"}>
      {!compact && (
        <div className="flex flex-wrap items-end justify-between gap-3">
          <div className="flex min-w-0 flex-wrap items-end gap-2">
            <SprintPicker
              sprints={[...sprints]}
              selectedId={sprint.id}
              onSelect={(id) => commands?.select(id)}
              allowCreate={false}
            />
            {onNewSprint && (
              <Button type="button" variant="outline" size="sm" onClick={onNewSprint}>
                <Plus className="mr-1 h-4 w-4" aria-hidden="true" />
                New sprint
              </Button>
            )}
          </div>
          <div className="flex flex-wrap items-center gap-2">
            <WallModeButton
              onOpen={() => {
                onClock?.();
                setWall(true);
              }}
            />
            <ExportButton
              filename={`sprint-report-${slug(sprint.name)}`}
              markdown={report}
              clipboardText={report}
              jsonData={{
                sprint,
                series,
                stories: data.sprintStories,
                impediments: data.sprintImpediments,
              }}
            />
          </div>
        </div>
      )}

      <SprintHeader
        sprint={sprint}
        today={today}
        readOnly={readOnly || compact}
        detailsOpen={detailsOpen}
        onDetailsOpenChange={setDetailsOpen}
        onEdit={(patch) => commands?.edit(patch)}
        onRequestClose={() => setClosing(true)}
        onReopen={(s) => commands?.reopen(s)}
      />

      <p className="text-sm font-medium text-text" data-cockpit-verdict>
        {verdict}
      </p>

      <CockpitRisk
        risk={data.risk}
        sprint={sprint}
        day={data.burndown.todayDay}
        length={data.burndown.length}
        compact={compact}
        withNote={!readOnly}
      />

      <CockpitNotes notes={notes} />

      <NextCeremony
        occurrences={upcoming}
        now={now}
        ended={ended}
        cadence={cadence}
        sprintLengthDays={sprintLengthDays(sprint)}
        onCadence={compact ? undefined : onCadence}
      >
        {/* The team's own sprint on the full page: not the home card, not the example. */}
        {!compact && !readOnly && (
          <AddToCalendar
            sprint={sprint}
            cadence={cadence}
            actions={data.openActions}
            now={now}
            place="cockpit"
          />
        )}
      </NextCeremony>

      <FlowStrip cards={cards} />

      <SprintTiles tiles={tiles} />

      {!compact && (
        <div className="grid gap-4 lg:grid-cols-[3fr_2fr]">
          <MiniBurndown
            sprint={sprint}
            series={series}
            burndown={data.burndown}
            today={today}
            onLog={commands ? commands.logDay : undefined}
          />
          <Blockers
            open={data.openImpediments}
            resolved={data.resolvedImpediments}
            blockedStories={data.blockedStories}
            today={today}
            boardHref={boardHref}
          />
        </div>
      )}

      {compact && (
        <p className="text-sm">
          <Link
            href="/sprint"
            className="inline-flex items-center gap-1 font-medium text-accent hover:underline"
          >
            Open the full cockpit
            <ArrowRight className="h-3.5 w-3.5" aria-hidden="true" />
          </Link>
          <span className="text-sub"> — burndown, blockers, the sprint report.</span>
        </p>
      )}

      {!compact && (
        <CockpitWallView
          open={wall}
          onClose={() => setWall(false)}
          title={sprint.name || "Sprint"}
          onRefresh={onClock}
        >
          {(tick) => (
            <CockpitWallContent
              dayLine={daysLeftLine(sprintDayLine(sprint, today))}
              goal={sprint.goal?.trim() || undefined}
              verdict={verdict}
              risk={data.risk}
              tiles={allTiles}
              next={upcoming[0]}
              now={new Date(tick.now)}
            />
          )}
        </CockpitWallView>
      )}

      {commands && (
        <CloseSprintDialog
          open={closing}
          onOpenChange={setClosing}
          sprint={sprint}
          series={series}
          mode="close"
          stories={stories}
          sprints={sprints}
          nextLengthDays={cadence.sprintLengthDays}
          // The dialog stays up for its finished step and closes itself.
          onConfirm={(pointsCompleted, carry) => commands.close(pointsCompleted, carry)}
          onGoalOutcome={commands.answerGoal}
        />
      )}
    </div>
  );
}

/* ── Example ───────────────────────────────────────────────────────────── */

/**
 * The cockpit on the example (./example.ts), in memory only: nothing is
 * saved, so the user's real sprints and stories stay as they are.
 */
function ExampleCockpit({
  example,
  today,
  now,
  cadence,
  compact,
  onClock,
  onStart,
  onExit,
}: {
  example: CockpitExample;
  today: string;
  now: Date;
  cadence: CeremonyCadence;
  compact: boolean;
  onClock?: () => void;
  onStart: () => void;
  onExit: () => void;
}) {
  const sprint = example.current;
  const series = seriesFor(example.series, sprint.id);
  const data = useMemo(
    () =>
      gatherCockpitData({
        sprint,
        series,
        stories: example.stories,
        impediments: example.impediments,
        standupEntries: example.standupEntries,
        teamMembers: example.teamMembers,
        retroBoards: example.retroBoards,
        reviews: example.reviews,
        sprints: example.sprints,
        today,
        calendar: cadenceCalendar(cadence),
        interruptItems: example.interruptItems,
      }),
    [example, sprint, series, today, cadence]
  );
  return (
    <div className="space-y-4 sm:space-y-6">
      <div>
        <ExampleNotice onClear={onExit} />
        <div className="-mt-2 flex flex-wrap items-center gap-3">
          {/* ExampleNotice invites editing; this example is read-only, so say so here. */}
          <p className="min-w-0 flex-1 text-xs text-sub">
            This example is a read-only preview: nothing in it can be changed or saved, and your
            sprints, stories and impediments stay as they are.
          </p>
          <Button type="button" size="sm" onClick={onStart}>
            <Plus className="mr-1 h-4 w-4" aria-hidden="true" />
            Start your own sprint
          </Button>
        </div>
      </div>
      <CockpitBody
        sprints={example.sprints}
        series={series}
        stories={example.stories}
        data={data}
        today={today}
        now={now}
        cadence={cadence}
        compact={compact}
        onClock={onClock}
      />
    </div>
  );
}
