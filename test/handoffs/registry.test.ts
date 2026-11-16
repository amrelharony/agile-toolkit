import { describe, it, expect, vi, beforeEach } from "vitest";
import { useWorkspaceStore } from "@/lib/stores/workspace-store";
import {
  HANDOFF_ROUTE_IDS,
  OPPORTUNITY_TREE_ID,
  type HandoffLink,
  type HandoffRouteId,
  type KanbanCard,
  type Risk,
  type TreeNode,
} from "@/lib/stores/workspace-types";
import { registry } from "@/lib/actions/registry";

import "@/lib/actions/tools/kanban";

/**
 * Hand-off routes: every route creates its target with a sourceRef and
 * records the link on the source; a second send on a route is refused while
 * its target exists; Undo removes both the target and the link; the Kanban
 * card has the shape `tool.kanban.add_card` makes.
 */

const undo = vi.hoisted(() => ({
  last: null as null | { label: string; apply: () => void; revert: () => void },
}));
vi.mock("@/lib/utils/undoable", () => ({
  undoable: (a: { label: string; apply: () => void; revert: () => void }) => {
    undo.last = a;
    a.apply();
  },
}));

import { HANDOFF_ROUTES, getHandoffRoute, liveLink, sourceHref } from "@/lib/handoffs/registry";
import { sendHandoff } from "@/lib/handoffs/send";
import type { HandoffSource } from "@/lib/handoffs/types";
import { RISK_REGISTER_KEY, buildRisk } from "@/lib/handoffs/targets/risk";
import { POKER_LOG_ID } from "@/lib/handoffs/targets/poker-queue";
import { RETRO_BOARD_ID } from "@/lib/handoffs/targets/retro-board";
import { HYPOTHESIS_TRACKER_ID } from "@/lib/handoffs/targets/hypothesis";
import { DEPENDENCY_MAP_ID } from "@/lib/handoffs/targets/dependency";

const ROUTES = Object.keys(HANDOFF_ROUTES) as HandoffRouteId[];

/** A source item's links, kept in a plain variable like a tool's state. */
function linkStore(initial: HandoffLink[] = []) {
  let links: HandoffLink[] = initial;
  return {
    get links() {
      return links;
    },
    getLinks: () => links,
    setLinks: (update: (cur: readonly HandoffLink[] | undefined) => HandoffLink[]) => {
      links = update(links);
    },
  };
}

const src = (over: Partial<HandoffSource> = {}): HandoffSource => ({
  title: "Fix the flaky checkout tests",
  description: "They fail one run in five.",
  owner: "Sam",
  raisedBy: "Alice",
  likelihood: 4,
  impact: 5,
  mitigation: "Quarantine and pair on them",
  sourceRef: { tool: "retro", id: "card-1", doc: "retro:current" },
  ...over,
});

const ws = () => useWorkspaceStore.getState();
const kanbanCards = () => ws().kanbanBoards?.find((b) => b.id === "kanban:current")?.cards ?? [];
const riskBlob = (): Risk[] => JSON.parse(localStorage.getItem(RISK_REGISTER_KEY) ?? "[]");
const pokerQueue = () => ws().pokerEstimationLogs?.find((d) => d.id === POKER_LOG_ID)?.queue ?? [];
const retroCards = () => ws().retroBoards?.find((b) => b.id === RETRO_BOARD_ID)?.cards ?? [];
const hypotheses = () =>
  ws().hypothesisTrackers?.find((d) => d.id === HYPOTHESIS_TRACKER_ID)?.hypotheses ?? [];
const depNodes = () => ws().dependencyMaps?.find((d) => d.id === DEPENDENCY_MAP_ID)?.nodes ?? [];

/** Every place a route's target can live, for "it's gone" checks. */
function targetEverywhere(route: HandoffRouteId, id: string): boolean[] {
  switch (route) {
    case "impediment":
      return [ws().impediments.some((i) => i.id === id)];
    case "kanban":
      return [kanbanCards().some((c) => c.id === id)];
    // One store since Phase 8 (the register's old blob is never written:
    // the "risk: one row in workspace.risks only" case checks that).
    case "risk":
      return [ws().risks.some((r) => r.id === id)];
    case "poker-queue":
      return [pokerQueue().some((q) => q.id === id)];
    case "backlog-story":
      return [ws().stories.some((s) => s.id === id)];
    case "retro-topic":
    case "retro-action":
      return [retroCards().some((c) => c.id === id)];
    case "hypothesis":
      return [hypotheses().some((h) => h.id === id)];
    case "decision":
      return [ws().decisions.some((d) => d.id === id)];
    case "dependency":
      return [depNodes().some((n) => n.id === id)];
    case "opportunity":
      return [
        (ws().opportunityTrees ?? [])
          .find((d) => d.id === OPPORTUNITY_TREE_ID)
          ?.nodes.some((n) => n.id === id) ?? false,
      ];
    case "root-cause":
      return [(ws().rootCauseAnalyses ?? []).some((a) => a.id === id)];
  }
}

