"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { Plus } from "lucide-react";
import { ToolPageWrapper } from "@/components/layout/tool-page-wrapper";
import { ExportButton } from "@/components/shared/export-button";
import { Button } from "@/components/ui/button";
import { SprintPicker, nextSprintName } from "@/components/sprints/sprint-picker";
import { NewSprintDialog } from "@/components/sprints/new-sprint-dialog";
import { useWorkspaceStore } from "@/lib/stores/workspace-store";
import type { Sprint, SprintSeries } from "@/lib/stores/workspace-types";
import { useWorkspaceHydrated } from "@/lib/team/use-team-roster";
import { useHistoryLogger } from "@/lib/history/use-history-logger";
import { SPRINT_METRICS_ACTIONS } from "@/lib/history/event-actions";
import { useSelectedSprint } from "@/lib/sprints/use-selected-sprint";
import { useSprintMigrationStatus } from "@/lib/sprints/migration-status";
import { exampleSprints, type ExampleSprints } from "@/lib/sprints/example";
import { seriesFor, sprintsNewestFirst, todayIso } from "@/lib/sprints/series";
import { updateSprint } from "@/lib/sprints/store";
import { SprintHub, type SprintCommands } from "./components/sprint-hub";
import { BoardLevelTools } from "./components/tool-cards";
import { ExampleBanner, LoadingSprints, SprintsEmptyState } from "./components/start";
import { toMarkdown } from "./markdown";

const TOOL_ID = "sprint-metrics";
const NO_SERIES: SprintSeries[] = [];

/** Migrated sprints the user said look right (this browser only). */
export const CHECKED_SPRINTS_KEY = "agile-toolkit:sprint-metrics:checked";

function useCheckedSprints(): [ReadonlySet<string>, (id: string) => void] {
  const [checked, setChecked] = useState<ReadonlySet<string>>(() => new Set());
  useEffect(() => {
    try {
      const raw = window.localStorage.getItem(CHECKED_SPRINTS_KEY);
      const ids: unknown = raw ? JSON.parse(raw) : [];
      if (Array.isArray(ids)) {
        setChecked(new Set(ids.filter((x): x is string => typeof x === "string")));
      }
    } catch {
      /* unreadable or blocked storage: show the checks again */
    }
  }, []);
  const mark = useCallback((id: string) => {
    setChecked((prev) => {
      const next = new Set(prev).add(id);
      try {
        window.localStorage.setItem(
          CHECKED_SPRINTS_KEY,
          JSON.stringify(Array.from(next).slice(-200))
        );
      } catch {
        /* private mode: the check is hidden for this visit only */
      }
      return next;
    });
  }, []);
  return [checked, mark];
}

const slug = (s: string) =>
  s
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-|-$/g, "")
    .slice(0, 40) || "sprint";

/**
 * Sprint Metrics: one place for the shared sprints. Pick a sprint, see where
 * it stands, fix its details, close it, and jump into any sprint tool already
 * looking at it.
 */
