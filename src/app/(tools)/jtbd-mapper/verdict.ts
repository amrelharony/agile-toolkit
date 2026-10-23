import type { JobStory, Story } from "@/lib/stores/workspace-types";
import { plural } from "@/lib/charts/chart-text";
import { jobTree, storiesByJob } from "./jobs";

/**
 * The one line above the jobs, in place of the old "Max depth" and
 * "Without children" cards: how many jobs there are and how many already
 * became backlog stories — the step that turns the map into work.
 *
 * The count includes the top-level jobs ("5 job stories, 2 at the top
 * level"), and a job's story is counted wherever it now is: "on the
 * backlog" was said of stories already planned, in progress or done.
 */
export function jtbdSummary(jobs: readonly JobStory[], stories: readonly Story[]): string {
  if (jobs.length === 0) return "No job stories yet.";
  const total = jobs.length;
  const roots = jobTree(jobs).roots.length;
  const byJob = storiesByJob(stories);
  const withStory = jobs.filter((j) => byJob.has(j.id)).length;
  const done = jobs.filter((j) => byJob.get(j.id)?.status === "done").length;

  const all = plural(total, "job story", "job stories");
  const head = roots === total ? all : `${all}, ${roots} at the top level`;
  let tail: string;
  if (withStory === 0) tail = "none has a story yet";
  else if (withStory === total) tail = total === 1 ? "it has a story" : "all have stories";
  else tail = `${withStory} ${withStory === 1 ? "has a story" : "have stories"}`;
  if (done > 0)
    tail += done === withStory ? (withStory === 1 ? " (done)" : " (all done)") : ` (${done} done)`;
  return `${head}; ${tail}.`;
}
