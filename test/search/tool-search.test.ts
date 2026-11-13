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
    ["coffee chat", "team-mixer"],
    ["pair rotation", "team-mixer"],
    ["world café", "team-mixer"],
    ["retro questions", "card-decks"],
    ["coaching questions", "card-decks"],
    ["check-in questions", "card-decks"],
    ["side discussions", "parking-lot"],
    ["issue bin", "parking-lot"],
    ["ritual reset", "meeting-audit"],
    ["coaching journal", "sm-notebook"],
    ["scrum master journal", "sm-notebook"],
    ["coaching notes", "sm-notebook"],
    ["observations", "sm-notebook"],
  ])("finds the right tool for %j", (query, expected) => {
    expect(ids(query, 3)).toContain(expected);
  });

  // The notebook's name and description already put it in the top 3 for most
  // coaching words, so these two pin what its TOOL_KEYWORDS line adds: without
  // it, "observations" finds nothing and "coaching journal" ranks it third.
  it.each([["coaching journal"], ["observations"]])(
    "ranks the Scrum Master Notebook first for %j",
    (query) => {
      expect(ids(query, 1)).toEqual(["sm-notebook"]);
    }
  );

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
