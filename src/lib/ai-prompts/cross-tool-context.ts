import type { Workspace } from "../stores/workspace-types";
import { selectActiveSprint, selectCompletedSprints, selectActiveImpediments, selectOpenRisks } from "../stores/workspace-store";
import { runAntiPatternRules, sortBySeverity } from "../analytics/anti-patterns";
import { mean } from "../analytics/anomaly";

export function buildWorkspaceContext(w: Workspace | undefined | null): string {
  if (!w) return "";
  const parts: string[] = [];

  if (w.teamName) parts.push(`Team: ${w.teamName}`);
  if (w.teamMembers.length > 0) parts.push(`Team size: ${w.teamMembers.length}`);

  const completed = selectCompletedSprints(w);
  // Drop non-finite or negative pointsCompleted before averaging — corrupted
  // persisted state or a paste of "—" into the points field shouldn't drag
  // the AI's view of velocity into a NaN-laced or nonsensical number.
  const validVelocities = completed
    .map((s) => s.pointsCompleted ?? 0)
    .filter((v) => Number.isFinite(v) && v >= 0);
  if (validVelocities.length > 0) {
    const avgVelocity = Math.round(mean(validVelocities));
    parts.push(`Avg velocity: ${avgVelocity} pts (last ${validVelocities.length} sprints)`);
  }

  const active = selectActiveSprint(w);
  if (active) {
    parts.push(`Active sprint: "${active.name}" (${active.pointsPlanned} pts planned)`);
  }

  const activeImpediments = selectActiveImpediments(w);
  if (activeImpediments.length > 0) {
    const critical = activeImpediments.filter((i) => i.severity === "critical" || i.severity === "high");
    parts.push(
      `Active impediments: ${activeImpediments.length}${critical.length > 0 ? ` (${critical.length} high/critical)` : ""}`
    );
  }

  const openRisks = selectOpenRisks(w);
  if (openRisks.length > 0) {
    parts.push(`Open risks: ${openRisks.length}`);
  }

  if (w.maturityLevel) {
    parts.push(`Team maturity: Level ${w.maturityLevel}/5`);
  }

  const signals = sortBySeverity(runAntiPatternRules(w));
  if (signals.length > 0) {
    parts.push(`Top signal: ${signals[0].title}`);
  }

  if (parts.length === 0) return "";
  return `\n\n## Team Workspace Context\n\n${parts.map((p) => `- ${p}`).join("\n")}\n`;
}

export function maturityAdvice(level: number | undefined): string {
  if (!level) return "";
  const tone = {
    1: "This is a new team. Keep advice simple, focus on basic Scrum mechanics, and avoid advanced metrics.",
    2: "Team is learning the basics. Introduce one new practice at a time. Be concrete.",
    3: "Team is applying practices consistently. Focus on optimization and flow.",
    4: "Team operates autonomously. Focus on business outcomes, not process.",
    5: "Team is self-optimizing. Push for strategic impact and coaching other teams.",
  }[level];
  return tone ? `\n\n> Coaching tone: ${tone}\n` : "";
}
