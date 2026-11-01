/**
 * The Opportunity Tree's check for a node: it needs its text, and its
 * kind must fit where it goes (lib/opportunity-tree canParent, the rule
 * tool.opportunity_tree.add_node applies too). Nothing is saved blank.
 */

import type { TreeNode, TreeNodeKind } from "@/lib/stores/workspace-types";
import { NODE_TEXT_MAX, canParent } from "@/lib/opportunity-tree/model";
import type { FormErrors, Validation } from "@/lib/utils/form";

export interface NodeDraft {
  text: string;
  description: string;
  evidence: string;
}

export type NodeField = keyof NodeDraft;

export interface NodeValues {
  text: string;
  /** Undefined when blank: the key is removed. */
  description: string | undefined;
  evidence: string | undefined;
}

export const emptyNodeDraft = (): NodeDraft => ({ text: "", description: "", evidence: "" });

export const nodeDraftFrom = (n: TreeNode): NodeDraft => ({
  text: n.text ?? "",
  description: n.description ?? "",
  evidence: n.evidence ?? "",
});

/** What each kind asks for, in the form's words. */
export const TEXT_PROMPT: Record<
  TreeNodeKind,
  { label: string; placeholder: string; blank: string }
> = {
  outcome: {
    label: "Outcome",
    placeholder: "Teams spot blocked work within a day",
    blank: "Say the outcome you want to move.",
  },
  opportunity: {
    label: "Opportunity",
    placeholder: "I can't see who is blocked without asking",
    blank: "Say the customer need, pain or wish.",
  },
  solution: {
    label: "Solution",
    placeholder: "A daily digest of blocked cards",
    blank: "Say the solution you'd try.",
  },
  experiment: {
    label: "Experiment",
    placeholder: "Email a hand-made digest to five teams",
    blank: "Say how you'd test the solution.",
  },
};

/** Evidence belongs to what a customer said (an opportunity) and what a test showed (an experiment). */
export const HAS_EVIDENCE: ReadonlySet<TreeNodeKind> = new Set<TreeNodeKind>([
  "opportunity",
  "experiment",
]);

/**
 * Check a node's fields. `parent` is where a new node goes (null: the top
 * of the tree); `stored` is the saved node when editing, whose longer text
 * is kept while it is unchanged.
 */
export function validateNode(
  d: NodeDraft,
  kind: TreeNodeKind,
  opts: { parent?: TreeNode | null; stored?: TreeNode } = {}
): Validation<NodeValues, NodeField> {
  const errors: FormErrors<NodeField> = {};
  const text = d.text.trim();
  const description = d.description.trim();
  const evidence = d.evidence.trim();
  const over = (value: string, kept: string | undefined) =>
    value.length > NODE_TEXT_MAX && value !== (kept ?? "").trim();
  if (!text) errors.text = TEXT_PROMPT[kind]?.blank ?? "Type its text.";
  else if (over(text, opts.stored?.text)) {
    errors.text = `Keep it to ${NODE_TEXT_MAX} characters or fewer.`;
  }
  if (over(description, opts.stored?.description)) {
    errors.description = `Keep it to ${NODE_TEXT_MAX} characters or fewer.`;
  }
  if (over(evidence, opts.stored?.evidence)) {
    errors.evidence = `Keep it to ${NODE_TEXT_MAX} characters or fewer.`;
  }
  if (!opts.stored && opts.parent !== undefined && !canParent(opts.parent, kind)) {
    errors.text = `A ${kind} can't go there.`;
  }
  if (Object.keys(errors).length > 0) return { ok: false, errors };
  return {
    ok: true,
    values: { text, description: description || undefined, evidence: evidence || undefined },
  };
}

/** The node saved with checked values; every other key (target, links) is kept. */
export function applyNodeValues(n: TreeNode, v: NodeValues): TreeNode {
  const next: TreeNode = { ...n, text: v.text };
  for (const key of ["description", "evidence"] as const) {
    const value = v[key];
    if (value === undefined) delete next[key];
    else next[key] = value;
  }
  return next;
}