beforeEach(() => {
  undo.last = null;
  localStorage.clear();
  useWorkspaceStore.setState({
    impediments: [],
    risks: [],
    kanbanBoards: [],
    pokerEstimationLogs: [],
    stories: [],
    retroBoards: [],
    hypothesisTrackers: [],
    decisions: [],
    dependencyMaps: [],
    opportunityTrees: [],
    rootCauseAnalyses: [],
  });
});

describe("hand-off routes", () => {
  it.each(ROUTES)("%s: creates the target with its sourceRef and records the link", (route) => {
    const store = linkStore();
    const link = sendHandoff(route, src(), store);
    expect(link).not.toBeNull();
    expect(link!.route).toBe(route);
    expect(store.links).toEqual([link]);
    expect(targetEverywhere(route, link!.targetId).every(Boolean)).toBe(true);
    expect(getHandoffRoute(route).exists(link!.targetId)).toBe(true);
    expect(undo.last!.label).toBe(getHandoffRoute(route).doneLabel);
  });

  it("impediment: one open row in the workspace, keeping the source", () => {
    const link = sendHandoff("impediment", src(), linkStore())!;
    const shared = ws().impediments.find((i) => i.id === link.targetId)!;
    expect(shared).toMatchObject({
      title: "Fix the flaky checkout tests",
      owner: "Sam",
      raisedBy: "Alice",
      severity: "medium",
      source: "retro",
      sourceRef: { tool: "retro", id: "card-1", doc: "retro:current" },
    });
    // Open: no resolution or escalation, and no category picked for it.
    expect(shared.resolvedAt).toBeUndefined();
    expect(shared.escalatedAt).toBeUndefined();
    expect(shared.category).toBeUndefined();
    expect(getHandoffRoute("impediment").isDone?.(link.targetId)).toBe(false);
    ws().upsertImpediment({ ...shared, resolvedAt: "2026-10-24" });
    expect(getHandoffRoute("impediment").isDone?.(link.targetId)).toBe(true);
  });

  it("impediment: a risk raised as one keeps its level as the severity; an unknown one is medium", () => {
    const critical = sendHandoff(
      "impediment",
      src({ severity: "critical", sourceRef: { tool: "risk-register", id: "r1" } }),
      linkStore()
    )!;
    expect(ws().impediments.find((i) => i.id === critical.targetId)).toMatchObject({
      severity: "critical",
      source: "manual",
      sourceRef: { tool: "risk-register", id: "r1" },
    });
    const odd = sendHandoff(
      "impediment",
      src({ severity: "urgent" as never, sourceRef: { tool: "risk-register", id: "r2" } }),
      linkStore()
    )!;
    expect(ws().impediments.find((i) => i.id === odd.targetId)?.severity).toBe("medium");
  });

  it("risk: one row in workspace.risks only, stamped, keeping owner and description", () => {
    localStorage.setItem(RISK_REGISTER_KEY, JSON.stringify([{ id: "old", title: "Old" }]));
    const link = sendHandoff(
      "risk",
      src({ sourceRef: { tool: "premortem", id: "cause-1" } }),
      linkStore()
    )!;
    expect(ws().risks).toEqual([
      {
        id: link.targetId,
        title: "Fix the flaky checkout tests",
        description: "They fail one run in five.",
        owner: "Sam",
        probability: 4,
        impact: 5,
        mitigation: "Quarantine and pair on them",
        status: "open",
        raisedAt: expect.stringMatching(/^\d{4}-\d{2}-\d{2}$/),
        sourceRef: { tool: "premortem", id: "cause-1" },
        updatedAt: expect.any(String),
      },
    ]);
    // The old blob is the move's backup: never written by a send.
    expect(riskBlob()).toEqual([{ id: "old", title: "Old" }]);
  });

  it("risk: an off-scale rating is clamped onto 1–5; an unrated one is refused, nothing saved", () => {
    const link = sendHandoff("risk", src({ likelihood: 9, impact: 0.4 }), linkStore())!;
    expect(ws().risks.find((r) => r.id === link.targetId)).toMatchObject({
      probability: 5,
      impact: 1,
    });
    // The route says why (its `problem`), and the send skips it: no throw.
    const route = getHandoffRoute("risk");
    expect(route.problem?.(src({ impact: undefined }))).toBe(
      "Rate its impact before it goes to the Risk Register."
    );
    expect(route.problem?.(src({ likelihood: Number.NaN, impact: undefined }))).toBe(
      "Rate how likely it is and its impact before it goes to the Risk Register."
    );
    expect(route.problem?.(src())).toBeNull();
    const store = linkStore();
    expect(sendHandoff("risk", src({ impact: undefined }), store)).toBeNull();
    expect(
      sendHandoff("risk", src({ likelihood: Number.NaN, impact: undefined }), store)
    ).toBeNull();
    expect(ws().risks).toHaveLength(1);
    expect(store.links).toEqual([]);
    // Called directly, the builder still refuses rather than score it 3 × 3.
    expect(() => buildRisk(src({ impact: undefined }))).toThrow(
      "Rate its impact before it goes to the Risk Register."
    );
  });

  it("risk: a long title is cut and leads the description, so nothing is lost", () => {
    const long = `Vendor ${"x".repeat(300)}`;
    const link = sendHandoff("risk", src({ title: long, description: "Why" }), linkStore())!;
    const risk = ws().risks.find((r) => r.id === link.targetId)!;
    expect(risk.title).toHaveLength(240);
    expect(risk.description).toBe(`${long}\n\nWhy`);
  });

  it("risk: a row still waiting in the old blob exists; isDone once closed or accepted", () => {
    localStorage.setItem(
      RISK_REGISTER_KEY,
      JSON.stringify([{ id: "r-old", title: "Old page risk", status: "open" }])
    );
    const route = getHandoffRoute("risk");
    expect(route.exists("r-old")).toBe(true);
    expect(route.isDone?.("r-old")).toBe(false);
    // Moved (or deleted on the page after the move): gone.
    localStorage.setItem(`${RISK_REGISTER_KEY}:moved`, JSON.stringify(["r-old"]));
    expect(route.exists("r-old")).toBe(false);

    const link = sendHandoff("risk", src(), linkStore())!;
    const risk = ws().risks.find((r) => r.id === link.targetId)!;
    expect(route.isDone?.(link.targetId)).toBe(false);
    ws().upsertRisk({ ...risk, status: "accepted" });
    expect(route.isDone?.(link.targetId)).toBe(true);
    ws().upsertRisk({ ...risk, status: "closed", resolvedAt: "2026-10-20" });
    expect(route.isDone?.(link.targetId)).toBe(true);
  });

  it("poker-queue: queues the story on the estimate log", () => {
    const link = sendHandoff(
      "poker-queue",
      src({ sourceRef: { tool: "story-mapper", id: "s1", doc: "story-mapper:current" } }),
      linkStore()
    )!;
    expect(pokerQueue()).toEqual([
      {
        id: link.targetId,
        title: "Fix the flaky checkout tests",
        description: "They fail one run in five.",
        sourceRef: { tool: "story-mapper", id: "s1", doc: "story-mapper:current" },
        queuedAt: expect.any(String),
      },
    ]);
  });

  it("refuses a blank title", () => {
    const store = linkStore();
    expect(sendHandoff("kanban", src({ title: "   " }), store)).toBeNull();
    expect(kanbanCards()).toEqual([]);
    expect(store.links).toEqual([]);
  });
});