export function SprintMetricsClient() {
  const hydrated = useWorkspaceHydrated();
  const migration = useSprintMigrationStatus();
  const { sprints, selected, select } = useSelectedSprint();
  const allSeries = useWorkspaceStore((s) => s.sprintSeries) ?? NO_SERIES;
  const { log } = useHistoryLogger(TOOL_ID);
  const [today] = useState(() => todayIso());
  const [creating, setCreating] = useState(false);
  const [example, setExample] = useState<ExampleSprints | null>(null);
  const [checked, markChecked] = useCheckedSprints();

  const onCreated = (sprint: Sprint) => {
    setExample(null);
    select(sprint.id);
    log(SPRINT_METRICS_ACTIONS.SPRINT_CREATED, {
      sprintId: sprint.id,
      name: sprint.name,
      pointsPlanned: sprint.pointsPlanned,
      status: sprint.status,
    });
  };

  const selectedId = selected?.id;
  const commands = useMemo<SprintCommands | undefined>(() => {
    if (!selectedId) return undefined;
    // Keep this sprint chosen while changing it: closing the active sprint or
    // moving its dates must not make the default choice jump to another one.
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
          log(SPRINT_METRICS_ACTIONS.SPRINT_CLOSED, {
            sprintId: done.id,
            name: done.name,
            pointsPlanned: done.pointsPlanned,
            pointsCompleted,
          });
        }
      },
      setCompletedPoints: (pointsCompleted) => {
        write({ pointsCompleted });
      },
      reopen: (status) => {
        const reopened = write({ status });
        if (reopened) {
          log(SPRINT_METRICS_ACTIONS.SPRINT_REOPENED, { sprintId: reopened.id, status });
        }
      },
      select,
      markChecked,
    };
  }, [selectedId, log, select, markChecked]);

  const markdown = useMemo(
    () =>
      selected
        ? toMarkdown({
            sprint: selected,
            series: seriesFor(allSeries, selected.id),
            sprints,
            today,
          })
        : "",
    [selected, allSeries, sprints, today]
  );

  let body: React.ReactNode;
  if (!hydrated || migration === "pending") {
    body = <LoadingSprints />;
  } else if (example) {
    body = (
      <ExamplePreview
        example={example}
        today={today}
        onStart={() => setCreating(true)}
        onExit={() => setExample(null)}
      />
    );
  } else if (selected) {
    body = (
      <div className="space-y-6">
        <div className="flex flex-wrap items-end justify-between gap-3">
          <div className="flex min-w-0 flex-wrap items-end gap-2">
            <SprintPicker
              sprints={sprints}
              selectedId={selected.id}
              onSelect={select}
              allowCreate={false}
            />
            <Button type="button" variant="outline" size="sm" onClick={() => setCreating(true)}>
              <Plus className="mr-1 h-4 w-4" aria-hidden="true" />
              New sprint
            </Button>
          </div>
          <ExportButton
            filename={`sprint-${slug(selected.name)}`}
            markdown={markdown}
            jsonData={{ sprint: selected, series: seriesFor(allSeries, selected.id) }}
          />
        </div>
        <SprintHub
          sprint={selected}
          sprints={sprints}
          allSeries={allSeries}
          today={today}
          commands={commands}
          checked={checked}
        />
      </div>
    );
  } else {
    body = (
      <div className="space-y-6">
        <SprintsEmptyState
          onCreate={() => setCreating(true)}
          onExample={() => setExample(exampleSprints(today))}
        />
        <BoardLevelTools />
      </div>
    );
  }

  return (
    <ToolPageWrapper
      toolId={TOOL_ID}
      title="Sprint Metrics"
      description="Every sprint in one place: where it stands, what to fix, and the sprint tools already open on it."
      category="Metrics & Dashboards"
    >
      {body}
      <NewSprintDialog
        open={creating}
        onOpenChange={setCreating}
        onCreated={onCreated}
        defaultName={nextSprintName(sprints)}
      />
    </ToolPageWrapper>
  );
}

/** The hub on example sprints, in memory only: read-only, nothing is saved. */
function ExamplePreview({
  example,
  today,
  onStart,
  onExit,
}: {
  example: ExampleSprints;
  today: string;
  onStart: () => void;
  onExit: () => void;
}) {
  const [id, setId] = useState(example.current.id);
  const ordered = useMemo(() => sprintsNewestFirst(example.sprints), [example]);
  const sprint = example.sprints.find((s) => s.id === id) ?? example.current;
  return (
    <div className="space-y-6">
      <ExampleBanner onStart={onStart} onExit={onExit} />
      <SprintPicker
        sprints={ordered}
        selectedId={sprint.id}
        onSelect={setId}
        allowCreate={false}
        label="Example sprint"
      />
      <SprintHub
        sprint={sprint}
        sprints={example.sprints}
        allSeries={example.series}
        today={today}
      />
    </div>
  );
}
