/**
 * The hand-off targets added for the tool upgrade: what each creates, where
 * it lands, when it counts as done, and that Undo takes back exactly what
 * the send added. Sending tools are listed with pages that exist, and the
 * agents' schemas keep links on the new routes.
 */

import { existsSync } from "node:fs";
import { join } from "node:path";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { useWorkspaceStore } from "@/lib/stores/workspace-store";
import type { HandoffLink, RetroBoard } from "@/lib/stores/workspace-types";
import { retroFormats } from "@/lib/constants/retro-formats";
import { collectRetroActions } from "@/lib/retro/actions";
import { registry } from "@/lib/actions/registry";

import "@/lib/actions/workspace/index";

const undo = vi.hoisted(() => ({
  last: null as null | { label: string; apply: () => void; revert: () => void },
}));
vi.mock("@/lib/utils/undoable", () => ({
  undoable: (a: { label: string; apply: () => void; revert: () => void }) => {
    undo.last = a;
    a.apply();
  },
}));

import { SOURCE_TOOLS, getHandoffRoute, sourceHref, sourceLabel } from "@/lib/handoffs/registry";
import { sendHandoff } from "@/lib/handoffs/send";
import type { HandoffSource } from "@/lib/handoffs/types";
import { STORY_TITLE_MAX, buildBacklogStory } from "@/lib/handoffs/targets/backlog-story";
import { RETRO_BOARD_ID, retroColumnFor } from "@/lib/handoffs/targets/retro-board";
import { HYPOTHESIS_TRACKER_ID } from "@/lib/handoffs/targets/hypothesis";
import { DECISION_LOG_KEY } from "@/lib/handoffs/targets/decision";
import {
  DEPENDENCY_MAP_ID,
  withDependency,
  withoutDependency,
} from "@/lib/handoffs/targets/dependency";

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
  title: "Checkout is slow on mobile",
  description: "Two reviewers said so.",
  sourceRef: { tool: "sprint-review", id: "fb-1", doc: "sprint-review:s2" },
  ...over,
});

const ws = () => useWorkspaceStore.getState();
const board = () => ws().retroBoards?.find((b) => b.id === RETRO_BOARD_ID);
const hypotheses = () =>
  ws().hypothesisTrackers?.find((d) => d.id === HYPOTHESIS_TRACKER_ID)?.hypotheses ?? [];
const decisionBlob = (): { id: string; title: string }[] =>
  JSON.parse(localStorage.getItem(DECISION_LOG_KEY) ?? "[]");
const depMap = () => ws().dependencyMaps?.find((d) => d.id === DEPENDENCY_MAP_ID);

function boardWith(formatId: string, over: Partial<RetroBoard> = {}): RetroBoard {
  return {
    id: RETRO_BOARD_ID,
    format: retroFormats.find((f) => f.id === formatId)!,
    phase: "write",
    cards: [],
    userVotes: 0,
    timerSeconds: 300,
    timerRunning: false,
    discussingIndex: 0,
    ...over,
  };
}

beforeEach(() => {
  undo.last = null;
  localStorage.clear();
  useWorkspaceStore.setState({
    stories: [],
    retroBoards: [],
    hypothesisTrackers: [],
    decisions: [],
    dependencyMaps: [],
  });
});

describe("backlog-story", () => {
  it("adds a backlog story with no sprint, linked to its source", () => {
    const link = sendHandoff("backlog-story", src({ owner: " Priya " }), linkStore())!;
    expect(ws().stories).toEqual([
      {
        id: link.targetId,
        title: "Checkout is slow on mobile",
        status: "backlog",
        owner: "Priya",
        sourceRef: { tool: "sprint-review", id: "fb-1", doc: "sprint-review:s2" },
        // The store stamps when a story is first saved.
        createdAt: expect.any(String),
      },
    ]);
    expect(link.targetId).toMatch(/^story_/);
  });

  it("keeps a positive estimate only, and caps the title", () => {
    expect(buildBacklogStory(src({ points: 5 })).points).toBe(5);
    expect(buildBacklogStory(src({ points: 0 })).points).toBeUndefined();
    expect(buildBacklogStory(src({ points: Number.NaN })).points).toBeUndefined();
    expect(buildBacklogStory(src({ title: "x".repeat(500) })).title).toHaveLength(STORY_TITLE_MAX);
  });

  it("is done when the story is", () => {
    const link = sendHandoff("backlog-story", src(), linkStore())!;
    const route = getHandoffRoute("backlog-story");
    expect(route.isDone?.(link.targetId)).toBe(false);
    ws().upsertStory({ ...ws().stories[0], status: "done" });
    expect(route.isDone?.(link.targetId)).toBe(true);
  });
});

