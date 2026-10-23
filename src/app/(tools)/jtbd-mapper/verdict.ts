import type { JobStory, Story } from "@/lib/stores/workspace-types";
import { plural } from "@/lib/charts/chart-text";
import { jobTree, storiesByJob } from "./jobs";

/**
 * The one line above the jobs, in place of the old "Max depth" and
 * "Without children" cards: how many jobs there are and how many already
 * became backlog stories — the step that turns the map into work.
 */
export function jtbdSummary(jobs: readonly JobStory[], stories: readonly Story[]): string {
  if (jobs.length === 0) return "No job stories yet.";
  const total = jobs.length;
  const roots = jobTree(jobs).roots.length;
  const byJob = storiesByJob(stories);
  const onBacklog = jobs.filter((j) => byJob.has(j.id)).length;

  const head =
    roots === total
      ? plural(total, "job story", "job stories")
      : `${plural(total, "job story", "job stories")} under ${plural(roots, "top-level job")}`;
  let tail: string;
  if (onBacklog === 0) tail = "none is on the backlog yet";
  else if (onBacklog === total)
    tail = total === 1 ? "it is on the backlog" : "all are on the backlog";
  else
    tail =
      onBacklog === 1
        ? "1 is on the backlog as a story"
        : `${onBacklog} are on the backlog as stories`;
  return `${head}; ${tail}.`;
}