describe("a second send", () => {
  it.each(ROUTES)("%s: is refused while the first target exists", (route) => {
    const store = linkStore();
    const first = sendHandoff(route, src(), store)!;
    undo.last = null;
    expect(sendHandoff(route, src(), store)).toBeNull();
    expect(undo.last).toBeNull();
    expect(store.links).toEqual([first]);
    expect(liveLink(store.links, route)).toEqual(first);
  });

  it("goes through when the first target is gone, and Undo puts the old link back", () => {
    const store = linkStore();
    const first = sendHandoff("kanban", src(), store)!;
    getHandoffRoute("kanban").remove(first.targetId);
    expect(liveLink(store.links, "kanban")).toBeUndefined();

    const second = sendHandoff("kanban", src(), store)!;
    expect(second.targetId).not.toBe(first.targetId);
    expect(store.links).toEqual([second]);
    expect(kanbanCards().map((c) => c.id)).toEqual([second.targetId]);

    undo.last!.revert();
    expect(kanbanCards()).toEqual([]);
    expect(store.links).toEqual([first]);
  });
});

describe("Undo", () => {
  it.each(ROUTES)("%s: removes the target and the link", (route) => {
    const store = linkStore();
    const link = sendHandoff(route, src(), store)!;
    undo.last!.revert();
    expect(targetEverywhere(route, link.targetId).some(Boolean)).toBe(false);
    expect(getHandoffRoute(route).exists(link.targetId)).toBe(false);
    expect(store.links).toEqual([]);
  });

  it("keeps the other routes' links and targets", () => {
    const store = linkStore();
    const kanban = sendHandoff("kanban", src(), store)!;
    sendHandoff("impediment", src(), store);
    undo.last!.revert();
    expect(store.links).toEqual([kanban]);
    expect(kanbanCards().map((c) => c.id)).toEqual([kanban.targetId]);
  });
});

