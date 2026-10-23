import type { HandoffLink, JobStory, Story } from "@/lib/stores/workspace-types";
import { STORY_TITLE_MAX } from "@/lib/handoffs/targets/backlog-story";

/** The tool id a story sent from a job carries in `sourceRef.tool`. */
export const JOB_TOOL = "jtbd-mapper";

/** "When …, I want to …, so I can …." — blanks (legacy rows) read as a gap. */
export function jobSentence(j: Pick<JobStory, "situation" | "motivation" | "outcome">): string {
  return `When ${j.situation || "(situation)"}, I want to ${j.motivation || "(motivation)"}, so I can ${j.outcome || "(outcome)"}.`;
}

/** The job's parent, when it is set and still exists. */
function parentOf(job: JobStory, byId: ReadonlyMap<string, JobStory>): JobStory | undefined {
  return job.parentJobId && job.parentJobId !== job.id ? byId.get(job.parentJobId) : undefined;
}

/**
 * Ids of every job nested under `id` (children, grandchildren, ...), not
 * including `id`. Stops on cycles.
 */
export function descendantIds(jobs: readonly JobStory[], id: string): Set<string> {
  const found = new Set<string>([id]);
  let grew = true;
  while (grew) {
    grew = false;
    for (const j of jobs) {
      if (j.parentJobId && found.has(j.parentJobId) && !found.has(j.id)) {
        found.add(j.id);
        grew = true;
      }
    }
  }
  found.delete(id);
  return found;
}

export interface JobTree {
  /** Jobs shown at the top level, in stored order. */
  roots: JobStory[];
  /** Each job's children, in stored order. */
  children: Map<string, JobStory[]>;
}

/**
 * The jobs as a tree, with every job in it exactly once.
 *
 * Only jobs without a parent used to render, so a job whose parent was
 * deleted elsewhere (another tab, an agent) or a hand-edited cycle
 * (A under B under A) silently vanished from the page. A missing parent
 * now reads as top level, and a cycle is entered at its first job in
 * stored order.
 */
export function jobTree(jobs: readonly JobStory[]): JobTree {
  const byId = new Map(jobs.map((j) => [j.id, j]));
  const children = new Map<string, JobStory[]>();
  const roots: JobStory[] = [];
  for (const j of jobs) {
    const parent = parentOf(j, byId);
    if (!parent) {
      roots.push(j);
      continue;
    }
    const list = children.get(parent.id) ?? [];
    list.push(j);
    children.set(parent.id, list);
  }
  const reached = new Set<string>();
  const walk = (id: string) => {
    if (reached.has(id)) return;
    reached.add(id);
    for (const c of children.get(id) ?? []) walk(c.id);
  };
  roots.forEach((r) => walk(r.id));

  const order = new Map(jobs.map((j, i) => [j.id, i]));
  for (const j of jobs) {
    if (reached.has(j.id)) continue;
    // Not reached from a root, so a cycle sits above it: climb to it.
    const path: string[] = [];
    let cur: JobStory | undefined = j;
    while (cur && !path.includes(cur.id)) {
      path.push(cur.id);
      cur = parentOf(cur, byId);
    }
    const cycle = cur ? path.slice(path.indexOf(cur.id)) : [j.id];
    const entry = cycle.reduce((a, b) => ((order.get(a) ?? 0) <= (order.get(b) ?? 0) ? a : b));
    // Show the cycle's first job at the top level; it leaves its parent's
    // children so the tree stays a tree.
    const entryJob = byId.get(entry) as JobStory;
    roots.push(entryJob);
    const parentId = entryJob.parentJobId;
    const siblings = parentId ? children.get(parentId) : undefined;
    if (parentId && siblings)
      children.set(
        parentId,
        siblings.filter((c) => c.id !== entry)
      );
    walk(entry);
  }
  return { roots, children };
}

/** The jobs in tree order with their depth, for parent pickers and exports. */
export function jobsInTreeOrder(jobs: readonly JobStory[]): { job: JobStory; depth: number }[] {
  const { roots, children } = jobTree(jobs);
  const out: { job: JobStory; depth: number }[] = [];
  const seen = new Set<string>();
  const visit = (job: JobStory, depth: number) => {
    if (seen.has(job.id)) return;
    seen.add(job.id);
    out.push({ job, depth });
    for (const c of children.get(job.id) ?? []) visit(c, depth + 1);
  };
  roots.forEach((r) => visit(r, 0));
  return out;
}

/** Whether putting `id` under `parentId` would make a job its own ancestor. */
export function wouldCycle(jobs: readonly JobStory[], id: string, parentId: string): boolean {
  return parentId === id || descendantIds(jobs, id).has(parentId);
}

/* ── Backlog stories made from jobs ─────────────────────────────────── */

/**
 * The backlog story made from each job, by job id. The story's `sourceRef`
 * is the link: JobStory has no `sentTo` list, and reading the link off the
 * stories means a story deleted in Sprint Planning frees the job to make a
 * new one, with nothing to keep in step.
 */
export function storiesByJob(stories: readonly Story[]): Map<string, Story> {
  const map = new Map<string, Story>();
  for (const s of stories) {
    const ref = s.sourceRef;
    if (ref?.tool === JOB_TOOL && ref.id && !map.has(ref.id)) map.set(ref.id, s);
  }
  return map;
}

/** The job's story as the hand-off link `sendHandoff` checks before sending. */
export function jobLinks(jobId: string, stories: readonly Story[]): HandoffLink[] {
  const story = storiesByJob(stories).get(jobId);
  return story ? [{ route: "backlog-story", targetId: story.id, at: "" }] : [];
}

const capitalise = (s: string) => s.charAt(0).toUpperCase() + s.slice(1);

/**
 * A backlog story's title for a job: the whole job sentence when it fits a
 * story title, else what the user wants to do ("See where my parcel is"),
 * cut at a word with an ellipsis as a last resort.
 */
export function storyTitleFor(job: Pick<JobStory, "situation" | "motivation" | "outcome">): string {
  const sentence = jobSentence(job);
  if (sentence.length <= STORY_TITLE_MAX) return sentence;
  const want = capitalise(job.motivation.trim());
  if (want && want.length <= STORY_TITLE_MAX) return want;
  const source = want || sentence;
  const cut = source.slice(0, STORY_TITLE_MAX - 1);
  const atWord = cut.lastIndexOf(" ");
  return `${(atWord > STORY_TITLE_MAX / 2 ? cut.slice(0, atWord) : cut).trimEnd()}…`;
}
