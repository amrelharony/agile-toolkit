import type { Workspace } from "../stores/workspace-types";
import { selectCompletedSprints, selectActiveImpediments } from "../stores/workspace-store";
import { trendDirection } from "./anomaly";
import {
  SKILLS_MATRIX_ID,
  matrixColumns,
  normalizeSkillsMatrix,
  realRoster,
  skillCoverage,
} from "../skills/coverage";

export type AntiPatternId =
  | "LATE_BURN_WITH_BLOCKERS"
  | "VELOCITY_DECLINE_WITH_SCOPE_CREEP"
  | "BUS_FACTOR_UNDER_TWO"
  | "STALE_IMPEDIMENT"
  | "REFINEMENT_PASS_RATE_LOW"
  | "RISK_STACKING"
  | "MOOD_VELOCITY_DIVERGENCE"
  | "CRITICAL_PATH_BOTTLENECK"
  | "COMMITMENT_EROSION"
  | "TECH_DEBT_ACCELERATING";

export type Severity = "info" | "warn" | "critical";

export interface AntiPatternSignal {
  id: AntiPatternId;
  title: string;
  severity: Severity;
  description: string;
  recommendation: string;
  relatedTools: string[];
  evidence: string[];
}

export function detectStaleImpediments(w: Workspace, now = new Date()): AntiPatternSignal | null {
  const active = selectActiveImpediments(w);
  const stale = active.filter((i) => {
    const raisedT = new Date(i.raisedAt).getTime();
    if (!Number.isFinite(raisedT)) return false; // bad imported date — don't false-positive
    const age = (now.getTime() - raisedT) / (1000 * 60 * 60 * 24);
    return age > 14 && (i.severity === "high" || i.severity === "critical");
  });
  if (stale.length === 0) return null;
  return {
    id: "STALE_IMPEDIMENT",
    title: `${stale.length} aging impediment${stale.length > 1 ? "s" : ""}`,
    severity: "critical",
    description: `High/critical impediments open >14 days — they're compounding sprint risk.`,
    recommendation:
      "Escalate each stale impediment by name at the next standup. Assign a named owner and a resolve-by date.",
    relatedTools: ["impediments", "standup"],
    evidence: stale.map((i) => `${i.title} (${i.severity})`).slice(0, 5),
  };
}

export function detectCommitmentErosion(w: Workspace): AntiPatternSignal | null {
  const sprints = selectCompletedSprints(w);
  if (sprints.length < 3) return null;
  const last3 = sprints.slice(-3);
  const ratios = last3.map((s) =>
    s.pointsPlanned > 0 ? (s.pointsCompleted ?? 0) / s.pointsPlanned : 1
  );
  const allBelow = ratios.every((r) => r < 0.85);
  const declining = ratios[0] > ratios[1] && ratios[1] > ratios[2];
  if (!allBelow && !declining) return null;
  return {
    id: "COMMITMENT_EROSION",
    title: "Commitment erosion detected",
    severity: "warn",
    description: `Last 3 sprints completed ${Math.round(
      (ratios.reduce((a, b) => a + b, 0) / 3) * 100
    )}% of commitment on average.`,
    recommendation:
      "Reduce next sprint commitment by 15–20% and protect capacity. Review what's blocking completion at retro.",
    relatedTools: ["velocity", "burndown", "retro"],
    evidence: last3.map((s) => `${s.name}: ${s.pointsCompleted ?? 0}/${s.pointsPlanned} pts`),
  };
}

export function detectVelocityDecline(w: Workspace): AntiPatternSignal | null {
  const sprints = selectCompletedSprints(w);
  if (sprints.length < 4) return null;
  const last = sprints.slice(-4).map((s) => s.pointsCompleted ?? 0);
  const dir = trendDirection(last);
  if (dir !== "falling") return null;
  return {
    id: "VELOCITY_DECLINE_WITH_SCOPE_CREEP",
    title: "Velocity trending down",
    severity: "warn",
    description: `Velocity has fallen across the last 4 sprints (${last.join(" → ")}).`,
    recommendation:
      "Run a focused retro on what's slowing the team. Check refinement quality, WIP limits, and blocker resolution times.",
    relatedTools: ["velocity", "cycle-time", "refinement"],
    evidence: last.map((v, i) => `Sprint ${i + 1}: ${v} pts`),
  };
}

/**
 * Skills that hang on one person. With a rated Skills Matrix this is the
 * matrix's own rule (lib/skills/coverage: exactly one person at
 * Intermediate or above), so Insights and the matrix agree; without one it
 * falls back to the Team page's skill tags (a skill only one member lists).
 */
