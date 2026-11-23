// @vitest-environment node
/**
 * Root Cause's causal loop rules (lib/root-cause/loops): the loops a set of
 * arrows closes (each found once, R or B by its − arrows, labelled shortest
 * first), the caps and the search budget, the changers the page and Amr
 * share, Undo of a delete, the reader of a stored loop, the loop sentence,
 * the busiest thing and the layout.
 */

import { describe, expect, it } from "vitest";
import {
  LOOPS_SHOWN,
  LOOP_LENGTH_MAX,
  LOOP_NODE_BOX,
  LOOP_VIEWBOX,
  busiestNode,
  describeLoop,
  findLoops,
  loopLayout,
  loopPath,
  readLoop,
  withLoopLink,
  withLoopLinkPatch,
  withLoopName,
  withLoopNode,
  withLoopNodeMoved,
  withLoopNodeText,
  withLoopRestored,
  withoutLoopLink,
  withoutLoopNode,
} from "@/lib/root-cause/loops";
import {
  busiestNode as busiestFromModel,
  findLoops as findFromModel,
  loopToAct,
  readAnalysis,
} from "@/lib/root-cause/model";
import { buildExample } from "@/app/(tools)/root-cause/example";
import {
  ENTITY_ROW_MAX_BYTES,
  LOOP_TEXT_MAX,
  TOOL_LIST_MAX,
  type LoopPolarity,
  type RootCauseAnalysis,
  type RootCauseLoop,
} from "@/lib/stores/workspace-types";

const NOW = "2026-11-20T10:00:00.000Z";

/** A loop from node ids (their text is the id in capitals) and "a>b" or "a>b-" (opposite) arrows. */
function loopOf(nodes: string[], arrows: string[]): RootCauseLoop {
  return {
    nodes: nodes.map((id) => ({ id, text: id.toUpperCase() })),
    links: arrows.map((a, i) => {
      const opposite = a.endsWith("-");
      const [from, to] = a.replace(/-$/, "").split(">");
      return {
        id: `l${i}`,
        from,
        to,
        polarity: (opposite ? "opposite" : "same") as LoopPolarity,
      };
    }),
  };
}

function analysis(loop?: RootCauseLoop, over: Partial<RootCauseAnalysis> = {}): RootCauseAnalysis {
  return {
    id: "rca_1",
    title: "Checkout errors noticed late",
    problem: "",
    method: "causal-loop",
    whys: [],
    causes: [],
    ...(loop ? { loop } : {}),
    createdAt: NOW,
    updatedAt: NOW,
    ...over,
  };
}

const checkout = () => buildExample()[1];