describe("retro-topic and retro-action", () => {
  it("start a retro in the first format when there is none, following the newest archive", () => {
    ws().upsertRetroBoard(
      boardWith("4ls", { id: "retro:old", archivedAt: "2026-09-01T00:00:00Z" })
    );
    ws().upsertRetroBoard(
      boardWith("4ls", { id: "retro:new", archivedAt: "2026-10-01T00:00:00Z" })
    );
    const link = sendHandoff("retro-topic", src(), linkStore())!;
    expect(board()).toMatchObject({
      format: { id: retroFormats[0].id },
      phase: "write",
      previousRetroId: "retro:new",
    });
    expect(board()!.cards).toEqual([
      {
        id: link.targetId,
        columnKey: "stop",
        text: "Checkout is slow on mobile",
        votes: 0,
        groupedWith: null,
        isActionItem: false,
        assignee: "",
        discussing: false,
        sourceRef: src().sourceRef,
      },
    ]);
  });

  it("put a concern and an appreciation in the columns that fit the format", () => {
    ws().upsertRetroBoard(boardWith("4ls"));
    sendHandoff("retro-topic", src(), linkStore());
    sendHandoff("retro-topic", src({ tone: "appreciation", title: "Great pairing" }), linkStore());
    expect(board()!.cards.map((c) => c.columnKey)).toEqual(["lacked", "liked"]);
    expect(retroColumnFor(retroFormats.find((f) => f.id === "lean-coffee"))).toBe("to-discuss");
    expect(
      retroColumnFor(
        retroFormats.find((f) => f.id === "sailboat"),
        "appreciation"
      )
    ).toBe("wind");
    expect(retroColumnFor({ columns: [{ key: "x", label: "X", color: "", icon: "" }] })).toBe("x");
    expect(retroColumnFor(undefined)).toBe("start");
  });

  it("add to the current board without touching its cards", () => {
    const existing = boardWith("mad-sad-glad", {
      cards: [
        {
          id: "c0",
          columnKey: "glad",
          text: "Shipped",
          votes: 2,
          groupedWith: null,
          isActionItem: false,
          assignee: "",
          discussing: false,
        },
      ],
    });
    ws().upsertRetroBoard(existing);
    const link = sendHandoff("retro-topic", src(), linkStore())!;
    expect(board()!.cards.map((c) => c.id)).toEqual(["c0", link.targetId]);
    expect(board()!.cards[1].columnKey).toBe("sad");
    undo.last!.revert();
    expect(board()).toEqual(existing);
  });

  it("Undo of the send that started the board takes the board away again", () => {
    sendHandoff("retro-topic", src(), linkStore());
    undo.last!.revert();
    expect(board()).toBeUndefined();
  });

  it("but leaves a started board that has other cards by then", () => {
    sendHandoff("retro-topic", src(), linkStore());
    const firstUndo = undo.last!;
    sendHandoff("retro-topic", src({ title: "Another" }), linkStore());
    firstUndo.revert();
    expect(board()!.cards.map((c) => c.text)).toEqual(["Another"]);
  });

  it("a retro action is an owned action item that Retro Actions lists", () => {
    const link = sendHandoff("retro-action", src({ owner: "Sam" }), linkStore())!;
    const card = board()!.cards[0];
    expect(card).toMatchObject({ id: link.targetId, isActionItem: true, assignee: "Sam" });
    const actions = collectRetroActions(ws().retroBoards ?? [], { today: "2026-10-23" });
    expect(actions.map((a) => a.id)).toEqual([link.targetId]);

    const route = getHandoffRoute("retro-action");
    expect(route.isDone?.(link.targetId)).toBe(false);
    ws().upsertRetroBoard({ ...board()!, cards: [{ ...card, done: true }] });
    expect(route.isDone?.(link.targetId)).toBe(true);
  });
});

