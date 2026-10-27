/**
 * The Opportunity Tree page's reading of the nodes: each kind's name and
 * theme tone, the tree as it is drawn (a node whose parent is gone, or a
 * hand-edited cycle, still shows), what a delete takes with it, each
 * experiment's test, and the one-sentence verdict. The rules (which kind
 * goes where, the target, the subtree) are lib/opportunity-tree's, which
 * tool.opportunity_tree uses too.
 */

import type { Hypothesis, JobStory, TreeNode, TreeNodeKind } from "@/lib/stores/workspace-types";
import { linkedTest, type LinkedTest } from "@/lib/hypotheses/model";
import { nodeTitle, outcomeOf, subtreeIds } from "@/lib/opportunity-tree/model";

const plural = (n: number, one: string, many = `${one}s`) => `${n} ${n === 1 ? one : many}`;

export const KIND_LABEL: Record<TreeNodeKind, string> = {
  outcome: "Outcome",
  opportunity: "Opportunity",
  solution: "Solution",
  experiment: "Experiment",
};

const KIND_PLURAL: Record<TreeNodeKind, string> = {
  outcome: "outcomes",
  opportunity: "opportunities",
  solution: "solutions",
  experiment: "experiments",
};

/** "2 solutions", "1 opportunity". */
export const kindCount = (kind: TreeNodeKind, n: number) =>
  `${n} ${n === 1 ? KIND_LABEL[kind].toLowerCase() : KIND_PLURAL[kind]}`;

/** Theme tokens per kind: the card's edge and its chip. The text names the kind too. */
export const KIND_TONE: Record<TreeNodeKind, { edge: string; chip: string }> = {
  outcome: { edge: "border-l-accent", chip: "bg-accent/10 text-accent" },
  opportunity: { edge: "border-l-info", chip: "bg-info/10 text-info" },
  solution: { edge: "border-l-success", chip: "bg-success/10 text-success" },
  experiment: { edge: "border-l-warning", chip: "bg-warning/10 text-warning" },
};

/** The kind as stored, or "outcome" for one the tree doesn't know (a hand-edited row). */
export const kindOf = (n: Pick<TreeNode, "kind">): TreeNodeKind =>
  n.kind in KIND_LABEL ? n.kind : "outcome";

/** The "Add …" button for a child of `parent`'s kind. */
export function addLabel(parent: TreeNodeKind, kind: TreeNodeKind): string {
  if (parent === "opportunity" && kind === "opportunity") return "Add sub-opportunity";
  return `Add ${KIND_LABEL[kind].toLowerCase()}`;
}

/* ── The tree as drawn ───────────────────────────────────────────────── */

export interface DrawnTree {
  /** The nodes drawn at the top: no parent, a parent that is gone, or cut off by a cycle. */
  roots: TreeNode[];
  childrenOf: (id: string) => TreeNode[];
}

/**
 * The tree for drawing, in stored order. A node whose parent isn't on the
 * tree (an agent's or an import's) is drawn at the top rather than lost,
 * and so is a node a hand-edited cycle would hide.
 */
export function drawTree(nodes: readonly TreeNode[]): DrawnTree {
  const ids = new Set(nodes.map((n) => n.id));
  const children = new Map<string, TreeNode[]>();
  const roots: TreeNode[] = [];
  for (const n of nodes) {
    if (n.parentId && n.parentId !== n.id && ids.has(n.parentId)) {
      const list = children.get(n.parentId) ?? [];
      list.push(n);
      children.set(n.parentId, list);
    } else roots.push(n);
  }
  // Anything a cycle cuts off from every root is drawn at the top too.
  const seen = new Set<string>();
  const visit = (start: TreeNode) => {
    const stack = [start];
    while (stack.length > 0) {
      const n = stack.pop()!;
      if (seen.has(n.id)) continue;
      seen.add(n.id);
      stack.push(...(children.get(n.id) ?? []));
    }
  };
  roots.forEach(visit);
  for (const n of nodes) {
    if (!seen.has(n.id)) {
      roots.push(n);
      visit(n);
    }
  }
  return { roots, childrenOf: (id) => children.get(id) ?? [] };
}

/* ── What a delete takes ─────────────────────────────────────────────── */