describe("findLoops", () => {
  it("finds a 2-cycle once, from its smallest id", () => {
    const found = findLoops(loopOf(["b", "a"], ["a>b", "b>a"]));
    expect(found.loops).toHaveLength(1);
    expect(found.loops[0]).toMatchObject({ key: "a>b", nodeIds: ["a", "b"], kind: "reinforcing" });
    expect(found.truncated).toBe(false);
  });

  it("finds overlapping loops each once, and says R or B by the count of − arrows", () => {
    // a→b→c→a (one −: B) and a→b→a (none: R), sharing a→b.
    const found = findLoops(loopOf(["a", "b", "c"], ["a>b", "b>c", "c>a-", "b>a"]));
    expect(found.loops.map((l) => [l.key, l.kind])).toEqual([
      ["a>b", "reinforcing"],
      ["a>b>c", "balancing"],
    ]);
    // Two − arrows make it reinforcing again.
    const even = findLoops(loopOf(["a", "b", "c"], ["a>b-", "b>c", "c>a-"]));
    expect(even.loops[0].kind).toBe("reinforcing");
  });

  it("keys a loop by its ids in loop order, so moving things or flipping a sign keeps it", () => {
    const one = findLoops(loopOf(["c", "a", "b"], ["a>c", "c>b", "b>a"])).loops[0];
    expect(one.key).toBe("a>c>b");
    const flipped = findLoops(loopOf(["a", "b", "c"], ["a>c-", "c>b", "b>a"])).loops[0];
    expect(flipped.key).toBe("a>c>b");
    expect(flipped.kind).toBe("balancing");
  });

  it("labels R1… and B1… shortest first, then by key, the same every time", () => {
    const loop = loopOf(
      ["d", "c", "b", "a"],
      ["a>b", "b>a", "c>d-", "d>c", "a>c", "c>a-", "b>c", "c>b"]
    );
    const labels = () => findLoops(loop).loops.map((l) => `${l.label}:${l.key}`);
    expect(labels()).toEqual(["R1:a>b", "B1:a>c", "R2:b>c", "B2:c>d", "B3:a>b>c", "R3:a>c>b"]);
    expect(labels()).toEqual(labels());
  });

  it("ignores self-links and arrows to things that aren't there", () => {
    const loop = loopOf(["a", "b"], ["a>a", "a>b", "b>zz", "b>a"]);
    expect(findLoops(loop).loops.map((l) => l.key)).toEqual(["a>b"]);
  });

  it("keeps the 20 shortest and says the list may be short", () => {
    // A hub linked both ways with 25 spokes: 25 two-cycles and nothing else.
    const spokes = Array.from({ length: 25 }, (_, i) => `s${String(i).padStart(2, "0")}`);
    const found = findLoops(
      loopOf(
        ["a", ...spokes],
        spokes.flatMap((s) => [`a>${s}`, `${s}>a`])
      )
    );
    expect(found.loops).toHaveLength(LOOPS_SHOWN);
    expect(found.loops.every((l) => l.nodeIds.length === 2)).toBe(true);
    expect(found.loops[0].key).toBe("a>s00");
    expect(found.truncated).toBe(true);
    // Twenty or fewer: the list is whole.
    expect(findLoops(loopOf(["a", "b"], ["a>b", "b>a"])).truncated).toBe(false);
  });

  it("stops after 200 loops, keeping the shortest of them, and says so", () => {
    // Every pair of 8 things linked both ways (56 arrows): thousands of loops.
    const ids = "abcdefgh".split("");
    const arrows = ids.flatMap((a) => ids.filter((b) => b !== a).map((b) => `${a}>${b}`));
    const started = Date.now();
    const found = findLoops(loopOf(ids, arrows));
    expect(Date.now() - started).toBeLessThan(2000);
    expect(found.loops).toHaveLength(LOOPS_SHOWN);
    expect(found.truncated).toBe(true);
    const lengths = found.loops.map((l) => l.nodeIds.length);
    expect(lengths).toEqual([...lengths].sort((x, y) => x - y));
  });

  it("stops on its step budget, and says so", () => {
    // Twelve layers of three, each thing to all three of the next layer: no
    // loop at all, but 3^11 paths from the first thing.
    const layers = Array.from({ length: 12 }, (_, l) =>
      ["a", "b", "c"].map((x) => `L${String(l).padStart(2, "0")}${x}`)
    );
    const arrows = layers
      .slice(0, -1)
      .flatMap((layer, l) => layer.flatMap((from) => layers[l + 1].map((to) => `${from}>${to}`)));
    const started = Date.now();
    const found = findLoops(loopOf(layers.flat(), arrows));
    expect(Date.now() - started).toBeLessThan(2000);
    expect(found.loops).toEqual([]);
    expect(found.truncated).toBe(true);
  });

  it("doesn't follow a loop longer than 12 things", () => {
    const ids = Array.from({ length: 13 }, (_, i) => `n${String(i).padStart(2, "0")}`);
    const ring = ids.map((id, i) => `${id}>${ids[(i + 1) % ids.length]}`);
    expect(findLoops(loopOf(ids, ring)).loops).toEqual([]);
    const twelve = ids.slice(0, LOOP_LENGTH_MAX);
    const ring12 = twelve.map((id, i) => `${id}>${twelve[(i + 1) % twelve.length]}`);
    expect(findLoops(loopOf(twelve, ring12)).loops).toHaveLength(1);
  });

  it("is re-exported from the model, which the next-step rule loads", () => {
    expect(findFromModel).toBe(findLoops);
    expect(busiestFromModel).toBe(busiestNode);
  });
});