describe("hypothesis", () => {
  it("adds a drafted hypothesis first, from the item and its description", () => {
    ws().upsertHypothesisTracker({
      id: HYPOTHESIS_TRACKER_ID,
      hypotheses: [
        {
          id: "h0",
          believe: "Old",
          willDo: "",
          toLearn: "",
          successMetric: "",
          status: "running",
          raisedAt: "2026-10-01",
        },
      ],
    });
    const link = sendHandoff(
      "hypothesis",
      src({ sourceRef: { tool: "riskiest-assumption", id: "a1" } }),
      linkStore()
    )!;
    expect(hypotheses().map((h) => h.id)).toEqual([link.targetId, "h0"]);
    expect(hypotheses()[0]).toMatchObject({
      believe: "Checkout is slow on mobile",
      toLearn: "Two reviewers said so.",
      willDo: "",
      successMetric: "",
      status: "drafted",
      sourceRef: { tool: "riskiest-assumption", id: "a1" },
    });
    expect(hypotheses()[0].raisedAt).toMatch(/^\d{4}-\d{2}-\d{2}$/);
  });

  it("is done once tested either way", () => {
    const link = sendHandoff("hypothesis", src(), linkStore())!;
    const route = getHandoffRoute("hypothesis");
    const setStatus = (status: "running" | "invalidated") =>
      ws().upsertHypothesisTracker({
        id: HYPOTHESIS_TRACKER_ID,
        hypotheses: hypotheses().map((h) => ({ ...h, status })),
      });
    setStatus("running");
    expect(route.isDone?.(link.targetId)).toBe(false);
    setStatus("invalidated");
    expect(route.isDone?.(link.targetId)).toBe(true);
  });
});

describe("decision", () => {
  it("writes one proposed decision to the Decision Log and workspace.decisions", () => {
    localStorage.setItem(DECISION_LOG_KEY, JSON.stringify([{ id: "old", title: "Old" }]));
    const link = sendHandoff(
      "decision",
      src({ sourceRef: { tool: "six-hats", id: "blue" } }),
      linkStore()
    )!;
    const blob = decisionBlob();
    expect(blob.map((d) => d.id)).toEqual([link.targetId, "old"]);
    expect(blob[0]).toMatchObject({
      title: "Checkout is slow on mobile",
      context: "Two reviewers said so.",
      decision: "",
      status: "proposed",
      sourceRef: { tool: "six-hats", id: "blue" },
    });
    expect(ws().decisions).toEqual([blob[0]]);

    undo.last!.revert();
    expect(decisionBlob().map((d) => d.id)).toEqual(["old"]);
    expect(ws().decisions).toEqual([]);
  });

  it("is done once accepted, read from the log first", () => {
    const link = sendHandoff("decision", src(), linkStore())!;
    const route = getHandoffRoute("decision");
    expect(route.isDone?.(link.targetId)).toBe(false);
    localStorage.setItem(
      DECISION_LOG_KEY,
      JSON.stringify(decisionBlob().map((d) => ({ ...d, status: "accepted" })))
    );
    expect(route.isDone?.(link.targetId)).toBe(true);
  });
});

