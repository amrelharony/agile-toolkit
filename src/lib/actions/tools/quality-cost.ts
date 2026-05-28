/**
 * Cost of Quality Calculator — tool-local actions.
 *
 * Category: Quality Engineering (squad S10)
 * Tool:     A teaching calculator for the cost-of-quality (CoQ) trade-off
 *           across prevention, detection (appraisal), and failure costs.
 *
 * Agent surface: tool.quality_cost.*
 *
 * ─── PURE-COMPUTE tool (no migration) ─────────────────────────────────
 * quality-cost is a calculator — the manifest does NOT set usesWorkspace,
 * and there is no synced entity. The client persists its inputs locally for
 * UX, but the agent doesn't need that: it passes inputs to a referentially-
 * transparent compute and gets the CoQ breakdown back. No mcpHandler — a
 * pure compute runs identically on server and client (cf. estimation-guide).
 *
 *   1. compute_cost_of_quality — inputs → conformance / non-conformance /
 *      total CoQ + the conformance ratio.
 */

import { z } from "zod";
import { registry } from "../registry";

const round2 = (n: number) => Math.round(n * 100) / 100;

// ──────── tool.quality_cost.compute_cost_of_quality ────────
registry.register({
  id: "tool.quality_cost.compute_cost_of_quality",
  toolId: "tool.quality_cost",
  name: "compute_cost_of_quality",
  category: "read",
  description:
    "Compute the cost-of-quality breakdown. conformance = prevention + detection; nonConformance = internal + external failure; totalCoq = conformance + nonConformance. Also returns conformancePct and failurePct (0..1 of total; 0 when total is 0). Pure — no persistence.",
  paramsSchema: z.object({
    preventionCost: z.number().min(0),
    detectionCost: z.number().min(0).describe("Appraisal/detection cost."),
    internalFailureCost: z.number().min(0),
    externalFailureCost: z.number().min(0),
  }),
  handler: async (params) => {
    const conformance = params.preventionCost + params.detectionCost;
    const nonConformance = params.internalFailureCost + params.externalFailureCost;
    const totalCoq = conformance + nonConformance;
    return {
      conformance: round2(conformance),
      nonConformance: round2(nonConformance),
      totalCoq: round2(totalCoq),
      conformancePct: totalCoq ? round2(conformance / totalCoq) : 0,
      failurePct: totalCoq ? round2(nonConformance / totalCoq) : 0,
    };
  },
  // No mcpHandler — pure compute runs identically on server and client.
});
