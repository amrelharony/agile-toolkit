// @vitest-environment node
/**
 * lib/impediments/clusters: the default blocker clusters, six inside the
 * team and six outside it, and the side of a default cluster by its label.
 */

import { describe, expect, it } from "vitest";
import { DEFAULT_BLOCKER_CLUSTERS, defaultClusterSide } from "@/lib/impediments/clusters";
import { BLOCKER_CLUSTER_MAX, BLOCK_SIDES } from "@/lib/stores/workspace-types";

describe("DEFAULT_BLOCKER_CLUSTERS", () => {
  it("lists six clusters inside the team, then six outside it", () => {
    expect(DEFAULT_BLOCKER_CLUSTERS.map((c) => c.side)).toEqual([
      ...Array(6).fill("internal"),
      ...Array(6).fill("external"),
    ]);
    expect(DEFAULT_BLOCKER_CLUSTERS.slice(0, 2).map((c) => c.label)).toEqual([
      "Waiting for a review",
      "Unclear or changing requirement",
    ]);
    expect(DEFAULT_BLOCKER_CLUSTERS.at(-1)?.label).toBe("Infrastructure or operations");
  });

  it("has unique labels in sentence case that fit a cluster's cap", () => {
    const labels = DEFAULT_BLOCKER_CLUSTERS.map((c) => c.label);
    expect(new Set(labels.map((l) => l.toLowerCase())).size).toBe(labels.length);
    for (const { label, side } of DEFAULT_BLOCKER_CLUSTERS) {
      expect(label.length).toBeLessThanOrEqual(BLOCKER_CLUSTER_MAX);
      expect(label).toMatch(/^[A-Z][^A-Z]*$/);
      expect(BLOCK_SIDES).toContain(side);
    }
  });
});

describe("defaultClusterSide", () => {
  it("gives a default cluster's side", () => {
    expect(defaultClusterSide("Waiting for a review")).toBe("internal");
    expect(defaultClusterSide("Another team")).toBe("external");
    expect(defaultClusterSide("Access or permissions")).toBe("external");
  });

  it("ignores case and extra spaces", () => {
    expect(defaultClusterSide("  pulled onto   OTHER work ")).toBe("internal");
  });

  it("is null for a cluster the team named, or no label", () => {
    expect(defaultClusterSide("Waiting for the coffee machine")).toBeNull();
    expect(defaultClusterSide("")).toBeNull();
    expect(defaultClusterSide(undefined)).toBeNull();
    expect(defaultClusterSide(null)).toBeNull();
  });
});
