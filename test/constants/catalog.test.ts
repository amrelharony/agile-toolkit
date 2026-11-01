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
  it("always shows the comics and their Library category", () => {
    expect(getVisibleTools().some((t) => t.id === "comics")).toBe(true);
    expect(getVisibleToolsByCategory("Library").map((t) => t.id)).toEqual(["comics"]);
    expect(getVisibleCategories()).toContain("Library");
  });

  it("never lists an empty category", () => {
    for (const c of getVisibleCategories()) {
      expect(getVisibleToolsByCategory(c).length).toBeGreaterThan(0);
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
    expect(getVisibleTools().some(isShelved)).toBe(false);
    expect(getVisibleTools(true).filter(isShelved)).toHaveLength(32);
    expect(getVisibleCategories()).not.toContain("AI / LLM Product Management");
    expect(getVisibleCategories(true)).toContain("AI / LLM Product Management");
    expect(getVisibleToolsByCategory("Security & Compliance")).toEqual([]);
  });

  it("removes nothing but VIP tools from the registry (routes, sitemap and MCP keep the rest)", () => {
    expect(getVisibleTools(true)).toEqual(tools.filter((t) => t.access !== "vip"));
  });

  it("groups the shelf by registry category without empty groups", () => {
    const groups = getShelfToolsByCategory();
    expect(groups.length).toBeGreaterThan(1);
    expect(groups.every((g) => g.tools.length > 0)).toBe(true);
    expect(groups.flatMap((g) => g.tools)).toHaveLength(32);
  });
});
