/**
 * tool.opportunity_tree.* after Phase 8, on both transports: add_node puts
 * a kind only where it may go, set_target keeps one per outcome,
 * remove_node takes the subtree (confirmed), and an experiment is sent to
 * the Hypothesis Tracker once, never an example, as lib/opportunity-tree maps it.
 */

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const rows = vi.hoisted(() => new Map<string, unknown>());
vi.mock("@/lib/actions/server-store", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/lib/actions/server-store")>();
  return {
    ...actual,
    serverGetEntity: vi.fn(async (_u: string, kind: string, id: string) => {
      return rows.get(`${kind}/${id}`) ?? null;
    }),
    serverUpsertEntity: vi.fn(async (_u: string, kind: string, entity: { id: string }) => {
      rows.set(`${kind}/${entity.id}`, entity);
    }),
  };
});

import { registry } from "@/lib/actions/registry";
import type { ActionContext } from "@/lib/actions/context";
import { useWorkspaceStore } from "@/lib/stores/workspace-store";
import type {
  Hypothesis,
  HypothesisTracker,
  OpportunityTree,
  TreeNode,
} from "@/lib/stores/workspace-types";
import {
  OPPORTUNITY_TREE_ID,
  experimentHypothesisSource,
  withTarget,
} from "@/lib/opportunity-tree/model";
import { HYPOTHESIS_TRACKER_ID } from "@/lib/hypotheses/model";

import "@/lib/actions/tools/opportunity-tree";

type Path = "handler" | "mcpHandler";
const TRANSPORTS: Path[] = ["handler", "mcpHandler"];
const KIND_OT = "workspace:opportunityTree";
const KIND_HT = "workspace:hypothesisTracker";
const baseCtx: ActionContext = { userId: "u", source: "agent", squadProfileIds: [] };

const run = <T = Record<string, unknown>>(
  path: Path,
  verb: string,
  params: Record<string, unknown> = {},
  ctx: ActionContext = baseCtx
) => {
  const action = registry.get(`tool.opportunity_tree.${verb}`)!;
  return action[path]!(action.paramsSchema.parse(params), ctx) as Promise<T>;
};

function seed(path: Path, nodes: TreeNode[], hypotheses?: Hypothesis[]) {
  const tree: OpportunityTree = { id: OPPORTUNITY_TREE_ID, nodes };
  const tracker: HypothesisTracker | undefined = hypotheses && {
    id: HYPOTHESIS_TRACKER_ID,
    hypotheses,
  };
  if (path === "handler") {
    useWorkspaceStore.setState({
      opportunityTrees: [tree],
      hypothesisTrackers: tracker ? [tracker] : [],
    });
  } else {
    rows.set(`${KIND_OT}/${OPPORTUNITY_TREE_ID}`, tree);
    if (tracker) rows.set(`${KIND_HT}/${HYPOTHESIS_TRACKER_ID}`, tracker);
  }
}

const nodesOf = (path: Path): TreeNode[] =>
  (path === "handler"
    ? (useWorkspaceStore.getState().opportunityTrees ?? []).find(
        (d) => d.id === OPPORTUNITY_TREE_ID
      )
    : (rows.get(`${KIND_OT}/${OPPORTUNITY_TREE_ID}`) as OpportunityTree | undefined)
  )?.nodes ?? [];
const hypothesesOf = (path: Path): Hypothesis[] =>
  (path === "handler"
    ? (useWorkspaceStore.getState().hypothesisTrackers ?? []).find(
        (d) => d.id === HYPOTHESIS_TRACKER_ID
      )
    : (rows.get(`${KIND_HT}/${HYPOTHESIS_TRACKER_ID}`) as HypothesisTracker | undefined)
  )?.hypotheses ?? [];

const node = (
  id: string,
  kind: TreeNode["kind"],
  parentId: string | null,
  over: Partial<TreeNode> = {}
): TreeNode => ({
  id,
  kind,
  text: `${kind} ${id}`,
  parentId,
  ...over,
});

const TREE: TreeNode[] = [
  node("o1", "outcome", null),
  node("p1", "opportunity", "o1", { target: true }),
  node("p2", "opportunity", "o1"),
  node("s1", "solution", "p1"),
  node("e1", "experiment", "s1", { description: "Two weeks" }),
  node("example-e", "experiment", "s1"),
];

beforeEach(() => {
  vi.useFakeTimers({ toFake: ["Date"] });
  vi.setSystemTime(new Date(2026, 9, 27, 10, 0, 0));
  rows.clear();
  useWorkspaceStore.setState({ opportunityTrees: [], hypothesisTrackers: [] });
});

afterEach(() => {
  vi.useRealTimers();
});

describe("registration", () => {
  it("adds set_target, remove_node (confirmed) and send_experiment_to_hypothesis", () => {
    for (const verb of ["set_target", "remove_node", "send_experiment_to_hypothesis"]) {
      const action = registry.get(`tool.opportunity_tree.${verb}`);
      expect(action?.category, verb).toBe("write");
      expect(action?.mcpHandler, verb).toBeTypeOf("function");
    }
    expect(registry.get("tool.opportunity_tree.remove_node")?.requiresConfirmation).toBe(true);
    expect(registry.get("tool.opportunity_tree.set_target")?.requiresConfirmation).toBe(false);
  });
});

