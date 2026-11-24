/**
 * The strategy-map engine Impact Map and Strategy Tree share: reading a
 * synced or agent-written row into one that keeps the rules (orphans put
 * back under the root, never promoted; too deep and past the cap left
 * out), the edits, the two moments (first focus, the whole tree agreed),
 * the node form's check, the checks per shape, the deliverable ideas, the
 * drafts' nodes and the hand-off sources.
 */

import { describe, expect, it } from "vitest";
import type { HandoffLink, StrategyMap, StrategyMapNode } from "@/lib/stores/workspace-types";
import { strategyMapProblems } from "@/lib/strategy-map/rules";
import {
  MAP_FULL,
  STRATEGY_NODES_MAX,
  applyNodeValues,
  becameAgreed,
  branchOf,
  canAddUnder,
  childLevel,
  emptyNodeDraft,
  fitsRow,
  focusFirstSet,
  holdsLink,
  keepOneFocus,
  levelCounts,
  mapTitle,
  newStrategyMap,
  newestFirst,
  nodeDraftFrom,
  pathOf,
  readStrategyMap,
  readStrategyMaps,
  sourcePath,
  validateNode,
  withFocus,
  withNodePatch,
  withStatus,
} from "@/lib/strategy-map/model";
import { mapChecks, readsLikeFeature } from "@/lib/strategy-map/checks";
import { asClause, deliverableIdeas } from "@/lib/strategy-map/ideas";
import {
  STRATEGY_FORMATS,
  betLevel,
  isTreeFormat,
  levelHas,
  levelOf,
  levelSends,
} from "@/lib/strategy-map/formats";
import {
  actorDraftNodes,
  fitDraftNodes,
  partDraftNodes,
  personaNamed,
} from "@/lib/strategy-map/drafts";
import {
  betHypothesisSource,
  deliverableSource,
  impactHypothesisSource,
  strategySource,
  treeItemSource,
} from "@/lib/strategy-map/send";
import { drawTree, subtreeIds, withoutNode, withoutSubtree } from "@/lib/trees/parent-tree";
import { IMPACT_MAP, STRATEGY_TREE } from "../stores/phase43-fixtures";
import { nearlyFull } from "./near-full";

const AT = "2026-11-20T10:00:00.000Z";

const node = (
  id: string,
  parentId: string | null,
  level: 0 | 1 | 2 | 3,
  extra: Partial<StrategyMapNode> = {}
): StrategyMapNode => ({ id, parentId, level, text: id, ...extra });

const map = (nodes: StrategyMapNode[], over: Partial<StrategyMap> = {}): StrategyMap => ({
  id: "m1",
  format: "impact-map",
  title: "Grow repeat orders",
  nodes,
  createdAt: AT,
  updatedAt: AT,
  ...over,
});

/** A small impact map: goal → 2 actors → impacts → deliverables. */
const IMPACT = map([
  node("g", null, 0, { text: "Grow repeat orders by 20%", measure: "Repeat rate" }),
  node("a1", "g", 1, { text: "Busy parents" }),
  node("i1", "a1", 2, { text: "Skip a week instead of cancelling" }),
  node("d1", "i1", 3, { text: "Pause instead of cancel" }),
  node("d2", "i1", 3, { text: "Reminder before the cut-off" }),
  node("i2", "a1", 2, { text: "Reorder a favourite box" }),
  node("a2", "g", 1, { text: "Office buyers" }),
]);

