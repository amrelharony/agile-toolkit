import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { useWorkspaceStore } from "@/lib/stores/workspace-store";
import type { HandoffLink, HandoffRouteId, KanbanCard, Risk } from "@/lib/stores/workspace-types";
import { useImpedimentStore } from "@/app/(tools)/impediments/use-impediment-store";
import { toWorkspaceImpediment } from "@/app/(tools)/impediments/helpers";
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
import { RISK_REGISTER_KEY } from "@/lib/handoffs/targets/risk";
import { POKER_LOG_ID } from "@/lib/handoffs/targets/poker-queue";

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

/** Every place a route's target can live, for "it's gone" checks. */
function targetEverywhere(route: HandoffRouteId, id: string): boolean[] {
  switch (route) {
    case "impediment":
      return [
        useImpedimentStore.getState().impediments.some((i) => i.id === id),
        ws().impediments.some((i) => i.id === id),
      ];
    case "kanban":
      return [kanbanCards().some((c) => c.id === id)];
    case "risk":
      return [riskBlob().some((r) => r.id === id), ws().risks.some((r) => r.id === id)];
    case "poker-queue":
      return [pokerQueue().some((q) => q.id === id)];
  }
}

beforeEach(() => {
  undo.last = null;
  localStorage.clear();
  useImpedimentStore.setState({ impediments: [] });
  useWorkspaceStore.setState({
    impediments: [],
    risks: [],
    kanbanBoards: [],
    pokerEstimationLogs: [],
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

  it("impediment: the same id in the tool's store and the workspace, both keeping the source", () => {
    const link = sendHandoff("impediment", src(), linkStore())!;
    const local = useImpedimentStore.getState().impediments.find((i) => i.id === link.targetId)!;
    const shared = ws().impediments.find((i) => i.id === link.targetId)!;
    expect(local).toMatchObject({
      title: "Fix the flaky checkout tests",
      assignedTo: "Sam",
      raisedBy: "Alice",
      status: "Open",
      source: "retro",
      sourceRef: { tool: "retro", id: "card-1", doc: "retro:current" },
    });
    expect(shared).toMatchObject({ source: "retro", sourceRef: local.sourceRef, owner: "Sam" });
    // The tool's one-way bridge would write exactly this row: nothing to change.
    expect(toWorkspaceImpediment(local)).toEqual(shared);
  });

  it("risk: the register's blob and workspace.risks hold one row under one id", () => {
    localStorage.setItem(RISK_REGISTER_KEY, JSON.stringify([{ id: "old", title: "Old" }]));
    const link = sendHandoff(
      "risk",
      src({ sourceRef: { tool: "premortem", id: "cause-1" } }),
      linkStore()
    )!;
    const blob = riskBlob();
    expect(blob.map((r) => r.id)).toEqual([link.targetId, "old"]);
    expect(blob[0]).toMatchObject({
      title: "Fix the flaky checkout tests",
      probability: 4,
      impact: 5,
      mitigation: "Quarantine and pair on them",
      status: "open",
      sourceRef: { tool: "premortem", id: "cause-1" },
    });
    expect(ws().risks).toEqual([blob[0]]);
    // The register's Import keeps rows whose id it doesn't have: none here.
    expect(ws().risks.filter((w) => !blob.some((r) => r.id === w.id))).toEqual([]);
  });

  it("risk: out-of-range scores fall back into 1–5", () => {
    const link = sendHandoff("risk", src({ likelihood: 9, impact: undefined }), linkStore())!;
    expect(ws().risks.find((r) => r.id === link.targetId)).toMatchObject({
      probability: 5,
      impact: 3,
    });
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
  // Both stamp a full timestamp; a fixed clock lets createdAt compare equal.
  beforeEach(() => {
    vi.useFakeTimers({ toFake: ["Date"] });
    vi.setSystemTime(new Date("2026-10-18T09:30:00.000Z"));
  });
  afterEach(() => {
    vi.useRealTimers();
  });

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

    // A full timestamp, as the board stamps its own cards.
    expect(viaAgent.createdAt).toBe("2026-10-18T09:30:00.000Z");
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
      startedAt: undefined,
      completedAt: undefined,
    });
    // Appended after the agent's card: nothing on the board was dropped.
    expect(kanbanCards().map((c) => c.id)).toEqual([added.id, link.targetId]);
  });
});

describe("source back-links", () => {
  it("map each sending tool to its page", () => {
    expect(sourceHref({ tool: "retro", id: "x" })).toBe("/retro");
    expect(sourceHref({ tool: "premortem", id: "x" })).toBe("/premortem");
    expect(sourceHref({ tool: "standup", id: "x" })).toBe("/standup");
    expect(sourceHref({ tool: "story-mapper", id: "x" })).toBe("/story-mapper");
    expect(sourceHref({ tool: "nope", id: "x" })).toBeNull();
  });
});