describe("the example's loop", () => {
  it("closes R1 (named) and B1, and its busiest thing is the alerts", () => {
    const loop = checkout().loop!;
    const found = findLoops(loop);
    expect(found.loops.map((l) => [l.label, l.nodeIds.length])).toEqual([
      ["B1", 3],
      ["R1", 4],
    ]);
    const r1 = found.loops.find((l) => l.label === "R1")!;
    expect(loop.names).toEqual([{ key: r1.key, name: "Firefighting crowds out the fix" }]);
    expect(busiestNode(loop)?.text).toBe("Alerts on checkout");
  });

  it("reads each loop in one sentence, more or less going round", () => {
    const loop = checkout().loop!;
    const [b1, r1] = findLoops(loop).loops;
    expect(describeLoop(loop, r1)).toBe(
      "More checkout errors customers see → more support tickets → more time spent firefighting → less alerts on checkout → more checkout errors customers see: each turn adds to the last (reinforcing)."
    );
    expect(describeLoop(loop, b1)).toMatch(
      /^More checkout errors customers see → more pressure to fix monitoring → more alerts on checkout → less checkout errors customers see: each turn holds it back \(balancing\)\.$/
    );
    expect(loopPath(loop, r1)).toEqual([
      "Checkout errors customers see",
      "Support tickets",
      "Time spent firefighting",
      "Alerts on checkout",
    ]);
  });

  it("keeps a capital where the words start with one (API errors)", () => {
    const loop = loopOf(["a", "b"], ["a>b", "b>a"]);
    loop.nodes[0].text = "API errors";
    loop.nodes[1].text = "Bugs reported";
    expect(describeLoop(loop, findLoops(loop).loops[0])).toBe(
      "More API errors → more bugs reported → more API errors: each turn adds to the last (reinforcing)."
    );
  });
});

describe("busiestNode", () => {
  it("is null below two loops", () => {
    expect(busiestNode(loopOf(["a", "b"], ["a>b", "b>a"]))).toBeNull();
    expect(busiestNode(undefined)).toBeNull();
  });

  it("breaks a tie by the arrows leading in, then by the list's order", () => {
    // a and b each sit in both loops (a>b>a and a>b>c>a); c's arrow leads into a.
    const loop = loopOf(["b", "a", "c"], ["a>b", "b>a", "b>c", "c>a"]);
    expect(busiestNode(loop)?.id).toBe("a");
    // Two arrows into each: the list's order decides.
    const even = loopOf(["b", "a"], ["a>b", "b>a"]);
    even.nodes.push({ id: "c", text: "C" });
    even.links.push(
      { id: "x1", from: "a", to: "c", polarity: "same" },
      { id: "x2", from: "c", to: "b", polarity: "same" },
      { id: "x3", from: "b", to: "c", polarity: "same" },
      { id: "x4", from: "c", to: "a", polarity: "same" }
    );
    expect(busiestNode(even)?.id).toBe("b");
  });
});