describe("readStrategyMap", () => {
  it("reads a well-formed map as it is, and refuses a row with no id or no known format", () => {
    expect(readStrategyMap(IMPACT_MAP)).toEqual(IMPACT_MAP);
    expect(readStrategyMap(STRATEGY_TREE)).toEqual(STRATEGY_TREE);
    expect(readStrategyMap({ ...IMPACT_MAP, id: "" })).toBeNull();
    expect(readStrategyMap({ ...IMPACT_MAP, format: "swot" })).toBeNull();
    expect(readStrategyMap(null)).toBeNull();
    expect(readStrategyMaps([IMPACT_MAP, { id: "x" }, "junk"])).toEqual([IMPACT_MAP]);
  });

  it("puts an orphan back under the root with what's under it, never as the root", () => {
    const read = readStrategyMap(
      map([node("g", null, 0), node("i9", "gone", 2), node("d9", "i9", 3), node("a1", "g", 1)])
    )!;
    expect(read.nodes.map((n) => [n.id, n.parentId, n.level])).toEqual([
      ["g", null, 0],
      ["i9", "g", 1],
      ["d9", "i9", 2],
      ["a1", "g", 1],
    ]);
    expect(strategyMapProblems(read, undefined)).toEqual([]);
  });

  it("keeps the first root, puts a second one under it, and breaks a loop", () => {
    const read = readStrategyMap(
      map([
        node("x", "y", 1),
        node("g", null, 0),
        node("y", "x", 2),
        node("r2", null, 0),
        node("c", "r2", 1),
      ])
    )!;
    const at = (id: string) => read.nodes.find((n) => n.id === id)!;
    expect(at("g")).toMatchObject({ parentId: null, level: 0 });
    expect(at("r2")).toMatchObject({ parentId: "g", level: 1 });
    expect(at("c")).toMatchObject({ parentId: "r2", level: 2 });
    expect([at("x").parentId, at("y").parentId].sort()).toEqual(["g", "y"].sort());
    expect(strategyMapProblems(read, undefined)).toEqual([]);
  });

  it("roots a map with no parentless node at its first node", () => {
    const read = readStrategyMap(map([node("a", "b", 1), node("b", "a", 1)]))!;
    expect(read.nodes[0]).toMatchObject({ id: "a", parentId: null, level: 0 });
    expect(strategyMapProblems(read, undefined)).toEqual([]);
  });

  it("recounts levels and leaves out what would sit past level 3, and past the cap", () => {
    const deep = readStrategyMap(
      map([
        node("g", null, 0),
        node("a", "g", 2),
        node("b", "a", 1),
        node("c", "b", 3),
        node("d", "c", 3),
      ])
    )!;
    expect(deep.nodes.map((n) => [n.id, n.level])).toEqual([
      ["g", 0],
      ["a", 1],
      ["b", 2],
      ["c", 3],
    ]);
    const many = Array.from({ length: STRATEGY_NODES_MAX + 10 }, (_, i) => node(`n${i}`, "g", 1));
    const capped = readStrategyMap(map([node("g", null, 0), ...many]))!;
    expect(capped.nodes).toHaveLength(STRATEGY_NODES_MAX);
    expect(strategyMapProblems(capped, undefined)).toEqual([]);
  });

  it("keeps a persona, a focus (the first) and a status only where the rules allow them", () => {
    const im = readStrategyMap(
      map([
        node("g", null, 0, { personaId: "p", status: "agreed", focus: true }),
        node("a", "g", 1, { personaId: "p1", note: "n" }),
        node("i1", "a", 2, { focus: true, personaId: "p2" }),
        node("i2", "a", 2, { focus: true }),
      ])
    )!;
    expect(im.nodes).toEqual([
      node("g", null, 0),
      node("a", "g", 1, { personaId: "p1" }),
      node("i1", "a", 2, { focus: true }),
      node("i2", "a", 2),
    ]);
    const tree = readStrategyMap(
      map([node("v", null, 0, { status: "agreed", note: "ok", personaId: "p", focus: true })], {
        format: "dibb",
      })
    )!;
    expect(tree.nodes[0]).toEqual(node("v", null, 0, { status: "agreed", note: "ok" }));
    expect(strategyMapProblems(im, undefined)).toEqual([]);
    expect(strategyMapProblems(tree, undefined)).toEqual([]);
  });

  it("cuts text to its caps, names a blank node, and drops bad links and dates", () => {
    const read = readStrategyMap({
      ...map([
        {
          ...node("g", null, 0),
          text: "x".repeat(300),
          detail: "y".repeat(1200),
          sentTo: [
            { route: "nowhere" as HandoffLink["route"], targetId: "t", at: AT },
            { route: "epic", targetId: "e1", at: AT },
          ],
        },
        { ...node("a", "g", 1), text: "   " },
      ]),
      targetDate: "2026-02-30",
      title: "",
    })!;
    expect(read.nodes[0].text).toHaveLength(200);
    expect(read.nodes[0].detail).toHaveLength(1000);
    expect(read.nodes[0].sentTo).toEqual([{ route: "epic", targetId: "e1", at: AT }]);
    expect(read.nodes[1].text).toBe("Untitled actor");
    expect(read.targetDate).toBeUndefined();
    expect(read.title).toBe("x".repeat(200));
  });
});

