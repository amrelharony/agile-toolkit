import { describe, expect, it } from "vitest";
import {
  getVisibleCategories,
  getVisibleTools,
  getVisibleToolsByCategory,
} from "@/lib/tools/catalog";

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
