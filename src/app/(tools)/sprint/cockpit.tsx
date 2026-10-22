"use client";

import { useMemo, useState } from "react";
import Link from "next/link";
import { ArrowRight, Plus } from "lucide-react";
import { Button } from "@/components/ui/button";
import { ExportButton } from "@/components/shared/export-button";
import { SprintPicker, nextSprintName } from "@/components/sprints/sprint-picker";
import { NewSprintDialog } from "@/components/sprints/new-sprint-dialog";
import { SprintHeader } from "@/components/sprints/sprint-header";
import { SprintTiles } from "@/components/sprints/sprint-tiles";
import { CloseSprintDialog } from "@/components/sprints/close-sprint-dialog";
import { ExampleBanner, LoadingSprints } from "@/components/sprints/start";
import { useWorkspaceStore } from "@/lib/stores/workspace-store";
import type {
  Impediment,
  RetroBoard,
  Sprint,
  SprintReview,
  SprintSeries,
  StandupEntry,
  Story,
  TeamMember,
} from "@/lib/stores/workspace-types";
import { useWorkspaceHydrated } from "@/lib/team/use-team-roster";
import { useHistoryLogger } from "@/lib/history/use-history-logger";
import { SPRINT_COCKPIT_ACTIONS } from "@/lib/history/event-actions";
import { useSelectedSprint } from "@/lib/sprints/use-selected-sprint";
import { exampleSprints, type ExampleSprints } from "@/lib/sprints/example";
import {
  dayDate,
  dayForDate,
  seriesFor,
  sprintLengthDays,
  todayIso,
  withDay,
} from "@/lib/sprints/series";
import {
  averageVelocity,
  completedSprints,
  hubTiles,
  type Tile,
  type TileId,
} from "@/lib/sprints/hub-view";
import { updateSeries, updateSprint } from "@/lib/sprints/store";
import { nextCeremonies, type CeremonyCadence } from "@/lib/sprints/cadence";
import { useCeremonyCadence } from "@/lib/sprints/use-ceremony-cadence";
import { sprintReport } from "@/lib/sprints/report";
import { toast } from "@/lib/utils/toast";
import { blockersTile, flowCards, gatherCockpitData, type CockpitData } from "./view";
import { FlowStrip } from "./components/flow-strip";
import { NextCeremony } from "./components/next-ceremony";
import { Blockers } from "./components/blockers";
import { MiniBurndown } from "./components/mini-burndown";
import { StartFlow } from "./components/start-flow";

export const TOOL_ID = "sprint";

const NO_SERIES: SprintSeries[] = [];
const NO_STORIES: Story[] = [];
const NO_IMPEDIMENTS: Impediment[] = [];
const NO_ENTRIES: StandupEntry[] = [];
const NO_MEMBERS: TeamMember[] = [];
const NO_BOARDS: RetroBoard[] = [];
const NO_REVIEWS: SprintReview[] = [];

/** The tiles the home card keeps; the full page shows them all. */
const COMPACT_TILES: readonly TileId[] = ["committed", "done", "remaining", "gap", "blockers"];

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
 * it shows the ceremony strip, the next ceremony, the numbers, the burndown
 * with today's log, and the open blockers. Everything comes from the other
 * tools' data; nothing is typed twice.
 */