describe("edits", () => {
  it("makes a map with its root, a tree's root proposed", () => {
    const im = newStrategyMap({
      id: "m",
      rootId: "r",
      format: "impact-map",
      root: " Grow  repeat orders ",
      measure: "Repeat rate",
      now: AT,
    });
    expect(im).toEqual({
      id: "m",
      format: "impact-map",
      title: "Grow repeat orders",
      nodes: [
        { id: "r", parentId: null, level: 0, text: "Grow repeat orders", measure: "Repeat rate" },
      ],
      createdAt: AT,
      updatedAt: AT,
    });
    const tree = newStrategyMap({ id: "t", rootId: "r", format: "hoshin", root: "Aim", now: AT });
    expect(tree.nodes[0].status).toBe("proposed");
    expect(tree.nodes[0].measure).toBeUndefined();
  });

  it("keeps one focus impact, and leaves anything but an impact alone", () => {
    const one = withFocus(IMPACT, "i1");
    expect(one.nodes.filter((n) => n.focus).map((n) => n.id)).toEqual(["i1"]);
    const moved = withFocus(one, "i2");
    expect(moved.nodes.filter((n) => n.focus).map((n) => n.id)).toEqual(["i2"]);
    expect(withFocus(moved, null).nodes.some((n) => n.focus)).toBe(false);
    expect(withFocus(moved, "a1")).toBe(moved);
  });

  it("sets a tree's status and note, never an impact map's", () => {
    const tree = map([node("v", null, 0, { status: "proposed" })], { format: "dibb" });
    const q = withStatus(tree, "v", "questioned", " Who pays? ");
    expect(q.nodes[0]).toMatchObject({ status: "questioned", note: "Who pays?" });
    expect(withStatus(q, "v", "agreed", "").nodes[0].note).toBeUndefined();
    expect(withStatus(IMPACT, "g", "agreed")).toBe(IMPACT);
  });

  it("patches a node, removing keys set to undefined", () => {
    const next = withNodePatch(IMPACT, "g", { measure: undefined, detail: "d" });
    expect(next.nodes[0]).toEqual({
      id: "g",
      parentId: null,
      level: 0,
      text: "Grow repeat orders by 20%",
      detail: "d",
    });
  });

  it("knows the levels, the room and the branch a delete takes", () => {
    expect(childLevel(node("x", null, 0))).toBe(1);
    expect(childLevel(node("x", "y", 3))).toBeNull();
    expect(canAddUnder(IMPACT, IMPACT.nodes[0])).toBe(true);
    expect(canAddUnder(IMPACT, IMPACT.nodes[3])).toBe(false);
    expect(levelCounts(IMPACT)).toEqual([1, 2, 2, 2]);
    expect(branchOf(IMPACT, "a1").map((n) => n.id)).toEqual(["a1", "i1", "d1", "d2", "i2"]);
    expect(MAP_FULL).toContain(String(STRATEGY_NODES_MAX));
    expect(fitsRow(IMPACT)).toBe(true);
    expect(mapTitle({ ...IMPACT, title: " " })).toBe("Grow repeat orders by 20%");
  });

  it("keeps one focus when Undo puts back a branch while another was picked", () => {
    const before = withFocus(IMPACT, "i2").nodes.filter((n) => n.id !== "i1");
    const back = [...before, { ...node("i1", "a1", 2), focus: true }];
    expect(
      keepOneFocus(before, back)
        .filter((n) => n.focus)
        .map((n) => n.id)
    ).toEqual(["i2"]);
    const none = IMPACT.nodes.filter((n) => n.id !== "i1");
    expect(
      keepOneFocus(none, [...none, { ...node("i1", "a1", 2), focus: true }]).some((n) => n.focus)
    ).toBe(true);
  });

  it("says whether the row can take one more send's link, its longest link included", () => {
    expect(holdsLink(IMPACT)).toBe(true);
    expect(holdsLink(nearlyFull(IMPACT, 0))).toBe(false);
    // Wherever it says yes, the longest link a send writes still fits: the
    // longest route, a long target id, on a node that had no links.
    for (let slack = 0; slack <= 400; slack += 20) {
      const m = nearlyFull(IMPACT, slack);
      if (!holdsLink(m)) continue;
      const link: HandoffLink = {
        route: "backlog-story",
        targetId: `story_${"x".repeat(40)}`,
        at: new Date().toISOString(),
      };
      expect(fitsRow(withNodePatch(m, "d1", { sentTo: [link] }))).toBe(true);
    }
    expect(holdsLink(nearlyFull(IMPACT, 400))).toBe(true);
  });

  it("orders maps newest first", () => {
    const old = map([], { id: "old", updatedAt: "2026-01-01T00:00:00.000Z" });
    const fresh = map([], { id: "new", updatedAt: "2026-11-01T00:00:00.000Z" });
    expect(newestFirst([old, fresh]).map((m) => m.id)).toEqual(["new", "old"]);
  });
});

