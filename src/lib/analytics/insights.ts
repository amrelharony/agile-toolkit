import type { Workspace } from "../stores/workspace-types";
import { selectCompletedSprints } from "../stores/workspace-store";
import { runAntiPatternRules, sortBySeverity, type AntiPatternSignal } from "./anti-patterns";
import { forecastHolt, predictabilityScore } from "./forecasting";
import { zScoreAnomalies } from "./anomaly";

export interface Insight {
  id: string;
  kind: "anti-pattern" | "forecast" | "anomaly" | "summary";
  title: string;
  body: string;
  severity: "info" | "warn" | "critical";
  relatedTools: string[];
}

export function workspaceInsights(w: Workspace): Insight[] {
  const insights: Insight[] = [];

  const signals = sortBySeverity(runAntiPatternRules(w));
  for (const s of signals) {
    insights.push({
      id: `ap-${s.id}`,
      kind: "anti-pattern",
      title: s.title,
      body: `${s.description}\n\nRecommendation: ${s.recommendation}`,
      severity: s.severity,
      relatedTools: s.relatedTools,
    });
  }

  const completed = selectCompletedSprints(w);
  if (completed.length >= 3) {
    const velocitySeries = completed.map((s) => s.pointsCompleted ?? 0);
    const forecast = forecastHolt(velocitySeries, 1);
    if (forecast.length > 0) {
      const f = forecast[0];
      insights.push({
        id: "forecast-velocity",
        kind: "forecast",
        title: `Next-sprint velocity forecast: ${Math.round(f.yHat)} pts`,
        body: `80% confidence: ${Math.max(0, Math.round(f.lower80))}–${Math.round(f.upper80)} pts. 95%: ${Math.max(
          0,
          Math.round(f.lower95)
        )}–${Math.round(f.upper95)} pts. Predictability score: ${(predictabilityScore(velocitySeries) * 100).toFixed(
          0
        )}%.`,
        severity: "info",
        relatedTools: ["velocity", "release-planner"],
      });
    }

    const anomalies = zScoreAnomalies(velocitySeries, 2);
    if (anomalies.length > 0) {
      const last = anomalies[anomalies.length - 1];
      insights.push({
        id: `anomaly-velocity-${last.index}`,
        kind: "anomaly",
        title: `Velocity outlier detected`,
        body: `Sprint ${last.index + 1} logged ${last.value} pts — z-score ${last.zScore.toFixed(
          2
        )} (${last.direction}).`,
        severity: last.severity === "extreme" ? "warn" : "info",
        relatedTools: ["velocity", "sprint-compare"],
      });
    }
  }

  return insights;
}

export function topInsights(w: Workspace, n = 3): Insight[] {
  return workspaceInsights(w).slice(0, n);
}

export function insightsForTool(w: Workspace, toolId: string, n = 3): Insight[] {
  return workspaceInsights(w)
    .filter((i) => i.relatedTools.length === 0 || i.relatedTools.includes(toolId))
    .slice(0, n);
}

export type { AntiPatternSignal };
