// @vitest-environment node
/**
 * The golden test for impediments.cluster: a canned answer gives clusters
 * with a side and their blockers' short ids; a bad cluster is dropped while
 * the rest are kept; unknown and repeated ids are dropped against what was
 * sent; the fallback clusters by the keyword rules, then shared words, then
 * "Other"; and the largest input, in 3-byte text, fits the body budget once
 * fitted, newest first.
 */

import { describe, expect, it } from "vitest";
import { parseAnswer } from "@/lib/ai/parse-answer";
import { buildTaskSystem, buildTaskUser } from "@/lib/ai/run-task.server";
import { TOOL_AI_BODY_BUDGET } from "@/lib/ai/contract";
import { jsonBytes } from "@/lib/utils/json-bytes";
import {
  CLUSTER_BLOCKERS_MAX,
  CLUSTER_KNOWN_MAX,
  CLUSTER_NAME_MAX,
  CLUSTER_OUT_MAX,
  CLUSTER_TEXT_MAX,
  OTHER_CLUSTER,
  cleanClusters,
  clusterBlockersFallback,
  fitClusterInput,
  impedimentsClusterTask,
  type ClusterBlockersInput,
} from "@/lib/ai/tasks/impediments";
import { impedimentsClusterPrompt } from "@/lib/ai/tasks/impediments.server";

const task = impedimentsClusterTask;

describe("impediments.cluster", () => {
  it("is a quick task with room for a list", () => {
    expect(task).toMatchObject({ tier: "flash", effort: "low", maxTokens: 4096 });
  });

  it("reads a typical model answer", () => {
    const answer = JSON.stringify({
      clusters: [
        { name: "Another team", side: "external", ids: ["b1", "b2"] },
        { name: "Test or build environment", side: "internal", ids: ["b3", "b4"] },
      ],
    });
    const parsed = parseAnswer(`Here:\n${answer}`, task.output);
    expect(parsed.ok).toBe(true);
    if (parsed.ok) expect(parsed.data.clusters.map((c) => c.ids.length)).toEqual([2, 2]);
  });

  it("drops a cluster with a bad side and keeps the rest", () => {
    const answer = JSON.stringify({
      clusters: [
        { name: "Somewhere", side: "upstairs", ids: ["b1"] },
        { name: "Another team", side: "external", ids: ["b2"] },
      ],
    });
    const parsed = parseAnswer(answer, task.output);
    expect(parsed.ok).toBe(true);
    if (parsed.ok) expect(parsed.data.clusters.map((c) => c.name)).toEqual(["Another team"]);
  });

  it("keeps only the ids sent, each in its first cluster, and drops empty clusters", () => {
    const out = cleanClusters(
      [
        { name: "Another team", side: "external", ids: ["b1", "b9", "b2"] },
        { name: "Review", side: "internal", ids: ["b2", "b3"] },
        { name: "Ghost", side: "internal", ids: ["b7"] },
      ],
      new Set(["b1", "b2", "b3"])
    );
    expect(out).toEqual([
      { name: "Another team", side: "external", ids: ["b1", "b2"] },
      { name: "Review", side: "internal", ids: ["b3"] },
    ]);
  });

  it("falls back to the keyword rules, then shared words, then Other, with a valid answer", () => {
    const out = task.fallback(task.input.parse(task.sample));
    expect(task.output.safeParse(out).success).toBe(true);
    const byName = Object.fromEntries(out.clusters.map((c) => [c.name, c]));
    // "security review" reads as a review by the rules; b2 names the platform team.
    expect(byName["Another team"]).toMatchObject({ side: "external", ids: ["b2"] });
    expect(byName["Test or build environment"]?.ids.sort()).toEqual(["b3", "b4"]);
    expect(byName["Unclear or changing requirement"]?.ids).toEqual(["b5"]);
    const ids = out.clusters.flatMap((c) => c.ids).sort();
    expect(ids).toEqual(["b1", "b2", "b3", "b4", "b5"]);

    const leftovers = clusterBlockersFallback({
      blockers: [
        { id: "b1", text: "Waiting for the weather" },
        { id: "b2", text: "Lunch ran long" },
      ],
      known: [],
    });
    expect(leftovers.clusters.flatMap((c) => c.ids).sort()).toEqual(["b1", "b2"]);
    expect(() => clusterBlockersFallback({ blockers: [], known: [] })).toThrow();
  });

  it("never gives more than ten clusters, the rest under Other", () => {
    const texts = [
      "No access to logs",
      "Vendor API down",
      "Customer never answered",
      "Needs a sign-off",
      "Waiting for the platform team",
      "PR waiting for review",
      "Staging is down",
      "Database outage",
      "Scope unclear",
      "Only one person knows it",
      "Pulled onto support tickets",
      "Found a regression",
    ];
    const out = clusterBlockersFallback({
      blockers: texts.map((text, i) => ({ id: `b${i + 1}`, text })),
      known: [],
    });
    expect(out.clusters).toHaveLength(CLUSTER_OUT_MAX);
    expect(out.clusters.at(-1)).toMatchObject({ name: OTHER_CLUSTER, side: "internal" });
    expect(out.clusters.flatMap((c) => c.ids)).toHaveLength(texts.length);
    expect(task.output.safeParse(out).success).toBe(true);
  });

  it("fits the largest input, in 3-byte text, keeping the newest first", () => {
    const cjk = (n: number) => "数".repeat(n);
    const largest: ClusterBlockersInput = {
      blockers: Array.from({ length: CLUSTER_BLOCKERS_MAX }, (_, i) => ({
        id: `b${i + 1}`,
        text: cjk(CLUSTER_TEXT_MAX),
        side: "external" as const,
      })),
      known: Array.from({ length: CLUSTER_KNOWN_MAX }, () => cjk(CLUSTER_NAME_MAX)),
    };
    expect(task.input.safeParse(largest).success).toBe(true);
    const size = (input: ClusterBlockersInput) => jsonBytes({ task: task.id, input });
    expect(size(largest)).toBeGreaterThan(TOOL_AI_BODY_BUDGET);
    const fitted = fitClusterInput(largest);
    expect(size(fitted)).toBeLessThanOrEqual(TOOL_AI_BODY_BUDGET);
    expect(task.input.safeParse(fitted).success).toBe(true);
    expect(fitted.blockers[0].id).toBe("b1");
    expect(fitted.blockers.length).toBeGreaterThan(50);
    expect(fitted.blockers.length).toBeLessThan(CLUSTER_BLOCKERS_MAX);
    const small = { blockers: [largest.blockers[0]], known: [] };
    expect(fitClusterInput(small)).toBe(small);
  });

  it("builds a prompt with the blockers and known clusters as data", () => {
    const sample = task.input.parse(task.sample);
    expect(buildTaskSystem(task, impedimentsClusterPrompt)).toMatch(/clusters/);
    const user = buildTaskUser(impedimentsClusterPrompt, sample);
    expect(user).toContain("Known clusters: Another team; Test or build environment");
    expect(user).toContain("b1: Waiting on the security review for the payments API (external)");
  });
});