describe("the changers", () => {
  it("adds a thing, refusing blank, a full list and the same words in another case", () => {
    const a = analysis();
    const added = withLoopNode(a, "  Support   tickets ", "n1", NOW);
    expect(added.ok).toBe(true);
    if (!added.ok) return;
    expect(added.analysis.loop?.nodes).toEqual([{ id: "n1", text: "Support tickets" }]);
    expect(withLoopNode(added.analysis, "SUPPORT TICKETS", "n2", NOW)).toEqual({
      ok: false,
      reason: "duplicate",
    });
    expect(withLoopNode(a, "   ", "n2", NOW)).toEqual({ ok: false, reason: "blank" });
    const full = analysis({
      nodes: Array.from({ length: TOOL_LIST_MAX.loopNodes }, (_, i) => ({
        id: `n${i}`,
        text: `T${i}`,
      })),
      links: [],
    });
    expect(withLoopNode(full, "One more", "x", NOW)).toEqual({ ok: false, reason: "loop_full" });
    // Words are capped to the CRUD's length.
    const long = withLoopNode(a, "x".repeat(500), "n9", NOW);
    expect(long.ok && long.analysis.loop?.nodes[0].text.length).toBe(LOOP_TEXT_MAX.node);
  });

  it("edits a thing's words, refusing blank, gone and another thing's words", () => {
    const a = analysis(loopOf(["a", "b"], []));
    const edited = withLoopNodeText(a, "a", "Alerts", NOW);
    expect(edited.ok && edited.analysis.loop?.nodes[0].text).toBe("Alerts");
    expect(withLoopNodeText(a, "a", "b", NOW)).toEqual({ ok: false, reason: "duplicate" });
    expect(withLoopNodeText(a, "a", " ", NOW)).toEqual({ ok: false, reason: "blank" });
    expect(withLoopNodeText(a, "zz", "New", NOW)).toEqual({ ok: false, reason: "not_found" });
    // Its own words in another case are fine.
    expect(withLoopNodeText(a, "a", "a", NOW).ok).toBe(true);
  });

  it("moves a thing earlier or later, and not past an end", () => {
    const a = analysis(loopOf(["a", "b", "c"], []));
    expect(withLoopNodeMoved(a, "b", -1, NOW)?.loop?.nodes.map((n) => n.id)).toEqual([
      "b",
      "a",
      "c",
    ]);
    expect(withLoopNodeMoved(a, "c", 1, NOW)).toBeNull();
    expect(withLoopNodeMoved(a, "a", -1, NOW)).toBeNull();
  });

  it("adds an arrow, refusing a self-link, a duplicate, an unknown thing and a full list", () => {
    const a = analysis(loopOf(["a", "b"], ["a>b"]));
    const link = (from: string, to: string) => ({ from, to, polarity: "same" as const });
    expect(withLoopLink(a, link("a", "a"), "x", NOW)).toEqual({ ok: false, reason: "self_link" });
    expect(withLoopLink(a, link("a", "b"), "x", NOW)).toEqual({ ok: false, reason: "duplicate" });
    expect(withLoopLink(a, link("a", "zz"), "x", NOW)).toEqual({
      ok: false,
      reason: "unknown_node",
    });
    const back = withLoopLink(a, { ...link("b", "a"), delay: true }, "x", NOW);
    expect(back.ok && back.analysis.loop?.links[1]).toEqual({
      id: "x",
      from: "b",
      to: "a",
      polarity: "same",
      delay: true,
    });
    const ids = Array.from({ length: 12 }, (_, i) => `n${i}`);
    const arrows = ids.flatMap((x) => ids.filter((y) => y !== x).map((y) => `${x}>${y}`));
    const full = analysis(loopOf(ids, arrows.slice(0, TOOL_LIST_MAX.loopLinks)));
    const spare = arrows[TOOL_LIST_MAX.loopLinks].split(">");
    expect(withLoopLink(full, link(spare[0], spare[1]), "x", NOW)).toEqual({
      ok: false,
      reason: "links_full",
    });
  });

  it("flips a sign and sets a delay without changing the loop's key or name", () => {
    const loop = { ...loopOf(["a", "b"], ["a>b", "b>a"]), names: [{ key: "a>b", name: "Ours" }] };
    const a = analysis(loop);
    const flipped = withLoopLinkPatch(a, "l0", { polarity: "opposite", delay: true }, NOW)!;
    expect(flipped.loop?.links[0]).toMatchObject({ polarity: "opposite", delay: true });
    expect(findLoops(flipped.loop).loops[0]).toMatchObject({ key: "a>b", kind: "balancing" });
    expect(flipped.loop?.names).toEqual([{ key: "a>b", name: "Ours" }]);
    expect(withLoopLinkPatch(flipped, "l0", { delay: false }, NOW)?.loop?.links[0].delay).toBe(
      undefined
    );
    expect(withLoopLinkPatch(a, "zz", { delay: true }, NOW)).toBeNull();
  });

  it("deletes a thing with its arrows and its loops' names, and Undo puts all back in place", () => {
    const ex = checkout();
    const loop = ex.loop!;
    const alerts = loop.nodes[3];
    const gone = withoutLoopNode(ex, alerts.id, NOW)!;
    expect(gone.analysis.loop?.nodes.map((n) => n.text)).not.toContain("Alerts on checkout");
    expect(gone.analysis.loop?.links.some((l) => l.from === alerts.id || l.to === alerts.id)).toBe(
      false
    );
    expect(gone.analysis.loop?.names ?? []).toEqual([]);
    expect(gone.removed.links).toHaveLength(3);
    expect(gone.removed.names).toHaveLength(1);
    const back = withLoopRestored(gone.analysis, gone.removed, NOW)!;
    expect(back.loop).toEqual(loop);
    // Twice is refused: it's there already.
    expect(withLoopRestored(back, gone.removed, NOW)).toBeNull();
  });

  it("deletes an arrow and the names of the loops it closed only", () => {
    const loop: RootCauseLoop = {
      ...loopOf(["a", "b", "c"], ["a>b", "b>a", "b>c", "c>a"]),
      names: [
        { key: "a>b", name: "Short" },
        { key: "a>b>c", name: "Long" },
      ],
    };
    const gone = withoutLoopLink(analysis(loop), "l2", NOW)!;
    expect(gone.analysis.loop?.names).toEqual([{ key: "a>b", name: "Short" }]);
    expect(gone.removed.names).toEqual([{ key: "a>b>c", name: "Long" }]);
    expect(withLoopRestored(gone.analysis, gone.removed, NOW)?.loop).toEqual(loop);
    expect(withoutLoopLink(analysis(loop), "zz", NOW)).toBeNull();
  });

  it("names a loop, clears a name, and refuses a loop that isn't there", () => {
    const a = analysis(loopOf(["a", "b"], ["a>b", "b>a"]));
    const named = withLoopName(a, "a>b", "  Work begets work ", NOW);
    expect(named.ok && named.analysis.loop?.names).toEqual([
      { key: "a>b", name: "Work begets work" },
    ]);
    if (!named.ok) return;
    const cleared = withLoopName(named.analysis, "a>b", "", NOW);
    expect(cleared.ok && cleared.analysis.loop?.names).toEqual([]);
    expect(withLoopName(a, "b>a", "Nope", NOW)).toEqual({ ok: false, reason: "unknown_loop" });
  });

  it("drops leftover names before checking the cap, so they never block a new name", () => {
    const leftovers = Array.from({ length: TOOL_LIST_MAX.loopNames }, (_, i) => ({
      key: `gone${i}>x`,
      name: `Old ${i}`,
    }));
    const a = analysis({ ...loopOf(["a", "b"], ["a>b", "b>a"]), names: leftovers });
    const named = withLoopName(a, "a>b", "New", NOW);
    expect(named.ok && named.analysis.loop?.names).toEqual([{ key: "a>b", name: "New" }]);
  });

  it("refuses a change that would make the analysis too big for its row", () => {
    const huge = analysis(undefined, { problem: "x".repeat(ENTITY_ROW_MAX_BYTES) });
    expect(withLoopNode(huge, "One", "n1", NOW)).toEqual({ ok: false, reason: "too_big" });
  });
});

