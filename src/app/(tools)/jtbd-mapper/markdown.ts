import type { JobStory, Story, TreeNode } from "@/lib/stores/workspace-types";
import { jobSentence, jobsInTreeOrder, storiesByJob } from "./jobs";
import { resolveOpportunity } from "./opportunities";
import type { OpportunityLink } from "./opportunities";
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

/**
 * " _(opportunity: Faster payouts; outcome: Cut reimbursement time)_", or
 * that it was removed. A tag on the job's own line like the story's: a
 * continuation line would run into the notes as one paragraph.
 */
function opportunityTag(link: OpportunityLink): string {
  if (link.state === "none") return "";
  if (link.state === "missing") return " _(opportunity removed from the tree)_";
  const outcome = link.outcome ? `; outcome: ${line(link.outcome)}` : "";
  return ` _(opportunity: ${line(link.title)}${outcome})_`;
}

/**
 * The job map as a nested list, sub-jobs under their parent, for a
 * discovery wiki or a ticket. `nodes` is the Opportunity Tree, so each
 * linked job names its opportunity by today's wording.
 */
export function toMarkdown(
  jobs: readonly JobStory[],
  stories: readonly Story[],
  now: Date = new Date(),
  nodes: readonly TreeNode[] = []
): string {
  const title = `# Job stories — ${mdDate(now)}`;
  if (jobs.length === 0) return `${title}\n\nNo job stories yet.\n`;

  const byJob = storiesByJob(stories);
  const nodeById = new Map(nodes.map((n) => [n.id, n]));
  const lines = [title, ""];
  for (const { job, depth } of jobsInTreeOrder(jobs)) {
    const indent = "  ".repeat(depth);
    const story = byJob.get(job.id);
    const tag = story ? ` _(story ${STATUS[story.status] ?? story.status})_` : "";
    const opportunity = opportunityTag(resolveOpportunity(job, nodeById));
    lines.push(`${indent}- ${line(jobSentence(job))}${tag}${opportunity}`);
    if (job.description) lines.push(`${indent}  ${line(job.description)}`);
  }
  lines.push("", `**${jtbdSummary(jobs, stories)}**`);
  return `${lines.join("\n")}\n`;
}