export function SprintCockpit({ compact = false }: SprintCockpitProps) {
  const hydrated = useWorkspaceHydrated();
  const { sprints, selected, select } = useSelectedSprint();
  const allSeries = useWorkspaceStore((s) => s.sprintSeries) ?? NO_SERIES;
  const stories = useWorkspaceStore((s) => s.stories) ?? NO_STORIES;
  const impediments = useWorkspaceStore((s) => s.impediments) ?? NO_IMPEDIMENTS;
  const standupEntries = useWorkspaceStore((s) => s.standupEntries) ?? NO_ENTRIES;
  const teamMembers = useWorkspaceStore((s) => s.teamMembers) ?? NO_MEMBERS;
  const retroBoards = useWorkspaceStore((s) => s.retroBoards) ?? NO_BOARDS;
  const reviews = useWorkspaceStore((s) => s.sprintReviews) ?? NO_REVIEWS;
  const [cadence, updateCadence] = useCeremonyCadence();
  const { log } = useHistoryLogger(TOOL_ID);
  const [today] = useState(() => todayIso());
  const [now] = useState(() => new Date());
  const [creating, setCreating] = useState(false);
  const [example, setExample] = useState<ExampleSprints | null>(null);

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
            teamMembers,
            retroBoards,
            reviews,
            today,
          })
        : null,
    [
      selected,
      allSeries,
      stories,
      impediments,
      standupEntries,
      teamMembers,
      retroBoards,
      reviews,
      today,
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
      close: (pointsCompleted) => {
        const done = write({ status: "completed", pointsCompleted });
        if (done) {
          log(SPRINT_COCKPIT_ACTIONS.SPRINT_CLOSED, {
            sprintId: done.id,
            name: done.name,
            pointsPlanned: done.pointsPlanned,
            pointsCompleted,
          });
          toast.success(`${done.name} closed with ${pointsCompleted} points done`);
        }
      },
      reopen: (status) => {
        write({ status });
      },
      logDay: (day, remaining) => {
        updateSeries(selectedId, (s) => withDay(s, day, { remaining }));
        log(SPRINT_COCKPIT_ACTIONS.DAY_LOGGED, { sprintId: selectedId, day, remaining });
        toast.success(`Day ${day} logged: ${remaining} points left`);
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
    body = <LoadingSprints />;
  } else if (example) {
    body = (
      <ExampleCockpit
        example={example}
        today={today}
        now={now}
        cadence={cadence}
        compact={compact}
        onStart={() => setCreating(true)}
        onExit={() => setExample(null)}
      />
    );
  } else if (selected && data) {
    body = (
      <CockpitBody
        sprints={sprints}
        series={seriesFor(allSeries, selected.id)}
        data={data}
        today={today}
        now={now}
        cadence={cadence}
        onCadence={updateCadence}
        compact={compact}
        commands={commands}
        onNewSprint={() => setCreating(true)}
      />
    );
  } else {
    body = (
      <StartFlow
        onCreate={() => setCreating(true)}
        onExample={() => setExample(exampleSprints(today))}
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
  close: (pointsCompleted: number) => void;
  reopen: (status: Exclude<Sprint["status"], "completed">) => void;
  logDay: (day: number, remaining: number) => void;
  select: (id: string) => void;
}

function CockpitBody({
  sprints,
  series,
  data,
  today,
  now,
  cadence,
  onCadence,
  compact,
  commands,
  onNewSprint,
}: {
  sprints: readonly Sprint[];
  series: SprintSeries | undefined;
  data: CockpitData;
  today: string;
  now: Date;
  cadence: CeremonyCadence;
  /** Absent in the read-only example. */
  onCadence?: (patch: Partial<CeremonyCadence>) => void;
  compact: boolean;
  /** Absent in the read-only example. */
  commands?: CockpitCommands;
  onNewSprint?: () => void;
}) {
  const { sprint, status } = data;
  const readOnly = !commands;
  const [detailsOpen, setDetailsOpen] = useState(false);
  const [closing, setClosing] = useState(false);

  const cards = useMemo(() => flowCards(data), [data]);
  const tiles = useMemo<Tile[]>(() => {
    const all = [
      ...hubTiles(sprint, status, averageVelocity(completedSprints(sprints), sprint.id)),
      blockersTile(data.openImpediments),
    ];
    return compact ? all.filter((t) => COMPACT_TILES.includes(t.id)) : all;
  }, [sprint, status, sprints, data.openImpediments, compact]);
  const upcoming = useMemo(() => nextCeremonies(sprint, cadence, now), [sprint, cadence, now]);
  const day = dayForDate(sprint, today);
  const ended = day !== null && day > sprintLengthDays(sprint);

  const report = useMemo(
    () =>
      sprintReport({
        sprint,
        series,
        sprints,
        today,
        stories: data.sprintStories,
        openImpediments: data.openImpediments,
        standup: data.standup,
        retroActions: data.lastRetroActions.map((a) => ({ text: a.text, assignee: a.assignee })),
        review: data.reviewDoc
          ? {
              demoItems: data.reviewDoc.features.map((f) => ({
                name: f.name,
                timeMinutes: f.timeMinutes,
              })),
              feedback: data.reviewDoc.feedbackItems,
            }
          : null,
      }),
    [sprint, series, sprints, today, data]
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
          <ExportButton
            filename={`sprint-report-${slug(sprint.name)}`}
            markdown={report}
            clipboardText={report}
            jsonData={{ sprint, series, stories: data.sprintStories }}
          />
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

      <NextCeremony
        occurrences={upcoming}
        now={now}
        ended={ended}
        cadence={cadence}
        onCadence={compact ? undefined : onCadence}
      />

      <FlowStrip cards={cards} />

      <SprintTiles tiles={tiles} />

      {!compact && (
        <div className="grid gap-4 lg:grid-cols-[3fr_2fr]">
          <MiniBurndown
            sprint={sprint}
            series={series}
            today={today}
            onLog={
              commands && day !== null ? (remaining) => commands.logDay(day, remaining) : undefined
            }
          />
          <Blockers open={data.openImpediments} today={today} />
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
          <span className="text-sub"> — burndown log, blockers, the sprint report.</span>
        </p>
      )}

      {commands && (
        <CloseSprintDialog
          open={closing}
          onOpenChange={setClosing}
          sprint={sprint}
          series={series}
          mode="close"
          onConfirm={(points) => {
            commands.close(points);
            setClosing(false);
          }}
        />
      )}
    </div>
  );
}

/* ── Example ───────────────────────────────────────────────────────────── */

/** The cockpit on the example sprints, in memory only: nothing is saved. */
function ExampleCockpit({
  example,
  today,
  now,
  cadence,
  compact,
  onStart,
  onExit,
}: {
  example: ExampleSprints;
  today: string;
  now: Date;
  cadence: CeremonyCadence;
  compact: boolean;
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
        stories: EXAMPLE_STORIES.map((s) => ({ ...s, sprintId: sprint.id })),
        impediments: exampleImpediments(today),
        standupEntries: EXAMPLE_STANDUP.map((e) => ({ ...e, date: today })),
        teamMembers: EXAMPLE_TEAM,
        retroBoards: [],
        reviews: [],
        today,
      }),
    [sprint, series, today]
  );
  return (
    <div className="space-y-4 sm:space-y-6">
      <ExampleBanner onStart={onStart} onExit={onExit} />
      <CockpitBody
        sprints={example.sprints}
        series={series}
        data={data}
        today={today}
        now={now}
        cadence={cadence}
        compact={compact}
      />
    </div>
  );
}

