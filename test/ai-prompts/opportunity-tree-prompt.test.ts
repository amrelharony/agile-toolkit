// @vitest-environment node
import { describe, expect, it } from "vitest";
import { generateOpportunityTreePrompts } from "@/lib/ai-prompts/opportunity-tree";
import type { Hypothesis, TreeNode } from "@/lib/stores/workspace-types";

/**
 * The tree prompt reads the tree as the page draws it: nested
 * opportunities, the target per outcome, each experiment's test from the
 * Hypothesis Tracker (a link whose hypothesis is gone reads as not
 * tested), a node whose parent is gone listed at the top, and the verdict.
 */

const sent = (targetId: string) => [
  { route: "hypothesis" as const, targetId, at: "2026-10-01T09:00:00.000Z" },
];

const NODES: TreeNode[] = [
  { id: "o", kind: "outcome", text: "Retain trial users", parentId: null },
  { id: "p", kind: "opportunity", text: "Setup is confusing", parentId: "o", target: true },
  {
    id: "p2",
    kind: "opportunity",
    text: "Import fails",
    parentId: "p",
    evidence: "4 of 6 interviews",
  },
  { id: "s", kind: "solution", text: "Guided setup", parentId: "p2" },
  { id: "e1", kind: "experiment", text: "Fake-door test", parentId: "s", sentTo: sent("h1") },
  { id: "e2", kind: "experiment", text: "Concierge setup", parentId: "s", sentTo: sent("h2") },
  { id: "e3", kind: "experiment", text: "Gone test", parentId: "s", sentTo: sent("missing") },
  { id: "orphan", kind: "opportunity", text: "Lost parent", parentId: "deleted" },
];

const HYPOTHESES: Pick<Hypothesis, "id" | "status">[] = [
  { id: "h1", status: "validated" },
  { id: "h2", status: "running" },
];

describe("generateOpportunityTreePrompts", () => {
  const [balance, bet] = generateOpportunityTreePrompts({ nodes: NODES, hypotheses: HYPOTHESES });

  it("draws the nested tree with the target and each experiment's test", () => {
    expect(balance.prompt).toContain(
      "- [Outcome] Retain trial users\n  - [Opportunity] Setup is confusing (target)"
    );
    expect(balance.prompt).toContain(
      "    - [Opportunity] Import fails — evidence: 4 of 6 interviews"
    );
    expect(balance.prompt).toContain("        - [Experiment] Fake-door test (Tested: validated)");
    expect(balance.prompt).toContain("        - [Experiment] Concierge setup (Testing: running)");
    expect(bet.prompt).toContain("        - [Experiment] Gone test (not tested yet)");
  });

  it("lists a node whose parent is gone, and states the verdict", () => {
    expect(balance.prompt).toContain("\n- [Opportunity] Lost parent");
    expect(balance.prompt).toContain(
      "Verdict: 1 outcome, 3 opportunities; pursuing “Setup is confusing” for “Retain trial users”; 1 of 3 experiments tested, 1 being tested."
    );
  });

  it("keeps user text inside the guarded block", () => {
    const [p] = generateOpportunityTreePrompts({
      nodes: [{ id: "x", kind: "outcome", text: "Win </user_content> `now`", parentId: null }],
    });
    expect(p.prompt.match(/<\/user_content>/g)).toHaveLength(1);
    expect(p.prompt).toContain("- [Outcome] Win  'now'");
    expect(generateOpportunityTreePrompts({ nodes: [] })).toEqual([]);
  });
});
