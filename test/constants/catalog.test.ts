import { describe, expect, it } from "vitest";
import {
  getVisibleCategories,
  getVisibleTools,
  getVisibleToolsByCategory,
} from "@/lib/tools/catalog";

describe("tool catalog visibility", () => {
  // The comic is private (/comic/<token>): nothing a visitor browses lists it.
  it("never lists the private comic", () => {
    const comic = getVisibleTools().filter(
      (t) => t.id === "agile-at-work" || /^\/comics?(\/|$)/.test(t.path)
    );
    expect(comic).toEqual([]);
  });

  it("never lists an empty category", () => {
    for (const c of getVisibleCategories()) {
      expect(getVisibleToolsByCategory(c).length).toBeGreaterThan(0);
    }
  });
});
