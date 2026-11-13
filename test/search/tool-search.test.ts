import { describe, expect, it, beforeEach } from "vitest";
import { searchTools, resetToolSearchIndex, TOOL_KEYWORDS } from "@/lib/search/tool-search";
import { getToolById } from "@/lib/constants/tools";

const ids = (q: string, n = 5) => searchTools(q, n).map((t) => t.id);

describe("searchTools", () => {
  beforeEach(() => resetToolSearchIndex());

  it("only lists vocabulary for tools that exist", () => {
    for (const id of Object.keys(TOOL_KEYWORDS)) {
      expect(getToolById(id), `unknown tool id "${id}"`).toBeDefined();
    }
  });

  it.each([
    ["daily scrum", "standup"],
    ["retrospective", "retro"],
    ["definition of ready", "refinement"],
    ["definition of done", "dod-builder"],
    ["team health", "health-check"],
    ["estimate story points", "planning-poker"],
    ["whiteboard", "canvas"],
    ["1:1 with my report", "one-on-one"],
    ["Q&A", "audience-wall"],
    ["Q & A session", "audience-wall"],
  ])("finds the right tool for %j", (query, expected) => {
    expect(ids(query, 3)).toContain(expected);
  });

  it("surfaces several prioritisation frameworks for 'prioritise my backlog'", () => {
    const found = ids("prioritise my backlog", 8);
    const frameworks = ["prioritizer", "rice-scoring", "wsjf", "moscow", "ice-score"];
    expect(frameworks.filter((f) => found.includes(f)).length).toBeGreaterThanOrEqual(3);
  });

  it("still finds a shelved tool by name, flagged so callers can group it", () => {
    const hit = searchTools("model card", 3).find((t) => t.id === "model-card");
    expect(hit?.shelf).toBe("more");
    expect(searchTools("retro", 1)[0]?.shelf).toBeUndefined();
  });

  it("returns nothing for an empty query", () => {
    expect(searchTools("   ")).toEqual([]);
  });
});