describe("Kanban card shape", () => {
  it("matches what tool.kanban.add_card makes, plus sourceRef", async () => {
    const added = (await registry
      .get("tool.kanban.add_card")!
      .handler({ title: "From the agent", description: "d" }, {
        userId: "u",
        source: "agent",
        squadProfileIds: [],
      } as never)) as { id: string };
    const viaAgent = kanbanCards().find((c) => c.id === added.id)!;

    const link = sendHandoff("kanban", src(), linkStore())!;
    const viaHandoff = kanbanCards().find((c) => c.id === link.targetId)!;

    const { sourceRef, ...rest } = viaHandoff;
    expect(sourceRef).toEqual({ tool: "retro", id: "card-1", doc: "retro:current" });
    expect(Object.keys(rest).sort()).toEqual(Object.keys(viaAgent).sort());
    for (const key of Object.keys(viaAgent) as (keyof KanbanCard)[]) {
      expect(typeof rest[key as keyof typeof rest]).toBe(typeof viaAgent[key]);
    }
    expect(rest).toMatchObject({
      column: viaAgent.column,
      class: viaAgent.class,
      createdAt: viaAgent.createdAt,
      columnSince: viaAgent.columnSince,
    });
    expect("startedAt" in rest || "completedAt" in rest).toBe(false);
    // Appended after the agent's card: nothing on the board was dropped.
    expect(kanbanCards().map((c) => c.id)).toEqual([added.id, link.targetId]);
  });
});

describe("source back-links", () => {
  it("map each sending tool to its page", () => {
    expect(sourceHref({ tool: "retro", id: "x" })).toBe("/retro");
    expect(sourceHref({ tool: "premortem", id: "x" })).toBe("/premortem");
    expect(sourceHref({ tool: "premortem", id: "x", doc: "pm 2" })).toBe(
      "/premortem?premortem=pm%202"
    );
    expect(sourceHref({ tool: "standup", id: "x" })).toBe("/standup");
    expect(sourceHref({ tool: "story-mapper", id: "x" })).toBe("/story-mapper");
    expect(sourceHref({ tool: "weighted-decision", id: "m 1", doc: "m 1" })).toBe(
      "/weighted-decision?matrix=m%201"
    );
    expect(sourceHref({ tool: "weighted-decision", id: "x" })).toBe("/weighted-decision");
    expect(sourceHref({ tool: "rfc-tracker", id: "x" })).toBe("/rfc-tracker");
    expect(sourceHref({ tool: "nope", id: "x" })).toBeNull();
  });

  it("covers every route", () => {
    expect([...ROUTES].sort()).toEqual(
      [
        "backlog-story",
        "decision",
        "dependency",
        "hypothesis",
        "impediment",
        "kanban",
        "opportunity",
        "poker-queue",
        "retro-action",
        "retro-topic",
        "risk",
        "root-cause",
      ].sort()
    );
    expect(sourceHref({ tool: "root-cause", id: "rca_1" })).toBe("/root-cause?analysis=rca_1");
    for (const route of ROUTES) expect(getHandoffRoute(route).id).toBe(route);
    // One route per id the workspace schemas accept on a stored link.
    expect([...ROUTES].sort()).toEqual([...HANDOFF_ROUTE_IDS].sort());
  });
});