describe.each(TRANSPORTS)("%s", (path) => {
  it("add_node nests opportunities and refuses a kind where it can't go", async () => {
    seed(path, TREE);
    expect(
      (await run(path, "add_node", { kind: "opportunity", text: "Sub", parentId: "p1" })).added
    ).toBe(true);
    expect((await run(path, "add_node", { kind: "opportunity", text: "Root need" })).added).toBe(
      true
    );
    const atRoot = await run(path, "add_node", { kind: "experiment", text: "x" });
    expect(atRoot).toEqual({
      added: false,
      reason: "kind",
      message: "An experiment can't go at the root; only an outcome or an opportunity can.",
    });
    const underExperiment = await run(path, "add_node", {
      kind: "outcome",
      text: "x",
      parentId: "e1",
    });
    expect(underExperiment).toMatchObject({
      added: false,
      reason: "kind",
      message: expect.stringMatching(/nothing goes there/),
    });
    expect(
      await run(path, "add_node", { kind: "solution", text: "x", parentId: "o1" })
    ).toMatchObject({
      added: false,
      reason: "kind",
    });
    expect(await run(path, "add_node", { kind: "solution", text: "x", parentId: "nope" })).toEqual({
      added: false,
      reason: "parent_not_found",
    });
    expect(nodesOf(path)).toHaveLength(TREE.length + 2);
  });

  it("set_target keeps one target per outcome, as the library does", async () => {
    seed(path, TREE);
    expect(await run(path, "set_target", { nodeId: "p2", on: true })).toEqual({
      updated: true,
      target: true,
      cleared: ["p1"],
    });
    expect(nodesOf(path)).toEqual(withTarget(TREE, "p2", true));
    await run(path, "set_target", { nodeId: "p2", on: false });
    expect(nodesOf(path).some((n) => n.target)).toBe(false);
    expect(await run(path, "set_target", { nodeId: "s1", on: true })).toEqual({
      updated: false,
      reason: "not_opportunity",
    });
    expect(await run(path, "set_target", { nodeId: "nope", on: true })).toEqual({
      updated: false,
      reason: "not_found",
    });
  });

  it("remove_node removes the subtree once confirmed, and nothing when declined", async () => {
    seed(path, TREE);
    const asked: string[] = [];
    const declined = await run(
      path,
      "remove_node",
      { nodeId: "p1" },
      {
        ...baseCtx,
        confirm: async (s) => (asked.push(s), false),
      }
    );
    expect(declined).toEqual({ removed: false, confirmed: false });
    expect(asked[0]).toMatch(/opportunity p1.*and the 3 nodes under it/);
    expect(nodesOf(path)).toHaveLength(TREE.length);

    const removed = await run(
      path,
      "remove_node",
      { nodeId: "p1" },
      { ...baseCtx, confirm: async () => true }
    );
    expect(removed).toEqual({ removed: true, ids: ["p1", "s1", "e1", "example-e"], count: 4 });
    expect(nodesOf(path).map((n) => n.id)).toEqual(["o1", "p2"]);
    expect(await run(path, "remove_node", { nodeId: "p1" })).toEqual({
      removed: false,
      reason: "not_found",
    });
  });

  it("sends an experiment as the library maps it, once, linked both ways", async () => {
    seed(path, TREE, []);
    const r = await run(path, "send_experiment_to_hypothesis", { nodeId: "e1" });
    expect(r).toMatchObject({ sent: true, believe: "solution s1", missing: ["successMetric"] });
    const [h] = hypothesesOf(path);
    const src = experimentHypothesisSource(TREE[4], TREE);
    expect(h).toEqual({
      id: r.hypothesisId,
      believe: src.title,
      willDo: "experiment e1",
      toLearn: "opportunity p1",
      successMetric: "",
      experiment: "Two weeks",
      status: "drafted",
      raisedAt: "2026-10-27",
      sourceRef: { tool: "opportunity-tree", id: "e1", doc: OPPORTUNITY_TREE_ID },
    });
    expect(nodesOf(path).find((n) => n.id === "e1")?.sentTo).toEqual([
      { route: "hypothesis", targetId: r.hypothesisId, at: expect.any(String) },
    ]);

    const state = (await run(path, "list_state")) as {
      targets: unknown[];
      nodes: (TreeNode & { test?: { state: string } })[];
    };
    expect(state.targets).toEqual([{ id: "p1", text: "opportunity p1", outcomeId: "o1" }]);
    expect(state.nodes.find((n) => n.id === "e1")?.test).toEqual({
      state: "testing",
      hypothesisId: r.hypothesisId,
      status: "drafted",
    });
    expect(state.nodes.find((n) => n.id === "p1")).not.toHaveProperty("test");

    expect(await run(path, "send_experiment_to_hypothesis", { nodeId: "e1" })).toEqual({
      sent: false,
      reason: "already_sent",
      hypothesisId: r.hypothesisId,
    });
  });

  it("never sends an example, another kind, a blank experiment or an unknown node", async () => {
    seed(path, [...TREE, node("e2", "experiment", null, { text: " " })], []);
    const send = (nodeId: string) => run(path, "send_experiment_to_hypothesis", { nodeId });
    expect(await send("example-e")).toEqual({ sent: false, reason: "example" });
    expect(await send("s1")).toEqual({ sent: false, reason: "not_experiment" });
    expect(await send("e2")).toEqual({ sent: false, reason: "blank" });
    expect(await send("nope")).toEqual({ sent: false, reason: "not_found" });
    expect(hypothesesOf(path)).toEqual([]);
  });
});
