// @vitest-environment node
/**
 * lib/impediments/clusters: the default blocker clusters, six inside the
 * team and six outside it, and the side of a default cluster by its label.
 */

import { describe, expect, it } from "vitest";
import {
  CLUSTER_RULES,
  DEFAULT_BLOCKER_CLUSTERS,
  clusterFor,
  clusterKey,
  defaultClusterLabel,
  defaultClusterSide,
} from "@/lib/impediments/clusters";
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

describe("the keyword rules", () => {
  it("cover every default cluster once, by its own label", () => {
    const labels = CLUSTER_RULES.map((r) => r.label).sort();
    expect(labels).toEqual(DEFAULT_BLOCKER_CLUSTERS.map((c) => c.label).sort());
  });

  it.each([
    ["Waiting on a review of the payments PR", "Waiting for a review"],
    ["Staging environment down again", "Test or build environment"],
    ["Acceptance criteria unclear on checkout", "Unclear or changing requirement"],
    ["Only one person knows the billing job", "Only one person knows how"],
    ["Pulled onto support tickets all week", "Pulled onto other work"],
    ["Found a regression in the cart", "Bug found on the way"],
    ["Waiting for the platform team", "Another team"],
    ["Release blocked until the security team signs off", "A decision or approval"],
    ["Need an answer from the customer on refunds", "An answer from a customer or stakeholder"],
    ["Payment provider sandbox is down", "A vendor or outside service"],
    ["No access to the production logs", "Access or permissions"],
    ["Database outage on Tuesday", "Infrastructure or operations"],
  ])("puts %j under %s", (text, label) => {
    expect(clusterFor(text)).toBe(label);
  });

  it("suggests nothing for words no rule knows, or no words", () => {
    expect(clusterFor("Waiting for the weather")).toBeNull();
    expect(clusterFor("   ")).toBeNull();
    expect(clusterFor(undefined)).toBeNull();
  });
});

describe("one cluster however it is typed", () => {
  it("compares names without case or extra spaces", () => {
    expect(clusterKey("  Another   TEAM ")).toBe("another team");
    expect(clusterKey(undefined)).toBe("");
    expect(clusterKey(null)).toBe("");
  });

  it("gives a default cluster's label as the list writes it", () => {
    expect(defaultClusterLabel("another  team")).toBe("Another team");
    expect(defaultClusterLabel("Legal sign-off")).toBeNull();
    expect(defaultClusterLabel("")).toBeNull();
  });
});
