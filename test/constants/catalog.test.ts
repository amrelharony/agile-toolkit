import { describe, expect, it } from "vitest";
import {
  getShelfTools,
  getShelfToolsByCategory,
  getVisibleCategories,
  getVisibleTools,
  getVisibleToolsByCategory,
  isShelved,
} from "@/lib/tools/catalog";
import { tools } from "@/lib/constants/tools";

describe("tool catalog visibility", () => {
  it("hides the comic and its empty Library category until the PDF ships", () => {
    expect(getVisibleTools(false).some((t) => t.id === "agile-at-work")).toBe(false);
    expect(getVisibleToolsByCategory("Library", false)).toEqual([]);
    expect(getVisibleCategories(false)).not.toContain("Library");
  });

  it("shows the comic once it is available", () => {
    expect(getVisibleTools(true).some((t) => t.id === "agile-at-work")).toBe(true);
    expect(getVisibleCategories(true)).toContain("Library");
  });

  it("never lists an empty category", () => {
    for (const c of getVisibleCategories(false)) {
      expect(getVisibleToolsByCategory(c, false).length).toBeGreaterThan(0);
    }
  });
});

describe("the More tools shelf", () => {
  const SCRUM_CORE = [
    "retro",
    "planning-poker",
    "standup",
    "sprint-goal",
    "sprint-metrics",
    "capacity-planner",
    "impediments",
    "health-check",
    "kanban",
    "burndown",
    "velocity",
    "prioritizer",
    "wsjf",
    "okrs",
    "one-on-one",
    "dod-builder",
    "canvas",
  ];

  it("holds the off-audience tools and nothing from the Scrum core", () => {
    const shelf = getShelfTools().map((t) => t.id);
    expect(shelf).toHaveLength(32);
    expect(shelf).toEqual(
      expect.arrayContaining([
        "model-card",
        "llm-eval-tracker",
        "threat-model",
        "incident-commander",
        "post-mortem",
        "devex-survey",
        "wardley-map",
        "rfc-tracker",
      ])
    );
    for (const id of SCRUM_CORE) expect(shelf, id).not.toContain(id);
  });

  it("is hidden by default and listed once Show all tools is on", () => {
    expect(getVisibleTools(true).some(isShelved)).toBe(false);
    expect(getVisibleTools(true, true).filter(isShelved)).toHaveLength(32);
    expect(getVisibleCategories(true)).not.toContain("AI / LLM Product Management");
    expect(getVisibleCategories(true, true)).toContain("AI / LLM Product Management");
    expect(getVisibleToolsByCategory("Security & Compliance", true)).toEqual([]);
  });

  it("removes nothing from the registry (routes, sitemap and MCP keep every tool)", () => {
    expect(getVisibleTools(true, true)).toHaveLength(tools.length);
  });

  it("groups the shelf by registry category without empty groups", () => {
    const groups = getShelfToolsByCategory();
    expect(groups.length).toBeGreaterThan(1);
    expect(groups.every((g) => g.tools.length > 0)).toBe(true);
    expect(groups.flatMap((g) => g.tools)).toHaveLength(32);
  });
});
