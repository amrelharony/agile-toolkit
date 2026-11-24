/**
 * Relative Sizing's data-aware next steps (lib/tools/next-steps.ts calls
 * `relativeSizingSteps`):
 *   1. UNSIZED_BATCH_MIN or more unsized backlog stories: size them
 *      together here;
 *   2. otherwise, sized backlog stories with no planned or active sprint
 *      holding any story yet: plan the next sprint with them.
 * Pure: no store, no React, no "use client" module.
 */

import type { Sprint, Story } from "@/lib/stores/workspace-types";
import type { NextStep } from "@/lib/tools/next-steps";
import { isExampleId } from "@/lib/utils/example-id";
import { UNSIZED_BATCH_MIN, unsizedBacklog } from "./unsized";

/** What the rule reads from the workspace. */
export interface RelativeSizingStepsInput {
  stories: readonly Story[];
  sprints: readonly Sprint[];
}

const sized = (s: Story) =>
  !s.sprintId &&
  s.status === "backlog" &&
  typeof s.points === "number" &&
  Number.isFinite(s.points) &&
  s.points > 0 &&
  !isExampleId(s.id);

/** Relative Sizing's next steps. */
export function relativeSizingSteps(s: RelativeSizingStepsInput): NextStep[] {
  const stories = s.stories ?? [];
  const unsized = unsizedBacklog(stories);
  if (unsized.length >= UNSIZED_BATCH_MIN) {
    return [
      {
        id: "relative-sizing-unsized",
        label: `Size the ${unsized.length} unsized backlog stories together`,
        detail: "Sorting them into buckets is quicker than estimating them one by one.",
        href: "/relative-sizing?stories=unsized",
      },
    ];
  }
  const ready = stories.filter(sized);
  if (ready.length === 0) return [];
  const open = new Set(
    (s.sprints ?? [])
      .filter((sp) => sp.status === "planned" || sp.status === "active")
      .map((sp) => sp.id)
  );
  const planning = stories.some((st) => st.sprintId && open.has(st.sprintId));
  if (planning) return [];
  return [
    {
      id: "relative-sizing-plan-sprint",
      label: "Plan the next sprint with the sized stories",
      detail: `${ready.length} backlog ${ready.length === 1 ? "story has" : "stories have"} a size, and no sprint is planned yet.`,
      href: "/sprint-planning",
    },
  ];
}