export interface SubtreeSummary {
  ids: Set<string>;
  /** How many of each kind go with it (the node itself not counted). */
  below: Partial<Record<TreeNodeKind, number>>;
  /** Job stories (JTBD) that link to a node that goes. */
  jobs: number;
  /** Experiments that go and were sent to the Hypothesis Tracker: those hypotheses stay. */
  sentExperiments: number;
}

export function subtreeSummary(
  nodes: readonly TreeNode[],
  id: string,
  jobs: readonly Pick<JobStory, "opportunityId">[] = []
): SubtreeSummary {
  const ids = subtreeIds(nodes, id);
  const below: Partial<Record<TreeNodeKind, number>> = {};
  let sentExperiments = 0;
  for (const n of nodes) {
    if (!ids.has(n.id)) continue;
    if (n.id !== id) below[kindOf(n)] = (below[kindOf(n)] ?? 0) + 1;
    if ((n.sentTo ?? []).some((l) => l.route === "hypothesis")) sentExperiments += 1;
  }
  return {
    ids,
    below,
    jobs: jobs.filter((j) => j.opportunityId && ids.has(j.opportunityId)).length,
    sentExperiments,
  };
}

/** "Delete “X” with 2 solutions and 3 experiments?" */
export function deleteQuestion(node: TreeNode, s: SubtreeSummary): string {
  const parts = (["opportunity", "solution", "experiment", "outcome"] as const)
    .filter((k) => (s.below[k] ?? 0) > 0)
    .map((k) => kindCount(k, s.below[k] ?? 0));
  const tail =
    parts.length === 0
      ? ""
      : ` with ${parts.length === 1 ? parts[0] : `${parts.slice(0, -1).join(", ")} and ${parts.at(-1)}`}`;
  return `Delete “${nodeTitle(node)}”${tail}?`;
}

/** What else the delete touches: linked jobs, hypotheses that stay. */
export function deleteNote(s: SubtreeSummary): string {
  const notes = ["Undo puts everything back."];
  if (s.jobs > 0) {
    notes.unshift(
      `${plural(s.jobs, "job story", "job stories")} ${s.jobs === 1 ? "links" : "link"} to it and will read “Opportunity removed”.`
    );
  }
  if (s.sentExperiments > 0) {
    notes.unshift(
      `The ${s.sentExperiments === 1 ? "hypothesis" : `${s.sentExperiments} hypotheses`} sent from its experiments ${s.sentExperiments === 1 ? "stays" : "stay"} in the Hypothesis Tracker.`
    );
  }
  return notes.join(" ");
}

/* ── Experiments and the verdict ─────────────────────────────────────── */

export function testLabel(t: LinkedTest): string {
  if (t.state === "none") return "";
  if (t.state === "testing")
    return t.status === "running" ? "Testing: running" : "Testing: drafted";
  return `Tested: ${t.result}`;
}

/**
 * The one-sentence verdict: what the team pursues (the target
 * opportunities) and how many of the experiments have been tested.
 */
export function treeVerdict(
  nodes: readonly TreeNode[],
  hypotheses: readonly Pick<Hypothesis, "id" | "status">[]
): string {
  if (nodes.length === 0) return "No outcomes yet.";
  const byId = new Map(nodes.map((n) => [n.id, n]));
  const count = (k: TreeNodeKind) => nodes.filter((n) => n.kind === k).length;
  const targets = nodes.filter((n) => n.kind === "opportunity" && n.target);
  const experiments = nodes.filter((n) => n.kind === "experiment");
  const tests = experiments.map((n) => linkedTest(n.sentTo, hypotheses));
  const tested = tests.filter((t) => t.state === "tested").length;
  const testing = tests.filter((t) => t.state === "testing").length;
  const head = `${kindCount("outcome", count("outcome"))}, ${kindCount("opportunity", count("opportunity"))}`;
  const pursuing =
    targets.length === 0
      ? "no target opportunity picked yet"
      : targets
          .map((t) => {
            const o = outcomeOf(t, byId);
            return `pursuing “${nodeTitle(t)}”${o ? ` for “${nodeTitle(o)}”` : ""}`;
          })
          .join(" and ");
  const testText =
    experiments.length === 0
      ? "no experiments yet"
      : `${tested} of ${kindCount("experiment", experiments.length)} tested${testing > 0 ? `, ${testing} being tested` : ""}`;
  return `${head}; ${pursuing}; ${testText}.`;
}