describe("dependency", () => {
  it("adds a node for the item, its owner as the team", () => {
    const link = sendHandoff(
      "dependency",
      src({ owner: "Payments", sourceRef: { tool: "scrum-of-scrums", id: "d1" } }),
      linkStore()
    )!;
    expect(depMap()).toEqual({
      id: DEPENDENCY_MAP_ID,
      nodes: [
        {
          id: link.targetId,
          label: "Checkout is slow on mobile",
          team: "Payments",
          description: "Two reviewers said so.",
          sourceRef: { tool: "scrum-of-scrums", id: "d1" },
        },
      ],
      edges: [],
    });
  });

  it("joins it to what it waits on, found by label", () => {
    ws().upsertDependencyMap({
      id: DEPENDENCY_MAP_ID,
      nodes: [{ id: "auth", label: "Auth service" }],
      edges: [],
    });
    const link = sendHandoff("dependency", src({ dependsOn: " auth SERVICE " }), linkStore())!;
    expect(depMap()!.nodes.map((n) => n.id)).toEqual(["auth", link.targetId]);
    expect(depMap()!.edges).toEqual([
      {
        id: `${link.targetId}-needs`,
        from: link.targetId,
        to: "auth",
        kind: "needs",
        sourceRef: src().sourceRef,
      },
    ]);
    // Undo keeps the node that was already there.
    undo.last!.revert();
    expect(depMap()).toEqual({
      id: DEPENDENCY_MAP_ID,
      nodes: [{ id: "auth", label: "Auth service" }],
      edges: [],
    });
  });

  it("adds the other side when it isn't on the map, and Undo takes both away", () => {
    const link = sendHandoff("dependency", src({ dependsOn: "Data team" }), linkStore())!;
    expect(depMap()!.nodes.map((n) => n.label)).toEqual([
      "Checkout is slow on mobile",
      "Data team",
    ]);
    expect(depMap()!.edges).toHaveLength(1);
    undo.last!.revert();
    expect(depMap()).toEqual({ id: DEPENDENCY_MAP_ID, nodes: [], edges: [] });
    expect(getHandoffRoute("dependency").exists(link.targetId)).toBe(false);
  });

  it("keeps an added other side that something else now uses", () => {
    const map = withDependency(undefined, src({ dependsOn: "Data team" }), "n1");
    const used = {
      nodes: [...map.nodes, { id: "x", label: "X" }],
      edges: [...map.edges, { id: "e2", from: "x", to: "n1-on", kind: "blocks" as const }],
    };
    expect(withoutDependency(used, "n1").nodes.map((n) => n.id)).toEqual(["n1-on", "x"]);
  });
});

describe("source tools", () => {
  it("name and link the tools the upgrade wires to these routes", () => {
    expect(sourceLabel({ tool: "sprint-review", id: "x" })).toBe("From Sprint Review");
    expect(sourceHref({ tool: "health-check", id: "x" })).toBe("/health-check");
    expect(sourceHref({ tool: "riskiest-assumption", id: "x" })).toBe("/riskiest-assumption");
  });

  it("ignore inherited keys", () => {
    expect(sourceLabel({ tool: "constructor", id: "x" })).toBeNull();
    expect(sourceHref({ tool: "__proto__", id: "x" })).toBeNull();
  });

  it("link only to pages that exist", () => {
    for (const { href } of Object.values(SOURCE_TOOLS)) {
      const dir = join(process.cwd(), "src", "app", "(tools)", href.slice(1));
      expect(existsSync(dir), href).toBe(true);
    }
  });
});

describe("agents keep links and back-links on the new routes", () => {
  const ctx = { userId: "u", source: "agent" as const, squadProfileIds: [] as string[] };

  it("a standup entry's sentTo accepts the new routes", async () => {
    const link: HandoffLink = { route: "dependency", targetId: "n1", at: "2026-10-23T09:00:00Z" };
    useWorkspaceStore.setState({
      standupEntries: [
        {
          id: "e1",
          member: "Ana",
          date: "2026-10-23",
          yesterday: "",
          today: "",
          blockers: "Waiting on data",
          timestamp: 1,
        },
      ],
    });
    await registry
      .get("workspace.standup_entry.update")!
      .handler({ id: "e1", patch: { sentTo: [link] } }, ctx);
    expect(ws().standupEntries?.[0].sentTo).toEqual([link]);
  });

  it("a story, decision and hypothesis keep their sourceRef through an update", async () => {
    sendHandoff("backlog-story", src(), linkStore());
    sendHandoff("decision", src(), linkStore());
    const storyId = ws().stories[0].id;
    const decisionId = ws().decisions[0].id;
    await registry
      .get("workspace.story.update")!
      .handler({ id: storyId, patch: { title: "Renamed" } }, ctx);
    await registry
      .get("workspace.decision.update")!
      .handler({ id: decisionId, patch: { status: "accepted" } }, ctx);
    expect(ws().stories[0].sourceRef).toEqual(src().sourceRef);
    expect(ws().decisions[0].sourceRef).toEqual(src().sourceRef);

    sendHandoff("hypothesis", src(), linkStore());
    const doc = ws().hypothesisTrackers![0];
    await registry
      .get("workspace.hypothesis_tracker.update")!
      .handler({ id: doc.id, patch: { hypotheses: doc.hypotheses } }, ctx);
    expect(hypotheses()[0].sourceRef).toEqual(src().sourceRef);
  });
});
