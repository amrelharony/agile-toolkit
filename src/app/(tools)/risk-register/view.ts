/**
 * Risk Register: the page's pure edits and its CSV. Every number comes
 * from lib/risks/model, as the Markdown and the agent read it.
 */

import {
  RISK_LEVEL_LABEL,
  RISK_STATUS_LABEL,
  closedOn,
  compareRisks,
  residualScore,
  riskDaysOverdue,
  riskLevel,
  riskScore,
  toScale,
} from "@/lib/risks/model";
import type { Risk } from "@/lib/stores/workspace-types";
import type { ImpedimentState } from "./markdown";

/** A change to a risk's fields; an optional field given as undefined or "" is removed. */
export type RiskPatch = Partial<Omit<Risk, "id">>;

/** The fields a patch may take away (required ones are never removed). */
const OPTIONAL = new Set<keyof Risk>([
  "mitigation",
  "mitigationDueAt",
  "resolvedAt",
  "owner",
  "description",
  "residualProbability",
  "residualImpact",
  "sentTo",
]);

/** The risk with `patch` applied, the emptied optional fields removed. */
export function withPatch(r: Risk, patch: RiskPatch): Risk {
  const next = { ...r, ...patch } as Risk;
  const fields = next as unknown as Record<string, unknown>;
  for (const [key, value] of Object.entries(patch)) {
    if (!OPTIONAL.has(key as keyof Risk)) continue;
    if (value === undefined || (typeof value === "string" && !value.trim())) delete fields[key];
  }
  return next;
}

/**
 * The risk moved to `status`. Closing stamps `day` (today unless the
 * team backdates it); any other move keeps resolvedAt, which counts only
 * while the risk is closed (lib/risks/model closedOn), so a reopened risk
 * reads as open and keeps the day it was first closed, as the agent's
 * set_status does.
 */
export function withStatus(r: Risk, status: Risk["status"], day: string): Risk {
  return status === "closed" ? { ...r, status, resolvedAt: day } : { ...r, status };
}

/** The register's CSV, in the register's order. */
export function risksCsv(
  risks: readonly Risk[],
  today: string,
  impediment: (r: Risk) => ImpedimentState = () => null
): { headers: string[]; rows: (string | number)[][] } {
  return {
    headers: [
      "Title",
      "Description",
      "Owner",
      "Probability",
      "Impact",
      "Score",
      "Level",
      "Residual probability",
      "Residual impact",
      "Residual score",
      "Status",
      "Mitigation",
      "Mitigation due",
      "Days overdue",
      "Raised",
      "Closed",
      "Impediment",
    ],
    rows: [...risks]
      .sort((a, b) => compareRisks(a, b, today))
      .map((r) => {
        const score = riskScore(r);
        const after = residualScore(r);
        const imp = impediment(r);
        return [
          r.title,
          r.description ?? "",
          r.owner ?? "",
          toScale(r.probability) ?? 1,
          toScale(r.impact) ?? 1,
          score,
          RISK_LEVEL_LABEL[riskLevel(score)],
          after === null ? "" : (toScale(r.residualProbability) ?? ""),
          after === null ? "" : (toScale(r.residualImpact) ?? ""),
          after ?? "",
          RISK_STATUS_LABEL[r.status] ?? r.status,
          r.mitigation ?? "",
          r.mitigationDueAt ?? "",
          riskDaysOverdue(r, today),
          r.raisedAt,
          closedOn(r) ?? "",
          imp === "resolved" ? "Resolved" : imp === "raised" ? "Raised" : "",
        ];
      }),
  };
}
