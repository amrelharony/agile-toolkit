/**
 * Estimation Guide — tool-local actions.
 *
 * Category: Sprint Planning & Estimation (squad S1 — reference)
 * Agent surface: tool.estimation_guide.*
 *
 * Pure reference data, no persistence (the in-app tool lets users customise
 * descriptions, but the agent surface exposes the canonical scale reference).
 * Reuses the shared `scales` + `defaultDescriptions` constants so the agent
 * and the UI speak the same vocabulary.
 */

import { z } from "zod";
import { registry } from "../registry";
import { scales, defaultDescriptions } from "@/lib/constants/scales";

// ──────── tool.estimation_guide.get_reference ────────
registry.register({
  id: "tool.estimation_guide.get_reference",
  toolId: "tool.estimation_guide",
  name: "get_reference",
  category: "read",
  description:
    "Return the estimation-scale reference: each scale's point values paired with a default complexity description. Optionally filter to one scale (Fibonacci | T-Shirt | Powers of 2 | Linear). Pure reference data, no persistence.",
  paramsSchema: z.object({
    scale: z
      .string()
      .optional()
      .describe("Scale name to return (case-insensitive). Omit for all scales."),
  }),
  handler: async (params) => {
    const want = params.scale?.trim().toLowerCase();
    const matched = want ? scales.filter((s) => s.name.toLowerCase() === want) : scales;
    const selected = matched.length > 0 ? matched : scales;
    return {
      scales: selected.map((s) => ({
        name: s.name,
        points: s.values.map((v) => ({
          value: v,
          description: defaultDescriptions[String(v)] ?? "",
        })),
      })),
    };
  },
});
