/**
 * KB help (RAG-lite) matcher — keyword/IDF scoring over a registry-seeded index,
 * adapted from the website's chatbot-llm.js scorer with agile-domain synonyms.
 * Pure functions tested with fixtures (no live registry needed).
 */

import { describe, it, expect } from "vitest";
import { tokenize, buildKbIndex, matchKb, rankIds, type KbSeed } from "@/lib/agent/mascot/kb";

const SEEDS: KbSeed[] = [
  {
    id: "workspace.sprint.create",
    toolId: "workspace",
    name: "create",
    category: "write",
    description: "Create a new sprint with a name, start date, and capacity.",
  },
  {
    id: "workspace.impediment.add",
    toolId: "workspace",
    name: "add",
    category: "write",
    description: "Log an impediment (blocker) against the current sprint.",
  },
  {
    id: "tool.canvas.add_sticky",
    toolId: "tool.canvas",
    name: "add_sticky",
    category: "write",
    description: "Add a sticky note to the active canvas board.",
  },
  {
    id: "tool.planning-poker.cast_vote",
    toolId: "tool.planning-poker",
    name: "cast_vote",
    category: "write",
    description: "Cast an estimation vote in the current planning poker round.",
  },
  {
    id: "workspace.kudos.give",
    toolId: "workspace",
    name: "give",
    category: "write",
    description: "Give kudos to a teammate to recognise good work.",
  },
];

describe("tokenize", () => {
  it("lowercases, splits on punctuation, drops stopwords + short tokens", () => {
    expect(tokenize("Create a NEW Sprint!")).toEqual(["create", "sprint"]);
  });

  it("splits dotted ids into segments", () => {
    expect(tokenize("workspace.sprint.create")).toEqual(["workspace", "sprint", "create"]);
  });

  it("returns [] for empty / all-stopword input", () => {
    expect(tokenize("")).toEqual([]);
    expect(tokenize("how do I")).toEqual([]);
  });
});

describe("buildKbIndex", () => {
  it("derives deduped keys and key frequencies", () => {
    const index = buildKbIndex(SEEDS);
    expect(index.entries).toHaveLength(5);
    const sprint = index.entries.find((e) => e.id === "workspace.sprint.create")!;
    expect(sprint.keys).toContain("sprint");
    expect(sprint.keys).toContain("create");
    // "sprint" appears in two seeds (create + impediment "against the sprint").
    expect(index.keyFreq["sprint"]).toBe(2);
    expect(index.maxFreq).toBeGreaterThanOrEqual(2);
  });
});

describe("matchKb", () => {
  const index = buildKbIndex(SEEDS);

  it("ranks the obvious action first", () => {
    const r = matchKb("create a new sprint", index);
    expect(r.matches[0].entry.id).toBe("workspace.sprint.create");
    expect(r.confidence).toBe("high");
  });

  it("bridges vocabulary via synonyms (blocker → impediment)", () => {
    const r = matchKb("I have a blocker to log", index);
    expect(r.matches[0].entry.id).toBe("workspace.impediment.add");
  });

  it("maps 'estimate' to the planning-poker vote", () => {
    const r = matchKb("how do I estimate a story", index);
    expect(r.matches.some((m) => m.entry.id === "tool.planning-poker.cast_vote")).toBe(true);
  });

  it("finds the sticky action for a canvas request", () => {
    const r = matchKb("add a sticky note to my board", index);
    expect(r.matches[0].entry.id).toBe("tool.canvas.add_sticky");
  });

  it("returns no matches for an unrelated query", () => {
    const r = matchKb("what is the weather today", index);
    expect(r.matches).toHaveLength(0);
    expect(r.confidence).toBe("none");
  });

  it("returns none for empty input", () => {
    expect(matchKb("", index).confidence).toBe("none");
    expect(matchKb("   ?!  ", index).confidence).toBe("none");
  });

  it("respects the limit", () => {
    const r = matchKb("create add a new sprint board sticky kudos", index, { limit: 2 });
    expect(r.matches.length).toBeLessThanOrEqual(2);
  });

  it("does not let the structural category word pollute results", () => {
    // Every seed here is category 'write'. The literal word 'write' in the query
    // must NOT boost topically-unrelated write actions (regression: the ported
    // category bonus matched read/write/intent — common English words).
    const r = matchKb("write a kudos to my teammate", index);
    expect(r.matches[0].entry.id).toBe("workspace.kudos.give");
    const ids = r.matches.map((m) => m.entry.id);
    expect(ids).not.toContain("workspace.sprint.create");
    expect(ids).not.toContain("tool.canvas.add_sticky");
  });
});

describe("rankIds (tool-trimming ranking)", () => {
  const index = buildKbIndex(SEEDS);

  it("returns ranked ids best-first, no confidence gate", () => {
    const ids = rankIds("create a new sprint", index, 10);
    expect(ids[0]).toBe("workspace.sprint.create");
  });

  it("returns [] for empty or unmatched queries", () => {
    expect(rankIds("", index)).toEqual([]);
    expect(rankIds("what is the weather today", index)).toEqual([]);
  });

  it("respects the limit", () => {
    const ids = rankIds("create add a new sprint board sticky kudos", index, 2);
    expect(ids.length).toBeLessThanOrEqual(2);
  });

  it("surfaces a soft single-keyword match (would feed the tool subset)", () => {
    // 'sticky' alone is a weaker signal than a full sentence, but rankIds still
    // returns it (relevantActions might gate it out) so the tool stays callable.
    expect(rankIds("sticky", index, 10)).toContain("tool.canvas.add_sticky");
  });
});