describe("moments", () => {
  const tree = (statuses: (StrategyMapNode["status"] | undefined)[]) =>
    map(
      statuses.map((status, i) =>
        node(`n${i}`, i === 0 ? null : "n0", i === 0 ? 0 : 1, status ? { status } : {})
      ),
      { format: "lean-value-tree" }
    );

  it("a tree becomes agreed only on the change that agrees its last part", () => {
    expect(becameAgreed(tree(["agreed", "proposed"]), tree(["agreed", "agreed"]))).toBe(true);
    expect(becameAgreed(tree(["agreed", "agreed"]), tree(["agreed", "agreed"]))).toBe(false);
    expect(becameAgreed(undefined, tree(["agreed"]))).toBe(false);
    expect(becameAgreed(tree(["agreed", "questioned"]), tree(["agreed", "dropped"]))).toBe(false);
    expect(
      becameAgreed(tree(["agreed", "agreed", "proposed"]), tree(["agreed", "agreed", "dropped"]))
    ).toBe(true);
    expect(becameAgreed(IMPACT, IMPACT)).toBe(false);
  });

  it("the first focus is set only from none", () => {
    const focused = withFocus(IMPACT, "i1");
    expect(focusFirstSet(IMPACT, focused)).toBe(true);
    expect(focusFirstSet(focused, withFocus(focused, "i2"))).toBe(false);
    expect(focusFirstSet(focused, withFocus(focused, null))).toBe(false);
  });
});

describe("the node form", () => {
  it("needs the text, holds the caps, and keeps only the fields the level shows", () => {
    const blank = validateNode(emptyNodeDraft("impact-map"), { format: "impact-map", level: 1 });
    expect(blank).toEqual({ ok: false, errors: { text: "Say the actor." } });
    const long = validateNode(
      { ...emptyNodeDraft("dibb"), text: "x".repeat(201), measure: "m".repeat(201) },
      { format: "dibb", level: 3 }
    );
    expect(long.ok).toBe(false);
    const ok = validateNode(
      {
        text: " Bet ",
        detail: "",
        measure: " Rate ",
        owner: "Ana",
        status: "questioned",
        note: "Why?",
        personaId: "p1",
      },
      { format: "dibb", level: 3 }
    );
    expect(ok).toEqual({
      ok: true,
      values: { text: "Bet", measure: "Rate", status: "questioned", note: "Why?" },
    });
  });

  it("saves the level's fields and keeps one it doesn't show", () => {
    const d = node("d", "i", 3, {
      owner: "Ana",
      sentTo: [{ route: "epic", targetId: "e", at: AT }],
    });
    const next = applyNodeValues(d, { text: "New" }, "impact-map");
    expect(next).toEqual({ ...d, text: "New" });
    const a = applyNodeValues(node("a", "g", 1, { personaId: "p" }), { text: "A" }, "impact-map");
    expect(a.personaId).toBeUndefined();
    expect(nodeDraftFrom(node("x", null, 0, { measure: "m" }))).toMatchObject({
      text: "x",
      measure: "m",
    });
  });
});