const EXAMPLE_TEAM: TeamMember[] = [
  { id: "example-m1", name: "Amira" },
  { id: "example-m2", name: "Ben" },
  { id: "example-m3", name: "Chloé" },
  { id: "example-m4", name: "Dev" },
  { id: "example-m5", name: "Elin" },
];

const EXAMPLE_STORIES: Omit<Story, "sprintId">[] = [
  { id: "example-s1", title: "Save a card at checkout", points: 8, status: "done" },
  { id: "example-s2", title: "Pay with a saved card", points: 5, status: "in_progress" },
  { id: "example-s3", title: "Remove a saved card", points: 3, status: "todo" },
  { id: "example-s4", title: "Refund flow", points: 8, status: "todo" },
  { id: "example-s5", title: "Card expiry reminders", status: "todo" },
];

/** Two open blockers, raised a few days before `today`. */
function exampleImpediments(today: string): Impediment[] {
  const daysAgo = (n: number) => dayDate({ startDate: today }, -n) ?? today;
  return [
    {
      id: "example-i1",
      title: "Payment sandbox returns 500s under load",
      severity: "high",
      raisedAt: daysAgo(2),
      owner: "Ben",
    },
    {
      id: "example-i2",
      title: "Waiting on legal copy for the refund screen",
      severity: "medium",
      raisedAt: daysAgo(4),
    },
  ];
}

const EXAMPLE_STANDUP: Omit<StandupEntry, "date">[] = [
  {
    id: "example-e1",
    member: "Amira",
    yesterday: "Finished the saved-card form",
    today: "Pairing on payment",
    blockers: "",
    timestamp: 0,
  },
  {
    id: "example-e2",
    member: "Ben",
    yesterday: "Load-tested the sandbox",
    today: "Chasing the sandbox 500s",
    blockers: "Sandbox 500s",
    timestamp: 0,
  },
  {
    id: "example-e3",
    member: "Chloé",
    yesterday: "Refund flow designs",
    today: "Refund flow build",
    blockers: "",
    timestamp: 0,
  },
];