export function detectBusFactorRisk(w: Workspace): AntiPatternSignal | null {
  const matrix = (w.skillsMatrices ?? []).find((d) => d.id === SKILLS_MATRIX_ID);
  if (matrix) {
    const roster = realRoster(w.teamMembers);
    const doc = normalizeSkillsMatrix(matrix);
    const columns = matrixColumns(doc, roster);
    const coverage = skillCoverage(doc, columns, roster);
    const rated = coverage.some((c) => c.unrated < columns.length);
    if (rated) {
      const spofs = coverage.filter((c) => c.spof);
      if (spofs.length === 0) return null;
      return {
        id: "BUS_FACTOR_UNDER_TWO",
        title: `Bus factor = 1 on ${spofs.length} skill${spofs.length > 1 ? "s" : ""}`,
        severity: "warn",
        description:
          "Only one person on the team is at Intermediate or above in at least one skill (Skills Matrix).",
        recommendation:
          "Plan cross-training in the Skills Matrix so at least two people can do each of these skills.",
        relatedTools: ["skills-matrix"],
        evidence: spofs.slice(0, 5).map((c) => `${c.name}: ${c.holders[0]}`),
      };
    }
  }
  const skillCounts = new Map<string, number>();
  for (const m of w.teamMembers) {
    for (const skill of m.skills ?? []) {
      skillCounts.set(skill, (skillCounts.get(skill) ?? 0) + 1);
    }
  }
  const single = Array.from(skillCounts.entries()).filter(([, n]) => n === 1);
  if (single.length === 0) return null;
  return {
    id: "BUS_FACTOR_UNDER_TWO",
    title: `Bus factor = 1 on ${single.length} skill${single.length > 1 ? "s" : ""}`,
    severity: "warn",
    description: "One team member is the sole expert on at least one critical skill.",
    recommendation:
      "Schedule pair programming or knowledge-share sessions to spread these skills to ≥2 people.",
    relatedTools: ["skills-matrix"],
    evidence: single.slice(0, 5).map(([skill]) => skill),
  };
}

export function detectRiskStacking(w: Workspace): AntiPatternSignal | null {
  const high = w.risks.filter(
    // R10: NaN guard — `undefined * undefined === NaN`, `NaN >= 12 === false`,
    // so risks with missing probability/impact (legacy or corrupted
    // import) silently disappeared from the count. Coerce to 0.
    (r) =>
      (r.status === "open" || r.status === "mitigating") &&
      (r.probability ?? 0) * (r.impact ?? 0) >= 12
  );
  if (high.length < 3) return null;
  return {
    id: "RISK_STACKING",
    title: `${high.length} high-severity risks open`,
    severity: "critical",
    description: "Multiple risks with P×I ≥ 12 are unresolved. Compound delivery exposure.",
    recommendation:
      "Rank these by P×I, assign a named risk owner per item, and set mitigation deadlines.",
    relatedTools: ["risk-register"],
    evidence: high.slice(0, 5).map((r) => `${r.title} (P${r.probability}×I${r.impact})`),
  };
}

export function detectTechDebtAcceleration(w: Workspace): AntiPatternSignal | null {
  const now = Date.now();
  const last30 = w.techDebt.filter(
    (t) => !t.resolvedAt && (now - new Date(t.raisedAt).getTime()) / (1000 * 60 * 60 * 24) <= 30
  );
  const prev30 = w.techDebt.filter((t) => {
    const age = (now - new Date(t.raisedAt).getTime()) / (1000 * 60 * 60 * 24);
    return !t.resolvedAt && age > 30 && age <= 60;
  });
  if (last30.length < 3 || last30.length <= prev30.length) return null;
  return {
    id: "TECH_DEBT_ACCELERATING",
    title: "Tech debt accumulating faster than resolving",
    severity: "warn",
    description: `${last30.length} new debt items in last 30 days vs. ${prev30.length} in the prior 30.`,
    recommendation:
      "Allocate 15–20% of next sprint's capacity to debt paydown. Target highest-impact items first.",
    relatedTools: ["tech-debt"],
    evidence: last30
      // Rank by ROI (impact ÷ effort) so "highest-impact items first" in the
      // recommendation actually surfaces the best payoff. Previous sort by
      // impact*effort prioritized large items regardless of cost.
      .slice()
      .sort((a, b) => b.impact / Math.max(1, b.effort) - a.impact / Math.max(1, a.effort))
      .slice(0, 3)
      .map((t) => `${t.title} (Impact ${t.impact}, Effort ${t.effort})`),
  };
}

export function runAntiPatternRules(w: Workspace): AntiPatternSignal[] {
  const checks = [
    detectStaleImpediments(w),
    detectCommitmentErosion(w),
    detectVelocityDecline(w),
    detectBusFactorRisk(w),
    detectRiskStacking(w),
    detectTechDebtAcceleration(w),
  ];
  return checks.filter((c): c is AntiPatternSignal => c !== null);
}

export function sortBySeverity(signals: AntiPatternSignal[]): AntiPatternSignal[] {
  const order: Record<Severity, number> = { critical: 0, warn: 1, info: 2 };
  return signals.slice().sort((a, b) => order[a.severity] - order[b.severity]);
}