describe("readLoop", () => {
  it("drops bad rows: no id, no words, a duplicate id, self-links and links to missing things", () => {
    const read = readLoop({
      nodes: [
        { id: "a", text: "  Alerts  " },
        { id: "a", text: "Again" },
        { id: "", text: "No id" },
        { id: "b", text: "   " },
        { id: "c", text: "Tickets" },
        "junk",
      ],
      links: [
        { id: "1", from: "a", to: "c", polarity: "weird" },
        { id: "2", from: "a", to: "a", polarity: "same" },
        { id: "3", from: "a", to: "gone", polarity: "same" },
        { id: "4", from: "a", to: "c", polarity: "opposite" },
        { id: "5", from: "c", to: "a", polarity: "opposite", delay: "yes" },
      ],
      names: [
        { key: "a>c", name: " Ours " },
        { key: "", name: "No key" },
        { key: "a>c", name: "Dup" },
      ],
    });
    expect(read).toEqual({
      nodes: [
        { id: "a", text: "Alerts" },
        { id: "c", text: "Tickets" },
      ],
      links: [
        { id: "1", from: "a", to: "c", polarity: "same" },
        { id: "5", from: "c", to: "a", polarity: "opposite" },
      ],
      names: [{ key: "a>c", name: "Ours" }],
    });
    expect(readLoop("loop")).toBeUndefined();
    expect(readLoop(null)).toBeUndefined();
  });

  it("caps every list", () => {
    const read = readLoop({
      nodes: Array.from({ length: 40 }, (_, i) => ({ id: `n${i}`, text: `T${i}` })),
      links: [],
      names: Array.from({ length: 30 }, (_, i) => ({ key: `k${i}`, name: `N${i}` })),
    })!;
    expect(read.nodes).toHaveLength(TOOL_LIST_MAX.loopNodes);
    expect(read.names).toHaveLength(TOOL_LIST_MAX.loopNames);
  });

  it("is what readAnalysis reads a stored loop with (its spread no longer passes it raw)", () => {
    const a = readAnalysis({
      ...analysis(),
      loop: { nodes: [{ id: "a", text: "A" }], links: [{ id: "x", from: "a", to: "a" }] },
    })!;
    expect(a.loop).toEqual({ nodes: [{ id: "a", text: "A" }], links: [] });
    expect("loop" in readAnalysis({ ...analysis(), loop: "bad" })!).toBe(false);
  });
});