describe("formats", () => {
  it("has four levels per shape, with the fields the brief names", () => {
    for (const f of Object.values(STRATEGY_FORMATS)) expect(f.levels).toHaveLength(4);
    expect(levelOf("impact-map", 1).label).toBe("Actor");
    expect(levelHas("impact-map", 0, "measure")).toBe(true);
    expect(levelHas("impact-map", 2, "status")).toBe(false);
    expect(levelOf("hoshin", 3).required).toEqual(["measure", "owner"]);
    expect(levelOf("lean-value-tree", 3).fields).toContain("owner");
    expect(betLevel("dibb")).toBe(3);
    expect(betLevel("lean-value-tree")).toBe(2);
    expect(betLevel("hoshin")).toBeNull();
    expect(isTreeFormat("hoshin")).toBe(true);
    expect(isTreeFormat("impact-map")).toBe(false);
  });

  it("sends each level only where it goes", () => {
    expect(levelSends("impact-map", 3, "backlog-story")).toBe(true);
    expect(levelSends("impact-map", 2, "hypothesis")).toBe(true);
    expect(levelSends("impact-map", 2, "epic")).toBe(false);
    expect(levelSends("dibb", 3, "hypothesis")).toBe(true);
    expect(levelSends("dibb", 3, "epic")).toBe(false);
    expect(levelSends("lean-value-tree", 3, "epic")).toBe(true);
    expect(levelSends("hoshin", 2, "epic")).toBe(true);
    expect(levelSends("hoshin", 3, "epic")).toBe(false);
  });
});

describe("checks", () => {
  it("asks about a missing measure, an empty part, a feature-like impact and the focus", () => {
    const m = map([
      node("g", null, 0, { text: "Grow orders" }),
      node("a1", "g", 1, { text: "Busy parents" }),
      node("i1", "a1", 2, { text: "Build a pause button" }),
      node("i2", "a1", 2, { text: "Skip a week" }),
      node("d1", "i2", 3, { text: "Pause" }),
    ]);
    const texts = mapChecks(m).map((c) => c.text);
    expect(texts).toEqual([
      "“Grow orders” needs a measure.",
      "“Build a pause button” has no deliverables yet.",
      "“Build a pause button” reads like a feature: what will Busy parents do differently?",
      "Pick the impact to work on first.",
    ]);
    expect(mapChecks(withFocus(m, "i2")).map((c) => c.id)).not.toContain("focus");
    expect(readsLikeFeature("A new onboarding flow")).toBe(true);
    expect(readsLikeFeature("Start ordering weekly")).toBe(false);
  });

  it("asks a Hoshin tree to settle its catchball, and a bet to be tested", () => {
    const hoshin = map(
      [
        node("b", null, 0, { status: "agreed" }),
        node("a", "b", 1, { status: "questioned", measure: "m" }),
        node("p", "a", 2, { status: "proposed", owner: "Ana" }),
        node("t", "p", 3, { status: "proposed", measure: "x", owner: "Bo" }),
      ],
      { format: "hoshin" }
    );
    expect(mapChecks(hoshin).map((c) => c.text)).toEqual([
      "2 parts are still proposed and 1 part has questions: settle them in the catchball.",
    ]);
    const dibb = map(
      [
        node("d", null, 0),
        node("i", "d", 1),
        node("b", "i", 2),
        node("bet", "b", 3, {
          measure: "m",
          sentTo: [{ route: "hypothesis", targetId: "h1", at: AT }],
        }),
        node("bet2", "b", 3, { measure: "m", status: "dropped" }),
      ],
      { format: "dibb" }
    );
    expect(mapChecks(dibb, [{ id: "h1", status: "running" }])).toEqual([]);
    expect(mapChecks(dibb, []).map((c) => c.text)).toEqual(["“bet” isn't tested yet."]);
  });
});