describe("opportunity", () => {
  const tree = () => (ws().opportunityTrees ?? []).find((d) => d.id === OPPORTUNITY_TREE_ID);
  const nodes = () => tree()?.nodes ?? [];
  const node = (id: string, kind: TreeNode["kind"], parentId: string | null): TreeNode => ({
    id,
    kind,
    text: `${kind} ${id}`,
    parentId,
  });
  const quote = (over: Partial<HandoffSource> = {}) =>
    src({
      title: "I export to a spreadsheet every Friday",
      description: "From an interview on 2026-10-14",
      sourceRef: { tool: "user-interviews", id: "q_1", doc: "int_1" },
      ...over,
    });
  const seed = (list: TreeNode[]) =>
    ws().upsertOpportunityTree({ id: OPPORTUNITY_TREE_ID, nodes: list });

  it("adds an opportunity under the picked outcome, with the quote as evidence", () => {
    seed([node("o1", "outcome", null)]);
    const link = sendHandoff("opportunity", quote({ parentId: "o1" }), linkStore())!;
    expect(nodes().map((n) => n.id)).toEqual(["o1", link.targetId]);
    expect(nodes()[1]).toEqual({
      id: link.targetId,
      kind: "opportunity",
      text: "I export to a spreadsheet every Friday",
      parentId: "o1",
      evidence: "From an interview on 2026-10-14",
      sourceRef: { tool: "user-interviews", id: "q_1", doc: "int_1" },
    });
    expect(getHandoffRoute("opportunity").targetHref(link.targetId)).toBe("/opportunity-tree");
    expect(getHandoffRoute("opportunity").isDone).toBeUndefined();
  });

  it("nests under an opportunity, and goes to the root under no parent, a gone one or one that can't hold it", () => {
    seed([
      node("o1", "outcome", null),
      node("p1", "opportunity", "o1"),
      node("s1", "solution", "p1"),
    ]);
    const under = sendHandoff("opportunity", quote({ parentId: "p1" }), linkStore())!;
    const root = sendHandoff("opportunity", quote(), linkStore())!;
    const gone = sendHandoff("opportunity", quote({ parentId: "nope" }), linkStore())!;
    const unfit = sendHandoff("opportunity", quote({ parentId: "s1" }), linkStore())!;
    const parentOf = (id: string) => nodes().find((n) => n.id === id)?.parentId;
    expect(parentOf(under.targetId)).toBe("p1");
    expect(parentOf(root.targetId)).toBeNull();
    expect(parentOf(gone.targetId)).toBeNull();
    expect(parentOf(unfit.targetId)).toBeNull();
  });

  it("caps the text at the tree's limit and starts a tree that doesn't exist yet", () => {
    const link = sendHandoff(
      "opportunity",
      quote({ title: `  ${"x".repeat(2500)}  ` }),
      linkStore()
    )!;
    expect(tree()).toBeDefined();
    expect(nodes().find((n) => n.id === link.targetId)?.text).toBe("x".repeat(2000));
  });

  it("Undo takes the node out alone: what was added under it moves up to its parent", () => {
    seed([node("o1", "outcome", null)]);
    const store = linkStore();
    const link = sendHandoff("opportunity", quote({ parentId: "o1" }), store)!;
    // Added under the new opportunity before Undo.
    seed([
      ...nodes(),
      node("sub", "opportunity", link.targetId),
      node("sol", "solution", link.targetId),
    ]);
    undo.last!.revert();
    expect(nodes().map((n) => [n.id, n.parentId])).toEqual([
      ["o1", null],
      ["sub", "o1"],
      ["sol", "o1"],
    ]);
    expect(store.links).toEqual([]);
  });

  it("reads as gone once the node is deleted on the tree, so the quote can be sent again", () => {
    const store = linkStore();
    const first = sendHandoff("opportunity", quote(), store)!;
    expect(getHandoffRoute("opportunity").exists(first.targetId)).toBe(true);
    seed(nodes().filter((n) => n.id !== first.targetId));
    expect(getHandoffRoute("opportunity").exists(first.targetId)).toBe(false);
    expect(liveLink(store.links, "opportunity")).toBeUndefined();
    const again = sendHandoff("opportunity", quote(), store)!;
    expect(again.targetId).not.toBe(first.targetId);
    expect(store.links).toEqual([again]);
  });

  it("ignores Undo of a node already gone, and keeps the rest of the tree", () => {
    seed([node("o1", "outcome", null)]);
    expect(() => getHandoffRoute("opportunity").remove("nope")).not.toThrow();
    expect(nodes().map((n) => n.id)).toEqual(["o1"]);
  });
});
