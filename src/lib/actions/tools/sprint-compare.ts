/**
 * Sprint Comparison — tool-local actions.
 *
 * Category: Metrics & Dashboards (squad S2)
 * Agent surface: tool.sprint_compare.*
 *
 * Pure compute. Given several sprints each scored on the same set of
 * dimensions (e.g. velocity, quality, predictability… on a 1–10 scale),
 * returns each dimension's min/max/average and the leading sprint, plus an
 * overall score per sprint — the comparison a radar chart visualises. No
 * persistence.
 */

import { z } from "zod";
import { registry } from "../registry";

const round2 = (n: number) => Math.round(n * 100) / 100;

// ──────── tool.sprint_compare.compute ────────
registry.register({
  id: "tool.sprint_compare.compute",
  toolId: "tool.sprint_compare",
  name: "compute",
  category: "read",
  description:
    "Compare sprints across shared scored dimensions. Input: sprints[] each {name, dimensions: {dim: number}}. Returns {dimensions: {dim, min, max, average, leader}[], perSprint: {name, total, average}[] (across its dimensions), overallLeader}. Pure.",
  paramsSchema: z.object({
    sprints: z
      .array(
        z.object({
          name: z.string(),
          dimensions: z.record(z.string(), z.number()),
        })
      )
      .min(1),
  }),
  handler: async (params) => {
    const { sprints } = params;
    // Union of all dimension keys across sprints.
    const dimKeys = Array.from(new Set(sprints.flatMap((s) => Object.keys(s.dimensions))));

    const dimensions = dimKeys.map((dim) => {
      let min = Infinity;
      let max = -Infinity;
      let sum = 0;
      let count = 0;
      let leader = "";
      for (const s of sprints) {
        const v = s.dimensions[dim];
        if (typeof v !== "number") continue;
        if (v < min) min = v;
        if (v > max) {
          max = v;
          leader = s.name;
        }
        sum += v;
        count += 1;
      }
      return {
        dim,
        min: count ? min : 0,
        max: count ? max : 0,
        average: count ? round2(sum / count) : 0,
        leader,
      };
    });

    const perSprint = sprints.map((s) => {
      const vals = dimKeys
        .map((d) => s.dimensions[d])
        .filter((v): v is number => typeof v === "number");
      const total = vals.reduce((a, b) => a + b, 0);
      return {
        name: s.name,
        total: round2(total),
        average: vals.length ? round2(total / vals.length) : 0,
      };
    });

    const overallLeader = perSprint.reduce(
      (best, s) => (s.average > best.average ? s : best),
      perSprint[0]
    ).name;

    return { dimensions, perSprint, overallLeader };
  },
});
