import type { JobStory, Story } from "@/lib/stores/workspace-types";
import { jobSentence, jobsInTreeOrder, storiesByJob } from "./jobs";
import { jtbdSummary } from "./verdict";

/** "18 Oct 2026" */
function mdDate(d: Date): string {
  return d.toLocaleDateString("en-GB", { day: "numeric", month: "short", year: "numeric" });
}

/** One line of text: newlines folded, Markdown's list and emphasis markers left alone. */
function line(v: string): string {
  return v.replace(/\s*[\r\n]+\s*/g, " ").trim();
}

const STATUS: Record<Story["status"], string> = {
  backlog: "on the backlog",
  todo: "to do",
  in_progress: "in progress",
  review: "in review",
  done: "done",
};

/** The job map as a nested list, sub-jobs under their parent, for a discovery wiki or a ticket. */
export function toMarkdown(
  jobs: readonly JobStory[],
  stories: readonly Story[],
  now: Date = new Date()
): string {
  const title = `# Job stories — ${mdDate(now)}`;
  if (jobs.length === 0) return `${title}\n\nNo job stories yet.\n`;

  const byJob = storiesByJob(stories);
  const lines = [title, ""];
  for (const { job, depth } of jobsInTreeOrder(jobs)) {
    const indent = "  ".repeat(depth);
    const story = byJob.get(job.id);
    const tag = story ? ` _(story ${STATUS[story.status] ?? story.status})_` : "";
    lines.push(`${indent}- ${line(jobSentence(job))}${tag}`);
    if (job.description) lines.push(`${indent}  ${line(job.description)}`);
  }
  lines.push("", `**${jtbdSummary(jobs, stories)}**`);
  return `${lines.join("\n")}\n`;
}
