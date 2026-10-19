"use client";

import { useMemo, useState } from "react";
import type { Sprint, SprintSeries } from "@/lib/stores/workspace-types";
import { sprintStatus } from "@/lib/sprints/metrics";
import { seriesFor } from "@/lib/sprints/series";
import {
  averageVelocity,
  completedSprints,
  hubTiles,
  sprintNudges,
  toolStatusLines,
} from "../view";
import { SprintHeader } from "./sprint-header";
import { SprintTiles } from "./sprint-tiles";
import { BoardLevelTools, SprintToolCards } from "./tool-cards";
import { Nudges } from "./nudges";
import { CloseSprintDialog } from "./close-sprint-dialog";

/** What the hub can change. Left out for a read-only example preview. */
export interface SprintCommands {
  edit: (patch: Partial<Omit<Sprint, "id">>) => void;
  close: (pointsCompleted: number) => void;
  setCompletedPoints: (pointsCompleted: number) => void;
  reopen: (status: Exclude<Sprint["status"], "completed">) => void;
  select: (id: string) => void;
  /** A migrated sprint the user has checked. */
  markChecked: (id: string) => void;
}

export interface SprintHubProps {
  sprint: Sprint;
  /** Every sprint (for averages and "other sprints to check"). */
  sprints: readonly Sprint[];
  allSeries: readonly SprintSeries[];
  today: string;
  commands?: SprintCommands;
  /** Migrated sprints already checked. */
  checked?: ReadonlySet<string>;
}

const NO_CHECKED: ReadonlySet<string> = new Set();

/** One sprint in the hub: header, checks, numbers and the tools. */
export function SprintHub({
  sprint,
  sprints,
  allSeries,
  today,
  commands,
  checked = NO_CHECKED,
}: SprintHubProps) {
  const readOnly = !commands;
  const [detailsOpen, setDetailsOpen] = useState(false);
  const [focusField, setFocusField] = useState<"dates" | null>(null);
  const [dialogOpen, setDialogOpen] = useState(false);
  const [dialogMode, setDialogMode] = useState<"close" | "points">("close");

  const series = useMemo(() => seriesFor(allSeries, sprint.id), [allSeries, sprint.id]);
  const status = useMemo(() => sprintStatus(sprint, series), [sprint, series]);
  const completed = useMemo(() => completedSprints(sprints), [sprints]);
  const tiles = useMemo(
    () => hubTiles(sprint, status, averageVelocity(completed, sprint.id)),
    [sprint, status, completed]
  );
  const statusLines = useMemo(
    () => toolStatusLines(status, averageVelocity(completed)),
    [status, completed]
  );

  const nudges = readOnly ? [] : sprintNudges(sprint, series, checked);
  const others = readOnly
    ? []
    : sprints.filter(
        (s) => s.id !== sprint.id && sprintNudges(s, seriesFor(allSeries, s.id), checked).length > 0
      );

  const openDialog = (mode: "close" | "points") => {
    setDialogMode(mode);
    setDialogOpen(true);
  };
  const openDetails = (focus: "dates" | null) => {
    setFocusField(focus);
    setDetailsOpen(true);
  };

  return (
    <div className="space-y-6">
      <SprintHeader
        // Fresh drafts when another sprint is chosen.
        key={sprint.id}
        sprint={sprint}
        today={today}
        readOnly={readOnly}
        detailsOpen={detailsOpen}
        onDetailsOpenChange={(open) => {
          setDetailsOpen(open);
          if (!open) setFocusField(null);
        }}
        focusField={focusField}
        onEdit={(patch) => commands?.edit(patch)}
        onRequestClose={() => openDialog("close")}
        onReopen={(next) => commands?.reopen(next)}
      />

      {commands && (
        <Nudges
          sprint={sprint}
          series={series}
          nudges={nudges}
          others={others}
          onAddPoints={() => openDialog("points")}
          onSetDates={() => openDetails("dates")}
          onCheckDetails={() => openDetails(null)}
          onLooksRight={() => commands.markChecked(sprint.id)}
          onSelect={commands.select}
        />
      )}

      <SprintTiles tiles={tiles} />

      <SprintToolCards sprintId={readOnly ? undefined : sprint.id} status={statusLines} />

      <BoardLevelTools />

      {commands && (
        <CloseSprintDialog
          open={dialogOpen}
          onOpenChange={setDialogOpen}
          sprint={sprint}
          series={series}
          mode={dialogMode}
          onConfirm={(n) =>
            dialogMode === "points" ? commands.setCompletedPoints(n) : commands.close(n)
          }
        />
      )}
    </div>
  );
}