describe("loopToAct (the next step's pick)", () => {
  it("names the first analysis with a loop and no root cause, with its busiest thing", () => {
    const ex = checkout();
    const open = { ...ex, id: "rca_open", rootCause: undefined };
    expect(loopToAct([ex])).toBeNull();
    const pick = loopToAct([analysis(), open])!;
    expect(pick.analysis.id).toBe("rca_open");
    expect(pick.loops).toBe(2);
    expect(pick.busiest?.text).toBe("Alerts on checkout");
    expect(loopToAct([analysis(loopOf(["a", "b"], ["a>b"]))])).toBeNull();
  });
});

describe("loopLayout", () => {
  it("puts every box inside the drawing, the first at the top", () => {
    for (const n of [1, 2, 5, 12, 30]) {
      const points = loopLayout(Array.from({ length: n }, (_, i) => ({ id: `n${i}` })));
      expect(points).toHaveLength(n);
      for (const p of points) {
        expect(p.x - LOOP_NODE_BOX.width / 2).toBeGreaterThanOrEqual(0);
        expect(p.x + LOOP_NODE_BOX.width / 2).toBeLessThanOrEqual(LOOP_VIEWBOX.width);
        expect(p.y - LOOP_NODE_BOX.height / 2).toBeGreaterThanOrEqual(0);
        expect(p.y + LOOP_NODE_BOX.height / 2).toBeLessThanOrEqual(LOOP_VIEWBOX.height);
      }
      if (n > 1) expect(points[0].y).toBe(Math.min(...points.map((p) => p.y)));
    }
  });
});