describe("deliverable ideas", () => {
  it("offers three templates in our words, cut and deduped", () => {
    const ideas = deliverableIdeas("Busy parents", "Skip a week instead.");
    expect(ideas).toEqual([
      "A change in the product that makes it easier for busy parents to skip a week instead",
      "A message, guide or training that shows busy parents how",
      "A small test to see whether busy parents really does it",
    ]);
    expect(deliverableIdeas("Busy parents", "Skip", [ideas[1].toUpperCase()])).toHaveLength(2);
    expect(deliverableIdeas("x".repeat(200), "y".repeat(200)).every((i) => i.length <= 200)).toBe(
      true
    );
    expect(asClause("API users")).toBe("API users");
  });
});

describe("drafts", () => {
  let n = 0;
  const makeId = () => `n${++n}`;

  it("turns an actor branch into nodes, linking a persona only by its exact name", () => {
    n = 0;
    const nodes = actorDraftNodes(
      {
        name: "Mina",
        persona: "  mina, the corner SHOP owner ",
        impacts: [{ text: "Refund from the app", deliverables: ["Refund button", " "] }],
      },
      "g",
      [{ id: "persona_1", name: "Mina, the corner shop owner" }],
      makeId
    );
    expect(nodes).toEqual([
      { id: "n1", parentId: "g", level: 1, text: "Mina", personaId: "persona_1" },
      { id: "n2", parentId: "n1", level: 2, text: "Refund from the app" },
      { id: "n3", parentId: "n2", level: 3, text: "Refund button" },
    ]);
    expect(personaNamed([{ id: "p", name: "Maya" }], "Mayan")).toBeUndefined();
  });

  it("turns a tree branch into proposed nodes, with a measure only where the level has one", () => {
    n = 0;
    const nodes = partDraftNodes(
      {
        text: "Insight",
        measure: "m",
        children: [{ text: "Belief", children: [{ text: "Bet", measure: "rate" }] }],
      },
      "root",
      "dibb",
      makeId
    );
    expect(nodes).toEqual([
      { id: "n1", parentId: "root", level: 1, text: "Insight", status: "proposed" },
      { id: "n2", parentId: "n1", level: 2, text: "Belief", status: "proposed" },
      { id: "n3", parentId: "n2", level: 3, text: "Bet", measure: "rate", status: "proposed" },
    ]);
  });

  it("stops at the map's cap and never keeps a part whose parent was left out", () => {
    const full = map([
      node("g", null, 0),
      ...Array.from({ length: STRATEGY_NODES_MAX - 2 }, (_, i) => node(`x${i}`, "g", 1)),
    ]);
    const fit = fitDraftNodes(full, [node("a", "g", 1), node("b", "a", 2), node("c", "a", 2)]);
    expect(fit.nodes.map((x) => x.id)).toEqual(["a"]);
    expect(fit.left).toBe(2);
    const orphan = fitDraftNodes(IMPACT, [node("z", "gone", 2)]);
    expect(orphan).toEqual({ nodes: [], left: 1 });
  });
});

describe("paths and hand-off sources", () => {
  it("re-exports the base's path helpers", () => {
    const d = IMPACT.nodes.find((x) => x.id === "d1")!;
    expect(pathOf(IMPACT, d).map((x) => x.id)).toEqual(["g", "a1", "i1", "d1"]);
    expect(sourcePath([IMPACT], { tool: "impact-map", id: "d1", doc: "m1" })?.path).toHaveLength(4);
    expect(sourcePath([IMPACT], { tool: "retro", id: "d1", doc: "m1" })).toBeNull();
  });

  it("hands a deliverable on with who, how and the goal", () => {
    const d = IMPACT.nodes.find((x) => x.id === "d1")!;
    expect(deliverableSource(IMPACT, d)).toEqual({
      title: "Pause instead of cancel",
      description:
        "For Busy parents: Skip a week instead of cancelling. Goal: Grow repeat orders by 20% (Repeat rate)",
      sourceRef: { tool: "impact-map", id: "d1", doc: "m1" },
    });
  });

  it("hands an impact on as a hypothesis, with or without deliverables", () => {
    const i1 = IMPACT.nodes.find((x) => x.id === "i1")!;
    expect(impactHypothesisSource(IMPACT, i1)).toEqual({
      title:
        "Pause instead of cancel and Reminder before the cut-off will lead Busy parents to skip a week instead of cancelling",
      description: "Whether Busy parents really changes: Skip a week instead of cancelling",
      hypothesis: {
        willDo: "Pause instead of cancel; Reminder before the cut-off",
        successMetric: "Repeat rate",
      },
      sourceRef: { tool: "impact-map", id: "i1", doc: "m1" },
    });
    const i2 = IMPACT.nodes.find((x) => x.id === "i2")!;
    expect(impactHypothesisSource(IMPACT, i2).title).toBe(
      "Busy parents will reorder a favourite box"
    );
  });

  it("hands a tree's bets on as hypotheses, by shape", () => {
    const dibb = map(
      [
        node("d", null, 0, { text: "4 in 10 cancel after a price change" }),
        node("i", "d", 1, { text: "Price surprises" }),
        node("b", "i", 2, { text: "We believe that warning helps" }),
        node("bet", "b", 3, { text: "Email ahead", measure: "Cancels" }),
      ],
      { format: "dibb", id: "t1" }
    );
    expect(betHypothesisSource(dibb, dibb.nodes[3])).toEqual({
      title: "that warning helps",
      description:
        "Whether “Email ahead” changes what the data showed: 4 in 10 cancel after a price change",
      hypothesis: { willDo: "Email ahead", successMetric: "Cancels" },
      sourceRef: { tool: "strategy-tree", id: "bet", doc: "t1" },
    });
    const lvt = STRATEGY_TREE;
    const bet = lvt.nodes.find((x) => x.id === "bet")!;
    const init = lvt.nodes.find((x) => x.id === "init")!;
    expect(betHypothesisSource(lvt, bet)).toMatchObject({
      title: "A guided setup",
      description: "Whether it moves the goal: Setup in a minute",
      hypothesis: { willDo: "Setup checklist", successMetric: "Median setup time" },
    });
    expect(betHypothesisSource(lvt, init)).toMatchObject({
      title: "A guided setup",
      hypothesis: { willDo: "Setup checklist" },
    });
    expect(treeItemSource(lvt, init)).toEqual({
      title: "Setup checklist",
      description: "Part of: Every shop takes cards → Setup in a minute → A guided setup",
      sourceRef: { tool: "strategy-tree", id: "init", doc: "strategyMap_2" },
    });
  });

  it("sends a level only on its routes, and never a dropped part", () => {
    const d = IMPACT.nodes.find((x) => x.id === "d1")!;
    expect(strategySource(IMPACT, d, "hypothesis")).toBeNull();
    expect(strategySource(IMPACT, d, "epic")?.sourceRef.tool).toBe("impact-map");
    const init = STRATEGY_TREE.nodes.find((x) => x.id === "init")!;
    expect(strategySource(STRATEGY_TREE, { ...init, status: "dropped" }, "epic")).toBeNull();
  });
});

describe("parent-linked trees", () => {
  const nodes = [
    { id: "a", parentId: null },
    { id: "b", parentId: "a" },
    { id: "c", parentId: "b" },
    { id: "d", parentId: "gone" },
    { id: "x", parentId: "y" },
    { id: "y", parentId: "x" },
  ];

  it("draws orphans and loops at the top rather than losing them", () => {
    const drawn = drawTree(nodes);
    expect(drawn.roots.map((n) => n.id)).toEqual(["a", "d", "x"]);
    expect(drawn.childrenOf("a").map((n) => n.id)).toEqual(["b"]);
  });

  it("removes a subtree, or one node with its children moving up", () => {
    expect(Array.from(subtreeIds(nodes, "a")).sort()).toEqual(["a", "b", "c"]);
    expect(subtreeIds(nodes, "nope").size).toBe(0);
    expect(withoutSubtree(nodes, "b").map((n) => n.id)).toEqual(["a", "d", "x", "y"]);
    expect(withoutNode(nodes, "b").find((n) => n.id === "c")?.parentId).toBe("a");
  });
});
